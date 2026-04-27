import express from 'express';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import open from 'open';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('pharma.db', (err) => {
  if (err) console.error('Database connection failed:', err);
  else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

const runQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve({ id: this.lastID, changes: this.changes });
  });
});
const getQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const allQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const nowIso = () => new Date().toISOString();
const ok = (res, data = {}, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, status, code, message, details = null) => res.status(status).json({
  success: false,
  error: { code, message, details }
});

const withCatch = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    fail(res, 500, 'SERVER_ERROR', error.message);
  }
};

const requireFields = (res, body, fields) => {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) {
    fail(res, 422, 'VALIDATION_ERROR', `Missing required fields: ${missing.join(', ')}`, { missing });
    return false;
  }
  return true;
};

const normalizedMeta = (body = {}) => ({
  clientUpdatedAt: body.client_updated_at || nowIso(),
  deviceId: body.device_id || 'unknown-device',
  syncId: body.sync_id || null
});

const hashPassword = (password) => crypto.createHash('sha256').update(String(password)).digest('hex');
const newSessionToken = () => crypto.randomBytes(24).toString('hex');

async function logAudit(userId, action, entityType, entityId, details = null) {
  await runQuery(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId || null, action, entityType || null, entityId || null, details ? JSON.stringify(details) : null, nowIso()]
  );
}

const authRequired = async (req, res, next) => {
  const bearer = req.headers.authorization || '';
  const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : req.headers['x-session-token'];
  if (!token) return fail(res, 401, 'UNAUTHORIZED', 'Missing session token');
  const session = await getQuery(
    `SELECT s.id, s.user_id, s.expires_at, u.username, u.role
     FROM auth_sessions s
     JOIN auth_users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [token]
  );
  if (!session) return fail(res, 401, 'UNAUTHORIZED', 'Invalid session');
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    await runQuery('DELETE FROM auth_sessions WHERE id=?', [session.id]);
    return fail(res, 401, 'SESSION_EXPIRED', 'Session expired');
  }
  req.auth = { userId: session.user_id, username: session.username, role: session.role, token };
  next();
};

const requireRole = (roles) => (req, res, next) => {
  if (!roles.includes(req.auth.role)) return fail(res, 403, 'FORBIDDEN', 'Role not allowed for this action');
  next();
};

async function ensureCompanyAccount(name) {
  const existing = await getQuery('SELECT id FROM company_accounts WHERE name=?', [name]);
  if (existing) return existing.id;
  const created = await runQuery('INSERT INTO company_accounts (name, current_balance, created_at, updated_at) VALUES (?, 0, ?, ?)', [name, nowIso(), nowIso()]);
  return created.id;
}

async function ensureCustomerAccount(customerId, customerName = null) {
  const existing = await getQuery('SELECT id FROM customer_accounts WHERE customer_id=?', [customerId]);
  if (existing) return existing.id;
  const fallbackName = customerName || (await getQuery('SELECT name FROM customers WHERE id=?', [customerId]))?.name || `Customer ${customerId}`;
  const created = await runQuery(
    'INSERT INTO customer_accounts (customer_id, customer_name, current_balance, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
    [customerId, fallbackName, nowIso(), nowIso()]
  );
  return created.id;
}

async function createSimpleTable(name) {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS ${name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      amount REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      reference TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      client_updated_at TEXT,
      device_id TEXT,
      sync_id TEXT
    )
  `);
}

async function initializeDatabase() {
  await runQuery(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, sku TEXT UNIQUE NOT NULL, barcode TEXT UNIQUE, category TEXT,
    price REAL NOT NULL, cost REAL, stock_quantity INTEGER DEFAULT 0, min_stock INTEGER DEFAULT 10,
    description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    client_updated_at TEXT, device_id TEXT, sync_id TEXT
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE NOT NULL, total_amount REAL NOT NULL, payment_method TEXT, customer_name TEXT,
    status TEXT DEFAULT 'completed', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    client_updated_at TEXT, device_id TEXT, sync_id TEXT
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS sales_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL, unit_price REAL NOT NULL, total_price REAL NOT NULL
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_no TEXT UNIQUE NOT NULL, vendor_name TEXT, total_amount REAL NOT NULL, status TEXT DEFAULT 'received',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    client_updated_at TEXT, device_id TEXT, sync_id TEXT
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL, unit_cost REAL NOT NULL, total_cost REAL NOT NULL
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, credit_limit REAL DEFAULT 0, current_balance REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    client_updated_at TEXT, device_id TEXT, sync_id TEXT
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, customer_id INTEGER, amount REAL NOT NULL,
    payment_method TEXT, reference TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    client_updated_at TEXT, device_id TEXT, sync_id TEXT
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, payment_terms TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, amount REAL NOT NULL, status TEXT DEFAULT 'outstanding',
    due_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS cash_register (
    id INTEGER PRIMARY KEY AUTOINCREMENT, register_name TEXT NOT NULL, opening_balance REAL DEFAULT 0,
    current_balance REAL DEFAULT 0, status TEXT DEFAULT 'open', opened_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS inventory_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, adjustment_qty INTEGER NOT NULL,
    reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS barcode_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    sku TEXT,
    barcode_value TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    client_updated_at TEXT,
    device_id TEXT,
    sync_id TEXT
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS auth_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS company_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    contact TEXT,
    current_balance REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS purchase_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER,
    company_account_id INTEGER NOT NULL,
    invoice_no TEXT UNIQUE NOT NULL,
    total_amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'unpaid',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_invoice_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cost REAL NOT NULL,
    total_cost REAL NOT NULL
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS company_ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_account_id INTEGER NOT NULL,
    entry_type TEXT NOT NULL,
    amount REAL NOT NULL,
    reference_type TEXT,
    reference_id INTEGER,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS customer_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER UNIQUE,
    customer_name TEXT NOT NULL,
    current_balance REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS sales_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER,
    customer_account_id INTEGER,
    invoice_no TEXT UNIQUE NOT NULL,
    total_amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'unpaid',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS sales_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sales_invoice_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS customer_ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_account_id INTEGER NOT NULL,
    entry_type TEXT NOT NULL,
    amount REAL NOT NULL,
    reference_type TEXT,
    reference_id INTEGER,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  const extraTables = ['spend_history', 'loan_recoveries', 'defective_items', 'layaway_orders', 'customer_alerts', 'cash_reports', 'account_statements', 'backup_logs', 'supplies', 'daybook_entries', 'company_debts'];
  for (const table of extraTables) await createSimpleTable(table);

  const mappedUsers = await allQuery('SELECT username, role FROM users');
  for (const user of mappedUsers) {
    const exists = await getQuery('SELECT id FROM auth_users WHERE username=?', [user.username]);
    if (!exists) {
      await runQuery(
        'INSERT INTO auth_users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
        [user.username, hashPassword('changeme123'), String(user.role || 'user').toLowerCase(), nowIso()]
      );
    }
  }
  const admin = await getQuery("SELECT id FROM auth_users WHERE role='admin'");
  if (!admin) {
    await runQuery(
      "INSERT INTO auth_users (username, password_hash, role, created_at) VALUES ('admin', ?, 'admin', ?)",
      [hashPassword('admin123'), nowIso()]
    );
  }

  console.log('Database tables initialized');
}

async function inTransaction(work) {
  await runQuery('BEGIN IMMEDIATE TRANSACTION');
  try {
    const out = await work();
    await runQuery('COMMIT');
    return out;
  } catch (error) {
    await runQuery('ROLLBACK');
    throw error;
  }
}

const betweenClause = (req) => {
  const filters = [];
  const params = [];
  if (req.query.from) {
    filters.push('created_at >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    filters.push('created_at <= ?');
    params.push(req.query.to);
  }
  return { where: filters.length ? `WHERE ${filters.join(' AND ')}` : '', params };
};

app.post('/api/auth/login', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['username', 'password'])) return;
  const user = await getQuery(
    'SELECT id, username, role, password_hash, is_active FROM auth_users WHERE username=?',
    [req.body.username]
  );
  if (!user || user.password_hash !== hashPassword(req.body.password) || !user.is_active) {
    return fail(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password');
  }
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + (1000 * 60 * 60 * 12)).toISOString();
  await runQuery('INSERT INTO auth_sessions (user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?)', [user.id, token, nowIso(), expiresAt]);
  await logAudit(user.id, 'auth.login', 'auth_user', user.id, { username: user.username });
  ok(res, { token, user: { id: user.id, username: user.username, role: user.role }, expires_at: expiresAt });
}));

app.use('/api', async (req, res, next) => {
  if (req.path === '/auth/login') return next();
  try {
    await new Promise((resolve, reject) => authRequired(req, res, (err) => (err ? reject(err) : resolve())));
    if (!req.path.startsWith('/auth/')) {
      await logAudit(req.auth.userId, 'api.request', 'route', req.path, { method: req.method });
    }
    next();
  } catch (error) {
    fail(res, 401, 'UNAUTHORIZED', error.message);
  }
});

app.get('/api/auth/me', withCatch(async (req, res) => {
  ok(res, { user: { id: req.auth.userId, username: req.auth.username, role: req.auth.role } });
}));

app.post('/api/auth/logout', withCatch(async (req, res) => {
  await runQuery('DELETE FROM auth_sessions WHERE token=?', [req.auth.token]);
  await logAudit(req.auth.userId, 'auth.logout', 'auth_user', req.auth.userId, null);
  ok(res, { logged_out: true });
}));

app.get('/api/audit-logs', withCatch(async (req, res) => {
  await new Promise((resolve, reject) => authRequired(req, res, (err) => (err ? reject(err) : resolve())));
  if (req.auth.role !== 'admin') return fail(res, 403, 'FORBIDDEN', 'Admin only');
  const rows = await allQuery(
    `SELECT l.*, u.username
     FROM audit_logs l
     LEFT JOIN auth_users u ON u.id = l.user_id
     ORDER BY l.created_at DESC LIMIT 500`
  );
  ok(res, rows);
}));

app.get('/api/products', withCatch(async (req, res) => ok(res, await allQuery('SELECT * FROM products ORDER BY name'))));
app.post('/api/products', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['name', 'sku', 'price'])) return;
  const m = normalizedMeta(req.body);
  const result = await runQuery(
    `INSERT INTO products (name, sku, barcode, category, price, cost, stock_quantity, min_stock, description, updated_at, client_updated_at, device_id, sync_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.body.name, req.body.sku, req.body.barcode || null, req.body.category || null, Number(req.body.price), Number(req.body.cost || 0), Number(req.body.stock_quantity || 0), Number(req.body.min_stock || 10), req.body.description || '', nowIso(), m.clientUpdatedAt, m.deviceId, m.syncId]
  );
  ok(res, { id: result.id, authoritative_updated_at: nowIso() }, 201);
}));
app.put('/api/products/:id', withCatch(async (req, res) => {
  const current = await getQuery('SELECT updated_at FROM products WHERE id=?', [req.params.id]);
  if (!current) return fail(res, 404, 'NOT_FOUND', 'Product not found');
  const incoming = req.body.client_updated_at ? new Date(req.body.client_updated_at).getTime() : Date.now();
  const existing = current.updated_at ? new Date(current.updated_at).getTime() : 0;
  if (incoming < existing) return fail(res, 409, 'SYNC_CONFLICT', 'Stale update rejected by last-write-wins');
  await runQuery(`UPDATE products SET name=?, price=?, cost=?, stock_quantity=?, min_stock=?, description=?, updated_at=?, client_updated_at=?, device_id=?, sync_id=? WHERE id=?`,
    [req.body.name, Number(req.body.price || 0), Number(req.body.cost || 0), Number(req.body.stock_quantity || 0), Number(req.body.min_stock || 0), req.body.description || '', nowIso(), req.body.client_updated_at || nowIso(), req.body.device_id || 'unknown-device', req.body.sync_id || null, req.params.id]);
  ok(res, { id: Number(req.params.id), authoritative_updated_at: nowIso() });
}));

app.get('/api/sales', withCatch(async (req, res) => ok(res, await allQuery('SELECT * FROM sales ORDER BY created_at DESC'))));
app.get('/api/sales/:id', withCatch(async (req, res) => ok(res, { sale: await getQuery('SELECT * FROM sales WHERE id=?', [req.params.id]), items: await allQuery('SELECT * FROM sales_items WHERE sale_id=?', [req.params.id]) })));
app.post('/api/sales', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['receipt_no', 'items'])) return;
  const data = await inTransaction(async () => {
    const m = normalizedMeta(req.body);
    const total = Number(req.body.total_amount || 0);
    const sale = await runQuery(`INSERT INTO sales (receipt_no, total_amount, payment_method, customer_name, updated_at, client_updated_at, device_id, sync_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.body.receipt_no, total, req.body.payment_method || 'Cash', req.body.customer_name || 'Walk-in Customer', nowIso(), m.clientUpdatedAt, m.deviceId, m.syncId]);
    for (const item of req.body.items) {
      await runQuery('INSERT INTO sales_items (sale_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)', [sale.id, item.product_id, item.quantity, item.unit_price, item.total_price]);
      await runQuery('UPDATE products SET stock_quantity = stock_quantity - ?, updated_at=? WHERE id=?', [item.quantity, nowIso(), item.product_id]);
    }
    if (req.body.customer_id || (req.body.customer_name && req.body.customer_name !== 'Walk-in Customer')) {
      let customerAccountId;
      if (req.body.customer_id) {
        customerAccountId = await ensureCustomerAccount(req.body.customer_id, req.body.customer_name || null);
      } else {
        const existingByName = await getQuery('SELECT id FROM customer_accounts WHERE customer_name=? ORDER BY id DESC LIMIT 1', [req.body.customer_name]);
        if (existingByName) {
          customerAccountId = existingByName.id;
        } else {
          const created = await runQuery('INSERT INTO customer_accounts (customer_id, customer_name, current_balance, created_at, updated_at) VALUES (?, ?, 0, ?, ?)', [null, req.body.customer_name, nowIso(), nowIso()]);
          customerAccountId = created.id;
        }
      }
      const paidAmount = Number(req.body.paid_amount || 0);
      const invoice = await runQuery(
        `INSERT INTO sales_invoices (sale_id, customer_account_id, invoice_no, total_amount, paid_amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sale.id, customerAccountId, req.body.invoice_no || req.body.receipt_no, total, paidAmount, paidAmount >= total ? 'paid' : 'partial', nowIso()]
      );
      for (const item of req.body.items) {
        await runQuery(
          'INSERT INTO sales_invoice_items (sales_invoice_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)',
          [invoice.id, item.product_id, item.quantity, item.unit_price, item.total_price]
        );
      }
      await runQuery(
        'INSERT INTO customer_ledger_entries (customer_account_id, entry_type, amount, reference_type, reference_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [customerAccountId, 'invoice_debit', total, 'sales_invoice', invoice.id, `Sale ${req.body.receipt_no}`, nowIso()]
      );
      if (paidAmount > 0) {
        await runQuery(
          'INSERT INTO customer_ledger_entries (customer_account_id, entry_type, amount, reference_type, reference_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [customerAccountId, 'payment_credit', paidAmount, 'sales_invoice', invoice.id, 'Initial payment', nowIso()]
        );
      }
      await runQuery(
        `UPDATE customer_accounts
         SET current_balance = (
           SELECT COALESCE(SUM(CASE WHEN entry_type='invoice_debit' THEN amount ELSE -amount END), 0)
           FROM customer_ledger_entries WHERE customer_account_id=?
         ),
         updated_at=?
         WHERE id=?`,
        [customerAccountId, nowIso(), customerAccountId]
      );
    }
    await logAudit(req.auth.userId, 'sale.create', 'sale', sale.id, { total });
    return sale.id;
  });
  ok(res, { sale_id: data, authoritative_updated_at: nowIso() }, 201);
}));

app.get('/api/purchases', withCatch(async (req, res) => ok(res, await allQuery('SELECT * FROM purchases ORDER BY created_at DESC'))));
app.post('/api/purchases', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['purchase_no', 'vendor_name', 'items'])) return;
  const purchaseId = await inTransaction(async () => {
    const m = normalizedMeta(req.body);
    const purchase = await runQuery(`INSERT INTO purchases (purchase_no, vendor_name, total_amount, updated_at, client_updated_at, device_id, sync_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.body.purchase_no, req.body.vendor_name, Number(req.body.total_amount || 0), nowIso(), m.clientUpdatedAt, m.deviceId, m.syncId]);
    for (const item of req.body.items) {
      await runQuery('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, total_cost) VALUES (?, ?, ?, ?, ?)', [purchase.id, item.product_id, item.quantity, item.unit_cost, item.total_cost]);
      await runQuery('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at=? WHERE id=?', [item.quantity, nowIso(), item.product_id]);
    }
    const companyAccountId = req.body.company_account_id || await ensureCompanyAccount(req.body.vendor_name);
    const paidAmount = Number(req.body.paid_amount || 0);
    const invoice = await runQuery(
      `INSERT INTO purchase_invoices (purchase_id, company_account_id, invoice_no, total_amount, paid_amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [purchase.id, companyAccountId, req.body.invoice_no || req.body.purchase_no, Number(req.body.total_amount || 0), paidAmount, paidAmount >= Number(req.body.total_amount || 0) ? 'paid' : 'partial', nowIso()]
    );
    for (const item of req.body.items) {
      await runQuery(
        'INSERT INTO purchase_invoice_items (purchase_invoice_id, product_id, quantity, unit_cost, total_cost) VALUES (?, ?, ?, ?, ?)',
        [invoice.id, item.product_id, item.quantity, item.unit_cost, item.total_cost]
      );
    }
    await runQuery(
      'INSERT INTO company_ledger_entries (company_account_id, entry_type, amount, reference_type, reference_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [companyAccountId, 'invoice_debit', Number(req.body.total_amount || 0), 'purchase_invoice', invoice.id, `Invoice ${req.body.purchase_no}`, nowIso()]
    );
    if (paidAmount > 0) {
      await runQuery(
        'INSERT INTO company_ledger_entries (company_account_id, entry_type, amount, reference_type, reference_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [companyAccountId, 'payment_credit', paidAmount, 'purchase_invoice', invoice.id, 'Initial payment', nowIso()]
      );
    }
    await runQuery(
      `UPDATE company_accounts
       SET current_balance = (
         SELECT COALESCE(SUM(CASE WHEN entry_type='invoice_debit' THEN amount ELSE -amount END), 0)
         FROM company_ledger_entries WHERE company_account_id=?
       ),
       updated_at=?
       WHERE id=?`,
      [companyAccountId, nowIso(), companyAccountId]
    );
    await logAudit(req.auth.userId, 'purchase.create', 'purchase', purchase.id, { companyAccountId, total: Number(req.body.total_amount || 0) });
    return purchase.id;
  });
  ok(res, { purchase_id: purchaseId, authoritative_updated_at: nowIso() }, 201);
}));

app.get('/api/customers', withCatch(async (req, res) => ok(res, await allQuery('SELECT * FROM customers ORDER BY name'))));
app.post('/api/customers', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['name'])) return;
  const m = normalizedMeta(req.body);
  const out = await runQuery(`INSERT INTO customers (name, phone, email, address, credit_limit, updated_at, client_updated_at, device_id, sync_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.body.name, req.body.phone || '', req.body.email || '', req.body.address || '', Number(req.body.credit_limit || 0), nowIso(), m.clientUpdatedAt, m.deviceId, m.syncId]);
  ok(res, { id: out.id, authoritative_updated_at: nowIso() }, 201);
}));

app.get('/api/payments', withCatch(async (req, res) => ok(res, await allQuery('SELECT * FROM payments ORDER BY created_at DESC'))));
app.post('/api/payments', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['amount', 'payment_method'])) return;
  const m = normalizedMeta(req.body);
  const out = await runQuery('INSERT INTO payments (sale_id, customer_id, amount, payment_method, reference, updated_at, client_updated_at, device_id, sync_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [req.body.sale_id || null, req.body.customer_id || null, Number(req.body.amount), req.body.payment_method, req.body.reference || '', nowIso(), m.clientUpdatedAt, m.deviceId, m.syncId]);
  if (req.body.customer_account_id) {
    await runQuery(
      'INSERT INTO customer_ledger_entries (customer_account_id, entry_type, amount, reference_type, reference_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.body.customer_account_id, 'payment_credit', Number(req.body.amount), 'payment', out.id, req.body.reference || 'Payment', nowIso()]
    );
    await runQuery(
      `UPDATE customer_accounts
       SET current_balance = (
         SELECT COALESCE(SUM(CASE WHEN entry_type='invoice_debit' THEN amount ELSE -amount END), 0)
         FROM customer_ledger_entries WHERE customer_account_id=?
       ),
       updated_at=?
       WHERE id=?`,
      [req.body.customer_account_id, nowIso(), req.body.customer_account_id]
    );
  }
  if (req.body.company_account_id) {
    await runQuery(
      'INSERT INTO company_ledger_entries (company_account_id, entry_type, amount, reference_type, reference_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.body.company_account_id, 'payment_credit', Number(req.body.amount), 'payment', out.id, req.body.reference || 'Payment', nowIso()]
    );
    await runQuery(
      `UPDATE company_accounts
       SET current_balance = (
         SELECT COALESCE(SUM(CASE WHEN entry_type='invoice_debit' THEN amount ELSE -amount END), 0)
         FROM company_ledger_entries WHERE company_account_id=?
       ),
       updated_at=?
       WHERE id=?`,
      [req.body.company_account_id, nowIso(), req.body.company_account_id]
    );
  }
  await logAudit(req.auth.userId, 'payment.record', 'payment', out.id, { amount: Number(req.body.amount) });
  ok(res, { id: out.id, authoritative_updated_at: nowIso() }, 201);
}));

app.get('/api/debts', withCatch(async (req, res) => ok(res, await allQuery('SELECT d.*, c.name FROM debts d LEFT JOIN customers c ON d.customer_id = c.id ORDER BY d.created_at DESC'))));
app.post('/api/debts', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['customer_id', 'amount'])) return;
  const out = await runQuery('INSERT INTO debts (customer_id, amount, due_date, status, updated_at) VALUES (?, ?, ?, ?, ?)', [req.body.customer_id, Number(req.body.amount), req.body.due_date || null, req.body.status || 'outstanding', nowIso()]);
  const customerAccountId = await ensureCustomerAccount(req.body.customer_id);
  await runQuery(
    'INSERT INTO customer_ledger_entries (customer_account_id, entry_type, amount, reference_type, reference_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [customerAccountId, 'debt_debit', Number(req.body.amount), 'debt', out.id, req.body.note || 'Debt entry', nowIso()]
  );
  await runQuery(
    `UPDATE customer_accounts
     SET current_balance = (
       SELECT COALESCE(SUM(CASE WHEN entry_type IN ('invoice_debit','debt_debit') THEN amount ELSE -amount END), 0)
       FROM customer_ledger_entries WHERE customer_account_id=?
     ),
     updated_at=?
     WHERE id=?`,
    [customerAccountId, nowIso(), customerAccountId]
  );
  ok(res, { id: out.id }, 201);
}));

app.get('/api/company-accounts', withCatch(async (req, res) => {
  ok(res, await allQuery('SELECT * FROM company_accounts ORDER BY name'));
}));
app.post('/api/company-accounts', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['name'])) return;
  const out = await runQuery('INSERT INTO company_accounts (name, contact, current_balance, created_at, updated_at) VALUES (?, ?, 0, ?, ?)', [req.body.name, req.body.contact || '', nowIso(), nowIso()]);
  ok(res, { id: out.id }, 201);
}));
app.get('/api/company-accounts/:id/statement', withCatch(async (req, res) => {
  const account = await getQuery('SELECT * FROM company_accounts WHERE id=?', [req.params.id]);
  if (!account) return fail(res, 404, 'NOT_FOUND', 'Company account not found');
  const range = betweenClause(req);
  const where = range.where ? `${range.where} AND company_account_id=?` : 'WHERE company_account_id=?';
  const entries = await allQuery(`SELECT * FROM company_ledger_entries ${where} ORDER BY created_at ASC`, [...range.params, req.params.id]);
  ok(res, { account, entries });
}));
app.post('/api/company-accounts/:id/payments', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['amount'])) return;
  await runQuery(
    'INSERT INTO company_ledger_entries (company_account_id, entry_type, amount, reference_type, reference_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.params.id, 'payment_credit', Number(req.body.amount), 'manual_payment', null, req.body.note || 'Manual payment', nowIso()]
  );
  await runQuery(
    `UPDATE company_accounts
     SET current_balance = (
       SELECT COALESCE(SUM(CASE WHEN entry_type='invoice_debit' THEN amount ELSE -amount END), 0)
       FROM company_ledger_entries WHERE company_account_id=?
     ),
     updated_at=?
     WHERE id=?`,
    [req.params.id, nowIso(), req.params.id]
  );
  ok(res, { saved: true });
}));

app.get('/api/customer-accounts', withCatch(async (req, res) => {
  ok(res, await allQuery('SELECT * FROM customer_accounts ORDER BY customer_name'));
}));
app.get('/api/customer-accounts/:id/statement', withCatch(async (req, res) => {
  const account = await getQuery('SELECT * FROM customer_accounts WHERE id=?', [req.params.id]);
  if (!account) return fail(res, 404, 'NOT_FOUND', 'Customer account not found');
  const range = betweenClause(req);
  const where = range.where ? `${range.where} AND customer_account_id=?` : 'WHERE customer_account_id=?';
  const entries = await allQuery(`SELECT * FROM customer_ledger_entries ${where} ORDER BY created_at ASC`, [...range.params, req.params.id]);
  ok(res, { account, entries });
}));
app.post('/api/customer-accounts/:id/payments', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['amount'])) return;
  await runQuery(
    'INSERT INTO customer_ledger_entries (customer_account_id, entry_type, amount, reference_type, reference_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.params.id, 'payment_credit', Number(req.body.amount), 'manual_payment', null, req.body.note || 'Manual payment', nowIso()]
  );
  await runQuery(
    `UPDATE customer_accounts
     SET current_balance = (
       SELECT COALESCE(SUM(CASE WHEN entry_type IN ('invoice_debit','debt_debit') THEN amount ELSE -amount END), 0)
       FROM customer_ledger_entries WHERE customer_account_id=?
     ),
     updated_at=?
     WHERE id=?`,
    [req.params.id, nowIso(), req.params.id]
  );
  ok(res, { saved: true });
}));

app.get('/api/users', withCatch(async (req, res) => ok(res, await allQuery('SELECT id, username, email, role, created_at FROM users ORDER BY username'))));
app.post('/api/users', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['username', 'email'])) return;
  const out = await runQuery('INSERT INTO users (username, email, role) VALUES (?, ?, ?)', [req.body.username, req.body.email, req.body.role || 'user']);
  ok(res, { id: out.id, authoritative_updated_at: nowIso() }, 201);
}));

app.get('/api/barcodes', withCatch(async (req, res) => ok(res, await allQuery('SELECT * FROM barcode_labels ORDER BY created_at DESC'))));
app.post('/api/barcodes', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['product_name', 'barcode_value'])) return;
  const m = normalizedMeta(req.body);
  const out = await runQuery(
    `INSERT INTO barcode_labels (product_name, sku, barcode_value, updated_at, client_updated_at, device_id, sync_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.body.product_name, req.body.sku || '', req.body.barcode_value, nowIso(), m.clientUpdatedAt, m.deviceId, m.syncId]
  );
  ok(res, { id: out.id, authoritative_updated_at: nowIso() }, 201);
}));

app.get('/api/cash-register', withCatch(async (req, res) => ok(res, await allQuery('SELECT * FROM cash_register ORDER BY opened_at DESC'))));
app.post('/api/cash-register', withCatch(async (req, res) => {
  if (!requireFields(res, req.body, ['register_name', 'action'])) return;
  const action = String(req.body.action || '').toLowerCase();
  if (action === 'open') {
    const openingBalance = Number(req.body.opening_balance || 0);
    const out = await runQuery(
      'INSERT INTO cash_register (register_name, opening_balance, current_balance, status, opened_at) VALUES (?, ?, ?, ?, ?)',
      [req.body.register_name, openingBalance, openingBalance, 'open', nowIso()]
    );
    ok(res, { id: out.id, status: 'open', authoritative_updated_at: nowIso() }, 201);
    return;
  }

  if (action === 'close') {
    const active = await getQuery("SELECT id FROM cash_register WHERE register_name=? AND status='open' ORDER BY opened_at DESC LIMIT 1", [req.body.register_name]);
    if (!active) return fail(res, 404, 'NOT_FOUND', 'No open register found for this name');
    await runQuery("UPDATE cash_register SET status='closed', closed_at=? WHERE id=?", [nowIso(), active.id]);
    ok(res, { id: active.id, status: 'closed', authoritative_updated_at: nowIso() });
    return;
  }

  fail(res, 422, 'VALIDATION_ERROR', 'Action must be open or close');
}));

app.get('/api/simple/:table', withCatch(async (req, res) => {
  const allowed = new Set(['spend_history', 'loan_recoveries', 'defective_items', 'layaway_orders', 'customer_alerts', 'cash_reports', 'account_statements', 'backup_logs', 'supplies', 'daybook_entries', 'company_debts']);
  if (!allowed.has(req.params.table)) return fail(res, 404, 'NOT_FOUND', 'Unknown table');
  ok(res, await allQuery(`SELECT * FROM ${req.params.table} ORDER BY created_at DESC`));
}));
app.post('/api/simple/:table', withCatch(async (req, res) => {
  const allowed = new Set(['spend_history', 'loan_recoveries', 'defective_items', 'layaway_orders', 'customer_alerts', 'cash_reports', 'account_statements', 'backup_logs', 'supplies', 'daybook_entries', 'company_debts']);
  if (!allowed.has(req.params.table)) return fail(res, 404, 'NOT_FOUND', 'Unknown table');
  const m = normalizedMeta(req.body);
  const out = await runQuery(
    `INSERT INTO ${req.params.table} (title, description, amount, status, reference, updated_at, client_updated_at, device_id, sync_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.body.title || '', req.body.description || '', Number(req.body.amount || 0), req.body.status || 'active', req.body.reference || '', nowIso(), m.clientUpdatedAt, m.deviceId, m.syncId]
  );
  ok(res, { id: out.id, authoritative_updated_at: nowIso() }, 201);
}));

app.get('/api/reports/sales', withCatch(async (req, res) => {
  const range = betweenClause(req);
  const report = await getQuery(`SELECT COUNT(*) total_sales, COALESCE(SUM(total_amount), 0) total_revenue FROM sales ${range.where}`, range.params);
  ok(res, report);
}));
app.get('/api/reports/inventory', withCatch(async (req, res) => ok(res, { lowStock: await allQuery('SELECT * FROM products WHERE stock_quantity < min_stock'), outOfStock: await allQuery('SELECT * FROM products WHERE stock_quantity = 0') })));
app.get('/api/reports/profit', withCatch(async (req, res) => {
  const range = betweenClause(req);
  const report = await getQuery(
    `SELECT COALESCE(SUM(si.total_price), 0) total_sales, COALESCE(SUM(si.quantity * p.cost), 0) total_cost, COALESCE(SUM(si.total_price) - SUM(si.quantity * p.cost), 0) profit
     FROM sales_items si JOIN products p ON si.product_id = p.id JOIN sales s ON s.id = si.sale_id ${range.where}`,
    range.params
  );
  ok(res, report);
}));
app.get('/api/dashboard', withCatch(async (req, res) => {
  const totalSales = await getQuery('SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount FROM sales');
  const totalProducts = await getQuery('SELECT COUNT(*) as count FROM products');
  const lowStock = await getQuery('SELECT COUNT(*) as count FROM products WHERE stock_quantity < min_stock');
  const totalCustomers = await getQuery('SELECT COUNT(*) as count FROM customers');
  ok(res, {
    totalSales: totalSales.count || 0,
    totalAmount: totalSales.amount || 0,
    totalProducts: totalProducts.count || 0,
    lowStockItems: lowStock.count || 0,
    totalCustomers: totalCustomers.count || 0
  });
}));

app.post('/api/sync', withCatch(async (req, res) => {
  const accepted = [];
  for (const action of req.body.actions || []) {
    accepted.push({ sync_id: action.sync_id || null, status: 'accepted', authoritative_updated_at: nowIso() });
  }
  ok(res, { accepted });
}));

// Full data export for sync
const SYNC_TABLES = ['products', 'customers', 'sales', 'sales_items', 'purchases', 'purchase_items', 'payments', 'suppliers', 'debts', 'users', 'cash_register', 'inventory_adjustments', 'audit_logs', 'auth_users', 'auth_sessions', 'company_accounts', 'customer_accounts', 'company_account_payments', 'customer_account_payments', 'till_sessions', 'settings'];

app.get('/api/sync/export', authRequired, withCatch(async (req, res) => {
  if (req.auth.role !== 'admin') return fail(res, 403, 'FORBIDDEN', 'Admin required');
  const data = {};
  for (const table of SYNC_TABLES) {
    try { data[table] = await allQuery(`SELECT * FROM ${table}`); } catch (e) { data[table] = []; }
  }
  ok(res, { exported_at: nowIso(), data });
}));

app.post('/api/sync/import', authRequired, withCatch(async (req, res) => {
  if (req.auth.role !== 'admin') return fail(res, 403, 'FORBIDDEN', 'Admin required');
  const { data } = req.body;
  if (!data || typeof data !== 'object') return fail(res, 400, 'INVALID_DATA', 'Expected data object');

  for (const [table, rows] of Object.entries(data)) {
    if (!SYNC_TABLES.includes(table) || !Array.isArray(rows)) continue;
    await runQuery(`DELETE FROM ${table}`);
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(',');
    const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`);
    for (const row of rows) {
      const values = columns.map(col => row[col] ?? null);
      stmt.run(values);
    }
    stmt.finalize();
  }
  ok(res, { imported_at: nowIso() });
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, HOST, () => {
  const appUrl = `http://localhost:${PORT}`;
  console.log(`Server running at ${appUrl}`);
  console.log(`LAN access URL: http://<your-ip>:${PORT}`);
  if (process.env.AUTO_OPEN !== 'false' && process.env.ELECTRON_MODE !== 'true') {
    open(appUrl).catch((error) => console.error('Could not auto-open browser:', error.message));
  }
});
