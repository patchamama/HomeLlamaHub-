import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

# Import all models to register them with SQLModel metadata
import app.models  # noqa: F401
from app.database import get_session
from app.main import app

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)

TestSessionMaker = sessionmaker(  # type: ignore[call-overload]
    test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_db():
    """Create all tables before each test, drop after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)


async def override_get_session():
    async with TestSessionMaker() as session:
        yield session


app.dependency_overrides[get_session] = override_get_session


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def admin_token(client: AsyncClient) -> str:
    """Register (or rely on seed) the default admin and return an access token."""
    # Seed defaults by hitting health first (triggers lifespan in test context is tricky)
    # Instead, create admin directly via session
    async with TestSessionMaker() as session:
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        admin = User(
            email="admin@localhost",
            password_hash=hash_password("admin123"),
            display_name="Administrator",
            role=UserRole.admin,
            is_active=True,
        )
        session.add(admin)
        await session.commit()

    resp = await client.post(
        "/api/auth/login",
        json={"email": "admin@localhost", "password": "admin123"},
    )
    assert resp.status_code == 200
    return resp.json()["access_token"]


@pytest_asyncio.fixture
async def user_token(client: AsyncClient) -> str:
    """Create a regular user and return an access token."""
    async with TestSessionMaker() as session:
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        user = User(
            email="user@test.com",
            password_hash=hash_password("password123"),
            display_name="Test User",
            role=UserRole.user,
            is_active=True,
        )
        session.add(user)
        await session.commit()

    resp = await client.post(
        "/api/auth/login",
        json={"email": "user@test.com", "password": "password123"},
    )
    assert resp.status_code == 200
    return resp.json()["access_token"]
