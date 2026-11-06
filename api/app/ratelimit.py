"""In-memory sliding-window rate limiter.

Good for a single API process (the current deployment runs one uvicorn
worker). With several workers or servers, move this to Redis or the DB.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status

from .config import get_settings

_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def hit(key: str, limit: int, window_s: float) -> None:
    """Records one attempt for `key`; raises 429 once `limit` is exceeded within `window_s`."""
    if not get_settings().rate_limit_enabled:
        return
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        while q and q[0] <= now - window_s:
            q.popleft()
        if len(q) >= limit:
            retry = int(q[0] + window_s - now) + 1
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail="요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
                headers={"Retry-After": str(retry)},
            )
        q.append(now)


def clear(key: str) -> None:
    with _lock:
        _hits.pop(key, None)


def reset() -> None:
    """Tests only."""
    with _lock:
        _hits.clear()


def allow(key: str, limit: int, window_s: float) -> bool:
    """Like hit() but returns False instead of raising (WebSocket handshakes can't use HTTP errors)."""
    try:
        hit(key, limit, window_s)
    except HTTPException:
        return False
    return True
