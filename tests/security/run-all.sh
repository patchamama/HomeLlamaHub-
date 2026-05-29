#!/usr/bin/env bash
# Run the full security test suite in order.
# Usage: ./run-all.sh <fqdn> <admin-email> <admin-password> <api-token>
# Example:
#   ./run-all.sh midominio.dyndns.org admin@localhost changeme olh_xxxxxxxx
#
# Each test writes a dated report to tests/security/reports/.
# Exit code 0 = all passed, non-zero = at least one failure.
set -euo pipefail

FQDN="${1:?Usage: $0 <fqdn> <admin-email> <admin-password> <api-token>}"
ADMIN_EMAIL="${2:?}"
ADMIN_PASS="${3:?}"
API_TOKEN="${4:?}"
BASE="https://$FQDN"

DIR="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

run_test() {
  local name="$1"
  shift
  echo ""
  echo "════════════════════════════════════════"
  echo " $name"
  echo "════════════════════════════════════════"
  if "$@"; then
    echo "→ $name: PASSED"
  else
    echo "→ $name: FAILED"
    FAIL=1
  fi
}

echo "HomeLlamaHub Security Test Suite"
echo "Target: $BASE"
echo "Date:   $(date)"
echo ""

run_test "1. Port scan"         "$DIR/nmap.sh"             "$FQDN"
run_test "2. TLS/SSL quality"   "$DIR/testssl.sh"          "$FQDN"
run_test "3. ZAP baseline"      "$DIR/zap-baseline.sh"     "$FQDN" "$API_TOKEN"
run_test "4. API pentest"       "$DIR/api-pentest.sh"      "$BASE" "$ADMIN_EMAIL" "$ADMIN_PASS"
run_test "5. Prompt injection"  "$DIR/prompt-injection.sh" "$BASE" "$API_TOKEN"
run_test "6. Audit verification" "$DIR/audit-verify.sh"   "$BASE" "$ADMIN_EMAIL" "$ADMIN_PASS"

echo ""
echo "════════════════════════════════════════"
if [[ "$FAIL" -eq 0 ]]; then
  echo " ALL TESTS PASSED"
else
  echo " ONE OR MORE TESTS FAILED"
  echo " Review reports in: $DIR/reports/"
fi
echo "════════════════════════════════════════"
exit "$FAIL"
