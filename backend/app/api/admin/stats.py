from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import func, select

from app.api.deps import get_session, require_admin
from app.core.queue import inference_queue
from app.models.job import Job, JobStatus
from app.models.user import User

router = APIRouter(prefix="/api/admin/stats", tags=["admin-stats"])


class ModelCount(BaseModel):
    model: str
    count: int


class UserCount(BaseModel):
    user_id: int
    email: str
    count: int


class StatsOut(BaseModel):
    total_jobs: int
    jobs_today: int
    errors_today: int
    avg_duration_ms: float | None
    top_models: list[ModelCount]
    top_users: list[UserCount]
    queue_active: int
    queue_waiting: int


@router.get("", response_model=StatsOut)
async def get_stats(
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> StatsOut:
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # Total jobs
    total_result = await session.exec(select(func.count()).select_from(Job))
    total_jobs: int = total_result.one()

    # Jobs today
    jobs_today_result = await session.exec(
        select(func.count()).select_from(Job).where(Job.started_at >= today_start)
    )
    jobs_today: int = jobs_today_result.one()

    # Errors today
    errors_today_result = await session.exec(
        select(func.count())
        .select_from(Job)
        .where(Job.started_at >= today_start)
        .where(Job.status.in_([JobStatus.error.value, JobStatus.timeout.value]))  # type: ignore[attr-defined]
    )
    errors_today: int = errors_today_result.one()

    # Average duration
    avg_result = await session.exec(
        select(func.avg(Job.duration_ms)).where(Job.duration_ms != None)  # noqa: E711
    )
    avg_duration_ms: float | None = avg_result.one()

    # Top models (top 10)
    top_models_result = await session.exec(
        select(Job.model, func.count().label("cnt"))
        .group_by(Job.model)
        .order_by(func.count().desc())
        .limit(10)
    )
    top_models = [ModelCount(model=row[0], count=row[1]) for row in top_models_result.all()]

    # Top users (top 10) — join with User to get email
    top_users_result = await session.exec(
        select(Job.user_id, func.count().label("cnt"))
        .group_by(Job.user_id)
        .order_by(func.count().desc())
        .limit(10)
    )
    top_users: list[UserCount] = []
    for row in top_users_result.all():
        user_id, cnt = row[0], row[1]
        u = await session.get(User, user_id)
        email = u.email if u else "unknown"
        top_users.append(UserCount(user_id=user_id, email=email, count=cnt))

    return StatsOut(
        total_jobs=total_jobs,
        jobs_today=jobs_today,
        errors_today=errors_today,
        avg_duration_ms=avg_duration_ms,
        top_models=top_models,
        top_users=top_users,
        queue_active=inference_queue.active_count,
        queue_waiting=inference_queue.waiting_count,
    )
