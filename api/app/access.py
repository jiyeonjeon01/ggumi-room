"""Relationship and room-access rules, shared by the routers."""

import uuid

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from .models import Friendship, Room, RoomGuest, User


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


def room_access(db: Session, room: Room, viewer: User) -> str | None:
    """'owner' | 'friend' | 'guest' (entered via invite) | None (no access)."""
    if room.owner_id == viewer.id:
        return "owner"
    if are_friends(db, room.owner_id, viewer.id):
        return "friend"
    guest = db.scalar(select(exists().where(RoomGuest.room_id == room.id, RoomGuest.user_id == viewer.id)))
    return "guest" if guest else None
