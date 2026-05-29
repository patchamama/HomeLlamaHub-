from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.deps import get_session, require_admin
from app.models.audit import AuditEvent
from app.models.user import User

router = APIRouter(prefix="/api/admin/audit", tags=["admin-audit"])


class AuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    ip: str
    user_id: int | None = None
    action: str
    target: str | None = None
    success: bool
    details: str | None = None


@router.get("", response_model=list[AuditEventOut])
async def list_audit_events(
    user_id: int | None = Query(default=None),
    action: str | None = Query(default=None),
    ip: str | None = Query(default=None),
    from_ts: datetime | None = Query(default=None),
    to_ts: datetime | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, le=500),
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[AuditEventOut]:
    query = select(AuditEvent)

    if user_id is not None:
        query = query.where(AuditEvent.user_id == user_id)
    if action is not None:
        query = query.where(AuditEvent.action == action)
    if ip is not None:
        query = query.where(AuditEvent.ip == ip)
    if from_ts is not None:
        query = query.where(AuditEvent.ts >= from_ts)
    if to_ts is not None:
        query = query.where(AuditEvent.ts <= to_ts)

    query = query.order_by(AuditEvent.ts.desc()).offset(offset).limit(limit)  # type: ignore[attr-defined]

    result = await session.exec(query)
    events = list(result.all())
    return [AuditEventOut.model_validate(e) for e in events]
