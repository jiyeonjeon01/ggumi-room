"""Room invite links.

Policy:
- Only for your own room. One live link per room; asking again returns it.
- Valid for `invite_days` (7) from creation; unlimited uses meanwhile.
- "Regenerate" revokes the current link and makes a new one; "revoke" just ends it.
- Opening a link shows a public preview (inviter nickname, room name) with no login.
- Accepting (logged in) adds the user as a room guest. It never creates a friendship.
"""

import re
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .. import ratelimit
from ..access import relation
from ..config import get_settings
from ..db import get_db, utcnow
from ..deps import client_ip, current_user
from ..models import Room, RoomGuest, RoomInvitation, User
from ..schemas import InviteAcceptOut, InviteOut, InvitePreviewOut
from ..security import new_token
from .rooms import my_room

router = APIRouter(tags=["invites"])

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32}$")  # token_urlsafe(24)


def _url(token: str) -> str:
    return f"{get_settings().public_base_url.rstrip('/')}/invite/{token}"


def _live(db: Session, room: Room) -> RoomInvitation | None:
    return db.scalar(select(RoomInvitation).where(RoomInvitation.room_id == room.id, RoomInvitation.revoked_at.is_(None)))


def _revoke_live(db: Session, room: Room) -> None:
    db.execute(
        update(RoomInvitation)
        .where(RoomInvitation.room_id == room.id, RoomInvitation.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


def _issue(db: Session, room: Room, user: User) -> RoomInvitation:
    now = utcnow()
    inv = RoomInvitation(
        room_id=room.id,
        created_by=user.id,
        token=new_token(24),
        created_at=now,
        expires_at=now + timedelta(days=get_settings().invite_days),
    )
    db.add(inv)
    return inv


@router.post("/rooms/me/invite", response_model=InviteOut)
def get_or_create_invite(user: User = Depends(current_user), db: Session = Depends(get_db)) -> InviteOut:
    ratelimit.hit(f"invite:{user.id}", 30, 3600)
    room = my_room(db, user)
    inv = _live(db, room)
    if inv and inv.expires_at <= utcnow():
        _revoke_live(db, room)  # expired: replace it
        inv = None
    if inv is None:
        inv = _issue(db, room, user)
    db.commit()
    return InviteOut(url=_url(inv.token), expires_at=inv.expires_at)


@router.post("/rooms/me/invite/regenerate", response_model=InviteOut)
def regenerate_invite(user: User = Depends(current_user), db: Session = Depends(get_db)) -> InviteOut:
    ratelimit.hit(f"invite:{user.id}", 30, 3600)
    room = my_room(db, user)
    _revoke_live(db, room)
    db.flush()
    inv = _issue(db, room, user)
    db.commit()
    return InviteOut(url=_url(inv.token), expires_at=inv.expires_at)


@router.delete("/rooms/me/invite", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    _revoke_live(db, my_room(db, user))
    db.commit()


def _lookup(db: Session, token: str) -> tuple[str, RoomInvitation | None, Room | None, User | None]:
    if not TOKEN_RE.fullmatch(token):
        return "not_found", None, None, None
    row = db.execute(
        select(RoomInvitation, Room, User)
        .join(Room, Room.id == RoomInvitation.room_id)
        .join(User, User.id == Room.owner_id)
        .where(RoomInvitation.token == token, Room.kind == "personal")
    ).first()
    if not row:
        return "not_found", None, None, None
    inv, room, owner = row
    if inv.revoked_at is not None:
        return "revoked", inv, room, owner
    if inv.expires_at <= utcnow() or owner.status != "active":
        return "expired", inv, room, owner
    return "valid", inv, room, owner


@router.get("/invites/{token}", response_model=InvitePreviewOut)
def preview_invite(token: str, request: Request, db: Session = Depends(get_db)) -> InvitePreviewOut:
    """Public: no login needed. Reveals only the inviter's nickname and room name, and only for live links."""
    ratelimit.hit(f"invite-view:{client_ip(request)}", 60, 60)
    state, inv, room, owner = _lookup(db, token[:64])
    if state != "valid":
        return InvitePreviewOut(status=state)
    return InvitePreviewOut(status="valid", inviter_nickname=owner.nickname, room_name=room.name, expires_at=inv.expires_at)


@router.post("/invites/{token}/accept", response_model=InviteAcceptOut)
def accept_invite(token: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> InviteAcceptOut:
    ratelimit.hit(f"invite-accept:{user.id}", 30, 3600)
    state, inv, room, owner = _lookup(db, token[:64])
    if state != "valid":
        raise HTTPException(
            status.HTTP_410_GONE if state in ("expired", "revoked") else status.HTTP_404_NOT_FOUND,
            detail={"status": state, "message": "만료되었거나 더 이상 쓸 수 없는 초대 링크예요."},
        )
    if owner.id != user.id:
        db.execute(
            insert(RoomGuest)
            .values(room_id=room.id, user_id=user.id, invitation_id=inv.id)
            .on_conflict_do_nothing(index_elements=["room_id", "user_id"])
        )
        db.commit()
    # Owner's nickname and our relation, so the room can offer a friend request.
    # Nothing is created here: becoming friends still goes through a request the user sends.
    return InviteAcceptOut(
        room_id=room.id,
        invitation_id=inv.id,
        owner_id=owner.id,
        owner_nickname=owner.nickname,
        relation=relation(db, user.id, owner.id),
    )
