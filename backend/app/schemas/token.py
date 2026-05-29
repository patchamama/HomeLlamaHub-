from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ApiTokenCreate(BaseModel):
    name: str
    scopes: str = "inference"
    expires_in_days: int | None = None


class ApiTokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    prefix: str
    scopes: str
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    is_revoked: bool
    created_at: datetime


class ApiTokenCreatedOut(ApiTokenOut):
    """Returned only once at creation time — includes the raw token."""

    model_config = ConfigDict(from_attributes=True)

    raw_token: str
