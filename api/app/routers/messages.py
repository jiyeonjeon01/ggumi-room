"""1:1 messages between friends.

Sending goes over HTTP (session + CSRF like every other write) and is
idempotent per client-generated `client_id`; the realtime connection then
delivers it to both people's open tabs. Read receipts are a per-side "read up
to seq" stored on the conversation. Message bodies are never logged.
"""

import re
import unicodedata
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import ratelimit
from ..access import are_friends, pair
from ..db import get_db, utcnow
from ..deps import current_user
from ..models import Conversation, Message, User
from ..realtime.hub import hub, notify
from ..schemas import PublicUserOut

router = APIRouter(prefix="/messages", tags=["messages"])

MAX_CHARS = 500
MAX_LINES = 30
PAGE = 30


class MessageIn(BaseModel):
    body: str = Field(max_length=4000)
    client_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class ReadIn(BaseModel):
    up_to_seq: int = Field(ge=0)


class MessageOut(BaseModel):
    id: uuid.UUID
    seq: int
    sender_id: uuid.UUID
    recipient_id: uuid.UUID
    body: str
    client_id: str
    created_at: datetime


class HistoryOut(BaseModel):
    messages: list[MessageOut]
    has_more: bool
    my_read_seq: int
    peer_read_seq: int


class ConversationOut(BaseModel):
    friend: PublicUserOut
    last_message: MessageOut | None
    unread: int
    peer_read_seq: int


def clean_body(raw: str) -> str:
    """Plain text: control characters dropped (newlines kept), at most 2 blank lines in a row, trimmed."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch == "\n" or unicodedata.category(ch) != "Cc")
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="보낼 내용을 적어 주세요.")
    if len(text) > MAX_CHARS:  # code points, so a Korean syllable counts as one
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"메시지는 {MAX_CHARS}자까지 보낼 수 있어요.")
    if text.count("\n") >= MAX_LINES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"메시지는 {MAX_LINES}줄까지 보낼 수 있어요.")
    return text


def _friend(db: Session, user: User, friend_id: uuid.UUID) -> User:
    friend = db.get(User, friend_id)
    if not friend or friend.id == user.id or not are_friends(db, user.id, friend.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="친구와만 대화할 수 있어요.")
    return friend


def _conversation(db: Session, a: uuid.UUID, b: uuid.UUID, create: bool = False) -> Conversation | None:
    x, y = pair(a, b)
    if create:
        db.execute(insert(Conversation).values(id=uuid.uuid4(), user_a_id=x, user_b_id=y).on_conflict_do_nothing(index_elements=["user_a_id", "user_b_id"]))
    return db.scalar(select(Conversation).where(Conversation.user_a_id == x, Conversation.user_b_id == y))


def _read_seqs(conv: Conversation | None, me: uuid.UUID) -> tuple[int, int]:
    """(mine, theirs)"""
    if conv is None:
        return 0, 0
    return (conv.a_read_seq, conv.b_read_seq) if conv.user_a_id == me else (conv.b_read_seq, conv.a_read_seq)


def _out(m: Message, conv: Conversation) -> MessageOut:
    recipient = conv.user_b_id if m.sender_id == conv.user_a_id else conv.user_a_id
    return MessageOut(id=m.id, seq=m.seq, sender_id=m.sender_id, recipient_id=recipient, body=m.body, client_id=m.client_id, created_at=m.created_at)


def _public(u: User) -> PublicUserOut:
    return PublicUserOut(id=u.id, nickname=u.nickname, joined_at=u.created_at)


@router.get("/conversations", response_model=list[ConversationOut])
def conversations(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[ConversationOut]:
    """My chats with current friends, newest message first."""
    convs = db.scalars(
        select(Conversation)
        .where(or_(Conversation.user_a_id == user.id, Conversation.user_b_id == user.id), Conversation.last_message_at.is_not(None))
        .order_by(Conversation.last_message_at.desc())
    ).all()
    out = []
    for c in convs:
        peer_id = c.user_b_id if c.user_a_id == user.id else c.user_a_id
        if not are_friends(db, user.id, peer_id):
            continue
        peer = db.get(User, peer_id)
        mine, theirs = _read_seqs(c, user.id)
        last = db.scalar(select(Message).where(Message.conversation_id == c.id).order_by(Message.seq.desc()).limit(1))
        unread = db.scalar(select(func.count()).select_from(Message).where(Message.conversation_id == c.id, Message.sender_id != user.id, Message.seq > mine)) or 0
        out.append(ConversationOut(friend=_public(peer), last_message=_out(last, c) if last else None, unread=unread, peer_read_seq=theirs))
    return out


@router.get("/with/{friend_id}", response_model=HistoryOut)
def history(
    friend_id: uuid.UUID,
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=PAGE, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> HistoryOut:
    """Messages with a friend, oldest first, `limit` at a time going back from `before` (a seq)."""
    friend = _friend(db, user, friend_id)
    conv = _conversation(db, user.id, friend.id)
    mine, theirs = _read_seqs(conv, user.id)
    if conv is None:
        return HistoryOut(messages=[], has_more=False, my_read_seq=0, peer_read_seq=0)
    q = select(Message).where(Message.conversation_id == conv.id)
    if before is not None:
        q = q.where(Message.seq < before)
    rows = db.scalars(q.order_by(Message.seq.desc()).limit(limit + 1)).all()
    return HistoryOut(messages=[_out(m, conv) for m in reversed(rows[:limit])], has_more=len(rows) > limit, my_read_seq=mine, peer_read_seq=theirs)


@router.post("/with/{friend_id}", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send(friend_id: uuid.UUID, body: MessageIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> MessageOut:
    ratelimit.hit(f"dm-burst:{user.id}", 10, 10)
    ratelimit.hit(f"dm-hour:{user.id}", 300, 3600)
    text = clean_body(body.body)
    friend = _friend(db, user, friend_id)
    # Retried send (same client id): return what was stored the first time.
    existing = db.scalar(select(Message).where(Message.sender_id == user.id, Message.client_id == body.client_id))
    if existing:
        conv = db.get(Conversation, existing.conversation_id)
        return _out(existing, conv)
    conv = _conversation(db, user.id, friend.id, create=True)
    msg = Message(conversation_id=conv.id, sender_id=user.id, body=text, client_id=body.client_id)
    db.add(msg)
    conv.last_message_at = utcnow()
    # Sending means I've seen everything before it.
    try:
        db.flush()
    except IntegrityError:  # the same client id raced in from another request
        db.rollback()
        existing = db.scalar(select(Message).where(Message.sender_id == user.id, Message.client_id == body.client_id))
        return _out(existing, db.get(Conversation, existing.conversation_id))
    if conv.user_a_id == user.id:
        conv.a_read_seq = max(conv.a_read_seq, msg.seq)
    else:
        conv.b_read_seq = max(conv.b_read_seq, msg.seq)
    db.commit()
    out = _out(msg, conv)
    notify(hub.dm_new, [user.id, friend.id], out.model_dump(mode="json"))
    return out


@router.post("/with/{friend_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(friend_id: uuid.UUID, body: ReadIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    """I've seen the friend's messages up to `up_to_seq` (the client only says so while the chat is really on screen)."""
    ratelimit.hit(f"dm-read:{user.id}", 120, 60)
    friend = _friend(db, user, friend_id)
    conv = _conversation(db, user.id, friend.id)
    if conv is None:
        return
    latest = db.scalar(select(func.max(Message.seq)).where(Message.conversation_id == conv.id)) or 0
    target = min(body.up_to_seq, latest)
    side = "a_read_seq" if conv.user_a_id == user.id else "b_read_seq"
    if target <= getattr(conv, side):
        return
    setattr(conv, side, target)
    db.commit()
    notify(hub.dm_read, user.id, friend.id, target)
