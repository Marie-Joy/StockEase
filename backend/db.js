import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'data');
fs.mkdirSync(dir, { recursive: true });
export const db = new Database(path.join(dir, 'stockease.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  unit TEXT NOT NULL DEFAULT 'pieces',
  unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  image TEXT,
  date_added TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('IN', 'OUT', 'OPENING')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  before_qty INTEGER NOT NULL,
  after_qty INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_movements_date ON movements(date);
`);
for (const name of ['Writing Materials','Paper Products','Art Supplies','Office Supplies','School Accessories','Folders & Organizers']) {
  db.prepare('INSERT OR IGNORE INTO categories(name) VALUES (?)').run(name);
}

// One administrator only. Existing inventory tables and records are untouched.
db.exec(`
CREATE TABLE IF NOT EXISTS admin_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
`);

// Safe additive migration: preserves existing items, suppliers, admin and stock history.
const itemCols = db.prepare("PRAGMA table_info(items)").all().map(row => row.name);
if (!itemCols.includes('low_stock_level')) {
  db.exec('ALTER TABLE items ADD COLUMN low_stock_level INTEGER NOT NULL DEFAULT 5 CHECK(low_stock_level >= 0)');
}
db.exec(`
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  total REAL NOT NULL CHECK(total >= 0),
  notes TEXT NOT NULL DEFAULT '',
  sold_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON sales(sold_at);
`);
