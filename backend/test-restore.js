/* Backup/restore test. Mirrors what the server's backupNow() does:
     1. seed a real DB (schema via db.js), insert rows
     2. VACUUM INTO a timestamped snapshot in <DB_DIR>/backups (like the server)
     3. damage the live DB (delete the rows)
     4. restore by copying the snapshot back over the live file
     5. verify the data is back and the snapshot itself is a valid standalone DB
   Cleanup in finally. */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gir-restore-'));
const DB_FILE = path.join(TMP, 'app.db');
const BACKUP_DIR = path.join(TMP, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`); }
};

process.env.DB_PATH = DB_FILE;
const db = require('./db');
const hash = bcrypt.hashSync('Restore123!', 10);
for (let i = 1; i <= 3; i++) {
  db.prepare(`INSERT INTO users (role, emp_id, email, name, password_hash, approved, status)
      VALUES ('employee',?,?,?,?,1,'active')`).run('R-' + i, `r${i}@test.com`, 'Restore ' + i, hash);
}
db.prepare(`INSERT INTO vehicles (vehicle_name, plate, type, capacity, line, trip, status, vertical)
    VALUES ('Restore Van','KA-RS-1','Cab',4,1,1,'idle','company')`).run();

function sealDest() { return path.join(BACKUP_DIR, `getinroute.db.${Date.now()}.bak`); }
const snapshot = sealDest();
db.exec('VACUUM INTO \'' + snapshot.replace(/'/g, "''") + '\'');
const originalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
const originalVeh = db.prepare('SELECT COUNT(*) c FROM vehicles').get().c;
check('snapshot created', fs.existsSync(snapshot) && fs.statSync(snapshot).size > 0);
db.close();

// ---- damage the live DB ----
let live = new DatabaseSync(DB_FILE);
live.exec('DELETE FROM users');
live.close();
let damaged = new DatabaseSync(DB_FILE);
check('live DB damaged (0 users)', damaged.prepare('SELECT COUNT(*) c FROM users').get().c === 0);
damaged.close();

// ---- restore: snapshot back over the live file ----
fs.copyFileSync(snapshot, DB_FILE);
const restored = new DatabaseSync(DB_FILE);
const afterUsers = restored.prepare('SELECT COUNT(*) c FROM users').get().c;
const afterVeh = restored.prepare('SELECT COUNT(*) c FROM vehicles').get().c;
check('restore brings users back', afterUsers === originalUsers && afterUsers === 3, { afterUsers, originalUsers });
check('restore brings vehicles back', afterVeh === originalVeh && afterVeh === 1, { afterVeh, originalVeh });
const emp = restored.prepare("SELECT email FROM users WHERE emp_id='R-1'").get();
check('restored row content intact', emp?.email === 'r1@test.com', emp);
restored.close();

// ---- the snapshot is itself a valid, portable DB ----
const sn = new DatabaseSync(snapshot);
check('backup opens standalone with data', sn.prepare('SELECT COUNT(*) c FROM users').get().c === 3);
sn.close();

console.log(`\nRestore results: ${pass} passed, ${fail} failed`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);