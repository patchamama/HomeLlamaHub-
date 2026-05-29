import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TOKEN_PREFIX = "hlh_"
TOKEN_RANDOM_BYTES = 24  # 32 url-safe base64 chars


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def create_access_token(user_id: int, role: str) -> str:
    expire = _utc_now() + timedelta(seconds=settings.jwt_access_ttl_s)
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "exp": expire,
        "iat": _utc_now(),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: int) -> str:
    expire = _utc_now() + timedelta(seconds=settings.jwt_refresh_ttl_s)
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": expire,
        "iat": _utc_now(),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        return payload
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def generate_api_token() -> tuple[str, str, str]:
    """Generate an API token.

    Returns:
        (raw_token, prefix, token_hash)
        - raw_token: the full token string to hand to the user once
        - prefix: first 8 chars of the random part, stored for display
        - token_hash: bcrypt hash of the full raw_token
    """
    random_part = secrets.token_urlsafe(TOKEN_RANDOM_BYTES)  # ~32 chars
    raw_token = f"{TOKEN_PREFIX}{random_part}"
    prefix = random_part[:8]
    token_hash = pwd_context.hash(raw_token)
    return raw_token, prefix, token_hash


def verify_api_token(raw_token: str, token_hash: str) -> bool:
    return pwd_context.verify(raw_token, token_hash)
