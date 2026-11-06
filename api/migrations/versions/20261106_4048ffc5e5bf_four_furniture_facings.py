"""four furniture facings

Lets room_items.facing hold 2 and 3 (pieces turned around) besides 0 and 1.
Existing rows keep their value and meaning: only the CHECK constraint widens.
Which facings a given type may use is checked by the layout rules
(shared/furniture.json "rotation"), not by the database.

Downgrade folds 2 -> 0 and 3 -> 1 (same footprint, turned back around) before
restoring the old constraint, so it can't fail on new data.

Revision ID: 4048ffc5e5bf
Revises: ca9664530522
Create Date: 2026-11-06 14:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "4048ffc5e5bf"
down_revision: str | None = "ca9664530522"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("room_items_facing_check", "room_items", type_="check")
    op.create_check_constraint("room_items_facing_check", "room_items", "facing IN (0, 1, 2, 3)")


def downgrade() -> None:
    op.execute("UPDATE room_items SET facing = facing - 2 WHERE facing >= 2")
    op.drop_constraint("room_items_facing_check", "room_items", type_="check")
    op.create_check_constraint("room_items_facing_check", "room_items", "facing IN (0, 1)")
