import json
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.deps import get_session, require_admin
from app.config import settings
from app.models.host import Host
from app.models.user import User
from app.schemas.host import HostCreate, HostOut, HostUpdate
from app.services.ollama import OllamaClient
from app.services.wol import WolClient

router = APIRouter(prefix="/api/admin/hosts", tags=["admin-hosts"])


@router.get("", response_model=list[HostOut])
async def list_hosts(
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[HostOut]:
    result = await session.exec(select(Host))
    return [HostOut.model_validate(h) for h in result.all()]


@router.post("", response_model=HostOut, status_code=status.HTTP_201_CREATED)
async def create_host(
    body: HostCreate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> HostOut:
    host = Host(**body.model_dump())
    session.add(host)
    await session.commit()
    await session.refresh(host)
    return HostOut.model_validate(host)


@router.patch("/{host_id}", response_model=HostOut)
async def update_host(
    host_id: int,
    body: HostUpdate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> HostOut:
    host = await session.get(Host, host_id)
    if host is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Host not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(host, field, value)

    session.add(host)
    await session.commit()
    await session.refresh(host)
    return HostOut.model_validate(host)


@router.delete("/{host_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_host(
    host_id: int,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    host = await session.get(Host, host_id)
    if host is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Host not found")
    if host.is_local:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete the primary local host",
        )
    await session.delete(host)
    await session.commit()


@router.post("/{host_id}/wake", status_code=status.HTTP_202_ACCEPTED)
async def wake_host(
    host_id: int,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    host = await session.get(Host, host_id)
    if host is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Host not found")
    if not host.mac_address:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Host has no MAC address configured",
        )

    wol = WolClient(settings.wol_proxy_url, settings.wol_proxy_token)
    success = await wol.wake(host.mac_address)
    return {"success": success, "mac": host.mac_address}


@router.post("/{host_id}/test")
async def test_host(
    host_id: int,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    host = await session.get(Host, host_id)
    if host is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Host not found")

    client = OllamaClient(host.base_url)
    alive = await client.is_alive()

    models: list[str] = []
    if alive:
        try:
            models = await client.list_models()
            host.models_cache = json.dumps(models)
            host.models_cache_updated_at = datetime.utcnow()
            session.add(host)
            await session.commit()
        except (httpx.HTTPError, Exception):
            pass

    return {"alive": alive, "models": models, "host_id": host_id}


@router.post("/refresh-models")
async def refresh_all_models(
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.exec(select(Host).where(Host.is_enabled == True))  # noqa: E712
    hosts = list(result.all())

    refreshed = []
    errors = []

    for host in hosts:
        client = OllamaClient(host.base_url)
        try:
            models = await client.list_models()
            host.models_cache = json.dumps(models)
            host.models_cache_updated_at = datetime.utcnow()
            session.add(host)
            refreshed.append({"host_id": host.id, "name": host.name, "models": models})
        except Exception as exc:  # noqa: BLE001
            errors.append({"host_id": host.id, "name": host.name, "error": str(exc)})

    await session.commit()
    return {"refreshed": refreshed, "errors": errors}
