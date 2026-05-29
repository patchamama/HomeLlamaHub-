#!/usr/bin/env bash
# Sync whitelist.yml into the pf <whitelist> table and /etc/pf.whitelist.
# Run as root after editing whitelist.yml.
set -euo pipefail

WHITELIST_YML="$(dirname "$0")/whitelist.yml"
PF_WHITELIST="/etc/pf.whitelist"

command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 required"; exit 1; }

# Extract IPs from YAML (no deps — just grep the indented list items)
python3 - <<'EOF'
import re, sys
ips = []
with open("'"$WHITELIST_YML"'") as f:
    for line in f:
        line = line.strip()
        if line.startswith("- ") and not line.startswith("# "):
            ip = line[2:].split("#")[0].strip()
            if ip:
                ips.append(ip)
for ip in ips:
    print(ip)
EOF > /tmp/pf.whitelist.new

cp /tmp/pf.whitelist.new "$PF_WHITELIST"
echo "Written $PF_WHITELIST:"
cat "$PF_WHITELIST"

# Reload the table if pf is running
if sudo pfctl -s info 2>/dev/null | grep -q "Status: Enabled"; then
    sudo pfctl -t whitelist -T replace -f "$PF_WHITELIST"
    echo "pf <whitelist> table reloaded."
else
    echo "pf not running — table will load on next: sudo pfctl -ef /etc/pf.conf"
fi
