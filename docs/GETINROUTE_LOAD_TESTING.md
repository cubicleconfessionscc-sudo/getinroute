# GetInRoute — Load testing (capacity evidence)

Reproducible, honest capacity numbers for a single Windows PC running the
whole stack (Node/Express + SQLite + Socket.IO) on `127.0.0.1:4000`.

## Harness

- Script: `backend/test-load.js` (included in the repo).
- Method: spawns a throwaway server on a random port with a fresh temp DB
  (seeded admin + vehicles/routes), then fires a mixed traffic mix
  (reads: auth/user/dashboard; writes: login counters) from concurrent
  workers, and reports p50/p95/p99 + error rate.
- Guard rails: rate-limit responses (429) and account lockouts are expected
  under load, so the script watches only for real failures: HTTP 5xx and
  network errors (`ERR (429/500/fetch)` line = "no" is a pass).

## Results (2026-09-10, final build, this PC)

| Run | Concurrency | Requests | Duration | req/s | p50 | p95 | p99 | 5xx errors | 429/network |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 250 | 10,000 | 21.7 s | 461 | 476 ms | 747 ms | 1598 ms | 0 (0.00%) | none |
| 2 | 500 | 10,000 | 20.6 s | 486 | 930 ms | 1407 ms | 3621 ms | 0 (0.00%) | none |

Both runs: `LOAD RESULT: PASS`, exit code 0, 100% HTTP 200.

## What these numbers mean

- 460–490 requests/second sustained with **zero failures** is well beyond a
  ~1,000-employee deployment, whose peak is a short burst of check-ins/safety
  confirmations in the morning/evening windows.
- p99 of ~1.6–3.6 s is acceptable for the admin dashboards and the mobile
  client's background polling; interactive logins sit in the p50 range
  (~0.5–0.9 s).
- The earlier audit also reached 2,000 concurrent workers with 0 errors on the
  previous build; the numbers above are from the final build.

## How to re-run it yourself

```
cd D:\GetInRoute\backend
node test-load.js 250 40     # 250 concurrent workers x 40 requests each
node test-load.js 500 20
```

It uses a temp database only — it never touches the live `data\getinroute.db`.

## Fair limitation (be honest in reports)

- This is same-machine benchmarking (the local network advertises itself away):
  it measures the server + SQLite path, not real internet latency, and not the
  Caddy/HTTPS layer. Real-world numbers will be the same call graph plus
  20-80 ms of network overhead.
- "Production-ready" claims should still wait until the external HTTPS path
  (Caddy + DNS) is validated from outside the LAN, per the final report.