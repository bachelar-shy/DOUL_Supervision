"""Disposable integration: actual PG/Redis/worker/S3 metrics, no real-site data."""
import json
import os
import time
import urllib.request
from uuid import uuid4

from services.api.persistence import create_postgres_persistence
from services.runtime_config import object_storage_client
from services.worker.queue import RedisQueue
from services.observability.metrics import collect, alerts_for


def main():
    store = create_postgres_persistence(os.environ['DATABASE_URL'], demo=True)
    queue = RedisQueue(os.environ['REDIS_URL'], initialize=False)
    client = object_storage_client()
    try:
        bucket = os.environ['OBJECT_STORAGE_BUCKET']
        data = b'synthetic-observability-probe'
        client.put_object(Bucket=bucket, Key='monitor-probe-' + uuid4().hex, Body=data,
                          Metadata={'purpose': 'disposable-ci-only'})
        with urllib.request.urlopen('http://127.0.0.1:8791/ready', timeout=5) as response:
            assert response.status == 200 and json.load(response)['status'] == 'ok'
        for _ in range(15):
            events = collect(store, queue, client, bucket,
                             budgets={'databaseBytes': 1024**3, 'objectBytes': 1024**3})
            workers = next(e['details'].get('activeWorkers', 0) for e in events if e['component'] == 'redis-worker')
            if workers: break
            time.sleep(1)
        for event in events:
            print(json.dumps(event, sort_keys=True))
            assert event['status'] == 'ok', 'A required live metric probe failed'
        by_component = {e['component']: e['details'] for e in events}
        assert by_component['database-capacity']['usedBytes'] > 0
        assert by_component['object-capacity']['retainedVersionBytes'] >= len(data)
        assert by_component['object-capacity']['inventoryComplete'] is True
        assert by_component['redis-worker']['activeWorkers'] >= 1
        assert by_component['job-queue']['businessAuditSeparate'] is True
        assert not alerts_for(events)
        print('live-runtime-metrics-ok')
    finally:
        client.close(); queue.close(); store.close()


if __name__ == '__main__':
    main()
