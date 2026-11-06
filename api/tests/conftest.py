"""Tests run against a real PostgreSQL (TEST_DATABASE_URL), migrated with Alembic.

Default: the throwaway dev container on 127.0.0.1:55432 (see docs/DEPLOY.md).
"""

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://ggumiroom:devpass@127.0.0.1:55432/ggumiroom_test")
os.environ["DATABASE_URL"] = TEST_DB
os.environ["PUBLIC_BASE_URL"] = "http://testserver"
os.environ["COOKIE_SECURE"] = "false"  # TestClient speaks plain http
os.environ["ENABLE_DOCS"] = "true"

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import ratelimit  # noqa: E402
from app.main import app  # noqa: E402

TABLES = "room_members, guestbook_entries, messages, conversations, room_items, room_guests, room_invitations, friendships, friend_requests, user_sessions, rooms, users"


@pytest.fixture(scope="session", autouse=True)
def database():
    admin_url = TEST_DB.rsplit("/", 1)[0] + "/postgres"
    name = TEST_DB.rsplit("/", 1)[1]
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        c.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean():
    from app.db import engine

    with engine.begin() as c:
        c.execute(text(f"TRUNCATE {TABLES} CASCADE"))
    ratelimit.reset()
    yield


class Api:
    """TestClient that behaves like the web app: keeps cookies and sends the CSRF header."""

    def __init__(self):
        self.c = TestClient(app)
        self.csrf = self.c.get("/api/auth/csrf").json()["csrf_token"]

    def _h(self, kw):
        kw.setdefault("headers", {})["X-CSRF-Token"] = self.csrf
        return kw

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, **kw):
        return self.c.post(url, **self._h(kw))

    def patch(self, url, **kw):
        return self.c.patch(url, **self._h(kw))

    def delete(self, url, **kw):
        return self.c.delete(url, **self._h(kw))

    def put(self, url, **kw):
        return self.c.put(url, **self._h(kw))

    def signup(self, nickname="꾸미", login_id="ggumi01", password="cozy-room-2026", confirm=None):
        return self.post(
            "/api/auth/signup",
            json={"nickname": nickname, "login_id": login_id, "password": password, "password_confirm": confirm or password},
        )


@pytest.fixture
def api():
    return Api()


@pytest.fixture
def make_user():
    def make(nickname, login_id):
        a = Api()
        r = a.signup(nickname=nickname, login_id=login_id)
        assert r.status_code == 201, r.text
        a.me = r.json()
        return a

    return make
