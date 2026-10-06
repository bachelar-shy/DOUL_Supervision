#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


MODULE_PATH = Path(__file__).with_name("runtime_snapshot.py")
SPEC = importlib.util.spec_from_file_location("runtime_snapshot", MODULE_PATH)
runtime_snapshot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime_snapshot)


class ApiHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = json.dumps(
                {
                    "status": "ok",
                    "mode": "local-demo",
                    "adapters": {"database": "postgresql-snapshot-development"},
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *args):
        pass


class ObjectHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(404)
            self.end_headers()
            return
        if self.path == "/minio/health/ready":
            self.send_response(200)
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *args):
        pass


class RedisServer:
    def __init__(self, password):
        self.password = password
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(4)
        self.port = self.server.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.stop = threading.Event()

    def start(self):
        self.thread.start()

    def close(self):
        self.stop.set()
        try:
            socket.create_connection(("127.0.0.1", self.port), timeout=1).close()
        except OSError:
            pass
        self.thread.join(2)
        self.server.close()

    def _serve(self):
        while not self.stop.is_set():
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            with conn:
                stream = conn.makefile("rwb", buffering=0)
                authed = False
                while not self.stop.is_set():
                    try:
                        marker = stream.read(1)
                        if not marker:
                            break
                        if marker != b"*":
                            break
                        count = int(stream.readline())
                        parts = []
                        for _ in range(count):
                            if stream.read(1) != b"$":
                                return
                            size = int(stream.readline())
                            part = stream.read(size)
                            stream.read(2)
                            parts.append(part.decode())
                        command = parts[0].upper()
                        if command == "AUTH":
                            authed = parts[-1] == self.password
                            stream.write(b"+OK\r\n" if authed else b"-ERR\r\n")
                        elif not authed:
                            stream.write(b"-NOAUTH\r\n")
                        elif command == "PING":
                            stream.write(b"+PONG\r\n")
                        elif command == "GET":
                            value = b"123456789"
                            stream.write(f"${len(value)}\r\n".encode() + value + b"\r\n")
                        elif command == "TTL":
                            stream.write(b":19\r\n")
                        elif command == "SELECT":
                            stream.write(b"+OK\r\n")
                        else:
                            stream.write(b"-ERR\r\n")
                    except Exception:
                        break


@contextlib.contextmanager
def http_server(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)


class RuntimeSnapshotTests(unittest.TestCase):
    def test_snapshot_is_structured_and_secret_safe(self):
        redis = RedisServer("top-secret")
        redis.start()
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        postgres_port = listener.getsockname()[1]

        def accept_once():
            conn, _ = listener.accept()
            conn.close()
            listener.close()

        threading.Thread(target=accept_once, daemon=True).start()

        try:
            with http_server(ApiHandler) as api_port, http_server(ObjectHandler) as object_port:
                argv = [
                    "runtime_snapshot.py",
                    "--api-url",
                    f"http://127.0.0.1:{api_port}/health",
                    "--object-storage-base",
                    f"http://127.0.0.1:{object_port}",
                    "--postgres-port",
                    str(postgres_port),
                ]
                output = io.StringIO()
                with patch.dict(
                    os.environ,
                    {"REDIS_URL": f"redis://:top-secret@127.0.0.1:{redis.port}/0"},
                    clear=False,
                ), patch("sys.argv", argv), contextlib.redirect_stdout(output):
                    result = runtime_snapshot.main()

            self.assertEqual(result, 0)
            lines = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(len(lines), 5)
            self.assertTrue(all(line["schemaVersion"] == "1.0" for line in lines))
            self.assertTrue(all(line["status"] == "ok" for line in lines))
            self.assertIn("/minio/health/ready", json.dumps(lines))
            rendered = output.getvalue()
            self.assertNotIn("top-secret", rendered)
            self.assertNotIn("redis://", rendered)
            self.assertNotIn("postgresql://", rendered)
        finally:
            redis.close()

    def test_failure_is_structured_without_echoing_redis_url(self):
        output = io.StringIO()
        with patch.dict(
            os.environ,
            {"REDIS_URL": "redis://:very-secret@127.0.0.1:1/0"},
            clear=False,
        ), patch(
            "sys.argv",
            [
                "runtime_snapshot.py",
                "--api-url",
                "http://127.0.0.1:1/health",
                "--object-storage-base",
                "http://127.0.0.1:1",
                "--postgres-port",
                "1",
            ],
        ), contextlib.redirect_stdout(output):
            result = runtime_snapshot.main()

        self.assertEqual(result, 1)
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(lines[-1]["component"], "platform")
        self.assertEqual(lines[-1]["status"], "error")
        rendered = output.getvalue()
        self.assertNotIn("very-secret", rendered)
        self.assertNotIn("redis://", rendered)


if __name__ == "__main__":
    unittest.main()
