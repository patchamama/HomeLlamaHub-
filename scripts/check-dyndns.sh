#!/usr/bin/env bash
# Verify that the DynDNS FQDN resolves to the current public IP.
# Alerts if there is a mismatch — DNS may not have updated after an IP change.
# Usage: ./check-dyndns.sh <fqdn>
# Designed to run as a cron job (e.g. every 5 minutes).
set -euo pipefail

FQDN="${1:-${PUBLIC_FQDN:-}}"
[[ -z "$FQDN" ]] && { echo "Usage: $0 <fqdn>  or set PUBLIC_FQDN env var"; exit 1; }

ALERT_LOG="${ALERT_LOG:-/var/log/dyndns-alert.log}"

# ── Get current public IP ─────────────────────────────────────────────────────
PUBLIC_IP=$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null \
  || curl -sf --max-time 5 https://ifconfig.me 2>/dev/null \
  || echo "")

[[ -z "$PUBLIC_IP" ]] && { echo "ERROR: Could not determine public IP"; exit 1; }

# ── Resolve FQDN ─────────────────────────────────────────────────────────────
RESOLVED_IP=$(dig +short "$FQDN" @8.8.8.8 2>/dev/null | tail -1 || echo "")

[[ -z "$RESOLVED_IP" ]] && {
  echo "ERROR: Could not resolve $FQDN"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR cannot resolve $FQDN" >> "$ALERT_LOG"
  exit 1
}

# ── Compare ───────────────────────────────────────────────────────────────────
if [[ "$PUBLIC_IP" == "$RESOLVED_IP" ]]; then
  echo "OK: $FQDN → $RESOLVED_IP (matches public IP)"
  exit 0
else
  MSG="MISMATCH: $FQDN resolves to $RESOLVED_IP but public IP is $PUBLIC_IP"
  echo "$MSG"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $MSG" >> "$ALERT_LOG"

  # Optional: send a macOS notification
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$MSG\" with title \"HomeLlamaHub DynDNS Alert\""
  fi

  exit 1
fi
