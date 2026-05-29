#!/usr/bin/env bash
# Daily encrypted backup of SQLite database and audit logs.
# Encrypts with age, uploads with rclone, retains 30 days locally.
#
# Usage:
#   ./backup.sh                          # uses defaults from environment
#   ./backup.sh --verify                 # verify latest backup is restorable
#
# Required env vars (or set them in /etc/backup.env):
#   BACKUP_AGE_KEY_PATH   path to age public key file (for encryption)
#   BACKUP_RCLONE_DEST    rclone destination, e.g. b2:my-bucket/homellamahub
#
# Optional:
#   REPO_DIR              default: /opt/ollama-hub
#   BACKUP_LOCAL_DIR      default: /opt/ollama-hub/backups
#   BACKUP_RETENTION_DAYS default: 30
set -euo pipefail

# ── Load env ──────────────────────────────────────────────────────────────────
[[ -f /etc/backup.env ]] && source /etc/backup.env

REPO_DIR="${REPO_DIR:-/opt/ollama-hub}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-$REPO_DIR/backups}"
BACKUP_AGE_KEY_PATH="${BACKUP_AGE_KEY_PATH:-$REPO_DIR/secrets/backup-age.pub}"
BACKUP_RCLONE_DEST="${BACKUP_RCLONE_DEST:-}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

DB_PATH="$REPO_DIR/data/hub.db"
LOG_DIR="${LOG_DIR:-/var/log}"
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="homellamahub-$DATE"
BACKUP_STAGING="/tmp/backup-staging-$DATE"

# ── Helpers ───────────────────────────────────────────────────────────────────
log() { echo "[$(date +%H:%M:%S)] $*"; }

cleanup() { rm -rf "$BACKUP_STAGING"; }
trap cleanup EXIT

VERIFY_ONLY="${1:-}"

# ── Verify mode ───────────────────────────────────────────────────────────────
if [[ "$VERIFY_ONLY" == "--verify" ]]; then
  log "Verifying latest backup..."
  LATEST=$(ls -t "$BACKUP_LOCAL_DIR"/*.tar.gz.age 2>/dev/null | head -1 || echo "")
  [[ -z "$LATEST" ]] && { log "ERROR: No backup found in $BACKUP_LOCAL_DIR"; exit 1; }

  AGE_PRIVATE="${BACKUP_AGE_PRIVATE_KEY:-$HOME/.config/sops/age/keys.txt}"
  [[ -f "$AGE_PRIVATE" ]] || { log "ERROR: age private key not found at $AGE_PRIVATE"; exit 1; }

  VERIFY_DIR="/tmp/backup-verify-$$"
  mkdir -p "$VERIFY_DIR"
  age --decrypt --identity "$AGE_PRIVATE" "$LATEST" | tar -xz -C "$VERIFY_DIR"
  RESTORED_DB=$(find "$VERIFY_DIR" -name "*.db" | head -1)
  [[ -z "$RESTORED_DB" ]] && { log "ERROR: no .db file found in backup"; rm -rf "$VERIFY_DIR"; exit 1; }
  sqlite3 "$RESTORED_DB" "SELECT COUNT(*) FROM user;" > /dev/null
  log "PASS: backup $LATEST is restorable (DB has $(sqlite3 "$RESTORED_DB" 'SELECT COUNT(*) FROM user;') users)"
  rm -rf "$VERIFY_DIR"
  exit 0
fi

# ── Check prerequisites ───────────────────────────────────────────────────────
command -v age    >/dev/null || { log "ERROR: age not found. brew install age"; exit 1; }
command -v sqlite3 >/dev/null || { log "ERROR: sqlite3 not found. brew install sqlite"; exit 1; }

[[ -f "$BACKUP_AGE_KEY_PATH" ]] || {
  log "ERROR: age public key not found at $BACKUP_AGE_KEY_PATH"
  log "Generate with: age-keygen | tee ~/.config/sops/age/keys.txt | age-keygen -y > $BACKUP_AGE_KEY_PATH"
  exit 1
}

[[ -f "$DB_PATH" ]] || { log "ERROR: database not found at $DB_PATH"; exit 1; }

mkdir -p "$BACKUP_LOCAL_DIR" "$BACKUP_STAGING"

# ── Create snapshot ───────────────────────────────────────────────────────────
log "Starting backup: $BACKUP_NAME"

# SQLite online backup (safe under concurrent writes)
log "Snapshotting SQLite database..."
sqlite3 "$DB_PATH" ".backup '$BACKUP_STAGING/hub.db'"

# Audit logs
log "Collecting audit logs..."
for logfile in \
  "$LOG_DIR/caddy/access.log" \
  "$LOG_DIR/auditor.log" \
  "/tmp/wol-proxy.log"; do
  [[ -f "$logfile" ]] && cp "$logfile" "$BACKUP_STAGING/" || true
done

# Manifest
cat > "$BACKUP_STAGING/MANIFEST.txt" <<EOF
backup_name: $BACKUP_NAME
created_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
hostname: $(hostname)
db_size: $(du -sh "$BACKUP_STAGING/hub.db" | cut -f1)
db_tables: $(sqlite3 "$BACKUP_STAGING/hub.db" ".tables")
EOF

# ── Compress and encrypt ──────────────────────────────────────────────────────
log "Compressing and encrypting..."
TAR_FILE="/tmp/$BACKUP_NAME.tar.gz"
AGE_FILE="$BACKUP_LOCAL_DIR/$BACKUP_NAME.tar.gz.age"

tar -czf "$TAR_FILE" -C "$BACKUP_STAGING" .
age --encrypt --recipient "$(cat "$BACKUP_AGE_KEY_PATH")" \
    --output "$AGE_FILE" "$TAR_FILE"
rm -f "$TAR_FILE"

SIZE=$(du -sh "$AGE_FILE" | cut -f1)
log "Backup written: $AGE_FILE ($SIZE)"

# ── Upload with rclone ────────────────────────────────────────────────────────
if [[ -n "$BACKUP_RCLONE_DEST" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    log "Uploading to $BACKUP_RCLONE_DEST..."
    rclone copy "$AGE_FILE" "$BACKUP_RCLONE_DEST/" --progress
    log "Upload complete"
  else
    log "WARN: rclone not found, skipping remote upload"
  fi
else
  log "WARN: BACKUP_RCLONE_DEST not set — skipping remote upload (local only)"
fi

# ── Rotate old local backups ──────────────────────────────────────────────────
log "Rotating backups older than $BACKUP_RETENTION_DAYS days..."
find "$BACKUP_LOCAL_DIR" -name "*.tar.gz.age" \
  -mtime "+$BACKUP_RETENTION_DAYS" -delete
REMAINING=$(ls "$BACKUP_LOCAL_DIR"/*.tar.gz.age 2>/dev/null | wc -l | tr -d ' ')
log "Local backups retained: $REMAINING"

log "Backup complete: $AGE_FILE"
