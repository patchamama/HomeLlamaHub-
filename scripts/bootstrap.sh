#!/usr/bin/env bash
# Idempotent bootstrap for a fresh Mac mini running HomeLlamaHub.
# Safe to re-run: skips steps that are already done.
#
# Usage:
#   sudo ./scripts/bootstrap.sh [--fqdn midominio.dyndns.org] [--repo /opt/ollama-hub]
#
# What this does (in order):
#   1. Verify prerequisites (macOS, Apple Silicon, Homebrew)
#   2. Install system tools (Python 3.12, Node 20, Caddy, Docker, step, age, sops)
#   3. Install Ollama
#   4. Create service account ollamasvc
#   5. Create directory layout at $REPO_DIR
#   6. Deploy configs from this repo
#   7. Generate secrets if not already present
#   8. Load pf firewall
#   9. Install and load all LaunchAgents/Daemons
#  10. Seed the database (first-run admin user)
#  11. Run a basic health check

set -euo pipefail

# ── CLI args ──────────────────────────────────────────────────────────────────
FQDN=""
REPO_DIR="/opt/ollama-hub"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fqdn)    FQDN="$2";     shift 2 ;;
    --repo)    REPO_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

REPO_SRC="$(cd "$(dirname "$0")/.." && pwd)"

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { echo "  [+] $*"; }
skip()  { echo "  [-] SKIP: $*"; }
warn()  { echo "  [!] WARN: $*"; }
die()   { echo "  [x] ERROR: $*"; exit 1; }

step() {
  echo ""
  echo "══════════════════════════════════════════"
  echo "  $*"
  echo "══════════════════════════════════════════"
}

require_root() {
  [[ "$EUID" -eq 0 ]] || die "This script must be run as root: sudo $0"
}

require_root

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────
step "1. Checking prerequisites"

[[ "$(uname)" == "Darwin" ]] || die "macOS required"

ARCH=$(uname -m)
[[ "$ARCH" == "arm64" ]] || warn "Expected Apple Silicon (arm64), got $ARCH"
info "macOS $(sw_vers -productVersion) on $ARCH"

# Homebrew (install as the calling user, not root)
BREW_USER="${SUDO_USER:-$USER}"
if ! sudo -u "$BREW_USER" command -v brew >/dev/null 2>&1; then
  info "Installing Homebrew..."
  sudo -u "$BREW_USER" /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  skip "Homebrew already installed"
fi
BREW="sudo -u $BREW_USER brew"

# ── Step 2: System tools ──────────────────────────────────────────────────────
step "2. Installing system tools"

install_brew() {
  local pkg="$1"
  if $BREW list "$pkg" &>/dev/null; then
    skip "$pkg"
  else
    info "Installing $pkg..."
    $BREW install "$pkg"
  fi
}

install_brew python@3.12
install_brew node
install_brew caddy
install_brew step
install_brew age
install_brew sops
install_brew rclone
install_brew sqlite

# Docker (check if installed, warn if not — requires GUI install)
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker not found. Install Docker Desktop or OrbStack manually, then re-run."
  warn "  https://orbstack.dev  (recommended for Apple Silicon)"
else
  skip "Docker already installed"
fi

# pip tools
sudo -u "$BREW_USER" python3 -m pip install uv --quiet || true

# ── Step 3: Ollama ────────────────────────────────────────────────────────────
step "3. Installing Ollama"

if ! command -v ollama >/dev/null 2>&1; then
  info "Installing Ollama..."
  $BREW install ollama
else
  skip "Ollama $(ollama --version) already installed"
fi

# WOL from sleep
pmset -g | grep -q "womp.*1" && skip "WOL already enabled" || {
  info "Enabling Wake-on-LAN..."
  pmset -a womp 1
}

# ── Step 4: Service account ───────────────────────────────────────────────────
step "4. Creating service account ollamasvc"

if dscl . -read /Users/ollamasvc >/dev/null 2>&1; then
  skip "ollamasvc already exists"
else
  info "Creating ollamasvc..."
  # Find a free UID >= 500
  NEXT_UID=501
  while dscl . -list /Users UniqueID | awk '{print $2}' | grep -q "^${NEXT_UID}$"; do
    NEXT_UID=$((NEXT_UID + 1))
  done
  dscl . -create /Users/ollamasvc
  dscl . -create /Users/ollamasvc UserShell /usr/bin/false
  dscl . -create /Users/ollamasvc RealName "Ollama Service"
  dscl . -create /Users/ollamasvc UniqueID "$NEXT_UID"
  dscl . -create /Users/ollamasvc PrimaryGroupID 20
  dscl . -create /Users/ollamasvc NFSHomeDirectory /var/empty
  info "ollamasvc created with UID $NEXT_UID"
fi

# ── Step 5: Directory layout ──────────────────────────────────────────────────
step "5. Creating directory layout at $REPO_DIR"

for dir in \
  "$REPO_DIR" \
  "$REPO_DIR/data" \
  "$REPO_DIR/secrets" \
  "$REPO_DIR/secrets/mtls" \
  "$REPO_DIR/logs" \
  /var/log/caddy \
  /etc; do
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
    info "Created $dir"
  else
    skip "$dir exists"
  fi
done

chown -R ollamasvc:staff "$REPO_DIR"
chmod 750 "$REPO_DIR"
chmod 700 "$REPO_DIR/secrets"

# ── Step 6: Deploy configs ────────────────────────────────────────────────────
step "6. Deploying configs from $REPO_SRC"

rsync -a --exclude='.git' --exclude='*.pyc' --exclude='__pycache__' \
  "$REPO_SRC/" "$REPO_DIR/"
chown -R ollamasvc:staff "$REPO_DIR"
chmod 750 "$REPO_DIR"
info "Repo synced to $REPO_DIR"

# ── Step 7: Generate secrets ──────────────────────────────────────────────────
step "7. Generating secrets"

ENV_FILE="$REPO_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  skip ".env already exists"
else
  info "Generating .env..."
  WOL_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  cat > "$ENV_FILE" <<ENVEOF
APP_ENV=production
SECRET_KEY=$SECRET_KEY
DATABASE_URL=sqlite+aiosqlite:////opt/ollama-hub/data/hub.db
PUBLIC_FQDN=${FQDN:-changeme.dyndns.org}

OLLAMA_LOCAL_URL=http://127.0.0.1:11434
WOL_PROXY_URL=http://127.0.0.1:8765
WOL_PROXY_TOKEN=$WOL_TOKEN

DEFAULT_MAX_CONCURRENCY=1
DEFAULT_REQUEST_TIMEOUT_S=300
RATE_LIMIT_PER_MIN=60
REGISTRATION_OPEN=false

# Fritz!Box TR-064 (fill in before deploying)
FRITZBOX_HOST=fritz.box
FRITZBOX_USER=
FRITZBOX_PASSWORD=

# Observability
GRAFANA_PASSWORD=$(python3 -c "import secrets; print(secrets.token_hex(16))")
ENVEOF
  chmod 600 "$ENV_FILE"
  chown ollamasvc:staff "$ENV_FILE"
  warn "IMPORTANT: Edit $ENV_FILE — set PUBLIC_FQDN, FRITZBOX credentials, then encrypt with sops"
  warn "  sops --encrypt --age \$(age-keygen -y ~/.config/sops/age/keys.txt) $ENV_FILE > $ENV_FILE.enc"
fi

# ── Step 8: Firewall ──────────────────────────────────────────────────────────
step "8. Loading pf firewall"

cp "$REPO_DIR/services/firewall/pf.conf" /etc/pf.conf
touch /etc/pf.blocklist /etc/pf.whitelist
chmod 600 /etc/pf.blocklist /etc/pf.whitelist

"$REPO_DIR/services/firewall/load-whitelist.sh" || true

pfctl -s info | grep -q "Status: Enabled" && {
  pfctl -f /etc/pf.conf
  info "pf rules reloaded"
} || {
  pfctl -ef /etc/pf.conf
  info "pf loaded and enabled"
}

# ── Step 9: LaunchAgents / Daemons ────────────────────────────────────────────
step "9. Installing LaunchAgents and LaunchDaemons"

LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LAUNCH_DAEMONS="/Library/LaunchDaemons"
mkdir -p "$LAUNCH_AGENTS"

load_agent() {
  local plist="$1"
  local dest="$2"
  local label
  label=$(basename "$plist" .plist)
  cp "$plist" "$dest/"
  launchctl unload "$dest/$(basename "$plist")" 2>/dev/null || true
  launchctl load "$dest/$(basename "$plist")"
  info "Loaded: $label"
}

# WOL proxy (user agent)
sed -i '' \
  "s|/opt/ollama-hub/services/wol/wol-proxy.py|$REPO_DIR/services/wol/wol-proxy.py|g" \
  "$REPO_DIR/services/wol/ai.wol-proxy.plist"
# Inject token from .env
WOL_TOKEN_VAL=$(grep WOL_PROXY_TOKEN "$ENV_FILE" | cut -d= -f2)
sed -i '' "s|REPLACE_WITH_GENERATED_TOKEN|$WOL_TOKEN_VAL|g" \
  "$REPO_DIR/services/wol/ai.wol-proxy.plist"
load_agent "$REPO_DIR/services/wol/ai.wol-proxy.plist" "$LAUNCH_AGENTS"

# Auditor (root daemon)
sed -i '' \
  "s|/opt/ollama-hub/|$REPO_DIR/|g" \
  "$REPO_DIR/services/security/ai.auditor.plist"
load_agent "$REPO_DIR/services/security/ai.auditor.plist" "$LAUNCH_DAEMONS"

# Daily backup daemon
if [[ -f "$REPO_DIR/scripts/ai.backup.plist" ]]; then
  load_agent "$REPO_DIR/scripts/ai.backup.plist" "$LAUNCH_DAEMONS"
fi

# ── Step 10: Initialize DB ────────────────────────────────────────────────────
step "10. Initializing backend database"

DB="$REPO_DIR/data/hub.db"
if [[ -f "$DB" ]]; then
  skip "Database already exists at $DB"
else
  info "Starting backend briefly to seed the database..."
  cd "$REPO_DIR/backend"
  sudo -u "$BREW_USER" uv run uvicorn app.main:app \
    --host 127.0.0.1 --port 8000 --env-file "$ENV_FILE" &
  UVICORN_PID=$!
  sleep 5
  curl -sf http://127.0.0.1:8000/health > /dev/null && info "DB seeded successfully"
  kill "$UVICORN_PID" 2>/dev/null || true
  warn "Default admin: admin@localhost / admin123 — CHANGE THIS IMMEDIATELY"
fi

# ── Step 11: Health check ─────────────────────────────────────────────────────
step "11. Health check"

sleep 2
curl -sf http://127.0.0.1:8765/health > /dev/null && info "WOL proxy: OK" || warn "WOL proxy: not responding"
sudo pfctl -s info | grep -q "Status: Enabled" && info "pf firewall: enabled" || warn "pf: not enabled"
command -v ollama >/dev/null && info "Ollama: installed" || warn "Ollama: missing"

echo ""
info "Bootstrap complete."
[[ -n "$FQDN" ]] || warn "Remember to set PUBLIC_FQDN in $ENV_FILE and encrypt it with sops."
echo ""
echo "Next steps:"
echo "  1. Edit $ENV_FILE — fill in FRITZBOX credentials, verify PUBLIC_FQDN"
echo "  2. Encrypt: sops --encrypt --age ... $ENV_FILE > $ENV_FILE.enc && rm $ENV_FILE"
echo "  3. Change default admin password via the web panel"
echo "  4. Run security tests: cd tests/security && ./run-all.sh $FQDN ..."
