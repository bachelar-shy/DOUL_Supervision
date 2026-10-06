"""Redis is a recoverable notification transport, never the official job ledger.

All durable state and attempts live with the domain snapshot. Messages carry only
server-generated job IDs. XACK/XDEL remove transport hints, not business records.
"""
from __future__ import annotations

from typing import Protocol


class QueuePort(Protocol):
    def publish(self, job_id: str, generation: int) -> str: ...
    def receive(self, consumer: str, reclaim_ms: int = 60000): ...
    def acknowledge(self, message_id: str) -> None: ...
    def heartbeat(self, consumer: str) -> None: ...


class RedisQueue:
    def __init__(self, url: str, namespace: str = 'doul:media', initialize: bool = True):
        import redis
        from services.runtime_config import validate_redis_url
        validate_redis_url(url)
        if not namespace or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-_' for c in namespace):
            raise ValueError('Invalid queue namespace')
        self.client = redis.Redis.from_url(url, decode_responses=True, socket_timeout=5,
                                          socket_connect_timeout=5, health_check_interval=15)
        self.stream = namespace + ':events'
        self.group = 'workers-v1'
        self.namespace = namespace
        self.client.ping()
        if not initialize:
            return
        try:
            self.client.xgroup_create(self.stream, self.group, id='0', mkstream=True)
        except redis.ResponseError as exc:
            if not str(exc).startswith('BUSYGROUP'):
                raise

    def publish(self, job_id, generation):
        # One notification per dispatch generation; expiry is safe because DB
        # fencing/idempotency is authoritative even after Redis loss or replay.
        script = '''
        local old = redis.call('GET', KEYS[2])
        if old then return old end
        local id = redis.call('XADD', KEYS[1], '*', 'jobId', ARGV[1])
        redis.call('SET', KEYS[2], id, 'EX', 300)
        return id
        '''
        return self.client.eval(script, 2, self.stream,
            self.namespace + ':dispatch:' + job_id + ':' + str(generation), job_id)

    def receive(self, consumer, reclaim_ms=60000):
        claimed = self.client.xautoclaim(self.stream, self.group, consumer,
                                        min_idle_time=reclaim_ms, start_id='0-0', count=1)
        if claimed[1]:
            return claimed[1][0]
        rows = self.client.xreadgroup(self.group, consumer, {self.stream: '>'}, count=1, block=500)
        return rows[0][1][0] if rows else None

    def acknowledge(self, message_id):
        with self.client.pipeline(transaction=True) as pipe:
            pipe.xack(self.stream, self.group, message_id)
            pipe.xdel(self.stream, message_id)
            pipe.execute()

    def heartbeat(self, consumer):
        import os
        import time
        key = os.getenv('DOUL_WORKER_HEARTBEAT_KEY', 'doul:worker:runtime:heartbeat')
        value = str(time.time_ns())
        self.client.set(key, value, ex=30)
        self.client.set(self.namespace + ':heartbeat:' + consumer, value, ex=30)

    def close(self):
        self.client.close()
