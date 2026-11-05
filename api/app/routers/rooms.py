import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import room_access
from ..db import get_db
from ..deps import current_user
from ..models import Room, User
from ..schemas import RoomOut, RoomPatchIn

router = APIRouter(prefix="/rooms", tags=["rooms"])


def room_out(room: Room, owner: User, access: str) -> RoomOut:
    return RoomOut(
        id=room.id,
        name=room.name,
        theme=room.theme,
        owner_id=owner.id,
        owner_nickname=owner.nickname,
        access=access,
        updated_at=room.updated_at,
    )


def my_room(db: Session, user: User) -> Room:
    room = db.scalar(select(Room).where(Room.owner_id == user.id, Room.is_default))
    if room is None:  # every sign-up creates one; this would be a data error
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="방을 찾을 수 없어요.")
    return room


@router.get("/me", response_model=RoomOut)
def get_my_room(user: User = Depends(current_user), db: Session = Depends(get_db)) -> RoomOut:
    return room_out(my_room(db, user), user, "owner")


@router.get("/{room_id}", response_model=RoomOut)
def get_room(room_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> RoomOut:
    row = db.execute(select(Room, User).join(User, User.id == Room.owner_id).where(Room.id == room_id)).first()
    # Same 404 for "doesn't exist" and "not allowed", so room ids can't be probed.
    access = room_access(db, row[0], user) if row else None
    if not row or not access:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="방을 찾을 수 없거나 들어갈 수 없어요.")
    return room_out(row[0], row[1], access)


@router.patch("/{room_id}", response_model=RoomOut)
def patch_room(
    room_id: uuid.UUID, body: RoomPatchIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> RoomOut:
    room = db.get(Room, room_id)
    if not room or room.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="방을 찾을 수 없거나 바꿀 권한이 없어요.")
    if body.theme is not None:
        room.theme = body.theme
    db.commit()
    return room_out(room, user, "owner")
