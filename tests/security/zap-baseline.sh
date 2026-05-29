#!/usr/bin/env bash
# OWASP ZAP baseline scan against the admin panel.
# Uses the ZAP Docker image — no local install needed.
# Usage: ./zap-baseline.sh <fqdn> [token]
#
# Requires: Docker
set -euo pipefail

FQDN="${1:?Usage: $0 <fqdn> [api-token]}"
TOKEN="${2:-}"
DATE=$(date +%Y%m%d-%H%M%S)
REPORT_DIR="$(dirname "$0")/reports"
REPORT_HTML="$REPORT_DIR/zap-$DATE.html"
REPORT_JSON="$REPORT_DIR/zap-$DATE.json"

command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker not found."; exit 1; }
mkdir -p "$REPORT_DIR"

echo "==> Target: https://$FQDN/panel/"
echo "==> Report: $REPORT_HTML"
echo ""

# ── ZAP baseline scan (unauthenticated) ───────────────────────────────────────
docker run --rm \
  -v "$REPORT_DIR:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
    -t "https://$FQDN/panel/" \
    -r "zap-$DATE.html" \
    -J "zap-$DATE.json" \
    -l WARN \
    --auto

echo ""
echo "==> Baseline scan complete. Report: $REPORT_HTML"

# ── Authenticated scan (if token provided) ────────────────────────────────────
if [[ -n "$TOKEN" ]]; then
  echo ""
  echo "==> Running authenticated scan with provided API token..."
  REPORT_AUTH_HTML="$REPORT_DIR/zap-auth-$DATE.html"

  docker run --rm \
    -v "$REPORT_DIR:/zap/wrk:rw" \
    ghcr.io/zaproxy/zaproxy:stable \
    zap-baseline.py \
      -t "https://$FQDN/ollama/v1/chat/completions" \
      -r "zap-auth-$DATE.html" \
      -J "zap-auth-$DATE.json" \
      -l WARN \
      -z "-config replacer.full_list(0).description=auth \
          -config replacer.full_list(0).enabled=true \
          -config replacer.full_list(0).matchtype=REQ_HEADER \
          -config replacer.full_list(0).matchstr=Authorization \
          -config replacer.full_list(0).replacement='Bearer $TOKEN'" \
      --auto

  echo "==> Authenticated scan report: $REPORT_AUTH_HTML"
fi

# ── Quick check for critical findings ─────────────────────────────────────────
echo ""
echo "=== Checking for FAIL/WARN findings ==="
if grep -qi '"riskdesc":"High"' "$REPORT_JSON" 2>/dev/null; then
  echo "FAIL: High-severity findings detected. Review $REPORT_HTML"
  exit 1
else
  echo "PASS: No High-severity findings."
fi
