"""Blocking and reporting other users.

Blocking (either way) ends what the two share and keeps them apart:
- the friendship and pending friend requests between them go away;
- invites to each other's rooms are withdrawn and whoever is inside the other's room
  steps out; neither can enter the other's personal room again;
- they don't find each other in search and can't send friend requests (1:1 chat needs a
  friendship, so it stops too).
Party rooms are public by link and not covered (they're temporary).
The blocked person isn't told; a refused friend request reads the same either way.

Reports are stored for the operator (no admin page yet: read the `reports` table).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .. import ratelimit
from ..access import lock_pair, pair
from ..db import get_db, utcnow
from ..deps import current_user
from ..models import FriendRequest, Friendship, Report, Room, RoomGuest, User, UserBlock
from ..realtime.hub import hub, notify
from ..schemas import BlockedOut, BlockIn, ReportIn
from .messages import clean_body

router = APIRouter(tags=["safety"])


@router.get("/blocks", response_model=list[BlockedOut])
def blocked(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[BlockedOut]:
    rows = db.execute(
        select(UserBlock, User).join(User, User.id == UserBlock.blocked_id).where(UserBlock.blocker_id == user.id).order_by(UserBlock.created_at.desc())
    ).all()
    return [BlockedOut(user_id=u.id, nickname=u.nickname, blocked_at=b.created_at) for b, u in rows]


@router.post("/blocks", status_code=status.HTTP_204_NO_CONTENT)
def block(body: BlockIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    ratelimit.hit(f"block:{user.id}", 30, 3600)
    other = db.get(User, body.user_id)
    if body.user_id == user.id or not other:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없어요.")
    lock_pair(db, user.id, other.id)
    db.execute(insert(UserBlock).values(blocker_id=user.id, blocked_id=other.id).on_conflict_do_nothing())
    x, y = pair(user.id, other.id)
    db.execute(delete(Friendship).where(Friendship.user_a_id == x, Friendship.user_b_id == y))
    db.execute(
        update(FriendRequest)
        .where(
            FriendRequest.status == "pending",
            or_(
                and_(FriendRequest.requester_id == user.id, FriendRequest.addressee_id == other.id),
                and_(FriendRequest.requester_id == other.id, FriendRequest.addressee_id == user.id),
            ),
        )
        .values(status="cancelled", responded_at=utcnow())
    )
    rooms = select(Room.id).where(Room.owner_id.in_([user.id, other.id]))
    db.execute(
        delete(RoomGuest).where(
            RoomGuest.room_id.in_(rooms),
            or_(RoomGuest.user_id == user.id, RoomGuest.user_id == other.id),
        )
    )
    db.commit()
    # Out of each other's rooms right away, and both lists refresh.
    notify(hub.drop_from_rooms, other.id, user.id)
    notify(hub.drop_from_rooms, user.id, other.id)
    notify(hub.friends_changed, [user.id, other.id])


@router.delete("/blocks/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def unblock(user_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    """Lifts the block. Nothing comes back by itself: they can become friends again by request."""
    gone = db.execute(delete(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == user_id)).rowcount
    db.commit()
    if not gone:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="차단한 사용자가 아니에요.")


@router.post("/reports", status_code=status.HTTP_201_CREATED)
def report(body: ReportIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    ratelimit.hit(f"report:{user.id}", 10, 3600)
    target = db.get(User, body.user_id)
    if body.user_id == user.id or not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없어요.")
    detail = clean_body(body.detail) if body.detail.strip() else ""
    db.add(
        Report(
            reporter_id=user.id,
            target_id=target.id,
            target_nickname=target.nickname,
            target_login_id=target.login_id,
            reason=body.reason,
            context=body.context,
            detail=detail,
        )
    )
    db.commit()
    return {"status": "received"}
