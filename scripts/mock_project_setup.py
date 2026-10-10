"""Create or remove a deterministic local usability fixture in a DOUL demo DB.

All people and evidence created here are synthetic. This fixture is for API/UI
development and usability review, never field acceptance or qualification proof.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
from uuid import UUID, uuid5

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.reference.engine import Engine
from services.api.store import SQLiteSnapshotAdapter
from scripts.product_schema_validation import validate_schema

NAMESPACE = UUID("8c954d6e-13db-4fc7-8d7d-41eb37b32010")
FIXTURE_KEY = "mock-usability-project-v1"
GROUPS = {
    "SUP": ("chief_supervisor", "SYNTHETIC · Supervisor"),
    "CON": ("contractor_technical_lead", "SYNTHETIC · Contractor"),
    "OWN": ("owner_decision_maker", "SYNTHETIC · Owner"),
    "ADM": ("project_admin", "SYNTHETIC · Administrator"),
}


def ident(name: str) -> str:
    return str(uuid5(NAMESPACE, name))


def stamp(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _photo_png(label_seed: int) -> bytes:
    """Small synthetic site-photo stand-in, PNG encoded with the stdlib only."""
    import struct
    import zlib

    width, height = 320, 200
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            # A simple construction-like color field with a visible diagonal
            # grid. This is a test image, not a photograph of a real site.
            grid = (x + y + label_seed * 17) % 48 < 2
            if y < 42:
                rgb = (88, 152, 190)
            elif y > 148:
                rgb = (151, 131, 99)
            elif 82 < x < 236:
                rgb = (218, 201, 164) if not grid else (112, 98, 78)
            else:
                rgb = (163, 170, 159) if not grid else (90, 102, 96)
            row.extend(rgb)
        rows.append(bytes(row))

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    raw = b"".join(rows)
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _project_configuration(project_id, orgs, actors, qualifications, package, location, discipline, now):
    schema = json.loads((ROOT / "app/schema/project_configuration_contract_v1.json").read_text())
    policies = Engine().policies
    authority_bindings = []
    for code, policy in sorted(policies.items()):
        groups = sorted(set(policy["actor_groups"]) & set(GROUPS))
        if not groups:
            continue
        roles = sorted(set(policy.get("role_codes") or [GROUPS[group][0] for group in groups]))
        # Keep only actor/role pairs allowed by this exact engine policy.
        valid = [group for group in groups if GROUPS[group][0] in roles]
        if not valid:
            continue
        authority_bindings.append({
            "authorityCode": code,
            "implementationStatus": "active",
            "actorGroups": valid,
            "roleCodes": [GROUPS[group][0] for group in valid],
            "disciplineRequired": True,
            "packageRequired": True,
            "locationRequired": True,
        })

    config = {
        "schemaVersion": "1.0", "configVersion": 1, "baselineVersion": "1.0",
        "projectId": project_id, "timezone": "Asia/Ho_Chi_Minh", "effectiveFrom": stamp(now),
        "organizations": [dict(organizationId=orgs[g], actorGroup=g, packageIds=[package], locationIds=[location]) for g in GROUPS],
        "roleAssignments": [dict(
            partyId=actors[g]["partyId"], organizationId=orgs[g], actorGroup=g,
            roleCode=GROUPS[g][0], disciplineIds=[discipline], packageIds=[package],
            locationIds=[location], qualificationRefs=([qualifications[g]] if g in qualifications else []),
        ) for g in GROUPS],
        "qualificationRules": [
            {"roleCode": GROUPS["SUP"][0], "minimumRank": 3, "requiredKinds": ["supervision"], "validityRequired": True},
            {"roleCode": GROUPS["CON"][0], "minimumRank": 3, "requiredKinds": ["construction"], "validityRequired": True},
        ],
        "scopes": {"disciplines": [discipline], "packages": [package], "locations": [location]},
        "authorityBindings": authority_bindings,
        "deadlineRules": [
            {"code": "mock.inspection.response", "source": "internal", "calculation": "hours", "value": 24, "timezone": "Asia/Ho_Chi_Minh"},
            {"code": "mock.owner.report", "source": "internal", "calculation": "hours", "value": 2, "timezone": "Asia/Ho_Chi_Minh"},
        ],
        "ownerReporting": {"priorities": [
            {"priority": p, "receiptDueMinutes": r, "decisionDueMinutes": d, "recipientRoleCodes": [GROUPS["OWN"][0]]}
            for p, r, d in (("P1", 30, 60), ("P2", 240, 1440), ("P3", 1440, 4320), ("P4", 4320, 10080))
        ], "periodicCadences": [{"reportType": "mock_weekly", "cadence": "weekly", "recipientRoleCodes": [GROUPS["OWN"][0]]}]},
        "forms": {"applicableFormIds": ["FM-07", "FM-12", "FM-17", "FM-19", "FM-20", "FM-21"], "statutoryOriginals": []},
        "thresholds": {"schedule.criticalDelayDays": 7, "payment.reportVariancePercent": 10, "safety.majorStopHours": 4},
        "mediaPolicy": {"enabled": True, "allowedModes": ["photo", "keyframes"],
            "autoRetry": {"maxAttempts": 1, "backoffSeconds": [30]}, "userReanalysisAllowed": True,
            "externalTransferPolicy": "forbidden", "retentionDays": 30,
            "redactionRequiredForSharing": True, "originalExportAllowed": False,
            "perRunCostLimit": 0, "monthlyCostLimit": 0, "costCurrency": "USD",
            "providerRegionRule": "local-fixture-only"},
        "acceptanceScenarioIds": ["AC-Q-01", "AC-AUTH-01", "AC-IDEMP-01"],
    }
    validate_schema(config, schema)
    return config


def setup(store: SQLiteSnapshotAdapter) -> dict:
    """Idempotently add the fixture and select it for /dev/sessions."""
    with store.transaction(True):
        previous = store.meta.get("mockProjectSetup")
        if previous:
            if previous.get("key") != FIXTURE_KEY:
                raise RuntimeError("Unrecognized fixture owner marker; refusing to modify it")
            missing = [(kind, oid) for kind, oid in previous.get("owned", [])
                       if kind != "Blob" and (kind, oid) not in store.engine._records]
            missing_blobs = [oid for kind, oid in previous.get("owned", []) if kind == "Blob"
                             and store.db.execute("SELECT 1 FROM blobs WHERE id=?", (oid,)).fetchone() is None]
            if missing or missing_blobs:
                raise RuntimeError("Fixture owner marker references missing records or blobs; refusing to reuse it")
            return {"projectId": previous["projectId"], "created": False, "actors": previous["actors"]}

        now = datetime.now(timezone.utc)
        start, end = stamp(now - timedelta(days=1)), stamp(now + timedelta(days=365))
        project, package, location, discipline = ident("project"), ident("package"), ident("location"), "architecture"
        organizations = {g: ident("organization:" + g) for g in GROUPS}
        actors, qualifications = {}, {}
        owned = []

        def add(kind, record):
            store.engine.bootstrap(kind, record)
            owned.append([kind, record["id"]])

        add("Project", {"id": project, "projectId": project, "name": "SYNTHETIC USABILITY PROJECT · NOT FIELD ACCEPTANCE",
            "country": "VN", "timezone": "Asia/Ho_Chi_Minh", "qualificationRules": [
                {"discipline": discipline, "minimumRank": 3}]})
        add("Location", {"id": location, "projectId": project, "name": "SYNTHETIC · Zone A / Level 2",
            "semanticAnchor": "synthetic/mock-usability/A/2F"})

        for group, (role_code, display_name) in GROUPS.items():
            party, role = ident("party:" + group), ident("role:" + group)
            actors[group] = {"partyId": party, "roleAssignmentId": role,
                "name": display_name, "actorGroup": group}
            add("Party", {"id": party, "projectId": project, "kind": "PERSON",
                "name": display_name, "loginEnabled": True, "organizationId": organizations[group]})
            qualification_ids = []
            if group in ("SUP", "CON"):
                qualification = ident("qualification:" + group)
                qualifications[group] = qualification
                qualification_ids = [qualification]
                add("Qualification", {"id": qualification, "projectId": project, "partyId": party,
                    "number": "SYNTHETIC-NOT-A-CERTIFICATE", "rank": 1,
                    "disciplines": [discipline], "validFrom": start, "validTo": end,
                    "verified": True, "revoked": False})
            policy_codes = [code for code, policy in store.engine.policies.items() if group in policy["actor_groups"]]
            add("RoleAssignment", {"id": role, "projectId": project, "partyId": party,
                "organizationId": organizations[group], "actorGroup": group, "roleCode": role_code,
                "authorityCodes": policy_codes, "disciplines": [discipline], "packageIds": [package],
                "locationIds": [location], "qualificationIds": qualification_ids,
                "validFrom": start, "validTo": end, "active": True, "approvedBy": party})

        config = _project_configuration(project, organizations, actors, qualifications, package, location, discipline, now)

        # Add two fully synthetic photo fixtures as ordinary evidence blobs.
        photo_ids = []
        for index in (1, 2):
            content = _photo_png(index)
            file_id, evidence_id = ident(f"photo-file:{index}"), ident(f"photo-evidence:{index}")
            store.put_blob(file_id, content)
            photo_ids.append(evidence_id)
            store.engine.add_evidence(evidence_id, project, {
                "sourceType": "original", "mediaType": "photo", "fileId": file_id,
                "fileHash": hashlib.sha256(content).hexdigest(), "sourcePartyId": actors["CON"]["partyId"],
                "metadata": {"demo": True, "mockFixture": True, "mimeType": "image/png",
                    "name": f"SYNTHETIC-usability-photo-{index}.png", "description": "Generated test image; not a site photograph."},
                "packageId": package, "locationId": location, "discipline": discipline,
                "responsibleOrganizationId": organizations["CON"],
            }, content, actors["CON"]["partyId"], actors["CON"]["roleAssignmentId"], ident(f"photo-upload:{index}"))
            owned.extend([["Evidence", evidence_id], ["Blob", file_id]])

        previous_context = {"projectId": deepcopy(store.meta.get("projectId")),
            "actors": deepcopy(store.meta.get("actors")), "scope": deepcopy(store.meta.get("scope")),
            "projectConfiguration": deepcopy(store.meta.get("projectConfiguration"))}
        store.meta["mockProjectSetup"] = {"key": FIXTURE_KEY, "projectId": project,
            "owned": owned, "actors": actors, "photoEvidenceIds": photo_ids,
            "previousContext": previous_context, "projectConfiguration": config}
        store.meta["projectId"] = project
        store.meta["actors"] = deepcopy(actors)
        store.meta["scope"] = {"packageId": package, "locationId": location,
            "discipline": discipline, "responsibleOrganizationId": organizations["CON"],
            "minimumQualificationRank": 3}
        store.meta["projectConfiguration"] = config
        return {"projectId": project, "created": True, "actors": actors, "photoEvidenceIds": photo_ids}


def cleanup(store: SQLiteSnapshotAdapter) -> dict:
    """Remove only deterministic records listed under this helper's owner marker."""
    with store.transaction(True):
        marker = store.meta.get("mockProjectSetup")
        if not marker or marker.get("key") != FIXTURE_KEY:
            raise RuntimeError("Mock fixture owner marker is missing or unknown; refusing cleanup")
        project = marker["projectId"]
        owned = {tuple(entry) for entry in marker["owned"]}
        unexpected = [(kind, oid) for (kind, oid), record in store.engine._records.items()
                      if record.get("projectId") == project and (kind, oid) not in owned]
        if unexpected:
            raise RuntimeError("Fixture project has unowned records; refusing cleanup: " + repr(unexpected[:5]))
        for kind, oid in owned:
            if kind == "Blob":
                store.db.execute("DELETE FROM blobs WHERE id=?", (oid,))
                continue
            store.engine._records.pop((kind, oid), None)
            store.engine._history.pop((kind, oid), None)
            store.engine._record_machines.pop((kind, oid), None)
        store.engine._audit = [event for event in store.engine._audit if event.get("projectId") != project]
        store.engine._idempotency = {
            key: value for key, value in store.engine._idempotency.items()
            if not (isinstance(key, tuple) and key and key[0] == project)
        }
        context = marker["previousContext"]
        for key, value in context.items():
            if value is None:
                store.meta.pop(key, None)
            else:
                store.meta[key] = value
        del store.meta["mockProjectSetup"]
        return {"projectId": project, "removedRecords": len(owned)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="Local development SQLite database")
    parser.add_argument("action", choices=("setup", "cleanup"))
    args = parser.parse_args()
    store = SQLiteSnapshotAdapter(args.database, demo=True)
    try:
        result = setup(store) if args.action == "setup" else cleanup(store)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
