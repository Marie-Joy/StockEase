// Run: cd backend && node check-db.js
// Safely initializes any missing additive tables/columns from db.js.
// This script never deletes existing rows or resets login information.
import { db } from './db.js';

const names = ['items','suppliers','categories','movements','admin_account','admin_sessions','sales'];
for (const name of names) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!exists) throw new Error(`Missing table: ${name}`);
  const total = db.prepare(`SELECT COUNT(*) AS total FROM ${name}`).get().total;
  console.log(`${name}: OK (${total} records)`);
}
const columns = db.prepare('PRAGMA table_info(items)').all().map(row => row.name);
if (!columns.includes('low_stock_level')) throw new Error('Missing items.low_stock_level');
console.log('Custom low-stock column: OK');
console.log('Existing inventory preserved. Sales schema ready.');
db.close();
