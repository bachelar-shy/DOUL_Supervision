"""Run once by default, or as an explicitly configured monitoring service."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import tempfile
import threading
import time
import urllib.request

from services.api.persistence import create_local_persistence, create_postgres_persistence
from services.runtime_config import secret, environment, object_storage_client, service_url
from services.telemetry import emit, configure_logging
from services.worker.queue import RedisQueue
from .metrics import collect, alerts_for, signal as metric_signal
from .alerts import AlertDispatcher, NoRedirect


def atomic_health(path, healthy):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.health-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as file:
            json.dump({'schemaVersion': 1, 'observedAtEpoch': time.time(),
                       'status': 'ok' if healthy else 'error'}, file)
            file.flush()
            os.fsync(file.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def main():
    configure_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--database', default='')
    parser.add_argument('--interval', type=int, default=0)
    args = parser.parse_args()
    if args.interval and not 10 <= args.interval <= 3600:
        parser.error('interval must be 10..3600 seconds; omit for one snapshot')
    if args.demo and environment() != 'development':
        parser.error('demo monitoring is development-only')
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    store = queue = object_client = None
    try:
        dsn = secret('DATABASE_URL', required=not bool(args.database))
        store = create_postgres_persistence(dsn, demo=args.demo) if dsn else create_local_persistence(args.database, demo=args.demo)
        queue = RedisQueue(secret('REDIS_URL'), os.getenv('DOUL_QUEUE_NAMESPACE', 'doul:media'), initialize=False)
        if os.getenv('OBJECT_STORAGE_ENDPOINT'):
            object_client = object_storage_client()
        budgets = {}
        for field, variable in [('databaseBytes', 'DOUL_DATABASE_CAPACITY_BYTES'), ('objectBytes', 'DOUL_OBJECT_CAPACITY_BYTES')]:
            if os.getenv(variable): budgets[field] = int(os.environ[variable])
        mounts = {component: os.environ[var] for component, var in
                  [('database-volume', 'DOUL_DATABASE_VOLUME_PATH'), ('object-volume', 'DOUL_OBJECT_VOLUME_PATH')]
                  if os.getenv(var)}
        directory = Path(os.getenv('DOUL_MONITOR_STATE_DIR', '.local/monitor'))
        hook = os.getenv('DOUL_ALERT_ENDPOINT')
        dispatcher = AlertDispatcher(directory / 'alerts.json', hook, secret('DOUL_ALERT_TOKEN'),
            allow_loopback_http=environment() == 'development') if hook else None
        api_url = os.getenv('DOUL_API_HEALTH_URL')
        if api_url: service_url(api_url, allow_http=environment() == 'development')
        expected_workers = int(os.getenv('DOUL_EXPECTED_WORKERS', '1'))
        if expected_workers < 0: raise ValueError('Negative worker count')
        while not stop.is_set():
            events = collect(store, queue, object_client, os.getenv('OBJECT_STORAGE_BUCKET'),
                             budgets=budgets, disk_paths=mounts, expected_workers=expected_workers)
            if api_url:
                try:
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
                    with opener.open(api_url, timeout=5) as response:
                        payload = json.loads(response.read(65536))
                        if response.status != 200 or payload.get('status') != 'ok':
                            raise RuntimeError('API readiness failed')
                    events.append(metric_signal('api-readiness', 'ok', {}))
                except Exception as exc:
                    events.append(metric_signal('api-readiness', 'error', {'errorType': type(exc).__name__}))
            alerts = alerts_for(events, max_ready_age=int(os.getenv('DOUL_QUEUE_ALERT_AGE_SECONDS', '300')),
                                capacity_percent=float(os.getenv('DOUL_CAPACITY_ALERT_PERCENT', '90')))
            delivery = dispatcher.pump(alerts) if dispatcher else dict(delivered=0, pending=0, configured=False)
            healthy = not alerts and all(e['status'] == 'ok' for e in events) and not delivery.get('pending')
            if environment() != 'development' and dispatcher is None: healthy = False
            for event in events: print(json.dumps(event, sort_keys=True, allow_nan=False), flush=True)
            print(json.dumps(dict(schemaVersion='1.0', component='platform', signal='runtime-summary',
                                  status='ok' if healthy else 'error', alertCount=len(alerts), delivery=delivery)), flush=True)
            atomic_health(directory / 'health.json', healthy)
            if not args.interval: return 0 if healthy else 1
            stop.wait(args.interval)
        emit('monitor', 'graceful-stop')
        return 0
    except Exception as exc:
        emit('monitor', 'runtime-failure', errorType=type(exc).__name__)
        return 1
    finally:
        if object_client is not None: object_client.close()
        if queue is not None: queue.close()
        if store is not None: store.close()


if __name__ == '__main__':
    raise SystemExit(main())
