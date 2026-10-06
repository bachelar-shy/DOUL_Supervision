"""Operational counters from authoritative storage; no business-state inference."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import shutil
import time

from services.worker.jobs import clock


def signal(component, status, details, latency_ms=0):
    return dict(schemaVersion='1.0', observedAt=datetime.now(timezone.utc).isoformat(),
                component=component, signal='runtime-metrics', status=status,
                latencyMs=round(latency_ms, 3), details=details)


def _probe(component, function):
    started = time.monotonic()
    try:
        details = function()
        return signal(component, 'ok', details, (time.monotonic() - started) * 1000)
    except Exception as exc:
        return signal(component, 'error', {'errorType': type(exc).__name__},
                      (time.monotonic() - started) * 1000)


def job_metrics(store, recent_seconds=300):
    with store.transaction():
        now = clock(store)
        jobs = deepcopy(list(store.meta.get('workerJobs', {}).values()))
    ready = [j for j in jobs if j['state'] == 'ready']
    active = [j for j in jobs if j['state'] == 'running' and j['leaseUntil'] > now]
    expired = [j for j in jobs if j['state'] == 'running' and j['leaseUntil'] <= now]
    dead = [j for j in jobs if j['state'] == 'dead']
    done = [j for j in jobs if j['state'] == 'done']
    attempts = [a for j in jobs for a in j['attempts']]
    recent_attempts = [a for a in attempts if a.get('finishedAt', 0) >= now - recent_seconds]
    latency = [max(0, (j['finishedAt'] - j['createdAt']) * 1000) for j in done]
    execution = [max(0, (a['finishedAt'] - a['startedAt']) * 1000)
                 for a in recent_attempts if a['status'] == 'done']
    return dict(ready=len(ready), running=len(active), expiredLeases=len(expired),
                deadLetters=len(dead), completed=len(done),
                recentDeadLetters=sum(j.get('finishedAt', 0) >= now - recent_seconds for j in dead),
                retries=sum(max(0, len(j['attempts']) - 1) for j in jobs),
                recentFailedAttempts=sum(a['status'] in {'failed', 'lease_expired'} for a in recent_attempts),
                oldestReadyAgeSeconds=round(max([max(0, now - j['createdAt']) for j in ready + expired] or [0]), 3),
                maxEndToEndLatencyMs=round(max(latency or [0]), 3),
                maxRecentExecutionLatencyMs=round(max(execution or [0]), 3),
                recentWindowSeconds=recent_seconds, businessAuditSeparate=True)


def database_metrics(store, capacity_bytes=None):
    with store.transaction():
        if hasattr(store, '_fetchone'):
            size = int(store._fetchone('SELECT pg_database_size(current_database())')[0])
            kind = 'postgresql-database-size'
        else:
            size = int(store.db.execute('PRAGMA page_count').fetchone()[0]) * int(store.db.execute('PRAGMA page_size').fetchone()[0])
            kind = 'sqlite-page-size'
    result = dict(usedBytes=size, measurement=kind, budgetConfigured=capacity_bytes is not None,
                  physicalFreeBytesMeasured=False)
    if capacity_bytes is not None:
        if type(capacity_bytes) is not int or capacity_bytes <= 0:
            raise ValueError('Positive database capacity budget required')
        result.update(capacityBudgetBytes=capacity_bytes, budgetUsedPercent=round(100 * size / capacity_bytes, 3))
    return result


def redis_metrics(queue, expected_workers=1):
    queue.client.ping()
    pending = queue.client.xpending(queue.stream, queue.group)
    groups = queue.client.xinfo_groups(queue.stream)
    group = next(g for g in groups if g['name'] == queue.group)
    count = 0
    scanned = 0
    for key in queue.client.scan_iter(match=queue.namespace + ':heartbeat:*', count=100):
        scanned += 1
        if scanned > 1000:
            raise RuntimeError('Worker heartbeat inventory exceeds monitor bound')
        if queue.client.ttl(key) > 0:
            count += 1
    return dict(transportPending=int(pending['pending']), transportLag=group.get('lag'),
                transportEntries=int(queue.client.xlen(queue.stream)), activeWorkers=count,
                expectedWorkers=expected_workers, heartbeatIsNotAnalysisCompletion=True)


def object_metrics(client, bucket, capacity_bytes=None, max_pages=64, max_seconds=30):
    started = time.monotonic()
    size = versions = deletes = current = pages = 0
    complete = True
    for page in client.get_paginator('list_object_versions').paginate(Bucket=bucket):
        pages += 1
        for version in page.get('Versions', []):
            size += int(version['Size'])
            versions += 1
            current += bool(version.get('IsLatest'))
        deletes += len(page.get('DeleteMarkers', []))
        if page.get('IsTruncated') and (pages >= max_pages or time.monotonic() - started >= max_seconds):
            complete = False
            break
    result = dict(retainedVersionBytes=size, versionCount=versions, deleteMarkerCount=deletes,
                  currentObjectCount=current, inventoryComplete=complete,
                  measurement='logical-retained-object-versions', physicalFreeBytesMeasured=False,
                  budgetConfigured=capacity_bytes is not None)
    if capacity_bytes is not None:
        if type(capacity_bytes) is not int or capacity_bytes <= 0:
            raise ValueError('Positive object storage capacity budget required')
        result.update(capacityBudgetBytes=capacity_bytes, budgetUsedPercent=round(100 * size / capacity_bytes, 3))
    return result


def collect(store, queue, object_client=None, bucket=None, budgets=None, disk_paths=None, expected_workers=1):
    budgets = budgets or {}
    events = [
        _probe('job-queue', lambda: job_metrics(store)),
        _probe('database-capacity', lambda: database_metrics(store, budgets.get('databaseBytes'))),
        _probe('redis-worker', lambda: redis_metrics(queue, expected_workers)),
    ]
    if object_client is not None and bucket:
        events.append(_probe('object-capacity', lambda: object_metrics(object_client, bucket, budgets.get('objectBytes'))))
    else:
        events.append(signal('object-capacity', 'error', {'errorType': 'StorageMonitorUnconfigured'}))
    # A host/sidecar may supply read-only volume mounts for real physical capacity.
    # Logical DB/bucket bytes must never be mislabeled as physical free disk.
    for component, path in (disk_paths or {}).items():
        if component not in {'database-volume', 'object-volume'}:
            raise ValueError('Unknown capacity mount')
        def disk(path=path):
            usage = shutil.disk_usage(path)
            return dict(totalBytes=usage.total, usedBytes=usage.used, freeBytes=usage.free,
                        usedPercent=round(100 * usage.used / usage.total, 3), physicalFreeBytesMeasured=True)
        events.append(_probe(component, disk))
    return events


def alerts_for(events, max_ready_age=300, capacity_percent=90):
    if max_ready_age <= 0 or not 0 < capacity_percent <= 100:
        raise ValueError('Invalid operational alert thresholds')
    alerts = []
    for event in events:
        component, details = event['component'], event['details']
        codes = []
        if event['status'] != 'ok':
            codes.append('COMPONENT_UNAVAILABLE')
        else:
            if component == 'job-queue':
                if details['recentDeadLetters']: codes.append('WORKER_JOB_FAILED')
                if details['oldestReadyAgeSeconds'] > max_ready_age: codes.append('QUEUE_DELAY')
                if details['expiredLeases']: codes.append('WORKER_LEASE_EXPIRED')
            if component == 'redis-worker' and details['activeWorkers'] < details['expectedWorkers']:
                codes.append('WORKER_UNAVAILABLE')
            if component == 'object-capacity' and not details['inventoryComplete']:
                codes.append('CAPACITY_SCAN_INCOMPLETE')
            if details.get('budgetUsedPercent', details.get('usedPercent', 0)) >= capacity_percent:
                codes.append('CAPACITY_HIGH')
        alerts.extend(dict(component=component, code=code, severity='critical') for code in codes)
    return alerts
