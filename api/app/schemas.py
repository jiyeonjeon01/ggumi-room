"""Request/response bodies. Responses never include login ids of other users,
password hashes, session data or invite tokens of other users."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Theme = Literal["pastel", "galaxy", "plant"]
Relation = Literal["none", "friend", "outgoing", "incoming"]


class SignupIn(BaseModel):
    nickname: str = Field(max_length=64)
    login_id: str = Field(max_length=64)
    password: str = Field(max_length=256)
    password_confirm: str = Field(max_length=256)


class LoginIn(BaseModel):
    login_id: str = Field(max_length=64)
    password: str = Field(max_length=256)


class LoginIdCheckOut(BaseModel):
    available: bool
    message: str


class RoomItemIn(BaseModel):
    type: str = Field(max_length=32)
    x: float
    y: float
    facing: int


class RoomItemOut(BaseModel):
    type: str
    x: float
    y: float
    facing: int


class LayoutIn(BaseModel):
    """A whole new layout. `layout_version` is the version the editor started from."""

    layout_version: int
    # Hard cap on the payload; the real limit (catalog maxItems) is checked by layout.validate.
    items: list[RoomItemIn] = Field(max_length=200)


class RoomOut(BaseModel):
    id: uuid.UUID
    name: str
    theme: Theme
    owner_id: uuid.UUID
    owner_nickname: str
    # How the viewer may be here.
    access: Literal["owner", "friend", "guest"]
    updated_at: datetime
    layout_version: int
    items: list[RoomItemOut]


class MeOut(BaseModel):
    id: uuid.UUID
    login_id: str
    nickname: str
    created_at: datetime
    room_id: uuid.UUID


class RoomPatchIn(BaseModel):
    theme: Theme | None = None


class PublicUserOut(BaseModel):
    """What other users can see about someone."""

    id: uuid.UUID
    nickname: str
    joined_at: datetime


class SearchResultOut(PublicUserOut):
    relation: Relation
    # Set when relation == "incoming" or "outgoing", so the UI can act on it.
    request_id: uuid.UUID | None = None


class FriendOut(PublicUserOut):
    room_id: uuid.UUID | None
    since: datetime


class FriendRequestOut(BaseModel):
    id: uuid.UUID
    user: PublicUserOut
    created_at: datetime


class FriendRequestsOut(BaseModel):
    incoming: list[FriendRequestOut]
    outgoing: list[FriendRequestOut]


class FriendRequestIn(BaseModel):
    user_id: uuid.UUID


class FriendRequestResultOut(BaseModel):
    # "accepted" when the other person had already asked us (auto-accepted).
    status: Literal["pending", "accepted"]
    request_id: uuid.UUID | None = None


class InviteOut(BaseModel):
    url: str
    expires_at: datetime


class InvitePreviewOut(BaseModel):
    status: Literal["valid", "expired", "revoked", "not_found"]
    inviter_nickname: str | None = None
    room_name: str | None = None
    expires_at: datetime | None = None


class InviteAcceptOut(BaseModel):
    room_id: uuid.UUID
