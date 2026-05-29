import asyncio

import httpx


class WolClient:
    """Client for the WOL proxy service."""

    def __init__(self, proxy_url: str, token: str) -> None:
        self.proxy_url = proxy_url.rstrip("/")
        self.token = token

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    async def wake(self, mac: str) -> bool:
        """Send a standard WOL magic packet via the proxy."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self.proxy_url}/wol/wake",
                    json={"mac": mac},
                    headers=self._headers(),
                )
                return resp.status_code < 400
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError):
            return False

    async def fritzbox_wake(self, mac: str) -> bool:
        """Send a WOL packet via Fritz!Box integration."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self.proxy_url}/wol/fritzbox",
                    json={"mac": mac},
                    headers=self._headers(),
                )
                return resp.status_code < 400
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError):
            return False

    async def wait_until_ready(self, host_url: str, timeout_s: int = 60) -> bool:
        """Poll host_url/api/version every 5 seconds until it responds or times out."""
        deadline = asyncio.get_event_loop().time() + timeout_s
        check_url = f"{host_url.rstrip('/')}/api/version"
        while asyncio.get_event_loop().time() < deadline:
            try:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    resp = await client.get(check_url)
                    if resp.status_code == 200:
                        return True
            except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError):
                pass
            await asyncio.sleep(5)
        return False
