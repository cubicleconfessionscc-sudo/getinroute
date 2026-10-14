#!/usr/bin/env bash
# GetInRoute Backend - One-shot deploy script for Ubuntu 22.04 (Matrixhost or any VPS).
# Run as root: bash deploy.sh
set -euo pipefail

REPO_URL="https://github.com/cubicleconfessionscc-sudo/getinroute.git"
REPO_DIR="/opt/getinroute"
DATA_DIR="/var/lib/getinroute"
DEPLOY_DIR="/opt/getinroute/deploy/matrixhost"
USER_NAME="getinroute"
LOG="/var/log/getinroute-deploy.log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root (sudo bash deploy.sh)." >&2
  exit 1
fi

log "==== GetInRoute one-shot deploy started ===="

# ---- 1. System packages ----
log "Installing system packages (docker, caddy, git, jq, ufw)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg git jq ufw fail2ban unattended-upgrades

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker from official repository..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# ---- 2. App user ----
if ! id "$USER_NAME" >/dev/null 2>&1; then
  log "Creating system user '$USER_NAME'..."
  adduser --system --group --shell /bin/bash --home "$REPO_DIR" "$USER_NAME"
fi

# ---- 3. Clone the repo ----
log "Cloning repository to $REPO_DIR..."
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
else
  cd "$REPO_DIR" && git fetch --depth 1 origin main && git reset --hard origin/main
fi
chown -R "$USER_NAME":"$USER_NAME" "$REPO_DIR"

# ---- 4. Data directory ----
log "Creating persistent data directory at $DATA_DIR..."
mkdir -p "$DATA_DIR"
chown -R "$USER_NAME":"$USER_NAME" "$DATA_DIR"

# ---- 5. Environment file (first run only) ----
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  log "Creating .env from template. EDIT IT to set JWT_SECRET!"
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  # Generate a random JWT secret
  JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$DEPLOY_DIR/.env"
  echo ""
  echo "============================================================"
  echo "  IMPORTANT: $DEPLOY_DIR/.env was created."
  echo "  JWT_SECRET is auto-generated. Review the file, then run:"
  echo "    cd $REPO_DIR && bash deploy/matrixhost/deploy.sh"
  echo "============================================================"
  exit 0
fi

# ---- 6. Build and start the container ----
log "Building Docker image..."
cd "$REPO_DIR"
docker build -f deploy/matrixhost/Dockerfile -t getinroute-backend:latest .

log "Starting docker compose stack..."
cd "$DEPLOY_DIR"
docker compose up -d --build
cd "$REPO_DIR"

# ---- 7. Wait for backend health ----
log "Waiting for backend health endpoint..."
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    log "Backend is healthy."
    break
  fi
  sleep 2
done

HEALTH=$(curl -fsS http://127.0.0.1:3000/health 2>/dev/null || echo "{}")
log "Health response: $HEALTH"

# ---- 8. Firewall ----
log "Configuring UFW firewall..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ---- 9. HTTPS via Caddy + Let's Encrypt (only if DNS already points here) ----
log "Caddy will request Let's Encrypt certificates automatically once DNS resolves."
log "If DNS is not yet pointed at this server, HTTPS will fall back to HTTP."

# ---- 10. Print final status ----
IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
log "==== Deploy complete ===="
log "Server IP: $IP"
log "Backend health: http://$IP:3000/health"
log "App URL (once DNS resolves): http://$IP or https://www.getinroute.in"
log "Useful commands:"
log "  - View logs:    cd $REPO_DIR && docker compose -f deploy/matrixhost/docker-compose.yml logs -f"
log "  - Restart:      cd $REPO_DIR && docker compose -f deploy/matrixhost/docker-compose.yml restart"
log "  - Stop:         cd $REPO_DIR && docker compose -f deploy/matrixhost/docker-compose.yml down"
log "  - Backup DB:    cp $DATA_DIR/getinroute.db /opt/getinroute-backup-\$(date +%F).db"
