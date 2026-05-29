from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    secret_key: str = "change-me-in-production-use-a-long-random-string"
    database_url: str = "sqlite+aiosqlite:///./data/hub.db"
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_s: int = 900
    jwt_refresh_ttl_s: int = 2592000

    ollama_local_url: str = "http://127.0.0.1:11434"
    wol_proxy_url: str = "http://127.0.0.1:8765"
    wol_proxy_token: str = ""

    default_max_concurrency: int = 1
    default_request_timeout_s: int = 300
    rate_limit_per_min: int = 60

    registration_open: bool = False
    public_fqdn: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
