import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent


async def log_event(
    session: AsyncSession,
    ip: str,
    action: str,
    user_id: int | None = None,
    target: str | None = None,
    success: bool = True,
    details: dict | None = None,
) -> None:
    """Write a single audit event to the database."""
    event = AuditEvent(
        ip=ip,
        action=action,
        user_id=user_id,
        target=target,
        success=success,
        details=json.dumps(details) if details is not None else None,
    )
    session.add(event)
    await session.commit()
