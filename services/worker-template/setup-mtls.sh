#!/usr/bin/env bash
# Run this on the Mac mini (hub) to generate the mTLS CA + certificates.
# Requires: step CLI  →  brew install step
# Usage:
#   ./setup-mtls.sh <worker-lan-ip>   e.g. ./setup-mtls.sh 192.168.178.20
set -euo pipefail

WORKER_IP="${1:?Usage: $0 <worker-lan-ip>}"
SECRETS_DIR="${SECRETS_DIR:-/opt/ollama-hub/secrets/mtls}"
CA_DIR="${SECRETS_DIR}/ca"
HUB_DIR="${SECRETS_DIR}/hub-client"
WORKER_DIR="${SECRETS_DIR}/worker-server"
VALIDITY="8760h"  # 1 year

command -v step >/dev/null 2>&1 || { echo "ERROR: 'step' not found. Run: brew install step"; exit 1; }

mkdir -p "$CA_DIR" "$HUB_DIR" "$WORKER_DIR"
chmod 700 "$SECRETS_DIR"

echo "==> Initializing local CA..."
if [ ! -f "$CA_DIR/root_ca.crt" ]; then
    step certificate create \
        "HomeLlamaHub Local CA" \
        "$CA_DIR/root_ca.crt" \
        "$CA_DIR/root_ca.key" \
        --profile root-ca \
        --no-password \
        --insecure \
        --not-after "$VALIDITY"
    chmod 600 "$CA_DIR/root_ca.key"
    echo "    CA created at $CA_DIR"
else
    echo "    CA already exists, skipping."
fi

echo "==> Generating worker server certificate (SAN: IP:$WORKER_IP)..."
step certificate create \
    "ollama-worker" \
    "$WORKER_DIR/server.crt" \
    "$WORKER_DIR/server.key" \
    --ca "$CA_DIR/root_ca.crt" \
    --ca-key "$CA_DIR/root_ca.key" \
    --san "$WORKER_IP" \
    --no-password \
    --insecure \
    --not-after "$VALIDITY"
chmod 600 "$WORKER_DIR/server.key"

echo "==> Generating hub client certificate..."
step certificate create \
    "ollama-hub-client" \
    "$HUB_DIR/client.crt" \
    "$HUB_DIR/client.key" \
    --ca "$CA_DIR/root_ca.crt" \
    --ca-key "$CA_DIR/root_ca.key" \
    --no-password \
    --insecure \
    --not-after "$VALIDITY"
chmod 600 "$HUB_DIR/client.key"

echo ""
echo "Done. Files generated:"
echo "  CA cert  : $CA_DIR/root_ca.crt"
echo "  Hub client cert : $HUB_DIR/client.crt"
echo "  Hub client key  : $HUB_DIR/client.key"
echo ""
echo "Next: copy these to the worker at $WORKER_IP"
echo "  scp $WORKER_DIR/server.crt $WORKER_DIR/server.key $CA_DIR/root_ca.crt <user>@$WORKER_IP:/opt/ollama-worker/certs/"
