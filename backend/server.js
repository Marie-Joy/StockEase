import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT || 4000);
// Support both common loopback addresses for local Vite development.
const allowedOrigins = new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  ...(process.env.FRONTEND_ORIGIN ? [process.env.FRONTEND_ORIGIN] : [])
]);
app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.has(origin)) return callback(null, true);
  callback(new Error('Frontend origin is not allowed.'));
}}));
app.use(express.json({ limit: '5mb' }));

const httpError = (status, message) => Object.assign(new Error(message), { status });
const asId = value => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, 'Invalid ID.');
  return id;
};
const str = (value, label, limit = 150, required = false) => {
  if (typeof value !== 'string') throw httpError(400, `${label} must be text.`);
  const text = value.trim();
  if (required && !text) throw httpError(400, `${label} is required.`);
  if (text.length > limit) throw httpError(400, `${label} is too long (maximum ${limit} characters).`);
  return text;
};
const nonnegative = (value, label, int = false, minimum = 0) => {
  if (value === null || value === '' || value === undefined) throw httpError(400, `${label} is required.`);
  const num = Number(value);
  if (!Number.isFinite(num) || num < minimum || (int && !Number.isSafeInteger(num))) {
    throw httpError(400, `${label} must be ${int ? 'a whole number' : 'a number'} of at least ${minimum}.`);
  }
  return num;
};
const validImage = v => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > 3_700_000 || !/^data:image\/(jpeg|png|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(v)) {
    throw httpError(400, 'Upload a JPEG, PNG, WebP, or GIF image under 2 MB.');
  }
  return v;
};
const supplierExists = id => {
  if (id === null) return;
  if (!db.prepare('SELECT id FROM suppliers WHERE id=?').get(id)) throw httpError(400, 'Please choose an existing supplier.');
};
const item = id => {
  const row = db.prepare(`SELECT i.*, s.name AS supplier_name FROM items i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.id=?`).get(id);
  if (!row) throw httpError(404, 'Item not found.');
  return row;
};
const parseItem = (v, prior = null) => {
  const supplier_id = v.supplier_id === '' || v.supplier_id === null || v.supplier_id === undefined ? null : asId(v.supplier_id);
  supplierExists(supplier_id);
  const category = str(v.category, 'Category', 90, true);
  if (!db.prepare('SELECT name FROM categories WHERE name=?').get(category)) throw httpError(400, 'Please choose an existing category.');
  return {
    name: str(v.name, 'Item name', 140, true), category,
    description: str(v.description || '', 'Description', 1000),
    quantity: prior ? prior.quantity : nonnegative(v.quantity, 'Quantity', true),
    unit: str(v.unit, 'Unit', 30, true),
    unit_price: nonnegative(v.unit_price, 'Unit price'),
    low_stock_level: nonnegative(v.low_stock_level ?? prior?.low_stock_level ?? 5, 'Low stock threshold', true), supplier_id,
    image: validImage(v.image)
  };
};
const wrap = fn => (req, res, next) => { try { fn(req, res); } catch (e) { next(e); } };


// Local single-admin authentication. Never store plaintext passwords.
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const makeHash = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const getAdmin = () => db.prepare('SELECT * FROM admin_account WHERE id=1').get();
const cookieToken = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('stockease_session='))?.split('=')[1];
const clearSession = res => res.setHeader('Set-Cookie', 'stockease_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0');
const setSession = (res, token) => res.setHeader('Set-Cookie', `stockease_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_AGE/1000)}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
const sessionFrom = req => {
  const token = cookieToken(req);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(sha256(token), Date.now());
};
const openSession = res => {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(Date.now());
  db.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES (?,?)').run(sha256(token), Date.now()+SESSION_AGE);
  setSession(res,token);
};
// Basic local login throttling. Restarting the server clears the counters.
const attempts = new Map();
const loginGuard = (req,res,next) => {
  const ip = req.ip || 'local';
  const state = attempts.get(ip);
  if (state?.until > Date.now()) return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
  next();
};
const failedLogin = ip => {
  const old = attempts.get(ip);
  const count = (old?.until < Date.now() ? 0 : old?.count || 0) + 1;
  attempts.set(ip,{count, until: Date.now()+(count>=6?15*60*1000:5*60*1000)});
};
const validateCredentials = body => {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[A-Za-z0-9_.-]{3,40}$/.test(username)) throw httpError(400,'Username must be 3–40 letters, numbers, dots, underscores or hyphens.');
  if (password.length < 10 || password.length > 128) throw httpError(400,'Password must contain 10–128 characters.');
  return {username,password};
};
// Require normal same-origin requests for all state-changing API operations.
app.use('/api', (req,res,next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return res.status(403).json({error:'Request origin not permitted.'});
  }
  next();
});
app.get('/api/auth/status', (req,res) => {
  const admin = getAdmin();
  res.json({setupRequired:!admin, authenticated:!!admin && !!sessionFrom(req), username:admin && sessionFrom(req) ? admin.username : null});
});
app.post('/api/auth/setup', (req,res,next) => {
  try {
    const {username,password} = validateCredentials(req.body);
    const salt = randomBytes(24).toString('hex');
    const hash = makeHash(password,salt);
    // Atomic one-time creation; account #2 cannot be created.
    const result = db.prepare('INSERT OR IGNORE INTO admin_account(id,username,password_hash,salt) VALUES (1,?,?,?)').run(username,hash,salt);
    if (!result.changes) throw httpError(409,'Administrator already exists. Please log in.');
    openSession(res);
    res.status(201).json({username});
  } catch(e){next(e);}
});
app.post('/api/auth/login', loginGuard, (req,res,next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const admin = getAdmin();
    const valid = admin && username === admin.username &&
      password.length <= 128 && timingSafeEqual(Buffer.from(makeHash(password,admin.salt),'hex'),Buffer.from(admin.password_hash,'hex'));
    if (!valid) { failedLogin(req.ip || 'local'); throw httpError(401,'Invalid username or password.'); }
    attempts.delete(req.ip || 'local'); openSession(res);
    res.json({username:admin.username});
  } catch(e){next(e);}
});
app.post('/api/auth/logout', (req,res) => {
  const token=cookieToken(req);
  if(token) db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(sha256(token));
  clearSession(res); res.json({ok:true});
});
app.post('/api/auth/password', (req,res,next) => {
  try {
    if (!sessionFrom(req)) throw httpError(401,'Please log in.');
    const admin=getAdmin();
    const old=typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newer=typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (!timingSafeEqual(Buffer.from(makeHash(old,admin.salt),'hex'), Buffer.from(admin.password_hash,'hex'))) throw httpError(403,'Current password is incorrect.');
    if(newer.length<10 || newer.length>128) throw httpError(400,'New password must contain 10–128 characters.');
    const salt=randomBytes(24).toString('hex');
    db.prepare('UPDATE admin_account SET salt=?,password_hash=? WHERE id=1').run(salt,makeHash(newer,salt));
    db.prepare('DELETE FROM admin_sessions').run();
    clearSession(res); res.json({ok:true});
  } catch(e){next(e);}
});
app.use('/api', (req,res,next) => {
  if (!sessionFrom(req)) return res.status(401).json({error:'Please log in to access StockEase.'});
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'StockEase' }));
app.get('/api/categories', wrap((req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY name').all())));
app.post('/api/categories', wrap((req, res) => {
  const name = str(req.body.name, 'Category name', 90, true);
  const result = db.prepare('INSERT INTO categories(name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id=?').get(result.lastInsertRowid));
}));
app.delete('/api/categories/:id', wrap((req, res) => {
  const id = asId(req.params.id);
  const row = db.prepare('SELECT * FROM categories WHERE id=?').get(id);
  if (!row) throw httpError(404, 'Category not found.');
  if (db.prepare('SELECT COUNT(*) AS n FROM items WHERE category=?').get(row.name).n) throw httpError(409, 'Category has items. Move or delete the items first.');
  db.prepare('DELETE FROM categories WHERE id=?').run(id);
  res.status(204).end();
}));

app.get('/api/suppliers', wrap((req, res) => res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all())));
app.post('/api/suppliers', wrap((req, res) => {
  const v = req.body;
  const row = [str(v.name, 'Supplier name', 140, true), str(v.contact||'', 'Contact person'), str(v.phone||'', 'Phone'), str(v.address||'', 'Address', 250)];
  const r = db.prepare('INSERT INTO suppliers(name,contact,phone,address) VALUES (?,?,?,?)').run(...row);
  res.status(201).json(db.prepare('SELECT * FROM suppliers WHERE id=?').get(r.lastInsertRowid));
}));
app.put('/api/suppliers/:id', wrap((req, res) => {
  const id = asId(req.params.id);
  if (!db.prepare('SELECT id FROM suppliers WHERE id=?').get(id)) throw httpError(404, 'Supplier not found.');
  const v = req.body;
  db.prepare('UPDATE suppliers SET name=?,contact=?,phone=?,address=? WHERE id=?').run(
    str(v.name,'Supplier name',140,true),str(v.contact||'','Contact person'),str(v.phone||'','Phone'),str(v.address||'','Address',250),id);
  res.json(db.prepare('SELECT * FROM suppliers WHERE id=?').get(id));
}));
app.delete('/api/suppliers/:id', wrap((req, res) => {
  const r = db.prepare('DELETE FROM suppliers WHERE id=?').run(asId(req.params.id));
  if (!r.changes) throw httpError(404, 'Supplier not found.');
  res.status(204).end();
}));

const listItems = () => db.prepare(`SELECT i.*,s.name AS supplier_name FROM items i LEFT JOIN suppliers s ON s.id=i.supplier_id ORDER BY i.id DESC`).all();
app.get('/api/items', wrap((req, res) => res.json(listItems())));
app.post('/api/items', wrap((req, res) => {
  const v = parseItem(req.body);
  const result = db.transaction(() => {
    const r = db.prepare(`INSERT INTO items(name,category,description,quantity,unit,unit_price,low_stock_level,supplier_id,image)
      VALUES (@name,@category,@description,@quantity,@unit,@unit_price,@low_stock_level,@supplier_id,@image)`).run(v);
    if (v.quantity > 0) db.prepare(`INSERT INTO movements(item_id,item_name,type,quantity,before_qty,after_qty,notes) VALUES (?,?,?,?,?,?,?)`)
      .run(r.lastInsertRowid,v.name,'OPENING',v.quantity,0,v.quantity,'Initial stock');
    return item(r.lastInsertRowid);
  })();
  res.status(201).json(result);
}));
app.put('/api/items/:id', wrap((req, res) => {
  const id = asId(req.params.id);
  const prior = item(id);
  const v = parseItem(req.body, prior);
  db.prepare(`UPDATE items SET name=@name,category=@category,description=@description,unit=@unit,unit_price=@unit_price,
    low_stock_level=@low_stock_level,supplier_id=@supplier_id,image=@image,updated_at=datetime('now') WHERE id=@id`).run({ ...v, id });
  res.json(item(id));
}));
app.delete('/api/items/:id', wrap((req, res) => {
  const result = db.prepare('DELETE FROM items WHERE id=?').run(asId(req.params.id));
  if (!result.changes) throw httpError(404, 'Item not found.');
  res.status(204).end();
}));
app.post('/api/items/:id/stock', wrap((req, res) => {
  const id = asId(req.params.id);
  const type = req.body.type;
  if (!['IN','OUT'].includes(type)) throw httpError(400,'Stock type must be IN or OUT.');
  const qty = nonnegative(req.body.quantity,'Movement quantity',true,1);
  const notes = str(req.body.notes || '', 'Notes', 300);
  const updated = db.transaction(() => {
    const p = item(id);
    if (type === 'OUT' && qty > p.quantity) throw httpError(400, `Only ${p.quantity} ${p.unit} available. Cannot stock out ${qty}.`);
    const next = p.quantity + (type === 'IN' ? qty : -qty);
    db.prepare("UPDATE items SET quantity=?,updated_at=datetime('now') WHERE id=?").run(next,id);
    db.prepare('INSERT INTO movements(item_id,item_name,type,quantity,before_qty,after_qty,notes) VALUES(?,?,?,?,?,?,?)')
      .run(id,p.name,type,qty,p.quantity,next,notes);
    return item(id);
  })();
  res.status(201).json(updated);
}));
// Sales are separate from ordinary Stock Out. One atomic transaction prevents double deduction.
app.post('/api/sales', wrap((req, res) => {
  const id = asId(req.body?.item_id);
  const quantity = nonnegative(req.body?.quantity, 'Sale quantity', true, 1);
  const unit_price = nonnegative(req.body?.unit_price, 'Selling price');
  // Round monetary values to centavos for consistent reporting.
  if (Math.round(unit_price * 100) / 100 !== unit_price) throw httpError(400, 'Selling price may have at most 2 decimal places.');
  const notes = str(req.body?.notes || '', 'Sale notes', 300);
  const sale = db.transaction(() => {
    const product = item(id);
    if (quantity > product.quantity) throw httpError(400, `Only ${product.quantity} ${product.unit} available. Cannot sell ${quantity}.`);
    const after = product.quantity - quantity;
    const total = Math.round(quantity * unit_price * 100) / 100;
    const result = db.prepare('INSERT INTO sales(item_id,item_name,unit,quantity,unit_price,total,notes) VALUES (?,?,?,?,?,?,?)')
      .run(id,product.name,product.unit,quantity,unit_price,total,notes);
    db.prepare("UPDATE items SET quantity=?,updated_at=datetime('now') WHERE id=?").run(after,id);
    db.prepare('INSERT INTO movements(item_id,item_name,type,quantity,before_qty,after_qty,notes) VALUES (?,?,?,?,?,?,?)')
      .run(id,product.name,'OUT',quantity,product.quantity,after,`Sale #${result.lastInsertRowid}${notes ? ': '+notes : ''}`);
    return db.prepare('SELECT * FROM sales WHERE id=?').get(result.lastInsertRowid);
  })();
  res.status(201).json(sale);
}));
app.get('/api/sales', wrap((req,res) => {
  res.json(db.prepare('SELECT * FROM sales ORDER BY id DESC').all());
}));
// Group by Philippine local calendar date (UTC+08), with Monday as first day of week.
app.get('/api/sales/summary', wrap((req,res) => {
  const periods = {day:"date('now','+8 hours')",week:"date('now','+8 hours','weekday 0','-6 days')",month:"strftime('%Y-%m','now','+8 hours')"};
  const summary = {};
  for (const period of ['day','week','month']) {
    const condition = period === 'day' ? `date(sold_at,'+8 hours')=${periods.day}`
      : period === 'month' ? `strftime('%Y-%m',sold_at,'+8 hours')=${periods.month}`
      : `date(sold_at,'+8 hours') >= date('now','+8 hours', '-' || ((cast(strftime('%w','now','+8 hours') as integer)+6)%7) || ' days')`;
    summary[period] = db.prepare(`SELECT COUNT(*) as transactions, COALESCE(SUM(quantity),0) as units_sold, COALESCE(ROUND(SUM(total),2),0) as revenue FROM sales WHERE ${condition}`).get();
  }
  summary.all = db.prepare('SELECT COUNT(*) as transactions, COALESCE(SUM(quantity),0) as units_sold, COALESCE(ROUND(SUM(total),2),0) as revenue FROM sales').get();
  res.json(summary);
}));

app.get('/api/movements', wrap((req, res) => res.json(db.prepare('SELECT * FROM movements ORDER BY id DESC LIMIT 2000').all())));
app.get('/api/report', wrap((req, res) => {
  const records = listItems().map(({ image, ...rest }) => rest);
  const stats = { products: records.length, units: records.reduce((a,p) => a+p.quantity,0),
    low: records.filter(p=>p.quantity<=p.low_stock_level).length, value: records.reduce((a,p) => a+p.quantity*p.unit_price,0) };
  res.json({ generated_at: new Date().toISOString(), stats, items: records });
}));

app.use((err,req,res,next) => {
  if (err.code?.startsWith('SQLITE_CONSTRAINT_UNIQUE')) return res.status(409).json({ error: 'This name already exists.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Photo is too large. Please use a smaller image.' });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid request data.' });
  console.error(err);
  const databaseError = err.code === 'SQLITE_ERROR' && /no such (?:table|column)/i.test(err.message || '');
  res.status(err.status || 500).json({ error: err.status ? err.message : databaseError ? 'Database upgrade incomplete. Stop backend, back up backend/data, then run: node check-db.js in backend.' : 'Unexpected server error.' });
});
app.listen(PORT,'127.0.0.1',()=> console.log(`StockEase API running at http://localhost:${PORT}`));
