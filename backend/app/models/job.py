from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    done = "done"
    timeout = "timeout"
    error = "error"
    cancelled = "cancelled"


class Job(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    token_id: int | None = Field(default=None, foreign_key="apitoken.id")
    host_id: int | None = Field(default=None, foreign_key="host.id")
    model: str
    status: JobStatus = JobStatus.queued
    client_ip: str
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: datetime | None = None
    duration_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    error_msg: str | None = None
