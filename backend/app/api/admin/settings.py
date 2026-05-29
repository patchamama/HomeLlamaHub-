from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.deps import get_session, require_admin
from app.core.queue import inference_queue
from app.models.setting import Setting
from app.models.user import User

router = APIRouter(prefix="/api/admin/settings", tags=["admin-settings"])

SETTING_MAX_CONCURRENCY = "max_concurrency"
SETTING_TIMEOUT_S = "timeout_s"
SETTING_REGISTRATION_OPEN = "registration_open"


class SettingsOut(BaseModel):
    max_concurrency: int
    timeout_s: int
    registration_open: bool


class SettingsPatch(BaseModel):
    max_concurrency: int | None = None
    timeout_s: int | None = None
    registration_open: bool | None = None


async def _get_setting(session: AsyncSession, key: str, default: str) -> str:
    row = await session.get(Setting, key)
    return row.value if row else default


async def _set_setting(session: AsyncSession, key: str, value: str) -> None:
    row = await session.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=value)
    else:
        row.value = value
        row.updated_at = datetime.utcnow()
    session.add(row)


@router.get("", response_model=SettingsOut)
async def get_settings_endpoint(
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> SettingsOut:
    max_concurrency = int(await _get_setting(session, SETTING_MAX_CONCURRENCY, "1"))
    timeout_s = int(await _get_setting(session, SETTING_TIMEOUT_S, "300"))
    registration_open = (
        await _get_setting(session, SETTING_REGISTRATION_OPEN, "false")
    ).lower() == "true"

    return SettingsOut(
        max_concurrency=max_concurrency,
        timeout_s=timeout_s,
        registration_open=registration_open,
    )


@router.patch("", response_model=SettingsOut)
async def patch_settings(
    body: SettingsPatch,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> SettingsOut:
    if body.max_concurrency is not None:
        await _set_setting(session, SETTING_MAX_CONCURRENCY, str(body.max_concurrency))
        # Apply change to the live semaphore
        inference_queue.configure(body.max_concurrency)

    if body.timeout_s is not None:
        await _set_setting(session, SETTING_TIMEOUT_S, str(body.timeout_s))

    if body.registration_open is not None:
        await _set_setting(
            session, SETTING_REGISTRATION_OPEN, str(body.registration_open).lower()
        )

    await session.commit()

    # Re-read and return current state
    max_concurrency = int(await _get_setting(session, SETTING_MAX_CONCURRENCY, "1"))
    timeout_s = int(await _get_setting(session, SETTING_TIMEOUT_S, "300"))
    registration_open = (
        await _get_setting(session, SETTING_REGISTRATION_OPEN, "false")
    ).lower() == "true"

    return SettingsOut(
        max_concurrency=max_concurrency,
        timeout_s=timeout_s,
        registration_open=registration_open,
    )
