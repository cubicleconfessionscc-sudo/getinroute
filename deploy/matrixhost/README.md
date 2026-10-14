# GetInRoute Backend - Matrixhost Deploy (Ubuntu 22.04)

## Goal
Deploy the new GetInRoute backend (all 24 backend E2E pass, both Playwright suites pass, admin SPA built) to an Ubuntu 22.04 VPS on Matrixhost so the live site at `www.getinroute.in` stops showing the broken "Non-IT to AI" content and starts serving the real GetInRoute app.

## What's in this folder
- `Dockerfile` — Node 20 alpine, non-root user, `healthcheck` against `/health`
- `docker-compose.yml` — `backend` (Node app) + `caddy` (reverse proxy + Let's Encrypt)
- `Caddyfile` — `www.getinroute.in` + `getinroute.in` → `backend:3000`, security headers
- `.env.example` — environment variable template (copy to `.env`, generate a `JWT_SECRET`)
- `deploy.sh` — one-shot script that installs Docker, clones the repo, builds the image, starts the stack, opens UFW ports 80/443

## How to deploy in 5 minutes (root SSH on the VPS)

```bash
# 1. SSH in as root
ssh root@<your-matrixhost-ip>

# 2. Clone the repo
git clone --depth 1 https://github.com/cubicleconfessionscc-sudo/getinroute.git /opt/getinroute
cd /opt/getinroute

# 3. Run the one-shot script (first run creates .env and exits; second run deploys)
bash deploy/matrixhost/deploy.sh

# 4. After step 3 you'll have a generated .env with a random JWT_SECRET.
#    Open the file, review it, then re-run the script to actually deploy.
nano /opt/getinroute/deploy/matrixhost/.env
bash /opt/getinroute/deploy/matrixhost/deploy.sh
```

The script:
- Installs `docker`, `docker-compose-plugin`, `ufw`, `fail2ban`, `jq`, `git`
- Creates a system user `getinroute`
- Clones the repo to `/opt/getinroute`
- Creates a persistent data dir at `/var/lib/getinroute` (for the SQLite DB + backups)
- Creates `.env` on first run with a random `JWT_SECRET`
- Builds the Docker image: `getinroute-backend:latest`
- Starts the stack: `docker compose up -d --build`
- Waits up to 60 s for `/health` to respond
- Opens UFW: SSH + 80 + 443
- Caddy auto-requests Let's Encrypt certs when DNS resolves to the server

## Verify after deploy
```bash
curl -s http://<your-ip>:3000/health
# expected: {"ok":true,"db":"up","build":"<new sha>","ts":"..."}

curl -s -X POST http://<your-ip>:3000/api/company/onboard \
    -H 'content-type: application/json' \
    -d '{"companyName":"Smoke","adminName":"X","adminEmail":"smoke@x.test","adminPassword":"12345678","states":["Atlantis"]}'
# expected: 400 {"error":"Unknown state or union territory: \"Atlantis\""}
```

## Point the domain
At your DNS registrar, point `getinroute.in` and `www.getinroute.in` (A records) to the Matrixhost server's public IPv4. Caddy will auto-provision the Let's Encrypt certificate the moment the DNS resolves.

## Operations
```bash
# Tail logs
cd /opt/getinroute && docker compose -f deploy/matrixhost/docker-compose.yml logs -f

# Restart
cd /opt/getinroute && docker compose -f deploy/matrixhost/docker-compose.yml restart

# Stop
cd /opt/getinroute && docker compose -f deploy/matrixhost/docker-compose.yml down

# Update to latest
cd /opt/getinroute && git pull && bash deploy/matrixhost/deploy.sh

# Backup DB
cp /var/lib/getinroute/getinroute.db /opt/getinroute-backup-$(date +%F).db
```

## What this deploys
- The new backend with all 24 E2E suites passing (multi-state onboard, location codes, location-change flow, profile hardening, /api/admin/employees location-scoped, public employee-locations picker).
- The new admin SPA already built into `backend/public/admin/`.
- The new CompanyOnboard form (multi-state select, per-city chips, Google Maps picker).
- The new Admin Operations page (Locations, Codes, Pending Changes).
- Caddy as the HTTPS front.
- SQLite (file-based) at `/var/lib/getinroute/getinroute.db` with daily/weekly/monthly backups in `/data/backups/`.

## What is NOT in this deploy
- The Employee and Driver mobile APKs are **not** rebuilt (would need an Android build host with 8 GB+ RAM; OOMs on the 5 GB Windows host).
- The `getinroute.app.up.railway.app` URL will keep pointing at the broken Caddy image until you remove the Railway service or re-point DNS to Matrixhost.
- The protected APKs (`backend/binaries/GetInRoute*.apk`) are untouched.
