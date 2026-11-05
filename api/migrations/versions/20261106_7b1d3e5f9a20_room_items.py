"""room furniture items and layout version

Adds room_items (one row per placed piece) and rooms.layout_version, drops the
unused rooms.layout JSONB column, and gives every existing room the default
layout, so old and new rooms start the same.

Revision ID: 7b1d3e5f9a20
Revises: 2ac5ad711c49
Create Date: 2026-11-06 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "7b1d3e5f9a20"
down_revision: str | None = "2ac5ad711c49"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Snapshot of shared/furniture.json "defaultLayout" at the time of this
# migration (x/y in quarter tiles). Copied here on purpose: a migration must
# keep doing the same thing even if the catalog's default changes later.
DEFAULT_LAYOUT = [
    ("rug", 14, 15, 0),
    ("bed", 0, 3, 0),
    ("nightstand", 0, 12, 0),
    ("bookshelf", 13, 0, 0),
    ("desk", 25, 0, 0),
    ("plant", 32, 5, 0),
    ("plant", 1, 28, 0),
    ("table", 18, 18, 0),
    ("cushion", 19, 24, 0),
]


def upgrade() -> None:
    op.create_table(
        "room_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("item_type", sa.String(length=32), nullable=False),
        sa.Column("x_q", sa.SmallInteger(), nullable=False),
        sa.Column("y_q", sa.SmallInteger(), nullable=False),
        sa.Column("facing", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("facing IN (0, 1)", name="room_items_facing_check"),
        sa.CheckConstraint("x_q >= 0 AND y_q >= 0", name="room_items_non_negative"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_room_items_room_id"), "room_items", ["room_id"], unique=False)
    op.add_column("rooms", sa.Column("layout_version", sa.Integer(), server_default="0", nullable=False))
    op.drop_column("rooms", "layout")

    # Every existing room gets the default layout (random ids from the DB).
    values = ", ".join(f"('{t}', {x}, {y}, {f}, {i})" for i, (t, x, y, f) in enumerate(DEFAULT_LAYOUT))
    op.execute(
        f"""
        INSERT INTO room_items (id, room_id, item_type, x_q, y_q, facing, position)
        SELECT gen_random_uuid(), r.id, d.item_type, d.x_q, d.y_q, d.facing, d.position
        FROM rooms r CROSS JOIN (VALUES {values}) AS d(item_type, x_q, y_q, facing, position)
        """
    )


def downgrade() -> None:
    op.add_column("rooms", sa.Column("layout", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.drop_column("rooms", "layout_version")
    op.drop_index(op.f("ix_room_items_room_id"), table_name="room_items")
    op.drop_table("room_items")
