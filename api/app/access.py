"""Relationship and room-access rules, shared by the routers."""

import uuid

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from .models import FriendRequest, Friendship, Room, RoomGuest, RoomMember, User


def pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """Friendship rows store each pair once, smaller id first."""
    return (a, b) if a < b else (b, a)


def lock_pair(db: Session, a: uuid.UUID, b: uuid.UUID) -> None:
    """Serializes friend actions for one pair of users until the transaction ends.

    Without it, two near-simultaneous requests could each see "not friends,
    nothing pending" and leave a friendship plus a stale pending request.
    """
    x, y = pair(a, b)
    db.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(f"friend:{x}:{y}", 0))))


def are_friends(db: Session, a: uuid.UUID, b: uuid.UUID) -> bool:
    x, y = pair(a, b)
    return db.scalar(select(exists().where(Friendship.user_a_id == x, Friendship.user_b_id == y))) or False


def relation(db: Session, me: uuid.UUID, other: uuid.UUID) -> str:
    """'self' | 'friend' | 'outgoing' (I asked) | 'incoming' (they asked) | 'none'."""
    if me == other:
        return "self"
    if are_friends(db, me, other):
        return "friend"
    asked_by = db.scalar(
        select(FriendRequest.requester_id).where(
            FriendRequest.status == "pending",
            ((FriendRequest.requester_id == me) & (FriendRequest.addressee_id == other))
            | ((FriendRequest.requester_id == other) & (FriendRequest.addressee_id == me)),
        )
    )
    if asked_by is None:
        return "none"
    return "outgoing" if asked_by == me else "incoming"


def room_access(db: Session, room: Room, viewer: User) -> str | None:
    """'owner' | 'friend' | 'guest' (entered via invite) | 'member' (joined a party by link) | None.

    Personal rooms follow friendships and invites; shared rooms (parties) only their own
    member list, so being someone's friend never opens their party and a party link never
    opens their personal room. A closed party lets nobody in.
    """
    if room.kind != "personal":
        if room.closed_at is not None:
            return None
        if room.owner_id == viewer.id:
            return "owner"
        member = db.scalar(select(exists().where(RoomMember.room_id == room.id, RoomMember.user_id == viewer.id)))
        return "member" if member else None
    if room.owner_id == viewer.id:
        return "owner"
    if are_friends(db, room.owner_id, viewer.id):
        return "friend"
    guest = db.scalar(select(exists().where(RoomGuest.room_id == room.id, RoomGuest.user_id == viewer.id)))
    return "guest" if guest else None
