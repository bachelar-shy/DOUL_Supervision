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
host = os.getenv("DOUL_API_HOST", "0.0.0.0")
port = int(os.getenv("DOUL_API_PORT", "8791"))
log_level = os.getenv("DOUL_API_LOG_LEVEL", "info")

Path(database).parent.mkdir(parents=True, exist_ok=True)

app = create_app(database, demo=True)
uvicorn.run(app, host=host, port=port, log_level=log_level)
