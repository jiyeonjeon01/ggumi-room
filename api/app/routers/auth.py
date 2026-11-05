from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import ratelimit
from ..db import get_db, utcnow
from ..deps import (
    SESSION_COOKIE,
    clear_session_cookie,
    client_ip,
    create_session,
    current_user,
    delete_session,
    ensure_csrf_cookie,
    optional_user,
    set_session_cookie,
)
from ..layout import default_layout
from ..models import Room, User
from .rooms import write_items
from ..schemas import LoginIdCheckOut, LoginIn, MeOut, SignupIn
from ..security import hash_password, needs_rehash, verify_password
from ..validation import (
    login_id_error,
    nickname_error,
    normalize_login_id,
    normalize_nickname,
    password_error,
)

router = APIRouter(prefix="/auth", tags=["auth"])

LOGIN_FAILED = "아이디 또는 비밀번호가 올바르지 않아요."


def _bad(field: str, message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"field": field, "message": message})


def _me(db: Session, user: User) -> MeOut:
    room_id = db.scalar(select(Room.id).where(Room.owner_id == user.id, Room.is_default))
    return MeOut(id=user.id, login_id=user.login_id, nickname=user.nickname, created_at=user.created_at, room_id=room_id)


@router.get("/csrf")
def csrf(request: Request, response: Response) -> dict:
    """Sets (if needed) and returns the CSRF token the client must send back in X-CSRF-Token."""
    return {"csrf_token": ensure_csrf_cookie(request, response)}


@router.get("/check-login-id", response_model=LoginIdCheckOut)
def check_login_id(login_id: str, request: Request, db: Session = Depends(get_db)) -> LoginIdCheckOut:
    ratelimit.hit(f"check-id:{client_ip(request)}", 30, 60)
    normalized = normalize_login_id(login_id[:64])
    if err := login_id_error(normalized):
        return LoginIdCheckOut(available=False, message=err)
    taken = db.scalar(select(User.id).where(User.login_id == normalized)) is not None
    return LoginIdCheckOut(available=not taken, message="이미 사용 중인 아이디예요." if taken else "사용할 수 있는 아이디예요.")


@router.post("/signup", response_model=MeOut, status_code=status.HTTP_201_CREATED)
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)) -> MeOut:
    ratelimit.hit(f"signup:{client_ip(request)}", 10, 3600)
    nickname = normalize_nickname(body.nickname)
    login_id = normalize_login_id(body.login_id)
    if err := nickname_error(nickname):
        raise _bad("nickname", err)
    if err := login_id_error(login_id):
        raise _bad("login_id", err)
    if err := password_error(body.password, login_id):
        raise _bad("password", err)
    if body.password != body.password_confirm:
        raise _bad("password_confirm", "비밀번호가 서로 달라요.")

    # User + default room + first session in one transaction.
    user = User(login_id=login_id, nickname=nickname, password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _bad("login_id", "이미 사용 중인 아이디예요.") from None
    room = Room(owner_id=user.id, name=f"{nickname}의 방"[:30], theme="pastel", is_default=True)
    db.add(room)
    db.flush()
    write_items(db, room, default_layout())  # same default as existing rooms got in the migration
    token = create_session(db, user.id)
    db.commit()

    set_session_cookie(response, token)
    ensure_csrf_cookie(request, response)
    return _me(db, user)


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> MeOut:
    ip = client_ip(request)
    login_id = normalize_login_id(body.login_id)
    ratelimit.hit(f"login-ip:{ip}", 20, 300)
    ratelimit.hit(f"login-id:{login_id}", 10, 900)

    user = db.scalar(select(User).where(User.login_id == login_id)) if not login_id_error(login_id) else None
    ok = verify_password(user.password_hash if user else None, body.password[:256])
    if not user or not ok or user.status != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=LOGIN_FAILED)

    ratelimit.clear(f"login-id:{login_id}")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    # New token on every login (the old cookie's session, if any, is dropped).
    delete_session(db, request.cookies.get(SESSION_COOKIE))
    token = create_session(db, user.id)
    db.commit()
    set_session_cookie(response, token)
    ensure_csrf_cookie(request, response)
    return _me(db, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    delete_session(db, request.cookies.get(SESSION_COOKIE))
    db.commit()
    clear_session_cookie(response)


@router.get("/me", response_model=MeOut)
def me(request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)) -> MeOut:
    ensure_csrf_cookie(request, response)
    return _me(db, user)


@router.get("/session")
def session_state(request: Request, response: Response, user: User | None = Depends(optional_user), db: Session = Depends(get_db)) -> dict:
    """Like /me but 200 for guests too (avoids a console 401 on every page load)."""
    ensure_csrf_cookie(request, response)
    return {"user": _me(db, user).model_dump(mode="json") if user else None, "server_time": utcnow().isoformat()}
