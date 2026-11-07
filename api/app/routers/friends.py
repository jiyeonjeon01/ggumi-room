"""Friend search and mutual friend requests.

Flow: A searches -> A sends a request -> B accepts or declines -> on accept a
single Friendship row (ordered pair) is created. If B had already asked A, A's
request simply accepts B's. DB constraints (one pending request per pair,
friendship primary key) keep concurrent clicks consistent.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import ratelimit
from ..access import are_friends, blocked_between, lock_pair, pair, room_access
from ..db import get_db, utcnow
from ..deps import current_user
from ..models import FriendRequest, Friendship, Room, User, UserBlock
from ..realtime.hub import hub, notify
from ..schemas import (
    FriendOut,
    FriendRequestIn,
    FriendRequestOut,
    FriendRequestResultOut,
    FriendRequestsOut,
    PublicUserOut,
    SearchResultOut,
)

router = APIRouter(prefix="/friends", tags=["friends"])

SEARCH_MIN = 1
SEARCH_MAX = 12
PAGE_MAX = 20


def public(u: User) -> PublicUserOut:
    return PublicUserOut(id=u.id, nickname=u.nickname, joined_at=u.created_at)


def _like_escape(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/search", response_model=list[SearchResultOut])
def search(
    q: str = Query(min_length=SEARCH_MIN, max_length=SEARCH_MAX),
    limit: int = Query(10, ge=1, le=PAGE_MAX),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[SearchResultOut]:
    ratelimit.hit(f"search:{user.id}", 30, 60)
    term = q.strip()
    if not term:
        return []
    found = db.scalars(
        select(User)
        .where(
            func.lower(User.nickname).like(f"%{_like_escape(term.lower())}%", escape="\\"),
            User.id != user.id,
            User.status == "active",
            # Blocked either way: they don't find each other.
            User.id.not_in(select(UserBlock.blocked_id).where(UserBlock.blocker_id == user.id)),
            User.id.not_in(select(UserBlock.blocker_id).where(UserBlock.blocked_id == user.id)),
        )
        # Exact matches first, then the oldest accounts.
        .order_by((func.lower(User.nickname) == term.lower()).desc(), User.created_at)
        .limit(limit)
    ).all()
    ids = [u.id for u in found]
    friend_ids = {
        a if b == user.id else b
        for a, b in db.execute(
            select(Friendship.user_a_id, Friendship.user_b_id).where(
                or_(
                    and_(Friendship.user_a_id == user.id, Friendship.user_b_id.in_(ids)),
                    and_(Friendship.user_b_id == user.id, Friendship.user_a_id.in_(ids)),
                )
            )
        )
    }
    pending = db.scalars(
        select(FriendRequest).where(
            FriendRequest.status == "pending",
            or_(
                and_(FriendRequest.requester_id == user.id, FriendRequest.addressee_id.in_(ids)),
                and_(FriendRequest.addressee_id == user.id, FriendRequest.requester_id.in_(ids)),
            ),
        )
    ).all()
    out_req = {r.addressee_id: r.id for r in pending if r.requester_id == user.id}
    in_req = {r.requester_id: r.id for r in pending if r.addressee_id == user.id}

    results = []
    for u in found:
        if u.id in friend_ids:
            rel, rid = "friend", None
        elif u.id in in_req:
            rel, rid = "incoming", in_req[u.id]
        elif u.id in out_req:
            rel, rid = "outgoing", out_req[u.id]
        else:
            rel, rid = "none", None
        results.append(SearchResultOut(id=u.id, nickname=u.nickname, joined_at=u.created_at, relation=rel, request_id=rid))
    return results


@router.get("", response_model=list[FriendOut])
def list_friends(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[FriendOut]:
    rows = db.execute(
        select(User, Friendship.created_at, Room.id)
        .join(
            Friendship,
            or_(
                and_(Friendship.user_a_id == user.id, Friendship.user_b_id == User.id),
                and_(Friendship.user_b_id == user.id, Friendship.user_a_id == User.id),
            ),
        )
        .outerjoin(Room, and_(Room.owner_id == User.id, Room.is_default))
        .order_by(func.lower(User.nickname))
    ).all()
    return [
        FriendOut(id=u.id, nickname=u.nickname, joined_at=u.created_at, room_id=room_id, since=since)
        for u, since, room_id in rows
    ]


@router.get("/requests", response_model=FriendRequestsOut)
def list_requests(user: User = Depends(current_user), db: Session = Depends(get_db)) -> FriendRequestsOut:
    def load(mine_col, other_col) -> list[FriendRequestOut]:
        rows = db.execute(
            select(FriendRequest, User)
            .join(User, User.id == other_col)
            .where(mine_col == user.id, FriendRequest.status == "pending")
            .order_by(FriendRequest.created_at.desc())
        ).all()
        return [FriendRequestOut(id=r.id, user=public(u), created_at=r.created_at) for r, u in rows]

    return FriendRequestsOut(
        incoming=load(FriendRequest.addressee_id, FriendRequest.requester_id),
        outgoing=load(FriendRequest.requester_id, FriendRequest.addressee_id),
    )


def _befriend(db: Session, a: uuid.UUID, b: uuid.UUID) -> None:
    x, y = pair(a, b)
    if not are_friends(db, x, y):
        db.add(Friendship(user_a_id=x, user_b_id=y))


@router.post("/requests", response_model=FriendRequestResultOut, status_code=status.HTTP_201_CREATED)
def send_request(body: FriendRequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> FriendRequestResultOut:
    ratelimit.hit(f"friend-req:{user.id}", 30, 3600)
    target_id = body.user_id
    if target_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="나에게는 친구 요청을 보낼 수 없어요.")
    target = db.get(User, target_id)
    if not target or target.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없어요.")
    lock_pair(db, user.id, target_id)
    if blocked_between(db, user.id, target_id):
        # Same answer whoever blocked whom, so nobody learns they were blocked.
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="이 사용자에게는 친구 요청을 보낼 수 없어요.")
    if are_friends(db, user.id, target_id):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="이미 친구예요.")

    existing = db.scalar(
        select(FriendRequest)
        .where(
            FriendRequest.status == "pending",
            or_(
                and_(FriendRequest.requester_id == user.id, FriendRequest.addressee_id == target_id),
                and_(FriendRequest.requester_id == target_id, FriendRequest.addressee_id == user.id),
            ),
        )
        .with_for_update()
    )
    if existing and existing.requester_id == user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="이미 친구 요청을 보냈어요.")
    if existing:  # they asked us first: accept theirs
        existing.status, existing.responded_at = "accepted", utcnow()
        _befriend(db, user.id, target_id)
        db.commit()
        notify(hub.friends_changed, [user.id, target_id])
        return FriendRequestResultOut(status="accepted", request_id=existing.id)

    req = FriendRequest(requester_id=user.id, addressee_id=target_id)
    db.add(req)
    try:
        db.commit()
    except IntegrityError:  # a concurrent request for the same pair won
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="이미 처리 중인 친구 요청이 있어요.") from None
    notify(hub.friends_changed, [target_id])  # their request badge updates right away
    return FriendRequestResultOut(status="pending", request_id=req.id)


def _pending_for(db: Session, request_id: uuid.UUID, *, addressee: uuid.UUID | None = None, requester: uuid.UUID | None = None) -> FriendRequest:
    found = db.get(FriendRequest, request_id)
    if found:
        lock_pair(db, found.requester_id, found.addressee_id)
        db.refresh(found)
    q = select(FriendRequest).where(FriendRequest.id == request_id, FriendRequest.status == "pending").with_for_update()
    if addressee:
        q = q.where(FriendRequest.addressee_id == addressee)
    if requester:
        q = q.where(FriendRequest.requester_id == requester)
    req = db.scalar(q)
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="친구 요청을 찾을 수 없어요.")
    return req


@router.post("/requests/{request_id}/accept", response_model=FriendRequestResultOut)
def accept(request_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> FriendRequestResultOut:
    req = _pending_for(db, request_id, addressee=user.id)  # only the recipient
    req.status, req.responded_at = "accepted", utcnow()
    _befriend(db, req.requester_id, req.addressee_id)
    db.commit()
    notify(hub.friends_changed, [req.requester_id, req.addressee_id])
    return FriendRequestResultOut(status="accepted", request_id=req.id)


@router.post("/requests/{request_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline(request_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    req = _pending_for(db, request_id, addressee=user.id)
    req.status, req.responded_at = "declined", utcnow()
    db.commit()
    notify(hub.friends_changed, [req.requester_id])


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel(request_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    req = _pending_for(db, request_id, requester=user.id)  # only the sender
    req.status, req.responded_at = "cancelled", utcnow()
    db.commit()
    notify(hub.friends_changed, [req.addressee_id])


@router.delete("/{friend_id}", status_code=status.HTTP_204_NO_CONTENT)
def unfriend(friend_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    x, y = pair(user.id, friend_id)
    deleted = db.execute(delete(Friendship).where(Friendship.user_a_id == x, Friendship.user_b_id == y)).rowcount
    db.commit()
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="친구가 아니에요.")
    # Whoever no longer has access (no invite either) steps out of the other's room.
    other = db.get(User, friend_id)
    for owner, visitor in ((user, other), (other, user)):
        room = db.scalar(select(Room).where(Room.owner_id == owner.id, Room.is_default)) if owner and visitor else None
        if room and room_access(db, room, visitor) is None:
            notify(hub.drop_from_rooms, visitor.id, owner.id)
    notify(hub.friends_changed, [user.id, friend_id])
