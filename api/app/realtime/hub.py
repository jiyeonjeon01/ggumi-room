"""Realtime connection registry: who is connected, who is in which room.

Everything here runs on the event loop of the single API process, so plain
dicts are enough. To run several API servers later, keep this interface and
swap the in-memory fan-out (`_send`, room membership) for a shared broker
(e.g. Redis pub/sub keyed by room and user); the WebSocket endpoint and the
routers only talk to the Hub methods below.

Policy for several tabs/devices of one user:
- every tab keeps its own connection (presence and, later, messages reach all
  of them);
- inside one room a user has a single character: joining the same room from
  another tab moves the older tab out of the room (it gets `room.replaced`
  and shows a "this room is open elsewhere" notice).
"""

import asyncio
import json
import math
import secrets
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import anyio
from fastapi import WebSocket

from ..layout import catalog
from .geometry import RoomGeometry

FACINGS = frozenset({"front-right", "front-left", "back-right", "back-left"})
STATES = frozenset({"idle", "walk"})

# Outgoing queue per connection; a client that can't keep up is dropped
# instead of slowing everyone else down.
SEND_QUEUE_MAX = 256


def now() -> float:
    return time.monotonic()


class Bucket:
    """Sliding-window counter: at most `limit` events per `window` seconds."""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self.times: deque[float] = deque()

    def allow(self) -> bool:
        t = now()
        while self.times and self.times[0] <= t - self.window:
            self.times.popleft()
        if len(self.times) >= self.limit:
            return False
        self.times.append(t)
        return True


@dataclass(eq=False)
class Conn:
    ws: WebSocket
    user_id: uuid.UUID
    nickname: str
    session_hash: str
    id: str = field(default_factory=lambda: secrets.token_urlsafe(6))
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(SEND_QUEUE_MAX))
    room: "RoomState | None" = None
    closed: bool = False
    close_code: int | None = None
    # Limits (per connection)
    msgs: Bucket = field(default_factory=lambda: Bucket(60, 1.0))
    moves: Bucket = field(default_factory=lambda: Bucket(15, 1.0))
    says_fast: Bucket = field(default_factory=lambda: Bucket(1, 0.5))
    says: Bucket = field(default_factory=lambda: Bucket(6, 10.0))
    joins: Bucket = field(default_factory=lambda: Bucket(10, 10.0))
    last_seen: float = field(default_factory=lambda: now())
    session_checked: float = field(default_factory=lambda: now())


@dataclass(eq=False)
class Member:
    conn: Conn
    x: float
    y: float
    f: str = "front-right"
    s: str = "idle"
    t: float = field(default_factory=lambda: now())
    # Next reported position is accepted without a speed check (after a layout change).
    relaxed: bool = False
    rejects: int = 0

    def public(self) -> dict[str, Any]:
        c = self.conn
        return {"id": c.id, "user_id": str(c.user_id), "nickname": c.nickname, "x": round(self.x, 3), "y": round(self.y, 3), "f": self.f, "s": self.s}


@dataclass(eq=False)
class RoomState:
    id: uuid.UUID
    owner_id: uuid.UUID
    geometry: RoomGeometry
    members: dict[str, Member] = field(default_factory=dict)


class Hub:
    def __init__(self) -> None:
        self.conns: dict[str, Conn] = {}
        self.rooms: dict[uuid.UUID, RoomState] = {}

    # ------------------------------------------------------------ connections

    def register(self, conn: Conn) -> None:
        self.conns[conn.id] = conn

    def user_conns(self, user_id: uuid.UUID) -> list[Conn]:
        return [c for c in self.conns.values() if c.user_id == user_id and not c.closed]

    async def unregister(self, conn: Conn) -> None:
        conn.closed = True
        self.conns.pop(conn.id, None)
        await self.leave_room(conn)

    def send(self, conn: Conn, msg: dict[str, Any]) -> None:
        """Queues a message; a full queue means the client stopped reading, so it is dropped."""
        if conn.closed:
            return
        try:
            conn.queue.put_nowait(json.dumps(msg, ensure_ascii=False, separators=(",", ":")))
        except asyncio.QueueFull:
            self.close(conn, 4408)

    def close(self, conn: Conn, code: int) -> None:
        """Asks the connection's writer to close the socket with `code`."""
        if conn.closed:
            return
        conn.closed = True
        conn.close_code = code
        try:
            conn.queue.put_nowait(None)
        except asyncio.QueueFull:
            # Writer is stuck on a slow client; drop what's queued so the close goes through.
            while not conn.queue.empty():
                conn.queue.get_nowait()
            conn.queue.put_nowait(None)

    def close_sessions(self, session_hashes: set[str], code: int = 4401) -> int:
        """Logout / expired session: every socket opened with those sessions is closed."""
        hit = [c for c in self.conns.values() if c.session_hash in session_hashes]
        for c in hit:
            self.close(c, code)
        return len(hit)

    # ------------------------------------------------------------ rooms

    def room_members(self, room_id: uuid.UUID) -> list[Member]:
        room = self.rooms.get(room_id)
        return list(room.members.values()) if room else []

    def broadcast(self, room: RoomState, msg: dict[str, Any], skip: Conn | None = None) -> None:
        for m in room.members.values():
            if m.conn is not skip:
                self.send(m.conn, msg)

    async def join_room(self, conn: Conn, room_id: uuid.UUID, owner_id: uuid.UUID, items: list[dict[str, Any]], x: Any, y: Any, f: Any) -> None:
        await self.leave_room(conn)
        room = self.rooms.get(room_id)
        if room is None:
            room = self.rooms[room_id] = RoomState(room_id, owner_id, RoomGeometry.from_items(items))
        # One character per user per room: the older tab steps out.
        for other in [m for m in room.members.values() if m.conn.user_id == conn.user_id]:
            self.send(other.conn, {"t": "room.replaced"})
            await self.leave_room(other.conn)
        r = catalog()["playerRadius"]
        spawn = catalog()["room"]["spawn"]
        px, py = (x, y) if _num(x) and _num(y) else (spawn["x"], spawn["y"])
        if not room.geometry.is_free(px, py, r * 0.9):
            px, py = room.geometry.nearest_free(px, py, r)
        member = Member(conn, float(px), float(py), f if f in FACINGS else "front-right")
        room.members[conn.id] = member
        conn.room = room
        self.send(conn, {"t": "room.state", "room": str(room_id), "you": member.public(), "members": [m.public() for m in room.members.values() if m is not member]})
        self.broadcast(room, {"t": "room.join", "member": member.public()}, skip=conn)

    async def leave_room(self, conn: Conn) -> None:
        room = conn.room
        if room is None:
            return
        conn.room = None
        if room.members.pop(conn.id, None) is not None:
            self.broadcast(room, {"t": "room.leave", "id": conn.id})
        if not room.members:
            self.rooms.pop(room.id, None)

    def move(self, conn: Conn, x: Any, y: Any, f: Any, s: Any) -> None:
        """Checks a reported position against speed, walls and furniture before passing it on."""
        room = conn.room
        member = room.members.get(conn.id) if room else None
        if room is None or member is None:
            return
        if not conn.moves.allow():
            return
        if not (_num(x) and _num(y)) or f not in FACINGS or s not in STATES:
            return
        x, y = float(x), float(y)
        t = now()
        r = catalog()["playerRadius"]
        speed = catalog()["walkSpeed"]
        g = room.geometry
        dt = max(0.0, min(t - member.t, 2.0))
        # Allowance: real speed plus 35% for timer jitter, and a fixed slack for
        # messages that arrive bunched together after a network hiccup.
        budget = speed * dt * 1.35 + 0.35
        dist = math.hypot(x - member.x, y - member.y)
        ok = g.is_free(x, y, r * 0.9) and (
            member.relaxed or (dist <= budget and g.segment_free(member.x, member.y, x, y, r * 0.6))
        )
        if not ok:
            member.rejects += 1
            self.send(conn, {"t": "move.fix", "x": round(member.x, 3), "y": round(member.y, 3)})
            return
        member.x, member.y, member.f, member.s, member.t, member.relaxed = x, y, f, s, t, False
        self.broadcast(room, {"t": "move", "id": conn.id, "x": round(x, 3), "y": round(y, 3), "f": f, "s": s}, skip=conn)

    def say(self, conn: Conn, text: Any) -> str | None:
        """Room speech bubble. Returns an error code, or None when sent."""
        room = conn.room
        if room is None or conn.id not in room.members:
            return "not_in_room"
        content = normalize_say(text)
        if not content:
            return "empty"
        if not conn.says_fast.allow() or not conn.says.allow():
            return "chat_rate"
        self.broadcast(room, {"t": "say", "id": conn.id, "text": content}, skip=conn)
        return None

    def layout_changed(self, room_id: uuid.UUID, version: int, items: list[dict[str, Any]]) -> None:
        """The owner saved a new layout: update collision and tell everyone in the room."""
        room = self.rooms.get(room_id)
        if room is None:
            return
        room.geometry = RoomGeometry.from_items(items)
        r = catalog()["playerRadius"]
        for m in room.members.values():
            m.relaxed = True  # clients re-place their character; accept the next position
            if not room.geometry.is_free(m.x, m.y, r * 0.9):
                m.x, m.y = room.geometry.nearest_free(m.x, m.y, r)
        self.broadcast(room, {"t": "room.layout", "version": version, "items": items})

    def theme_changed(self, room_id: uuid.UUID, theme: str) -> None:
        room = self.rooms.get(room_id)
        if room is not None:
            self.broadcast(room, {"t": "room.theme", "theme": theme})

    def drop_from_rooms(self, user_id: uuid.UUID, owner_id: uuid.UUID) -> None:
        """Access to `owner_id`'s rooms was lost (unfriended): step out of them."""
        for room in [r for r in self.rooms.values() if r.owner_id == owner_id]:
            for m in [m for m in room.members.values() if m.conn.user_id == user_id]:
                self.send(m.conn, {"t": "room.denied", "code": "no_access"})
                room.members.pop(m.conn.id, None)
                m.conn.room = None
                self.broadcast(room, {"t": "room.leave", "id": m.conn.id})
            if not room.members:
                self.rooms.pop(room.id, None)


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


MAX_SAY = 24  # MAX_CHAT_LENGTH in src/game/chat/chat.ts


def normalize_say(text: Any) -> str:
    """Same rules as the client (normalizeChat): one line, trimmed, at most 24 characters."""
    if not isinstance(text, str):
        return ""
    # Whitespace runs (newlines, tabs) become one space first, like the client's /\s+/g; then other
    # control characters are dropped.
    cleaned = "".join(ch for ch in " ".join(text.split()) if ch.isprintable())
    chars = list(cleaned)
    return "".join(chars[:MAX_SAY])


hub = Hub()


def notify(fn, *args) -> None:
    """Runs a Hub method from a sync route (worker thread) on the event loop."""
    try:
        anyio.from_thread.run_sync(fn, *args)
    except RuntimeError:
        fn(*args)  # not inside an anyio worker thread (e.g. direct calls in tests)
