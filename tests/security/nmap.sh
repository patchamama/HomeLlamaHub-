#!/usr/bin/env bash
# External port scan.  Only 443/tcp should respond from the Internet.
# Usage: ./nmap.sh <fqdn>  [--full]
#   --full: scan all 65535 ports (slow, ~10 min)
#
# Requires: nmap  →  brew install nmap
set -euo pipefail

FQDN="${1:?Usage: $0 <fqdn> [--full]}"
FULL="${2:-}"
DATE=$(date +%Y%m%d-%H%M%S)
REPORT_DIR="$(dirname "$0")/reports"
REPORT="$REPORT_DIR/nmap-$DATE.txt"

command -v nmap >/dev/null 2>&1 || { echo "ERROR: nmap not found. brew install nmap"; exit 1; }
mkdir -p "$REPORT_DIR"

echo "==> Target: $FQDN"
echo "==> Report: $REPORT"
echo ""

# ── Quick scan: common ports that must be CLOSED ──────────────────────────────
echo "--- Quick check: ports that must NOT be open ---" | tee "$REPORT"
nmap -Pn -sV \
  -p 22,80,8000,8765,11434,3000,3100,9080 \
  "$FQDN" 2>&1 | tee -a "$REPORT"

echo "" | tee -a "$REPORT"
echo "--- Expected open: 443/tcp only ---" | tee -a "$REPORT"
nmap -Pn -sV -p 443 "$FQDN" 2>&1 | tee -a "$REPORT"

# ── Full scan (optional) ──────────────────────────────────────────────────────
if [[ "$FULL" == "--full" ]]; then
  echo "" | tee -a "$REPORT"
  echo "--- Full scan (all ports) --- " | tee -a "$REPORT"
  nmap -Pn -sS -sV -p- --min-rate 500 "$FQDN" 2>&1 | tee -a "$REPORT"
fi

# ── Evaluate ──────────────────────────────────────────────────────────────────
echo ""
if grep -qE "^22/tcp\s+open|^8000/tcp\s+open|^8765/tcp\s+open|^11434/tcp\s+open" "$REPORT"; then
  echo "FAIL: one or more internal ports are reachable from the Internet."
  echo "      Check your FRITZ!Box port forwarding rules."
  exit 1
else
  echo "PASS: no unexpected ports open from the Internet."
fi

echo "Report saved to $REPORT"
