# Railway: add Redis + a 2nd instance, then verify cross-instance live delivery

The Socket.IO Redis adapter is already wired behind `REDIS_URL`. With `REDIS_URL`
unset the app runs exactly as today (single instance). These steps are the only
part that needs your Railway account.

## 1. Add a Redis service to the project
```bash
railway link                 # pick the "getinroute" project / production env
railway add --service redis  # creates a managed Redis service
```

## 2. Point the app at Redis
```bash
railway variables --service getinroute-app \
  --set 'REDIS_URL=${{Redis.REDIS_URL}}'
```
(Railway substitutes the reference automatically. Redeploy after setting it.)

## 3. Add a second app instance
In the Railway dashboard: **getinroute-app → Settings → Scale → Replicas = 2**.
(One service, two replicas, behind the same Cloudflare origin — no sticky
sessions required because Socket.IO uses the Redis adapter for cross-instance
fan-out and JWTs are stateless.)

## 4. Verify (run from your machine)
```bash
node backend/test/redis-2instance-hosted.js \
  --a https://www.getinroute.in \
  --b https://www.getinroute.in \
  --admin-email you@company.com --admin-pw '***' \
  --driver-email driver@company.com --driver-pw '***'
```
Because the two replicas sit behind one hostname, a plain two-URL check proves
the adapter only if you also hit each replica directly. If you expose the
replicas on distinct hosts (Railway private URLs), pass those to `--a` / `--b`.
The script asserts: a driver GPS ping on instance B is delivered to an admin
connected to instance A, and a different company never receives it.

## 5. Full-scale load test (k6)
```bash
# k6 is a single binary; install once, then:
k6 run -e BASE=https://www.getinroute.in -e ADMIN_EMAIL=... -e ADMIN_PW=... \
  backend/test/k6-load.js
```
Report events/s, p50/p95/p99, error rate and WebSocket connections held. To find
the literal 500,000-concurrent capacity, increase the k6 stages and instance
count until p95 latency or the error rate crosses your SLO, then extrapolate.
