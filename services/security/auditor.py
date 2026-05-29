#!/usr/bin/env python3
"""
HomeLlamaHub security auditor.
Tails Caddy's JSON access log, detects attacks, and bans IPs via pfctl.

Detection rules:
  1. AUTH_FAIL_BAN   — N auth failures (401/403 on /api/auth/*) in M minutes
  2. AUTH_RATE_BAN   — X requests to /api/auth/* in 1 minute (brute-force speed)
  3. ATTACK_BAN      — known-bad patterns in URI (path traversal, SQLi, XSS, Log4Shell)
  4. SCAN_BAN        — high 404 rate (scanner probing endpoints)

Usage:
  python3 auditor.py [--log /var/log/caddy/access.log] [--whitelist whitelist.yml]

Requires:
  - Root (for pfctl). Run via LaunchDaemon or sudo.
  - pf loaded with a <blocklist> table (services/firewall/pf.conf).
"""

import argparse
import json
import logging
import os
import re
import subprocess
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [auditor] %(message)s",
)
log = logging.getLogger("auditor")

# ── Tunables (override via env vars) ─────────────────────────────────────────

AUTH_FAIL_THRESHOLD = int(os.getenv("AUTH_FAIL_THRESHOLD", "5"))    # failures
AUTH_FAIL_WINDOW_S  = int(os.getenv("AUTH_FAIL_WINDOW_S",  "600"))  # 10 min
AUTH_RATE_THRESHOLD = int(os.getenv("AUTH_RATE_THRESHOLD", "20"))   # req/min on /api/auth/*
SCAN_404_THRESHOLD  = int(os.getenv("SCAN_404_THRESHOLD",  "30"))   # 404s in 1 min
BAN_DURATION_S      = int(os.getenv("BAN_DURATION_S",      "3600")) # 1 hour
POLL_INTERVAL_S     = float(os.getenv("POLL_INTERVAL_S",   "1.0"))

DEFAULT_LOG_PATH    = os.getenv("CADDY_LOG", "/var/log/caddy/access.log")
DEFAULT_WHITELIST   = os.getenv("WHITELIST_PATH",
                                str(Path(__file__).parent.parent / "firewall" / "whitelist.yml"))

# ── Attack patterns ───────────────────────────────────────────────────────────

_ATTACK_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("path-traversal",  re.compile(r"\.\./|\.\.%2f|\.\.%5c|%2e%2e", re.IGNORECASE)),
    ("sqli",            re.compile(
        r"union\s+select|or\s+1\s*=\s*1|drop\s+table|insert\s+into|"
        r"exec\s*\(|xp_cmdshell|information_schema|--\s*$",
        re.IGNORECASE,
    )),
    ("xss",             re.compile(r"<script|javascript:|onerror\s*=|onload\s*=|eval\s*\(", re.IGNORECASE)),
    ("log4shell",       re.compile(r"\$\{jndi:", re.IGNORECASE)),
    ("ssrf-probe",      re.compile(r"(169\.254\.169\.254|metadata\.google\.internal)", re.IGNORECASE)),
]

# ── Sliding-window counter ────────────────────────────────────────────────────

class SlidingWindow:
    """Count events per IP in a rolling time window."""

    def __init__(self, window_s: int) -> None:
        self._window = timedelta(seconds=window_s)
        self._events: dict[str, list[datetime]] = defaultdict(list)

    def record(self, ip: str) -> int:
        now = datetime.utcnow()
        cutoff = now - self._window
        events = self._events[ip]
        # prune old events
        while events and events[0] < cutoff:
            events.pop(0)
        events.append(now)
        return len(events)

    def count(self, ip: str) -> int:
        now = datetime.utcnow()
        cutoff = now - self._window
        return sum(1 for ts in self._events[ip] if ts >= cutoff)

    def purge_old(self) -> None:
        now = datetime.utcnow()
        cutoff = now - self._window
        for ip in list(self._events):
            self._events[ip] = [ts for ts in self._events[ip] if ts >= cutoff]
            if not self._events[ip]:
                del self._events[ip]


# ── Whitelist ─────────────────────────────────────────────────────────────────

def load_whitelist(path: str) -> set[str]:
    whitelist: set[str] = set()
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("- ") and not line.startswith("# "):
                    ip = line[2:].split("#")[0].strip()
                    if ip:
                        whitelist.add(ip)
    except FileNotFoundError:
        log.warning("whitelist not found at %s — no IPs whitelisted", path)
    return whitelist


def is_whitelisted(ip: str, whitelist: set[str]) -> bool:
    if ip in whitelist:
        return True
    # Simple CIDR check for /24 and /16 (covers LAN subnet)
    parts = ip.split(".")
    for entry in whitelist:
        if "/" in entry:
            net, bits = entry.rsplit("/", 1)
            net_parts = net.split(".")
            prefix = int(bits)
            # Only handle /8, /16, /24 for simplicity
            octets = prefix // 8
            if parts[:octets] == net_parts[:octets]:
                return True
    return False


# ── pfctl integration ─────────────────────────────────────────────────────────

_banned: dict[str, float] = {}  # ip -> ban_expiry_timestamp


def ban_ip(ip: str, reason: str) -> None:
    if ip in _banned and _banned[ip] > time.time():
        return  # already banned

    _banned[ip] = time.time() + BAN_DURATION_S
    log.warning("BANNING %s reason=%s duration=%ds", ip, reason, BAN_DURATION_S)

    try:
        subprocess.run(
            ["pfctl", "-t", "blocklist", "-T", "add", ip],
            check=True, capture_output=True,
        )
    except FileNotFoundError:
        log.error("pfctl not found — is pf loaded? (sudo pfctl -ef services/firewall/pf.conf)")
    except subprocess.CalledProcessError as exc:
        log.error("pfctl error: %s", exc.stderr.decode().strip())


def unban_expired() -> None:
    now = time.time()
    for ip, expiry in list(_banned.items()):
        if expiry <= now:
            try:
                subprocess.run(
                    ["pfctl", "-t", "blocklist", "-T", "delete", ip],
                    check=True, capture_output=True,
                )
                log.info("unbanned %s (ban expired)", ip)
            except subprocess.CalledProcessError:
                pass
            del _banned[ip]


# ── Log parsing ───────────────────────────────────────────────────────────────

def parse_caddy_line(line: str) -> Optional[dict]:
    """Return a normalized event dict from a Caddy JSON log line, or None."""
    line = line.strip()
    if not line:
        return None
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        return None

    # Caddy's JSON log structure varies slightly by version; handle both
    req = entry.get("request", {})
    return {
        "ip":     req.get("remote_ip") or entry.get("remote_ip", ""),
        "method": req.get("method", ""),
        "uri":    req.get("uri") or entry.get("uri", ""),
        "status": int(entry.get("status", 0)),
        "ts":     entry.get("ts", 0.0),
    }


# ── Main loop ─────────────────────────────────────────────────────────────────

def tail_and_audit(log_path: str, whitelist_path: str) -> None:
    auth_fail_window = SlidingWindow(AUTH_FAIL_WINDOW_S)
    auth_rate_window = SlidingWindow(60)  # 1-minute window for rate
    scan_window      = SlidingWindow(60)

    whitelist = load_whitelist(whitelist_path)
    whitelist_mtime = 0.0
    purge_counter = 0

    log.info("watching %s", log_path)
    log.info("whitelist: %s (%d entries)", whitelist_path, len(whitelist))
    log.info("thresholds: auth_fail=%d/%ds auth_rate=%d/min scan_404=%d/min",
             AUTH_FAIL_THRESHOLD, AUTH_FAIL_WINDOW_S, AUTH_RATE_THRESHOLD, SCAN_404_THRESHOLD)

    # Open and seek to end (we only process new lines)
    while not Path(log_path).exists():
        log.info("waiting for log file %s ...", log_path)
        time.sleep(5)

    f = open(log_path)  # noqa: WPS515
    f.seek(0, 2)

    while True:
        # Reload whitelist if it changed
        try:
            mtime = Path(whitelist_path).stat().st_mtime
            if mtime != whitelist_mtime:
                whitelist = load_whitelist(whitelist_path)
                whitelist_mtime = mtime
                log.info("whitelist reloaded: %d entries", len(whitelist))
        except FileNotFoundError:
            pass

        # Read new lines
        for raw_line in f:
            event = parse_caddy_line(raw_line)
            if not event or not event["ip"]:
                continue

            ip     = event["ip"]
            uri    = event["uri"]
            status = event["status"]

            if is_whitelisted(ip, whitelist):
                continue

            # Rule 3: attack patterns in URI
            for label, pattern in _ATTACK_PATTERNS:
                if pattern.search(uri):
                    ban_ip(ip, f"attack-pattern:{label} uri={uri[:80]!r}")
                    break

            # Rule 1: auth failures
            if uri.startswith("/api/auth") and status in (401, 403, 422):
                count = auth_fail_window.record(ip)
                if count >= AUTH_FAIL_THRESHOLD:
                    ban_ip(ip, f"auth-fail:{count}in{AUTH_FAIL_WINDOW_S}s")

            # Rule 2: auth endpoint rate
            if uri.startswith("/api/auth"):
                rate = auth_rate_window.record(ip)
                if rate >= AUTH_RATE_THRESHOLD:
                    ban_ip(ip, f"auth-rate:{rate}req/min")

            # Rule 4: 404 scanner
            if status == 404:
                scan_count = scan_window.record(ip)
                if scan_count >= SCAN_404_THRESHOLD:
                    ban_ip(ip, f"scan:{scan_count}x404/min")

        # Periodic housekeeping
        purge_counter += 1
        if purge_counter >= 60:
            auth_fail_window.purge_old()
            auth_rate_window.purge_old()
            scan_window.purge_old()
            unban_expired()
            purge_counter = 0

        time.sleep(POLL_INTERVAL_S)

        # Handle log rotation: re-open if file was rotated
        try:
            if Path(log_path).stat().st_ino != os.fstat(f.fileno()).st_ino:
                log.info("log rotated, reopening")
                f.close()
                f = open(log_path)  # noqa: WPS515
        except (OSError, FileNotFoundError):
            pass


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HomeLlamaHub security auditor")
    parser.add_argument("--log",       default=DEFAULT_LOG_PATH,  help="Caddy JSON access log path")
    parser.add_argument("--whitelist", default=DEFAULT_WHITELIST, help="whitelist.yml path")
    args = parser.parse_args()

    tail_and_audit(args.log, args.whitelist)
