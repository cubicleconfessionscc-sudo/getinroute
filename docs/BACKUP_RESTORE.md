# GetInRoute — Backup & Restore

Three layers, independent of each other:

1. Local SQLite snapshots (Windows PC-era) — auto + manual.
2. Railway PostgreSQL native backups (production).
3. Off-project copies of the migration reports + the blue/green decision logs.

## 1. Local SQLite (source of truth for migrations)

- On boot/shutdown `backupNow()` snapshots `data\getinroute.db` -> `data\backups\`
  (kept BACKUP_KEEP=14, plus WAL). `server.js:5277`.
- Tiered daily/weekly/monthly copies live in `D:\GetInRoute\backups\` (see
  BACKUP_* env). OFF_SITE_DIR optional secondary copy.
- Migration-time snapshot is pinned in `migration-backups\pre-railway-*.db`.
  These are read-only artifacts by convention.

Restore (pre-cloud): stop the backend, replace `data\getinroute.db`, delete
stale `-wal`/`-shm`, start backend. Keep a copy of the pre-restore file first.

## 2. PostgreSQL (production on Railway)

- Railway "PostgreSQL" plugin provides automated backups (dashboard:
  Database → Backups). Configure the retention you want; verify one restore
  during STAGE 5.
- The app's `backupNow()` is a no-op in PG mode (`DATABASE_URL` set) —
  platform backups are the mechanism. Do not set DB_PATH on Railway.

Restore a Railway PG backup:
- Railway dashboard → PostgreSQL service → Backups → choose snapshot →
  Restore. Prefer restoring to a NEW instance, then point DATABASE_URL at it,
  verify /health + a login, THEN drop the old instance. Never restore over the
  live database "in place" while traffic is writing.

## 3. Reports / evidence

- pg-migrate writes `migration-backups\pg-migration-report.json` each run.
  Keep one per stage; they are the audit trail for GO/NO-GO.
- After GO, keep the migration-backups folder in the repo (gitignored → push a
  copy to an off-project location manually; it is not sensitive — it contains
  no row data, only counts and aggregated warnings).

## Scheduled practice
- Weekly: verify Railway backup exists + is restorable (dashboard).
- Monthly: smoke-restore to a scratch database and run `/health` + owner login.