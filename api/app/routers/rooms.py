import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import layout as layout_rules
from ..access import room_access
from ..db import get_db
from ..deps import current_user
from ..models import Room, RoomItem, User
from ..realtime.hub import hub, notify
from ..schemas import LayoutIn, RoomItemOut, RoomOut, RoomPatchIn

router = APIRouter(prefix="/rooms", tags=["rooms"])


def _items(db: Session, room: Room) -> list[RoomItemOut]:
    rows = db.scalars(select(RoomItem).where(RoomItem.room_id == room.id).order_by(RoomItem.position)).all()
    return [RoomItemOut(type=r.item_type, x=r.x_q / 4, y=r.y_q / 4, facing=r.facing) for r in rows]


def write_items(db: Session, room: Room, items: list[dict]) -> None:
    """Replaces the room's furniture (items already validated)."""
    db.execute(delete(RoomItem).where(RoomItem.room_id == room.id))
    for position, it in enumerate(items):
        db.add(
            RoomItem(
                room_id=room.id,
                item_type=it["type"],
                x_q=round(it["x"] * 4),
                y_q=round(it["y"] * 4),
                facing=it["facing"],
                position=position,
            )
        )


def room_out(db: Session, room: Room, owner: User, access: str) -> RoomOut:
    return RoomOut(
        id=room.id,
        name=room.name,
        theme=room.theme,
        owner_id=owner.id,
        owner_nickname=owner.nickname,
        access=access,
        updated_at=room.updated_at,
        layout_version=room.layout_version,
        items=_items(db, room),
    )


def my_room(db: Session, user: User) -> Room:
    room = db.scalar(select(Room).where(Room.owner_id == user.id, Room.is_default))
    if room is None:  # every sign-up creates one; this would be a data error
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="방을 찾을 수 없어요.")
    return room


@router.get("/me", response_model=RoomOut)
def get_my_room(user: User = Depends(current_user), db: Session = Depends(get_db)) -> RoomOut:
    return room_out(db, my_room(db, user), user, "owner")


@router.get("/{room_id}", response_model=RoomOut)
def get_room(room_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> RoomOut:
    row = db.execute(select(Room, User).join(User, User.id == Room.owner_id).where(Room.id == room_id)).first()
    # Same 404 for "doesn't exist" and "not allowed", so room ids can't be probed.
    access = room_access(db, row[0], user) if row else None
    if not row or not access:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="방을 찾을 수 없거나 들어갈 수 없어요.")
    return room_out(db, row[0], row[1], access)


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
    if body.theme is not None:
        notify(hub.theme_changed, room.id, room.theme)
    return room_out(db, room, user, "owner")


@router.put("/{room_id}/items", response_model=RoomOut)
def save_layout(
    room_id: uuid.UUID, body: LayoutIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> RoomOut:
    """Saves a whole furniture layout (owner only), if nobody saved since the editor loaded it."""
    room = db.scalar(select(Room).where(Room.id == room_id).with_for_update())
    if not room or room.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="방을 찾을 수 없거나 바꿀 권한이 없어요.")
    if body.layout_version != room.layout_version:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "layout_conflict",
                "message": "다른 창이나 기기에서 방 배치가 먼저 바뀌었어요.",
                "layout_version": room.layout_version,
            },
        )
    items = [i.model_dump() for i in body.items]
    if problem := layout_rules.validate(items):
        code, index = problem
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": code, "index": index, "message": layout_rules.MESSAGES[code]},
        )
    write_items(db, room, items)
    room.layout_version += 1
    db.commit()
    # Visitors see the new layout and the server checks movement against it.
    notify(hub.layout_changed, room.id, room.layout_version, [dict(i) for i in items])
    return room_out(db, room, user, "owner")
