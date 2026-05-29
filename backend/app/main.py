import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select

from app.api import auth, tokens
from app.api import ollama as ollama_router
from app.api.admin import audit as admin_audit
from app.api.admin import hosts as admin_hosts
from app.api.admin import settings as admin_settings
from app.api.admin import stats as admin_stats
from app.api.admin import users as admin_users
from app.config import settings
from app.core.queue import inference_queue
from app.database import async_session_maker, create_db_and_tables
from app.models.host import Host
from app.models.setting import Setting
from app.models.user import User, UserRole
from app.core.security import hash_password
from app.services.ollama import OllamaClient

logger = logging.getLogger(__name__)

_refresh_task: asyncio.Task | None = None


async def seed_defaults() -> None:
    """Create initial admin user and default settings if missing."""
    async with async_session_maker() as session:
        # Create default admin if no admin exists
        result = await session.exec(select(User).where(User.role == UserRole.admin))
        if result.first() is None:
            admin = User(
                email="admin@localhost",
                password_hash=hash_password("admin123"),
                display_name="Administrator",
                role=UserRole.admin,
                is_active=True,
            )
            session.add(admin)
            logger.warning(
                "Created default admin user: admin@localhost / admin123 — CHANGE THIS PASSWORD IMMEDIATELY"
            )

        # Create local host if none exists
        hosts_result = await session.exec(select(Host))
        if hosts_result.first() is None:
            local_host = Host(
                name="mac-mini-local",
                base_url=settings.ollama_local_url,
                is_local=True,
                is_enabled=True,
            )
            session.add(local_host)

        # Insert default settings if missing
        defaults = {
            "max_concurrency": str(settings.default_max_concurrency),
            "timeout_s": str(settings.default_request_timeout_s),
            "registration_open": str(settings.registration_open).lower(),
        }
        for key, value in defaults.items():
            existing = await session.get(Setting, key)
            if existing is None:
                session.add(Setting(key=key, value=value))

        await session.commit()


async def refresh_models_cache() -> None:
    """Background task: refresh models cache for all enabled hosts every 5 minutes."""
    while True:
        await asyncio.sleep(300)  # 5 minutes
        try:
            async with async_session_maker() as session:
                result = await session.exec(select(Host).where(Host.is_enabled == True))  # noqa: E712
                hosts = list(result.all())
                for host in hosts:
                    client = OllamaClient(host.base_url)
                    try:
                        models = await client.list_models()
                        host.models_cache = json.dumps(models)
                        host.models_cache_updated_at = datetime.utcnow()
                        session.add(host)
                    except Exception:  # noqa: BLE001
                        pass
                await session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.error("Error refreshing models cache: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _refresh_task

    # Import all models to register them with SQLModel metadata
    import app.models  # noqa: F401

    await create_db_and_tables()
    await seed_defaults()
    inference_queue.configure(settings.default_max_concurrency)

    _refresh_task = asyncio.create_task(refresh_models_cache())

    yield

    if _refresh_task is not None:
        _refresh_task.cancel()
        try:
            await _refresh_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="HomeLlamaHub",
    description="Self-hosted Ollama gateway with auth, queue, and multi-host support",
    version="0.1.0",
    lifespan=lifespan,
)

def _allowed_origins() -> list[str]:
    if settings.public_fqdn:
        return [f"https://{settings.public_fqdn}"]
    # Development fallback — never reached in production if public_fqdn is set
    return ["http://localhost:5173", "http://localhost:3000"]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

# Auth & token routes
app.include_router(auth.router)
app.include_router(tokens.router)

# Admin routes
app.include_router(admin_users.router)
app.include_router(admin_hosts.router)
app.include_router(admin_settings.router)
app.include_router(admin_stats.router)
app.include_router(admin_audit.router)

# Ollama proxy
app.include_router(ollama_router.router)


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {
        "status": "ok",
        "queue_active": inference_queue.active_count,
        "queue_waiting": inference_queue.waiting_count,
    }
