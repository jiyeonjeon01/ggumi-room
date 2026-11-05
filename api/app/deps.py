"""Sessions, CSRF protection and request helpers shared by the routers.

Session: HttpOnly cookie `ggumi_session` with a random token; the DB keeps only
its SHA-256 (user_sessions). 30-day lifetime, extended at most once a day while
used; logout deletes the row.

CSRF: double-submit token. `ggumi_csrf` is a readable cookie; every unsafe
request (POST/PATCH/PUT/DELETE) must echo it in `X-CSRF-Token`, and its Origin
(when the browser sends one) must be our own site. SameSite=Lax on both cookies
adds a second layer.
"""

import uuid
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db, utcnow
from .models import User, UserSession
from .security import new_token, same, token_hash

SESSION_COOKIE = "ggumi_session"
CSRF_COOKIE = "ggumi_csrf"
CSRF_HEADER = "x-csrf-token"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def client_ip(request: Request) -> str:
    # nginx sets X-Real-IP from Cloudflare's CF-Connecting-IP. The API is only
    # reachable through nginx (and 127.0.0.1 for local tests), so it's trusted.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def _cookie_args() -> dict:
    s = get_settings()
    return {"secure": s.cookie_secure, "samesite": "lax", "path": "/"}


def set_session_cookie(response: Response, token: str) -> None:
    max_age = get_settings().session_days * 86400
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, **_cookie_args())


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, httponly=True, **_cookie_args())


def ensure_csrf_cookie(request: Request, response: Response) -> str:
    token = request.cookies.get(CSRF_COOKIE)
    if not token or len(token) < 20:
        token = new_token()
        response.set_cookie(CSRF_COOKIE, token, max_age=365 * 86400, httponly=False, **_cookie_args())
    return token


def csrf_protect(request: Request) -> None:
    """Router-level dependency: rejects cross-site and token-less unsafe requests."""
    if request.method not in UNSAFE_METHODS:
        return
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in get_settings().allowed_origins:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="허용되지 않은 요청이에요.")
    cookie = request.cookies.get(CSRF_COOKIE) or ""
    header = request.headers.get(CSRF_HEADER) or ""
    if not cookie or not header or not same(cookie, header):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="보안 토큰이 없거나 맞지 않아요. 새로고침 후 다시 시도해 주세요.")


def create_session(db: Session, user_id: uuid.UUID) -> str:
    token = new_token()
    now = utcnow()
    db.add(
        UserSession(
            user_id=user_id,
            token_hash=token_hash(token),
            last_seen_at=now,
            expires_at=now + timedelta(days=get_settings().session_days),
        )
    )
    return token


def delete_session(db: Session, token: str | None) -> None:
    if token:
        row = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(token)))
        if row:
            db.delete(row)


def optional_user(request: Request, response: Response, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = db.execute(
        select(UserSession, User).join(User, User.id == UserSession.user_id).where(UserSession.token_hash == token_hash(token))
    ).first()
    now = utcnow()
    if not row:
        clear_session_cookie(response)
        return None
    session, user = row
    if session.expires_at <= now or user.status != "active":
        db.delete(session)
        db.commit()
        clear_session_cookie(response)
        return None
    # Sliding expiry, written at most once a day.
    if now - session.last_seen_at > timedelta(days=1):
        session.last_seen_at = now
        session.expires_at = now + timedelta(days=get_settings().session_days)
        db.commit()
        set_session_cookie(response, token)
    return user


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요해요.")
    return user
