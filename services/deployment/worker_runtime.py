"""File-secret, provisioned non-demo worker entrypoint for isolated environments."""
import os
import signal
import threading

from services.api.persistence import create_postgres_persistence
from services.runtime_config import environment, secret
from services.telemetry import configure_logging, emit
from services.worker.queue import RedisQueue
from services.worker.providers import UnconfiguredProvider
from services.worker.__main__ import run
from .gates import validate_store


def main():
    configure_logging()
    store = queue = None
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        stage = environment()
        if stage not in {'staging', 'pilot'}:
            raise ValueError('Non-demo environment required')
        store = create_postgres_persistence(secret('DATABASE_URL'), demo=False)
        validate_store(store, stage)
        queue = RedisQueue(secret('REDIS_URL'), os.environ['DOUL_QUEUE_NAMESPACE'])
        run(store, queue, UnconfiguredProvider(), stop)
        emit('worker', 'graceful-stop')
        return 0
    except Exception as exc:
        emit('worker', 'runtime-failure', errorType=type(exc).__name__)
        return 1
    finally:
        if queue is not None: queue.close()
        if store is not None: store.close()


if __name__ == '__main__':
    raise SystemExit(main())
