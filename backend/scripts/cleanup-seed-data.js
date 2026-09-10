// One-time production purge of seed demo DRIVERS + SPEED-ALERT data.
//
// Scope (per user decision): delete only seed fake drivers (D2001-D2012,
// emails @getinroute.com) and the fake demo data they generated:
//   - speed_events for their seed vehicles (e.g. "Volvo AC Bus")
//   - chat_messages involving those drivers
//   - notifications for those drivers + seed "Speed Limit Breached" rows
//   - seed "Speed alert" sms_log rows
//   - the seed vehicles they are assigned to
// Real employees, routes, schedules and any non-seed data are LEFT UNTOUCHED.
//
// Safety:
//   - Default is DRY-RUN (prints a full report, deletes nothing).
//   - Pass --commit to actually delete. Run under `railway up` at deploy time
//     so DB_PATH points at the production /data volume exactly like db.js does.
//
// Usage:
//   node scripts/cleanup-seed-data.js          # dry-run report
//   node scripts/cleanup-seed-data.js --commit # actually delete

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || '/data/getinroute.db';
const COMMIT = process.argv.includes('--commit');

if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}. Refusing to proceed.`);
  process.exit(1);
}

console.log(`Target DB : ${DB_PATH}`);
console.log(`Mode      : ${COMMIT ? 'COMMIT (will delete)' : 'DRY-RUN (report only)'}`);
console.log('---');

const db = new DatabaseSync(DB_PATH);

function q(sql, ...params) {
  return db.prepare(sql).all(...params);
}
function q1(sql, ...params) {
  return db.prepare(sql).get(...params);
}

// 1) Seed drivers = role driver with the demo email pattern.
const drivers = q(
  `SELECT id, emp_id, name, email, vehicle_id, last_login
     FROM users
    WHERE role='driver' AND email LIKE 'd%@getinroute.com'`
);

// 2) Vehicles those drivers are assigned to + known seed vehicles (exact plates
//    / demo names) even if a driver's vehicle_id is NULL.
const seedVehicles = q(
  `SELECT id, vehicle_name, plate FROM vehicles
    WHERE plate LIKE 'KA-0%' OR vehicle_name IN
      ('Volvo AC Bus','Force Traveller','Maruti Ertiga','Toyota Innova',
       'Tata Nexon EV','Mahindra XUV700','Swift Dzire','Hyundai Creta',
       'Mini Van','Sedan AC','Kia Carens','Tempo Traveller')`
);
const seedVehIds = [...new Set([...drivers.map(d => d.vehicle_id).filter(Boolean), ...seedVehicles.map(v => v.id)])];

const inVeh = seedVehIds.length ? seedVehIds.map(() => '?').join(',') : 'NULL';
const driverIds = drivers.map(d => d.id);
const inUid = driverIds.length ? driverIds.map(() => '?').join(',') : 'NULL';
const uidArgs = driverIds.length ? [...driverIds, ...driverIds] : [];

const counts = {
  drivers: drivers.length,
  driver_names: drivers.map(d => `${d.emp_id} ${d.name} <${d.email}> last_login=${d.last_login || 'NULL'}`),
  seed_vehicles: seedVehicles.map(v => `${v.id} ${v.vehicle_name} <${v.plate}>`),
  speed_events: seedVehIds.length
    ? q1(`SELECT COUNT(*) c FROM speed_events WHERE vehicle_id IN (${inVeh})`, ...seedVehIds).c : 0,
  chat_messages: driverIds.length
    ? q1(`SELECT COUNT(*) c FROM chat_messages WHERE sender_id IN (${inUid}) OR receiver_id IN (${inUid})`, ...uidArgs).c : 0,
  notifications_for_drivers: driverIds.length
    ? q1(`SELECT COUNT(*) c FROM notifications WHERE user_id IN (${inUid})`, ...driverIds).c : 0,
  seed_speed_notifications: q1(`SELECT COUNT(*) c FROM notifications WHERE title LIKE '%Speed Limit Breached%'`).c,
  seed_sms_alert_rows: q1(`SELECT COUNT(*) c FROM sms_log WHERE message LIKE '%Speed alert%' OR message LIKE '%Speed Limit Breached%'`).c,
};

console.log('=== REPORT ===');
console.log('seed drivers               :', counts.drivers);
counts.driver_names.forEach(n => console.log('    ', n));
console.log('seed vehicles              :', counts.seed_vehicles.length);
counts.seed_vehicles.forEach(v => console.log('    ', v));
console.log('speed_events (vehicles)    :', counts.speed_events);
console.log('chat_messages (drivers)    :', counts.chat_messages);
console.log('notifications (drivers)    :', counts.notifications_for_drivers);
console.log('"Speed Limit Breached"     :', counts.seed_speed_notifications);
console.log('sms "Speed alert" rows     :', counts.seed_sms_alert_rows);

if (!COMMIT) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --commit to delete.');
  process.exit(0);
}

console.log('\n=== DELETING ===');
db.exec('PRAGMA foreign_keys=OFF;');
try {
  if (seedVehIds.length) {
    const n = db.prepare(`DELETE FROM speed_events WHERE vehicle_id IN (${inVeh})`).run(...seedVehIds).changes;
    console.log('deleted speed_events      :', n);
  }
  if (driverIds.length) {
    const n = db.prepare(`DELETE FROM chat_messages WHERE sender_id IN (${inUid}) OR receiver_id IN (${inUid})`).run(...uidArgs).changes;
    console.log('deleted chat_messages     :', n);
    const nn = db.prepare(`DELETE FROM notifications WHERE user_id IN (${inUid})`).run(...driverIds).changes;
    console.log('deleted notifications uid :', nn);
  }
  db.prepare(`DELETE FROM notifications WHERE title LIKE '%Speed Limit Breached%'`).run();
  db.prepare(`DELETE FROM sms_log WHERE message LIKE '%Speed alert%' OR message LIKE '%Speed Limit Breached%'`).run();
  if (seedVehIds.length) {
    const n = db.prepare(`DELETE FROM vehicles WHERE id IN (${inVeh})`).run(...seedVehIds).changes;
    console.log('deleted vehicles          :', n);
  }
  if (driverIds.length) {
    const n = db.prepare(`DELETE FROM users WHERE id IN (${inUid})`).run(...driverIds).changes;
    console.log('deleted seed drivers      :', n);
  }
} finally {
  db.exec('PRAGMA foreign_keys=ON;');
}
console.log('\nDone.');
