# Quick Start Guide - Brwlix POS System

## ⚡ Get Started in 2 Minutes

### Step 1: Start the Server

Open PowerShell or Command Prompt and run:

```bash
cd "c:\Users\click satr\Desktop\pharma"
npm start
```

You should see:

```text
Server running at http://localhost:3000
Connected to SQLite database
Database tables initialized
```

### Step 2: Open in Browser

Navigate to: [http://localhost:3000](http://localhost:3000)

### Step 3: You're Ready! 🎉

## Dashboard Overview

The main dashboard shows 32 modules organized by color:

### 🔵 **Blue Sections** (Sales & Payments)

- Barcode Creation
- Item Pricing
- Inventory Items
- Spend History
- Register Payments
- Sales Receipts
- Sale of Goods

### 🟠 **Orange Sections** (Financial)

- Loan Recovery
- Debtor List
- Layaway Dashboard
- Customer Dashboard
- Customer Alert

### 🟢 **Green Sections** (Inventory & Purchases)

- Company Debt
- Purchase Receipts
- Purchase of Goods
- Product List
- Register New Product

### 🔴 **Red Sections** (Alerts & Reports)

- Low Stock Alert
- Defective Items
- Profit Report
- Till/Register
- Export Data
- Cash Report
- Purchase Table
- Customer Account Statement
- Cash Account Statement
- Sales Table

### 🟤 **Brown Sections** (Settings & Admin)

- Settings
- Supplies
- Daybook
- Data Backup
- System User

## Common Tasks

### 📦 Add a New Product

1. Click **"Register New Product"** (Green section)
2. Fill in:
   - Product Name
   - SKU (unique identifier)
   - Barcode (optional)
   - Category
   - Cost Price
   - Selling Price
   - Initial Stock
   - Minimum Stock Level
3. Click **"Add Product"**

### 💰 Record a Sale

1. Click **"Sale of Goods"** (Blue section)
2. Enter Receipt Number
3. Enter Customer Name (optional)
4. Add items:
   - Click **"Add Item"**
   - Select product
   - Enter quantity
5. Select payment method (Cash/Card/Credit)
6. Click **"Complete Sale"**

### 💳 Record a Payment

1. Click **"Register Payments"** (Blue section)
2. Enter amount
3. Select payment method
4. Add reference (optional)
5. Click **"Record Payment"**

### 🧑‍💼 Add a Customer

1. Click **"Customer Dashboard"** (Orange section)
2. Fill in customer details:
   - Name
   - Phone
   - Email
   - Address
   - Credit Limit
3. Click **"Add Customer"**

### 📊 View Reports

1. Click **"Profit Report"** for profit analysis
2. Click **"Sales Table"** for all sales
3. Click **"Purchase Table"** for all purchases
4. Scroll through tables to view data

### ⚠️ Check Low Stock

1. Click **"Low Stock Alert"** (Red section)
2. View all products below minimum stock
3. Use **"Purchase of Goods"** to reorder

## Tips & Tricks

✅ **Product Search** - In any product list, use the search box to filter

✅ **Auto-fill Prices** - When selecting a product in sales/purchases, price auto-fills

✅ **Responsive Design** - Works on desktop, tablet, and mobile

✅ **Color Codes** - Blue=Sales, Green=Inventory, Red=Alerts, Orange=Finance, Brown=Settings

✅ **Notifications** - Green box=Success, Red box=Error (auto-dismiss in 3 seconds)

✅ **Database** - All data saved to local `pharma.db` file

## Keyboard Shortcuts

|Key|Action|
|---|---|
|`Esc`|Close open module|
|`Ctrl+L`|Clear search box|

## Common Questions

**Q: Can I run this on my phone/tablet?**  
A: Yes! Open `http://localhost:3000` from any device on the same network (mobile needs to be on same WiFi as PC)

**Q: Where is my data stored?**  
A: All data is in `pharma.db` file in the pharmacy folder. Windows can't delete it while server is running.

**Q: How do I back up my data?**  
A: Click Settings > Data Backup > Backup Database. The `pharma.db` file is also backed up by Windows.

**Q: Can I export data?**  
A: Click "Export Data" module to export to CSV or Excel

**Q: How many users can use this?**  
A: This version supports local use. For multiple users, they need to access the same PC or network deployment.

**Q: Port 3000 is already in use**  
A: Close the other application using port 3000, or edit the PORT variable in server.js

## Troubleshooting

### "Cannot find module 'express'"

- Run: `npm install`

### "Database connection failed"

- Delete `pharma.db` and restart server
- Server will recreate it automatically

### "Port 3000 already in use"

Open PowerShell as admin and run:

```powershell
netstat -ano | findstr :3000
taskkill /PID [PID_NUMBER] /F
```

### Server keeps crashing

- Check for syntax errors in log
- Ensure all files are in correct folders
- Try deleting node_modules and running `npm install` again

## Need Help?

**Check the console output** - Server logs errors in the PowerShell window

**Refresh the browser** - Press F5 or Ctrl+R

**Restart the server** - Press Ctrl+C and run `npm start` again

---

**Happy Selling! 🛍️**  
*Brwlix POS System v1.0.0*
