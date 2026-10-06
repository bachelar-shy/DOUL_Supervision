"""Staging/pilot entrypoint: no demo seeding, no secret fallback or automatic DDL."""
import os
import uvicorn

from services.telemetry import configure_logging, emit
from services.runtime_config import environment
from services.api.persistence import create_postgres_persistence
from services.api.main import create_app
from .auth import PinnedJWT
from .gates import validate_connections, validate_store


def main():
    configure_logging()
    store = None
    try:
        stage = environment()
        if stage not in {'staging', 'pilot'} or os.getenv('DOUL_API_DEMO', '').lower() not in {'', 'false', '0'}:
            raise ValueError('Non-demo staging or pilot configuration is required')
        dsn, _ = validate_connections(stage)
        store = create_postgres_persistence(dsn, demo=False)
        validate_store(store, stage)
        app = create_app(demo=False, persistence=store, authentication=PinnedJWT.configured())
        uvicorn.run(app, host='0.0.0.0', port=8791, log_config=None, access_log=False,
                    proxy_headers=False, limit_concurrency=32, timeout_keep_alive=5)
        return 0
    except Exception as exc:
        emit('deployment', 'api-start-refused', errorType=type(exc).__name__)
        return 1
    finally:
        if store is not None:
            store.close()


if __name__ == '__main__':
    raise SystemExit(main())
