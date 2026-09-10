// GetInRoute - backup checkpoint helper (used by BACKUP.bat)
// Opens the SQLite DB read-write, runs a WAL checkpoint(TRUNCATE) so the
// .db file copy made afterwards is self-consistent, then closes.
// Usage: node backup-checkpoint.js [absolute-or-relative-db-path]
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = process.argv[2] || 'D:/GetInRoute/data/getinroute.db';
const db = new DatabaseSync(path);
try {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  console.log('WAL checkpoint(TRUNCATE) completed for ' + path);
} finally {
  db.close();
}