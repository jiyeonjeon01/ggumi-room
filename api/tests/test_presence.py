"""Friend presence: online / away / offline per user over all of their connections."""

import time

import pytest

from app.realtime import hub as hub_mod
from app.realtime.hub import hub
from tests.test_realtime import User, befriend, quiet, recv, tc  # noqa: F401  (fixture)


@pytest.fixture
def clock(monkeypatch):
    t = [10_000.0]
    monkeypatch.setattr(hub_mod, "now", lambda: t[0])
    return t


def presence(ws, user, status):
    """Next presence event for `user` must be `status`."""
    m = recv(ws, "presence")
    assert (m["user_id"], m["status"]) == (user.id, status), m


def sweep(tc):
    tc.portal.call(hub.sweep)


def test_friends_see_login_and_get_a_snapshot(tc):
    a, b, c = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01"), User(tc, "남남", "stranger1")
    befriend(a, b)
    with b.ws() as wb, c.ws() as wc:
        w = recv(wb, "welcome")
        assert w["presence"] == {a.id: "offline"}  # snapshot of B's friends
        assert recv(wc, "welcome")["presence"] == {}  # C has no friends: learns nothing
        with a.ws() as wa:
            assert recv(wa, "welcome")["presence"] == {b.id: "online"}
            presence(wb, a, "online")  # right after login
            quiet(wc)  # not a friend: never told


def test_away_after_five_quiet_minutes_heartbeats_dont_count(tc, clock):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with b.ws() as wb, a.ws() as wa:
        presence(wb, a, "online")
        clock[0] += 299
        sweep(tc)
        quiet(wb)  # 4:59 still online
        clock[0] += 2
        for _ in range(3):
            wa.send_json({"t": "ping"})  # heartbeats are not activity
            recv(wa, "pong")
        sweep(tc)
        presence(wb, a, "away")
        wa.send_json({"t": "activity"})  # real input again
        presence(wb, a, "online")


def test_moving_in_a_room_counts_as_activity(tc, clock):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with b.ws() as wb, a.ws() as wa:
        presence(wb, a, "online")
        wa.send_json({"t": "join", "room": a.room, "x": 7, "y": 5.5})
        recv(wa, "room.state")
        clock[0] += 400
        sweep(tc)
        presence(wb, a, "away")
        clock[0] += 0.1
        wa.send_json({"t": "move", "x": 7.1, "y": 5.5, "f": "front-right", "s": "walk"})
        presence(wb, a, "online")


def test_reported_idle_time_on_connect(tc, clock):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with b.ws() as wb, a.ws() as wa:
        presence(wb, a, "online")
        # A background tab reconnecting: last input was 6 minutes ago
        wa.send_json({"t": "activity", "idle_ms": 360_000})
        presence(wb, a, "away")


def test_many_tabs_count_as_one_user(tc, clock):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with b.ws() as wb, a.ws() as w1:
        presence(wb, a, "online")
        with a.ws() as w2:
            quiet(wb)  # second tab: no duplicate event
            clock[0] += 200
            w2.send_json({"t": "activity"})  # active in tab 2 only
            w2.send_json({"t": "ping"})
            recv(w2, "pong")  # processed before the clock moves on
            clock[0] += 200  # tab 1 quiet for 400 s, tab 2 for 200 s
            sweep(tc)
            quiet(wb)  # still online thanks to tab 2
        # Tab 2 closed; tab 1 remains, idle for 400 s -> away (not offline)
        sweep(tc)
        presence(wb, a, "away")


def test_dropped_connection_goes_offline_after_grace(tc, monkeypatch):
    monkeypatch.setattr(hub_mod, "OFFLINE_GRACE_S", 0.3)
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with b.ws() as wb:
        with a.ws():
            presence(wb, a, "online")
        quiet(wb)  # just closed: not offline yet (could be a reload)
        time.sleep(0.5)
        presence(wb, a, "offline")
        # A reload: close and reconnect within the grace period -> no offline blip
        with a.ws():
            presence(wb, a, "online")
        with a.ws():
            quiet(wb)
        time.sleep(0.5)
        presence(wb, a, "offline")


def test_logout_is_offline_at_once(tc, monkeypatch):
    monkeypatch.setattr(hub_mod, "OFFLINE_GRACE_S", 30)
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with b.ws() as wb, a.ws() as wa:
        presence(wb, a, "online")
        assert a.req("POST", "/api/auth/logout").status_code == 204
        presence(wb, a, "offline")
        del wa


def test_friend_changes_are_pushed_with_status(tc):
    a, c = User(tc, "꾸미", "ggumi01"), User(tc, "새친", "newfriend")
    with a.ws() as wa, c.ws() as wc:
        recv(wa, "welcome")
        recv(wc, "welcome")
        req = a.req("POST", "/api/friends/requests", json={"user_id": c.id}).json()["request_id"]
        assert recv(wc, "friends.changed")["presence"] == {}  # request badge, no status yet
        assert c.req("POST", f"/api/friends/requests/{req}/accept").status_code == 200
        assert recv(wa, "friends.changed")["presence"] == {c.id: "online"}
        assert recv(wc, "friends.changed")["presence"] == {a.id: "online"}
        # Unfriended: no more status updates
        assert a.req("DELETE", f"/api/friends/{c.id}").status_code == 204
        recv(wc, "friends.changed")
        wa.send_json({"t": "activity", "idle_ms": 400_000})
        quiet(wc)


def test_presence_sync_on_request(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with a.ws() as wa:
        recv(wa, "welcome")
        wa.send_json({"t": "presence.sync"})
        assert recv(wa, "presence.list")["presence"] == {b.id: "offline"}


def test_silent_network_drop_goes_offline_after_timeout_and_grace(tc, monkeypatch):
    from app.realtime import ws as ws_mod

    monkeypatch.setattr(ws_mod, "IDLE_TIMEOUT", 0.4)  # no frames at all (pings stopped): connection is dead
    monkeypatch.setattr(hub_mod, "OFFLINE_GRACE_S", 0.3)
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with b.ws() as wb, a.ws():
        presence(wb, a, "online")
        # A goes silent (unplugged network); B keeps pinging and watches A's status.
        seen, t0 = [], time.time()
        while time.time() - t0 < 2.5 and "offline" not in seen:
            wb.send_json({"t": "ping"})
            while (m := wb.receive_json())["t"] != "pong":
                if m["t"] == "presence" and m["user_id"] == a.id:
                    seen.append((m["status"], round(time.time() - t0, 2)))
            time.sleep(0.1)
        assert [st for st, _ in seen] == ["offline"], seen
        # Not before the idle timeout (0.4 s) plus the grace (0.3 s)
        assert seen[0][1] >= 0.6, seen
