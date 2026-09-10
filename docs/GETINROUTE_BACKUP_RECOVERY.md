# GetInRoute — Backup & Recovery

How the system protects data, how to do manual tiers, and how to restore safely.

## Automatic

- **On start + every 24 h**: the server snapshots the DB safely into
  `data\backups\getinroute.db.<timestamp>.bak` (kept 14 days by `BACKUP_KEEP`).
- **Graceful shutdown** also snapshots + checkpoints the WAL.

## One-click tiered backups (recommended daily)

`BACKUP_GETINROUTE.bat` runs `backup-run.js`, which:

1. runs a read-only integrity check on the LIVE db (aborts if it fails — the
   live file is never touched),
2. takes a consistent snapshot with SQLite `VACUUM INTO` (safe while the server
   runs),
3. verifies the copy's integrity (backup must pass its own integrity check),
4. writes to `D:\GetInRoute\backups\daily\getinroute_YYYY-MM-DD_HHMMSS.db`,
5. promotes copies to `weekly\` (Sundays) and `monthly\` (1st of month),
6. prunes old files per retention (daily 14 / weekly 8 / monthly 12),
   **never deleting the last remaining file**,
7. optionally copies to `OFF_SITE_DIR` (set in `.env`) for off-machine storage.

Every new backup is validated before it is kept — a backup that fails its own
integrity check is discarded, not kept.

## Restore — `RECOVER_GETINROUTE.bat`

1. Diagnoses: backend state, DB exists, DB integrity, disk space, backup list.
2. Integrity FAIL on the live DB → **STOP; preserve the current file as
   evidence; do not auto-overwrite; show backups; ask for a deliberate manual
   restore.**
3. If you choose to restore (interactive, type `RESTORE` to confirm):
   - stops the backend,
   - verifies the chosen backup's integrity,
   - preserves the current DB as `getinroute.db.pre-restore-<timestamp>`,
   - copies the verified backup into place,
   - leaves the server stopped; you run `START_GETINROUTE.bat`.

The 3-2-1 guideline: (1) local backups, (2) a weekly USB/other-PC copy,
(3) optionally `OFF_SITE_DIR` (for later, not forced now). The files hold
rider/personal data — keep them private.

## Restore drill (safe, on a temp copy)

1. Copy the newest `backups\daily\getinroute_*.db` to a scratch folder.
2. Open read-only (e.g. DB Browser for SQLite): `users` and `schedules` have rows.
3. Run `node D:\GetInRoute\backend\db-check.js <scratch\copy.db>` → `RESULT: PASS`.

## Never

- Do not copy over `data\getinroute.db` while the server runs — use RECOVER.
- Do not store only one backup in one place.
- Do not put off-site credentials into `.env` (put them in the service/vault).