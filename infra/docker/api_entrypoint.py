"""Container entrypoint for the local-development API only."""

import os
from pathlib import Path

import uvicorn

from services.api.main import create_app


def enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


if not enabled("DOUL_API_DEMO"):
    raise SystemExit(
        "DOUL_API_DEMO must be explicitly enabled. "
        "Production authentication/storage adapters are not configured."
    )

database = os.getenv("DOUL_API_DATABASE", "/data/mvp.sqlite3")
database_url = os.getenv("DATABASE_URL", "").strip()
host = os.getenv("DOUL_API_HOST", "0.0.0.0")
port = int(os.getenv("DOUL_API_PORT", "8791"))
log_level = os.getenv("DOUL_API_LOG_LEVEL", "info")

if database_url:
    try:
        from services.api.persistence import create_postgres_persistence
    except ImportError as exc:
        raise SystemExit(
            "DATABASE_URL is configured but the Backend PostgreSQL adapter "
            "is not available in this revision."
        ) from exc
    persistence = create_postgres_persistence(database_url, demo=True)
    app = create_app(demo=True, persistence=persistence)
else:
    Path(database).parent.mkdir(parents=True, exist_ok=True)
    app = create_app(database, demo=True)

uvicorn.run(app, host=host, port=port, log_level=log_level)
