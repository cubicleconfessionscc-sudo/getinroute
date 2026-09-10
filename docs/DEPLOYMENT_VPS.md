# GetInRoute — $5 VPS Production Deployment (Ubuntu 24.04)

This runbook deploys the current GetInRoute backend onto a small Linux VPS so the
Windows PC can be turned off. The PostgreSQL work done for the Railway plan is used
as-is: the backend boots against `DATABASE_URL`, `pg-migrate.js` loads the SQLite
source into Postgres, and Cloudflare is optional (Caddy auto-HTTPS works alone).

Cost target: ~$4–5/month VPS (e.g. Hetzner CX22 ≈ €3.8/mo, Contabo, Racknerd) +
free DNS/SSL (Caddy/Let's Encrypt or free Cloudflare).

---

## 0. What you need to do first (provisioning is on you)

1. Rent a VPS. Any Ubuntu 24.04 (or 22.04) image, minimum 1 vCPU / 2 GB RAM / 20 GB disk
   (the app alone is tiny; the headroom is for Postgres + headroom).
2. Note your VPS public IP and root/SSH access (username + SSH key or password).
3. Point DNS at the VPS **after** provisioning (Section 6 explains both routes).
4. Tell me: VPS IP, SSH user, and whether you want Cloudflare proxied or Let's Encrypt direct.

I cannot rent/pay for the VPS or log in to a server I don't have access to —
but everything below is scripted, and I'll drive it end-to-end once I have SSH.

---

## 1. Server packages

```bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y postgresql postgresql-contrib git curl caddy openssl
# Node 22 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v  # 22.x
npm -v
```

## 2. PostgreSQL database + user

```bash
sudo -u postgres psql <<'SQL'
CREATE USER getinroute WITH PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE getinroute OWNER getinroute;
SQL
# URL used by the app and migration:
# postgresql://getinroute:CHANGE_ME_STRONG@127.0.0.1:5432/getinroute
```

## 3. Code + dependencies

```bash
mkdir -p /srv/getinroute
adduser --system --group --home /srv/getinroute app
# If you did not push a GitHub token, replace with an scp of backend/ from Windows.
cd /srv/getinroute
git clone https://github.com/cubicleconfessionscc-sudo/getinroute.git .
# For a private repo clone use a PAT:
#   git clone https://USER:PAT@github.com/cubicleconfessionscc-sudo/getinroute.git .
cd backend
npm install            # installs pg + everything (backend is CJS, sqlite builtin)
```

## 4. Migration: SQLite snapshot -> Postgres

Copy the SQLite source up from Windows (run on your PC):

```powershell
scp D:\GetInRoute\data\getinroute.db app@VPS_IP:/srv/getinroute/getinroute.db
```

Then on the VPS (the same tool verified against local PG this session):

```bash
cd /srv/getinroute/backend
node pg-migrate.js --source=/srv/getinroute/getinroute.db \
  --target=postgresql://getinroute:CHANGE_ME_STRONG@127.0.0.1:5432/getinroute \
  --dry-run          # expect 36 tables / 2035 rows, zero warnings
node pg-migrate.js --source=/srv/getinroute/getinroute.db \
  --target=postgresql://getinroute:CHANGE_ME_STRONG@127.0.0.1:5432/getinroute \
  --apply
# then --replace twice? No: re-run `--apply --replace` AFTER review to re-sync later.
```

## 5. App environment + systemd

Create `/etc/getinroute.env`:

```ini
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgresql://getinroute:CHANGE_ME_STRONG@127.0.0.1:5432/getinroute
JWT_SECRET=openssl rand -hex 32        # run this, paste result
FRONTEND_URL=https://www.getinroute.in
ALLOWED_ORIGINS=https://www.getinroute.in,https://getinroute.in
APP_TIMEZONE=Asia/Kolkata
OWNER_EMAIL=<same as local backend/.env>
OWNER_EMP_ID=<same as local backend/.env>
SIMULATE_GPS=0
NODE_ENV=production
```

Service unit `/etc/systemd/system/getinroute.service`:

```ini
[Unit]
Description=GetInRoute API + WebSocket
After=network.target postgresql.service

[Service]
Type=simple
User=app
Group=app
WorkingDirectory=/srv/getinroute/backend
EnvironmentFile=/etc/getinroute.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3
# socket + stateless; single instance
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now getinroute
curl -s http://127.0.0.1:3000/health   # {"ok":true,"db":"up",...}
journalctl -u getinroute -n 40 --no-pager   # boot log
```

## 6. HTTPS + DNS

**Route A — Caddy auto-HTTPS (simplest, $0):**
Registrar: set A records `getinroute.in` and `www.getinroute.in` -> VPS IP.
Replace the machine's `/etc/caddy/Caddyfile`:

```
getinroute.in, www.getinroute.in {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
systemctl restart caddy
```

Caddy mints a Let's Encrypt cert itself. Wait for DNS propagation first.

**Route B — Cloudflare proxy (optional):**
Create/import the zone in Cloudflare (free), set A records to the VPS IP
proxied (orange cloud), SSL mode **Full (strict)**, then point your
registrar's nameservers to Cloudflare. Caddy can stay for localhost TLS or you
can use the same Caddyfile — Cloudflare fronts it.

## 7. Acceptance (same gates as the local PG verification)

1. `curl https://www.getinroute.in/health` -> `{"ok":true,"db":"up"}`.
2. Owner login via the public frontend or `POST /api/auth/login`.
3. Create one real cab request through the app (schedule -> confirm).
4. Open the admin live tracking page (WebSocket connects over wss).
5. Confirm a notification SMS/email fires in the sandbox (same providers as local).

## 8. Operations

- Upgrade path: `git -C /srv/getinroute pull`, `npm install` if needed,
  `systemctl restart getinroute`.
- Logs: `journalctl -u getinroute -f`.
- DB backup (nightly cron on VPS):
  `0 1 * * * pg_dump getinroute -U getinroute > /srv/backups/gir-$(date +\%F).sql`
- The SQLite source stays on the PC and in `migration-backups\pre-vps-getinroute.db`.

## 9. Rollback (never automatic — manual DNS reversal)

1. Registrar/Cloudflare: point `getinroute.in` + `www` back at the home PC
   (the records you had before; Caddy on the PC is still configured).
2. The PC still runs the SQLite build untouched — start it with the old bat
   files once the DNS flips.
3. Postgres keeps the migrated copy; `pg-migrate.js --apply --replace` can re-sync it later.
4. No data was written to the SQLite source during migration (it opened read-only).