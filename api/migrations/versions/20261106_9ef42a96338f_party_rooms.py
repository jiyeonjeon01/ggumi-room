"""party rooms

Temporary party lounges live in `rooms` next to personal rooms:
- rooms.kind ('personal' for every existing room), rooms.template ('personal'),
  and party-only columns link_token, closes_at, closed_at, last_active_at
  (all empty for existing rooms);
- room_members: the host and people who joined a party by link;
- visibility may now also be 'link'; one open party per host.

Existing rooms, items, friends and invites are untouched. Downgrade removes
party rooms first (they can't exist without these columns), then the rest.

Revision ID: 9ef42a96338f
Revises: 819b76651fd7
Create Date: 2026-11-06 14:14:27.859463
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9ef42a96338f"
down_revision: str | None = "819b76651fd7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "room_members",
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=16), server_default="member", nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("role IN ('host', 'member')", name="room_members_role_check"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("room_id", "user_id"),
    )
    op.create_index(op.f("ix_room_members_user_id"), "room_members", ["user_id"], unique=False)
    op.add_column("rooms", sa.Column("kind", sa.String(length=16), server_default="personal", nullable=False))
    op.add_column("rooms", sa.Column("template", sa.String(length=16), server_default="personal", nullable=False))
    op.add_column("rooms", sa.Column("link_token", sa.String(length=64), nullable=True))
    op.add_column("rooms", sa.Column("closes_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("rooms", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("rooms", sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("rooms_link_token_key", "rooms", ["link_token"])
    op.create_index("rooms_one_open_party_per_owner", "rooms", ["owner_id"], unique=True, postgresql_where=sa.text("kind = 'party' AND closed_at IS NULL"))
    op.create_check_constraint("rooms_kind_check", "rooms", "kind IN ('personal', 'party')")
    op.drop_constraint("rooms_visibility_check", "rooms", type_="check")
    op.create_check_constraint("rooms_visibility_check", "rooms", "visibility IN ('friends', 'link')")


def downgrade() -> None:
    op.execute("DELETE FROM rooms WHERE kind <> 'personal'")
    op.drop_constraint("rooms_visibility_check", "rooms", type_="check")
    op.create_check_constraint("rooms_visibility_check", "rooms", "visibility IN ('friends')")
    op.drop_constraint("rooms_kind_check", "rooms", type_="check")
    op.drop_index("rooms_one_open_party_per_owner", table_name="rooms", postgresql_where=sa.text("kind = 'party' AND closed_at IS NULL"))
    op.drop_constraint("rooms_link_token_key", "rooms", type_="unique")
    op.drop_column("rooms", "last_active_at")
    op.drop_column("rooms", "closed_at")
    op.drop_column("rooms", "closes_at")
    op.drop_column("rooms", "link_token")
    op.drop_column("rooms", "template")
    op.drop_column("rooms", "kind")
    op.drop_index(op.f("ix_room_members_user_id"), table_name="room_members")
    op.drop_table("room_members")
