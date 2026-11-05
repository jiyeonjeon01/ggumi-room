import threading
import uuid

from sqlalchemy import text

from app.db import SessionLocal
from tests.conftest import Api


# ---------------------------------------------------------------- rooms


def test_rooms_are_separate_and_private(make_user):
    a = make_user("꾸미", "user_a")
    b = make_user("토리", "user_b")
    assert a.me["room_id"] != b.me["room_id"]
    mine = a.get("/api/rooms/me").json()
    assert mine["owner_nickname"] == "꾸미" and mine["access"] == "owner"
    # Strangers can't see or edit someone else's room (same 404 as "doesn't exist").
    assert b.get(f"/api/rooms/{a.me['room_id']}").status_code == 404
    assert b.get(f"/api/rooms/{uuid.uuid4()}").status_code == 404
    assert b.patch(f"/api/rooms/{a.me['room_id']}", json={"theme": "galaxy"}).status_code == 404
    assert a.patch(f"/api/rooms/{a.me['room_id']}", json={"theme": "galaxy"}).json()["theme"] == "galaxy"
    assert a.patch(f"/api/rooms/{a.me['room_id']}", json={"theme": "lava"}).status_code == 422


# ---------------------------------------------------------------- search


def test_search_by_nickname_with_same_names(make_user):
    me = make_user("꾸미", "me_user")
    make_user("토리", "tori_1")
    make_user("토리", "tori_2")
    make_user("토리언니", "tori_3")
    res = me.get("/api/friends/search", params={"q": "토리"}).json()
    assert [r["nickname"] for r in res][:2] == ["토리", "토리"]  # exact matches first
    assert len(res) == 3 and len({r["id"] for r in res}) == 3  # same names, different ids
    for r in res:
        assert set(r) == {"id", "nickname", "joined_at", "relation", "request_id"}  # no login id, no hash
    assert me.get("/api/friends/search", params={"q": "꾸미"}).json() == []  # never yourself
    assert me.get("/api/friends/search", params={"q": "%"}).json() == []  # LIKE wildcards are escaped
    assert me.get("/api/friends/search", params={"q": "x" * 13}).status_code == 422
    assert me.get("/api/friends/search", params={"q": "토", "limit": 99}).status_code == 422


def test_search_rate_limited(make_user):
    me = make_user("꾸미", "me_user")
    codes = [me.get("/api/friends/search", params={"q": "a"}).status_code for _ in range(31)]
    assert codes[-1] == 429


# ---------------------------------------------------------------- requests


def test_request_accept_and_relations(make_user):
    a = make_user("꾸미", "user_a")
    b = make_user("토리", "user_b")
    r = a.post("/api/friends/requests", json={"user_id": b.me["id"]})
    assert r.status_code == 201 and r.json()["status"] == "pending"
    rid = r.json()["request_id"]
    assert a.get("/api/friends/search", params={"q": "토리"}).json()[0]["relation"] == "outgoing"
    assert b.get("/api/friends/search", params={"q": "꾸미"}).json()[0]["relation"] == "incoming"
    assert a.post("/api/friends/requests", json={"user_id": b.me["id"]}).status_code == 409  # duplicate
    assert a.post(f"/api/friends/requests/{rid}/accept").status_code == 404  # only the recipient
    incoming = b.get("/api/friends/requests").json()["incoming"]
    assert incoming[0]["id"] == rid and incoming[0]["user"]["nickname"] == "꾸미"
    assert b.post(f"/api/friends/requests/{rid}/accept").json()["status"] == "accepted"
    assert [f["nickname"] for f in a.get("/api/friends").json()] == ["토리"]
    assert [f["nickname"] for f in b.get("/api/friends").json()] == ["꾸미"]
    assert a.get("/api/friends").json()[0]["room_id"] == b.me["room_id"]
    assert a.post("/api/friends/requests", json={"user_id": b.me["id"]}).status_code == 409  # already friends
    # Friends may visit each other's rooms.
    assert a.get(f"/api/rooms/{b.me['room_id']}").json()["access"] == "friend"


def test_decline_cancel_and_unfriend(make_user):
    a = make_user("꾸미", "user_a")
    b = make_user("토리", "user_b")
    rid = a.post("/api/friends/requests", json={"user_id": b.me["id"]}).json()["request_id"]
    assert b.post(f"/api/friends/requests/{rid}/decline").status_code == 204
    assert a.get("/api/friends").json() == []
    rid = a.post("/api/friends/requests", json={"user_id": b.me["id"]}).json()["request_id"]  # can ask again
    assert b.delete(f"/api/friends/requests/{rid}").status_code == 404  # only the sender can cancel
    assert a.delete(f"/api/friends/requests/{rid}").status_code == 204
    assert b.get("/api/friends/requests").json()["incoming"] == []
    rid = a.post("/api/friends/requests", json={"user_id": b.me["id"]}).json()["request_id"]
    b.post(f"/api/friends/requests/{rid}/accept")
    assert b.delete(f"/api/friends/{a.me['id']}").status_code == 204
    assert a.get("/api/friends").json() == [] and b.get("/api/friends").json() == []
    assert a.get(f"/api/rooms/{b.me['room_id']}").status_code == 404


def test_self_and_unknown_and_reverse_request(make_user):
    a = make_user("꾸미", "user_a")
    b = make_user("토리", "user_b")
    assert a.post("/api/friends/requests", json={"user_id": a.me["id"]}).status_code == 400
    assert a.post("/api/friends/requests", json={"user_id": str(uuid.uuid4())}).status_code == 404
    a.post("/api/friends/requests", json={"user_id": b.me["id"]})
    # B asks A while A's request is pending: becomes an accept.
    assert b.post("/api/friends/requests", json={"user_id": a.me["id"]}).json()["status"] == "accepted"
    with SessionLocal() as db:
        assert db.scalar(text("SELECT count(*) FROM friendships")) == 1


def test_concurrent_requests_leave_one_consistent_state(make_user):
    a = make_user("꾸미", "user_a")
    b = make_user("토리", "user_b")
    codes = []

    def send(x, y):
        codes.append(x.post("/api/friends/requests", json={"user_id": y.me["id"]}).status_code)

    threads = [threading.Thread(target=send, args=pair) for pair in [(a, b), (b, a), (a, b), (b, a), (a, b), (b, a)]]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    with SessionLocal() as db:
        pending = db.scalar(text("SELECT count(*) FROM friend_requests WHERE status = 'pending'"))
        friends = db.scalar(text("SELECT count(*) FROM friendships"))
    assert pending + friends == 1, (codes, pending, friends)
    assert pending <= 1 and friends <= 1


# ---------------------------------------------------------------- invites


def test_invite_link_flow_without_friendship(make_user):
    a = make_user("꾸미", "user_a")
    first = a.post("/api/rooms/me/invite").json()
    again = a.post("/api/rooms/me/invite").json()
    assert first["url"] == again["url"]  # live link reused
    token = first["url"].rsplit("/", 1)[1]
    assert first["url"].startswith("http://testserver/invite/") and len(token) == 32
    assert a.me["room_id"] not in first["url"] and a.me["id"] not in first["url"]

    guest = Api()  # not logged in
    preview = guest.get(f"/api/invites/{token}").json()
    assert preview["status"] == "valid" and preview["inviter_nickname"] == "꾸미" and preview["room_name"] == "꾸미의 방"
    assert guest.post(f"/api/invites/{token}/accept").status_code == 401  # must log in first

    r = guest.signup(nickname="토리", login_id="user_b")
    assert r.status_code == 201
    room_id = guest.post(f"/api/invites/{token}/accept").json()["room_id"]
    assert room_id == a.me["room_id"]
    room = guest.get(f"/api/rooms/{room_id}").json()
    assert room["access"] == "guest" and room["owner_nickname"] == "꾸미"
    # Visiting doesn't make friends, and accepting twice is fine.
    assert guest.get("/api/friends").json() == []
    assert guest.post(f"/api/invites/{token}/accept").status_code == 200


def test_invite_regenerate_revoke_and_expiry(make_user):
    a = make_user("꾸미", "user_a")
    old = a.post("/api/rooms/me/invite").json()["url"].rsplit("/", 1)[1]
    new = a.post("/api/rooms/me/invite/regenerate").json()["url"].rsplit("/", 1)[1]
    assert old != new
    g = Api()
    assert g.get(f"/api/invites/{old}").json() == {"status": "revoked", "inviter_nickname": None, "room_name": None, "expires_at": None}
    assert g.get(f"/api/invites/{new}").json()["status"] == "valid"
    g.signup(nickname="토리", login_id="user_b")
    assert g.post(f"/api/invites/{old}/accept").status_code == 410

    with SessionLocal() as db:
        db.execute(text("UPDATE room_invitations SET expires_at = now() - interval '1 second' WHERE revoked_at IS NULL"))
        db.commit()
    assert g.get(f"/api/invites/{new}").json()["status"] == "expired"
    assert g.post(f"/api/invites/{new}/accept").status_code == 410
    fresh = a.post("/api/rooms/me/invite").json()["url"].rsplit("/", 1)[1]  # expired link is replaced
    assert fresh not in (old, new)

    assert a.delete("/api/rooms/me/invite").status_code == 204
    assert g.get(f"/api/invites/{fresh}").json()["status"] == "revoked"


def test_invalid_invite_tokens(api):
    for bad in ["nope", "x" * 32, "../../etc/passwd", "<script>alert(1)</script>"]:
        r = api.get(f"/api/invites/{bad}")
        assert r.status_code in (200, 404) and (r.status_code == 404 or r.json()["status"] == "not_found"), bad
