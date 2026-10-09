#!/usr/bin/env python3
"""Run the real backup and new-target restore scripts against disposable PG."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import argparse
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = """name: doul-goal-ops
services:
  postgres:
    image: postgres:16-bookworm
    container_name: doul-goal-ops-postgres
    environment:
      POSTGRES_DB: ops_source
      POSTGRES_USER: ops
      POSTGRES_PASSWORD: disposable-only
      POSTGRES_HOST_AUTH_METHOD: scram-sha-256
    ports:
      - 127.0.0.1:15434:5432
    tmpfs:
      - /var/lib/postgresql/data:rw,noexec,nosuid,size=256m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 1s
      timeout: 2s
      retries: 30
"""


def run(command: list[str], *, env: dict | None = None, input: str | None = None) -> str:
    result = subprocess.run(command, cwd=ROOT, env=env, input=input, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    if result.returncode:
        raise RuntimeError(f"command failed ({result.returncode}): {command[0]} {command[1:]}\n{result.stderr[-2000:]}")
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    stamp = time.time()
    payload = "synthetic-postgresql-backup-probe-2026-10-08"
    payload_hash = hashlib.sha256(payload.encode()).hexdigest()
    with tempfile.TemporaryDirectory(prefix="doul-ops-pg-") as temp:
        root = Path(temp)
        compose_file = root / "compose.yml"
        compose_file.write_text(COMPOSE)
        backup_dir = root / "backups"
        backup_dir.mkdir(mode=0o700)
        dump = backup_dir / "source.dump"
        compose = ["docker", "compose", "-p", "doul-goal-ops", "-f", str(compose_file)]
        env = dict(os.environ, DOUL_COMPOSE_FILE=str(compose_file))
        started = False
        try:
            run(compose + ["up", "-d", "--wait"])
            started = True
            run(compose + ["exec", "-T", "postgres", "sh", "-ec",
                           "psql -w -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" "
                           "-c 'CREATE TABLE operational_probe (id integer primary key, payload text not null, payload_sha256 text not null)' "
                           f"-c \"INSERT INTO operational_probe VALUES (1, '{payload}', '{payload_hash}')\""])
            backup_output = run(["sh", str(ROOT / "infra/backup/postgres_backup.sh"), "ops_source", str(dump)], env=env)
            checksum = hashlib.sha256(dump.read_bytes()).hexdigest()
            sidecar = Path(str(dump) + ".sha256").read_text().strip()
            if checksum != sidecar:
                raise RuntimeError("backup SHA-256 sidecar does not match dump bytes")
            restore_output = run(["sh", str(ROOT / "infra/backup/postgres_restore_clean.sh"), str(dump), "ops_restored"], env=env)
            restored = run(compose + ["exec", "-T", "postgres", "sh", "-ec",
                                      "psql -w -At -F '|' -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d ops_restored "
                                      "-c 'SELECT id, payload, payload_sha256 FROM operational_probe ORDER BY id'"])
            if restored != f"1|{payload}|{payload_hash}":
                raise RuntimeError("restored row payload/hash differs from source probe")
            report = {
                "service": "PostgreSQL",
                "image": "postgres:16-bookworm",
                "container": "doul-goal-ops-postgres",
                "port": 15434,
                "sourceDatabase": "ops_source",
                "restoredDatabase": "ops_restored",
                "sourceRows": 1,
                "restoredRows": 1,
                "payloadSha256": payload_hash,
                "dumpSha256": checksum,
                "backupMode": oct(dump.stat().st_mode & 0o777),
                "sidecarMode": oct(Path(str(dump) + ".sha256").stat().st_mode & 0o777),
                "restoreOutput": restore_output,
                "backupOutput": backup_output.splitlines()[0],
                "durationSeconds": round(time.time() - stamp, 3),
                "status": "passed",
            }
            rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(rendered)
            print(rendered, end="")
            return 0
        finally:
            if started:
                subprocess.run(compose + ["down"], cwd=ROOT, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=60)


if __name__ == "__main__":
    raise SystemExit(main())
