#!/usr/bin/env bash
# TLS/SSL quality scan.  Requires an A rating on SSL Labs criteria.
# Usage: ./testssl.sh <fqdn>
#
# Requires: testssl.sh  →  brew install testssl
# Or run directly from the tool: https://testssl.sh
set -euo pipefail

FQDN="${1:?Usage: $0 <fqdn>}"
DATE=$(date +%Y%m%d-%H%M%S)
REPORT_DIR="$(dirname "$0")/reports"
REPORT_TXT="$REPORT_DIR/testssl-$DATE.txt"
REPORT_JSON="$REPORT_DIR/testssl-$DATE.json"

command -v testssl >/dev/null 2>&1 || {
  echo "ERROR: testssl not found."
  echo "  Install: brew install testssl"
  echo "  Or: git clone https://github.com/drwetter/testssl.sh && cd testssl.sh && ./testssl.sh $FQDN"
  exit 1
}
mkdir -p "$REPORT_DIR"

echo "==> Target: https://$FQDN"
echo "==> Reports: $REPORT_TXT  |  $REPORT_JSON"
echo ""

testssl \
  --severity MEDIUM \
  --color 0 \
  --logfile "$REPORT_TXT" \
  --jsonfile "$REPORT_JSON" \
  --warnings off \
  --protocols \
  --cipher-per-proto \
  --server-defaults \
  --headers \
  --ocsp \
  --hsts \
  --breach \
  --poodle \
  --beast \
  --robot \
  "https://$FQDN"

# ── Evaluate critical checks ──────────────────────────────────────────────────
FAIL=0

echo ""
echo "=== Evaluation ==="

check() {
  local label="$1"
  local pattern="$2"
  local want_absent="${3:-false}"   # true = pattern must NOT appear

  if [[ "$want_absent" == "true" ]]; then
    if grep -qi "$pattern" "$REPORT_TXT"; then
      echo "FAIL: $label"
      FAIL=1
    else
      echo "PASS: $label"
    fi
  else
    if grep -qi "$pattern" "$REPORT_TXT"; then
      echo "PASS: $label"
    else
      echo "FAIL: $label (not found in report)"
      FAIL=1
    fi
  fi
}

check "TLS 1.3 supported"         "TLSv1.3.*offered"
check "TLS 1.0 disabled"          "TLSv1.0.*offered"       "true"
check "TLS 1.1 disabled"          "TLSv1.1.*offered"       "true"
check "SSLv3 disabled"            "SSLv3.*offered"          "true"
check "HSTS present"              "Strict-Transport-Security"
check "OCSP stapling"             "OCSP stapling"
check "No SHA-1 certificate"      "SHA1.*signed"            "true"
check "No weak RSA key (<2048)"   "RSA.*1024"               "true"
check "No POODLE"                 "POODLE.*vulnerable"      "true"
check "No BEAST"                  "BEAST.*vulnerable"       "true"
check "No ROBOT"                  "ROBOT.*vulnerable"       "true"

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "All TLS checks passed."
else
  echo "One or more TLS checks failed. Review $REPORT_TXT"
  exit 1
fi
