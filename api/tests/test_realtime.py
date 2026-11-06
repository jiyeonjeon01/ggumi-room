"""Realtime room sync over /ws/live: auth, access, movement checks, chat, isolation, policies."""

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.realtime import hub as hub_mod
from app.realtime import ws as ws_mod
from app.realtime.hub import hub

ORIGIN = "http://testserver"


@pytest.fixture
def tc():
    hub.conns.clear()
    hub.rooms.clear()
    # One client (one event loop) for every user, so sockets and HTTP calls share the Hub.
    with TestClient(app) as c:
        yield c
    hub.conns.clear()
    hub.rooms.clear()


class User:
    """A signed-up user whose cookies are sent by hand (the shared client keeps none)."""

    def __init__(self, tc, nickname, login_id):
        self.tc = tc
        tc.cookies.clear()
        self.csrf = tc.get("/api/auth/csrf").json()["csrf_token"]
        r = tc.post(
            "/api/auth/signup",
            headers={"x-csrf-token": self.csrf, "cookie": f"ggumi_csrf={self.csrf}"},
            json={"nickname": nickname, "login_id": login_id, "password": "cozy-room-2026", "password_confirm": "cozy-room-2026"},
        )
        assert r.status_code == 201, r.text
        self.session = r.cookies["ggumi_session"]
        tc.cookies.clear()
        self.me = r.json()
        self.id = self.me["id"]
        self.room = self.me["room_id"]

    @property
    def cookie(self):
        return f"ggumi_session={self.session}; ggumi_csrf={self.csrf}"

    def req(self, method, url, **kw):
        kw.setdefault("headers", {}).update({"cookie": self.cookie, "x-csrf-token": self.csrf})
        r = self.tc.request(method, url, **kw)
        self.tc.cookies.clear()
        return r

    def ws(self, origin=ORIGIN):
        return self.tc.websocket_connect("/ws/live", headers={"origin": origin, "cookie": self.cookie})


def befriend(a, b):
    req = a.req("POST", "/api/friends/requests", json={"user_id": b.id}).json()["request_id"]
    assert b.req("POST", f"/api/friends/requests/{req}/accept").status_code == 200


def recv(ws, t):
    """Next message of type `t` (pongs and other types in between are skipped)."""
    for _ in range(50):
        m = ws.receive_json()
        if m["t"] == t:
            return m
    raise AssertionError(f"no {t}")


def quiet(ws):
    """Nothing else is queued for this socket: a ping's pong comes back next."""
    ws.send_json({"t": "ping"})
    m = ws.receive_json()
    assert m["t"] == "pong", m


def join(ws, room, **pos):
    ws.send_json({"t": "join", "room": room, **pos})
    return recv(ws, "room.state")


# ---------------------------------------------------------------- handshake & identity


def test_wrong_origin_is_refused(tc):
    a = User(tc, "꾸미", "ggumi01")
    with pytest.raises(WebSocketDisconnect) as e, a.ws(origin="https://evil.example") as ws:
        ws.receive_json()
    assert e.value.code == 4403


def test_no_session_closes_with_4401(tc):
    with pytest.raises(WebSocketDisconnect) as e, tc.websocket_connect("/ws/live", headers={"origin": ORIGIN}) as ws:
        ws.receive_json()
    assert e.value.code == 4401
    with pytest.raises(WebSocketDisconnect) as e, tc.websocket_connect("/ws/live", headers={"origin": ORIGIN, "cookie": "ggumi_session=forged"}) as ws:
        ws.receive_json()
    assert e.value.code == 4401


def test_identity_comes_from_the_session(tc):
    a = User(tc, "꾸미", "ggumi01")
    b = User(tc, "토리", "tori01")
    befriend(a, b)
    with a.ws() as wa, b.ws() as wb:
        assert recv(wa, "welcome")["user_id"] == a.id
        join(wa, a.room)
        # B tries to claim A's identity: ignored, the server stamps B's own.
        wb.send_json({"t": "join", "room": a.room, "user_id": a.id, "nickname": "꾸미"})
        st = recv(wb, "room.state")
        assert st["you"]["user_id"] == b.id and st["you"]["nickname"] == "토리"
        joined = recv(wa, "room.join")["member"]
        assert joined["user_id"] == b.id and joined["nickname"] == "토리"


# ---------------------------------------------------------------- access


def test_friend_and_invited_guest_can_join_strangers_cannot(tc):
    a, f, g, s = User(tc, "꾸미", "ggumi01"), User(tc, "친구", "friend01"), User(tc, "손님", "guest01"), User(tc, "남남", "stranger1")
    befriend(a, f)
    token = a.req("POST", "/api/rooms/me/invite").json()["url"].rsplit("/", 1)[1]
    assert g.req("POST", f"/api/invites/{token}/accept").status_code == 200
    with a.ws() as wa, f.ws() as wf, g.ws() as wg, s.ws() as ws_:
        join(wa, a.room)
        assert join(wf, a.room)["room"] == a.room
        assert join(wg, a.room)["room"] == a.room
        ws_.send_json({"t": "join", "room": a.room})
        assert recv(ws_, "room.denied")["code"] == "no_access"
        ws_.send_json({"t": "join", "room": "not-a-uuid"})
        assert recv(ws_, "room.denied")["code"] == "no_access"
        room = next(iter(hub.rooms.values()))
        assert {m.conn.nickname for m in room.members.values()} == {"꾸미", "친구", "손님"}


def test_join_and_leave_are_announced(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with a.ws() as wa:
        join(wa, a.room)
        with b.ws() as wb:
            st = join(wb, a.room)
            assert [m["nickname"] for m in st["members"]] == ["꾸미"]
            bid = recv(wa, "room.join")["member"]["id"]
        assert recv(wa, "room.leave")["id"] == bid  # socket closed -> leave
        wb_left = len(hub.rooms[next(iter(hub.rooms))].members)
        assert wb_left == 1


# ---------------------------------------------------------------- movement


def test_moves_are_checked_before_they_are_shared(tc, monkeypatch):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    clock = [1000.0]
    monkeypatch.setattr(hub_mod, "now", lambda: clock[0])
    with a.ws() as wa, b.ws() as wb:
        join(wa, a.room)
        me = join(wb, a.room, x=7, y=5.5)["you"]
        recv(wa, "room.join")
        assert (me["x"], me["y"]) == (7, 5.5)

        # 0.1 s later, 0.2 tiles: fine (2.6 tiles/s allows ~0.7 with slack)
        clock[0] += 0.1
        wb.send_json({"t": "move", "x": 7.2, "y": 5.5, "f": "front-right", "s": "walk"})
        m = recv(wa, "move")
        assert (m["x"], m["y"], m["f"], m["s"]) == (7.2, 5.5, "front-right", "walk")

        # Teleport across the room: refused, sender is put back, A hears nothing.
        clock[0] += 0.1
        wb.send_json({"t": "move", "x": 1.0, "y": 6.0, "f": "front-left", "s": "walk"})
        fix = recv(wb, "move.fix")
        assert (fix["x"], fix["y"]) == (7.2, 5.5)
        quiet(wa)

        # Into furniture (the bed covers x 0..3, y 0.75..2.75), out of the room, junk values.
        for x, y in ((1.5, 1.5), (9.5, 5.5), (-1, 3), (float("nan"), 3)):
            clock[0] += 5  # plenty of time: only walls/furniture decide
            wb.send_text(json.dumps({"t": "move", "x": x, "y": y, "f": "front-left", "s": "walk"}).replace("NaN", "1e999"))
        for _ in range(3):
            recv(wb, "move.fix")
        quiet(wa)
        # Bad facing / state values are dropped silently.
        wb.send_json({"t": "move", "x": 7.3, "y": 5.5, "f": "up", "s": "walk"})
        quiet(wa)

        # Slow walk over many steps works, ends idle.
        for i in range(1, 6):
            clock[0] += 0.1
            wb.send_json({"t": "move", "x": 7.2 - 0.2 * i, "y": 5.5, "f": "front-left", "s": "walk" if i < 5 else "idle"})
        last = None
        for _ in range(5):
            last = recv(wa, "move")
        assert last["s"] == "idle" and abs(last["x"] - 6.2) < 1e-9


def test_move_through_furniture_is_refused(tc, monkeypatch):
    a = User(tc, "꾸미", "ggumi01")
    clock = [1000.0]
    monkeypatch.setattr(hub_mod, "now", lambda: clock[0])
    with a.ws() as wa:
        assert join(wa, a.room, x=1.5, y=3.3)["you"]["y"] == 3.3  # just in front of the bed
        clock[0] += 2
        # Straight up through the bed to its far side: both ends free, the path is not.
        wa.send_json({"t": "move", "x": 1.5, "y": 0.4, "f": "back-left", "s": "walk"})
        assert recv(wa, "move.fix")["y"] == 3.3


def test_spawn_is_moved_off_furniture(tc):
    a = User(tc, "꾸미", "ggumi01")
    with a.ws() as wa:
        you = join(wa, a.room, x=1.5, y=1.5)["you"]  # on the bed
        from app.realtime.geometry import RoomGeometry
        from app.layout import default_layout

        assert RoomGeometry.from_items(default_layout()).is_free(you["x"], you["y"], 0.22)


# ---------------------------------------------------------------- speech bubbles


def test_say_is_cleaned_limited_and_shared(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with a.ws() as wa, b.ws() as wb:
        join(wa, a.room)
        join(wb, a.room)
        recv(wa, "room.join")
        wb.send_json({"t": "say", "text": "  안녕\n\t<b>반가워</b>\u0000" + "가" * 40})
        m = recv(wa, "say")
        assert m["text"] == ("안녕 <b>반가워</b>" + "가" * 40)[:24] and len(m["text"]) == 24
        quiet(wb)  # the sender shows its own bubble locally; nothing echoes back
        # Too fast: second message within 0.5 s is refused with a reason
        wb.send_json({"t": "say", "text": "하나 더"})
        assert recv(wb, "error")["code"] == "chat_rate"
        quiet(wa)
        wb.send_json({"t": "say", "text": "   "})  # empty after trimming: ignored
        quiet(wa)


def test_say_outside_a_room_is_refused(tc):
    a = User(tc, "꾸미", "ggumi01")
    with a.ws() as wa:
        wa.send_json({"t": "say", "text": "hi"})
        assert recv(wa, "error")["code"] == "not_in_room"


def test_rooms_are_isolated(tc, monkeypatch):
    a, b, c, d = User(tc, "가가", "user_aa"), User(tc, "나나", "user_bb"), User(tc, "다다", "user_cc"), User(tc, "라라", "user_dd")
    befriend(a, b)
    befriend(c, d)
    clock = [1000.0]
    monkeypatch.setattr(hub_mod, "now", lambda: clock[0])
    with a.ws() as wa, b.ws() as wb, c.ws() as wc, d.ws() as wd:
        join(wa, a.room)
        join(wb, a.room)
        join(wc, c.room)
        join(wd, c.room)
        recv(wa, "room.join")
        recv(wc, "room.join")
        clock[0] += 0.1
        wb.send_json({"t": "move", "x": 7.1, "y": 5.5, "f": "front-right", "s": "walk"})
        clock[0] += 0.6
        wb.send_json({"t": "say", "text": "여기는 A 방"})
        assert recv(wa, "move")["x"] == 7.1
        assert recv(wa, "say")["text"] == "여기는 A 방"
        quiet(wc)
        quiet(wd)


# ---------------------------------------------------------------- tabs, layout, logout, limits


def test_second_tab_takes_over_the_character(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with a.ws() as wa, b.ws() as wb1, b.ws() as wb2:
        join(wa, a.room)
        first = join(wb1, a.room)["you"]["id"]
        recv(wa, "room.join")
        second = join(wb2, a.room)["you"]["id"]
        recv(wb1, "room.replaced")
        assert recv(wa, "room.leave")["id"] == first
        assert recv(wa, "room.join")["member"]["id"] == second
        room = next(iter(hub.rooms.values()))
        assert [m.conn.user_id for m in room.members.values()].count(uuid.UUID(b.id)) == 1


def test_layout_and_theme_changes_reach_visitors(tc, monkeypatch):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    clock = [1000.0]
    monkeypatch.setattr(hub_mod, "now", lambda: clock[0])
    with a.ws() as wa, b.ws() as wb:
        join(wa, a.room)
        join(wb, a.room, x=5.1, y=6.1)
        recv(wa, "room.join")
        info = a.req("GET", "/api/rooms/me").json()
        # A puts the cushion... make it a desk right where B stands (desk blocks, 2x1).
        items = info["items"] + [{"type": "desk", "x": 6.25, "y": 6.75, "facing": 0}]
        r = a.req("PUT", f"/api/rooms/{a.room}/items", json={"layout_version": info["layout_version"], "items": items})
        assert r.status_code == 200, r.text
        lay = recv(wb, "room.layout")
        assert lay["version"] == info["layout_version"] + 1 and {"type": "desk", "x": 6.25, "y": 6.75, "facing": 0} in lay["items"]
        recv(wa, "room.layout")
        assert any(o == (6.25, 6.75, 2, 1) for o in next(iter(hub.rooms.values())).geometry.obstacles)
        assert a.req("PATCH", f"/api/rooms/{a.room}", json={"theme": "galaxy"}).status_code == 200
        assert recv(wb, "room.theme")["theme"] == "galaxy"


def test_logout_closes_that_sessions_sockets(tc):
    a = User(tc, "꾸미", "ggumi01")
    with a.ws() as wa:
        recv(wa, "welcome")
        assert a.req("POST", "/api/auth/logout").status_code == 204
        with pytest.raises(WebSocketDisconnect) as e:
            for _ in range(5):
                wa.receive_json()
        assert e.value.code == 4401


def test_expired_session_is_noticed_on_heartbeat(tc, monkeypatch):
    from app.db import SessionLocal
    from app.models import UserSession
    from sqlalchemy import delete

    a = User(tc, "꾸미", "ggumi01")
    monkeypatch.setattr(ws_mod, "SESSION_RECHECK_S", 0)
    with a.ws() as wa:
        recv(wa, "welcome")
        with SessionLocal() as db:  # session revoked behind the socket's back
            db.execute(delete(UserSession))
            db.commit()
        wa.send_json({"t": "ping"})
        with pytest.raises(WebSocketDisconnect) as e:
            for _ in range(5):
                wa.receive_json()
        assert e.value.code == 4401


def test_unfriend_drops_the_visitor(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with a.ws() as wa, b.ws() as wb:
        join(wa, a.room)
        bid = join(wb, a.room)["you"]["id"]
        recv(wa, "room.join")
        assert a.req("DELETE", f"/api/friends/{b.id}").status_code == 204
        assert recv(wb, "room.denied")["code"] == "no_access"
        assert recv(wa, "room.leave")["id"] == bid


def test_frame_limits(tc):
    a = User(tc, "꾸미", "ggumi01")
    with pytest.raises(WebSocketDisconnect) as e, a.ws() as wa:
        wa.send_text("x" * 5000)
        for _ in range(5):
            wa.receive_json()
    assert e.value.code == 1009
    with pytest.raises(WebSocketDisconnect) as e, a.ws() as wa:
        for _ in range(5):
            wa.send_text("{not json")
        for _ in range(5):
            wa.receive_json()
    assert e.value.code == 4400
    with pytest.raises(WebSocketDisconnect) as e, a.ws() as wa:
        wa.send_bytes(b"\x00\x01")
        for _ in range(5):
            wa.receive_json()
    assert e.value.code == 4400


def test_connections_per_user_are_capped(tc, monkeypatch):
    monkeypatch.setattr(ws_mod, "MAX_CONNS_PER_USER", 2)
    a = User(tc, "꾸미", "ggumi01")
    with a.ws() as w1, a.ws() as w2:
        recv(w1, "welcome")
        recv(w2, "welcome")
        with pytest.raises(WebSocketDisconnect) as e, a.ws() as w3:
            w3.receive_json()
        assert e.value.code == 4429
