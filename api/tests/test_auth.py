from sqlalchemy import select, text

from app.db import SessionLocal
from app.models import Room, User, UserSession
from tests.conftest import Api


def test_health(api):
    assert api.get("/api/health").json() == {"status": "ok", "db": "ok"}


def test_signup_creates_user_room_and_session(api):
    r = api.signup(nickname="  꾸미  ", login_id="GgumI_01")
    assert r.status_code == 201, r.text
    me = r.json()
    assert me["nickname"] == "꾸미"  # trimmed
    assert me["login_id"] == "ggumi_01"  # normalized to lowercase
    assert me["room_id"]
    # Logged in right away; cookie is HttpOnly + SameSite=Lax.
    cookie = r.headers.get_list("set-cookie")
    session_cookie = next(c for c in cookie if c.startswith("ggumi_session="))
    assert "HttpOnly" in session_cookie and "SameSite=lax" in session_cookie
    assert api.get("/api/auth/me").json()["id"] == me["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User))
        room = db.scalar(select(Room))
        assert room.owner_id == user.id and room.is_default and room.theme == "pastel" and room.name == "꾸미의 방"
        # Password and session token are never stored in plain text.
        assert user.password_hash.startswith("$argon2id$") and "cozy-room-2026" not in user.password_hash
        token = api.c.cookies.get("ggumi_session")
        assert db.scalar(select(UserSession.token_hash)) != token and len(db.scalar(select(UserSession.token_hash))) == 64


def test_duplicate_login_id_rejected_case_insensitively(api):
    assert api.signup(login_id="ggumi01").status_code == 201
    other = Api()
    r = other.signup(nickname="다른꾸미", login_id="GGUMI01")
    assert r.status_code == 422 and r.json()["detail"]["field"] == "login_id"
    check = other.get("/api/auth/check-login-id", params={"login_id": "Ggumi01"}).json()
    assert check["available"] is False
    assert other.get("/api/auth/check-login-id", params={"login_id": "fresh_id"}).json()["available"] is True
    assert other.get("/api/auth/check-login-id", params={"login_id": "no"}).json()["available"] is False


def test_password_confirm_mismatch(api):
    r = api.signup(password="cozy-room-2026", confirm="cozy-room-2027")
    assert r.status_code == 422 and r.json()["detail"]["field"] == "password_confirm"
    with SessionLocal() as db:
        assert db.scalar(select(User)) is None


def test_password_rules(api):
    for bad in ["short1", "password123", "aaaaaaaaaa", "myggumi01pass"]:
        r = api.signup(login_id="ggumi01", password=bad)
        assert r.status_code == 422 and r.json()["detail"]["field"] == "password", bad
    assert api.signup(password="x" * 129).status_code == 422


def test_nickname_rules(api):
    for bad in ["꾸", "a" * 13, "꾸미!", "꾸 미", "관리자꾸미", "<b>hi</b>", "ㄱㄴㄷ"]:
        r = api.signup(nickname=bad)
        assert r.status_code == 422 and r.json()["detail"]["field"] == "nickname", bad
    assert api.signup(nickname="Ggumi12").status_code == 201


def test_login_logout_and_failure_messages(api):
    api.signup()
    api.post("/api/auth/logout")
    assert api.get("/api/auth/me").status_code == 401
    wrong_pw = api.post("/api/auth/login", json={"login_id": "ggumi01", "password": "wrong-password"})
    no_user = api.post("/api/auth/login", json={"login_id": "nobody99", "password": "wrong-password"})
    # Same status and message whether or not the id exists.
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json()
    ok = api.post("/api/auth/login", json={"login_id": "GGUMI01", "password": "cozy-room-2026"})
    assert ok.status_code == 200 and ok.json()["nickname"] == "꾸미"
    assert api.get("/api/auth/me").status_code == 200


def test_session_survives_new_client_and_logout_invalidates(api):
    api.signup()
    token = api.c.cookies.get("ggumi_session")
    # "Refresh": a brand-new client with only the cookie is still logged in.
    fresh = Api()
    fresh.c.cookies.set("ggumi_session", token)
    assert fresh.get("/api/auth/me").status_code == 200
    api.post("/api/auth/logout")
    # The old token no longer works anywhere (server-side session deleted).
    assert fresh.get("/api/auth/me").status_code == 401


def test_login_rotates_session(api):
    api.signup()
    old = api.c.cookies.get("ggumi_session")
    api.post("/api/auth/login", json={"login_id": "ggumi01", "password": "cozy-room-2026"})
    assert api.c.cookies.get("ggumi_session") != old
    with SessionLocal() as db:
        assert db.scalar(text("SELECT count(*) FROM user_sessions")) == 1


def test_expired_session_rejected(api):
    api.signup()
    with SessionLocal() as db:
        db.execute(text("UPDATE user_sessions SET expires_at = now() - interval '1 minute'"))
        db.commit()
    assert api.get("/api/auth/me").status_code == 401


def test_protected_endpoints_require_login():
    a = Api()
    for method, url in [
        ("get", "/api/auth/me"),
        ("get", "/api/rooms/me"),
        ("get", "/api/friends"),
        ("get", "/api/friends/requests"),
        ("get", "/api/friends/search?q=a"),
        ("post", "/api/rooms/me/invite"),
        ("post", "/api/friends/requests"),
    ]:
        r = getattr(a, method)(url, **({"json": {"user_id": "00000000-0000-0000-0000-000000000000"}} if method == "post" else {}))
        assert r.status_code == 401, (url, r.status_code)


def test_csrf_required_for_unsafe_requests(api):
    body = {"nickname": "꾸미", "login_id": "ggumi01", "password": "cozy-room-2026", "password_confirm": "cozy-room-2026"}
    assert api.c.post("/api/auth/signup", json=body).status_code == 403  # no header
    assert api.c.post("/api/auth/signup", json=body, headers={"X-CSRF-Token": "forged-value-123456789"}).status_code == 403
    cross = api.c.post("/api/auth/signup", json=body, headers={"X-CSRF-Token": api.csrf, "Origin": "https://evil.example"})
    assert cross.status_code == 403
    assert api.post("/api/auth/signup", json=body, headers={"Origin": "http://testserver"}).status_code == 201


def test_login_rate_limited(api):
    api.signup()
    codes = [api.post("/api/auth/login", json={"login_id": "ggumi01", "password": "nope-nope"}).status_code for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429
    # Even the right password waits until the window passes.
    assert api.post("/api/auth/login", json={"login_id": "ggumi01", "password": "cozy-room-2026"}).status_code == 429


def test_api_responses_not_cacheable(api):
    assert api.get("/api/health").headers["cache-control"] == "no-store"


def test_secure_cookie_flag_when_enabled(monkeypatch, api):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "cookie_secure", True)
    r = api.signup()
    assert all("Secure" in c for c in r.headers.get_list("set-cookie") if c.startswith(("ggumi_session=", "ggumi_csrf=")))


def test_openapi_under_api_prefix(api):
    spec = api.get("/api/openapi.json").json()
    assert "/api/auth/signup" in spec["paths"] and "/api/invites/{token}" in spec["paths"]
