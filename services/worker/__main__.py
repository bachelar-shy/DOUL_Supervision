"""Backend executable worker; service actors come from the provisioned DB only."""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import threading
from uuid import uuid4

from services.api.persistence import create_local_persistence, create_postgres_persistence
from .jobs import dispatch, process_message
from .providers import FixtureProvider, UnconfiguredProvider
from .queue import RedisQueue
from services.telemetry import emit, configure_logging


def run(store, queue, provider, stop, consumer=None):
    consumer = consumer or socket.gethostname() + '-' + str(uuid4())[:8]
    heartbeat_error = []

    def heartbeat():
        while not stop.is_set():
            try:
                queue.heartbeat(consumer)
            except Exception as exc:
                heartbeat_error.append(type(exc).__name__)
                stop.set()
                return
            stop.wait(5)

    queue.heartbeat(consumer)
    thread = threading.Thread(target=heartbeat, name='worker-heartbeat', daemon=True)
    thread.start()
    try:
        while not stop.is_set():
            dispatch(store, queue)
            message = queue.receive(consumer)
            if stop.is_set():
                break  # Leave the delivery pending for another worker.
            if message:
                state = process_message(store, queue, provider, message)
                emit('worker', 'job-result', state=state, jobId=message[1].get('jobId'))
        if heartbeat_error:
            raise ConnectionError('Worker heartbeat transport failed')
    finally:
        stop.set()
        thread.join(timeout=6)


def main():
    configure_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--database', default=os.getenv('DOUL_API_DATABASE', ''))
    args = parser.parse_args()
    if args.fixture and not args.demo:
        parser.error('--fixture requires --demo')
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    store = queue = None
    try:
        dsn = os.getenv('DATABASE_URL', '').strip()
        if not dsn and not args.database:
            raise ValueError('An explicitly shared persistence target is required')
        store = create_postgres_persistence(dsn, demo=args.demo) if dsn else create_local_persistence(args.database, demo=args.demo)
        queue = RedisQueue(os.environ['REDIS_URL'], os.getenv('DOUL_QUEUE_NAMESPACE', 'doul:media'))
        provider = FixtureProvider(demo=True) if args.fixture else UnconfiguredProvider()
        run(store, queue, provider, stop)
        emit('worker', 'graceful-stop')
        return 0
    except Exception as exc:
        # Never log raw exception text, command arguments, DSNs or credentials.
        emit('worker', 'runtime-failure', errorType=type(exc).__name__)
        return 1
    finally:
        if queue is not None:
            queue.close()
        if store is not None:
            store.close()


if __name__ == '__main__':
    raise SystemExit(main())
