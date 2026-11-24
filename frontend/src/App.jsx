import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Layers3, LayoutDashboard, Boxes, ArrowDownToLine, ArrowUpFromLine, History,
  Truck, Tags, FileBarChart2, Plus, Search, Pencil, Trash2, X, Upload,
  AlertTriangle, Package, PhilippinePeso, RefreshCw, Menu, CheckCircle2,
  Printer, ImagePlus, ChevronRight, ListFilter, PackagePlus, LogOut, LockKeyhole, UserRound, Eye, EyeOff, ShoppingCart, ChartColumnIncreasing
} from 'lucide-react';

const EMPTY_ITEM = { name: '', category: 'Writing Materials', description: '', quantity: '0', unit: 'pieces', unit_price: '', low_stock_level: '5', supplier_id: '', image: null };
const EMPTY_SUPPLIER = { name: '', contact: '', phone: '', address: '' };
const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
const dateText = value => value ? new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z').toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const statusText = (n, limit = 5) => n === 0 ? 'Out of stock' : n <= limit ? 'Low stock' : 'In stock';
const statusClass = (n, limit = 5) => n === 0 ? 'out' : n <= limit ? 'low' : 'good';

// Date bucket uses Manila calendar days, including Monday-start weeks.
const manilaParts = date => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const toDay = string => manilaParts(new Date(string.includes('T')?string:string.replace(' ','T')+'Z'));
function isSaleWithinPeriod(date, period) {
  const saleDay = toDay(date);
  const today = manilaParts(new Date());
  if (period==='day') return saleDay===today;
  if (period==='month') return saleDay.slice(0,7)===today.slice(0,7);
  const [y,m,d]=today.split('-').map(Number);
  const weekday=new Date(Date.UTC(y,m-1,d)).getUTCDay();
  const monday=new Date(Date.UTC(y,m-1,d-((weekday+6)%7))).toISOString().slice(0,10);
  return saleDay>=monday && saleDay<=today;
}

async function api(path, init) {
  let response;
  try {
    response = await fetch('/api' + path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new Error('Cannot connect to the backend. Run npm run dev in the backend folder.');
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={22}/></button></div>
      {children}
    </section>
  </div>;
}

function Photo({ src, size = 'normal' }) {
  return <div className={'photo ' + (size === 'large' ? 'photo-large' : '')}>
    {src ? <img src={src} alt="School supply" /> : <Package size={size === 'large' ? 34 : 22} />}
  </div>;
}

function ProductTable({ items, onEdit, onDelete, onStock }) {
  return <div className="table-wrap"><table>
    <thead><tr><th>ITEM</th><th>CATEGORY</th><th>SUPPLIER</th><th>UNIT PRICE</th><th>QUANTITY</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
    <tbody>{items.map(p => <tr key={p.id}>
      <td><div className="item-cell"><Photo src={p.image}/><span><strong>{p.name}</strong><small>ID #{String(p.id).padStart(4,'0')} · {p.unit}</small></span></div></td>
      <td>{p.category}</td><td>{p.supplier_name || '—'}</td><td>{money(p.unit_price)}</td>
      <td><strong>{p.quantity}</strong> <span className="muted">{p.unit}</span></td>
      <td><span className={'pill ' + statusClass(p.quantity,p.low_stock_level)}>{statusText(p.quantity,p.low_stock_level)}</span></td>
      <td><div className="actions">
        <button title="Stock In" aria-label={'Stock In '+p.name} onClick={()=>onStock(p,'IN')}><ArrowDownToLine size={17}/></button>
        <button title="Stock Out" aria-label={'Stock Out '+p.name} onClick={()=>onStock(p,'OUT')}><ArrowUpFromLine size={17}/></button>
        <button title="Edit item" aria-label={'Edit '+p.name} onClick={()=>onEdit(p)}><Pencil size={17}/></button>
        <button className="danger-text" title="Delete item" aria-label={'Delete '+p.name} onClick={()=>onDelete(p)}><Trash2 size={17}/></button>
      </div></td>
    </tr>)}</tbody>
  </table>{!items.length && <div className="empty"><Package size={38}/><strong>No items to display</strong><p>Add a school supply or adjust your filters.</p></div>}</div>;
}

function InventoryApp({ username, onLogout }) {
  const [section, setSection] = useState('dashboard');
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [movements, setMovements] = useState([]);
  const [sales, setSales] = useState([]);
  const [salesSummary, setSalesSummary] = useState({day:{revenue:0,transactions:0,units_sold:0},week:{revenue:0,transactions:0,units_sold:0},month:{revenue:0,transactions:0,units_sold:0},all:{revenue:0,transactions:0,units_sold:0}});
  const [salesPeriod, setSalesPeriod] = useState('day');
  const [saleForm, setSaleForm] = useState({item_id:'',quantity:'1',unit_price:'',notes:''});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [supplierForm, setSupplierForm] = useState(EMPTY_SUPPLIER);
  const [categoryName, setCategoryName] = useState('');
  const [stockForm, setStockForm] = useState({ quantity:'1', notes:'' });
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All categories');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({currentPassword:"",newPassword:""});

  const load = useCallback(async () => {
    try {
      // Keep existing inventory visible even if a newly added report endpoint fails.
      const requests = await Promise.allSettled([api('/items'),api('/suppliers'),api('/categories'),api('/movements'),api('/sales'),api('/sales/summary')]);
      const setters = [setItems,setSuppliers,setCategories,setMovements,setSales,setSalesSummary];
      requests.forEach((result,index) => { if (result.status === 'fulfilled') setters[index](result.value); });
      const failures = requests.filter(result => result.status === 'rejected');
      setError(failures.length ? 'Some data could not load: ' + failures[0].reason.message : '');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  const notify = text => setToast(text);
  const close = () => setModal(null);
  const select = key => { setSection(key); setMobileOpen(false); setQuery(''); setCategoryFilter('All categories'); };

  const stats = useMemo(() => ({
    count: items.length,
    units: items.reduce((s,x) => s + x.quantity, 0),
    low: items.filter(x => x.quantity <= x.low_stock_level).length,
    value: items.reduce((s,x) => s + x.quantity * x.unit_price, 0)
  }), [items]);
  const filtered = useMemo(() => items.filter(p => {
    const needle = query.trim().toLowerCase();
    const matches = !needle || [p.name,p.description,p.category,p.supplier_name,String(p.id)].some(x => String(x || '').toLowerCase().includes(needle));
    return matches && (categoryFilter === 'All categories' || p.category === categoryFilter);
  }), [items, query, categoryFilter]);
  const stockRows = section === 'stock-in' || section === 'stock-out' ? filtered : [];
  const categoryItems = useMemo(() => selectedCategory ? items.filter(item => item.category === selectedCategory) : [], [items, selectedCategory]);
  const menu = [
    ['dashboard','Dashboard',LayoutDashboard],['items','Manage Items',Boxes],
    ['stock-in','Stock In',ArrowDownToLine],['stock-out','Stock Out',ArrowUpFromLine],
    ['history','Stock History',History],['categories','Categories',Tags],
    ['suppliers','Suppliers',Truck],['sales','Sales Management',ShoppingCart],['sales-reports','Sales Reports',ChartColumnIncreasing],['reports','Inventory Reports',FileBarChart2]
  ];

  const openItem = (p = null) => {
    setForm(p ? { ...p, supplier_id: p.supplier_id ?? '', quantity: String(p.quantity), unit_price: String(p.unit_price), low_stock_level: String(p.low_stock_level ?? 5) } : { ...EMPTY_ITEM, category: categories[0]?.name || 'Writing Materials' });
    setModal({ kind: 'item', item: p });
  };
  const openStock = (p, type) => { setStockForm({ quantity: '1', notes: '' }); setModal({ kind: 'stock', item: p, type }); };
  const openSale = (p = null) => {
    const selected = p || items.find(i=>i.quantity>0);
    setSaleForm({item_id:selected?.id ? String(selected.id):'',quantity:'1',unit_price:selected?String(selected.unit_price):'',notes:''});
    setModal({kind:'sale'});
  };
  const saveSale = e => {e.preventDefault(); run(async()=>{
    await api('/sales',{method:'POST',body:JSON.stringify(saleForm)});
    notify('Sale recorded and stock deducted automatically.');
  });};
  const openSupplier = (s = null) => { setSupplierForm(s ? { ...s } : { ...EMPTY_SUPPLIER }); setModal({ kind: 'supplier', supplier: s }); };
  const run = async job => { setBusy(true); try { await job(); close(); await load(); } catch (e) { notify(e.message); } finally { setBusy(false); } };

  const saveItem = e => { e.preventDefault(); run(async () => {
    await api(modal.item ? `/items/${modal.item.id}` : '/items', { method: modal.item ? 'PUT' : 'POST', body: JSON.stringify(form) });
    notify(modal.item ? 'Item updated successfully.' : 'School supply added successfully.');
  }); };
  const saveStock = e => { e.preventDefault(); run(async () => {
    await api(`/items/${modal.item.id}/stock`, { method:'POST', body: JSON.stringify({ ...stockForm, type: modal.type }) });
    notify(modal.type === 'IN' ? 'Stock added successfully.' : 'Stock deducted successfully.');
  }); };
  const deleteItem = p => {
    if (!window.confirm(`Delete ${p.name}? Stock history will remain recorded.`)) return;
    run(async () => { await api(`/items/${p.id}`, { method:'DELETE' }); notify('Item deleted.'); });
  };
  const saveSupplier = e => { e.preventDefault(); run(async () => {
    await api(modal.supplier ? `/suppliers/${modal.supplier.id}` : '/suppliers', { method:modal.supplier ? 'PUT' : 'POST', body:JSON.stringify(supplierForm) });
    notify(modal.supplier ? 'Supplier updated.' : 'Supplier added.');
  }); };
  const deleteSupplier = s => {
    if (!window.confirm(`Delete supplier ${s.name}? Its items will remain without an assigned supplier.`)) return;
    run(async () => { await api(`/suppliers/${s.id}`, { method:'DELETE' }); notify('Supplier deleted.'); });
  };
  const createCategory = e => { e.preventDefault(); run(async () => {
    await api('/categories', {method:'POST', body:JSON.stringify({name:categoryName})}); setCategoryName(''); notify('Category added.');
  }); };
  const deleteCategory = c => {
    if (!window.confirm(`Delete category ${c.name}?`)) return;
    run(async () => { await api(`/categories/${c.id}`, {method:'DELETE'}); notify('Category deleted.'); });
  };
  const uploadPhoto = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { notify('Select a JPEG, PNG, WebP or GIF photo.'); e.target.value=''; return; }
    if (file.size > 2 * 1024 * 1024) { notify('Photo must be under 2 MB.'); e.target.value=''; return; }
    const reader = new FileReader();
    reader.onload = () => setForm(p=>({...p,image:reader.result}));
    reader.onerror = () => notify('Could not read that photo.');
    reader.readAsDataURL(file);
  };

  const printReport = () => window.print();
  const filters = <div className="filter-bar"><div className="search-field"><Search size={19}/><input aria-label="Search items" placeholder="Search by item, ID, category or supplier..." value={query} onChange={e => setQuery(e.target.value)}/></div><select aria-label="Filter category" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option>All categories</option>{categories.map(c=><option key={c.id}>{c.name}</option>)}</select></div>;

  return <div className="app-shell">
    <div className={'mobile-shade '+(mobileOpen?'shown':'')} onClick={()=>setMobileOpen(false)} />
    <aside className={'sidebar '+(mobileOpen?'opened':'')}>
      <div className="brand"><div className="logo"><Layers3 size={24}/></div><div><strong>StockEase</strong><small>School Supplies Store</small></div></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav>{menu.map(([key,label,Icon])=><button key={key} className={'nav-item '+(section===key?'active':'')} onClick={()=>select(key)}><Icon size={20}/>{label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="ready"><span className="ready-dot"/> Admin session active<small>School supplies inventory</small></div><small>StockEase v3.0 · {username}</small><button className="sidebar-logout" onClick={onLogout}><LogOut size={17}/> Logout</button></div>
    </aside>
    <div className="app-main">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={()=>setMobileOpen(true)}><Menu size={23}/></button><span>Workspace</span><ChevronRight size={17}/><strong>{menu.find(m=>m[0]===section)?.[1]}</strong></div><div className="topbar-right"><button className="text-button" onClick={load}><RefreshCw size={17}/> Refresh</button><button className="avatar avatar-button" title="Change password" aria-label="Change password" onClick={()=>setModal({kind:"password"})}>{username?.slice(0,2).toUpperCase()}</button><button className="text-button logout-button" onClick={onLogout}><LogOut size={18}/> Logout</button></div></header>
      <main className="page">
        {error && <div className="error-banner"><AlertTriangle size={20}/><span>{error}</span><button onClick={load}>Retry</button></div>}
        {loading ? <div className="loading">Loading inventory…</div> : <>
          {section === 'dashboard' && <>
            <div className="page-heading"><div><span className="eyebrow">YOUR INVENTORY OVERVIEW</span><h1>Dashboard <span className="sparkle">✦</span></h1><p>Here's what's happening with your school supplies inventory today.</p></div></div>
            <div className="stats">
              <div className="stat-card"><span>Total Products</span><div className="stat-icon green"><Boxes size={22}/></div><strong>{stats.count}</strong><small>Items in your catalog</small></div>
              <div className="stat-card"><span>Total Stock Units</span><div className="stat-icon blue"><Package size={22}/></div><strong>{stats.units}</strong><small>Available units in inventory</small></div>
              <div className="stat-card"><span>Low Stock Alerts</span><div className="stat-icon amber"><AlertTriangle size={22}/></div><strong>{stats.low}</strong><small>Items at or below their restock level</small></div>
              <div className="stat-card"><span>Inventory Value</span><div className="stat-icon pink"><PhilippinePeso size={22}/></div><strong className="money-value">{money(stats.value)}</strong><small>Based on unit prices</small></div>
            </div>
            <section className="panel wide-panel"><div className="panel-heading"><div><h2>Recently Added Products</h2><p>Your latest inventory additions</p></div><button className="link-button" onClick={()=>select('items')}>View all <ChevronRight size={17}/></button></div>
              {!items.length ? <div className="empty"><Package size={40}/><strong>No products yet</strong><p>Add your first school supply to get started.</p></div> : <div className="recent-grid">{items.slice(0,8).map(p=><article className="recent-product" key={p.id}>
                <Photo src={p.image} size="large"/>
                <div className="recent-info"><strong>{p.name}</strong><small>{p.category}</small><span className="recent-id">Item #{String(p.id).padStart(4,'0')}</span></div>
                <div className="recent-right"><strong>{p.quantity.toLocaleString('en-PH')} {p.unit}</strong><small>{money(p.unit_price)} per {p.unit.replace(/s$/,'')}</small><span className={'pill '+statusClass(p.quantity,p.low_stock_level)}>{statusText(p.quantity,p.low_stock_level)}</span></div>
              </article>)}</div>}
            </section>
            {stats.low > 0 && <section className="panel low-panel"><div className="panel-heading"><div><h2><AlertTriangle size={20}/> Low Stock Products</h2><p>These items need attention soon</p></div></div><div className="low-list">{items.filter(x=>x.quantity<=x.low_stock_level).map(p=><div key={p.id} className="low-row"><Photo src={p.image}/><div><strong>{p.name}</strong><small>{p.category}</small></div><span className={'pill '+statusClass(p.quantity,p.low_stock_level)}>{p.quantity} {p.unit} left</span><button className="outline-button" onClick={()=>openStock(p,'IN')}>Restock</button></div>)}</div></section>}
          </>}
          {section === 'items' && <><div className="page-heading"><div><span className="eyebrow">PRODUCT MANAGEMENT</span><h1>Manage Items</h1><p>Add, edit, organize and manage school supplies.</p></div><button className="primary-button" onClick={()=>openItem()}><Plus size={19}/> Add Item</button></div><section className="panel">{filters}<ProductTable items={filtered} onEdit={openItem} onDelete={deleteItem} onStock={openStock}/></section></>}
          {(section === 'stock-in' || section === 'stock-out') && <><div className="page-heading"><div><span className="eyebrow">STOCK MONITORING</span><h1>{section==='stock-in'?'Stock In':'Stock Out'}</h1><p>{section==='stock-in'?'Record new deliveries and increase inventory quantities.':'Record non-sale removals such as damaged or used supplies. Use Sales Management for sold items.'}</p></div></div><section className="panel">{filters}<div className="table-wrap"><table><thead><tr><th>ITEM</th><th>CATEGORY</th><th>AVAILABLE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{stockRows.map(p=><tr key={p.id}><td><div className="item-cell"><Photo src={p.image}/><span><strong>{p.name}</strong><small>{p.unit}</small></span></div></td><td>{p.category}</td><td>{p.quantity} {p.unit}</td><td><span className={'pill '+statusClass(p.quantity,p.low_stock_level)}>{statusText(p.quantity,p.low_stock_level)}</span></td><td><button className="small-primary" disabled={section==='stock-out'&&p.quantity===0} onClick={()=>openStock(p,section==='stock-in'?'IN':'OUT')}>{section==='stock-in'?'Add Stock':'Deduct Stock'}</button></td></tr>)}</tbody></table>{!stockRows.length&&<div className="empty"><Package size={38}/><strong>No items found</strong></div>}</div></section></>}
          {section === 'history' && <><div className="page-heading"><div><span className="eyebrow">ACTIVITY LOG</span><h1>Stock History</h1><p>All inventory changes are recorded here automatically.</p></div></div><section className="panel"><div className="table-wrap"><table><thead><tr><th>DATE & TIME</th><th>ITEM</th><th>TYPE</th><th>CHANGE</th><th>BEFORE → AFTER</th><th>NOTES</th></tr></thead><tbody>{movements.map(m=><tr key={m.id}><td>{dateText(m.date)}</td><td><strong>{m.item_name}</strong></td><td><span className={'pill '+(m.type==='OUT'?'out':m.type==='IN'?'good':'neutral')}>{m.type==='OPENING'?'Opening':m.type==='IN'?'Stock In':m.notes?.startsWith('Sale #')?'Sale':'Stock Out'}</span></td><td><strong className={m.type==='OUT'?'red-text':'green-text'}>{m.type==='OUT'?'-':'+'}{m.quantity}</strong></td><td>{m.before_qty} → {m.after_qty}</td><td>{m.notes || '—'}</td></tr>)}</tbody></table>{!movements.length&&<div className="empty"><History size={38}/><strong>No stock history yet</strong></div>}</div></section></>}
          {section === 'categories' && <>
            <div className="page-heading"><div><span className="eyebrow">ITEM ORGANIZATION</span><h1>Categories</h1><p>Click a category to see all its school supplies and remaining stock.</p></div></div>
            <section className="panel">
              <form className="inline-form" onSubmit={createCategory}>
                <input required placeholder="New category name" value={categoryName} onChange={e => setCategoryName(e.target.value)} maxLength={90}/>
                <button className="primary-button" disabled={busy}><Plus size={18}/> Add Category</button>
              </form>
              <div className="category-grid">
                {categories.map(c => {
                  const products = items.filter(i => i.category === c.name);
                  const lowCount = products.filter(i => i.quantity <= i.low_stock_level).length;
                  return <div className={'category-card category-selectable ' + (selectedCategory === c.name ? 'selected' : '')} key={c.id}>
                    <button type="button" className="category-view-button" aria-pressed={selectedCategory === c.name} onClick={() => setSelectedCategory(v => v === c.name ? null : c.name)}>
                      <span className="category-icon"><Tags size={22}/></span>
                      <span className="category-content"><strong>{c.name}</strong><small>{products.length} {products.length === 1 ? 'item' : 'items'}{lowCount > 0 ? ` · ${lowCount} low/out of stock` : ''}</small></span>
                      <ChevronRight size={20} className={selectedCategory === c.name ? 'category-chevron open' : 'category-chevron'}/>
                    </button>
                    <button type="button" className="icon-button danger-text" title={'Delete '+c.name} aria-label={'Delete category '+c.name} onClick={() => deleteCategory(c)}><Trash2 size={18}/></button>
                  </div>;
                })}
              </div>
            </section>
            {selectedCategory && <section className="panel category-detail" aria-live="polite">
              <div className="panel-heading"><div><h2>{selectedCategory}</h2><p>{categoryItems.length} school {categoryItems.length === 1 ? 'supply' : 'supplies'} in this category · Remaining stock by item</p></div><button className="outline-button" onClick={() => setSelectedCategory(null)}><X size={17}/> Close</button></div>
              {categoryItems.length ? <div className="category-items-list">
                {categoryItems.map(item => <article className="category-stock-row" key={item.id}>
                  <Photo src={item.image} size="large"/>
                  <div className="category-stock-info"><strong>{item.name}</strong><small>Item #{String(item.id).padStart(4,'0')} · {item.supplier_name || 'No supplier assigned'}</small></div>
                  <div className="category-stock-count"><strong>{item.quantity.toLocaleString('en-PH')} <span>{item.unit}</span></strong><small>Remaining stock</small></div>
                  <span className={'pill '+statusClass(item.quantity,item.low_stock_level)}>{statusText(item.quantity,item.low_stock_level)}</span>
                </article>)}
              </div> : <div className="empty"><Package size={36}/><strong>No items in this category</strong><p>Add an item from Manage Items and choose this category.</p></div>}
            </section>}
          </>}
          {section === 'suppliers' && <><div className="page-heading"><div><span className="eyebrow">SUPPLIER MANAGEMENT</span><h1>Suppliers</h1><p>Save and manage the people or businesses supplying your stock.</p></div><button className="primary-button" onClick={()=>openSupplier()}><Plus size={18}/> Add Supplier</button></div><section className="panel"><div className="table-wrap"><table><thead><tr><th>SUPPLIER</th><th>CONTACT PERSON</th><th>PHONE</th><th>ADDRESS</th><th>ITEMS</th><th>ACTIONS</th></tr></thead><tbody>{suppliers.map(s=><tr key={s.id}><td><strong>{s.name}</strong></td><td>{s.contact||'—'}</td><td>{s.phone||'—'}</td><td>{s.address||'—'}</td><td>{items.filter(i=>i.supplier_id===s.id).length}</td><td><div className="actions"><button onClick={()=>openSupplier(s)} title="Edit supplier"><Pencil size={18}/></button><button onClick={()=>deleteSupplier(s)} title="Delete supplier" className="danger-text"><Trash2 size={18}/></button></div></td></tr>)}</tbody></table>{!suppliers.length&&<div className="empty"><Truck size={38}/><strong>No suppliers yet</strong><p>Add a supplier to link them to your products.</p></div>}</div></section></>}
          {section === 'sales' && <>
            <div className="page-heading"><div><span className="eyebrow">SCHOOL SUPPLIES SALES</span><h1>Sales Management</h1><p>Record customer sales. Stock automatically decreases once; don't record the same sale under Stock Out.</p></div><button className="primary-button" onClick={()=>openSale()}><Plus size={19}/> New Sale</button></div>
            <div className="stats sales-stats">{[['Today',salesSummary.day],['This Week',salesSummary.week],['This Month',salesSummary.month],['All Time',salesSummary.all]].map(([label,s])=><div className="stat-card" key={label}><span>{label} Sales</span><strong className="money-value">{money(s.revenue)}</strong><small>{s.transactions} transactions · {s.units_sold} units sold</small></div>)}</div>
            <section className="panel"><div className="panel-heading"><div><h2>Recent Sales</h2><p>Saved sales transactions and their totals</p></div></div><div className="table-wrap"><table><thead><tr><th>DATE</th><th>SALE #</th><th>ITEM</th><th>QUANTITY</th><th>SELLING PRICE</th><th>TOTAL</th><th>NOTES</th></tr></thead><tbody>{sales.map(s=><tr key={s.id}><td>{dateText(s.sold_at)}</td><td>#{String(s.id).padStart(4,'0')}</td><td><strong>{s.item_name}</strong></td><td>{s.quantity} {s.unit}</td><td>{money(s.unit_price)}</td><td><strong>{money(s.total)}</strong></td><td>{s.notes||'—'}</td></tr>)}</tbody></table>{!sales.length&&<div className="empty"><ShoppingCart size={38}/><strong>No sales recorded yet</strong><p>Use New Sale to record your first transaction.</p></div>}</div></section>
          </>}
          {section === 'sales-reports' && <>
            <div className="page-heading"><div><span className="eyebrow">SALES REVENUE</span><h1>Sales Reports</h1><p>Daily, weekly, and monthly sales summaries in Philippine local time.</p></div><button className="primary-button no-print" onClick={printReport}><Printer size={19}/> Print Report</button></div>
            <div className="period-tabs no-print">{[['day','Daily'],['week','Weekly'],['month','Monthly']].map(([key,label])=><button key={key} className={salesPeriod===key?'active':''} onClick={()=>setSalesPeriod(key)}>{label}</button>)}</div>
            <div className="sales-print-only"><h2>StockEase Sales Report · {salesPeriod === 'day'?'Daily':salesPeriod === 'week'?'Weekly':'Monthly'}</h2><p>Generated: {new Date().toLocaleString('en-PH')}</p></div>
            <div className="stats report-stats"><div className="stat-card"><span>Total Revenue</span><strong className="money-value">{money(salesSummary[salesPeriod].revenue)}</strong></div><div className="stat-card"><span>Transactions</span><strong>{salesSummary[salesPeriod].transactions}</strong></div><div className="stat-card"><span>Units Sold</span><strong>{salesSummary[salesPeriod].units_sold}</strong></div></div>
            <section className="panel report-table"><div className="table-wrap"><table><thead><tr><th>DATE</th><th>ITEM</th><th>QTY</th><th>UNIT</th><th>PRICE</th><th>SALES TOTAL</th></tr></thead><tbody>{sales.filter(s=>isSaleWithinPeriod(s.sold_at,salesPeriod)).map(s=><tr key={s.id}><td>{dateText(s.sold_at)}</td><td>{s.item_name}</td><td>{s.quantity}</td><td>{s.unit}</td><td>{money(s.unit_price)}</td><td><strong>{money(s.total)}</strong></td></tr>)}</tbody></table>{!sales.some(s=>isSaleWithinPeriod(s.sold_at,salesPeriod))&&<div className="empty"><FileBarChart2 size={38}/><strong>No sales in this period</strong></div>}</div></section>
          </>}
          {section === 'reports' && <><div className="page-heading"><div><span className="eyebrow">INVENTORY REPORTS</span><h1>Inventory Reports</h1><p>View a summary of available items and print your inventory report.</p></div><button className="primary-button no-print" onClick={printReport}><Printer size={19}/> Print Report</button></div><div className="report-heading"><h2>StockEase · School Supplies Inventory Report</h2><p>Generated: {new Date().toLocaleString('en-PH')}</p></div><div className="stats report-stats"><div className="stat-card"><span>Total Products</span><strong>{stats.count}</strong></div><div className="stat-card"><span>Total Units</span><strong>{stats.units}</strong></div><div className="stat-card"><span>Low Stock Items</span><strong>{stats.low}</strong></div><div className="stat-card"><span>Inventory Value</span><strong className="money-value">{money(stats.value)}</strong></div></div><section className="panel report-table"><div className="table-wrap"><table><thead><tr><th>ITEM ID</th><th>ITEM NAME</th><th>CATEGORY</th><th>SUPPLIER</th><th>UNIT</th><th>QUANTITY</th><th>UNIT PRICE</th><th>VALUE</th><th>STATUS</th></tr></thead><tbody>{items.map(p=><tr key={p.id}><td>#{String(p.id).padStart(4,'0')}</td><td><strong>{p.name}</strong></td><td>{p.category}</td><td>{p.supplier_name||'—'}</td><td>{p.unit}</td><td>{p.quantity}</td><td>{money(p.unit_price)}</td><td>{money(p.quantity*p.unit_price)}</td><td>{statusText(p.quantity,p.low_stock_level)}</td></tr>)}</tbody></table></div></section></>}
        </>}
      </main>
      <footer>© {new Date().getFullYear()} StockEase · School Supplies Inventory Management System</footer>
    </div>

    {modal?.kind === 'item' && <Modal title={modal.item?'Edit School Supply':'Add New School Supply'} onClose={close}><form onSubmit={saveItem} className="modal-body">
      <div className="upload-area"><Photo src={form.image} size="large"/><div><strong>Item Picture</strong><p>Upload an image of the school supply (JPEG, PNG, WebP or GIF; max 2 MB).</p><div className="photo-actions"><label className="outline-button upload-button"><ImagePlus size={17}/> Choose Photo<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadPhoto} hidden/></label>{form.image&&<button className="text-button danger-text" type="button" onClick={()=>setForm(p=>({...p,image:null}))}>Remove Photo</button>}</div></div></div>
      <div className="form-grid">
        <label className="field">Item ID<span className="read-only">{modal.item?'#'+String(modal.item.id).padStart(4,'0'):'Assigned automatically after saving'}</span></label>
        <label className="field">Item Name *<input required maxLength={140} value={form.name} placeholder="e.g. Ballpen" onChange={e=>setForm(p=>({...p,name:e.target.value}))}/></label>
        <label className="field">Category *<select required value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))}>{categories.map(c=><option key={c.id}>{c.name}</option>)}</select></label>
        <label className="field">Unit *<select required value={form.unit} onChange={e=>setForm(p=>({...p,unit:e.target.value}))}>{['pieces','boxes','reams','packs','sets','bottles','rolls','bundles'].map(u=><option key={u}>{u}</option>)}</select></label>
        <label className="field">Quantity *<input type="number" min="0" step="1" required disabled={!!modal.item} value={form.quantity} onChange={e=>setForm(p=>({...p,quantity:e.target.value}))}/>{modal.item&&<small>Use Stock In / Stock Out to update the quantity.</small>}</label>
        <label className="field">Unit Price (₱) *<input required type="number" min="0" step="0.01" value={form.unit_price} placeholder="0.00" onChange={e=>setForm(p=>({...p,unit_price:e.target.value}))}/></label>
        <label className="field">Low Stock Alert Threshold *<input type="number" min="0" step="1" required value={form.low_stock_level ?? '5'} onChange={e=>setForm(p=>({...p,low_stock_level:e.target.value}))}/><small>Warn when remaining stock is at or below this quantity.</small></label>
        <label className="field">Supplier<select value={form.supplier_id ?? ''} onChange={e=>setForm(p=>({...p,supplier_id:e.target.value}))}><option value="">No supplier assigned</option>{suppliers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <label className="field">Date Added<span className="read-only">{modal.item?dateText(modal.item.date_added):'Set automatically on creation'}</span></label>
        <label className="field">Stock Status<span className="read-only">{statusText(Number(form.quantity),Number(form.low_stock_level ?? 5))}</span></label>
        <label className="field field-full">Description<textarea rows="3" maxLength={1000} value={form.description} placeholder="Brand, color, size, or other details..." onChange={e=>setForm(p=>({...p,description:e.target.value}))}/></label>
      </div><div className="modal-actions"><button type="button" className="outline-button" onClick={close}>Cancel</button><button disabled={busy} className="primary-button">{busy?'Saving...':modal.item?'Save Changes':'Add Item'}</button></div>
    </form></Modal>}
    {modal?.kind === 'sale' && <Modal title="Record New Sale" onClose={close}><form className="modal-body" onSubmit={saveSale}>
      <label className="field">School Supply *<select required value={saleForm.item_id} onChange={e=>{const product=items.find(x=>String(x.id)===e.target.value);setSaleForm(p=>({...p,item_id:e.target.value,unit_price:product?String(product.unit_price):''}));}}><option value="">Choose available item</option>{items.filter(p=>p.quantity>0).map(p=><option key={p.id} value={p.id}>{p.name} · {p.quantity} {p.unit} available</option>)}</select></label>
      {(()=>{const p=items.find(i=>String(i.id)===String(saleForm.item_id));return p&&<div className="stock-selected"><Photo src={p.image}/><div><strong>{p.name}</strong><small>{p.quantity} {p.unit} available · Sale will deduct this quantity</small></div></div>;})()}
      <div className="form-grid"><label className="field">Quantity Sold *<input type="number" min="1" max={items.find(p=>String(p.id)===String(saleForm.item_id))?.quantity} step="1" required value={saleForm.quantity} onChange={e=>setSaleForm(p=>({...p,quantity:e.target.value}))}/></label>
      <label className="field">Selling Price per Unit (₱) *<input type="number" min="0" step="0.01" required value={saleForm.unit_price} onChange={e=>setSaleForm(p=>({...p,unit_price:e.target.value}))}/></label></div>
      <div className="sale-total">Total Sale <strong>{money(Number(saleForm.quantity||0)*Number(saleForm.unit_price||0))}</strong></div>
      <label className="field">Notes (Optional)<textarea rows="2" maxLength={300} value={saleForm.notes} onChange={e=>setSaleForm(p=>({...p,notes:e.target.value}))}/></label>
      <div className="modal-actions"><button className="outline-button" type="button" onClick={close}>Cancel</button><button disabled={busy||!saleForm.item_id} className="primary-button">{busy?'Saving...':'Confirm Sale & Deduct Stock'}</button></div>
    </form></Modal>}
    {modal?.kind === 'stock' && <Modal title={modal.type==='IN'?'Stock In':'Stock Out'} onClose={close}><form className="modal-body" onSubmit={saveStock}><div className="stock-selected"><Photo src={modal.item.image} size="large"/><div><strong>{modal.item.name}</strong><small>Currently available: {modal.item.quantity} {modal.item.unit}</small></div></div><label className="field">Quantity *<input required type="number" min="1" max={modal.type==='OUT'?modal.item.quantity:undefined} step="1" value={stockForm.quantity} onChange={e=>setStockForm(p=>({...p,quantity:e.target.value}))}/></label><label className="field">Notes<textarea rows="3" value={stockForm.notes} maxLength={300} placeholder={modal.type==='IN'?'e.g. New delivery':'e.g. Damaged, missing, or used (record sold items in Sales Management)' } onChange={e=>setStockForm(p=>({...p,notes:e.target.value}))}/></label><div className="modal-actions"><button className="outline-button" type="button" onClick={close}>Cancel</button><button disabled={busy||modal.type==='OUT'&&modal.item.quantity===0} className="primary-button">{busy?'Saving...':modal.type==='IN'?'Confirm Stock In':'Confirm Stock Out'}</button></div></form></Modal>}
    {modal?.kind === 'supplier' && <Modal title={modal.supplier?'Edit Supplier':'Add Supplier'} onClose={close}><form className="modal-body" onSubmit={saveSupplier}><div className="form-grid"><label className="field">Supplier Name *<input required maxLength={140} value={supplierForm.name} onChange={e=>setSupplierForm(p=>({...p,name:e.target.value}))}/></label><label className="field">Contact Person<input maxLength={150} value={supplierForm.contact} onChange={e=>setSupplierForm(p=>({...p,contact:e.target.value}))}/></label><label className="field">Phone Number<input maxLength={150} value={supplierForm.phone} onChange={e=>setSupplierForm(p=>({...p,phone:e.target.value}))}/></label><label className="field field-full">Address<input maxLength={250} value={supplierForm.address} onChange={e=>setSupplierForm(p=>({...p,address:e.target.value}))}/></label></div><div className="modal-actions"><button className="outline-button" type="button" onClick={close}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving...':'Save Supplier'}</button></div></form></Modal>}
    {modal?.kind === 'password' && <Modal title="Change Admin Password" onClose={close}><form className="modal-body" onSubmit={e=>{e.preventDefault(); run(async()=>{await api('/auth/password',{method:'POST',body:JSON.stringify(passwordForm)}); await onLogout();});}}><label className="field">Current Password<input type="password" required value={passwordForm.currentPassword} onChange={e=>setPasswordForm(p=>({...p,currentPassword:e.target.value}))}/></label><label className="field">New Password (10+ characters)<input type="password" required minLength={10} value={passwordForm.newPassword} onChange={e=>setPasswordForm(p=>({...p,newPassword:e.target.value}))}/></label><div className="modal-actions"><button type="button" className="outline-button" onClick={close}>Cancel</button><button className="primary-button" disabled={busy}>Update Password</button></div></form></Modal>}
    {toast&&<div className="toast"><CheckCircle2 size={19}/>{toast}<button onClick={()=>setToast('')} aria-label="Dismiss message"><X size={17}/></button></div>}
  </div>;
}


function AdminGateway({ setupRequired, onAuthenticated }) {
  const [credentials, setCredentials] = useState({username:'',password:'',confirm:''});
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async e => {
    e.preventDefault(); setMessage('');
    if (setupRequired && credentials.password !== credentials.confirm) {setMessage('Passwords do not match.');return;}
    setBusy(true);
    try {
      const result = await api(setupRequired ? '/auth/setup' : '/auth/login', {
        method:'POST', body:JSON.stringify({username:credentials.username,password:credentials.password})
      });
      onAuthenticated(result.username);
    } catch(e){setMessage(e.message);} finally{setBusy(false);}
  };
  return <div className="auth-screen"><div className="auth-panel">
    <div className="auth-brand"><span className="auth-logo"><Layers3 size={30}/></span><div><strong>StockEase</strong><small>School Supplies Inventory</small></div></div>
    <div className="auth-icon"><LockKeyhole size={28}/></div>
    <h1>{setupRequired?'Create your Admin Account':'Welcome back, Admin!'}</h1>
    <p>{setupRequired?'First-time setup: create the only administrator for this inventory.':'Sign in to manage your school supplies inventory.'}</p>
    {message && <div className="auth-error" role="alert">{message}</div>}
    <form onSubmit={submit} className="auth-form">
      <label>Admin Username<input required autoComplete="username" minLength={3} maxLength={40} value={credentials.username} placeholder="Enter admin username" onChange={e=>setCredentials(v=>({...v,username:e.target.value}))}/></label>
      <label>Password<div className="password-wrap"><input required minLength={setupRequired?10:undefined} autoComplete={setupRequired?'new-password':'current-password'} type={showPassword?'text':'password'} value={credentials.password} placeholder="Enter password" onChange={e=>setCredentials(v=>({...v,password:e.target.value}))}/><button type="button" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={20}/>:<Eye size={20}/>}</button></div></label>
      {setupRequired&&<label>Confirm Password<input required type="password" autoComplete="new-password" minLength={10} value={credentials.confirm} placeholder="Repeat password" onChange={e=>setCredentials(v=>({...v,confirm:e.target.value}))}/></label>}
      {setupRequired&&<small className="auth-hint">Use at least 10 characters. Save your password safely; there is no email recovery in this local project.</small>}
      <button className="primary-button auth-submit" disabled={busy}>{busy?'Please wait…':setupRequired?'Create Admin & Continue':'Login to StockEase'}</button>
    </form>
    <div className="auth-footer">Single Admin Access · Mint Green Edition</div>
  </div></div>;
}

export default function App() {
  const [auth, setAuth] = useState({checking:true,setupRequired:false,username:null});
  useEffect(()=>{
    let active=true;
    api('/auth/status').then(result=>{if(active)setAuth({checking:false,...result});})
      .catch(e=>{if(active)setAuth({checking:false,setupRequired:false,username:null,error:e.message});});
    return ()=>{active=false;};
  },[]);
  const signOut=async()=>{
    try {await api('/auth/logout',{method:'POST'}); setAuth(v=>({...v,authenticated:false,username:null}));}
    catch(e){window.alert('Logout failed: '+e.message);}
  };
  if(auth.checking) return <div className="auth-screen"><div className="auth-panel"><h2>Loading StockEase…</h2></div></div>;
  if(auth.error) return <div className="auth-screen"><div className="auth-panel"><h2>Unable to connect</h2><p>{auth.error}</p><button className="primary-button" onClick={()=>window.location.reload()}>Retry</button></div></div>;
  if(!auth.authenticated) return <AdminGateway key={String(auth.setupRequired)} setupRequired={auth.setupRequired} onAuthenticated={username=>setAuth(v=>({...v,authenticated:true,setupRequired:false,username}))} />;
  return <InventoryApp username={auth.username} onLogout={signOut}/>;
}
