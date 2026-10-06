#!/usr/bin/env python3
"""Emit a secret-safe JSONL snapshot of Platform runtime health signals."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import socket
import time
import urllib.error
import urllib.request
from urllib.parse import unquote, urlsplit


SCHEMA_VERSION = "1.0"


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def event(component, signal, status, latency_ms, details=None):
    return {
        "schemaVersion": SCHEMA_VERSION,
        "observedAt": now_iso(),
        "component": component,
        "signal": signal,
        "status": status,
        "latencyMs": round(latency_ms, 3),
        "details": details or {},
    }


def timed(callable_):
    started = time.monotonic()
    result = callable_()
    return result, (time.monotonic() - started) * 1000


def http_json(url):
    with urllib.request.urlopen(url, timeout=5) as response:
        body = response.read()
        return response.status, json.loads(body or b"{}")


def probe_api(url):
    try:
        (status_code, payload), latency = timed(lambda: http_json(url))
        if status_code != 200 or payload.get("status") != "ok":
            raise RuntimeError("api-health-not-ok")
        details = {
            "mode": payload.get("mode"),
            "databaseAdapter": (payload.get("adapters") or {}).get("database"),
        }
        return event("api", "health", "ok", latency, details)
    except Exception as exc:
        return event("api", "health", "error", 0.0, {"errorType": type(exc).__name__})


def probe_object_storage(base_url):
    paths = ("/health", "/minio/health/ready")
    started = time.monotonic()
    for path in paths:
        try:
            with urllib.request.urlopen(base_url.rstrip("/") + path, timeout=5) as response:
                if response.status == 200:
                    return event(
                        "object-storage",
                        "health",
                        "ok",
                        (time.monotonic() - started) * 1000,
                        {"healthPath": path},
                    )
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                continue
            return event(
                "object-storage",
                "health",
                "error",
                (time.monotonic() - started) * 1000,
                {"errorType": type(exc).__name__},
            )
        except Exception as exc:
            return event(
                "object-storage",
                "health",
                "error",
                (time.monotonic() - started) * 1000,
                {"errorType": type(exc).__name__},
            )
    return event(
        "object-storage",
        "health",
        "error",
        (time.monotonic() - started) * 1000,
        {"errorType": "HealthEndpointUnavailable"},
    )


def redis_settings(raw):
    parsed = urlsplit(raw)
    if parsed.scheme not in {"redis", "rediss"} or not parsed.hostname:
        raise RuntimeError("invalid-redis-url")
    database = int((parsed.path or "/0").lstrip("/") or "0")
    return {
        "scheme": parsed.scheme,
        "host": parsed.hostname,
        "port": parsed.port or 6379,
        "username": unquote(parsed.username) if parsed.username else None,
        "password": unquote(parsed.password) if parsed.password else None,
        "database": database,
    }


def encode_redis(*parts):
    encoded = [str(part).encode("utf-8") for part in parts]
    chunks = [f"*{len(encoded)}\r\n".encode("ascii")]
    for part in encoded:
        chunks.extend((f"${len(part)}\r\n".encode("ascii"), part, b"\r\n"))
    return b"".join(chunks)


def read_line(stream):
    line = stream.readline()
    if not line or not line.endswith(b"\r\n"):
        raise RuntimeError("invalid-redis-response")
    return line[:-2]


def read_redis(stream):
    marker = stream.read(1)
    if marker == b"+":
        return read_line(stream).decode("utf-8")
    if marker == b"-":
        read_line(stream)
        raise RuntimeError("redis-command-error")
    if marker == b":":
        return int(read_line(stream))
    if marker == b"$":
        size = int(read_line(stream))
        if size == -1:
            return None
        data = stream.read(size)
        if len(data) != size or stream.read(2) != b"\r\n":
            raise RuntimeError("invalid-redis-bulk-response")
        return data.decode("utf-8", errors="replace")
    raise RuntimeError("unsupported-redis-response")


def redis_command(stream, *parts):
    stream.write(encode_redis(*parts))
    return read_redis(stream)


def probe_redis(raw_url, heartbeat_key):
    started = time.monotonic()
    try:
        settings = redis_settings(raw_url)
        sock = socket.create_connection((settings["host"], settings["port"]), timeout=5)
        if settings["scheme"] == "rediss":
            import ssl

            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=settings["host"])
        stream = sock.makefile("rwb", buffering=0)
        try:
            if settings["password"]:
                if settings["username"]:
                    redis_command(stream, "AUTH", settings["username"], settings["password"])
                else:
                    redis_command(stream, "AUTH", settings["password"])
            if settings["database"]:
                redis_command(stream, "SELECT", settings["database"])
            pong = redis_command(stream, "PING")
            heartbeat = redis_command(stream, "GET", heartbeat_key)
            heartbeat_ttl = redis_command(stream, "TTL", heartbeat_key)
        finally:
            stream.close()
            sock.close()

        if pong != "PONG":
            raise RuntimeError("redis-ping-not-ok")
        if heartbeat is None or not isinstance(heartbeat_ttl, int) or heartbeat_ttl <= 0:
            raise RuntimeError("worker-heartbeat-missing")

        return event(
            "redis-worker",
            "health",
            "ok",
            (time.monotonic() - started) * 1000,
            {
                "ping": "PONG",
                "workerHeartbeatPresent": True,
                "workerHeartbeatTtlSeconds": heartbeat_ttl,
            },
        )
    except Exception as exc:
        return event(
            "redis-worker",
            "health",
            "error",
            (time.monotonic() - started) * 1000,
            {"errorType": type(exc).__name__},
        )


def probe_postgres(host, port):
    started = time.monotonic()
    try:
        sock = socket.create_connection((host, port), timeout=5)
        sock.close()
        return event(
            "postgresql",
            "tcp",
            "ok",
            (time.monotonic() - started) * 1000,
            {"port": port},
        )
    except Exception as exc:
        return event(
            "postgresql",
            "tcp",
            "error",
            (time.monotonic() - started) * 1000,
            {"errorType": type(exc).__name__, "port": port},
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", default="http://127.0.0.1:8791/health")
    parser.add_argument("--object-storage-base", default="http://127.0.0.1:9000")
    parser.add_argument("--postgres-host", default="127.0.0.1")
    parser.add_argument("--postgres-port", type=int, default=5432)
    parser.add_argument(
        "--worker-heartbeat-key",
        default=os.getenv("DOUL_WORKER_HEARTBEAT_KEY", "doul:worker:runtime:heartbeat"),
    )
    args = parser.parse_args()

    redis_url = os.getenv("REDIS_URL", "").strip()
    if not redis_url:
        raise SystemExit("REDIS_URL is required; the value is never emitted")

    events = [
        probe_api(args.api_url),
        probe_postgres(args.postgres_host, args.postgres_port),
        probe_object_storage(args.object_storage_base),
        probe_redis(redis_url, args.worker_heartbeat_key),
    ]
    overall = "ok" if all(item["status"] == "ok" for item in events) else "error"
    events.append(event("platform", "runtime-summary", overall, 0.0, {"checks": len(events)}))

    for item in events:
        print(json.dumps(item, ensure_ascii=False, sort_keys=True))

    return 0 if overall == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
