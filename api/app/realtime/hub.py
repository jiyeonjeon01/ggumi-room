"""Realtime connection registry: who is connected, who is in which room.

Everything here runs on the event loop of the single API process, so plain
dicts are enough. To run several API servers later, keep this interface and
swap the in-memory fan-out (`_send`, room membership) for a shared broker
(e.g. Redis pub/sub keyed by room and user); the WebSocket endpoint and the
routers only talk to the Hub methods below.

Presence (friend list dots), per user over all of their connections:
- online:  connected, and some tab saw real input (keys, pointer, touch,
           scroll, coming back to the tab; moving or talking in a room) in
           the last 5 minutes. Heartbeat pings don't count.
- away:    connected, but no real input for 5 minutes or more.
- offline: no connection left. After logout at once; after a closed tab or a
           dropped network only once a short grace period passes without a
           reconnect (so a reload doesn't flicker).
Only friends hear about a user's status.

Policy for several tabs/devices of one user:
- every tab keeps its own connection (presence and, later, messages reach all
  of them);
- inside one room a user has a single character: joining the same room from
  another tab moves the older tab out of the room (it gets `room.replaced`
  and shows a "this room is open elsewhere" notice).

Party rooms (kind "party") also have:
- a capacity in people (distinct accounts), not connections; a second tab or
  device of someone inside takes over their character and never needs a seat;
- a seat hold: a dropped connection keeps its seat for SEAT_HOLD_S, so a
  reload or a short network loss gets back in even when the room fills up
  meanwhile (an explicit leave frees the seat at once);
- the capacity check and the seat taking run without yielding to the event
  loop, so concurrent joins can never overfill a room;
- "occupied" (someone inside or holding a seat) changes are reported through
  `on_occupancy`, which the party lifecycle stores (it closes rooms left empty).
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
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from ..layout import catalog, room_template
from .geometry import RoomGeometry

FACINGS = frozenset({"front-right", "front-left", "back-right", "back-left"})
STATES = frozenset({"idle", "walk"})

# Outgoing queue per connection; a client that can't keep up is dropped
# instead of slowing everyone else down.
SEND_QUEUE_MAX = 256

AWAY_AFTER_S = get_settings().presence_away_s
OFFLINE_GRACE_S = get_settings().presence_grace_s
# Often enough that "away" shows up within a few percent of the threshold.
SWEEP_EVERY_S = min(15.0, AWAY_AFTER_S / 5)
# Party rooms: people inside at once, and how long a dropped connection keeps its seat.
PARTY_CAPACITY = 10
SEAT_HOLD_S = 60.0


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
    # Last real user input reported by this tab (not heartbeats).
    active_at: float = field(default_factory=lambda: now())
    activities: Bucket = field(default_factory=lambda: Bucket(10, 60.0))
    typings: Bucket = field(default_factory=lambda: Bucket(20, 10.0))


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
    kind: str = "personal"
    template: str = "personal"
    # People inside at once (None: no limit, personal rooms).
    capacity: int | None = None
    # Seats kept for people whose connection dropped: user id -> timer that frees it.
    holds: dict[uuid.UUID, asyncio.TimerHandle] = field(default_factory=dict)
    # Last occupancy reported through Hub.on_occupancy.
    occupied: bool = False

    def people(self) -> set[uuid.UUID]:
        """Accounts inside or holding a seat (several tabs of one account count once)."""
        return {m.conn.user_id for m in self.members.values()} | set(self.holds)


class Hub:
    def __init__(self) -> None:
        self.conns: dict[str, Conn] = {}
        self.rooms: dict[uuid.UUID, RoomState] = {}
        # Last published status per user (absent = offline).
        self.presence: dict[uuid.UUID, str] = {}
        self._offline_timers: dict[uuid.UUID, asyncio.TimerHandle] = {}
        self._sweeper: asyncio.Task | None = None
        # Who is friends with whom (DB lookup, set by the WebSocket module).
        self.friend_ids = lambda user_id: []
        # Party lifecycle: called (in a worker thread) with (room id, occupied) after a party
        # room fills or empties. Set by the parties module.
        self.on_occupancy = None
        self._occupancy_locks: dict[uuid.UUID, asyncio.Lock] = {}
        # Rooms closed while this process runs; a join that passed the DB check just before
        # the close is still refused.
        self.closed_rooms: set[uuid.UUID] = set()

    def reset(self) -> None:
        """Tests only."""
        for h in self._offline_timers.values():
            h.cancel()
        for room in self.rooms.values():
            for h in room.holds.values():
                h.cancel()
        friend_ids, on_occupancy = self.friend_ids, self.on_occupancy
        self.__init__()
        self.friend_ids, self.on_occupancy = friend_ids, on_occupancy

    # ------------------------------------------------------------ connections

    def register(self, conn: Conn) -> None:
        self.conns[conn.id] = conn
        self._ensure_sweeper()
        timer = self._offline_timers.pop(conn.user_id, None)
        if timer:
            timer.cancel()

    def user_conns(self, user_id: uuid.UUID) -> list[Conn]:
        return [c for c in self.conns.values() if c.user_id == user_id and not c.closed]

    async def unregister(self, conn: Conn) -> None:
        conn.closed = True
        self.conns.pop(conn.id, None)
        # A dropped connection keeps its party seat for a while (a logout doesn't).
        self._leave(conn, hold=conn.close_code != 4401)
        if self.user_conns(conn.user_id):
            await self.refresh_presence(conn.user_id)
        elif conn.close_code == 4401:
            await self.refresh_presence(conn.user_id)  # logged out: offline now
        else:
            loop = asyncio.get_running_loop()
            uid = conn.user_id
            self._offline_timers[uid] = loop.call_later(OFFLINE_GRACE_S, lambda: loop.create_task(self._grace_over(uid)))

    async def _grace_over(self, user_id: uuid.UUID) -> None:
        self._offline_timers.pop(user_id, None)
        await self.refresh_presence(user_id)

    # ------------------------------------------------------------ presence

    def status_of(self, user_id: uuid.UUID) -> str:
        conns = self.user_conns(user_id)
        if not conns:
            # Still within the grace period after a drop: keep what friends last saw.
            return self.presence.get(user_id, "offline") if user_id in self._offline_timers else "offline"
        latest = max(c.active_at for c in conns)
        return "online" if now() - latest < AWAY_AFTER_S else "away"

    async def refresh_presence(self, user_id: uuid.UUID) -> None:
        """Recomputes a user's status and tells their connected friends if it changed."""
        status = self.status_of(user_id)
        if status == self.presence.get(user_id, "offline"):
            return
        if status == "offline":
            self.presence.pop(user_id, None)
        else:
            self.presence[user_id] = status
        friends = await run_in_threadpool(self.friend_ids, user_id)
        msg = {"t": "presence", "user_id": str(user_id), "status": status}
        for fid in friends:
            for c in self.user_conns(fid):
                self.send(c, msg)

    def presence_list(self, friend_ids: list[uuid.UUID]) -> dict[str, str]:
        return {str(f): self.status_of(f) for f in friend_ids}

    async def activity(self, conn: Conn, idle_ms: Any = None) -> None:
        """Real input in that tab (idle_ms: how long ago, when reported on connect)."""
        if not conn.activities.allow():
            return
        ago = min(max(float(idle_ms), 0.0), AWAY_AFTER_S * 2 * 1000) / 1000 if _num(idle_ms) else 0.0
        conn.active_at = max(conn.active_at if idle_ms is None else 0.0, now() - ago)
        await self.refresh_presence(conn.user_id)

    def touch(self, conn: Conn) -> None:
        """Moving or talking in a room is real input too (status refresh happens in the sweep or the next activity)."""
        conn.active_at = now()
        if self.presence.get(conn.user_id) == "away":
            asyncio.get_running_loop().create_task(self.refresh_presence(conn.user_id))

    async def sweep(self) -> None:
        """Turns users who went quiet into "away" (time passes without any event)."""
        for uid in {c.user_id for c in self.conns.values()}:
            await self.refresh_presence(uid)

    def _ensure_sweeper(self) -> None:
        loop = asyncio.get_running_loop()
        if self._sweeper and not self._sweeper.done() and self._sweeper.get_loop() is loop:
            return

        async def run() -> None:
            while True:
                await asyncio.sleep(SWEEP_EVERY_S)
                try:
                    await self.sweep()
                except Exception:
                    pass

        self._sweeper = loop.create_task(run())

    async def friends_changed(self, user_ids: list[uuid.UUID]) -> None:
        """A friendship or request changed: those users refresh their lists and learn each other's status."""
        for uid in user_ids:
            friends = await run_in_threadpool(self.friend_ids, uid)
            for c in self.user_conns(uid):
                self.send(c, {"t": "friends.changed", "presence": self.presence_list(friends)})

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

    async def join_room(
        self,
        conn: Conn,
        room_id: uuid.UUID,
        owner_id: uuid.UUID,
        items: list[dict[str, Any]],
        x: Any,
        y: Any,
        f: Any,
        kind: str = "personal",
        template: str = "personal",
    ) -> bool:
        """Puts the connection's character in the room. False when refused (party full or closed).

        Nothing in here awaits: the capacity check and taking the seat happen in one step of
        the event loop, so concurrent joins can't both take the last seat.
        """
        self._leave(conn, hold=False)
        if room_id in self.closed_rooms:
            self.send(conn, {"t": "room.denied", "code": "closed"})
            return False
        room = self.rooms.get(room_id)
        if room is None:
            room = RoomState(
                room_id,
                owner_id,
                RoomGeometry.from_items(items, template),
                kind=kind,
                template=template,
                capacity=PARTY_CAPACITY if kind == "party" else None,
            )
        people = room.people()
        if room.capacity is not None and conn.user_id not in people and len(people) >= room.capacity:
            self.send(conn, {"t": "room.denied", "code": "full", "count": len(people), "capacity": room.capacity})
            return False
        self.rooms[room_id] = room
        hold = room.holds.pop(conn.user_id, None)
        if hold:
            hold.cancel()
        # One character per user per room: the older tab steps out.
        for other in [m for m in room.members.values() if m.conn.user_id == conn.user_id]:
            self.send(other.conn, {"t": "room.replaced"})
            self._remove(room, other.conn)
        r = catalog()["playerRadius"]
        spawn = room_template(template)["spawn"]
        px, py = (x, y) if _num(x) and _num(y) else (spawn["x"], spawn["y"])
        if not room.geometry.is_free(px, py, r * 0.9):
            px, py = room.geometry.nearest_free(px, py, r)
        member = Member(conn, float(px), float(py), f if f in FACINGS else "front-right")
        room.members[conn.id] = member
        conn.room = room
        state = {"t": "room.state", "room": str(room_id), "you": member.public(), "members": [m.public() for m in room.members.values() if m is not member]}
        if room.capacity is not None:
            state |= {"count": len(room.people()), "capacity": room.capacity}
        self.send(conn, state)
        self.broadcast(room, {"t": "room.join", "member": member.public()}, skip=conn)
        self._people_changed(room)
        return True

    async def leave_room(self, conn: Conn) -> None:
        """Stepping out on purpose (another room, leaving the page): the seat is freed at once."""
        self._leave(conn, hold=False)

    def _leave(self, conn: Conn, hold: bool) -> None:
        room = conn.room
        if room is None:
            return
        self._remove(room, conn)
        if hold and room.capacity is not None and conn.user_id not in room.people():
            loop = asyncio.get_running_loop()
            room.holds[conn.user_id] = loop.call_later(SEAT_HOLD_S, self._hold_over, room, conn.user_id)
        self._people_changed(room)

    def _remove(self, room: RoomState, conn: Conn) -> None:
        conn.room = None
        if room.members.pop(conn.id, None) is not None:
            self.broadcast(room, {"t": "room.leave", "id": conn.id})

    def _hold_over(self, room: RoomState, user_id: uuid.UUID) -> None:
        if room.holds.pop(user_id, None) is not None:
            self._people_changed(room)

    def _people_changed(self, room: RoomState) -> None:
        """After someone came or went: drop an empty room, share the head count, report occupancy."""
        if not room.members and not room.holds and self.rooms.get(room.id) is room:
            self.rooms.pop(room.id, None)
        if room.capacity is None:
            return
        self.broadcast(room, {"t": "room.count", "count": len(room.people()), "capacity": room.capacity})
        occupied = bool(room.members or room.holds)
        if occupied != room.occupied:
            room.occupied = occupied
            self._report_occupancy(room.id)

    def _report_occupancy(self, room_id: uuid.UUID) -> None:
        if self.on_occupancy is None:
            return
        lock = self._occupancy_locks.setdefault(room_id, asyncio.Lock())

        async def write() -> None:
            # One write at a time per room, each storing the state as it is when the write runs,
            # so the last stored value is the current one whatever order events came in.
            async with lock:
                try:
                    await run_in_threadpool(self.on_occupancy, room_id, self.party_occupied(room_id))
                except Exception:
                    pass  # the lifecycle sweep re-asserts occupancy every minute

        asyncio.get_running_loop().create_task(write())

    def party_occupied(self, room_id: uuid.UUID) -> bool:
        room = self.rooms.get(room_id)
        return bool(room and (room.members or room.holds))

    def party_count(self, room_id: uuid.UUID) -> int:
        room = self.rooms.get(room_id)
        return len(room.people()) if room else 0

    def in_party(self, room_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        room = self.rooms.get(room_id)
        return bool(room and user_id in room.people())

    def occupied_parties(self) -> list[uuid.UUID]:
        return [r.id for r in self.rooms.values() if r.kind != "personal" and (r.members or r.holds)]

    def close_room(self, room_id: uuid.UUID) -> None:
        """The party ended (host closed it, or it stayed empty): everyone inside is told and steps out."""
        self.closed_rooms.add(room_id)
        room = self.rooms.pop(room_id, None)
        if room is None:
            return
        for h in room.holds.values():
            h.cancel()
        room.holds.clear()
        for m in list(room.members.values()):
            self.send(m.conn, {"t": "room.closed"})
            m.conn.room = None
        room.members.clear()
        room.occupied = False

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
        self.touch(conn)
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
        self.touch(conn)
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

    # ------------------------------------------------------------ 1:1 messages

    def to_users(self, user_ids: list[uuid.UUID], msg: dict[str, Any]) -> None:
        for uid in dict.fromkeys(user_ids):
            for c in self.user_conns(uid):
                self.send(c, msg)

    def dm_new(self, user_ids: list[uuid.UUID], message: dict[str, Any]) -> None:
        """A stored message: to the recipient's tabs and the sender's other tabs (all of them; the sender's own tab dedupes)."""
        self.to_users(user_ids, {"t": "dm.new", "message": message})

    def dm_read(self, reader: uuid.UUID, peer: uuid.UUID, seq: int) -> None:
        """`reader` has seen `peer`'s messages up to `seq` (dark checks for the peer, cleared badges on the reader's other tabs)."""
        self.to_users([reader, peer], {"t": "dm.read", "reader": str(reader), "peer": str(peer), "seq": seq})

    async def dm_typing(self, conn: Conn, to: Any, on: Any) -> None:
        """Typing indicator, relayed to a friend only. Nothing is stored; no text is carried."""
        if not conn.typings.allow():
            return
        try:
            target = uuid.UUID(str(to))
        except ValueError:
            return
        if target not in await run_in_threadpool(self.friend_ids, conn.user_id):
            return
        self.to_users([target], {"t": "dm.typing", "from": str(conn.user_id), "on": on is True})

    def theme_changed(self, room_id: uuid.UUID, theme: str) -> None:
        room = self.rooms.get(room_id)
        if room is not None:
            self.broadcast(room, {"t": "room.theme", "theme": theme})

    def drop_from_rooms(self, user_id: uuid.UUID, owner_id: uuid.UUID) -> None:
        """Access to `owner_id`'s personal room was lost (unfriended): step out of it.

        Parties they host aren't affected: those go by the party's member list, not friendship.
        """
        for room in [r for r in self.rooms.values() if r.owner_id == owner_id and r.kind == "personal"]:
            for m in [m for m in room.members.values() if m.conn.user_id == user_id]:
                self.send(m.conn, {"t": "room.denied", "code": "no_access"})
                self._remove(room, m.conn)
            self._people_changed(room)


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
        if asyncio.iscoroutinefunction(fn):
            anyio.from_thread.run(fn, *args)
        else:
            anyio.from_thread.run_sync(fn, *args)
    except RuntimeError:
        if not asyncio.iscoroutinefunction(fn):
            fn(*args)  # not inside an anyio worker thread (e.g. direct calls in tests)
