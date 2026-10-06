import argparse
import os

import uvicorn
from services.telemetry import configure_logging
configure_logging()

from .main import create_app
from .persistence import create_postgres_persistence


p = argparse.ArgumentParser(
    description="Local development only; production adapters are not configured"
)
p.add_argument("--demo", action="store_true")
p.add_argument("--port", type=int, default=8791)
p.add_argument("--database", default=".local/mvp.sqlite3")
p.add_argument(
    "--database-url",
    default=os.getenv("DATABASE_URL", ""),
    help="Use the PostgreSQL snapshot adapter instead of local SQLite.",
)
a = p.parse_args()
if not a.demo:
    p.error("--demo is required; no production authentication adapter is configured")

if a.database_url:
    persistence = create_postgres_persistence(a.database_url, demo=True)
    app = create_app(demo=True, persistence=persistence)
else:
    app = create_app(a.database, demo=True)

uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="info", log_config=None, access_log=False)
