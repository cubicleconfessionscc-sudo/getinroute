const { DatabaseSync } = require('node:sqlite');
for (const arg of process.argv.slice(2)) {
  const db = new DatabaseSync(arg, { readOnly: true });
  console.log('=== DB:', arg);
  const tables = ['users','schools','student_profiles','vehicles','routes','schedules','parent_children','sos_events','geofence_events','checkins','nodal_points','vendors','address_updates'];
  for (const t of tables) {
    try { const n = db.prepare('SELECT COUNT(*) c FROM ' + t).get().c; console.log('  ' + t.padEnd(18), n); }
    catch (e) { console.log('  ' + t.padEnd(18), '(none)'); }
  }
  try {
    const owners = db.prepare("SELECT id,role,emp_id,email,vertical,school_id,approved FROM users WHERE emp_id='ADMIN' OR email='admin@getinroute.com'").all();
    console.log('  owner row(s):', JSON.stringify(owners));
  } catch (e) { console.log('  owner query err:', e.message); }
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all().map(r=>r.name);
  console.log('  users cols:', cols.join(','));
}
