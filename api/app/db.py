from collections.abc import Iterator
from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

engine = create_engine(get_settings().database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    """All timestamps are stored as UTC (timestamptz); clients convert for display."""
    return datetime.now(UTC)


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db
