#!/usr/bin/env bash
# Smoke-test the wol-proxy running locally.
# Usage:
#   ./test-magic-packet.sh <mac-address> [token]
# Example:
#   ./test-magic-packet.sh AA:BB:CC:DD:EE:FF my-secret-token
set -euo pipefail

MAC="${1:?Usage: $0 <mac-address> [token]}"
TOKEN="${2:-}"
BASE="http://127.0.0.1:8765"

auth_header=""
[[ -n "$TOKEN" ]] && auth_header="-H \"Authorization: Bearer $TOKEN\""

echo "==> Health check..."
curl -sf "$BASE/health" | python3 -m json.tool

echo ""
echo "==> Sending magic packet to $MAC..."
curl -sf -X POST "$BASE/wol/wake" \
    ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
    -H "Content-Type: application/json" \
    -d "{\"mac\": \"$MAC\"}" | python3 -m json.tool

echo ""
echo "==> Testing invalid MAC (should return 422)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/wol/wake" \
    ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
    -H "Content-Type: application/json" \
    -d '{"mac": "not-a-mac"}')
echo "    HTTP $HTTP_CODE (expected 422)"

if [[ -n "$TOKEN" ]]; then
    echo ""
    echo "==> Testing wrong token (should return 401)..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/wol/wake" \
        -H "Authorization: Bearer wrong-token" \
        -H "Content-Type: application/json" \
        -d "{\"mac\": \"$MAC\"}")
    echo "    HTTP $HTTP_CODE (expected 401)"
fi

echo ""
echo "All checks passed."
