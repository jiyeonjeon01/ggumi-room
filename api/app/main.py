import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .deps import csrf_protect
from .realtime import parties as party_lifecycle
from .realtime import ws as realtime
from .routers import auth, friends, guestbook, invites, messages, parties, rooms, safety

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Party rooms: recover closing times after a restart, then close the ones left empty.
    task = asyncio.create_task(party_lifecycle.run())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


# Every route lives under /api, matching the public path (nginx forwards it unchanged).
app = FastAPI(
    title="Ggumiroom API",
    docs_url="/api/docs" if settings.enable_docs else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.enable_docs else None,
    lifespan=lifespan,
)

api = APIRouter(prefix="/api", dependencies=[Depends(csrf_protect)])


@api.get("/health", tags=["meta"])
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}


for r in (auth.router, rooms.router, friends.router, invites.router, messages.router, guestbook.router, parties.router, safety.router):
    api.include_router(r)
app.include_router(api)
# WebSocket at /ws/live: checks Origin and the session cookie itself (see realtime/ws.py).
app.include_router(realtime.router)


@app.middleware("http")
async def no_store(request: Request, call_next):
    """API responses carry per-user data: never cache them (browser, nginx or Cloudflare)."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    # Uniform shape for the client: {"detail": str | {field, message} | {status, message}}.
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
