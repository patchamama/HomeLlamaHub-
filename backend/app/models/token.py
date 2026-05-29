from datetime import datetime

from sqlmodel import Field, SQLModel


class ApiToken(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    name: str
    prefix: str  # first 8 chars of random part, stored plain for display
    token_hash: str  # bcrypt hash of full raw token
    scopes: str = "inference"  # comma-separated: inference,read_models,admin
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    is_revoked: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
