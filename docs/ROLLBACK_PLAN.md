# GetInRoute — Rollback Plan (Railway migration)

Rollback target state: production runs from the ORIGINAL Windows PC (SQLite)
exactly as before this project. The cloud path is additive; nothing local is
destroyed at any point.

## Invariants (never violated)
1. `data\getinroute.db` is the protected source of truth. pg-migrate opens it
   READ-ONLY. No cloud step ever deletes, overwrites, or writes to it.
2. The pre-migration snapshot is kept in `migration-backups\`:
   `pre-railway-getinroute.db` (+ the auto snapshots already in data\backups).
3. Registrar + DNS changes are performed only by the user and are reversible
   in < 5 minutes by removing the two CNAME records.

## Decision gate (before EVERY stage)
Compare the Railway Postgres row counts with the SQLite source and with the
previous stage's report. If production data ever differs and the delta is NOT
the result of an explicitly accepted new write, STOP and roll back.

## Rollback triggers
- Gate V3/V4 count mismatch that is not explainable.
- /health on the temporary deployment reports db down for > 2 minutes.
- Payment/auth/sensitive endpoint regression discovered in Stage 5 acceptance.
- User decision: "abort" at any review.

## Rollback actions (in order)
1. Cloudflare: delete the two CNAME records (www + @). DNS reverts to NO
   GetInRoute records for those hosts — the site pauses; nothing is deleted.
   (Safe window: only live traffic is affected, which is consistent with "PC
   may be offline", so no users were relying on it unless we did GO.)
2. Railway: stop the backend service (or `railway down`). Postgres plugin
   volume is left intact so we can re-attempt later. No data removed.
3. Restore windows-PC hosting if required:
   - services already installed (GetInRoute Backend stays Running/AUTO).
   - `START_CADDY.bat` + Docker-compatible? No — plain Node + Caddy.
     Start backend `node server.js`; Caddy already configured for
     www.getinroute.in. Once user re-adds DNS records back to the PC's
     public IP (GoDaddy/Cloudflare A records), the old stack is live again.
4. Verify rollback: local `/health` 200, mobile login works, recent data
   still visible (all pre-migration data lives in SQLite forever).

## "Restore into fresh" procedure (only if Railway PG is ever lost)
Do NOT restore a stale snapshot over a newer Railway database. Sequence:
1. Confirm/export latest SQLite snapshot + any Railway-only writes that were
   accepted as production (list them in the report).
2. Fresh Railway Postgres volume.
3. Run pg-migrate --apply from the agreed snapshot.
4. Re-run Stage 5 acceptance before pointing DNS back.

## Post-GO rollback (if we went live and must unwind)
1. Cloudflare: change the 2 CNAMEs back to A records for the PC public IP
   (user + ISP-dependent, requires the PC online again).
2. Keep Railway service stopped (not deleted) so production data is preserved
   for later comparison.
3. Downtime is the price of the PC being non-redundant; the GO decision must
   already have accepted this. Never both-live without an explicit user call.