"""1:1 messages: permission, storage, idempotency, cleaning, paging, unread/read receipts, typing."""

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import Message
from tests.test_realtime import User, befriend, quiet, recv, tc  # noqa: F401  (fixture)


def send(u, friend, body, cid):
    return u.req("POST", f"/api/messages/with/{friend.id}", json={"body": body, "client_id": cid})


def count_messages():
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(Message))


def test_friends_can_message_and_both_sides_get_it_live(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with a.ws() as wa1, a.ws() as wa2, b.ws() as wb:
        for w in (wa1, wa2, wb):
            recv(w, "welcome")
        r = send(a, b, "안녕 토리야", "cid-0001")
        assert r.status_code == 201, r.text
        m = r.json()
        assert m["sender_id"] == a.id and m["recipient_id"] == b.id and m["body"] == "안녕 토리야" and m["seq"] > 0
        assert recv(wb, "dm.new")["message"]["id"] == m["id"]
        assert recv(wa2, "dm.new")["message"]["id"] == m["id"]  # my other tab stays in sync
        assert recv(wa1, "dm.new")["message"]["client_id"] == "cid-0001"  # the sending tab dedupes by client id


def test_strangers_cannot_message_or_read(tc):
    a, c = User(tc, "꾸미", "ggumi01"), User(tc, "남남", "stranger1")
    assert send(c, a, "hi", "cid-0002").status_code == 404
    assert c.req("GET", f"/api/messages/with/{a.id}").status_code == 404
    assert c.req("POST", f"/api/messages/with/{a.id}/read", json={"up_to_seq": 1}).status_code == 404
    assert send(a, a, "me", "cid-0003").status_code == 404  # not to myself
    assert count_messages() == 0


def test_retried_send_is_stored_once(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    first = send(a, b, "한 번만", "retry-123").json()
    again = send(a, b, "한 번만", "retry-123")
    assert again.status_code == 201 and again.json()["id"] == first["id"]
    assert count_messages() == 1
    assert send(a, b, "x", "bad id!").status_code == 422  # client ids are plain tokens


def test_body_is_plain_text_with_limits(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    m = send(a, b, "  <script>alert(1)</script>\r\n\n\n\n둘째 줄\u0007\u0000  ", "clean-001").json()
    # Stored as text exactly (the web app renders it as text, never HTML); controls gone, blank lines capped.
    assert m["body"] == "<script>alert(1)</script>\n\n둘째 줄"
    assert send(a, b, "가" * 500, "len-00500").status_code == 201
    r = send(a, b, "가" * 501, "len-00501")
    assert r.status_code == 422 and "500자" in r.json()["detail"]
    assert send(a, b, " \n\t ", "empty-001").status_code == 422
    assert send(a, b, "\n".join("줄" for _ in range(31)), "lines-031").status_code == 422


def test_history_pages_back_in_order(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    from app import ratelimit

    for i in range(35):
        ratelimit.reset()
        assert send(a if i % 2 == 0 else b, b if i % 2 == 0 else a, f"메시지 {i}", f"page-{i:04d}").status_code == 201
    page = b.req("GET", f"/api/messages/with/{a.id}?limit=30").json()
    assert [m["body"] for m in page["messages"]] == [f"메시지 {i}" for i in range(5, 35)] and page["has_more"]
    older = b.req("GET", f"/api/messages/with/{a.id}?limit=30&before={page['messages'][0]['seq']}").json()
    assert [m["body"] for m in older["messages"]] == [f"메시지 {i}" for i in range(5)] and not older["has_more"]


def test_unread_counts_and_read_receipts(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    with a.ws() as wa, b.ws() as wb1, b.ws() as wb2:
        for w in (wa, wb1, wb2):
            recv(w, "welcome")
        seqs = [send(a, b, f"{i}", f"unread-{i:03d}").json()["seq"] for i in range(3)]
        for w in (wa, wb1, wb2):
            for _ in range(3):
                recv(w, "dm.new")
        conv = b.req("GET", "/api/messages/conversations").json()
        assert [(c["friend"]["nickname"], c["unread"]) for c in conv] == [("꾸미", 3)]
        assert a.req("GET", "/api/messages/conversations").json()[0]["unread"] == 0  # my own messages aren't unread

        # B reads up to the 2nd message: A gets a receipt, B's other tab too.
        assert b.req("POST", f"/api/messages/with/{a.id}/read", json={"up_to_seq": seqs[1]}).status_code == 204
        r = recv(wa, "dm.read")
        assert (r["reader"], r["peer"], r["seq"]) == (b.id, a.id, seqs[1])
        assert recv(wb2, "dm.read")["seq"] == seqs[1]
        assert b.req("GET", "/api/messages/conversations").json()[0]["unread"] == 1
        # Never backwards, never past the last message.
        b.req("POST", f"/api/messages/with/{a.id}/read", json={"up_to_seq": seqs[0]})
        quiet(wa)
        b.req("POST", f"/api/messages/with/{a.id}/read", json={"up_to_seq": 10**9})
        assert recv(wa, "dm.read")["seq"] == seqs[2]
        hist = a.req("GET", f"/api/messages/with/{b.id}").json()
        assert hist["peer_read_seq"] == seqs[2]


def test_offline_friend_finds_messages_later_newest_chat_first(tc):
    a, b, c = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01"), User(tc, "새롬", "saerom01")
    befriend(a, b)
    befriend(a, c)
    send(b, a, "먼저 보냄", "order-001")  # nobody connected: stored anyway
    send(c, a, "나중에 보냄", "order-002")
    conv = a.req("GET", "/api/messages/conversations").json()
    assert [c_["friend"]["nickname"] for c_ in conv] == ["새롬", "토리"]
    assert conv[0]["last_message"]["body"] == "나중에 보냄"


def test_typing_goes_to_the_friend_only_and_is_limited(tc):
    a, b, c = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01"), User(tc, "남남", "stranger1")
    befriend(a, b)
    with a.ws() as wa, b.ws() as wb, c.ws() as wc:
        for w in (wa, wb, wc):
            recv(w, "welcome")
        wa.send_json({"t": "dm.typing", "to": b.id, "on": True, "text": "secret draft"})
        t = recv(wb, "dm.typing")
        assert t == {"t": "dm.typing", "from": a.id, "on": True}  # no text is relayed
        wa.send_json({"t": "dm.typing", "to": c.id, "on": True})  # not a friend
        wc.send_json({"t": "dm.typing", "to": b.id, "on": True})  # not a friend either
        quiet(wc)
        quiet(wb)
        for _ in range(30):  # flood: at most 20 per 10 s get through
            wa.send_json({"t": "dm.typing", "to": b.id, "on": False})
        wa.send_json({"t": "ping"})
        while (m := wa.receive_json())["t"] != "pong":
            assert m["t"] == "presence"  # (B coming online is fine; nothing else)
        got = 0
        wb.send_json({"t": "ping"})
        while (m := wb.receive_json())["t"] != "pong":
            got += m["t"] == "dm.typing"
        assert got <= 19


def test_sending_too_fast_is_limited(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    codes = [send(a, b, f"{i}", f"flood-{i:03d}").status_code for i in range(12)]
    assert codes[:10] == [201] * 10 and codes[10] == 429


def test_unfriended_chat_is_closed(tc):
    a, b = User(tc, "꾸미", "ggumi01"), User(tc, "토리", "tori01")
    befriend(a, b)
    send(a, b, "안녕", "bye-0001")
    assert a.req("DELETE", f"/api/friends/{b.id}").status_code == 204
    assert send(a, b, "또 안녕", "bye-0002").status_code == 404
    assert b.req("GET", f"/api/messages/with/{a.id}").status_code == 404
    assert b.req("GET", "/api/messages/conversations").json() == []
