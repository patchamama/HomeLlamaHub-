#!/usr/bin/env python3
"""
WOL proxy microservice for HomeLlamaHub.
Listens on 127.0.0.1:8765 — never exposed to the Internet directly.
Caddy only routes /wol/* here from within the Mac mini; all other access is blocked.

Auth: Authorization: Bearer <WOL_PROXY_TOKEN>  (shared secret with the FastAPI backend)

Endpoints:
  GET  /health                                         liveness check
  POST /wol/wake      {"mac": "AA:BB:CC:DD:EE:FF"}   standard UDP magic packet
  POST /wol/fritzbox  {"mac": "AA:BB:CC:DD:EE:FF"}   via Fritz!Box TR-064 WOL action
"""

import logging
import os
import re
import socket
import urllib.parse
import urllib.request
from functools import wraps
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
import json

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("wol-proxy")

# ── Configuration ──────────────────────────────────────────────────────────────

HOST = os.environ.get("WOL_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("WOL_PROXY_PORT", "8765"))
TOKEN = os.environ.get("WOL_PROXY_TOKEN", "")

FRITZBOX_HOST = os.environ.get("FRITZBOX_HOST", "fritz.box")
FRITZBOX_PORT = int(os.environ.get("FRITZBOX_PORT", "49000"))
FRITZBOX_USER = os.environ.get("FRITZBOX_USER", "")
FRITZBOX_PASSWORD = os.environ.get("FRITZBOX_PASSWORD", "")

_MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$")

# ── WOL helpers ────────────────────────────────────────────────────────────────

def _normalize_mac(mac: str) -> str:
    clean = mac.upper().replace("-", ":").strip()
    if not _MAC_RE.match(clean):
        raise ValueError(f"Invalid MAC address: {mac!r}")
    return clean


def send_magic_packet(mac: str, broadcast: str = "255.255.255.255", port: int = 9) -> None:
    """Build and broadcast a standard Wake-on-LAN magic packet."""
    normalized = _normalize_mac(mac)
    raw = normalized.replace(":", "")
    payload = bytes.fromhex("ff" * 6 + raw * 16)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(payload, (broadcast, port))
    log.info("magic packet sent mac=%s broadcast=%s port=%d", normalized, broadcast, port)


def fritzbox_wake(mac: str) -> None:
    """Wake a host via Fritz!Box TR-064 WOL action (requires TR-064 enabled)."""
    normalized = _normalize_mac(mac)
    url = f"http://{FRITZBOX_HOST}:{FRITZBOX_PORT}/upnp/control/hosts"
    soap_action = "urn:dslforum-org:service:Hosts:1#X_AVM-DE_WakeOnLANByMACAddress"
    body = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"'
        ' s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
        "<s:Body>"
        '<u:X_AVM-DE_WakeOnLANByMACAddress xmlns:u="urn:dslforum-org:service:Hosts:1">'
        f"<NewMACAddress>{normalized}</NewMACAddress>"
        "</u:X_AVM-DE_WakeOnLANByMACAddress>"
        "</s:Body>"
        "</s:Envelope>"
    )
    req = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={
            "Content-Type": 'text/xml; charset="utf-8"',
            "SOAPAction": f'"{soap_action}"',
        },
        method="POST",
    )
    if FRITZBOX_USER and FRITZBOX_PASSWORD:
        # HTTP Digest auth via password manager
        password_mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        password_mgr.add_password(None, url, FRITZBOX_USER, FRITZBOX_PASSWORD)
        auth_handler = urllib.request.HTTPDigestAuthHandler(password_mgr)
        opener = urllib.request.build_opener(auth_handler)
    else:
        opener = urllib.request.build_opener()

    with opener.open(req, timeout=10) as resp:
        status = resp.status
        if status not in (200, 204):
            raise RuntimeError(f"Fritz!Box returned HTTP {status}")

    log.info("fritz!box WOL sent mac=%s host=%s", normalized, FRITZBOX_HOST)


# ── HTTP handler ───────────────────────────────────────────────────────────────

def _check_auth(headers: dict) -> bool:
    if not TOKEN:
        return True
    auth = headers.get("Authorization", "")
    return auth == f"Bearer {TOKEN}"


def _json_response(handler: "WolHandler", status: int, body: dict) -> None:
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


class WolHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # redirect to our logger
        log.info("http %s %s", self.address_string(), fmt % args)

    def do_GET(self) -> None:
        if self.path == "/health":
            _json_response(self, HTTPStatus.OK, {"ok": True})
        else:
            _json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        if not _check_auth(self.headers):
            _json_response(self, HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return

        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) if length else b"{}")
        except json.JSONDecodeError:
            _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid JSON"})
            return

        mac = body.get("mac", "")

        if self.path == "/wol/wake":
            try:
                send_magic_packet(mac)
                _json_response(self, HTTPStatus.OK, {"ok": True, "mac": mac})
            except ValueError as exc:
                _json_response(self, HTTPStatus.UNPROCESSABLE_ENTITY, {"error": str(exc)})
            except OSError as exc:
                log.error("socket error: %s", exc)
                _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "socket error"})

        elif self.path == "/wol/fritzbox":
            if not FRITZBOX_HOST:
                _json_response(
                    self, HTTPStatus.SERVICE_UNAVAILABLE,
                    {"error": "FRITZBOX_HOST not configured"},
                )
                return
            try:
                fritzbox_wake(mac)
                _json_response(self, HTTPStatus.OK, {"ok": True, "mac": mac})
            except ValueError as exc:
                _json_response(self, HTTPStatus.UNPROCESSABLE_ENTITY, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                log.error("fritz!box error: %s", exc)
                _json_response(
                    self, HTTPStatus.BAD_GATEWAY,
                    {"error": f"fritz!box unreachable: {exc}"},
                )

        else:
            _json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not TOKEN:
        log.warning("WOL_PROXY_TOKEN is not set — all requests are accepted without auth")

    server = HTTPServer((HOST, PORT), WolHandler)
    log.info("wol-proxy listening on %s:%d", HOST, PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
        server.shutdown()
