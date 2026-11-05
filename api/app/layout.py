"""Furniture layout rules, mirroring src/game/core/placement.ts.

Both read shared/furniture.json and are tested against the same cases in
shared/layout-cases.json, so the editor and the server always agree.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

EPS = 1e-9


def _catalog_path() -> Path:
    here = Path(__file__).resolve().parents[1]  # api/ (or /app in the image)
    for candidate in (here / "shared" / "furniture.json", here.parent / "shared" / "furniture.json"):
        if candidate.exists():
            return candidate
    raise FileNotFoundError("shared/furniture.json not found")


@lru_cache
def catalog() -> dict[str, Any]:
    return json.loads(_catalog_path().read_text(encoding="utf-8"))


def default_layout() -> list[dict[str, Any]]:
    return [dict(i) for i in catalog()["defaultLayout"]]


def _size(item_type: str, facing: int) -> tuple[float, float]:
    e = catalog()["items"][item_type]
    return (e["w"], e["h"]) if facing == 0 else (e["h"], e["w"])


def _circle_hits_rect(cx: float, cy: float, r: float, rect: tuple[float, float, float, float]) -> bool:
    x, y, w, h = rect
    nx = max(x, min(cx, x + w))
    ny = max(y, min(cy, y + h))
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r


def _overlaps(a: tuple, b: tuple) -> bool:
    return a[0] < b[0] + b[2] - EPS and b[0] < a[0] + a[2] - EPS and a[1] < b[1] + b[3] - EPS and b[1] < a[1] + a[3] - EPS


def _paths_ok(blocking: list[tuple]) -> bool:
    """Same flood fill as pathsConnected(): only tiny dead corners may be cut off."""
    c = catalog()
    grid, r = c["grid"], c["playerRadius"]
    width, height = c["room"]["width"], c["room"]["height"]
    cols, rows = round(width / grid), round(height / grid)
    free = [False] * (cols * rows)
    for row in range(rows):
        for col in range(cols):
            x, y = (col + 0.5) * grid, (row + 0.5) * grid
            if x - r < 0 or y - r < 0 or x + r > width or y + r > height:
                continue
            free[row * cols + col] = not any(_circle_hits_rect(x, y, r, b) for b in blocking)
    seen = [False] * len(free)
    sizes = []
    for i, ok in enumerate(free):
        if not ok or seen[i]:
            continue
        seen[i] = True
        stack, count = [i], 0
        while stack:
            j = stack.pop()
            count += 1
            col, row = j % cols, j // cols
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nc, nr = col + dc, row + dr
                if 0 <= nc < cols and 0 <= nr < rows:
                    k = nr * cols + nc
                    if free[k] and not seen[k]:
                        seen[k] = True
                        stack.append(k)
        sizes.append(count)
    if not sizes:
        return False
    sizes.sort(reverse=True)
    return all(n <= c["maxPocketCells"] for n in sizes[1:])


def validate(items: list[dict[str, Any]]) -> tuple[str, int | None] | None:
    """Returns (error code, item index or None) for the first problem, or None if valid."""
    c = catalog()
    width, height, grid = c["room"]["width"], c["room"]["height"], c["grid"]
    if len(items) > c["maxItems"]:
        return "too_many", None
    blocking: list[tuple] = []
    for index, it in enumerate(items):
        t = it.get("type")
        if t not in c["items"]:
            return "unknown_type", index
        facing = it.get("facing")
        if facing not in (0, 1) or isinstance(facing, bool):
            return "bad_facing", index
        x, y = it.get("x"), it.get("y")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v / grid - round(v / grid)) < EPS for v in (x, y)):
            return "off_grid", index
        w, h = _size(t, facing)
        if x < -EPS or y < -EPS or x + w > width + EPS or y + h > height + EPS:
            return "out_of_bounds", index
        if c["items"][t]["blocking"]:
            rect = (x, y, w, h)
            if any(_overlaps(b, rect) for b in blocking):
                return "overlap", index
            blocking.append(rect)
    if not _paths_ok(blocking):
        return "blocked_path", None
    return None


MESSAGES = {
    "too_many": f"가구는 {catalog()['maxItems']}개까지 놓을 수 있어요.",
    "unknown_type": "알 수 없는 가구가 있어요.",
    "bad_facing": "가구 방향이 올바르지 않아요.",
    "off_grid": "가구는 칸에 맞춰 놓아야 해요.",
    "out_of_bounds": "방 밖으로는 놓을 수 없어요.",
    "overlap": "다른 가구와 겹쳐요.",
    "blocked_path": "이렇게 놓으면 갈 수 없는 곳이 생겨요.",
}
