# StockEase v3 — School Supplies Inventory (Single Admin)

**Frontend:** React + JavaScript + CSS + Vite  
**Backend:** Node.js v24 + Express  
**Database:** SQLite (`better-sqlite3`)  
**Theme:** Mint Green `#A8E6A1`

## Included features
- Single administrator: first-run account creation, login, logout and change password
- Dashboard statistics: products, stock quantity, low-stock alerts and value
- Recently Added Products: tidy responsive product cards with larger images, item/category, unit prices, quantities and statuses
- **No Add Product on Dashboard** and **no Quick Actions**. Add Item remains in Manage Items
- Item management: ID (automatic), name, category, description, initial quantity, unit, unit price, supplier, date (automatic), stock status (automatic), photo upload (max 2 MB)
- Stock In/Out with quantity validation and transaction history
- Category management, supplier management, search, inventory reports and printing

## How to run in VS Code (Windows)
1. Extract this ZIP, then in VS Code choose **File → Open Folder** and select `stockease-project` (not its parent folder).
2. Open **Terminal → New Terminal**.
3. Run backend commands, one at a time:

   ```powershell
   cd backend
   npm install
   npm run dev
   ```

   If an older version of `better-sqlite3` fails on Node.js v24, run `npm pkg set "dependencies.better-sqlite3=latest"`, then `npm install` again.
4. Leave the backend running. Open a **second terminal** at project root and run:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```
5. Visit **http://localhost:5173**.
6. The first time, StockEase displays **Create your Admin Account**. Set an admin username and a strong password (10 or more characters). Afterward, log in with the credentials you chose. No second admin can be created through the app.
7. Click **Logout** at top right or bottom of sidebar to end the session. Click the round admin avatar to change the password.

## Important: preserve existing inventory records
If upgrading from an earlier local StockEase project, **stop both servers first** and back up its `backend/data/stockease.sqlite` file. Copy that exact existing SQLite database to `stockease-project/backend/data/stockease.sqlite` in this new project. Start backend again; it creates the new `admin_account` and `admin_sessions` tables *without deleting products*. All previous items, suppliers, photos and movements should remain.

A new downloaded ZIP never contains your old inventory data. **Do not delete your old project until your data is confirmed in the new one.**

## Database and authentication notes
- SQLite file is created automatically in `backend/data/`.
- Admin passwords are stored as salted **scrypt hashes**; not hardcoded in the frontend or stored as plaintext.
- Sessions use an `HttpOnly`, `SameSite=Strict` cookie; records are stored as hashes of random tokens in SQLite, expiring after 7 days.
- Inventory API endpoints require an authenticated session. Password changes invalidate active sessions.
- Both development servers bind to the local laptop by default. This is a **local/school project**, not a production-ready internet-hosted service.
- The first person with access to the unconfigured local app can create the only admin, so perform first-run setup privately.
- **No password recovery** is built in. Save your admin credentials securely; losing them requires manual administrative database recovery.
- Always keep backup copies of your SQLite database.

## Troubleshooting
- `ENOENT package.json`: VS Code terminal is in wrong folder. Open `stockease-project`, then `cd backend` or `cd frontend`.
- `Cannot reach backend`: make sure backend is still running at `http://localhost:4000`.
- `Return statement outside of function`: check `frontend/src/App.jsx` and run `npm run build` in `frontend`. Do not manually remove braces.
- If your browser shows an old app after replacing files, stop Vite and rerun `npm run dev`, then hard refresh browser.

## Quick test checklist
1. Create Admin account, Logout, Login again.
2. Open Manage Items and add a pen with image and initial stock.
3. Refresh browser: item must remain.
4. Stock In 10 and verify quantity increases, Stock Out 3 and verify decreases.
5. Try Stock Out greater than remaining: backend should reject it.
6. Add a supplier, assign it to an item; test search/category filtering.
7. Check low-stock alert at <=5 units; print Inventory Report.
8. Logout and try accessing protected inventory data without a login.

**Testing note:** The files and syntax were checked during preparation, but npm dependency installation and full interactive browser testing could not be completed in the preparation environment. Verify on your laptop before claiming all functions are fully tested.

## StockEase v4 update — Sales & custom low stock

New modules:
- **Sales Management:** record one product per sale with quantity and selling price. Each sale is saved with an exact selling-price snapshot; a SQLite transaction records the sale, subtracts stock, and adds a labelled Stock History movement together. Sale is rejected if quantity exceeds available stock.
- **Sales Reports:** daily, weekly (Monday–Sunday), and monthly revenue, transactions, and units sold using Philippine calendar dates; printable report. Reports represent **revenue**, not profit.
- **Custom Low Stock:** each item has a nonnegative restock alert threshold in Manage Items → Add/Edit Item. Previous records automatically get threshold 5. Status and dashboard warning counts use each item's own threshold.

### CRITICAL: updating your EXISTING project without losing any products

The code ZIP **does not contain your laptop's inventory**. Your photos, items, suppliers, admin user/password hash, and history live in the **existing** `backend/data/stockease.sqlite` on your laptop. The ZIP contains code only.

**Recommended: use the 5-file upgrade ZIP (includes check-db.js) rather than replacing your entire project folder.**

1. **Stop both servers first** (Ctrl+C in both VS Code terminals). 
2. Make a backup of your **entire existing `backend/data` folder**, including `stockease.sqlite`, `stockease.sqlite-wal` and `stockease.sqlite-shm` if present, to a separate folder you won't overwrite. After stopping the server, a simple copy is safe.
3. Make a backup of the existing four main code files: `backend/db.js`, `backend/server.js`, `frontend/src/App.jsx`, and `frontend/src/styles.css`.
4. Extract the upgrade ZIP. Copy **only those four updated code files plus backend/check-db.js** into the matching places in your current `stockease-project`. Do **not** replace or delete its `backend/data` directory. Do not replace `package.json` or the project folder.
5. Start backend (`cd backend`, `npm install` if necessary, `npm run dev`). The `low_stock_level` column and `sales` table are **added safely to the existing database**; no table is dropped or cleared.
6. Start frontend in another terminal (`cd frontend`, `npm run dev`); use `http://localhost:5173`.
7. Login to the existing admin account, check all original products and images, and test a sale of **one unit**. Verify quantity decreases by one and the transaction appears in Sales Management and Stock History. Test thresholds via Manage Items → Edit.
8. If anything is wrong, stop both servers before restoring backed-up code/database. Do not repeatedly replace database files while servers are running.

### Avoid double deductions
Use **Sales Management** for sold school supplies. Use **Stock Out** only for unsold removals (damaged, missing, used). Entering a sale and Stock Out for the same goods would deduct the stock twice.

### Report detail
- Revenue is the total selling price of recorded sales; it does not account for cost of goods/profit.
- Unit prices on items are used to prefill selling price but are adjustable per sale, and each transaction retains its actual sale price.
- The current `Total Stock Units` stat counts mixed selling units (packs, boxes, reams, pieces); this is not a conversion into individual pieces.
- Historical Stock Out movements from before Sales Management are not retroactively treated as sales, because their revenue is unknown.

### Local environment note
The included files have been checked for JS/JSX parsing and migration behavior, but full Vite compilation and end-to-end browser testing must be performed on your computer where npm dependencies are installed.


## November 2026 compatibility fixes

- Both `localhost:5173` and `127.0.0.1:5173` are accepted for local admin sign-in. Use the same browser hostname consistently.
- Startup imports `backend/db.js`, which migrates the existing SQLite schema by **adding** the `sales` table and `items.low_stock_level` when missing. It does not clear inventory.
- If you previously encountered `SqliteError: no such table: sales`, stop the backend, **back up the entire `backend/data` directory**, and then run `node check-db.js` from inside `backend`. The script imports the additive migration and prints table counts without passwords.
- The dashboard can still show the existing inventory when the sales/report endpoint has a problem; the error banner identifies the remaining issue.

**Important:** A new copy of this ZIP has no access to the records on your laptop. When upgrading, keep your original `backend/data` folder; never replace it with an empty one.
