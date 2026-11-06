"""Room geometry for checking reported movement, mirroring src/game/core/collision.ts.

Characters are circles of `playerRadius`; the room is [0, width] x [0, height];
blocking furniture footprints (shared/furniture.json) are obstacles.
"""

import math
from dataclasses import dataclass
from typing import Any

from ..layout import _size, catalog, room_template

Rect = tuple[float, float, float, float]


def _circle_hits_rect(cx: float, cy: float, r: float, rect: Rect) -> bool:
    x, y, w, h = rect
    nx = max(x, min(cx, x + w))
    ny = max(y, min(cy, y + h))
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r


@dataclass(frozen=True)
class RoomGeometry:
    width: float
    height: float
    obstacles: tuple[Rect, ...]

    @classmethod
    def from_items(cls, items: list[dict[str, Any]], template: str = "personal") -> "RoomGeometry":
        c = catalog()
        size = room_template(template)
        rects = []
        for i in items:
            entry = c["items"].get(i["type"])
            if not entry or not entry["blocking"]:
                continue
            w, h = _size(i["type"], i["facing"])
            rects.append((float(i["x"]), float(i["y"]), w, h))
        return cls(size["width"], size["height"], tuple(rects))

    def is_free(self, x: float, y: float, r: float) -> bool:
        if not (math.isfinite(x) and math.isfinite(y)):
            return False
        if x - r < 0 or y - r < 0 or x + r > self.width or y + r > self.height:
            return False
        return not any(_circle_hits_rect(x, y, r, o) for o in self.obstacles)

    def segment_free(self, ax: float, ay: float, bx: float, by: float, r: float, step: float = 0.08) -> bool:
        """A circle can travel the straight line a -> b without passing through anything."""
        n = max(1, math.ceil(math.hypot(bx - ax, by - ay) / step))
        return all(self.is_free(ax + (bx - ax) * k / n, ay + (by - ay) * k / n, r) for k in range(n + 1))

    def nearest_free(self, x: float, y: float, r: float) -> tuple[float, float]:
        """The closest free 0.25-tile cell center to (x, y) (the spawn point if the room is somehow full)."""
        c = catalog()
        grid = c["grid"]
        best: tuple[float, float, float] | None = None
        for row in range(round(self.height / grid)):
            for col in range(round(self.width / grid)):
                cx, cy = (col + 0.5) * grid, (row + 0.5) * grid
                if self.is_free(cx, cy, r):
                    d = (cx - x) ** 2 + (cy - y) ** 2
                    if best is None or d < best[0]:
                        best = (d, cx, cy)
        if best is None:
            s = c["room"]["spawn"]  # a room with no free cell at all can't happen with valid layouts
            return float(s["x"]), float(s["y"])
        return best[1], best[2]
