"""Public sign-up safety: consent, account deletion, blocking, reporting."""

import uuid

from sqlalchemy import text

from app.db import SessionLocal

from .test_party import enter, party  # noqa: F401
from .test_realtime import User, befriend, join, recv, tc  # noqa: F401


def count(sql, **params):
    with SessionLocal() as db:
        return db.scalar(text(sql), params)


# ---------------------------------------------------------------- consent


def test_signup_needs_age_and_policy_consent_and_records_it(api):
    body = {"nickname": "새싹", "login_id": "sprout01", "password": "cozy-room-2026", "password_confirm": "cozy-room-2026"}
    r = api.post("/api/auth/signup", json=body)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "agree"
    assert count("SELECT count(*) FROM users") == 0
    assert api.post("/api/auth/signup", json=body | {"agree": True}).status_code == 201
    assert count("SELECT count(*) FROM users WHERE terms_agreed_at IS NOT NULL") == 1


# ---------------------------------------------------------------- withdrawal


def test_withdraw_needs_the_password_and_removes_everything(tc):  # noqa: F811
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    assert a.req("POST", f"/api/messages/with/{b.id}", json={"body": "안녕", "client_id": str(uuid.uuid4())}).status_code == 201
    assert b.req("POST", f"/api/rooms/{a.room}/guestbook", json={"body": "놀러 왔어"}).status_code == 201
    assert a.req("POST", f"/api/rooms/{b.room}/guestbook", json={"body": "나도"}).status_code == 201
    p = party(a)
    enter(b, p)
    assert b.req("POST", "/api/reports", json={"user_id": a.id, "reason": "spam"}).status_code == 201

    with b.ws() as wb:
        join(wb, p["room_id"])
        assert a.req("POST", "/api/auth/withdraw", json={"password": "wrong-password"}).status_code == 422
        assert a.req("POST", "/api/auth/withdraw", json={"password": "cozy-room-2026"}).status_code == 204
        assert recv(wb, "room.closed")  # their party ends for everyone inside

    uid = a.id
    for table, col in (
        ("users", "id"),
        ("rooms", "owner_id"),
        ("friendships", "user_a_id"),
        ("friendships", "user_b_id"),
        ("messages", "sender_id"),
        ("guestbook_entries", "author_id"),
        ("room_members", "user_id"),
        ("user_sessions", "user_id"),
    ):
        assert count(f"SELECT count(*) FROM {table} WHERE {col} = :u", u=uid) == 0, table
    assert count("SELECT count(*) FROM conversations") == 0  # the chat goes for both
    # The other account is untouched; the report stays without the link.
    assert b.req("GET", "/api/auth/me").status_code == 200
    assert b.req("GET", "/api/friends").json() == []
    assert count("SELECT count(*) FROM reports WHERE target_id IS NULL AND target_login_id = 'ggumi01'") == 1
    # The deleted account's session no longer works, and the login id is free again.
    assert a.req("GET", "/api/auth/me").status_code == 401
    User(tc, "새꾸미", "ggumi01")


def test_withdraw_closes_the_accounts_sockets(tc):  # noqa: F811
    a = User(tc, "꾸미", "ggumi01")
    with a.ws() as wa:
        recv(wa, "welcome")
        assert a.req("POST", "/api/auth/withdraw", json={"password": "cozy-room-2026"}).status_code == 204
        closed = None
        try:
            for _ in range(20):
                wa.receive_json()
        except Exception as e:  # noqa: BLE001
            closed = getattr(e, "code", None)
        assert closed == 4401


# ---------------------------------------------------------------- blocking


def test_block_ends_friendship_visits_and_requests(tc):  # noqa: F811
    a, b, c = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01"), User(tc, "모모", "momo01")
    befriend(a, b)
    inv = a.req("POST", "/api/rooms/me/invite").json()["url"].rsplit("/", 1)[1]
    assert c.req("POST", f"/api/invites/{inv}/accept").status_code == 200
    with b.ws() as wb:
        join(wb, a.room)
        assert a.req("POST", "/api/blocks", json={"user_id": b.id}).status_code == 204
        assert recv(wb, "room.denied")["code"] == "no_access"  # out of my room right away
    assert a.req("GET", "/api/friends").json() == [] and b.req("GET", "/api/friends").json() == []
    # Neither can come back, ask again, chat, or find the other.
    assert b.req("GET", f"/api/rooms/{a.room}").status_code == 404
    assert a.req("GET", f"/api/rooms/{b.room}").status_code == 404
    for x, y in ((a, b), (b, a)):
        r = x.req("POST", "/api/friends/requests", json={"user_id": y.id})
        assert r.status_code == 403 and "보낼 수 없어요" in r.json()["detail"]
        assert x.req("POST", f"/api/messages/with/{y.id}", json={"body": "hi", "client_id": str(uuid.uuid4())}).status_code in (403, 404)
    assert b.req("GET", "/api/friends/search?q=꾸미").json() == []
    assert [u["nickname"] for u in c.req("GET", "/api/friends/search?q=꾸미").json()] == ["꾸미"]  # others still find them
    # An invite link doesn't open the room to someone blocked; others' invites still work.
    inv2 = a.req("POST", "/api/rooms/me/invite").json()["url"].rsplit("/", 1)[1]
    assert b.req("POST", f"/api/invites/{inv2}/accept").status_code == 404
    assert c.req("GET", f"/api/rooms/{a.room}").json()["access"] == "guest"
    # The list, and lifting the block (nothing comes back by itself).
    assert [x["nickname"] for x in a.req("GET", "/api/blocks").json()] == ["토리"]
    assert b.req("GET", "/api/blocks").json() == []
    assert a.req("DELETE", f"/api/blocks/{b.id}").status_code == 204
    assert a.req("DELETE", f"/api/blocks/{b.id}").status_code == 404
    assert b.req("GET", f"/api/rooms/{a.room}").status_code == 404
    befriend(b, a)
    assert b.req("GET", f"/api/rooms/{a.room}").json()["access"] == "friend"


def test_block_cancels_pending_requests_and_needs_a_real_user(tc):  # noqa: F811
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    assert b.req("POST", "/api/friends/requests", json={"user_id": a.id}).status_code == 201
    assert a.req("POST", "/api/blocks", json={"user_id": b.id}).status_code == 204
    assert a.req("GET", "/api/friends/requests").json()["incoming"] == []
    assert a.req("POST", "/api/blocks", json={"user_id": a.id}).status_code == 404
    assert a.req("POST", "/api/blocks", json={"user_id": str(uuid.uuid4())}).status_code == 404
    assert a.req("POST", "/api/blocks", json={"user_id": b.id}).status_code == 204  # again: still fine


# ---------------------------------------------------------------- reporting


def test_report_is_stored_for_the_operator(tc):  # noqa: F811
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    r = a.req("POST", "/api/reports", json={"user_id": b.id, "reason": "abuse", "context": "chat", "detail": "  욕을 했어요\x07  "})
    assert r.status_code == 201
    with SessionLocal() as db:
        row = db.execute(text("SELECT reporter_id, target_id, target_nickname, reason, context, detail, status FROM reports")).one()
    assert (str(row[0]), str(row[1]), row[2], row[3], row[4], row[5], row[6]) == (a.id, b.id, "토리", "abuse", "chat", "욕을 했어요", "open")
    assert a.req("POST", "/api/reports", json={"user_id": b.id, "reason": "made-up"}).status_code == 422
    assert a.req("POST", "/api/reports", json={"user_id": a.id, "reason": "spam"}).status_code == 404
    assert a.req("POST", "/api/reports", json={"user_id": b.id, "reason": "spam", "detail": "x" * 301}).status_code == 422


def test_logged_out_cannot_use_safety_routes(tc):  # noqa: F811
    a = User(tc, "꾸미", "ggumi01")
    tc.cookies.clear()
    csrf = tc.get("/api/auth/csrf").json()["csrf_token"]
    h = {"x-csrf-token": csrf, "cookie": f"ggumi_csrf={csrf}"}
    for method, url, body in (
        ("GET", "/api/blocks", None),
        ("POST", "/api/blocks", {"user_id": a.id}),
        ("DELETE", f"/api/blocks/{a.id}", None),
        ("POST", "/api/reports", {"user_id": a.id, "reason": "spam"}),
        ("POST", "/api/auth/withdraw", {"password": "cozy-room-2026"}),
    ):
        assert tc.request(method, url, headers=h, json=body).status_code == 401, url
    tc.cookies.clear()
