#!/usr/bin/env bash
# Verify that security-relevant events land in the audit log.
# Runs a series of known-bad requests, then checks the audit DB/API.
# Usage: ./audit-verify.sh <base-url> <admin-email> <admin-password> [db-path]
# Example:
#   ./audit-verify.sh https://localhost:8000 admin@localhost changeme
#   ./audit-verify.sh https://localhost:8000 admin@localhost changeme /opt/ollama-hub/data/hub.db
set -euo pipefail

BASE="${1:?Usage: $0 <base-url> <admin-email> <admin-password> [db-path]}"
ADMIN_EMAIL="${2:?}"
ADMIN_PASS="${3:?}"
DB_PATH="${4:-/opt/ollama-hub/data/hub.db}"
DATE=$(date +%Y%m%d-%H%M%S)
REPORT_DIR="$(dirname "$0")/reports"
REPORT="$REPORT_DIR/audit-verify-$DATE.txt"

mkdir -p "$REPORT_DIR"
FAIL=0

log()  { echo "$*" | tee -a "$REPORT"; }
pass() { log "PASS: $*"; }
fail() { log "FAIL: $*"; FAIL=1; }

log "=== Audit Log Verification — $(date) ==="
log "Target: $BASE"
log ""

# ── Get admin JWT ─────────────────────────────────────────────────────────────
ADMIN_JWT=$(curl -sf -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || echo "")

[[ -z "$ADMIN_JWT" ]] && { fail "Could not obtain admin JWT"; exit 1; }
pass "Admin login"

BEFORE_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
log "Timestamp before test actions: $BEFORE_TS"
log ""

# ── Trigger auditable events ──────────────────────────────────────────────────
log "--- Triggering auditable events ---"

# 1. Failed login attempts
log "1. Sending 3 failed login attempts..."
for i in 1 2 3; do
  curl -s -o /dev/null -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"ghost@nowhere.com","password":"wrongpassword"}'
done
pass "Failed logins sent"

# 2. Request with invalid token
log "2. Request with invalid token..."
curl -s -o /dev/null "$BASE/ollama/api/tags" \
  -H "Authorization: Bearer invalid-token-xxxx"
pass "Invalid token request sent"

# 3. Unauthorized admin access
log "3. Unauthorized admin access attempt..."
curl -s -o /dev/null "$BASE/api/admin/users" \
  -H "Authorization: Bearer invalid-token-xxxx"
pass "Unauthorized access attempt sent"

sleep 2  # give the backend a moment to write audit events

# ── Check audit log via API ───────────────────────────────────────────────────
log ""
log "--- Checking audit log via API ---"

AUDIT_RESP=$(curl -sf "$BASE/api/admin/audit?limit=50" \
  -H "Authorization: Bearer $ADMIN_JWT" 2>/dev/null || echo "[]")

AUDIT_COUNT=$(echo "$AUDIT_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
log "Total recent audit events retrieved: $AUDIT_COUNT"

check_event() {
  local label="$1"
  local action_pattern="$2"
  local success_val="${3:-}"

  FOUND=$(echo "$AUDIT_RESP" | python3 - <<PYEOF
import sys, json, re
events = json.load(sys.stdin)
pattern = "$action_pattern"
success = "$success_val"
for e in events:
    action = e.get('action', '')
    if re.search(pattern, action, re.IGNORECASE):
        if not success or str(e.get('success', '')).lower() == success.lower():
            print("found")
            break
PYEOF
)
  if [[ "$FOUND" == "found" ]]; then
    pass "$label"
  else
    fail "$label — event not found in audit log"
  fi
}

check_event "Failed login logged"          "login"         "false"
check_event "Token validation event logged" "token|auth"   ""

# ── Check audit DB directly (if accessible) ───────────────────────────────────
if [[ -f "$DB_PATH" ]]; then
  log ""
  log "--- Direct SQLite audit check ($DB_PATH) ---"

  command -v sqlite3 >/dev/null 2>&1 || {
    log "SKIP: sqlite3 not found (brew install sqlite)"
  }

  if command -v sqlite3 >/dev/null 2>&1; then
    FAIL_LOGINS=$(sqlite3 "$DB_PATH" \
      "SELECT COUNT(*) FROM auditevent WHERE action='login' AND success=0 AND ts > '$BEFORE_TS';" 2>/dev/null || echo "0")
    if [[ "$FAIL_LOGINS" -ge 3 ]]; then
      pass "Failed logins in DB: $FAIL_LOGINS (expected ≥3)"
    else
      fail "Expected ≥3 failed login events in DB, found: $FAIL_LOGINS"
    fi

    TOTAL_EVENTS=$(sqlite3 "$DB_PATH" \
      "SELECT COUNT(*) FROM auditevent WHERE ts > '$BEFORE_TS';" 2>/dev/null || echo "0")
    log "Total new audit events since test start: $TOTAL_EVENTS"

    # Show last 10 events
    log ""
    log "Last 10 audit events:"
    sqlite3 -column -header "$DB_PATH" \
      "SELECT ts, ip, action, success, target FROM auditevent ORDER BY ts DESC LIMIT 10;" \
      2>/dev/null | tee -a "$REPORT" || true
  fi
else
  log "SKIP: DB not accessible at $DB_PATH (only API check performed)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
log ""
log "=== Summary ==="
if [[ "$FAIL" -eq 0 ]]; then
  log "All audit log checks passed."
else
  log "One or more audit checks FAILED. Review $REPORT"
fi
echo ""
echo "Full report: $REPORT"
exit "$FAIL"
