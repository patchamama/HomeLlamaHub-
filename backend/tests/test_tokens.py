import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_token(client: AsyncClient, user_token: str):
    """Creating an API token returns the raw token once."""
    resp = await client.post(
        "/api/tokens",
        json={"name": "my-token", "scopes": "inference"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "my-token"
    assert data["scopes"] == "inference"
    assert "raw_token" in data
    assert data["raw_token"].startswith("hlh_")
    assert len(data["prefix"]) == 8


@pytest.mark.asyncio
async def test_list_tokens(client: AsyncClient, user_token: str):
    """Listing tokens returns the user's tokens."""
    # Create two tokens
    await client.post(
        "/api/tokens",
        json={"name": "token-a"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    await client.post(
        "/api/tokens",
        json={"name": "token-b"},
        headers={"Authorization": f"Bearer {user_token}"},
    )

    resp = await client.get(
        "/api/tokens",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert resp.status_code == 200
    tokens = resp.json()
    assert len(tokens) == 2
    names = {t["name"] for t in tokens}
    assert names == {"token-a", "token-b"}


@pytest.mark.asyncio
async def test_revoke_token(client: AsyncClient, user_token: str):
    """Revoking a token marks it as revoked."""
    create_resp = await client.post(
        "/api/tokens",
        json={"name": "temp-token"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    token_id = create_resp.json()["id"]

    del_resp = await client.delete(
        f"/api/tokens/{token_id}",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert del_resp.status_code == 204

    # Listing should still show the token but as revoked
    list_resp = await client.get(
        "/api/tokens",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    tokens = list_resp.json()
    revoked = [t for t in tokens if t["id"] == token_id]
    assert len(revoked) == 1
    assert revoked[0]["is_revoked"] is True


@pytest.mark.asyncio
async def test_cannot_revoke_other_users_token(
    client: AsyncClient, user_token: str, admin_token: str
):
    """A user cannot revoke another user's token."""
    create_resp = await client.post(
        "/api/tokens",
        json={"name": "admin-token"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert create_resp.status_code == 201
    token_id = create_resp.json()["id"]

    del_resp = await client.delete(
        f"/api/tokens/{token_id}",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert del_resp.status_code == 403


@pytest.mark.asyncio
async def test_token_with_expiry(client: AsyncClient, user_token: str):
    """Token created with expires_in_days has an expiry date."""
    resp = await client.post(
        "/api/tokens",
        json={"name": "expiring-token", "expires_in_days": 30},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["expires_at"] is not None


@pytest.mark.asyncio
async def test_create_token_requires_auth(client: AsyncClient):
    """Creating a token without JWT returns 401."""
    resp = await client.post("/api/tokens", json={"name": "x"})
    assert resp.status_code == 401
