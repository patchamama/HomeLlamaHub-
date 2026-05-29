from collections.abc import AsyncIterator

import httpx


class OllamaClient:
    """Async client for communicating with an Ollama instance."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    async def list_models(self) -> list[str]:
        """Return a list of model names available on the host."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            return [m["name"] for m in data.get("models", [])]

    async def is_alive(self) -> bool:
        """Return True if the host responds to a version probe."""
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{self.base_url}/api/version")
                return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError):
            return False

    async def stream_chat(
        self,
        payload: dict,
        timeout: float,
    ) -> AsyncIterator[bytes]:
        """Stream raw bytes from /v1/chat/completions."""
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/v1/chat/completions",
                json=payload,
            ) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    yield chunk

    async def get_running_processes(self) -> dict:
        """Return the /api/ps response payload."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}/api/ps")
            resp.raise_for_status()
            return resp.json()

    async def get_version(self) -> dict:
        """Return the /api/version response payload."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}/api/version")
            resp.raise_for_status()
            return resp.json()
