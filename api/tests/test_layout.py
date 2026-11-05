import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.db import SessionLocal, engine
from app.layout import default_layout, validate
from tests.conftest import Api

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "shared" / "layout-cases.json").read_text(encoding="utf-8"))["cases"]


def case_items(spec):
    if spec == "default":
        return default_layout()
    if isinstance(spec, str) and spec.startswith("many:"):
        return [{"type": "cushion", "x": 0, "y": 0, "facing": 0}] * int(spec[5:])
    return spec


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_layout_cases(case):
    """Same cases as the web app's placement tests: both sides must agree."""
    problem = validate(case_items(case["items"]))
    assert (problem[0] if problem else None) == case["error"]


def layout_of(room):
    return [{k: i[k] for k in ("type", "x", "y", "facing")} for i in room["items"]]


def test_signup_room_gets_default_layout(make_user):
    a = make_user("꾸미", "user_a")
    room = a.get("/api/rooms/me").json()
    assert layout_of(room) == default_layout()
    assert room["layout_version"] == 0


def test_save_layout_and_reload(make_user):
    a = make_user("꾸미", "user_a")
    room = a.get("/api/rooms/me").json()
    items = layout_of(room)
    items[7] = {"type": "table", "x": 2.5, "y": 4.5, "facing": 0}  # move the table
    items.append({"type": "chair", "x": 6.75, "y": 1.25, "facing": 1})
    r = a.c.put(f"/api/rooms/{room['id']}/items", json={"layout_version": 0, "items": items}, headers={"X-CSRF-Token": a.csrf})
    assert r.status_code == 200, r.text
    assert r.json()["layout_version"] == 1
    again = a.get("/api/rooms/me").json()
    assert layout_of(again) == items  # same order, values, facing
    with SessionLocal() as db:
        assert db.scalar(text("SELECT count(*) FROM room_items")) == len(items)


def put(api, room_id, version, items):
    return api.c.put(f"/api/rooms/{room_id}/items", json={"layout_version": version, "items": items}, headers={"X-CSRF-Token": api.csrf})


def test_version_conflict_409(make_user):
    a = make_user("꾸미", "user_a")
    rid = a.me["room_id"]
    base = default_layout()
    assert put(a, rid, 0, base[:-1]).status_code == 200  # first editor saves -> version 1
    stale = put(a, rid, 0, base)  # second editor still on version 0
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "layout_conflict" and stale.json()["detail"]["layout_version"] == 1
    assert len(a.get("/api/rooms/me").json()["items"]) == len(base) - 1  # nothing overwritten


@pytest.mark.parametrize(
    "items,code",
    [
        ([{"type": "piano", "x": 1, "y": 1, "facing": 0}], "unknown_type"),
        ([{"type": "chair", "x": 1.1, "y": 1, "facing": 0}], "off_grid"),
        ([{"type": "desk", "x": 8, "y": 0, "facing": 0}], "out_of_bounds"),
        ([{"type": "chair", "x": 1, "y": 1, "facing": 3}], "bad_facing"),
        ([{"type": "bed", "x": 0, "y": 0, "facing": 0}, {"type": "bed", "x": 1, "y": 1, "facing": 0}], "overlap"),
        ([{"type": "bed", "x": x, "y": 3, "facing": 0} for x in (0, 3, 6)], "blocked_path"),
        ([{"type": "cushion", "x": 0, "y": 0, "facing": 0}] * 41, "too_many"),
    ],
)
def test_server_rejects_invalid_layouts(make_user, items, code):
    a = make_user("꾸미", "user_a")
    r = put(a, a.me["room_id"], 0, items)
    assert r.status_code == 422 and r.json()["detail"]["code"] == code, r.text
    assert r.json()["detail"]["message"]
    assert a.get("/api/rooms/me").json()["layout_version"] == 0  # unchanged


def test_only_owner_can_save_and_visitors_see_layout(make_user):
    a = make_user("꾸미", "user_a")
    b = make_user("토리", "user_b")
    rid = a.me["room_id"]
    assert put(b, rid, 0, []).status_code == 404  # not the owner
    stranger = Api()
    assert put(stranger, rid, 0, []).status_code == 401
    # Make b a friend so they may visit, then check they see a's saved layout.
    req = a.post("/api/friends/requests", json={"user_id": b.me["id"]}).json()["request_id"]
    b.post(f"/api/friends/requests/{req}/accept")
    assert put(a, rid, 0, default_layout()[:3]).status_code == 200
    seen = b.get(f"/api/rooms/{rid}").json()
    assert layout_of(seen) == default_layout()[:3]


def test_payload_without_csrf_rejected(make_user):
    a = make_user("꾸미", "user_a")
    r = a.c.put(f"/api/rooms/{a.me['room_id']}/items", json={"layout_version": 0, "items": []})
    assert r.status_code == 403


def test_migration_seeds_existing_rooms_with_the_same_default():
    """Rooms created before room_items existed get exactly the catalog default."""
    cfg = Config(str(ROOT / "api" / "alembic.ini"))
    command.downgrade(cfg, "2ac5ad711c49")
    try:
        with engine.begin() as c:
            uid = c.execute(
                text("INSERT INTO users (id, login_id, nickname, password_hash) VALUES (gen_random_uuid(), 'old_user', '예전', 'x') RETURNING id")
            ).scalar()
            c.execute(text("INSERT INTO rooms (id, owner_id, name) VALUES (gen_random_uuid(), :u, '예전의 방')"), {"u": uid})
    finally:
        command.upgrade(cfg, "head")
    with engine.begin() as c:
        rows = c.execute(text("SELECT item_type, x_q, y_q, facing FROM room_items ORDER BY position")).all()
        version = c.execute(text("SELECT layout_version FROM rooms")).scalar()
    assert [{"type": t, "x": x / 4, "y": y / 4, "facing": f} for t, x, y, f in rows] == default_layout()
    assert version == 0
