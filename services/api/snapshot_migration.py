"""Read-only preflight for migrating the v1 engine snapshot to relational records.

This module DOES NOT update the database. It validates every version in the
current immutable Engine history against its latest record and returns a
deterministic, project-scoped manifest for a future shadow backfill.

Document bytes, credentials, identity bindings, event/idempotency journals and
evidence originals remain in their existing stores until separately migrated.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Any


class SnapshotMigrationError(ValueError):
    """Legacy snapshot cannot be safely projected without reconciliation."""


@dataclass(frozen=True)
class RecordVersion:
    project_id: str
    object_type: str
    object_id: str
    version: int
    subtype: str | None
    status: str | None
    payload_sha256: str
    payload: dict[str, Any]


def _pairs(value: Any, length: int, name: str) -> dict[tuple, dict]:
    if not isinstance(value, list):
        raise SnapshotMigrationError(f"{name}: expected encoded map list")
    output: dict[tuple, dict] = {}
    for pair in value:
        if not isinstance(pair, list) or len(pair) != 2:
            raise SnapshotMigrationError(f"{name}: invalid encoded map entry")
        raw_key, record = pair
        if (not isinstance(raw_key, list) or len(raw_key) != length or
                not all(isinstance(part, str) and part for part in raw_key[:2]) or
                not isinstance(record, dict)):
            raise SnapshotMigrationError(f"{name}: invalid map key or payload")
        if length == 3 and (type(raw_key[2]) is not int or raw_key[2] < 1):
            raise SnapshotMigrationError(f"{name}: invalid historical version")
        key = tuple(raw_key)
        if key in output:
            raise SnapshotMigrationError(f"{name}: duplicate record key {key!r}")
        output[key] = record
    return output


def _identity(key: tuple, payload: dict) -> str:
    kind, object_id, *remaining = key
    version = remaining[0] if remaining else payload.get("version")
    if (payload.get("id") != object_id or
            type(payload.get("version")) is not int or payload["version"] < 1 or
            payload["version"] != version):
        raise SnapshotMigrationError(f"record identity/version mismatch: {key!r}")
    project = payload.get("projectId")
    # A root Project can predate the explicit projectId self-reference.
    if kind == "Project" and not project:
        project = object_id
    if not isinstance(project, str) or not project:
        raise SnapshotMigrationError(f"record missing projectId: {key!r}")
    if kind == "Project" and project != object_id:
        raise SnapshotMigrationError(f"Project id/scope mismatch: {key!r}")
    for field in ("status", "subtype"):
        if payload.get(field) is not None and not isinstance(payload[field], str):
            raise SnapshotMigrationError(f"non-text {field} in {key!r}")
    return project


def _digest(payload: dict) -> str:
    try:
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise SnapshotMigrationError("Record contains unserializable values") from exc
    return sha256(raw).hexdigest()


def snapshot_record_versions(state: dict[str, Any]) -> list[RecordVersion]:
    """Validate a v1 snapshot and return all immutable domain record versions.

    Raises on missing version, mismatched current record, changed source scope,
    duplicate keys or malformed payloads. This function never mutates *state*.
    """
    if not isinstance(state, dict) or state.get("format") != 1:
        raise SnapshotMigrationError("Unsupported snapshot format (expected v1)")
    engine = state.get("engine")
    if not isinstance(engine, dict):
        raise SnapshotMigrationError("Missing engine payload")
    current = _pairs(engine.get("_records"), 2, "_records")
    history = _pairs(engine.get("_history"), 3, "_history")

    identities: dict[str, tuple[str, str]] = {}
    for (kind, object_id, version), record in history.items():
        project = _identity((kind, object_id, version), record)
        previous = identities.setdefault(object_id, (project, kind))
        if previous != (project, kind):
            raise SnapshotMigrationError(f"Object ID reused across projects/types: {object_id}")
    for (kind, object_id), record in current.items():
        project = _identity((kind, object_id), record)
        if (kind, object_id, record["version"]) not in history:
            raise SnapshotMigrationError(f"Current version not in history: {kind}/{object_id}")
        if history[(kind, object_id, record["version"])] != record:
            raise SnapshotMigrationError(f"Current record disagrees with history: {kind}/{object_id}")
        if identities.get(object_id) != (project, kind):
            raise SnapshotMigrationError(f"Current record scope differs from history: {kind}/{object_id}")
    for kind, object_id, version in history:
        if (kind, object_id) not in current:
            raise SnapshotMigrationError(f"Historical object missing latest record: {kind}/{object_id}")
        if version > current[(kind, object_id)]["version"]:
            raise SnapshotMigrationError(f"History extends beyond current version: {kind}/{object_id}")

    rows = []
    for (kind, object_id, version), record in history.items():
        rows.append(RecordVersion(
            project_id=_identity((kind, object_id, version), record),
            object_type=kind,
            object_id=object_id,
            version=version,
            subtype=record.get("subtype"),
            status=record.get("status"),
            payload_sha256=_digest(record),
            payload=deepcopy(record),
        ))
    rows.sort(key=lambda x: (x.project_id, x.object_type, x.object_id, x.version))
    return rows


def snapshot_preflight_summary(state: dict[str, Any]) -> dict[str, Any]:
    """Safe summary only: returns counts/hashes, not record contents or secrets."""
    rows = snapshot_record_versions(state)
    counts = Counter(row.project_id for row in rows)
    combined = sha256("".join(
        f"{r.project_id}:{r.object_type}:{r.object_id}:{r.version}:{r.payload_sha256}\n"
        for r in rows
    ).encode("utf-8")).hexdigest()
    return {
        "snapshot_format": 1,
        "record_versions": len(rows),
        "distinct_records": len({(r.object_type, r.object_id) for r in rows}),
        "project_version_counts": dict(sorted(counts.items())),
        "manifest_sha256": combined,
        "runtime_storage_switched": False,
    }
