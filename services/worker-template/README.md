# Worker Node Onboarding

This directory contains everything needed to add a new Ollama worker node to HomeLlamaHub.
The reference hardware is the MacBook M1 Max (64 GB), but the same process applies to any macOS or Linux host on the LAN.

## Architecture

```
Mac mini (hub)                    Worker (M1 Max)
─────────────────────────         ─────────────────────────
FastAPI backend                   Caddy (mTLS, LAN-only :11435)
  ↓  HTTPS + mTLS client cert  →    ↓
  ←  response stream            ←  Ollama (127.0.0.1:11434)
```

The worker **never** talks to the Internet directly. Only the hub reaches it, authenticated with a mutual TLS client certificate.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Homebrew | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| `step` CLI (hub only) | `brew install step` |
| Ollama | installed by `setup-worker.sh` |
| Caddy | installed by `setup-worker.sh` |

---

## Step 1 — Generate mTLS certificates (run on the hub)

```bash
# On the Mac mini hub:
chmod +x services/worker-template/setup-mtls.sh
./services/worker-template/setup-mtls.sh 192.168.178.20   # ← worker LAN IP
```

This creates three certificate files under `/opt/ollama-hub/secrets/mtls/`:
- `ca/root_ca.crt` — shared CA (kept on hub, copied to worker)
- `hub-client/client.crt` + `client.key` — used by the backend when routing to this worker
- `worker-server/server.crt` + `server.key` — used by Caddy on the worker

---

## Step 2 — Set up the worker (run on the M1 Max)

```bash
# Copy this directory to the worker first:
scp -r services/worker-template/ user@192.168.178.20:~/worker-template/

# Then SSH into the worker and run:
chmod +x ~/worker-template/setup-worker.sh
~/worker-template/setup-worker.sh \
  --ip 192.168.178.20 \
  --hub-ip 192.168.178.10
```

The script will pause and ask you to copy the certs from the hub — follow the printed command.

---

## Step 3 — Register the worker in the hub

```bash
# Using a valid admin JWT:
curl -X POST https://localhost:8000/api/admin/hosts \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "m1-max",
    "base_url": "https://192.168.178.20:11435",
    "ip": "192.168.178.20",
    "mac": "AA:BB:CC:DD:EE:FF",
    "is_local": false,
    "requires_wol": true,
    "is_enabled": true
  }'
```

The backend stores the mTLS client cert paths in its config (set via env vars or the secrets store).

---

## Step 4 — Configure the hub backend for mTLS

Add to the hub `.env`:

```env
# mTLS client credentials for routing to workers
MTLS_CA_CERT=/opt/ollama-hub/secrets/mtls/ca/root_ca.crt
MTLS_CLIENT_CERT=/opt/ollama-hub/secrets/mtls/hub-client/client.crt
MTLS_CLIENT_KEY=/opt/ollama-hub/secrets/mtls/hub-client/client.key
```

The `HostRouter` in `backend/app/services/host_router.py` picks these up automatically when `is_local=False`.

---

## Step 5 — Enable Wake-on-LAN

On the worker (M1 Max):

```bash
sudo pmset -a womp 1       # enable WOL from sleep
pmset -g | grep womp       # verify: womp = 1
```

The Mac must be in **sleep** mode (not shutdown) for WOL to work on Apple Silicon.

Get the MAC address:
```bash
networksetup -listallhardwareports | grep -A1 "Wi-Fi\|Ethernet"
```

Store it in the host record (`mac` field) when registering in Step 3.

---

## Verification

```bash
# From the hub — test mTLS connection to worker:
curl --cacert /opt/ollama-hub/secrets/mtls/ca/root_ca.crt \
     --cert /opt/ollama-hub/secrets/mtls/hub-client/client.crt \
     --key /opt/ollama-hub/secrets/mtls/hub-client/client.key \
     https://192.168.178.20:11435/api/tags

# Wake the worker manually from the hub:
POST /api/admin/hosts/<id>/wake
```

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `connection refused` on port 11435 | Caddy not running: `ps aux | grep caddy` |
| `certificate verify failed` | CA cert mismatch — regenerate with `setup-mtls.sh` |
| `403 Forbidden` | Hub IP not in Caddy allowlist — edit `Caddyfile.template` |
| WOL not waking worker | `pmset -g | grep womp` must be `1`; machine must be sleeping, not shut down |
| Ollama not responding | `launchctl list | grep ollama`; check `/tmp/ollama-worker.err` |

---

## Adding More Workers

Repeat steps 1–5 for each new node. Each worker gets its own server cert (different SAN). The hub client cert is reused across all workers — the CA is the trust anchor.
