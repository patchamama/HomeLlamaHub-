# Incident Response — HomeLlamaHub

Use this document when you suspect or confirm a security incident.
Work through the phases in order. Do not skip phases under pressure.

---

## Phase 1 — Detect & Assess (first 5 minutes)

### Signals that indicate an incident

- Grafana alert firing (ban storm, attack patterns, Ollama down)
- `auditor.log` showing unusual BANNING volume
- Unexpected SSH login or failed sudo attempts
- Ollama responding with unexpected content (possible prompt injection)
- Backup verification failing (possible DB tampering)
- Public IP changed but DynDNS not updated (`check-dyndns.sh` alert)

### Quick assessment commands

```bash
# Who is currently banned?
sudo pfctl -t blocklist -T show

# Recent audit events
sqlite3 /opt/ollama-hub/data/hub.db \
  "SELECT ts, ip, action, success, details FROM auditevent ORDER BY ts DESC LIMIT 50;"

# Active connections on port 443
sudo lsof -nP -iTCP:443 | grep ESTABLISHED

# Recent auth failures
grep "BANNING" /var/log/auditor.log | tail -20

# Caddy access log — last 50 requests
tail -50 /var/log/caddy/access.log | python3 -m json.tool | grep -E "uri|remote_ip|status"
```

---

## Phase 2 — Contain (first 15 minutes)

### Option A — Block a specific IP immediately

```bash
sudo pfctl -t blocklist -T add <attacker-ip>
# Verify:
sudo pfctl -t blocklist -T show | grep <attacker-ip>
```

### Option B — Full isolation (cut all Internet access)

Only use if you suspect active compromise and need to stop the bleeding.

```bash
# Block all inbound traffic temporarily
sudo pfctl -f /dev/stdin <<'EOF'
block all
pass quick on lo0 all
pass out quick all
EOF

# To restore normal rules:
sudo pfctl -ef /etc/pf.conf
```

### Option C — Take the service offline

```bash
# Stop Caddy (kills all external access)
sudo brew services stop caddy

# Stop the backend
launchctl unload ~/Library/LaunchAgents/ai.homellamahub.plist

# Restart when ready
launchctl load ~/Library/LaunchAgents/ai.homellamahub.plist
sudo brew services start caddy
```

---

## Phase 3 — Rotate all secrets (within 1 hour)

Run these steps in order. Do not skip any.

### 3.1 Revoke all API tokens

```bash
# Via API (requires admin JWT)
ADMIN_JWT=$(curl -sf -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@localhost","password":"<pass>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Get all token IDs
curl -sf http://127.0.0.1:8000/api/admin/tokens \
  -H "Authorization: Bearer $ADMIN_JWT"

# Revoke each token (repeat for every id):
curl -X DELETE http://127.0.0.1:8000/api/tokens/<id> \
  -H "Authorization: Bearer $ADMIN_JWT"
```

Or revoke directly in the DB:

```bash
sqlite3 /opt/ollama-hub/data/hub.db \
  "UPDATE apitoken SET is_revoked=1, revoked_at=CURRENT_TIMESTAMP;"
```

### 3.2 Rotate WOL proxy token

```bash
NEW_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# Update .env
sed -i '' "s/WOL_PROXY_TOKEN=.*/WOL_PROXY_TOKEN=$NEW_TOKEN/" /opt/ollama-hub/.env

# Update the plist and reload
sed -i '' "s/<string>.*<\/string>/<string>$NEW_TOKEN<\/string>/" \
  ~/Library/LaunchAgents/ai.wol-proxy.plist
launchctl unload ~/Library/LaunchAgents/ai.wol-proxy.plist
launchctl load  ~/Library/LaunchAgents/ai.wol-proxy.plist

# Update backend and restart
launchctl unload ~/Library/LaunchAgents/ai.homellamahub.plist
launchctl load  ~/Library/LaunchAgents/ai.homellamahub.plist
```

### 3.3 Rotate SECRET_KEY (invalidates all JWT sessions)

```bash
NEW_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
sed -i '' "s/SECRET_KEY=.*/SECRET_KEY=$NEW_SECRET/" /opt/ollama-hub/.env

# Restart backend to pick up new key
launchctl unload ~/Library/LaunchAgents/ai.homellamahub.plist
launchctl load  ~/Library/LaunchAgents/ai.homellamahub.plist
```

### 3.4 Re-encrypt .env with sops

```bash
AGE_KEY=$(age-keygen -y ~/.config/sops/age/keys.txt)
sops --encrypt --age "$AGE_KEY" /opt/ollama-hub/.env > /opt/ollama-hub/.env.enc
# Verify it decrypts:
sops --decrypt /opt/ollama-hub/.env.enc | head -5
# Remove plaintext:
rm /opt/ollama-hub/.env
```

### 3.5 Rotate mTLS certificates (if worker is suspected compromised)

```bash
cd /opt/ollama-hub
./services/worker-template/setup-mtls.sh <worker-ip>
# Then re-run setup-worker.sh on the worker with new certs
```

---

## Phase 4 — Analyze (post-incident)

### Extract audit events for the incident window

```bash
# Replace timestamps with the incident window
sqlite3 /opt/ollama-hub/data/hub.db \
  "SELECT ts, ip, user_id, action, target, success, details
   FROM auditevent
   WHERE ts BETWEEN '2026-01-01T00:00:00' AND '2026-01-01T06:00:00'
   ORDER BY ts;" > /tmp/incident-audit.csv
```

### Caddy log analysis

```bash
# All requests from a specific IP
grep '"remote_ip":"1.2.3.4"' /var/log/caddy/access.log | python3 -m json.tool

# All 4xx/5xx in a window
cat /var/log/caddy/access.log \
  | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        e = json.loads(line)
        if e.get('status', 0) >= 400:
            print(e.get('ts',''), e.get('request',{}).get('remote_ip',''), e.get('status',''), e.get('request',{}).get('uri',''))
    except: pass
"
```

### Check for data exfiltration

```bash
# Look for unusually long responses (possible token/secret leakage)
cat /var/log/caddy/access.log \
  | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        e = json.loads(line)
        size = e.get('resp_body_size', 0)
        if size > 50000:
            print(e.get('ts',''), e.get('request',{}).get('remote_ip',''), size, e.get('request',{}).get('uri',''))
    except: pass
"
```

---

## Phase 5 — Recover and Restore

### Restore database from backup

```bash
# List available backups
ls -lt /opt/ollama-hub/backups/

# Decrypt and verify
./scripts/backup.sh --verify

# Stop the backend before restoring
launchctl unload ~/Library/LaunchAgents/ai.homellamahub.plist

# Restore
age --decrypt --identity ~/.config/sops/age/keys.txt \
    /opt/ollama-hub/backups/homellamahub-<date>.tar.gz.age \
  | tar -xz -C /tmp/restore/
cp /tmp/restore/hub.db /opt/ollama-hub/data/hub.db
chown ollamasvc:staff /opt/ollama-hub/data/hub.db

# Restart
launchctl load ~/Library/LaunchAgents/ai.homellamahub.plist
```

---

## Post-Incident Checklist

- [ ] All compromised secrets rotated
- [ ] All API tokens revoked and re-issued to legitimate users
- [ ] Attacker IPs added to permanent blocklist
- [ ] Audit log exported and archived (`/tmp/incident-audit.csv`)
- [ ] Root cause identified and documented
- [ ] pf rules reviewed and tightened if needed
- [ ] SSL Labs and `nmap` re-run to confirm no new exposure
- [ ] Backup verified post-recovery
- [ ] `docs/04-seguridad.md` checklist re-verified
