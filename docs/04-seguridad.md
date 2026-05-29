# Security Checklist — HomeLlamaHub

Verify each item before exposing the service to the Internet.
Items marked **BLOCKER** must be resolved before going live.

---

## 8.1 Firewall (pf)

- [ ] **BLOCKER** `pf` loaded and active: `sudo pfctl -s info | grep Status`
- [ ] `services/firewall/pf.conf` deployed to `/etc/pf.conf`
- [ ] `/etc/pf.blocklist` and `/etc/pf.whitelist` exist (can be empty files)
- [ ] LAN IPs and any static admin IPs in `whitelist.yml`, synced via `load-whitelist.sh`
- [ ] From an external IP, only port 443 responds: `nmap -Pn -p 443,22,8000,8765,11434 <fqdn>`
- [ ] Port 22 closed from Internet (open only from LAN)
- [ ] Ports 8000, 8765, 11434 not reachable from anywhere outside localhost

---

## 8.2 Auditor + IP banning

- [ ] `auditor.py` running as root: `sudo launchctl list | grep auditor`
- [ ] `pfctl -t blocklist -T show` populates after simulating 5 auth failures
- [ ] Test ban: `curl -X POST /api/auth/login -d '{"email":"x","password":"wrong"}' ×5` → IP blocked
- [ ] Test whitelist: your LAN IP is never banned even after repeated failures
- [ ] Log rotation handled: `auditor.py` reopens the file after Caddy rotates it
- [ ] `auditor.py` survives Caddy log absence at startup (waits gracefully)

---

## 8.3 Secrets management

- [ ] **BLOCKER** `sops` + `age` installed: `brew install sops age`
- [ ] Age key generated: `age-keygen -o ~/.config/sops/age/keys.txt`
- [ ] `.env` encrypted: `sops --encrypt --age $(age-keygen -y ~/.config/sops/age/keys.txt) .env > .env.enc`
- [ ] Plaintext `.env` removed from disk after confirming encrypted version decrypts correctly
- [ ] `.env` in `.gitignore` (check: `git status .env`)
- [ ] **BLOCKER** Default admin password changed from `admin123` (see `backend/app/main.py:43`)
- [ ] `WOL_PROXY_TOKEN` is a 64-char hex string (min 32 bytes entropy)
- [ ] `SECRET_KEY` in backend `.env` is a 64-char hex string
- [ ] JWT keys are RS256 (not HS256) in production — rotate every 90 days
- [ ] API tokens stored as `bcrypt(cost=12)` with `olh_` prefix for identification

---

## 8.4 OS hardening

- [ ] **BLOCKER** Remote login disabled: `sudo systemsetup -setremotelogin off`
  (re-enable only for maintenance: `sudo systemsetup -setremotelogin on`)
- [ ] FileVault active: `fdesetup status` → `FileVault is On`
- [ ] Service account `ollamasvc` created without shell:
  ```bash
  sudo dscl . -create /Users/ollamasvc
  sudo dscl . -create /Users/ollamasvc UserShell /usr/bin/false
  ```
- [ ] `/opt/ollama-hub` owned by `ollamasvc`, not by your user account:
  ```bash
  sudo chown -R ollamasvc:staff /opt/ollama-hub
  sudo chmod -R 750 /opt/ollama-hub
  ```
- [ ] Secrets directory permissions: `chmod 700 /opt/ollama-hub/secrets`
- [ ] `pmset -g | grep womp` → `womp 1` (WOL from sleep enabled)

---

## 8.5 HTTP hardening

- [ ] **BLOCKER** CORS restricted in `backend/app/main.py` — currently `allow_origins=["*"]`.
  Change to the actual FQDN:
  ```python
  allow_origins=[f"https://{settings.public_fqdn}"],
  ```
- [ ] HSTS header present in Caddy response: `curl -I https://<fqdn> | grep Strict`
- [ ] `X-Content-Type-Options: nosniff` present
- [ ] `X-Frame-Options: DENY` present
- [ ] `Referrer-Policy: no-referrer` present
- [ ] CSP header served by Caddy for `/panel/*`:
  `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`
- [ ] JWT cookies set as `Secure; HttpOnly; SameSite=Strict` (not in localStorage)
- [ ] API tokens shown once on creation, never stored in frontend localStorage
- [ ] Rate limit active in Caddy (60 req/min per IP on `external` zone)
- [ ] `slowapi` rate limiting active in FastAPI for `/api/auth/*` endpoints
- [ ] All backend timeouts configured (not `None`/infinite): `DEFAULT_REQUEST_TIMEOUT_S`

---

## 8.6 TLS

- [ ] **BLOCKER** HTTPS certificate valid: `curl -I https://<fqdn>` returns 200, no cert warnings
- [ ] SSL Labs score A or A+: https://www.ssllabs.com/ssltest/
- [ ] TLS 1.0 and 1.1 disabled (Caddy defaults to TLS 1.2+ — verify)
- [ ] OCSP stapling active: `testssl.sh --ocsp <fqdn>`
- [ ] mTLS between hub and worker(s): verify with `curl --cacert ... --cert ... <worker-url>/api/tags`

---

## 8.7 Operational checks (repeat after each major change)

- [ ] `nmap -Pn -sS -sV -p- <fqdn>` — only `443/tcp` open
- [ ] OWASP ZAP baseline scan: `zaproxy -t https://<fqdn>/panel/ -r zap-report.html`
- [ ] `nikto -h https://<fqdn>` — no critical findings
- [ ] Manual token scope test: a `user`-scoped token cannot reach `/api/admin/*`
- [ ] Revoked token rejected immediately (not cached)
- [ ] Expired token rejected
- [ ] Each auth attempt (success and failure) appears in the audit log

---

## Known issues / action items

| Severity | Location | Issue | Action |
|----------|----------|-------|--------|
| ~~HIGH~~ | `backend/app/main.py` | ~~`allow_origins=["*"]` allows any origin~~ | **FIXED** — restricted to `public_fqdn` |
| MEDIUM | `backend/app/config.py:8` | Default `SECRET_KEY` is a placeholder | Override in production `.env` with `secrets.token_hex(32)` |
| MEDIUM | `backend/app/main.py:43` | Default admin password `admin123` | Change immediately on first boot |
| LOW | `backend/app/config.py:11` | JWT uses HS256 by default | Switch to RS256 for production |
