"""WebSocket endpoint: /ws/live (one connection per browser tab).

Handshake: the Origin must be our own site (else the upgrade is refused) and
the HttpOnly session cookie must belong to a live session (else the socket is
accepted and closed with 4401 so the client stops retrying). Identity comes
from the session only; nothing the client sends can claim another user.

Frames are JSON text, at most 4 KB, with a type in `t`. See docs/REALTIME.md
for the event list. Close codes: 4400 bad frames, 4401 not logged in / logged
out / session expired, 4408 heartbeat timeout or too slow to read, 4429 too
many connections or messages, 1009 frame too big.
"""

import asyncio
import contextlib
import json
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from .. import ratelimit
from ..access import room_access
from ..config import get_settings
from ..db import SessionLocal, utcnow
from ..deps import SESSION_COOKIE
from ..models import Room, User, UserSession
from ..routers.rooms import _items
from ..security import token_hash
from .hub import Conn, hub, now

MAX_FRAME = 4096
# Clients ping every 20 s; silence for this long means the connection is gone.
IDLE_TIMEOUT = 60.0
SESSION_RECHECK_S = 60.0
MAX_CONNS_PER_USER = 8
MAX_BAD_FRAMES = 5
MAX_DROPPED = 200

router = APIRouter()


def _session_user(token: str) -> tuple[uuid.UUID, str, str] | None:
    th = token_hash(token)
    with SessionLocal() as db:
        row = db.execute(
            select(UserSession.expires_at, User.id, User.nickname, User.status).join(User, User.id == UserSession.user_id).where(UserSession.token_hash == th)
        ).first()
    if not row or row.expires_at <= utcnow() or row.status != "active":
        return None
    return row.id, row.nickname, th


def _session_alive(th: str) -> bool:
    with SessionLocal() as db:
        expires = db.scalar(select(UserSession.expires_at).where(UserSession.token_hash == th))
    return expires is not None and expires > utcnow()


def _room_for(user_id: uuid.UUID, room_id: uuid.UUID) -> tuple[uuid.UUID, list[dict[str, Any]]] | None:
    """(owner id, layout) when the user may be in the room, else None."""
    with SessionLocal() as db:
        room, user = db.get(Room, room_id), db.get(User, user_id)
        if not room or not user or room_access(db, room, user) is None:
            return None
        return room.owner_id, [i.model_dump() for i in _items(db, room)]


def _client_ip(ws: WebSocket) -> str:
    return ws.headers.get("x-real-ip") or (ws.client.host if ws.client else "unknown")


@router.websocket("/ws/live")
async def live(ws: WebSocket) -> None:
    origin = (ws.headers.get("origin") or "").rstrip("/")
    if origin not in get_settings().allowed_origins:
        await ws.close(code=4403)  # before accept: the upgrade is refused (HTTP 403)
        return
    if not ratelimit.allow(f"ws-open:{_client_ip(ws)}", 30, 60):
        await ws.close(code=4429)
        return
    token = ws.cookies.get(SESSION_COOKIE)
    found = await run_in_threadpool(_session_user, token) if token else None
    await ws.accept()
    if found is None:
        await ws.close(code=4401)
        return
    user_id, nickname, th = found
    if len(hub.user_conns(user_id)) >= MAX_CONNS_PER_USER:
        await ws.close(code=4429)
        return

    conn = Conn(ws, user_id, nickname, th)
    hub.register(conn)
    hub.send(conn, {"t": "welcome", "id": conn.id, "user_id": str(user_id), "nickname": nickname})
    writer = asyncio.create_task(_writer(conn))
    try:
        await _reader(conn)
    finally:
        hub.close(conn, 1000)
        await hub.unregister(conn)
        with contextlib.suppress(Exception):
            await asyncio.wait_for(writer, timeout=2)
        if not writer.done():
            writer.cancel()


async def _writer(conn: Conn) -> None:
    """Sends queued frames in order; a None in the queue closes the socket."""
    try:
        while (item := await conn.queue.get()) is not None:
            await conn.ws.send_text(item)
    except Exception:
        pass
    finally:
        with contextlib.suppress(Exception):
            await conn.ws.close(code=conn.close_code or 1000)


async def _reader(conn: Conn) -> None:
    bad = dropped = 0
    while not conn.closed:
        try:
            frame = await asyncio.wait_for(conn.ws.receive(), timeout=IDLE_TIMEOUT)
        except TimeoutError:
            hub.close(conn, 4408)
            return
        except Exception:
            return
        if frame["type"] == "websocket.disconnect":
            return
        text = frame.get("text")
        if text is None:
            hub.close(conn, 4400)  # binary frames aren't part of the protocol
            return
        if len(text) > MAX_FRAME:
            hub.close(conn, 1009)
            return
        conn.last_seen = now()
        if not conn.msgs.allow():
            dropped += 1
            if dropped > MAX_DROPPED:
                hub.close(conn, 4429)
                return
            continue
        try:
            msg = json.loads(text)
            if not isinstance(msg, dict) or not isinstance(msg.get("t"), str):
                raise ValueError
        except ValueError:
            bad += 1
            if bad >= MAX_BAD_FRAMES:
                hub.close(conn, 4400)
                return
            continue
        await _handle(conn, msg)


async def _handle(conn: Conn, msg: dict[str, Any]) -> None:
    t = msg["t"]
    if t == "ping":
        hub.send(conn, {"t": "pong"})
        if now() - conn.session_checked >= SESSION_RECHECK_S:
            conn.session_checked = now()
            if not await run_in_threadpool(_session_alive, conn.session_hash):
                hub.close(conn, 4401)
    elif t == "join":
        if not conn.joins.allow():
            hub.send(conn, {"t": "error", "code": "rate"})
            return
        try:
            room_id = uuid.UUID(str(msg.get("room")))
        except ValueError:
            hub.send(conn, {"t": "room.denied", "code": "no_access"})
            return
        found = await run_in_threadpool(_room_for, conn.user_id, room_id)
        if conn.closed:
            return
        if found is None:
            hub.send(conn, {"t": "room.denied", "code": "no_access"})
            return
        owner_id, items = found
        await hub.join_room(conn, room_id, owner_id, items, msg.get("x"), msg.get("y"), msg.get("f"))
    elif t == "leave":
        await hub.leave_room(conn)
    elif t == "move":
        hub.move(conn, msg.get("x"), msg.get("y"), msg.get("f"), msg.get("s"))
    elif t == "say":
        if (err := hub.say(conn, msg.get("text"))) and err != "empty":
            hub.send(conn, {"t": "error", "code": err})
    # Unknown types are ignored (newer clients against an older server).
