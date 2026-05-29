from datetime import datetime

from sqlmodel import Field, SQLModel


class Host(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    base_url: str  # e.g. http://127.0.0.1:11434
    mac_address: str | None = None
    local_ip: str | None = None
    is_local: bool = True  # True = mac mini itself
    requires_wol: bool = False
    is_enabled: bool = True
    models_cache: str = "[]"  # JSON list of model names
    models_cache_updated_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
