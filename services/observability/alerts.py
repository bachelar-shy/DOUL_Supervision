"""Persistent, secret-free alert delivery outbox with HTTPS and idempotency IDs."""
from __future__ import annotations

from datetime import datetime, timezone
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time
from uuid import uuid4
import urllib.request
from urllib.parse import urlsplit

from services.runtime_config import service_url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class AlertDispatcher:
    def __init__(self, state_file, endpoint, token, allow_loopback_http=False):
        parsed = urlsplit(endpoint)
        allow_http = allow_loopback_http and parsed.hostname in {'localhost', '127.0.0.1', '::1'}
        self.endpoint = service_url(endpoint, allow_http=allow_http)
        if len(token) < 16 or len(token) > 4096 or any(c.isspace() for c in token):
            raise ValueError('A dedicated alert service token is required')
        self._token = token
        self.path = Path(state_file)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = self.path.parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
            raise ValueError('Alert state directory must be private and owned by the process')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def _save(self, state):
        fd, name = tempfile.mkstemp(prefix='.alert-', dir=self.path.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                json.dump(state, handle, sort_keys=True, allow_nan=False)
                handle.flush()
                os.fsync(handle.fileno())
            if self.path.is_symlink():
                raise ValueError('Alert state path must not be a symlink')
            os.replace(name, self.path)
        finally:
            if os.path.exists(name): os.unlink(name)

    def _load(self):
        if not self.path.exists() and not self.path.is_symlink():
            return dict(schemaVersion=1, instanceId=uuid4().hex, endpointHash=sha256(self.endpoint.encode()).hexdigest(), sequence=0, active=[], pending=[])
        fd = os.open(self.path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        with os.fdopen(fd, 'r', encoding='utf-8') as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 4 * 1024 * 1024 or info.st_mode & 0o077:
                raise ValueError('Invalid alert state file')
            value = json.load(handle)
        if value.get('endpointHash') != sha256(self.endpoint.encode()).hexdigest():
            raise ValueError('Alert receiver changed; explicitly transfer the pending outbox first')
        if value.get('schemaVersion') != 1 or not isinstance(value.get('pending'), list):
            raise ValueError('Unsupported alert state format')
        return value

    def _send(self, payload):
        request = urllib.request.Request(self.endpoint, data=json.dumps(payload, sort_keys=True).encode(),
            method='POST', headers={'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + self._token, 'Idempotency-Key': payload['deliveryId']})
        with self.opener.open(request, timeout=5) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError('Alert receiver did not acknowledge delivery')

    def pump(self, alerts, now=None):
        now = time.time() if now is None else now
        desired = {}
        for alert in alerts:
            if set(alert) != {'component', 'code', 'severity'} or alert['severity'] not in {'warning', 'critical'}:
                raise ValueError('Invalid alert fields')
            if not re.fullmatch(r'[a-z0-9-]{1,40}', alert['component']) or not re.fullmatch(r'[A-Z0-9_]{1,80}', alert['code']):
                raise ValueError('Invalid alert classification')
            desired[alert['component'] + '/' + alert['code']] = alert
        lock_fd = os.open(str(self.path) + '.lock', os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        with os.fdopen(lock_fd, 'a') as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            state = self._load()
            before = set(state['active'])
            transitions = [(key, 'firing') for key in sorted(set(desired) - before)]
            transitions += [(key, 'resolved') for key in sorted(before - set(desired))]
            if len(state['pending']) + len(transitions) > 1000:
                raise RuntimeError('Alert outbox capacity exceeded; no events were discarded')
            for key, status in transitions:
                component, code = key.split('/')
                state['sequence'] += 1
                delivery_id = sha256((state['instanceId'] + ':' + str(state['sequence']) + ':' + key + ':' + status).encode()).hexdigest()
                state['pending'].append(dict(attempts=0, nextAt=now, payload=dict(
                    schemaVersion='1.0', deliveryId=delivery_id, component=component, code=code,
                    severity=desired.get(key, {}).get('severity', 'critical'), status=status,
                    observedAt=datetime.fromtimestamp(now, timezone.utc).isoformat())))
            state['active'] = sorted(desired)
            self._save(state)  # Persist transitions BEFORE network side effects.
            delivered = 0
            error_type = None
            for _ in range(5):
                if not state['pending'] or state['pending'][0]['nextAt'] > now:
                    break
                item = state['pending'][0]
                try:
                    self._send(item['payload'])
                except Exception as exc:
                    item['attempts'] += 1
                    item['nextAt'] = now + min(300, 5 * 2 ** min(item['attempts'], 6))
                    error_type = type(exc).__name__
                    self._save(state)
                    break
                state['pending'].pop(0)
                delivered += 1
                self._save(state)
            return dict(delivered=delivered, pending=len(state['pending']), errorType=error_type)
