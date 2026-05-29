from datetime import datetime

from sqlmodel import Field, SQLModel


class AuditEvent(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    ts: datetime = Field(default_factory=datetime.utcnow, index=True)
    ip: str
    user_id: int | None = None
    action: str  # login, login_failed, token_created, token_used, inference_queued, wol_triggered, etc.
    target: str | None = None
    success: bool = True
    details: str | None = None  # JSON string
