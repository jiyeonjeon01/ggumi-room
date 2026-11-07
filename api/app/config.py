from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings from environment variables (see ../.env.example)."""

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str = "postgresql+psycopg://ggumiroom:ggumiroom@localhost:5432/ggumiroom"
    # Public origin of the site; used for invite links and the CSRF Origin check.
    public_base_url: str = "https://www.ggumiroom.com"
    # Extra origins allowed to POST (dev servers). Comma-separated.
    extra_allowed_origins: str = ""
    # Secure cookies need HTTPS (or http://localhost in Chrome/Firefox).
    cookie_secure: bool = True
    session_days: int = 30
    invite_days: int = 7
    # OpenAPI docs at /api/docs. Off in production.
    enable_docs: bool = False
    rate_limit_enabled: bool = True
    # While testing in production: sign-up needs this code (empty = open sign-up).
    # Login and existing accounts are not affected.
    # Friend presence: away after this long without real input; offline this long after the last
    # connection drops (logout is immediate). Shorter values are only for local end-to-end tests.
    presence_away_s: float = 300.0
    presence_grace_s: float = 10.0

    @property
    def allowed_origins(self) -> set[str]:
        extra = {o.strip().rstrip("/") for o in self.extra_allowed_origins.split(",") if o.strip()}
        return {self.public_base_url.rstrip("/"), *extra}


@lru_cache
def get_settings() -> Settings:
    return Settings()
