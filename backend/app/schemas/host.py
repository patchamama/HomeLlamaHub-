from datetime import datetime

from pydantic import BaseModel, ConfigDict


class HostCreate(BaseModel):
    name: str
    base_url: str
    mac_address: str | None = None
    local_ip: str | None = None
    is_local: bool = False
    requires_wol: bool = False


class HostUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    mac_address: str | None = None
    local_ip: str | None = None
    is_local: bool | None = None
    requires_wol: bool | None = None
    is_enabled: bool | None = None


class HostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    base_url: str
    mac_address: str | None = None
    local_ip: str | None = None
    is_local: bool
    requires_wol: bool
    is_enabled: bool
    models_cache: str
    models_cache_updated_at: datetime | None = None
    created_at: datetime
