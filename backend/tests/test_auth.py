import pytest
from httpx import AsyncClient

from tests.conftest import TestSessionMaker


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, admin_token: str):
    """admin_token fixture already validates a successful login."""
    assert admin_token


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    """Wrong password returns 401."""
    from app.core.security import hash_password
    from app.models.user import User, UserRole

    async with TestSessionMaker() as session:
        user = User(
            email="someone@test.com",
            password_hash=hash_password("correct"),
            display_name="Someone",
            role=UserRole.user,
            is_active=True,
        )
        session.add(user)
        await session.commit()

    resp = await client.post(
        "/api/auth/login",
        json={"email": "someone@test.com", "password": "wrong"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_email(client: AsyncClient):
    """Unknown email returns 401."""
    resp = await client.post(
        "/api/auth/login",
        json={"email": "ghost@nowhere.com", "password": "x"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_with_valid_token(client: AsyncClient, admin_token: str):
    """GET /api/auth/me returns the authenticated user."""
    resp = await client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "admin@localhost"
    assert data["role"] == "admin"


@pytest.mark.asyncio
async def test_me_without_token(client: AsyncClient):
    """GET /api/auth/me without auth returns 401."""
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    """Refresh token flow returns a new access token."""
    from app.core.security import hash_password
    from app.models.user import User, UserRole

    async with TestSessionMaker() as session:
        user = User(
            email="refresh@test.com",
            password_hash=hash_password("pass123"),
            display_name="Refresh User",
            role=UserRole.user,
            is_active=True,
        )
        session.add(user)
        await session.commit()

    login_resp = await client.post(
        "/api/auth/login",
        json={"email": "refresh@test.com", "password": "pass123"},
    )
    assert login_resp.status_code == 200
    refresh_token = login_resp.json()["refresh_token"]

    refresh_resp = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_resp.status_code == 200
    assert "access_token" in refresh_resp.json()


@pytest.mark.asyncio
async def test_register_closed_by_default(client: AsyncClient):
    """Registration returns 403 when registration_open=False (default)."""
    resp = await client.post(
        "/api/auth/register",
        json={"email": "new@test.com", "password": "pass123", "display_name": "New"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_register_open(client: AsyncClient, monkeypatch):
    """Registration succeeds when registration_open=True."""
    from app import config

    monkeypatch.setattr(config.settings, "registration_open", True)

    resp = await client.post(
        "/api/auth/register",
        json={"email": "newuser@test.com", "password": "pass123", "display_name": "New User"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "newuser@test.com"
    assert data["role"] == "user"
