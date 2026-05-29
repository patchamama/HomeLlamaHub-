from collections.abc import AsyncGenerator
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.security import decode_token, verify_api_token
from app.database import get_session
from app.models.token import ApiToken
from app.models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

TOKEN_PREFIX = "hlh_"


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    payload = decode_token(token)

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    user_id = int(payload["sub"])
    user = await session.get(User, user_id)

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    return user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


async def get_user_from_api_token(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> tuple[User, ApiToken]:
    """Authenticate via a Bearer hlh_... API token."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    raw_token = auth_header.removeprefix("Bearer ").strip()

    if not raw_token.startswith(TOKEN_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token format",
        )

    result = await session.exec(
        select(ApiToken).where(
            ApiToken.is_revoked == False,  # noqa: E712
        )
    )
    tokens: list[ApiToken] = list(result.all())

    # Check expiry and verify hash
    now = datetime.now(tz=timezone.utc)
    matched_token: ApiToken | None = None

    for api_token in tokens:
        if api_token.expires_at and api_token.expires_at.replace(tzinfo=timezone.utc) < now:
            continue
        if verify_api_token(raw_token, api_token.token_hash):
            matched_token = api_token
            break

    if matched_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired API token",
        )

    user = await session.get(User, matched_token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Associated user not found or inactive",
        )

    # Update last_used_at
    matched_token.last_used_at = datetime.utcnow()
    session.add(matched_token)
    await session.commit()
    await session.refresh(matched_token)

    return user, matched_token
