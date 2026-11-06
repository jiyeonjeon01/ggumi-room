# syntax=docker/dockerfile:1
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
# Build context is the repo root (the furniture catalog lives in shared/).
COPY api/requirements.txt .
RUN pip install -r requirements.txt
COPY api/ .
COPY shared/ ./shared/

# Unprivileged user; the image needs no write access at runtime.
RUN useradd --system --uid 10001 --no-create-home app
USER 10001

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)" || exit 1

# Apply pending migrations, then serve. One worker: the rate limiter is in-memory (app/ratelimit.py).
# No access log here: nginx logs every request without query strings (which can hold login ids).
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --ws-max-size 16384 --no-server-header --no-access-log --log-level info"]
