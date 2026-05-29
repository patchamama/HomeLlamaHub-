from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.deps import get_current_user, get_session
from app.core.security import generate_api_token
from app.models.token import ApiToken
from app.models.user import User, UserRole
from app.schemas.token import ApiTokenCreate, ApiTokenCreatedOut, ApiTokenOut

router = APIRouter(prefix="/api/tokens", tags=["tokens"])


@router.get("", response_model=list[ApiTokenOut])
async def list_tokens(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ApiTokenOut]:
    result = await session.exec(
        select(ApiToken).where(ApiToken.user_id == current_user.id)
    )
    tokens = list(result.all())
    return [ApiTokenOut.model_validate(t) for t in tokens]


@router.post("", response_model=ApiTokenCreatedOut, status_code=status.HTTP_201_CREATED)
async def create_token(
    body: ApiTokenCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ApiTokenCreatedOut:
    raw_token, prefix, token_hash = generate_api_token()

    expires_at: datetime | None = None
    if body.expires_in_days is not None:
        expires_at = datetime.utcnow() + timedelta(days=body.expires_in_days)

    api_token = ApiToken(
        user_id=current_user.id,
        name=body.name,
        prefix=prefix,
        token_hash=token_hash,
        scopes=body.scopes,
        expires_at=expires_at,
    )
    session.add(api_token)
    await session.commit()
    await session.refresh(api_token)

    # Build response — include raw_token once; never stored in DB
    return ApiTokenCreatedOut(
        id=api_token.id,
        user_id=api_token.user_id,
        name=api_token.name,
        prefix=api_token.prefix,
        scopes=api_token.scopes,
        expires_at=api_token.expires_at,
        last_used_at=api_token.last_used_at,
        is_revoked=api_token.is_revoked,
        created_at=api_token.created_at,
        raw_token=raw_token,
    )


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(
    token_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    api_token = await session.get(ApiToken, token_id)

    if api_token is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")

    # Only the owner or an admin can revoke
    if api_token.user_id != current_user.id and current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot revoke another user's token",
        )

    api_token.is_revoked = True
    session.add(api_token)
    await session.commit()
