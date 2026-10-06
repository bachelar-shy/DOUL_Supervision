#!/usr/bin/env python3
"""Platform-owned worker runtime bootstrap.

This module proves the container/runtime boundary and Redis connectivity.
It intentionally does not define business queue semantics. When Backend
provides a worker command, pass that command as container arguments and this
bootstrap will verify Redis before exec'ing it.
"""

from __future__ import annotations

import os
import signal
import socket
import ssl
import sys
import time
from urllib.parse import unquote, urlsplit


_STOP = False


def _redis_settings():
    raw = os.getenv("REDIS_URL", "").strip()
    if not raw:
        raise RuntimeError("REDIS_URL is required for the worker runtime")

    parsed = urlsplit(raw)
    if parsed.scheme not in {"redis", "rediss"}:
        raise RuntimeError("REDIS_URL must use redis:// or rediss://")
    if not parsed.hostname:
        raise RuntimeError("REDIS_URL must include a host")

    database_text = (parsed.path or "/0").lstrip("/") or "0"
    try:
        database = int(database_text)
    except ValueError as exc:
        raise RuntimeError("REDIS_URL database must be an integer") from exc

    return {
        "scheme": parsed.scheme,
        "host": parsed.hostname,
        "port": parsed.port or 6379,
        "username": unquote(parsed.username) if parsed.username else None,
        "password": unquote(parsed.password) if parsed.password else None,
        "database": database,
    }


def _encode_command(*parts):
    encoded = [str(part).encode("utf-8") for part in parts]
    payload = [f"*{len(encoded)}\r\n".encode("ascii")]
    for part in encoded:
        payload.append(f"${len(part)}\r\n".encode("ascii"))
        payload.append(part + b"\r\n")
    return b"".join(payload)


def _read_line(stream):
    line = stream.readline()
    if not line:
        raise RuntimeError("Redis closed the connection")
    if not line.endswith(b"\r\n"):
        raise RuntimeError("Invalid Redis response")
    return line[:-2]


def _read_reply(stream):
    marker = stream.read(1)
    if not marker:
        raise RuntimeError("Redis closed the connection")

    if marker == b"+":
        return _read_line(stream).decode("utf-8")
    if marker == b"-":
        message = _read_line(stream).decode("utf-8", errors="replace")
        raise RuntimeError(f"Redis command failed: {message}")
    if marker == b":":
        return int(_read_line(stream))
    if marker == b"$":
        size = int(_read_line(stream))
        if size == -1:
            return None
        data = stream.read(size)
        if len(data) != size or stream.read(2) != b"\r\n":
            raise RuntimeError("Invalid Redis bulk response")
        return data
    raise RuntimeError("Unsupported Redis response type")


def _redis_session():
    settings = _redis_settings()
    sock = socket.create_connection(
        (settings["host"], settings["port"]),
        timeout=5,
    )
    if settings["scheme"] == "rediss":
        context = ssl.create_default_context()
        sock = context.wrap_socket(sock, server_hostname=settings["host"])

    stream = sock.makefile("rwb", buffering=0)
    try:
        password = settings["password"]
        username = settings["username"]
        if password:
            if username:
                stream.write(_encode_command("AUTH", username, password))
            else:
                stream.write(_encode_command("AUTH", password))
            _read_reply(stream)

        if settings["database"]:
            stream.write(_encode_command("SELECT", settings["database"]))
            _read_reply(stream)

        return sock, stream
    except Exception:
        stream.close()
        sock.close()
        raise


def redis_ping():
    sock, stream = _redis_session()
    try:
        stream.write(_encode_command("PING"))
        reply = _read_reply(stream)
        if reply != "PONG":
            raise RuntimeError("Unexpected Redis PING response")
    finally:
        stream.close()
        sock.close()


def write_heartbeat():
    key = os.getenv(
        "DOUL_WORKER_HEARTBEAT_KEY",
        "doul:worker:runtime:heartbeat",
    )
    ttl = int(os.getenv("DOUL_WORKER_HEARTBEAT_TTL", "30"))
    value = str(time.time_ns())

    sock, stream = _redis_session()
    try:
        stream.write(_encode_command("SET", key, value, "EX", ttl))
        reply = _read_reply(stream)
        if reply != "OK":
            raise RuntimeError("Redis heartbeat write failed")
    finally:
        stream.close()
        sock.close()


def _stop(_signum, _frame):
    global _STOP
    _STOP = True


def idle_runtime():
    interval = float(os.getenv("DOUL_WORKER_HEARTBEAT_INTERVAL", "5"))
    if interval <= 0:
        raise RuntimeError("DOUL_WORKER_HEARTBEAT_INTERVAL must be positive")

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    print(
        "worker-runtime ready: Redis connectivity and heartbeat enabled; "
        "Backend queue adapter not configured by Platform",
        flush=True,
    )
    while not _STOP:
        write_heartbeat()
        deadline = time.monotonic() + interval
        while not _STOP and time.monotonic() < deadline:
            time.sleep(min(0.25, deadline - time.monotonic()))


def main():
    args = sys.argv[1:]

    if args == ["--check"]:
        redis_ping()
        print("worker-runtime-check-ok")
        return

    if not args or args == ["--idle"]:
        idle_runtime()
        return

    if args and args[0] == "--":
        args = args[1:]
    if not args:
        raise SystemExit("Worker command is empty")

    redis_ping()
    os.execvp(args[0], args)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"worker-runtime error: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1) from exc
