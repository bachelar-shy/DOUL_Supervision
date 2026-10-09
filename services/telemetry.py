"""Allowlisted system logs. Never a substitute for domain AuditEvent records."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
import math
import re
import sys
import threading

_LOCK = threading.Lock()
_NUMERIC = {'statusCode', 'latencyMs', 'attempt', 'count', 'queueDepth'}
_TEXT = {
    'route': r'[A-Za-z0-9_./{}:-]{1,256}',
    'method': r'GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD',
    'requestId': r'[a-f0-9-]{32,36}',
    'jobId': r'[a-f0-9]{64}',
    'state': r'done|ready|dead|cancelled|ignored|stale|rejected|running',
    'errorType': r'[A-Za-z0-9_.]{1,80}',
    'errorCode': r'[A-Z0-9_]{1,80}',
}


def record(component, event, **fields):
    if not re.fullmatch(r'[a-z0-9-]{1,40}', component) or not re.fullmatch(r'[a-z0-9-]{1,60}', event):
        raise ValueError('Invalid system event identifier')
    result = dict(schemaVersion='1.0', observedAt=datetime.now(timezone.utc).isoformat(),
                  component=component, event=event)
    for key, value in fields.items():
        if key in _NUMERIC and type(value) in (int, float) and math.isfinite(value):
            result[key] = value
        elif key in _TEXT and isinstance(value, str) and re.fullmatch(_TEXT[key], value):
            result[key] = value
    return result


def emit(component, event, **fields):
    line = json.dumps(record(component, event, **fields), ensure_ascii=False, sort_keys=True, allow_nan=False)
    with _LOCK:
        if _write_line(sys.stdout, line):
            return True
        return _write_line(sys.stderr, line)


def _write_line(stream, line):
    if stream is None:
        return False
    try:
        stream.write(line + '\n')
        stream.flush()
    except (OSError, ValueError):
        return False
    return True


class SafeRuntimeFormatter(logging.Formatter):
    """Third-party log messages/tracebacks can contain URLs or secrets; omit them."""
    def format(self, entry):
        row = record('runtime', 'library-log', errorType=entry.exc_info[0].__name__ if entry.exc_info else None)
        row['level'] = entry.levelname
        row['logger'] = entry.name if re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', entry.name) else 'external'
        return json.dumps(row, sort_keys=True)


def configure_logging():
    handler = logging.StreamHandler()
    handler.setFormatter(SafeRuntimeFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    for name in ('uvicorn', 'uvicorn.error', 'uvicorn.access'):
        logger = logging.getLogger(name)
        logger.handlers[:] = []
        logger.propagate = True
