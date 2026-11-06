"""Party room lifecycle: when a temporary party closes, kept in the database.

A party closes EMPTY_CLOSE (30 min) after the last person left (or after it was
created, if nobody came in). The hub knows who is inside; the database keeps:

- closes_at:      NULL while someone is inside (or holding a seat), else when it closes;
- last_active_at: refreshed every minute while occupied, so after a crash or a
                  restart we still know roughly when the room was last used;
- closed_at:      set once it closed (by the host, or by the sweep below).

Fairness rules, so a restart or a short outage never ends a party early:
- On startup every open party gets at least RESTART_GRACE (a couple of minutes)
  for people to reconnect; a party that was occupied when the server stopped
  (closes_at NULL) gets the full 30 minutes counted from its last heartbeat.
- A room is only closed when it's past closes_at AND the hub has nobody in it;
  if the database is unreachable nothing closes (the sweep just retries).
- A lost "emptied" write leaves closes_at NULL; the sweep treats such a room
  like one recovered after a restart.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, func, select, true, update
from starlette.concurrency import run_in_threadpool

from ..db import SessionLocal, utcnow
from ..models import Room
from .hub import hub

log = logging.getLogger(__name__)

EMPTY_CLOSE = timedelta(minutes=30)
RESTART_GRACE = timedelta(minutes=2)
PURGE_AFTER = timedelta(days=7)
SWEEP_EVERY_S = 60.0

_open_party = and_(Room.kind == "party", Room.closed_at.is_(None))


def store_occupancy(room_id: uuid.UUID, occupied: bool) -> None:
    """Hub callback (worker thread): someone is in the room now, or the last person left."""
    now = utcnow()
    values = {"closes_at": None, "last_active_at": now} if occupied else {"closes_at": now + EMPTY_CLOSE, "last_active_at": now}
    with SessionLocal() as db:
        db.execute(update(Room).where(Room.id == room_id, _open_party).values(**values))
        db.commit()


def recover(now: datetime | None = None) -> int:
    """At startup: nobody is connected yet, so give every open party time to be found again."""
    now = now or utcnow()
    floor = now + RESTART_GRACE
    with SessionLocal() as db:
        n = db.execute(
            update(Room)
            .where(_open_party)
            .values(
                closes_at=func.greatest(
                    func.coalesce(Room.closes_at, func.coalesce(Room.last_active_at, Room.created_at) + EMPTY_CLOSE),
                    floor,
                )
            )
        ).rowcount
        db.commit()
    return n


def _sweep_db(occupied: list[uuid.UUID], now: datetime) -> list[uuid.UUID]:
    """Heartbeat the occupied rooms; return the open parties past their closing time."""
    with SessionLocal() as db:
        if occupied:
            db.execute(update(Room).where(Room.id.in_(occupied), _open_party).values(closes_at=None, last_active_at=now))
        # Empty in the hub but marked occupied: the "emptied" write was lost (or we restarted).
        db.execute(
            update(Room)
            .where(_open_party, Room.closes_at.is_(None), Room.id.not_in(occupied) if occupied else true())
            .values(closes_at=func.greatest(func.coalesce(Room.last_active_at, Room.created_at) + EMPTY_CLOSE, now + RESTART_GRACE))
        )
        db.execute(delete(Room).where(Room.kind == "party", Room.closed_at < now - PURGE_AFTER))
        db.commit()
        return list(db.scalars(select(Room.id).where(_open_party, Room.closes_at <= now)))


def _close(room_ids: list[uuid.UUID], now: datetime) -> list[uuid.UUID]:
    with SessionLocal() as db:
        closed = list(
            db.scalars(
                update(Room)
                .where(Room.id.in_(room_ids), _open_party, Room.closes_at <= now)
                .values(closed_at=now)
                .returning(Room.id)
            )
        )
        db.commit()
    return closed


async def sweep(now: datetime | None = None) -> list[uuid.UUID]:
    """One pass: heartbeat, then close the parties that stayed empty long enough. Returns the closed ids."""
    now = now or utcnow()
    due = await run_in_threadpool(_sweep_db, hub.occupied_parties(), now)
    # Someone may have come in while we asked the database: only close rooms still empty.
    due = [rid for rid in due if not hub.party_occupied(rid)]
    if not due:
        return []
    # Refuse joins from now on, before the write, so nobody slips in meanwhile.
    hub.closed_rooms.update(due)
    closed = await run_in_threadpool(_close, due, now)
    for rid in set(due) - set(closed):
        hub.closed_rooms.discard(rid)
    for rid in closed:
        hub.close_room(rid)
    return closed


async def run() -> None:
    """Background task for the app's lifetime."""
    try:
        await run_in_threadpool(recover)
    except Exception:
        log.exception("party recovery failed")  # the sweep's NULL rule covers it
    while True:
        await asyncio.sleep(SWEEP_EVERY_S)
        try:
            await sweep()
        except Exception:
            log.exception("party sweep failed")


hub.on_occupancy = store_occupancy
