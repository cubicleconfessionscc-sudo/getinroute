const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.DB_PATH || 'getinroute.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
for (const tn of tables) {
  try { console.log(tn + ': ' + db.prepare('SELECT COUNT(*) c FROM "' + tn + '"').get().c); }
  catch (e) { console.log(tn + ': err'); }
}
console.log('---users roles---');
console.log(JSON.stringify(db.prepare('SELECT role, COUNT(*) n, vertical FROM users GROUP BY role, vertical').all()));
console.log('---admins---');
console.log(JSON.stringify(db.prepare("SELECT id, role, emp_id, email, name, vertical, approved, status FROM users WHERE role='admin'").all()));
console.log('---sample employee---');
console.log(JSON.stringify(db.prepare("SELECT id, role, emp_id, email, name, approved, status, vertical FROM users WHERE role='employee' LIMIT 3").all()));
console.log('---sample driver---');
console.log(JSON.stringify(db.prepare("SELECT id, role, emp_id, email, name, approved, status, vehicle_id, vertical FROM users WHERE role='driver' LIMIT 3").all()));
console.log('---vendors---');
console.log(JSON.stringify(db.prepare('SELECT id, name, email, status, vendor_code FROM vendors').all()));
console.log('---settings id 1 keys---');
const s = JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get().data);
console.log(Object.keys(s).join(', '));
console.log('---latest import-style tables?---');
console.log(JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%import%' OR name LIKE '%raw%' OR name LIKE '%audit%')").all()));