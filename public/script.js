const API_BASE = `${window.location.origin}/api`;
const APP_MODE = new URLSearchParams(window.location.search).get('appMode') === 'desktop' ? 'desktop' : 'web';

// State management
let allProducts = [];
let allSales = [];
let allCustomers = [];
let allPayments = [];
let saleItemsCount = 0;
let purchaseItemsCount = 0;
let serverConnected = false;
const DEVICE_ID_KEY = 'pharma_device_id';
const QUEUE_DB = 'pharma-offline';
const QUEUE_STORE = 'actions';
const SYNC_INTERVAL_MS = 20000;
let syncInProgress = false;

const simpleModules = {
    'spend-history': { table: 'spend_history', title: 'Spend History' },
    'loan-recovery': { table: 'loan_recoveries', title: 'Loan Recovery' },
    'defective-items': { table: 'defective_items', title: 'Defective Items' },
    'company-debt': { table: 'company_debts', title: 'Company Debt' },
    'purchase-receipts': { table: 'account_statements', title: 'Purchase Receipts' },
    'layaway-dashboard': { table: 'layaway_orders', title: 'Layaway Dashboard' },
    'customer-alert': { table: 'customer_alerts', title: 'Customer Alert' },
    'cash-report': { table: 'cash_reports', title: 'Cash Report' },
    'purchase-account-statement': { table: 'account_statements', title: 'Purchase Account Statement' },
    'customer-account-statement': { table: 'account_statements', title: 'Customer Account Statement' },
    'cash-account-statement': { table: 'account_statements', title: 'Cash Account Statement' },
    'supplies': { table: 'supplies', title: 'Supplies' },
    'daybook': { table: 'daybook_entries', title: 'Daybook' },
    'data-backup': { table: 'backup_logs', title: 'Data Backup Log' }
};

function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
}

function withSyncMeta(payload = {}) {
    return {
        ...payload,
        client_updated_at: payload.client_updated_at || new Date().toISOString(),
        device_id: getDeviceId(),
        sync_id: payload.sync_id || `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        auth_user_id: window.authSession?.user?.id || null
    };
}

function openQueueDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(QUEUE_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(QUEUE_STORE)) {
                db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function enqueueAction(action) {
    const normalized = withSyncMeta(action.body || {});
    const db = await openQueueDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(QUEUE_STORE, 'readwrite');
        tx.objectStore(QUEUE_STORE).add({
            path: action.path,
            method: action.method,
            body: normalized,
            retries: action.retries || 0,
            queued_at: new Date().toISOString(),
            last_error: action.last_error || null
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function readQueue() {
    const db = await openQueueDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(QUEUE_STORE, 'readonly');
        const req = tx.objectStore(QUEUE_STORE).getAll();
        req.onsuccess = () => {
            const actions = req.result || [];
            actions.sort((a, b) => new Date(a.queued_at).getTime() - new Date(b.queued_at).getTime());
            resolve(actions);
        };
        req.onerror = () => reject(req.error);
    });
}

async function clearQueueItem(id) {
    const db = await openQueueDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(QUEUE_STORE, 'readwrite');
        tx.objectStore(QUEUE_STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function syncQueuedActions() {
    if (!navigator.onLine || syncInProgress) return;
    syncInProgress = true;
    const queued = await readQueue();
    let syncedCount = 0;
    try {
        for (const item of queued) {
            try {
                const res = await fetch(`${API_BASE}${item.path}`, {
                    method: item.method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item.body)
                });

                if (res.ok || res.status === 409) {
                    await clearQueueItem(item.id);
                    syncedCount += 1;
                    continue;
                }

                // Validation/auth issues should not be retried forever.
                if (res.status === 401 || res.status === 403) {
                    await clearQueueItem(item.id);
                    continue;
                }
                if (res.status >= 400 && res.status < 500) {
                    await clearQueueItem(item.id);
                    continue;
                }

                break;
            } catch (error) {
                break;
            }
        }
    } finally {
        syncInProgress = false;
    }

    if (syncedCount > 0) {
        showNotification(`${syncedCount} queued change(s) synced.`, 'success');
        loadInitialData().catch(() => {});
    }
}

async function getQueueSize() {
    try {
        const queued = await readQueue();
        return queued.length;
    } catch (error) {
        return 0;
    }
}

async function refreshSyncHint() {
    const pending = await getQueueSize();
    if (pending > 0 && !navigator.onLine) {
        showNotification(`${pending} change(s) waiting for sync.`, 'error');
    }
}

function buildApiError(payload, fallback = 'Request failed') {
    const message = payload?.error?.message || fallback;
    const err = new Error(message);
    err.code = payload?.error?.code || 'REQUEST_FAILED';
    return err;
}

function isLikelyNetworkError(error) {
    return error?.name === 'AbortError' || error instanceof TypeError;
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

async function requestAndParse(path, options = {}) {
    options.headers = window.getAuthHeaders ? window.getAuthHeaders(options.headers || {}) : (options.headers || {});
    const response = await fetch(`${API_BASE}${path}`, options);
    const payload = await safeJson(response);
    if (!response.ok) throw buildApiError(payload);
    return payload?.data ?? payload;
}

async function queueOfflineAction(path, method, body) {
    const queueBody = withSyncMeta(body);
    await enqueueAction({ path, method, body: queueBody });
    const pending = await getQueueSize();
    showNotification(`Saved offline. ${pending} queued change(s).`, 'success');
    return {
        queued: true,
        pending,
        sync_id: queueBody.sync_id
    };
}

function parseRequestBody(options = {}) {
    if (!options.body) return null;
    if (typeof options.body === 'string') {
        try {
            return JSON.parse(options.body);
        } catch (error) {
            return null;
        }
    }
    return options.body;
}

async function apiRequest(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = parseRequestBody(options);

    if (method !== 'GET' && body) {
        const bodyWithMeta = withSyncMeta(body);
        options.body = JSON.stringify(bodyWithMeta);
    }

    try {
        return await requestAndParse(path, options);
    } catch (error) {
        if (method !== 'GET' && body && isLikelyNetworkError(error)) {
            return queueOfflineAction(path, method, body);
        }
        throw error;
    }
}

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

// Check server connection
async function checkServerConnection() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${API_BASE}/dashboard`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
            serverConnected = true;
            console.log('✓ Server connected');
            return true;
        }
    } catch (error) {
        serverConnected = false;
        console.error('✗ Server connection failed:', error.message);
            showNotification('Running in offline mode. Changes will queue.', 'error');
        return false;
    }
}

// Update clock
function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString();
    const date = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    const timeEl = document.getElementById('time');
    const dateEl = document.getElementById('date');
    if (timeEl) timeEl.textContent = time;
    if (dateEl) dateEl.textContent = `DATE: ${date}`;
}

setInterval(updateClock, 1000);
updateClock();

// Load initial data
async function loadInitialData() {
    try {
        // Check server first
        if (!serverConnected) {
            const isConnected = await checkServerConnection();
            if (!isConnected) return;
        }

        const [products, sales, customers, payments, dashboard] = await Promise.all([
            apiRequest('/products').catch(() => []),
            apiRequest('/sales').catch(() => []),
            apiRequest('/customers').catch(() => []),
            apiRequest('/payments').catch(() => []),
            apiRequest('/dashboard').catch(() => ({}))
        ]);

        allProducts = Array.isArray(products) ? products : [];
        allSales = Array.isArray(sales) ? sales : [];
        allCustomers = Array.isArray(customers) ? customers : [];
        allPayments = Array.isArray(payments) ? payments : [];

        // Update dashboard stats with safety checks
        const statSales = document.getElementById('stat-sales');
        const statRevenue = document.getElementById('stat-revenue');
        const statProducts = document.getElementById('stat-products');
        const statLowstock = document.getElementById('stat-lowstock');

        if (statSales) statSales.textContent = dashboard.totalSales || 0;
        if (statRevenue) statRevenue.textContent = '$' + ((dashboard.totalAmount || 0).toFixed(2));
        if (statProducts) statProducts.textContent = dashboard.totalProducts || 0;
        if (statLowstock) statLowstock.textContent = dashboard.lowStockItems || 0;

        console.log('✓ Data loaded successfully');
    } catch (error) {
        console.error('Error loading initial data:', error);
        showNotification('Error loading data: ' + error.message, 'error');
    }
}

// Open module
function openModule(moduleName) {
    const modulesContainer = document.getElementById('modules');
    const module = document.getElementById(moduleName);
    
    if (module) {
        // Close any open module
        document.querySelectorAll('.module.active').forEach(m => m.classList.remove('active'));
        
        module.classList.add('active');
        modulesContainer.classList.add('active');
        closeSidebar();
        
        // Load module-specific data
        loadModuleData(moduleName);
    }
}

// Close module
function closeModule() {
    document.querySelectorAll('.module.active').forEach(m => m.classList.remove('active'));
    document.getElementById('modules').classList.remove('active');
}

// Load module data
async function loadModuleData(moduleName) {
    try {
        switch(moduleName) {
            case 'item-pricing':
                loadPricingTable();
                break;
            case 'barcode-creation':
                loadBarcodeHistory();
                break;
            case 'inventory-items':
                loadInventoryTable();
                break;
            case 'product-list':
                loadProductsTable();
                break;
            case 'register-payments':
                loadPaymentsTable();
                break;
            case 'sales-receipts':
                loadReceiptsTable();
                break;
            case 'debtor-list':
                loadDebtorList();
                break;
            case 'low-stock-alert':
                loadLowStockAlert();
                break;
            case 'profit-report':
                loadProfitReport();
                break;
            case 'customer-dashboard':
                loadCustomersTable();
                break;
            case 'purchase-table':
                loadPurchasesTable();
                break;
            case 'company-debt':
                loadCompanyDebtAccounts();
                break;
            case 'sales-table':
                loadSalesTableView();
                break;
            case 'till-register':
                loadTillHistory();
                break;
            case 'system-user':
                loadUsersTable();
                break;
            case 'purchase-account-statement':
                loadCompanyAccounts();
                break;
            case 'customer-account-statement':
                loadCustomerAccounts();
                break;
            case 'cash-account-statement':
                loadCashStatement();
                break;
            default:
                if (simpleModules[moduleName]) {
                    await loadSimpleModule(moduleName);
                }
        }
    } catch (error) {
        console.error('Error loading module data:', error);
    }
}

// ============ PRODUCT FUNCTIONS ============

async function addProduct(event) {
    event.preventDefault();
    
    const product = {
        name: document.getElementById('productName').value,
        sku: document.getElementById('productSKU').value,
        barcode: document.getElementById('productBarcode').value,
        category: document.getElementById('productCategory').value,
        cost: parseFloat(document.getElementById('productCost').value),
        price: parseFloat(document.getElementById('productPrice').value),
        stock_quantity: parseInt(document.getElementById('productStock').value) || 0,
        min_stock: parseInt(document.getElementById('productMinStock').value) || 10,
        description: document.getElementById('productDesc').value
    };

    try {
        const response = await apiRequest('/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withSyncMeta(product))
        });
        if (response) {
            showNotification('Product added successfully!', 'success');
            document.getElementById('addProductForm').reset();
            allProducts.push(product);
        } else {
            showNotification('Error adding product', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error: ' + error.message, 'error');
    }
}

function loadProductsTable() {
    const tbody = document.getElementById('productsBody');
    tbody.innerHTML = '';

    allProducts.forEach(product => {
        const row = document.createElement('tr');
        const status = product.stock_quantity <= 0 ? 'Out of Stock' : product.stock_quantity < product.min_stock ? 'Low Stock' : 'In Stock';
        const statusColor = product.stock_quantity <= 0 ? '#dc2626' : product.stock_quantity < product.min_stock ? '#f97316' : '#22c55e';

        row.innerHTML = `
            <td>${product.name}</td>
            <td>${product.sku}</td>
            <td>$${toNumber(product.price).toFixed(2)}</td>
            <td>${product.stock_quantity}</td>
            <td>${product.category || 'N/A'}</td>
            <td><span style="color: ${statusColor}; font-weight: bold;">${status}</span></td>
        `;
        tbody.appendChild(row);
    });
}

function searchProducts() {
    const searchTerm = document.getElementById('searchProducts').value.toLowerCase();
    const tbody = document.getElementById('productsBody');
    tbody.innerHTML = '';

    allProducts.filter(p => 
        p.name.toLowerCase().includes(searchTerm) || 
        p.sku.toLowerCase().includes(searchTerm)
    ).forEach(product => {
        const row = document.createElement('tr');
        const status = product.stock_quantity <= 0 ? 'Out of Stock' : product.stock_quantity < product.min_stock ? 'Low Stock' : 'In Stock';
        
        row.innerHTML = `
            <td>${product.name}</td>
            <td>${product.sku}</td>
            <td>$${toNumber(product.price).toFixed(2)}</td>
            <td>${product.stock_quantity}</td>
            <td>${product.category || 'N/A'}</td>
            <td>${status}</td>
        `;
        tbody.appendChild(row);
    });
}

function loadPricingTable() {
    const tbody = document.getElementById('pricingBody');
    tbody.innerHTML = '';

    allProducts.forEach(product => {
        const cost = toNumber(product.cost);
        const price = toNumber(product.price);
        const margin = cost ? ((price - cost) / cost * 100) : 0;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${product.name}</td>
            <td>${product.sku}</td>
            <td>$${cost.toFixed(2)}</td>
            <td>$${price.toFixed(2)}</td>
            <td>${margin.toFixed(1)}%</td>
            <td><button class="btn-secondary" onclick="editPrice(${product.id})">Edit</button></td>
        `;
        tbody.appendChild(row);
    });
}

function searchPricing() {
    const searchTerm = document.getElementById('searchPrice').value.toLowerCase();
    const tbody = document.getElementById('pricingBody');
    tbody.innerHTML = '';

    allProducts.filter(p => 
        p.name.toLowerCase().includes(searchTerm)
    ).forEach(product => {
        const cost = toNumber(product.cost);
        const price = toNumber(product.price);
        const margin = cost ? ((price - cost) / cost * 100) : 0;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${product.name}</td>
            <td>${product.sku}</td>
            <td>$${cost.toFixed(2)}</td>
            <td>$${price.toFixed(2)}</td>
            <td>${margin.toFixed(1)}%</td>
            <td><button class="btn-secondary">Edit</button></td>
        `;
        tbody.appendChild(row);
    });
}

function loadInventoryTable() {
    const tbody = document.getElementById('inventoryBody');
    tbody.innerHTML = '';

    allProducts.forEach(product => {
        const status = product.stock_quantity <= 0 ? 'Out of Stock' : product.stock_quantity < product.min_stock ? 'Low Stock' : 'In Stock';
        const statusColor = product.stock_quantity <= 0 ? '#dc2626' : product.stock_quantity < product.min_stock ? '#f97316' : '#22c55e';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${product.name}</td>
            <td>${product.sku}</td>
            <td>${product.stock_quantity}</td>
            <td>${product.min_stock}</td>
            <td><span style="color: ${statusColor}; font-weight: bold;">${status}</span></td>
        `;
        tbody.appendChild(row);
    });
}

function searchInventory() {
    const searchTerm = document.getElementById('searchInventory').value.toLowerCase();
    const tbody = document.getElementById('inventoryBody');
    tbody.innerHTML = '';

    allProducts.filter(p => 
        p.name.toLowerCase().includes(searchTerm)
    ).forEach(product => {
        const status = product.stock_quantity <= 0 ? 'Out of Stock' : product.stock_quantity < product.min_stock ? 'Low Stock' : 'In Stock';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${product.name}</td>
            <td>${product.sku}</td>
            <td>${product.stock_quantity}</td>
            <td>${product.min_stock}</td>
            <td>${status}</td>
        `;
        tbody.appendChild(row);
    });
}

function loadLowStockAlert() {
    const tbody = document.getElementById('lowStockBody');
    tbody.innerHTML = '';

    allProducts.filter(p => p.stock_quantity < p.min_stock).forEach(product => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${product.name}</td>
            <td style="color: #dc2626; font-weight: bold;">${product.stock_quantity}</td>
            <td>${product.min_stock}</td>
            <td>Reorder Now</td>
        `;
        tbody.appendChild(row);
    });
}

// ============ SALES FUNCTIONS ============

function addSaleItem() {
    saleItemsCount++;
    const container = document.getElementById('saleItems');
    const itemDiv = document.createElement('div');
    itemDiv.className = 'form-group';
    itemDiv.id = `saleItem${saleItemsCount}`;
    itemDiv.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 0.7fr 0.5fr; gap: 10px;">
            <input type="text" placeholder="Barcode (manual/scan)" class="sale-barcode" data-item="${saleItemsCount}" oninput="applySaleBarcode(${saleItemsCount}, this.value)">
            <button type="button" class="btn-secondary" onclick="scanBarcodeToInput('.sale-barcode[data-item=&quot;${saleItemsCount}&quot;]')">Scan</button>
            <select onchange="updateSaleItemPrice(${saleItemsCount})" class="product-select" data-item="${saleItemsCount}">
                <option>Select Product</option>
                ${allProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
            <input type="number" placeholder="Quantity" class="quantity-input" data-item="${saleItemsCount}" value="1">
            <input type="number" placeholder="Unit Price" class="price-input" data-item="${saleItemsCount}" step="0.01">
            <button type="button" onclick="removeSaleItem(${saleItemsCount})" class="btn-secondary" style="padding: 10px;">Remove</button>
        </div>
    `;
    container.appendChild(itemDiv);
}

function removeSaleItem(itemNum) {
    const item = document.getElementById(`saleItem${itemNum}`);
    if (item) item.remove();
}

function updateSaleItemPrice(itemNum) {
    const select = document.querySelector(`.product-select[data-item="${itemNum}"]`);
    const product = allProducts.find(p => p.id == select.value);
    if (product) {
        document.querySelector(`.price-input[data-item="${itemNum}"]`).value = product.price.toFixed(2);
    }
}

function applySaleBarcode(itemNum, code) {
    const normalized = String(code || '').trim();
    if (!normalized) return;
    const product = allProducts.find(p => String(p.barcode || '') === normalized || String(p.sku || '') === normalized);
    if (!product) return;
    const select = document.querySelector(`.product-select[data-item="${itemNum}"]`);
    select.value = product.id;
    updateSaleItemPrice(itemNum);
}

async function recordSale(event) {
    event.preventDefault();

    const items = [];
    let totalAmount = 0;

    document.querySelectorAll('#saleItems > div').forEach(itemDiv => {
        const inputs = itemDiv.querySelectorAll('input, select');
        if (inputs[0].value) {
            const qty = parseInt(inputs[1].value) || 0;
            const price = parseFloat(inputs[2].value) || 0;
            items.push({
                product_id: inputs[0].value,
                quantity: qty,
                unit_price: price,
                total_price: qty * price
            });
            totalAmount += qty * price;
        }
    });

    if (items.length === 0) {
        showNotification('Add at least one item', 'error');
        return;
    }

    const sale = {
        receipt_no: document.getElementById('receiptNo').value,
        customer_name: document.getElementById('saleCustomer').value || 'Walk-in Customer',
        payment_method: document.getElementById('salePaymentMethod').value,
        items: items,
        total_amount: totalAmount
    };

    try {
        const response = await apiRequest('/sales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withSyncMeta(sale))
        });
        if (response) {
            showNotification('Sale recorded successfully!', 'success');
            document.getElementById('saleForm').reset();
            document.getElementById('saleItems').innerHTML = '';
            saleItemsCount = 0;
            loadInitialData();
        } else {
            showNotification('Error recording sale', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error: ' + error.message, 'error');
    }
}

function loadReceiptsTable() {
    const tbody = document.getElementById('receiptsBody');
    tbody.innerHTML = '';

    allSales.forEach(sale => {
        const date = new Date(sale.created_at).toLocaleDateString();
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${sale.receipt_no}</td>
            <td>${date}</td>
            <td>$${toNumber(sale.total_amount).toFixed(2)}</td>
            <td>${sale.payment_method}</td>
            <td>${sale.customer_name}</td>
        `;
        tbody.appendChild(row);
    });
}

function loadSalesTableView() {
    const tbody = document.getElementById('salesTableBody');
    tbody.innerHTML = '';

    allSales.forEach(sale => {
        const date = new Date(sale.created_at).toLocaleDateString();
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${sale.receipt_no}</td>
            <td>${date}</td>
            <td>${sale.customer_name}</td>
            <td>$${toNumber(sale.total_amount).toFixed(2)}</td>
            <td>${sale.payment_method}</td>
        `;
        tbody.appendChild(row);
    });
}

// ============ CUSTOMER FUNCTIONS ============

async function addCustomer(event) {
    event.preventDefault();

    const customer = {
        name: document.getElementById('customerName').value,
        phone: document.getElementById('customerPhone').value,
        email: document.getElementById('customerEmail').value,
        address: document.getElementById('customerAddress').value,
        credit_limit: parseFloat(document.getElementById('creditLimit').value) || 0
    };

    try {
        const response = await apiRequest('/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withSyncMeta(customer))
        });
        if (response) {
            showNotification('Customer added successfully!', 'success');
            document.getElementById('customerForm').reset();
            loadInitialData();
        } else {
            showNotification('Error adding customer', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error: ' + error.message, 'error');
    }
}

function loadCustomersTable() {
    const tbody = document.getElementById('customersBody');
    tbody.innerHTML = '';

    allCustomers.forEach(customer => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${customer.name}</td>
            <td>${customer.phone || 'N/A'}</td>
            <td>${customer.email || 'N/A'}</td>
            <td>$${toNumber(customer.credit_limit).toFixed(2)}</td>
            <td>$${toNumber(customer.current_balance).toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });
}

// ============ PAYMENT FUNCTIONS ============

async function recordPayment(event) {
    event.preventDefault();

    const payment = {
        amount: parseFloat(document.getElementById('paymentAmount').value),
        payment_method: document.getElementById('paymentMethod').value,
        reference: document.getElementById('paymentRef').value
    };

    try {
        const response = await apiRequest('/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withSyncMeta(payment))
        });
        if (response) {
            showNotification('Payment recorded successfully!', 'success');
            document.getElementById('paymentForm').reset();
            loadPaymentsTable();
        } else {
            showNotification('Error recording payment', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error: ' + error.message, 'error');
    }
}

function loadPaymentsTable() {
    const tbody = document.getElementById('paymentsBody');
    tbody.innerHTML = '';

    allPayments.forEach(payment => {
        const date = new Date(payment.created_at).toLocaleDateString();
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${date}</td>
            <td>$${toNumber(payment.amount).toFixed(2)}</td>
            <td>${payment.payment_method}</td>
            <td>${payment.reference || 'N/A'}</td>
        `;
        tbody.appendChild(row);
    });
}

// ============ DEBT FUNCTIONS ============

async function loadDebtorList() {
    try {
        const debts = await apiRequest('/debts');
        
        const tbody = document.getElementById('debtorBody');
        tbody.innerHTML = '';

        debts.forEach(debt => {
            const date = new Date(debt.due_date).toLocaleDateString();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${debt.name}</td>
                <td>$${toNumber(debt.amount).toFixed(2)}</td>
                <td>${date}</td>
                <td><span style="color: #dc2626; font-weight: bold;">${debt.status}</span></td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============ PROFIT REPORT ============

async function loadProfitReport() {
    try {
        const report = await apiRequest('/reports/profit');

        const totalSales = report.total_sales || 0;
        const totalCost = report.total_cost || 0;
        const profit = report.profit || 0;
        const margin = totalSales > 0 ? (profit / totalSales * 100) : 0;

        document.getElementById('reportTotalSales').textContent = '$' + totalSales.toFixed(2);
        document.getElementById('reportTotalCost').textContent = '$' + totalCost.toFixed(2);
        document.getElementById('reportTotalProfit').textContent = '$' + profit.toFixed(2);
        document.getElementById('reportMargin').textContent = margin.toFixed(1) + '%';
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============ PURCHASE FUNCTIONS ============

function addPurchaseItem() {
    purchaseItemsCount++;
    const container = document.getElementById('purchaseItems');
    const itemDiv = document.createElement('div');
    itemDiv.className = 'form-group';
    itemDiv.id = `purchaseItem${purchaseItemsCount}`;
    itemDiv.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 0.7fr 0.5fr; gap: 10px;">
            <input type="text" placeholder="Barcode (manual/scan)" class="purchase-barcode" data-item="${purchaseItemsCount}" oninput="applyPurchaseBarcode(${purchaseItemsCount}, this.value)">
            <button type="button" class="btn-secondary" onclick="scanBarcodeToInput('.purchase-barcode[data-item=&quot;${purchaseItemsCount}&quot;]')">Scan</button>
            <select onchange="updatePurchaseItemPrice(${purchaseItemsCount})" class="product-select-purchase" data-item="${purchaseItemsCount}">
                <option>Select Product</option>
                ${allProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
            <input type="number" placeholder="Quantity" class="quantity-input-purchase" data-item="${purchaseItemsCount}" value="1">
            <input type="number" placeholder="Unit Cost" class="cost-input-purchase" data-item="${purchaseItemsCount}" step="0.01">
            <button type="button" onclick="removePurchaseItem(${purchaseItemsCount})" class="btn-secondary" style="padding: 10px;">Remove</button>
        </div>
    `;
    container.appendChild(itemDiv);
}

function removePurchaseItem(itemNum) {
    const item = document.getElementById(`purchaseItem${itemNum}`);
    if (item) item.remove();
}

function updatePurchaseItemPrice(itemNum) {
    const select = document.querySelector(`.product-select-purchase[data-item="${itemNum}"]`);
    const product = allProducts.find(p => p.id == select.value);
    if (product) {
        document.querySelector(`.cost-input-purchase[data-item="${itemNum}"]`).value = product.cost.toFixed(2);
    }
}

function applyPurchaseBarcode(itemNum, code) {
    const normalized = String(code || '').trim();
    if (!normalized) return;
    const product = allProducts.find(p => String(p.barcode || '') === normalized || String(p.sku || '') === normalized);
    if (!product) return;
    const select = document.querySelector(`.product-select-purchase[data-item="${itemNum}"]`);
    select.value = product.id;
    updatePurchaseItemPrice(itemNum);
}

async function recordPurchase(event) {
    event.preventDefault();

    const items = [];
    let totalAmount = 0;

    document.querySelectorAll('#purchaseItems > div').forEach(itemDiv => {
        const inputs = itemDiv.querySelectorAll('input, select');
        if (inputs[0].value) {
            const qty = parseInt(inputs[1].value) || 0;
            const cost = parseFloat(inputs[2].value) || 0;
            items.push({
                product_id: inputs[0].value,
                quantity: qty,
                unit_cost: cost,
                total_cost: qty * cost
            });
            totalAmount += qty * cost;
        }
    });

    if (items.length === 0) {
        showNotification('Add at least one item', 'error');
        return;
    }

    const purchase = {
        purchase_no: document.getElementById('purchaseNo').value,
        vendor_name: document.getElementById('vendorName').value,
        items: items,
        total_amount: totalAmount
    };

    try {
        const response = await apiRequest('/purchases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withSyncMeta(purchase))
        });
        if (response) {
            showNotification('Purchase recorded successfully!', 'success');
            document.getElementById('purchaseForm').reset();
            document.getElementById('purchaseItems').innerHTML = '';
            purchaseItemsCount = 0;
            loadInitialData();
        } else {
            showNotification('Error recording purchase', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error: ' + error.message, 'error');
    }
}

async function loadPurchasesTable() {
    try {
        const purchases = await apiRequest('/purchases');
        
        const tbody = document.getElementById('purchaseTableBody');
        tbody.innerHTML = '';

        purchases.forEach(purchase => {
            const date = new Date(purchase.created_at).toLocaleDateString();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${purchase.purchase_no}</td>
                <td>${date}</td>
                <td>${purchase.vendor_name}</td>
                <td>$${toNumber(purchase.total_amount).toFixed(2)}</td>
                <td><span style="color: #22c55e; font-weight: bold;">${purchase.status}</span></td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============ BARCODE GENERATION ============

async function generateBarcode(event) {
    event.preventDefault();
    
    const name = document.getElementById('barcodeName').value;
    const sku = document.getElementById('barcodeSKU').value;
    const value = document.getElementById('barcodeValue').value;
    
    const output = document.getElementById('barcodeOutput');
    output.innerHTML = `
        <div style="margin-top: 20px; padding: 20px; background-color: #f9f9f9; border-radius: 8px; text-align: center;">
            <p><strong>Product:</strong> ${name}</p>
            <p><strong>SKU:</strong> ${sku}</p>
            <div style="font-size: 48px; letter-spacing: 5px; font-weight: bold; margin: 20px 0; font-family: 'Courier New';">
                ${value}
            </div>
            <p style="font-size: 12px; color: #666;">Barcode: ${value}</p>
            <button class="btn-primary" onclick="printBarcode()">Print Barcode</button>
        </div>
    `;
    
    try {
        await apiRequest('/barcodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_name: name,
                sku,
                barcode_value: value
            })
        });
        await loadBarcodeHistory();
        showNotification('Barcode generated successfully!', 'success');
        document.getElementById('barcodeForm').reset();
    } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
    }
}

function printBarcode() {
    window.print();
}

async function scanBarcodeToInput(selector) {
    const input = document.querySelector(selector);
    if (!input) return;
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
        const manual = prompt('Camera scanner not available. Enter barcode manually:');
        if (manual) {
            input.value = manual;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'qr_code', 'upc_a'] });
    const started = Date.now();
    let value = '';
    while (!value && Date.now() - started < 10000) {
        const codes = await detector.detect(video).catch(() => []);
        if (codes.length > 0) value = codes[0].rawValue || '';
    }
    stream.getTracks().forEach((t) => t.stop());
    if (value) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        showNotification('Barcode scanned.', 'success');
    } else {
        showNotification('No barcode detected. Try manual input.', 'error');
    }
}

// ============ TILL MANAGEMENT ============

async function manageTill(event) {
    event.preventDefault();

    const action = document.getElementById('tillAction').value;
    const registerName = document.getElementById('registerName').value;
    const openingBalance = parseFloat(document.getElementById('openingBalance').value || '0');

    const statusDiv = document.getElementById('tillStatus');
    
    try {
        const actionValue = action === 'Open Register' ? 'open' : 'close';
        const response = await apiRequest('/cash-register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                register_name: registerName,
                action: actionValue,
                opening_balance: openingBalance
            })
        });

        if (response?.status === 'open') {
            statusDiv.innerHTML = `
                <div style="background-color: #d1fae5; padding: 15px; border-radius: 8px; border-left: 4px solid #10b981;">
                    <h3 style="color: #065f46; margin-bottom: 10px;">Register Opened ✓</h3>
                    <p><strong>Register Name:</strong> ${registerName}</p>
                    <p><strong>Opening Balance:</strong> $${openingBalance.toFixed(2)}</p>
                    <p><strong>Status:</strong> <span style="color: #10b981; font-weight: bold;">ACTIVE</span></p>
                </div>
            `;
            showNotification('Register opened successfully!', 'success');
        } else {
            statusDiv.innerHTML = `
                <div style="background-color: #fee2e2; padding: 15px; border-radius: 8px; border-left: 4px solid #ef4444;">
                    <h3 style="color: #991b1b; margin-bottom: 10px;">Register Closed ✓</h3>
                    <p><strong>Register Name:</strong> ${registerName}</p>
                    <p><strong>Status:</strong> <span style="color: #dc2626; font-weight: bold;">CLOSED</span></p>
                </div>
            `;
            showNotification('Register closed successfully!', 'success');
        }
        await loadTillHistory();
    } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
    }
}

// ============ SETTINGS ============

function saveSettings() {
    const businessName = document.getElementById('businessName').value;
    const currency = document.getElementById('currencySelect').value;
    const taxRate = document.getElementById('taxRate').value;

    localStorage.setItem('businessName', businessName);
    localStorage.setItem('currency', currency);
    localStorage.setItem('taxRate', taxRate);

    showNotification('Settings saved successfully!', 'success');
}

// ============ BACKUP & EXPORT ============

function backupDatabase() {
    createSimpleRecord('data-backup', { title: 'Manual backup', description: 'Database backup initiated by user', status: 'completed', amount: 0 })
        .then(() => showNotification('Backup log created.', 'success'))
        .catch((err) => showNotification(err.message, 'error'));
}

function restoreBackup() {
    showNotification('Restore can be wired to import workflow.', 'success');
}

function exportToCSV() {
    window.open(`${API_BASE}/sales`, '_blank');
    showNotification('Raw sales JSON opened (CSV mapping can be added).', 'success');
}

function exportToExcel() {
    window.open(`${API_BASE}/purchases`, '_blank');
    showNotification('Raw purchases JSON opened (Excel mapping can be added).', 'success');
}

// ============ USER MANAGEMENT ============

async function addUser(event) {
    event.preventDefault();

    const user = {
        username: document.getElementById('username').value,
        email: document.getElementById('useremail').value,
        role: document.getElementById('userRole').value
    };

    try {
        const response = await apiRequest('/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        if (response) {
            showNotification('User added successfully!', 'success');
            document.getElementById('userForm').reset();
            await loadUsersTable();
        } else {
            showNotification('Error adding user', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error: ' + error.message, 'error');
    }
}

async function loadBarcodeHistory() {
    const tbody = document.getElementById('barcodeBody');
    if (!tbody) return;
    try {
        const rows = await apiRequest('/barcodes');
        tbody.innerHTML = '';
        rows.forEach((row) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(row.created_at).toLocaleDateString()}</td>
                <td>${row.product_name}</td>
                <td>${row.sku || '-'}</td>
                <td>${row.barcode_value}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error loading barcode history:', error);
    }
}

async function loadTillHistory() {
    const tbody = document.getElementById('tillHistoryBody');
    if (!tbody) return;
    try {
        const rows = await apiRequest('/cash-register');
        tbody.innerHTML = '';
        rows.forEach((row) => {
            const action = row.status === 'open' ? 'Open' : 'Close';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(row.opened_at || row.closed_at || row.created_at).toLocaleDateString()}</td>
                <td>${row.register_name}</td>
                <td>${action}</td>
                <td>$${toNumber(row.opening_balance).toFixed(2)}</td>
                <td>${row.status}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error loading till history:', error);
    }
}

async function loadUsersTable() {
    const tbody = document.getElementById('usersBody');
    if (!tbody) return;
    try {
        const users = await apiRequest('/users');
        tbody.innerHTML = '';
        users.forEach((user) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td>${user.role}</td>
                <td>Active</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

async function loadCompanyAccounts() {
    const select = document.getElementById('companyStatementAccount');
    if (!select) return;
    const accounts = await apiRequest('/company-accounts').catch(() => []);
    select.innerHTML = '<option value="">Select company account</option>';
    accounts.forEach((acc) => {
        select.innerHTML += `<option value="${acc.id}">${acc.name} (Bal: $${toNumber(acc.current_balance).toFixed(2)})</option>`;
    });
}

async function loadCompanyDebtAccounts() {
    const select = document.getElementById('companyDebtAccount');
    if (!select) return;
    const accounts = await apiRequest('/company-accounts').catch(() => []);
    select.innerHTML = '<option value="">Select company account</option>';
    accounts.forEach((acc) => {
        select.innerHTML += `<option value="${acc.id}">${acc.name} (Bal: $${toNumber(acc.current_balance).toFixed(2)})</option>`;
    });
}

async function submitCompanyPayment() {
    const accountId = document.getElementById('companyDebtAccount')?.value;
    if (!accountId) return showNotification('Select a company account.', 'error');
    const amount = Number(document.getElementById('companyDebtAmount')?.value || 0);
    const note = document.getElementById('companyDebtNote')?.value || '';
    if (amount <= 0) return showNotification('Enter a valid amount.', 'error');
    await apiRequest(`/company-accounts/${accountId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, note })
    });
    showNotification('Supplier payment recorded.', 'success');
    loadCompanyDebtAccounts();
}

async function loadCompanyStatement() {
    const accountId = document.getElementById('companyStatementAccount')?.value;
    if (!accountId) return;
    const from = document.getElementById('companyStatementFrom')?.value;
    const to = document.getElementById('companyStatementTo')?.value;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const data = await apiRequest(`/company-accounts/${accountId}/statement?${params.toString()}`).catch(() => ({ entries: [] }));
    const tbody = document.getElementById('companyStatementBody');
    tbody.innerHTML = '';
    (data.entries || []).forEach((entry) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${new Date(entry.created_at).toLocaleDateString()}</td><td>${entry.entry_type}</td><td>$${toNumber(entry.amount).toFixed(2)}</td><td>${entry.note || '-'}</td>`;
        tbody.appendChild(tr);
    });
}

async function loadCustomerAccounts() {
    const select = document.getElementById('customerStatementAccount');
    if (!select) return;
    const accounts = await apiRequest('/customer-accounts').catch(() => []);
    select.innerHTML = '<option value="">Select customer account</option>';
    accounts.forEach((acc) => {
        select.innerHTML += `<option value="${acc.id}">${acc.customer_name} (Bal: $${toNumber(acc.current_balance).toFixed(2)})</option>`;
    });
}

async function loadCustomerStatement() {
    const accountId = document.getElementById('customerStatementAccount')?.value;
    if (!accountId) return;
    const from = document.getElementById('customerStatementFrom')?.value;
    const to = document.getElementById('customerStatementTo')?.value;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const data = await apiRequest(`/customer-accounts/${accountId}/statement?${params.toString()}`).catch(() => ({ entries: [] }));
    const tbody = document.getElementById('customerStatementBody');
    tbody.innerHTML = '';
    (data.entries || []).forEach((entry) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${new Date(entry.created_at).toLocaleDateString()}</td><td>${entry.entry_type}</td><td>$${toNumber(entry.amount).toFixed(2)}</td><td>${entry.note || '-'}</td>`;
        tbody.appendChild(tr);
    });
}

async function loadCashStatement() {
    const tbody = document.getElementById('cashStatementBody');
    if (!tbody) return;
    const payments = await apiRequest('/payments').catch(() => []);
    tbody.innerHTML = '';
    payments.forEach((payment) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${new Date(payment.created_at).toLocaleDateString()}</td><td>${payment.payment_method}</td><td>$${toNumber(payment.amount).toFixed(2)}</td><td>${payment.reference || '-'}</td>`;
        tbody.appendChild(tr);
    });
}

// ============ UTILITY FUNCTIONS ============

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = type;
    notification.textContent = message;
    notification.style.position = 'fixed';
    notification.style.top = '140px';
    notification.style.right = '20px';
    notification.style.zIndex = '2000';
    notification.style.animation = 'slideInUp 0.4s ease';
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideInUp 0.4s ease reverse';
        setTimeout(() => notification.remove(), 400);
    }, 3000);
}

function showDashboard() {
    document.getElementById('modules').classList.remove('active');
    document.querySelectorAll('.module.active').forEach(m => m.classList.remove('active'));
    closeSidebar();
    loadInitialData();
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('active');
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebar?.classList.remove('active');
}

function applyRuntimeMode() {
    document.body.dataset.runtime = APP_MODE;
    const badge = document.getElementById('app-mode-badge');
    if (badge) {
        badge.textContent = APP_MODE === 'desktop' ? 'DESKTOP' : 'WEB';
    }
}

function recordLoanRecovery(event) {
    event.preventDefault();
    const payload = {
        title: document.getElementById('loanCustomer').value,
        amount: Number(document.getElementById('loanAmount').value || 0),
        description: `Recovered ${document.getElementById('recoveredAmount').value || 0}`
    };
    createSimpleRecord('loan-recovery', payload).then(() => {
        showNotification('Loan recovery recorded successfully!', 'success');
        document.getElementById('loanForm').reset();
    });
}

function recordDefective(event) {
    event.preventDefault();
    const payload = {
        title: document.getElementById('defectiveProduct').value,
        amount: Number(document.getElementById('defectiveQty').value || 0),
        description: document.getElementById('defectiveReason').value
    };
    createSimpleRecord('defective-items', payload).then(() => {
        showNotification('Defective item recorded successfully!', 'success');
        document.getElementById('defectiveForm').reset();
    });
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        apiRequest('/auth/logout', { method: 'POST' }).catch(() => null).finally(() => {
            if (window.clearAuthSession) window.clearAuthSession();
            showNotification('Logged out.', 'success');
            setTimeout(() => window.location.reload(), 500);
        });
    }
}

function editPrice(productId) {
    showNotification('Edit price feature coming soon', 'success');
}

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Initializing POS System...');
    applyRuntimeMode();
    const authOk = window.ensureAuth ? await window.ensureAuth() : true;
    if (!authOk) {
        window.addEventListener('auth-ready', () => {
            window.location.reload();
        }, { once: true });
        return;
    }
    const adminInfo = document.getElementById('admin-user');
    if (adminInfo && window.authSession?.user) {
        adminInfo.textContent = `${window.authSession.user.role?.toUpperCase() || 'USER'}: ${window.authSession.user.username}`;
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    document.addEventListener('click', (event) => {
        const sidebar = document.querySelector('.sidebar');
        const menuBtn = document.querySelector('.menu-btn');
        const clickedInsideSidebar = sidebar?.contains(event.target);
        const clickedMenuButton = menuBtn?.contains(event.target);
        if (window.innerWidth <= 768 && sidebar?.classList.contains('active') && !clickedInsideSidebar && !clickedMenuButton) {
            closeSidebar();
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            closeSidebar();
        }
    });

    window.addEventListener('online', () => {
        showNotification('Back online. Syncing queued actions...', 'success');
        syncQueuedActions();
    });

    window.addEventListener('offline', () => {
        showNotification('You are offline. New changes will be queued.', 'error');
        refreshSyncHint();
    });

    renderSimpleModuleTemplates();
    const isConnected = await checkServerConnection();
    setInterval(() => {
        if (navigator.onLine) {
            syncQueuedActions();
        }
    }, SYNC_INTERVAL_MS);
    if (isConnected) {
        await syncQueuedActions();
        loadInitialData();
    } else {
        showNotification('Offline mode enabled. You can keep working.', 'error');
        refreshSyncHint();
    }
});

function renderSimpleModuleTemplates() {
    Object.entries(simpleModules).forEach(([moduleId, moduleMeta]) => {
        const container = document.querySelector(`#${moduleId} .module-content`);
        if (!container || container.querySelector('form[data-simple-module]')) return;
        container.innerHTML = `
            <form data-simple-module="${moduleId}" onsubmit="submitSimpleModule(event, '${moduleId}')">
                <input type="text" id="${moduleId}-title" placeholder="${moduleMeta.title} title" required>
                <input type="number" step="0.01" id="${moduleId}-amount" placeholder="Amount">
                <input type="text" id="${moduleId}-reference" placeholder="Reference">
                <textarea id="${moduleId}-description" placeholder="Description"></textarea>
                <button class="btn-primary" type="submit">Save</button>
            </form>
            <table>
                <thead>
                    <tr><th>Title</th><th>Amount</th><th>Status</th><th>Reference</th><th>Date</th></tr>
                </thead>
                <tbody id="${moduleId}-rows"></tbody>
            </table>
        `;
    });
}

async function createSimpleRecord(moduleId, payload) {
    const moduleMeta = simpleModules[moduleId];
    if (!moduleMeta) return;
    await apiRequest(`/simple/${moduleMeta.table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withSyncMeta(payload))
    });
    await loadSimpleModule(moduleId);
}

async function submitSimpleModule(event, moduleId) {
    event.preventDefault();
    const payload = {
        title: document.getElementById(`${moduleId}-title`).value,
        amount: Number(document.getElementById(`${moduleId}-amount`).value || 0),
        reference: document.getElementById(`${moduleId}-reference`).value,
        description: document.getElementById(`${moduleId}-description`).value,
        status: 'active'
    };
    try {
        await createSimpleRecord(moduleId, payload);
        event.target.reset();
        showNotification('Record saved.', 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

async function loadSimpleModule(moduleId) {
    const moduleMeta = simpleModules[moduleId];
    if (!moduleMeta) return;
    const rows = await apiRequest(`/simple/${moduleMeta.table}`).catch(() => []);
    const tbody = document.getElementById(`${moduleId}-rows`);
    if (!tbody) return;
    tbody.innerHTML = '';
    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.title || '-'}</td>
            <td>$${toNumber(row.amount).toFixed(2)}</td>
            <td>${row.status || 'active'}</td>
            <td>${row.reference || '-'}</td>
            <td>${new Date(row.created_at).toLocaleDateString()}</td>
        `;
        tbody.appendChild(tr);
    });
}
