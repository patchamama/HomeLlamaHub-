# Operational Runbook — HomeLlamaHub

Day-to-day operations reference. Each section is a self-contained procedure.

---

## Wake / Sleep Macs

### Put Mac mini to sleep (maintenance)

```bash
sudo pmset sleepnow
```

### Wake Mac mini remotely (from another device on the LAN)

```bash
# Using the WOL proxy API (requires admin JWT)
curl -X POST http://127.0.0.1:8000/api/admin/hosts/<mac-mini-host-id>/wake \
  -H "Authorization: Bearer $ADMIN_JWT"
```

### Wake M1 Max worker

```bash
# Via the admin panel: Hosts → Wake
# Or via API:
curl -X POST https://<fqdn>/api/admin/hosts/<m1max-host-id>/wake \
  -H "Authorization: Bearer $ADMIN_JWT"

# Or directly via wol-proxy (from the Mac mini):
curl -X POST http://127.0.0.1:8765/wol/wake \
  -H "Authorization: Bearer $WOL_PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mac": "AA:BB:CC:DD:EE:FF"}'
```

### Check if a host is awake

```bash
curl -X POST https://<fqdn>/api/admin/hosts/<host-id>/test \
  -H "Authorization: Bearer $ADMIN_JWT"
# Returns: {"alive": true/false, "models": [...]}
```

---

## Update Ollama

```bash
# On Mac mini:
brew upgrade ollama

# Restart the LaunchAgent (if running as a service):
launchctl unload ~/Library/LaunchAgents/ai.ollama.plist
launchctl load  ~/Library/LaunchAgents/ai.ollama.plist

# Verify:
ollama --version
curl http://127.0.0.1:11434/api/version

# On M1 Max worker (SSH in first):
ssh user@192.168.178.20
brew upgrade ollama
launchctl unload ~/Library/LaunchAgents/ai.ollama.worker.plist
launchctl load  ~/Library/LaunchAgents/ai.ollama.worker.plist
```

> **Before upgrading**: check the Ollama release notes for breaking changes.
> Pin the version in brew if needed: `brew pin ollama`

---

## Add / Remove a Model

```bash
# Add model on the local Mac mini:
ollama pull llama3.1:8b
ollama pull qwen2.5:7b
ollama pull nomic-embed-text

# Add model on the M1 Max worker (SSH in):
ssh user@192.168.178.20
ollama pull llama3.3:70b   # large models only on 64GB

# Remove a model:
ollama rm mistral:7b

# List available models:
ollama list

# Refresh the models cache in the hub DB:
curl -X POST https://<fqdn>/api/admin/hosts/refresh-models \
  -H "Authorization: Bearer $ADMIN_JWT"
```

---

## Add a User

```bash
# Via API (admin JWT required):
curl -X POST https://<fqdn>/api/admin/users \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "TemporaryPass123!",
    "display_name": "New User"
  }'

# Activate the user if not auto-activated:
curl -X POST https://<fqdn>/api/admin/users/<id>/activate \
  -H "Authorization: Bearer $ADMIN_JWT"
```

> Users should change their password on first login.

---

## Add a Host / Worker

```bash
# 1. Set up the new host (see services/worker-template/README.md)
# 2. Register it:
curl -X POST https://<fqdn>/api/admin/hosts \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "new-worker",
    "base_url": "https://192.168.178.30:11435",
    "ip": "192.168.178.30",
    "mac": "AA:BB:CC:DD:EE:FF",
    "is_local": false,
    "requires_wol": true,
    "is_enabled": true
  }'

# 3. Test the connection:
curl -X POST https://<fqdn>/api/admin/hosts/<new-id>/test \
  -H "Authorization: Bearer $ADMIN_JWT"

# 4. Refresh models cache:
curl -X POST https://<fqdn>/api/admin/hosts/refresh-models \
  -H "Authorization: Bearer $ADMIN_JWT"
```

---

## Rotate Secrets

### Rotate WOL proxy token

```bash
NEW_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
# Update in .env, wol-proxy plist, then restart both services.
# Full procedure: see docs/05-incidentes.md § 3.2
```

### Rotate JWT secret key (invalidates all active sessions)

```bash
NEW_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
sed -i '' "s/SECRET_KEY=.*/SECRET_KEY=$NEW_SECRET/" /opt/ollama-hub/.env
launchctl unload ~/Library/LaunchAgents/ai.homellamahub.plist
launchctl load  ~/Library/LaunchAgents/ai.homellamahub.plist
# All users will need to log in again.
```

### Rotate mTLS certificates (annual or on compromise)

```bash
cd /opt/ollama-hub
./services/worker-template/setup-mtls.sh <worker-ip>
# Then copy new certs to the worker and restart Caddy on the worker.
```

---

## Manual Backup

```bash
# Run immediately (does not wait for the 03:00 cron)
sudo /opt/ollama-hub/scripts/backup.sh

# Verify the latest backup is restorable
sudo /opt/ollama-hub/scripts/backup.sh --verify

# List all local backups
ls -lh /opt/ollama-hub/backups/

# Check backup log
tail -50 /var/log/backup.log
```

---

## DynDNS Check

```bash
# One-off check
./scripts/check-dyndns.sh midominio.dyndns.org

# Set up a cron job to check every 5 minutes:
# (add to root crontab: sudo crontab -e)
# */5 * * * * /opt/ollama-hub/scripts/check-dyndns.sh midominio.dyndns.org
```

---

## Observability

```bash
# Start the stack
cd /opt/ollama-hub/observability && docker compose up -d

# Stop the stack
docker compose down

# Check all containers are healthy
docker compose ps

# Access Grafana via SSH tunnel
ssh -L 3000:127.0.0.1:3000 user@mac-mini
# then open http://localhost:3000

# Query logs directly from Loki
curl -G http://127.0.0.1:3100/loki/api/v1/query_range \
  --data-urlencode 'query={job="caddy"}' \
  --data-urlencode 'start=2h' \
  --data-urlencode 'limit=100'
```

---

## Regular maintenance schedule

| Frequency | Task |
|---|---|
| Daily | Review `auditor.log` for ban events; check Grafana alerts |
| Weekly | Run `./scripts/backup.sh --verify`; review `docs/04-seguridad.md` blockers |
| Monthly | Run full security test suite: `tests/security/run-all.sh` |
| Quarterly | Rotate JWT secret key; update Ollama; review model versions |
| Annually | Rotate mTLS certificates; rotate age backup key |
