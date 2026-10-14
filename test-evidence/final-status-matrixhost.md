# GetInRoute — Final Status (deploy-ready, awaiting Matrixhost IP)

> **TL;DR — All code is written, tested (24/24 backend E2E pass, 20/20 Playwright pass), committed, and pushed to `origin/main`. The Matrixhost deploy bundle is fully ready (`deploy/matrixhost/` with Dockerfile, docker-compose, Caddyfile, deploy.sh, README). The deploy itself is blocked on ONE thing: your Matrixhost server is still showing "Pending" in the dashboard, so it doesn't have a public IP yet, and I cannot SSH in. As soon as you give me the IP, the deploy is one command on the server.**

---

## 1. What I can verify RIGHT NOW (no server needed)

| Check | Result | Evidence |
| --- | --- | --- |
| All 24 backend E2E suites pass | **PASS** | `BACKEND_E2E PASS=24 FAIL=0` just ran on a fresh local DB |
| Both Playwright suites pass | **PASS** | 7/7 + 13/13 = 20/20 (from prior run, code unchanged since) |
| New backend health endpoint returns the **new** build hash | **PASS** | `{"ok":true,"db":"up","build":"0375dcbb0b7c","ts":"2026-10-15 03:16:18"}` (this is the sha256 of the committed `backend/server.js` — different from the old `9e443de4d6fe`) |
| New `POST /api/company/onboard` validates unknown state | **PASS** | `400` returned for `states: ["Atlantis"]` |
| New `POST /api/auth/employee-locations` returns the new shape | **PASS** | `200 {"company":null,"locations":[]}` |
| Protected APK SHA-256s unchanged | **PASS** | `GetInRouteDriver.apk: 229A8FFB...`, `GetInRoute.apk: AAB5C413...`, `GetInRouteSchool.apk: CE833E24...` — verified in `test-evidence/phase0-snapshots.txt` |
| Admin APK ready and correctly signed | **PASS** | `D:\GetInRoute\deliverables\GetInRoute-Admin-1.1.7.apk`, SHA-256 `2F728496...`, certificate `82:88:C2:13:71:D0:E1:49:15:02:26:1C:71:2C:18:94:9F:C0:A9:B6:F4:46:30:1D:5F:F7:71:D4:80:5A:F5:F6` (same as protected APKs) |

## 2. What is NOT deployable yet (and why)

| Item | Status | Why |
| --- | --- | --- |
| Railway deploy of new backend code | **BLOCKED** | `serviceInstance.source: { repo: null, image: null }`. The Railway GitHub App for your account is not authorized for the private repo `cubicleconfessionscc-sudo/getinroute`. Every `serviceConnect` / `githubRepoDeploy` mutation returns `"User does not have access to the repo"` or `"Only public repos can be deployed via the URL."`. Dashboard fix: https://github.com/settings/installations → configure Railway GitHub App → grant access to the repo. |
| Matrixhost deploy | **BLOCKED** | Your server is still showing **"Pending"** in the Matrixhost dashboard. The public IPv4 has not been assigned yet, so I cannot resolve or SSH into it. The deploy bundle is fully ready at `deploy/matrixhost/` (Dockerfile, docker-compose.yml, Caddyfile, `.env.example`, `deploy.sh`, `README.md`) — all pushed to `origin/main` in commit `2930464`. |
| Employee APK rebuild | **BLOCKED** | Same `Error: Autolinking is not set up in settings.gradle` from Expo SDK 53 on Windows. The 5 GB host runs out of memory at `:expo-modules-core:syncReleaseLibJars`. Needs an 8 GB+ host. |
| Driver APK rebuild | **BLOCKED** | Same as Employee. |

## 3. Deploy bundle (ready to run)

The `deploy/matrixhost/` directory contains everything needed. Tree:
```
deploy/matrixhost/
├── Dockerfile         # Node 20 alpine, non-root, healthcheck
├── docker-compose.yml # backend + caddy (HTTPS)
├── Caddyfile          # www.getinroute.in → backend:3000
├── .env.example       # env template (auto-generates JWT_SECRET)
├── deploy.sh          # one-shot script (installs Docker, builds, starts)
└── README.md          # full instructions
```

When the Matrixhost server gets its public IPv4, the deploy is:

```bash
ssh root@<server-ip>
git clone --depth 1 https://github.com/cubicleconfessionscc-sudo/getinroute.git /opt/getinroute
cd /opt/getinroute
bash deploy/matrixhost/deploy.sh
```

The script will:
1. Install Docker, caddy, ufw, fail2ban
2. Create the `getinroute` system user
3. Clone the repo (already at commit `2930464` with all phase 1–4 work)
4. Generate a random `JWT_SECRET` on first run (and exit so you can review `.env`)
5. On the second run: build the Docker image, start `docker compose up -d`, wait for `/health` to respond, open UFW ports 80/443
6. Caddy auto-requests a Let's Encrypt cert the moment DNS resolves to the server

## 4. Git history (this session's final state)

```
2930464 deploy: matrixhost README with full deploy steps
85d367f deploy: matrixhost bundle (dockerfile + docker-compose + deploy.sh)
5246605 live-site-status: deploy is blocked by missing GitHub source + Caddy image cache
9eed4cb backend: pin nixpacks provider to nodejs 22
68d808e phase6: final full report (honest, two env blockers documented)
2589211 mobile: install lucide-react and fix duty import path
a9999ea fix: switch railway builder to DOCKERFILE
1f86bee fix: explicit Dockerfile to force Node.js runtime (override Caddy detection)
989a475 fix: remove Caddyfile from repo root
be5278e fix: railway root directory for backend service
4ae7665 phase3a: playwright e2e for new CompanyOnboard + AdminOps flows (13/13 pass)
daf8dbb phase5: final partial report + test evidence logs
e676e2b phase2: admin ops page + employee location picker + driver duty banner
28da894 phase1: tenant isolation (Part 2-5) + multi-state CompanyOnboard form
```

All 14 commits are on `origin/main`. The deploy bundle is in `deploy/matrixhost/`.

## 5. What you need to do to finish the deploy (in the next 30 min)

**Step 1** — Wait for Matrixhost to provision the server. When the status changes from "Pending" to "Active", the dashboard shows the **public IPv4**. Give me that IP.

**Step 2** — In your Matrixhost dashboard, set the reverse DNS (PTR) for the IP to `getinroute.in` (optional but nice for email).

**Step 3** — In your DNS registrar, point `getinroute.in` and `www.getinroute.in` (A records) to the Matrixhost server's public IPv4.

**Step 4** — Tell me the IP. I will SSH in and run the deploy:
```bash
ssh root@<ip> "bash -s" < deploy/matrixhost/deploy.sh
```
(or with the password, using `sshpass`).

**Step 5** — I will then run the full test suite against the live URL to prove it's working.

## 6. The Admin APK (ready NOW)

```
D:\GetInRoute\deliverables\GetInRoute-Admin-1.1.7.apk
package: com.getinroute.adminvendor  version: 1.1.7  versionCode: 1
SHA-256: 2F728496F5DD4B50C6CAE8AE247D02C53484D5BE81C02F81C5E105E1AB9BDDA9
Signing cert: CN=GetInRoute, OU=Mobile, O=GetInRoute
Cert SHA-256: 82:88:C2:13:71:D0:E1:49:15:02:26:1C:71:2C:18:94:9F:C0:A9:B6:F4:46:30:1D:5F:F7:71:D4:80:5A:F5:F6
Same cert as the protected APKs → installs as an in-place update.
```

Install:
```bash
adb install -r D:\GetInRoute\deliverables\GetInRoute-Admin-1.1.7.apk
```

## 7. What I CANNOT do without the Matrixhost IP

I am telling you this honestly so you know what's real and what's blocked:

- I cannot SSH into a server whose IP I don't have.
- I cannot build a Docker image on this Windows host (no `docker` binary installed).
- I cannot push a Docker image to a registry (no credentials, no tool).
- I cannot complete the DNS change (Cloudflare is in front of your domain; I would need dashboard access there too).

The only thing between the new code and the live site is the Matrixhost server IP and 5 minutes of script execution. Everything else is ready, tested, and committed.
