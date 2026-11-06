"""Party rooms: who may enter, capacity, several tabs, seat holds, closing and restart recovery."""

import contextlib
import time
import uuid
from datetime import timedelta

from sqlalchemy import text

from app import ratelimit
from app.db import engine, utcnow
from app.realtime import hub as hub_mod
from app.realtime import parties
from app.realtime.hub import hub

from .test_realtime import User, befriend, join, recv, tc  # noqa: F401


def quiet(ws):
    """Up to a ping's pong, the socket wasn't refused or put out of the room."""
    ws.send_json({"t": "ping"})
    while (m := ws.receive_json())["t"] != "pong":
        assert m["t"] not in ("room.denied", "room.closed", "room.replaced"), m


def users(tc, n, prefix="p"):  # noqa: F811
    out = []
    for i in range(n):
        if i % 9 == 0:
            ratelimit.reset()  # sign-ups per IP are limited
        out.append(User(tc, f"{prefix}{i:02d}", f"{prefix}user{i:02d}"))
    return out


def party(host):
    r = host.req("POST", "/api/parties")
    assert r.status_code == 201, r.text
    p = r.json()
    p["token"] = p["share_url"].rsplit("/", 1)[1]
    return p


def enter(u, p):
    """Join by link (membership), returns the room id."""
    r = u.req("POST", f"/api/parties/join/{p['token']}")
    assert r.status_code == 200, r.text
    return r.json()["room_id"]


def first(ws, *types):
    for _ in range(50):
        m = ws.receive_json()
        if m["t"] in types:
            return m
    raise AssertionError(f"none of {types}")


def db_row(room_id):
    with engine.connect() as c:
        return c.execute(text("SELECT closes_at, closed_at, last_active_at FROM rooms WHERE id = :id"), {"id": room_id}).one()


def db_set(room_id, **values):
    sets = ", ".join(f"{k} = :{k}" for k in values)
    with engine.begin() as c:
        c.execute(text(f"UPDATE rooms SET {sets} WHERE id = :id"), {"id": room_id, **values})


def until(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


# ---------------------------------------------------------------- creating & the HTTP side


def test_create_one_open_party_per_host(tc):  # noqa: F811
    a = User(tc, "꾸미", "ggumi01")
    p = party(a)
    assert p["share_url"].startswith("http://testserver/party/") and len(p["token"]) == 32
    assert p["capacity"] == 10 and p["count"] == 0
    again = a.req("POST", "/api/parties")
    assert again.status_code == 409 and again.json()["detail"]["room_id"] == p["room_id"]
    assert a.req("GET", "/api/parties/mine").json()["room_id"] == p["room_id"]
    room = a.req("GET", f"/api/rooms/{p['room_id']}").json()
    assert room["kind"] == "party" and room["template"] == "lounge" and room["access"] == "owner"
    assert room["guestbook_enabled"] is False and room["party"]["share_url"] == p["share_url"]
    assert len(room["items"]) > 0  # the lounge's fixed furniture
    # My own room is still my default room.
    assert a.req("GET", "/api/rooms/me").json()["id"] == a.room


def test_logged_out_sees_nothing(tc):  # noqa: F811
    a = User(tc, "꾸미", "ggumi01")
    p = party(a)
    tc.cookies.clear()
    csrf = tc.get("/api/auth/csrf").json()["csrf_token"]
    h = {"x-csrf-token": csrf, "cookie": f"ggumi_csrf={csrf}"}
    for method, url in (
        ("POST", "/api/parties"),
        ("GET", "/api/parties/mine"),
        ("GET", f"/api/parties/join/{p['token']}"),
        ("POST", f"/api/parties/join/{p['token']}"),
        ("POST", f"/api/parties/{p['room_id']}/close"),
        ("GET", f"/api/rooms/{p['room_id']}"),
    ):
        r = tc.request(method, url, headers=h)
        assert r.status_code == 401, (method, url, r.status_code)
        assert "파티" not in r.text and a.me["nickname"] not in r.text
    tc.cookies.clear()


def test_link_lets_anyone_logged_in_join_but_nothing_else(tc):  # noqa: F811
    host, friend, stranger = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01"), User(tc, "모모", "momo01")
    befriend(host, friend)
    p = party(host)
    # Being the host's friend doesn't open the party...
    assert friend.req("GET", f"/api/rooms/{p['room_id']}").status_code == 404
    with friend.ws() as ws:
        ws.send_json({"t": "join", "room": p["room_id"]})
        assert recv(ws, "room.denied")["code"] == "no_access"
    # ...the link does, for a stranger too.
    pv = stranger.req("GET", f"/api/parties/join/{p['token']}").json()
    assert pv["status"] == "open" and pv["host_nickname"] == "꾸미" and pv["capacity"] == 10
    enter(stranger, p)
    assert stranger.req("GET", f"/api/rooms/{p['room_id']}").json()["access"] == "member"
    # A party member gets nothing of the host's personal room.
    assert stranger.req("GET", f"/api/rooms/{host.room}").status_code == 404
    assert stranger.req("GET", f"/api/rooms/{host.room}/guestbook").status_code == 404
    # Bad and unknown links.
    assert stranger.req("GET", "/api/parties/join/nope").json()["status"] == "not_found"
    assert stranger.req("POST", "/api/parties/join/" + "x" * 32).status_code == 404
    # A party link isn't an invite link.
    assert stranger.req("GET", f"/api/invites/{p['token']}").json()["status"] == "not_found"


def test_party_has_a_fixed_setup(tc):  # noqa: F811
    host = User(tc, "꾸미", "ggumi01")
    p = party(host)
    rid = p["room_id"]
    assert host.req("PUT", f"/api/rooms/{rid}/items", json={"layout_version": 0, "items": []}).status_code == 404
    assert host.req("PATCH", f"/api/rooms/{rid}", json={"theme": "galaxy"}).status_code == 404
    assert host.req("GET", f"/api/rooms/{rid}/guestbook").status_code == 404
    assert host.req("POST", f"/api/rooms/{rid}/guestbook", json={"body": "hi"}).status_code == 404


def test_unfriending_does_not_touch_parties(tc):  # noqa: F811
    host, friend = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(host, friend)
    p = party(host)
    enter(friend, p)
    with friend.ws() as ws:
        join(ws, p["room_id"])
        assert host.req("DELETE", f"/api/friends/{friend.id}").status_code == 204
        quiet(ws)  # no room.denied: still in the party
        assert hub.party_count(uuid.UUID(p["room_id"])) == 1


# ---------------------------------------------------------------- capacity & tabs


def test_capacity_holds_under_concurrent_joins(tc):  # noqa: F811
    host, *rest = users(tc, 15)
    p = party(host)
    for u in rest:
        enter(u, p)
    with contextlib.ExitStack() as stack:
        socks = [stack.enter_context(u.ws()) for u in [host, *rest]]
        for ws in socks:
            recv(ws, "welcome")
        for ws in socks:
            ws.send_json({"t": "join", "room": p["room_id"]})
        got = [first(ws, "room.state", "room.denied") for ws in socks]
        inside = [m for m in got if m["t"] == "room.state"]
        full = [m for m in got if m["t"] == "room.denied"]
        assert len(inside) == 10 and len(full) == 5
        assert all(m["code"] == "full" and m["capacity"] == 10 and m["count"] == 10 for m in full)
        assert hub.party_count(uuid.UUID(p["room_id"])) == 10
        # Retrying while full is refused again; once someone leaves, it works.
        denied = socks[got.index(full[0])]
        denied.send_json({"t": "join", "room": p["room_id"]})
        assert recv(denied, "room.denied")["code"] == "full"
        socks[got.index(inside[0])].send_json({"t": "leave"})
        denied.send_json({"t": "join", "room": p["room_id"]})
        assert first(denied, "room.state", "room.denied")["t"] == "room.state"


def test_several_tabs_count_as_one_person(tc, monkeypatch):  # noqa: F811
    monkeypatch.setattr(hub_mod, "PARTY_CAPACITY", 2)
    host, guest, late = users(tc, 3)
    p = party(host)
    enter(guest, p), enter(late, p)
    with host.ws() as t1, host.ws() as t2, guest.ws() as g, late.ws() as lt:
        assert join(t1, p["room_id"])["count"] == 1
        st = join(t2, p["room_id"])  # second tab takes over the character, still one person
        assert st["count"] == 1 and st["members"] == []
        recv(t1, "room.replaced")
        assert join(g, p["room_id"])["count"] == 2
        lt.send_json({"t": "join", "room": p["room_id"]})
        assert recv(lt, "room.denied")["code"] == "full"
        # The host coming back on the first tab doesn't need a seat either.
        assert join(t1, p["room_id"])["count"] == 2


def test_dropped_connection_keeps_its_seat_for_a_while(tc, monkeypatch):  # noqa: F811
    monkeypatch.setattr(hub_mod, "PARTY_CAPACITY", 2)
    monkeypatch.setattr(hub_mod, "SEAT_HOLD_S", 0.6)
    host, guest, late = users(tc, 3)
    p = party(host)
    enter(guest, p), enter(late, p)
    rid = uuid.UUID(p["room_id"])
    with host.ws() as h, late.ws() as lt:
        join(h, p["room_id"])
        with guest.ws() as g:
            join(g, p["room_id"])
        # The guest's tab closed (reload, network): their seat stays taken.
        assert until(lambda: rid in hub.rooms and not any(m.conn.user_id == uuid.UUID(guest.id) for m in hub.rooms[rid].members.values()))
        assert hub.party_count(rid) == 2
        lt.send_json({"t": "join", "room": p["room_id"]})
        assert recv(lt, "room.denied")["code"] == "full"
        with guest.ws() as g:  # back within the hold: gets in although the room is "full"
            assert join(g, p["room_id"])["count"] == 2
        # Gone for longer than the hold: the seat frees up.
        assert until(lambda: hub.party_count(rid) == 1, timeout=3)
        assert recv(h, "room.count")["count"] in (1, 2)
        lt.send_json({"t": "join", "room": p["room_id"]})
        assert first(lt, "room.state", "room.denied")["t"] == "room.state"


# ---------------------------------------------------------------- closing


def test_only_the_host_can_close_and_closed_stays_closed(tc):  # noqa: F811
    host, guest = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    p = party(host)
    enter(guest, p)
    with guest.ws() as g, host.ws() as h:
        join(g, p["room_id"])
        join(h, p["room_id"])
        assert guest.req("POST", f"/api/parties/{p['room_id']}/close").status_code == 404
        quiet(g)
        assert host.req("POST", f"/api/parties/{p['room_id']}/close").status_code == 204
        assert recv(g, "room.closed") and recv(h, "room.closed")
        g.send_json({"t": "join", "room": p["room_id"]})
        assert recv(g, "room.denied")["code"] == "closed"
    assert db_row(p["room_id"]).closed_at is not None
    assert guest.req("GET", f"/api/parties/join/{p['token']}").json() == {
        "status": "closed", "room_id": None, "name": None, "host_nickname": None, "capacity": None, "count": None
    }
    assert guest.req("POST", f"/api/parties/join/{p['token']}").status_code == 410
    r = guest.req("GET", f"/api/rooms/{p['room_id']}")
    assert r.status_code == 410 and r.json()["detail"]["code"] == "closed"
    assert host.req("GET", "/api/parties/mine").json() is None
    # The host can open a new one.
    assert party(host)["room_id"] != p["room_id"]


def test_host_leaving_keeps_the_party_open(tc):  # noqa: F811
    host, guest = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    p = party(host)
    enter(guest, p)
    with guest.ws() as g:
        join(g, p["room_id"])
        with host.ws() as h:
            join(h, p["room_id"])
            h.send_json({"t": "leave"})
            recv(g, "room.leave")
        assert until(lambda: db_row(p["room_id"]).closes_at is None)
        assert tc.portal.call(parties.sweep, utcnow() + timedelta(hours=2)) == []
        quiet(g)
    assert db_row(p["room_id"]).closed_at is None


def test_empty_party_closes_after_30_minutes(tc):  # noqa: F811
    host = User(tc, "꾸미", "ggumi01")
    p = party(host)
    with host.ws() as h:
        join(h, p["room_id"])
        assert until(lambda: db_row(p["room_id"]).closes_at is None)
        h.send_json({"t": "leave"})
        quiet(h)
        assert until(lambda: db_row(p["room_id"]).closes_at is not None)
    left = db_row(p["room_id"])
    assert abs((left.closes_at - left.last_active_at) - timedelta(minutes=30)) < timedelta(seconds=1)
    assert tc.portal.call(parties.sweep, left.closes_at - timedelta(minutes=1)) == []
    assert db_row(p["room_id"]).closed_at is None
    closed = tc.portal.call(parties.sweep, left.closes_at + timedelta(seconds=1))
    assert [str(c) for c in closed] == [p["room_id"]]
    assert host.req("GET", f"/api/parties/join/{p['token']}").json()["status"] == "closed"


def test_occupied_party_never_closes(tc):  # noqa: F811
    host = User(tc, "꾸미", "ggumi01")
    p = party(host)
    with host.ws() as h:
        join(h, p["room_id"])
        assert until(lambda: db_row(p["room_id"]).closes_at is None)
        db_set(p["room_id"], closes_at=utcnow() - timedelta(minutes=5))  # e.g. a lost write
        later = utcnow() + timedelta(minutes=1)
        assert tc.portal.call(parties.sweep, later) == []
        row = db_row(p["room_id"])
        assert row.closed_at is None and row.closes_at is None and row.last_active_at == later
        quiet(h)


def test_restart_recovery_is_fair(tc):  # noqa: F811
    a, b, c = users(tc, 3)
    pa, pb, pc = party(a), party(b), party(c)
    now = utcnow()
    # a: occupied when the server stopped, last heartbeat 10 minutes ago.
    db_set(pa["room_id"], closes_at=None, last_active_at=now - timedelta(minutes=10))
    # b: occupied when it stopped, but that was 2 hours ago (long outage).
    db_set(pb["room_id"], closes_at=None, last_active_at=now - timedelta(hours=2))
    # c: empty, its 30 minutes ran out while the server was down.
    db_set(pc["room_id"], closes_at=now - timedelta(minutes=5))
    assert parties.recover(now) == 3
    assert abs(db_row(pa["room_id"]).closes_at - (now + timedelta(minutes=20))) < timedelta(seconds=1)
    for p in (pb, pc):
        assert abs(db_row(p["room_id"]).closes_at - (now + parties.RESTART_GRACE)) < timedelta(seconds=1)
    # Nothing closes in the grace period, so people can reconnect...
    assert tc.portal.call(parties.sweep, now + timedelta(minutes=1)) == []
    with a.ws() as ws:  # ...and coming back keeps the room open
        join(ws, pa["room_id"])
        assert until(lambda: db_row(pa["room_id"]).closes_at is None)
        closed = tc.portal.call(parties.sweep, now + timedelta(minutes=3))
        assert sorted(map(str, closed)) == sorted([pb["room_id"], pc["room_id"]])
        quiet(ws)


def test_lost_emptied_write_is_repaired(tc):  # noqa: F811
    a = User(tc, "꾸미", "ggumi01")
    p = party(a)
    now = utcnow()
    # Marked occupied in the DB, but nobody is in the hub (the "emptied" write never happened).
    db_set(p["room_id"], closes_at=None, last_active_at=now - timedelta(minutes=40))
    assert tc.portal.call(parties.sweep, now) == []
    assert abs(db_row(p["room_id"]).closes_at - (now + parties.RESTART_GRACE)) < timedelta(seconds=1)
    assert len(tc.portal.call(parties.sweep, now + timedelta(minutes=3))) == 1


def test_closed_parties_are_purged_after_a_week(tc):  # noqa: F811
    a = User(tc, "꾸미", "ggumi01")
    p = party(a)
    db_set(p["room_id"], closed_at=utcnow() - timedelta(days=8))
    tc.portal.call(parties.sweep, utcnow())
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM rooms WHERE id = :id"), {"id": p["room_id"]}).scalar() == 0
        # The host's own room is untouched.
        assert c.execute(text("SELECT count(*) FROM rooms WHERE id = :id"), {"id": a.room}).scalar() == 1
