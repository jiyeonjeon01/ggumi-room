"""Room guestbook: who may read/write/delete, limits, paging, owner switch."""

from app import ratelimit
from tests.conftest import Api


def note(u, room_id, body):
    ratelimit.reset()  # the 30 s spacing is tested on its own below
    return u.post(f"/api/rooms/{room_id}/guestbook", json={"body": body})


def befriend(a, b):
    req = a.post("/api/friends/requests", json={"user_id": b.me["id"]}).json()["request_id"]
    assert b.post(f"/api/friends/requests/{req}/accept").status_code == 200


def test_friends_and_invited_guests_write_strangers_and_guests_cannot(make_user):
    owner, friend, guest, stranger = (make_user(n, i) for n, i in (("꾸미", "ggumi01"), ("토리", "tori01"), ("손님", "guest01"), ("남남", "stranger1")))
    room = owner.me["room_id"]
    befriend(owner, friend)
    token = owner.post("/api/rooms/me/invite").json()["url"].rsplit("/", 1)[1]
    guest.post(f"/api/invites/{token}/accept")

    assert note(friend, room, "놀러 왔어요!").status_code == 201
    assert note(guest, room, "초대 고마워요").status_code == 201
    assert note(owner, room, "와 주셔서 고마워요").status_code == 201
    r = note(stranger, room, "몰래 씀")
    assert r.status_code == 404
    assert stranger.get(f"/api/rooms/{room}/guestbook").status_code == 404
    anon = Api()
    assert anon.get(f"/api/rooms/{room}/guestbook").status_code == 401
    assert anon.post(f"/api/rooms/{room}/guestbook", json={"body": "익명"}).status_code == 401

    page = friend.get(f"/api/rooms/{room}/guestbook").json()
    assert page["enabled"] and [(e["author"]["nickname"], e["body"]) for e in page["entries"]] == [
        ("꾸미", "와 주셔서 고마워요"), ("손님", "초대 고마워요"), ("토리", "놀러 왔어요!")
    ]
    assert all("created_at" in e for e in page["entries"])


def test_text_rules(make_user):
    owner = make_user("꾸미", "ggumi01")
    room = owner.me["room_id"]
    e = note(owner, room, "  <script>alert(1)</script>\r\n\r\n\t둘째\u0000 줄  ").json()
    assert e["body"] == "<script>alert(1)</script>\n둘째 줄"  # stored as text; the app renders text only
    assert note(owner, room, "가" * 100).status_code == 201
    r = note(owner, room, "나" * 101)
    assert r.status_code == 422 and "100자" in r.json()["detail"]
    assert note(owner, room, "하나\n둘\n셋\n넷").status_code == 422
    assert note(owner, room, " \n ").status_code == 422


def test_flood_and_duplicates(make_user):
    owner, friend = make_user("꾸미", "ggumi01"), make_user("토리", "tori01")
    befriend(owner, friend)
    room = owner.me["room_id"]
    ratelimit.reset()
    assert friend.post(f"/api/rooms/{room}/guestbook", json={"body": "첫 글"}).status_code == 201
    assert friend.post(f"/api/rooms/{room}/guestbook", json={"body": "바로 또"}).status_code == 429  # 30 s spacing
    assert note(friend, room, "첫 글").status_code == 409  # same text again within 10 minutes
    for i in range(4):  # 5 in this room today
        assert note(friend, room, f"글 {i}").status_code == 201
    r = note(friend, room, "여섯 번째")  # 5 a day in one room
    assert r.status_code == 429 and "오늘" in r.json()["detail"]


def test_delete_rights(make_user):
    owner, a, b = make_user("꾸미", "ggumi01"), make_user("토리", "tori01"), make_user("새롬", "saerom01")
    befriend(owner, a)
    befriend(owner, b)
    room = owner.me["room_id"]
    ea = note(a, room, "토리 글").json()
    eb = note(b, room, "새롬 글").json()
    by_a = {e["id"]: e["can_delete"] for e in a.get(f"/api/rooms/{room}/guestbook").json()["entries"]}
    assert by_a == {ea["id"]: True, eb["id"]: False}
    assert a.delete(f"/api/guestbook/{eb['id']}").status_code == 404  # not mine, not my room
    assert a.delete(f"/api/guestbook/{ea['id']}").status_code == 204  # my own
    assert owner.delete(f"/api/guestbook/{eb['id']}").status_code == 204  # owner moderates
    assert owner.get(f"/api/rooms/{room}/guestbook").json()["entries"] == []
    assert owner.delete(f"/api/guestbook/{eb['id']}").status_code == 404  # already gone


def test_paging(make_user):
    owner = make_user("꾸미", "ggumi01")
    room = owner.me["room_id"]
    from app.db import SessionLocal
    from app.models import GuestbookEntry
    import uuid as _uuid
    from datetime import timedelta
    from app.db import utcnow

    with SessionLocal() as db:  # 25 notes at distinct times, without going through the limits
        for i in range(25):
            db.add(GuestbookEntry(room_id=_uuid.UUID(room), author_id=_uuid.UUID(owner.me["id"]), body=f"글 {i}", created_at=utcnow() - timedelta(minutes=25 - i)))
        db.commit()
    first = owner.get(f"/api/rooms/{room}/guestbook").json()
    assert [e["body"] for e in first["entries"]] == [f"글 {i}" for i in range(24, 4, -1)] and first["has_more"]
    rest = owner.get(f"/api/rooms/{room}/guestbook?before={first['entries'][-1]['id']}").json()
    assert [e["body"] for e in rest["entries"]] == [f"글 {i}" for i in range(4, -1, -1)] and not rest["has_more"]


def test_owner_can_close_the_guestbook(make_user):
    owner, friend = make_user("꾸미", "ggumi01"), make_user("토리", "tori01")
    befriend(owner, friend)
    room = owner.me["room_id"]
    note(friend, room, "안녕")
    assert friend.patch(f"/api/rooms/{room}", json={"guestbook_enabled": False}).status_code == 404  # only the owner
    assert owner.patch(f"/api/rooms/{room}", json={"guestbook_enabled": False}).json()["guestbook_enabled"] is False
    assert friend.get(f"/api/rooms/{room}/guestbook").json() == {"enabled": False, "entries": [], "has_more": False}
    assert note(friend, room, "닫혔나?").status_code == 403
    owner.patch(f"/api/rooms/{room}", json={"guestbook_enabled": True})
    assert [e["body"] for e in friend.get(f"/api/rooms/{room}/guestbook").json()["entries"]] == ["안녕"]  # kept while closed
