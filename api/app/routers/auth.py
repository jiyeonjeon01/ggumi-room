
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, or_, select
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
from ..models import Friendship, Room, User, UserSession
from .rooms import write_items
from ..schemas import LoginIdCheckOut, LoginIn, MeOut, SignupIn, WithdrawIn
from ..realtime.hub import hub, notify
from ..security import hash_password, needs_rehash, token_hash, verify_password
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


# Open sign-up: anyone may make an account, so mass sign-ups are slowed down per
# address and overall (one API process: the counters are in memory, see ratelimit).
SIGNUP_PER_IP_HOUR = 10
SIGNUP_PER_IP_DAY = 20
SIGNUP_ALL_HOUR = 60


@router.post("/signup", response_model=MeOut, status_code=status.HTTP_201_CREATED)
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)) -> MeOut:
    ip = client_ip(request)
    ratelimit.hit(f"signup:{ip}", SIGNUP_PER_IP_HOUR, 3600)
    ratelimit.hit(f"signup-day:{ip}", SIGNUP_PER_IP_DAY, 86400)
    ratelimit.hit("signup-all", SIGNUP_ALL_HOUR, 3600)
    if body.website:
        # Filled the hidden field: a script, not a person. Same answer as any refusal, no account.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"message": "가입하지 못했어요. 잠시 후 다시 시도해 주세요."})
    if not body.agree:
        raise _bad("agree", "만 14세 이상이고 개인정보처리방침에 동의해야 가입할 수 있어요.")
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
    user = User(login_id=login_id, nickname=nickname, password_hash=hash_password(body.password), terms_agreed_at=utcnow())
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
    token = request.cookies.get(SESSION_COOKIE)
    delete_session(db, token)
    db.commit()
    clear_session_cookie(response)
    if token:
        # Realtime connections opened with this session end right away.
        notify(hub.close_sessions, {token_hash(token)})


@router.post("/withdraw", status_code=status.HTTP_204_NO_CONTENT)
def withdraw(body: WithdrawIn, request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    """Deletes the account and everything that belongs to it (rooms, furniture, friends,
    chats on both sides, guestbook posts, parties, sessions), after the password is confirmed.
    Reports others filed about this account stay, without the link to it."""
    ratelimit.hit(f"withdraw:{user.id}", 5, 900)
    if not verify_password(user.password_hash, body.password):
        raise _bad("password", "비밀번호가 맞지 않아요.")
    sessions = set(db.scalars(select(UserSession.token_hash).where(UserSession.user_id == user.id)))
    friends = [a if b == user.id else b for a, b in db.execute(select(Friendship.user_a_id, Friendship.user_b_id).where(or_(Friendship.user_a_id == user.id, Friendship.user_b_id == user.id)))]
    rooms = list(db.scalars(select(Room.id).where(Room.owner_id == user.id)))
    db.execute(delete(User).where(User.id == user.id))  # every table cascades from users
    db.commit()
    clear_session_cookie(response)
    # Their sockets close, anyone in their rooms is let out, friends' lists update.
    notify(hub.close_sessions, sessions)
    for room_id in rooms:
        notify(hub.close_room, room_id)
    if friends:
        notify(hub.friends_changed, friends)


@router.get("/me", response_model=MeOut)
def me(request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)) -> MeOut:
    ensure_csrf_cookie(request, response)
    return _me(db, user)


@router.get("/session")
def session_state(request: Request, response: Response, user: User | None = Depends(optional_user), db: Session = Depends(get_db)) -> dict:
    """Like /me but 200 for guests too (avoids a console 401 on every page load)."""
    ensure_csrf_cookie(request, response)
    return {"user": _me(db, user).model_dump(mode="json") if user else None, "server_time": utcnow().isoformat()}
