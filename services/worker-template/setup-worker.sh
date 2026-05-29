#!/usr/bin/env bash
# Run this on the WORKER machine (M1 Max) to set up Ollama + Caddy + mTLS.
# Prerequisites: macOS, Homebrew, the three cert files copied from the hub.
#
# Usage:
#   ./setup-worker.sh --ip 192.168.178.20 --hub-ip 192.168.178.10
set -euo pipefail

WORKER_IP=""
HUB_IP=""
CERTS_DIR="/opt/ollama-worker/certs"
LOG_DIR="/var/log/ollama-worker"
PLIST="$HOME/Library/LaunchAgents/ai.ollama.worker.plist"

usage() {
    echo "Usage: $0 --ip <worker-lan-ip> --hub-ip <hub-lan-ip>"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ip)     WORKER_IP="$2"; shift 2 ;;
        --hub-ip) HUB_IP="$2";   shift 2 ;;
        *)        usage ;;
    esac
done

[[ -z "$WORKER_IP" || -z "$HUB_IP" ]] && usage

echo "==> Checking prerequisites..."
command -v brew >/dev/null 2>&1 || { echo "ERROR: Homebrew not found."; exit 1; }

echo "==> Installing Ollama..."
if ! command -v ollama >/dev/null 2>&1; then
    brew install ollama
else
    echo "    Ollama already installed: $(ollama --version)"
fi

echo "==> Installing Caddy..."
if ! command -v caddy >/dev/null 2>&1; then
    brew install caddy
else
    echo "    Caddy already installed."
fi

echo "==> Enabling Wake-on-LAN..."
sudo pmset -a womp 1
pmset -g | grep womp

echo "==> Creating directories..."
sudo mkdir -p "$CERTS_DIR" "$LOG_DIR"
sudo chown "$USER" "$CERTS_DIR" "$LOG_DIR"
chmod 700 "$CERTS_DIR"

echo ""
echo "==> MANUAL STEP REQUIRED: copy mTLS certificates from the hub."
echo "    On the Mac mini hub, run:"
echo "      scp /opt/ollama-hub/secrets/mtls/worker-server/server.crt \\"
echo "          /opt/ollama-hub/secrets/mtls/worker-server/server.key \\"
echo "          /opt/ollama-hub/secrets/mtls/ca/root_ca.crt \\"
echo "          $USER@$WORKER_IP:$CERTS_DIR/"
echo ""
read -rp "Press ENTER once the certs are in $CERTS_DIR..."

# Verify certs are present
for f in server.crt server.key root_ca.crt; do
    [[ -f "$CERTS_DIR/$f" ]] || { echo "ERROR: missing $CERTS_DIR/$f"; exit 1; }
done
chmod 600 "$CERTS_DIR/server.key"

echo "==> Installing Ollama LaunchAgent..."
sed "s/127.0.0.1:11434/$WORKER_IP:11434/" \
    "$(dirname "$0")/ai.ollama.worker.plist" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "    Waiting 5s for Ollama to start..."
sleep 5
ollama list || echo "    WARNING: Ollama may still be starting."

echo "==> Installing Caddyfile..."
CADDY_CONF="$HOME/.config/caddy/Caddyfile"
mkdir -p "$(dirname "$CADDY_CONF")"
sed -e "s/WORKER_LAN_IP/$WORKER_IP/g" \
    -e "s|/opt/ollama-worker/certs|$CERTS_DIR|g" \
    -e "s|192.168.178.0/24|$HUB_IP/32|g" \
    "$(dirname "$0")/Caddyfile.template" > "$CADDY_CONF"
caddy validate --config "$CADDY_CONF"
caddy start --config "$CADDY_CONF" --pidfile /tmp/caddy-worker.pid

echo ""
echo "==> Verification: checking mTLS from this machine (should return 200)..."
curl -s -o /dev/null -w "%{http_code}" \
    --cacert "$CERTS_DIR/root_ca.crt" \
    "https://$WORKER_IP:11435/api/tags" && echo ""

echo ""
echo "Worker setup complete."
echo "  Ollama: http://127.0.0.1:11434 (local only)"
echo "  Caddy mTLS gateway: https://$WORKER_IP:11435 (hub access only)"
echo ""
echo "Now register this worker in the hub database:"
echo "  POST /api/admin/hosts  {name, base_url: https://$WORKER_IP:11435, mac, ip: $WORKER_IP, requires_wol: true}"
