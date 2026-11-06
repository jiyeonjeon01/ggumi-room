"""Room guestbook: short notes visitors leave in a personal room.

Only people who may enter the room (owner, friends, invited guests) can read
or write; the author and the room owner can delete (hidden, not erased).
Bodies are plain text (the web app renders text, never HTML) and never logged.
"""

import re
import unicodedata
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import ratelimit
from ..access import room_access
from ..db import get_db, utcnow
from ..deps import current_user
from ..models import GuestbookEntry, Room, User

router = APIRouter(tags=["guestbook"])

MAX_CHARS = 100
MAX_LINES = 3
PAGE = 20
# Per author: one note every 30 s, 10 an hour (rate limiter), 5 a day in the same room (DB),
# and not the same text in the same room within 10 minutes.
PER_ROOM_PER_DAY = 5
DUPLICATE_WINDOW = timedelta(minutes=10)


class EntryIn(BaseModel):
    body: str = Field(max_length=1000)


class EntryAuthor(BaseModel):
    id: uuid.UUID
    nickname: str


class EntryOut(BaseModel):
    id: uuid.UUID
    author: EntryAuthor
    body: str
    created_at: datetime
    can_delete: bool


class GuestbookOut(BaseModel):
    enabled: bool
    entries: list[EntryOut]
    has_more: bool


def clean_note(raw: str) -> str:
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch == "\n" or unicodedata.category(ch) != "Cc")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text).strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="남길 말을 적어 주세요.")
    if len(text) > MAX_CHARS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"방명록은 {MAX_CHARS}자까지 쓸 수 있어요.")
    if text.count("\n") >= MAX_LINES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"방명록은 {MAX_LINES}줄까지 쓸 수 있어요.")
    return text


def _room(db: Session, room_id: uuid.UUID, user: User) -> Room:
    """The personal room, if the user may be in it (same 404 for missing and not allowed)."""
    room = db.get(Room, room_id)
    if not room or getattr(room, "kind", "personal") != "personal" or room_access(db, room, user) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="방을 찾을 수 없거나 들어갈 수 없어요.")
    return room


def _out(e: GuestbookEntry, author: User, room: Room, viewer: User) -> EntryOut:
    return EntryOut(
        id=e.id,
        author=EntryAuthor(id=author.id, nickname=author.nickname),
        body=e.body,
        created_at=e.created_at,
        can_delete=viewer.id in (e.author_id, room.owner_id),
    )


@router.get("/rooms/{room_id}/guestbook", response_model=GuestbookOut)
def read(
    room_id: uuid.UUID,
    before: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=PAGE, ge=1, le=50),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> GuestbookOut:
    """Newest first, `limit` at a time going back from the entry `before`."""
    room = _room(db, room_id, user)
    if not room.guestbook_enabled:
        return GuestbookOut(enabled=False, entries=[], has_more=False)
    q = (
        select(GuestbookEntry, User)
        .join(User, User.id == GuestbookEntry.author_id)
        .where(GuestbookEntry.room_id == room.id, GuestbookEntry.deleted_at.is_(None))
    )
    if before is not None:
        anchor = db.get(GuestbookEntry, before)
        if anchor and anchor.room_id == room.id:
            q = q.where((GuestbookEntry.created_at, GuestbookEntry.id) < (anchor.created_at, anchor.id))
    rows = db.execute(q.order_by(GuestbookEntry.created_at.desc(), GuestbookEntry.id.desc()).limit(limit + 1)).all()
    return GuestbookOut(enabled=True, entries=[_out(e, a, room, user) for e, a in rows[:limit]], has_more=len(rows) > limit)


@router.post("/rooms/{room_id}/guestbook", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
def write(room_id: uuid.UUID, body: EntryIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> EntryOut:
    room = _room(db, room_id, user)
    if not room.guestbook_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="방 주인이 방명록을 닫아 두었어요.")
    text = clean_note(body.body)
    if not ratelimit.allow(f"guestbook-burst:{user.id}", 1, 30):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="조금만 천천히 남겨 주세요. (30초에 한 번)")
    if not ratelimit.allow(f"guestbook-hour:{user.id}", 10, 3600):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="오늘은 방명록을 많이 남겼어요. 잠시 쉬었다 남겨 주세요.")
    now = utcnow()
    mine = select(GuestbookEntry).where(GuestbookEntry.room_id == room.id, GuestbookEntry.author_id == user.id)
    today = db.scalar(select(func.count()).select_from(mine.where(GuestbookEntry.created_at > now - timedelta(days=1)).subquery())) or 0
    if today >= PER_ROOM_PER_DAY:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="이 방에는 오늘 충분히 남겼어요. 내일 또 남겨 주세요!")
    dup = db.scalar(mine.where(GuestbookEntry.body == text, GuestbookEntry.created_at > now - DUPLICATE_WINDOW, GuestbookEntry.deleted_at.is_(None)).limit(1))
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="방금 같은 글을 남겼어요.")
    entry = GuestbookEntry(room_id=room.id, author_id=user.id, body=text)
    db.add(entry)
    db.commit()
    return _out(entry, user, room, user)


@router.delete("/guestbook/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(entry_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    entry = db.get(GuestbookEntry, entry_id)
    room = db.get(Room, entry.room_id) if entry else None
    # Only the author and the room owner; anyone else gets the same 404 as a missing note.
    if not entry or entry.deleted_at is not None or not room or user.id not in (entry.author_id, room.owner_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="글을 찾을 수 없거나 지울 수 없어요.")
    entry.deleted_at = utcnow()
    entry.deleted_by = user.id
    db.commit()
