"""Database schema. All ids are random UUIDs; all times are UTC (timestamptz)."""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Identity,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, utcnow

THEMES = ("pastel", "galaxy", "plant")


def _id() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _id()
    # Login identifier: stored normalized (lowercase), unique. Never shown to other users.
    login_id: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    # Display name on the character's name tag. Not unique.
    nickname: Mapped[str] = mapped_column(String(12), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow, server_default=func.now()
    )
    # For a future "change nickname" page (e.g. rate-limit changes).
    nickname_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("status IN ('active', 'disabled')", name="users_status_check"),
        Index("users_nickname_lower_idx", func.lower(nickname)),
    )


class UserSession(Base):
    """Server-side login session. The cookie holds a random token; only its SHA-256 is stored."""

    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = _created()
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[uuid.UUID] = _id()
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(30), nullable=False)
    theme: Mapped[str] = mapped_column(String(16), nullable=False, default="pastel", server_default="pastel")
    # Who may enter: owner, friends, and users who accepted an invite (room_guests).
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="friends", server_default="friends")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    # Bumped on every saved furniture layout; a save must name the version it
    # started from, so two editors can't silently overwrite each other.
    layout_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(f"theme IN {THEMES}", name="rooms_theme_check"),
        CheckConstraint("visibility IN ('friends')", name="rooms_visibility_check"),
        # One default room per user.
        Index("rooms_one_default_per_owner", "owner_id", unique=True, postgresql_where=text("is_default")),
    )


class RoomItem(Base):
    """A piece of furniture placed in a room. Types come from the free catalog
    (shared/furniture.json); removing one from a room loses nothing, it can be
    added again. Coordinates are stored in quarter tiles so they are always on
    the 0.25 grid."""

    __tablename__ = "room_items"

    id: Mapped[uuid.UUID] = _id()
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    item_type: Mapped[str] = mapped_column(String(32), nullable=False)
    x_q: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    y_q: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    facing: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, server_default="0")
    # Drawing/saving order within the room (rugs first, as placed).
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = _created()

    __table_args__ = (
        CheckConstraint("facing IN (0, 1)", name="room_items_facing_check"),
        CheckConstraint("x_q >= 0 AND y_q >= 0", name="room_items_non_negative"),
    )


class FriendRequest(Base):
    __tablename__ = "friend_requests"

    id: Mapped[uuid.UUID] = _id()
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    addressee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    created_at: Mapped[datetime] = _created()
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("requester_id <> addressee_id", name="friend_requests_not_self"),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'declined', 'cancelled')", name="friend_requests_status_check"
        ),
        # At most one pending request per pair, in either direction (also guards concurrent requests).
        Index(
            "friend_requests_one_pending_per_pair",
            func.least(requester_id, addressee_id),
            func.greatest(requester_id, addressee_id),
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
    )


class Friendship(Base):
    """Mutual friendship, stored once per pair with user_a_id < user_b_id."""

    __tablename__ = "friendships"

    user_a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    user_b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    created_at: Mapped[datetime] = _created()

    __table_args__ = (CheckConstraint("user_a_id < user_b_id", name="friendships_ordered_pair"),)


class RoomInvitation(Base):
    """A shareable link to a room. The token is a random capability, unrelated to sessions or ids."""

    __tablename__ = "room_invitations"

    id: Mapped[uuid.UUID] = _id()
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        # One live (not revoked) link per room; older ones are revoked when a new one is made.
        Index("room_invitations_one_live_per_room", "room_id", unique=True, postgresql_where=text("revoked_at IS NULL")),
    )


class RoomGuest(Base):
    """A user who entered a room through a valid invite. Grants visiting, not friendship."""

    __tablename__ = "room_guests"

    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    invitation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("room_invitations.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created()


class Conversation(Base):
    """A 1:1 chat between two users, stored once per pair with user_a_id < user_b_id.

    Read state is kept per side as the highest message seq that side has seen.
    """

    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = _id()
    user_a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    user_b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = _created()
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    a_read_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    b_read_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")

    __table_args__ = (
        CheckConstraint("user_a_id < user_b_id", name="conversations_ordered_pair"),
        Index("conversations_pair", "user_a_id", "user_b_id", unique=True),
    )


class Message(Base):
    """One chat message. `seq` orders messages (and read receipts) across the whole table."""

    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = _id()
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True), nullable=False, unique=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Random id from the sending client, so a retried send doesn't store the message twice.
    client_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = _created()

    __table_args__ = (
        CheckConstraint("char_length(body) BETWEEN 1 AND 500", name="messages_body_length"),
        Index("messages_conversation_seq", "conversation_id", "seq"),
        Index("messages_sender_client", "sender_id", "client_id", unique=True),
    )
