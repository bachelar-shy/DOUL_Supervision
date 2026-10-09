#!/usr/bin/env python3
"""Exercise encrypted PostgreSQL + versioned-object recovery on disposable services."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import quote

from cryptography.exceptions import InvalidTag

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
COMPOSE_FILE = ROOT / "infra/verification/compose.ops-recovery.yml"
PROJECT = "doul-goal-ops-recovery"
COMPOSE = ["docker", "compose", "-p", PROJECT, "-f", str(COMPOSE_FILE)]


def run(command: list[str], *, env: dict | None = None, timeout: int = 180) -> str:
    result = subprocess.run(command, cwd=ROOT, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"command failed ({result.returncode}): {command[:4]}\n{result.stderr[-1500:]}")
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    from services.api.persistence import create_postgres_persistence
    from services.runtime_config import object_storage_client
    from services.recovery.bundle import ComposeBoundary, create_bundle, database_fingerprint, restore_bundle
    from services.recovery.objects import inventory
    from tests_mvp.test_worker_jobs import seed_source

    env = dict(os.environ,
               DATABASE_URL="postgresql://doul_dev:local-postgres-only@127.0.0.1:15434/doul_supervision",
               OBJECT_STORAGE_ENDPOINT="http://127.0.0.1:19000",
               OBJECT_STORAGE_ACCESS_KEY="doul-ops",
               OBJECT_STORAGE_SECRET_KEY="ops-disposable-only",
               OBJECT_STORAGE_BUCKET="doul-supervision-dev")
    os.environ.update(env)
    started = time.time()
    try:
        run(COMPOSE + ["up", "-d", "--wait", "postgres", "api", "worker-runtime", "object-storage"])
        bootstrap_client = object_storage_client()
        try:
            bootstrap_client.create_bucket(Bucket=env["OBJECT_STORAGE_BUCKET"])
        finally:
            bootstrap_client.close()
        store = create_postgres_persistence(env["DATABASE_URL"], demo=True)
        try:
            seed_source(store)
        finally:
            store.close()

        client = object_storage_client()
        bucket = env["OBJECT_STORAGE_BUCKET"]
        key = "source/한글-kiểm-tra & history.txt"
        try:
            client.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={"Status": "Enabled"})
            client.put_object(Bucket=bucket, Key=key, Body=b"version-one", ContentType="text/plain",
                              Metadata={"origin": "synthetic-ops"}, Tagging="revision=one")
            client.delete_object(Bucket=bucket, Key=key)
            client.put_object(Bucket=bucket, Key=key, Body=b"version-two", ContentType="text/plain",
                              Metadata={"origin": "synthetic-ops"}, Tagging="revision=two")
            client.put_object(Bucket=bucket, Key="now-deleted", Body=b"preserve-history")
            client.delete_object(Bucket=bucket, Key="now-deleted")
            source_versions = inventory(client, bucket)
            plan = json.loads((ROOT / "infra/backup/recovery_plan.example.json").read_text())
            plan["composeProject"] = PROJECT
            plan["composeFiles"] = ["infra/verification/compose.ops-recovery.yml"]
            plan["database"] = "doul_supervision"
            plan["bucket"] = bucket
            plan["releaseSha"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
            boundary = ComposeBoundary(plan)
            with tempfile.TemporaryDirectory(prefix="doul-ops-full-recovery-") as temp:
                root = Path(temp)
                encryption_key = os.urandom(32)
                bundle = root / "verified.backup.enc"
                backup = create_bundle(plan, bundle, encryption_key, client, env["DATABASE_URL"], boundary)
                if not backup["encrypted"] or backup["objectVersionCount"] != len(source_versions):
                    raise RuntimeError("encrypted bundle inventory differs from source object version history")
                if bundle.stat().st_mode & 0o777 != 0o600:
                    raise RuntimeError("encrypted bundle permissions are not 0600")
                original_fingerprint = database_fingerprint(env["DATABASE_URL"], plan["database"])

                class NeverMutate:
                    def restore_database(self, *args):
                        raise AssertionError("invalid archive reached target mutation")

                wrong_key_rejected = False
                try:
                    restore_bundle(bundle, os.urandom(32), client, env["DATABASE_URL"], NeverMutate())
                except InvalidTag:
                    wrong_key_rejected = True
                tampered = root / "tampered.backup.enc"
                data = bytearray(bundle.read_bytes())
                data[-32] ^= 1
                tampered.write_bytes(data)
                tamper_rejected = False
                try:
                    restore_bundle(tampered, encryption_key, client, env["DATABASE_URL"], NeverMutate())
                except InvalidTag:
                    tamper_rejected = True
                if not wrong_key_rejected or not tamper_rejected:
                    raise RuntimeError("wrong key or tampered archive was accepted")

                result = restore_bundle(bundle, encryption_key, client, env["DATABASE_URL"], boundary)
                restored_dsn = env["DATABASE_URL"].rsplit("/", 1)[0] + "/" + result["targetDatabase"]
                database_matches = database_fingerprint(restored_dsn, result["targetDatabase"]) == original_fingerprint
                source_preserved = inventory(client, bucket) == source_versions
                target_versions = inventory(client, result["objects"]["bucket"])
                latest = {item["key"]: item for item in target_versions if item["isLatest"]}
                history_matches = (len(target_versions) == len(source_versions)
                                   and latest[key]["deleteMarker"] is False
                                   and latest["now-deleted"]["deleteMarker"] is True)
                private = False
                try:
                    urllib.request.urlopen(env["OBJECT_STORAGE_ENDPOINT"] + "/" + result["objects"]["bucket"]
                                           + "/" + quote(key, safe="/"), timeout=5)
                except urllib.error.HTTPError as exc:
                    private = exc.code in (401, 403)
                running = set(run(COMPOSE + ["ps", "--services", "--status", "running"]).splitlines())
                writers_resumed = {"api", "worker-runtime"} <= running
                checks = {
                    "databaseSnapshotAndBlobFingerprintMatches": database_matches,
                    "sourceObjectVersionsAndDeleteMarkersPreserved": source_preserved,
                    "restoredObjectVersionHistoryMatches": history_matches,
                    "restoredBucketAnonymousReadDenied": private,
                    "wrongEncryptionKeyRejectedBeforeTargetMutation": wrong_key_rejected,
                    "tamperedBundleRejectedBeforeTargetMutation": tamper_rejected,
                    "previouslyRunningWriterServicesResumed": writers_resumed,
                    "promotionRemainsUnapproved": result["promotionApproved"] is False,
                }
                if not all(checks.values()):
                    raise RuntimeError("one or more full recovery checks failed: " + str(checks))
                report = {
                    "service": "PostgreSQL 16 + RustFS 1.0.1",
                    "composeProject": PROJECT,
                    "containerPrefix": "doul-goal-ops-recovery",
                    "ports": {"postgres": 15434, "s3": 19000},
                    "backupEncrypted": backup["encrypted"],
                    "sourceObjectVersionCount": len(source_versions),
                    "restoredObjectVersionCount": len(target_versions),
                    "restoredDatabase": result["targetDatabase"],
                    "bundleSha256": backup["bundleSha256"],
                    "checks": checks,
                    "restoreDurationSeconds": result["durationSeconds"],
                    "totalDurationSeconds": round(time.time() - started, 3),
                    "status": "passed",
                    "scopeLimit": "Synthetic disposable source snapshot only; this does not certify a project/site recovery or set RPO/RTO.",
                }
                rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
                if args.output:
                    args.output.parent.mkdir(parents=True, exist_ok=True)
                    args.output.write_text(rendered)
                print(rendered, end="")
        finally:
            client.close()
        return 0
    finally:
        subprocess.run(COMPOSE + ["down", "-v", "--remove-orphans"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)


if __name__ == "__main__":
    raise SystemExit(main())
