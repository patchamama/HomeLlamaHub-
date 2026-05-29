import json

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.config import settings
from app.models.host import Host
from app.services.ollama import OllamaClient
from app.services.wol import WolClient


class HostRouter:
    """Selects the best available host for a given inference model."""

    async def select(self, model: str, session: AsyncSession) -> Host:
        """Choose a host that has `model` in its cache and is reachable.

        Priority:
        1. Local hosts (is_local=True) that have the model
        2. Remote hosts that have the model and are reachable
        3. WOL hosts that are offline — trigger wake then wait

        Raises HTTPException 503 if no host is available.
        """
        result = await session.exec(
            select(Host).where(Host.is_enabled == True)  # noqa: E712
        )
        all_hosts: list[Host] = list(result.all())

        # Filter hosts that have the model in their cache
        candidates = [h for h in all_hosts if self._has_model(h, model)]

        if not candidates:
            # Fall back to all enabled hosts if model cache is empty or stale
            candidates = all_hosts

        if not candidates:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"No enabled hosts available for model '{model}'",
            )

        # Prefer local hosts
        local_candidates = [h for h in candidates if h.is_local]
        remote_candidates = [h for h in candidates if not h.is_local]

        for host in local_candidates:
            client = OllamaClient(host.base_url)
            if await client.is_alive():
                return host

        for host in remote_candidates:
            if host.requires_wol:
                continue  # handle WOL hosts below
            client = OllamaClient(host.base_url)
            if await client.is_alive():
                return host

        # Attempt WOL for offline remote hosts
        wol_client = WolClient(settings.wol_proxy_url, settings.wol_proxy_token)
        for host in remote_candidates:
            if not host.requires_wol or not host.mac_address:
                continue
            client = OllamaClient(host.base_url)
            if await client.is_alive():
                return host
            # Wake the host
            await wol_client.wake(host.mac_address)
            if await wol_client.wait_until_ready(host.base_url, timeout_s=60):
                return host

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No reachable host found for the requested model",
        )

    @staticmethod
    def _has_model(host: Host, model: str) -> bool:
        try:
            cached: list[str] = json.loads(host.models_cache)
            return model in cached
        except (json.JSONDecodeError, TypeError):
            return False


host_router = HostRouter()
