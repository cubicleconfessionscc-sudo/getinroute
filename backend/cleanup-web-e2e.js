const { Client } = require('pg');
async function hasTable(c, n) { const r = await c.query("SELECT to_regclass('public.'||$1) t", [n]); return !!(r.rows[0] && r.rows[0].t); }
async function hasCol(c, t, col) { const r = await c.query('SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2', [t, col]); return r.rowCount > 0; }
async function del(c, t, col, ids, out) {
  if (!ids || !ids.length || !(await hasTable(c, t)) || !(await hasCol(c, t, col))) return;
  const r = await c.query(`DELETE FROM ${t} WHERE ${col} = ANY($1::bigint[])`, [ids]);
  if (r.rowCount) out.push(`${t}.${col}:${r.rowCount}`);
}
async function delText(c, t, col, vals, out) {
  if (!vals.length || !(await hasTable(c, t)) || !(await hasCol(c, t, col))) return;
  const r = await c.query(`DELETE FROM ${t} WHERE ${col} = ANY($1::text[])`, [vals]);
  if (r.rowCount) out.push(`${t}.${col}:${r.rowCount}`);
}
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await c.connect();
  const CID = 57;
  const users = (await c.query("SELECT id FROM users WHERE lower(email) LIKE 'web.e2e.%'")).rows.map((r) => r.id);
  const vendors = (await c.query("SELECT id,email FROM vendors WHERE lower(email) LIKE 'web.e2e.%'")).rows;
  const vendorEmails = vendors.map((v) => v.email);
  const vendorIds = vendors.map((v) => v.id);
  const states = (await c.query('SELECT id FROM company_states WHERE company_id=$1', [CID])).rows.map((r) => r.id);
  const cities = (await c.query('SELECT id FROM company_cities WHERE company_id=$1', [CID])).rows.map((r) => r.id);
  const locs = (await c.query('SELECT id FROM company_locations WHERE company_id=$1', [CID])).rows.map((r) => r.id);
  const vehicles = (await c.query("SELECT id FROM vehicles WHERE vehicle_name ILIKE 'Web E2E%' OR vendor_id = ANY($1::bigint[])", [vendorIds])).rows.map((r) => r.id);
  const routes = (await c.query("SELECT id FROM routes WHERE name ILIKE 'Web E2E%'")).rows.map((r) => r.id);
  const schedules = users.length ? (await c.query('SELECT id FROM schedules WHERE employee_id = ANY($1::bigint[])', [users])).rows.map((r) => r.id) : [];
  console.log('users', users, '| vendors', vendors, '| states', states, '| cities', cities, '| locations', locs, '| vehicles', vehicles, '| routes', routes);
  const out = [];
  await c.query('BEGIN');
  try {
    for (const col of ['schedule_id', 'employee_id']) await del(c, 'trip_events', col, col === 'schedule_id' ? schedules : users, out);
    for (const col of ['schedule_id', 'user_id']) await del(c, 'checkins', col, col === 'schedule_id' ? schedules : users, out);
    for (const col of ['schedule_id', 'user_id']) await del(c, 'feedback', col, col === 'schedule_id' ? schedules : users, out);
    for (const t of ['driver_duty_sessions', 'driver_assignment_events', 'driver_locations', 'driver_heartbeats']) {
      if (await hasCol(c, t, 'driver_id')) await del(c, t, 'driver_id', users, out);
    }
    await del(c, 'parking_events', 'driver_id', users, out);
    await del(c, 'parking_events', 'vehicle_id', vehicles, out);
    await del(c, 'speed_events', 'vehicle_id', vehicles, out);
    await del(c, 'login_events', 'user_id', users, out);
    await del(c, 'notifications', 'user_id', users, out);
    await del(c, 'trip_chat_messages', 'sender_id', users, out);
    await del(c, 'schedules', 'employee_id', users, out);
    for (const t of ['route_vendors', 'route_employees', 'route_stops']) {
      if (await hasTable(c, t)) {
        await del(c, t, 'route_id', routes, out);
        await del(c, t, 'vendor_id', vendorIds, out);
      }
    }
    await del(c, 'vehicles', 'id', vehicles, out);
    await del(c, 'routes', 'id', routes, out);
    await del(c, 'driver_invites', 'vendor_id', vendorIds, out);
    if (await hasCol(c, 'driver_invites', 'company_id')) await del(c, 'driver_invites', 'company_id', [CID], out);
    await del(c, 'location_codes', 'company_location_id', locs, out);
    await del(c, 'company_addresses', 'company_location_id', locs, out);
    await del(c, 'company_locations', 'id', locs, out);
    await del(c, 'company_cities', 'id', cities, out);
    await del(c, 'company_states', 'id', states, out);
    await del(c, 'users', 'id', users, out);
    await delText(c, 'vendors', 'email', vendorEmails, out);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); console.error('FAILED, rolled back:', e.message); process.exit(1); }
  const leftUsers = (await c.query("SELECT count(*)::int n FROM users WHERE lower(email) LIKE 'web.e2e.%'")).rows[0].n;
  const leftVendors = (await c.query("SELECT count(*)::int n FROM vendors WHERE lower(email) LIKE 'web.e2e.%'")).rows[0].n;
  const leftLocs = (await c.query('SELECT count(*)::int n FROM company_locations WHERE company_id=$1', [CID])).rows[0].n;
  console.log('deleted:', out.join(' | ') || 'nothing');
  console.log('remaining web-e2e users:', leftUsers, '| vendors:', leftVendors, '| company locations:', leftLocs);
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
