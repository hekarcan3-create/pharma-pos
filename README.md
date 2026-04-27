# Brwlix POS - Pharmacy Management System

A comprehensive Point of Sale (POS) and Inventory Management System for pharmacies with a modern, animated dashboard interface.

## Features

### Dashboard Modules (32 Sections)

#### Sales & Transactions

- **Barcode Creation** - Generate and print product barcodes
- **Sale of Goods** - Record and manage sales transactions
- **Sales Receipts** - View and print sales receipts
- **Sales Table** - Comprehensive sales data table
- **Register Payments** - Record payments from customers
- **Till/Register** - Manage cash registers and opening/closing balances

#### Inventory Management

- **Inventory Items** - Track product stock levels
- **Product List** - Complete list of all products
- **Register New Product** - Add new products to inventory
- **Low Stock Alert** - Monitor products below minimum stock
- **Defective Items** - Track and manage defective products

#### Pricing & Reporting

- **Item Pricing** - Manage product costs and selling prices
- **Profit Report** - View profit analysis and margins
- **Cash Report** - Cash flow and register reporting

#### Customer Management

- **Customer Dashboard** - Add and manage customers
- **Customer Account Statement** - Customer transaction history
- **Layaway Dashboard** - Track layaway sales
- **Customer Alert** - Customer notifications and alerts

#### Purchasing & Suppliers

- **Purchase of Goods** - Record purchase orders
- **Purchase Receipts** - Manage purchase receipts
- **Purchase Table** - View all purchases
- **Purchase Account Statement** - Supplier transaction history
- **Company Debt** - Track company debt to suppliers

#### Financial Management

- **Loan Recovery** - Track loan payments and recovery
- **Debtor List** - Monitor customer debts
- **Cash Account Statement** - Cash account tracking
- **Spend History** - Track expenses and spending

#### System Management

- **Settings** - Configure business settings
- **Data Backup** - Backup and restore database
- **System User** - Manage system users and roles
- **Supplies** - Manage business supplies
- **Daybook** - Daily transaction log

## System Requirements

- Node.js (v14 or higher)
- npm (v6 or higher)
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Windows/Mac/Linux (any OS that supports Node.js)

## Installation & Setup

### 1. Install Dependencies

```bash
cd pharma
npm install
```

### 2. Web Mode (PC browser)

```bash
npm start
```

The server will start on `http://localhost:3000`

### 3. Phone/PWA Mode

1. Start web mode: `npm start`
2. Open `http://<your-pc-ip>:3000` from your phone on same network
3. Install to home screen from browser menu
4. App supports offline action queue and auto-sync on reconnect (last-write-wins)

### 4. Desktop Mode (Electron)

```bash
npm run desktop:dev
```

or (if server already running):

```bash
npm run desktop:start
```

### 6. Authentication and roles

- App now requires sign-in before dashboard data loads.
- Default seeded admin (first run/migration): `admin` / `admin123`
- Migrated legacy users are seeded with password: `changeme123`
- Change seeded credentials immediately for real deployments.

### 5. Build Windows Package

```bash
npm run build:win
```

### 3. Access the Application

Open your web browser and navigate to:

```text
http://localhost:3000
```

## Project Structure

```text
pharma/
├── package.json           # Project dependencies and metadata
├── server.js             # Express server and API endpoints
├── pharma.db            # SQLite database (created on first run)
└── public/
    ├── index.html       # Main HTML dashboard
    ├── style.css        # CSS styling with animations
    └── script.js        # Frontend JavaScript and interactions
```

## Key Technologies

- **Backend**: Node.js with Express.js
- **Database**: SQLite3 (local database)
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **API Communication**: REST API with JSON

## API Endpoints

All API responses now follow this schema:

- Success: `{ "success": true, "data": ... }`
- Error: `{ "success": false, "error": { "code", "message", "details" } }`

Offline sync metadata accepted on write routes:

- `client_updated_at`
- `device_id`
- `sync_id`

### Products

- `GET /api/products` - List all products
- `POST /api/products` - Add new product
- `PUT /api/products/:id` - Update product

### Sales

- `GET /api/sales` - List all sales
- `POST /api/sales` - Create new sale
- `GET /api/sales/:id` - Get sale details

### Customers

- `GET /api/customers` - List all customers
- `POST /api/customers` - Add new customer

### Auth

- `POST /api/auth/login` - Create session token
- `GET /api/auth/me` - Validate active session
- `POST /api/auth/logout` - End active session
- `GET /api/audit-logs` - Admin-only activity logs

### Payments

- `GET /api/payments` - List all payments
- `POST /api/payments` - Record payment

### Purchases

- `GET /api/purchases` - List all purchases
- `POST /api/purchases` - Create purchase order

### Account ledgers

- `GET /api/company-accounts`
- `POST /api/company-accounts`
- `GET /api/company-accounts/:id/statement?from=<ISO>&to=<ISO>`
- `POST /api/company-accounts/:id/payments`
- `GET /api/customer-accounts`
- `GET /api/customer-accounts/:id/statement?from=<ISO>&to=<ISO>`
- `POST /api/customer-accounts/:id/payments`

### Reports

- `GET /api/reports/sales?from=<ISO>&to=<ISO>` - Sales report with date filter
- `GET /api/reports/inventory` - Inventory report
- `GET /api/reports/profit?from=<ISO>&to=<ISO>` - Profit analysis with date filter

### Generic Module Records

- `GET /api/simple/:table`
- `POST /api/simple/:table`

### Dashboard

- `GET /api/dashboard` - Dashboard statistics

## Database Schema

### Tables

- **products** - Product catalog with pricing and stock
- **sales** - Sales transactions
- **sales_items** - Individual items in sales
- **purchases** - Purchase orders
- **purchase_items** - Items in purchases
- **customers** - Customer information
- **payments** - Payment records
- **suppliers** - Supplier information
- **debts** - Customer and company debts
- **users** - System users
- **cash_register** - Register transactions
- **inventory_adjustments** - Stock adjustments

## UI Features

### 🎨 Modern UI/UX

- Responsive grid-based dashboard
- Color-coded sections (Blue, Orange, Green, Red, Brown)
- Smooth animations and transitions
- Mobile-friendly design

### 📊 Real-time Data

- Live inventory tracking
- Sales and profit calculations
- Low stock alerts
- Payment history

### 🔒 Data Management

- SQLite database for local storage
- Backup functionality
- Data export options
- User role management

### 💰 Financial Tracking

- Sales and revenue reporting
- Profit margin analysis
- Customer credit management
- Expense tracking

## Usage Guide

### Adding a Product

1. Click "Register New Product"
2. Fill in product details (name, SKU, price, stock)
3. Click "Add Product"

### Recording a Sale

1. Click "Sale of Goods"
2. Enter receipt number and customer name
3. Add items (product, quantity, price)
4. Select payment method
5. Complete sale

### Viewing Reports

1. Click "Profit Report" or other report modules
2. View summary statistics
3. Export data if needed

### Managing Inventory

1. Click "Inventory Items" to see all stock
2. Click "Low Stock Alert" for items needing reorder
3. Click "Register New Product" to add new items

## Keyboard Shortcuts

- `Esc` - Close open module
- `F5` - Refresh dashboard

## Support & Troubleshooting

### Server Won't Start

- Ensure Node.js is installed: `node -v`
- Check port 3000 is not in use: `netstat -ano | findstr :3000`
- Delete `node_modules` and run `npm install` again

### Database Issues

- Delete `pharma.db` file to reset database
- Server will recreate it automatically on start

### Page Not Loading

- Check if server is running in terminal
- Verify URL is `http://localhost:3000`
- Clear browser cache (Ctrl+Shift+Delete)

## Security Notes

This is a local POS system designed for single-machine use. For production deployment:

- Add user authentication
- Implement proper authorization
- Use environment variables for configuration
- Enable HTTPS
- Add input validation
- Implement data encryption

## Offline + replay behavior

- Write actions still queue in IndexedDB while offline.
- Queued actions now carry auth user context metadata for auditability.
- Replayed actions that fail with `401/403` are dropped instead of retried forever.
- On reconnect, queued writes are replayed in FIFO order.

## Performance Tips

- Database queries are optimized for small to medium datasets
- For large datasets, consider implementing pagination
- Regular backups are recommended
- Monitor server logs for errors

## Future Enhancements

- Multi-user network support
- Advanced analytics dashboard
- Mobile app version
- Barcode scanner integration
- Receipt printer support
- Email and SMS notifications
- Multi-currency support
- Tax management

## License

MIT License

## Contact & Support

For issues or feature requests, please document them clearly with:

- Steps to reproduce
- Expected vs actual behavior
- Screenshots or error messages

---

**Version**: 1.0.0  
**Last Updated**: April 2026  
**Status**: Production Ready
