import asyncio
import time
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.deps import get_session, get_user_from_api_token
from app.config import settings
from app.core.audit import log_event
from app.core.queue import inference_queue
from app.models.host import Host
from app.models.job import Job, JobStatus
from app.models.token import ApiToken
from app.models.user import User
from app.services.host_router import host_router
from app.services.ollama import OllamaClient

router = APIRouter(tags=["ollama-proxy"])


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _get_primary_host(session: AsyncSession) -> Host:
    """Return the primary local enabled host."""
    result = await session.exec(
        select(Host).where(Host.is_enabled == True).where(Host.is_local == True)  # noqa: E712
    )
    host = result.first()
    if host is None:
        result2 = await session.exec(select(Host).where(Host.is_enabled == True))  # noqa: E712
        host = result2.first()
    if host is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No enabled host available",
        )
    return host


async def _stream_inference(
    host: Host,
    payload: dict,
    job: Job,
    session: AsyncSession,
    timeout_s: float,
):
    """Core streaming generator: acquires queue slot, proxies to Ollama, updates job."""
    start_ts = time.monotonic()

    async with inference_queue.acquire(timeout_s=timeout_s):
        job.status = JobStatus.running
        session.add(job)
        await session.commit()

        client = OllamaClient(host.base_url)

        try:
            async with asyncio.timeout(timeout_s):
                async for chunk in client.stream_chat(payload, timeout=timeout_s):
                    yield chunk

            elapsed_ms = int((time.monotonic() - start_ts) * 1000)
            job.status = JobStatus.done
            job.finished_at = datetime.utcnow()
            job.duration_ms = elapsed_ms
            session.add(job)
            await session.commit()

        except TimeoutError:
            elapsed_s = time.monotonic() - start_ts
            job.status = JobStatus.timeout
            job.finished_at = datetime.utcnow()
            job.error_msg = f"Timeout after {elapsed_s:.1f}s"
            session.add(job)
            await session.commit()
            yield f'{{"error":"timeout","elapsed_s":{elapsed_s:.1f}}}\n'.encode()

        except (httpx.HTTPError, httpx.ConnectError) as exc:
            elapsed_ms = int((time.monotonic() - start_ts) * 1000)
            job.status = JobStatus.error
            job.finished_at = datetime.utcnow()
            job.duration_ms = elapsed_ms
            job.error_msg = str(exc)
            session.add(job)
            await session.commit()
            yield f'{{"error":"upstream_error","detail":"{exc}"}}\n'.encode()


@router.post("/ollama/v1/chat/completions")
async def proxy_chat_completions(
    request: Request,
    auth: tuple[User, ApiToken] = Depends(get_user_from_api_token),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    user, api_token = auth
    ip = _client_ip(request)

    payload = await request.json()
    model: str = payload.get("model", "")

    if not model:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'model' field is required",
        )

    # Select the best host for this model
    host = await host_router.select(model, session)

    # Create job record (queued)
    job = Job(
        user_id=user.id,
        token_id=api_token.id,
        host_id=host.id,
        model=model,
        status=JobStatus.queued,
        client_ip=ip,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    await log_event(
        session,
        ip=ip,
        action="inference_queued",
        user_id=user.id,
        target=model,
        details={"job_id": job.id, "host": host.name},
    )

    timeout_s = float(settings.default_request_timeout_s)

    return StreamingResponse(
        _stream_inference(host, payload, job, session, timeout_s),
        media_type="text/event-stream",
    )


@router.get("/ollama/api/tags")
async def proxy_tags(
    auth: tuple[User, ApiToken] = Depends(get_user_from_api_token),
    session: AsyncSession = Depends(get_session),
) -> dict:
    host = await _get_primary_host(session)
    client = OllamaClient(host.base_url)
    try:
        models = await client.list_models()
        return {"models": [{"name": m} for m in models]}
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/ollama/api/ps")
async def proxy_ps(
    auth: tuple[User, ApiToken] = Depends(get_user_from_api_token),
    session: AsyncSession = Depends(get_session),
) -> dict:
    host = await _get_primary_host(session)
    client = OllamaClient(host.base_url)
    try:
        return await client.get_running_processes()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/ollama/api/version")
async def proxy_version(
    auth: tuple[User, ApiToken] = Depends(get_user_from_api_token),
    session: AsyncSession = Depends(get_session),
) -> dict:
    host = await _get_primary_host(session)
    client = OllamaClient(host.base_url)
    try:
        return await client.get_version()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/ollama/v1/models")
async def proxy_v1_models(
    auth: tuple[User, ApiToken] = Depends(get_user_from_api_token),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """OpenAI-compatible model listing."""
    host = await _get_primary_host(session)
    client = OllamaClient(host.base_url)
    try:
        models = await client.list_models()
        return {
            "object": "list",
            "data": [
                {"id": m, "object": "model", "owned_by": "ollama"}
                for m in models
            ],
        }
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
