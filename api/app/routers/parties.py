"""Temporary party rooms: a bigger lounge anyone logged in can join through its link.

Policy:
- Any logged-in user can open one party at a time (a second request returns 409 with
  the open one). It is a fixed lounge (template "lounge"): no furniture editing, no
  guestbook, no invites; personal-room friendships and invites don't apply to it.
- Anyone logged in who has the link can join, friends or not. Joining makes them a
  member (room_members); being inside at once is capped (PARTY_CAPACITY people, several
  tabs or devices of one account count once), which the WebSocket join enforces.
- The host (creator) alone can end it. Otherwise it stays open while anyone is inside,
  also after the host left, and closes 30 minutes after the last person left (see
  realtime/parties.py). A closed party can't be entered again.
- Logged out, nothing about a party is shown (every route needs a session).
"""

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import ratelimit
from ..db import get_db, utcnow
from ..deps import current_user
from ..models import Room, RoomMember, User
from ..realtime.hub import PARTY_CAPACITY, hub, notify
from ..realtime.parties import EMPTY_CLOSE
from ..schemas import PartyJoinOut, PartyOut, PartyPreviewOut
from ..security import new_token
from .rooms import my_room, party_url

router = APIRouter(prefix="/parties", tags=["parties"])

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32}$")  # token_urlsafe(24)
NAME_MAX = 30


def _out(room: Room) -> PartyOut:
    return PartyOut(room_id=room.id, name=room.name, share_url=party_url(room.link_token or ""), capacity=PARTY_CAPACITY, count=hub.party_count(room.id))


def _open_of(db: Session, user: User) -> Room | None:
    return db.scalar(select(Room).where(Room.owner_id == user.id, Room.kind == "party", Room.closed_at.is_(None)))


def _already_open(room: Room) -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        detail={"code": "party_open", "message": "이미 열어 둔 파티룸이 있어요.", "room_id": str(room.id)},
    )


@router.post("", response_model=PartyOut, status_code=status.HTTP_201_CREATED)
def create(user: User = Depends(current_user), db: Session = Depends(get_db)) -> PartyOut:
    if room := _open_of(db, user):
        raise _already_open(room)
    if not ratelimit.allow(f"party-create:{user.id}", 5, 3600):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="파티룸을 너무 자주 열었어요. 잠시 후에 다시 열어 주세요.")
    now = utcnow()
    room = Room(
        owner_id=user.id,
        name=f"{user.nickname}님의 파티룸"[:NAME_MAX],
        theme=my_room(db, user).theme,
        visibility="link",
        is_default=False,
        kind="party",
        template="lounge",
        link_token=new_token(24),
        # Nobody inside yet: it closes like an emptied room unless someone comes in.
        closes_at=now + EMPTY_CLOSE,
        last_active_at=now,
        guestbook_enabled=False,
    )
    db.add(room)
    try:
        db.flush()
    except IntegrityError:
        # Two create requests at once: the one-open-party index let only one through.
        db.rollback()
        if room := _open_of(db, user):
            raise _already_open(room) from None
        raise
    db.add(RoomMember(room_id=room.id, user_id=user.id, role="host"))
    db.commit()
    return _out(room)


@router.get("/mine", response_model=PartyOut | None)
def mine(user: User = Depends(current_user), db: Session = Depends(get_db)) -> PartyOut | None:
    """The party I host that's still open, if any."""
    room = _open_of(db, user)
    return _out(room) if room else None


def _by_token(db: Session, token: str) -> tuple[Room, User] | None:
    if not TOKEN_RE.fullmatch(token):
        return None
    row = db.execute(select(Room, User).join(User, User.id == Room.owner_id).where(Room.link_token == token, Room.kind == "party")).first()
    return (row[0], row[1]) if row else None


@router.get("/join/{token}", response_model=PartyPreviewOut)
def preview(token: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> PartyPreviewOut:
    ratelimit.hit(f"party-view:{user.id}", 60, 60)
    found = _by_token(db, token[:64])
    if not found:
        return PartyPreviewOut(status="not_found")
    room, host = found
    if room.closed_at is not None or host.status != "active":
        return PartyPreviewOut(status="closed")
    return PartyPreviewOut(
        status="open", room_id=room.id, name=room.name, host_nickname=host.nickname, capacity=PARTY_CAPACITY, count=hub.party_count(room.id)
    )


@router.post("/join/{token}", response_model=PartyJoinOut)
def join(token: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> PartyJoinOut:
    """Become a member (allowed in). Whether there's a free spot is decided when the room is entered."""
    ratelimit.hit(f"party-join:{user.id}", 30, 3600)
    found = _by_token(db, token[:64])
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"status": "not_found", "message": "파티룸 링크를 찾을 수 없어요."})
    room, host = found
    if room.closed_at is not None or host.status != "active":
        raise HTTPException(status.HTTP_410_GONE, detail={"status": "closed", "message": "이미 끝난 파티룸이에요."})
    db.execute(insert(RoomMember).values(room_id=room.id, user_id=user.id, role="member").on_conflict_do_nothing(index_elements=["room_id", "user_id"]))
    db.commit()
    return PartyJoinOut(room_id=room.id)


@router.post("/{room_id}/close", status_code=status.HTTP_204_NO_CONTENT)
def close(room_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    """The host ends the party for everyone. Nobody else can (same 404 as a missing room)."""
    room = db.get(Room, room_id)
    if not room or room.kind != "party" or room.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="파티룸을 찾을 수 없거나 끝낼 권한이 없어요.")
    if room.closed_at is None:
        db.execute(update(Room).where(Room.id == room.id, Room.closed_at.is_(None)).values(closed_at=utcnow()))
        db.commit()
    notify(hub.close_room, room.id)

