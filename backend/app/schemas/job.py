from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.job import JobStatus


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    token_id: int | None = None
    host_id: int | None = None
    model: str
    status: JobStatus
    client_ip: str
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    error_msg: str | None = None
