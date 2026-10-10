"""Create or remove a local synthetic project for DOUL API/UI usability work.

All identities and workflow records are synthetic. Fixture qualifications are
not credentials and this setup does not establish field acceptance.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.reference.engine import Engine, uid
from services.api.demo import seed as seed_demo_project
from services.api.store import SQLiteSnapshotAdapter
from scripts.product_schema_validation import validate_schema

FIXTURE_KEY = "mock-usability-project-v1"
HUMAN_GROUPS = ("SUP", "CON", "OWN", "DES", "ADM")
PRIMARY_NAMES = {
    "SUP": "SYNTHETIC · Supervisor",
    "CON": "SYNTHETIC · Contractor",
    "OWN": "SYNTHETIC · Owner",
    "DES": "SYNTHETIC · Designer",
    "ADM": "SYNTHETIC · Administrator",
}


def _stamp_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _project_configuration(engine, project_id, actors, role_assignments, package, location, discipline, effective_from):
    """Build a schema-valid pack from this project's actual role assignments."""
    schema = json.loads((ROOT / "app/schema/project_configuration_contract_v1.json").read_text())
    primary_roles = {role["id"]: role for role in role_assignments}
    owner_role_code = primary_roles[actors["OWN"]["roleAssignmentId"]]["roleCode"]
    organizations_by_id = {}
    for role in role_assignments:
        organizations_by_id[role["organizationId"]] = role["actorGroup"]

    authority_bindings = []
    for code, policy in sorted(engine.policies.items()):
        allowed_pairs = [role for role in role_assignments
                         if role["actorGroup"] in policy["actor_groups"]
                         and (not policy["role_codes"] or role["roleCode"] in policy["role_codes"])]
        if not allowed_pairs:
            continue
        binding_groups = sorted({role["actorGroup"] for role in allowed_pairs})
        binding_roles = sorted({role["roleCode"] for role in allowed_pairs})
        authority_bindings.append({
            "authorityCode": code,
            "implementationStatus": "active",
            "actorGroups": binding_groups,
            "roleCodes": binding_roles,
            "disciplineRequired": bool(policy["discipline_scope_required"]),
            "packageRequired": bool(policy["package_scope_required"]),
            "locationRequired": bool(policy["location_scope_required"]),
        })

    config = {
        "schemaVersion": "1.0",
        "configVersion": 1,
        "baselineVersion": "1.1",
        "projectId": project_id,
        "timezone": "Asia/Ho_Chi_Minh",
        "effectiveFrom": effective_from,
        "organizations": [
            {"organizationId": org_id, "actorGroup": group,
             "packageIds": [package], "locationIds": [location]}
            for org_id, group in sorted(organizations_by_id.items())
        ],
        "roleAssignments": [
            {"partyId": role["partyId"], "organizationId": role["organizationId"],
             "actorGroup": role["actorGroup"], "roleCode": role["roleCode"],
             "disciplineIds": list(role.get("disciplines", [])),
             "packageIds": list(role.get("packageIds", [])),
             "locationIds": list(role.get("locationIds", [])),
             "qualificationRefs": list(role.get("qualificationIds", []))}
            for role in role_assignments
        ],
        "qualificationRules": [
            {"roleCode": primary_roles[actors[group]["roleAssignmentId"]]["roleCode"], "minimumRank": 1,
             "requiredKinds": ["synthetic-fixture"], "validityRequired": True}
            for group in ("SUP", "CON")
        ],
        "scopes": {"disciplines": [discipline], "packages": [package], "locations": [location]},
        "authorityBindings": authority_bindings,
        "deadlineRules": [
            {"code": "mock.inspection.response", "source": "internal", "calculation": "hours",
             "value": 24, "timezone": "Asia/Ho_Chi_Minh"},
            {"code": "mock.owner.report", "source": "internal", "calculation": "hours",
             "value": 2, "timezone": "Asia/Ho_Chi_Minh"},
        ],
        "ownerReporting": {
            "priorities": [
                {"priority": priority, "receiptDueMinutes": receipt, "decisionDueMinutes": decision,
                 "recipientRoleCodes": [owner_role_code]}
                for priority, receipt, decision in (("P1", 30, 60), ("P2", 240, 1440),
                                                    ("P3", 1440, 4320), ("P4", 4320, 10080))
            ],
            "periodicCadences": [{"reportType": "mock_weekly", "cadence": "weekly",
                                  "recipientRoleCodes": [owner_role_code]}],
        },
        "forms": {"applicableFormIds": ["FM-07", "FM-12", "FM-17", "FM-19", "FM-20", "FM-21"],
                  "statutoryOriginals": []},
        "thresholds": {"schedule.criticalDelayDays": 7, "payment.reportVariancePercent": 10,
                       "safety.majorStopHours": 4},
        "mediaPolicy": {"enabled": True, "allowedModes": ["photo", "keyframes", "adaptive"],
                        "autoRetry": {"maxAttempts": 1, "backoffSeconds": [30]},
                        "userReanalysisAllowed": True, "externalTransferPolicy": "forbidden",
                        "retentionDays": 30, "redactionRequiredForSharing": True,
                        "originalExportAllowed": False, "perRunCostLimit": 0,
                        "monthlyCostLimit": 0, "costCurrency": "USD",
                        "providerRegionRule": "local-fixture-only"},
        "acceptanceScenarioIds": ["AC-Q-01", "AC-AUTH-01", "AC-IDEMP-01"],
    }
    validate_schema(config, schema)
    return config


def _add_negative_identities(store, project_id, scope, base_roles, start, end):
    """Add real-schema role/qualification records for direct negative checks."""
    engine = store.engine
    roles = {role["actorGroup"]: role for role in base_roles}
    under_party, under_qualification, under_role = uid(), uid(), uid()
    readonly_party, readonly_role = uid(), uid()

    engine.bootstrap("Party", {"id": under_party, "projectId": project_id, "kind": "PERSON",
        "name": "SYNTHETIC · Insufficient qualification", "loginEnabled": False,
        "organizationId": roles["SUP"]["organizationId"]})
    engine.bootstrap("Qualification", {"id": under_qualification, "projectId": project_id,
        "partyId": under_party, "number": "SYNTHETIC-RANK-3-NOT-A-CREDENTIAL", "rank": 3,
        "disciplines": [scope["discipline"]], "validFrom": start, "validTo": end,
        "verified": True, "revoked": False})
    under_assignment = {"id": under_role, "projectId": project_id, "partyId": under_party,
        "organizationId": roles["SUP"]["organizationId"], "actorGroup": "SUP",
        "roleCode": roles["SUP"]["roleCode"],
        "authorityCodes": ["close_issue", "render_document"],
        "disciplines": list(scope["disciplines"]), "packageIds": [scope["packageId"]],
        "locationIds": [scope["locationId"]], "qualificationIds": [under_qualification],
        "validFrom": start, "validTo": end, "active": True, "approvedBy": roles["SUP"]["partyId"]}
    engine.bootstrap("RoleAssignment", under_assignment)

    engine.bootstrap("Party", {"id": readonly_party, "projectId": project_id, "kind": "PERSON",
        "name": "SYNTHETIC · Read-only contractor", "loginEnabled": False,
        "organizationId": roles["CON"]["organizationId"]})
    readonly_assignment = {"id": readonly_role, "projectId": project_id, "partyId": readonly_party,
        "organizationId": roles["CON"]["organizationId"], "actorGroup": "CON",
        "roleCode": roles["CON"]["roleCode"], "authorityCodes": ["render_document"],
        "disciplines": list(scope["disciplines"]), "packageIds": [scope["packageId"]],
        "locationIds": [scope["locationId"]], "qualificationIds": [],
        "validFrom": start, "validTo": end, "active": True, "approvedBy": roles["ADM"]["partyId"]}
    engine.bootstrap("RoleAssignment", readonly_assignment)
    return {
        "insufficientQualification": {"partyId": under_party, "roleAssignmentId": under_role,
            "qualificationId": under_qualification, "actorGroup": "SUP"},
        "readOnly": {"partyId": readonly_party, "roleAssignmentId": readonly_role,
            "actorGroup": "CON"},
    }


def setup(store: SQLiteSnapshotAdapter) -> dict:
    """Idempotently seed full mock workflows and select their project for demo logins."""
    with store.transaction(True):
        existing = store.meta.get("mockProjectSetup")
        if existing:
            if existing.get("key") != FIXTURE_KEY:
                raise RuntimeError("Unrecognized fixture owner marker; refusing to modify it")
            missing = [(kind, oid) for kind, oid in existing.get("owned", [])
                       if (kind, oid) not in store.engine._records]
            missing_blobs = [oid for oid in existing.get("ownedBlobs", [])
                             if store.db.execute("SELECT 1 FROM blobs WHERE id=?", (oid,)).fetchone() is None]
            if missing or missing_blobs:
                raise RuntimeError("Fixture owner marker references missing records or blobs; refusing to reuse it")
            return {"projectId": existing["projectId"], "created": False,
                    "actors": existing["actors"], "negativeActors": existing["negativeActors"]}

        previous_meta = deepcopy(store.meta)
        before = set(store.engine._records)
        seeded = seed_demo_project(store.engine)
        project_id = seeded["projectId"]
        actors = seeded["actors"]
        scope = seeded["scope"]
        project = store.engine._records[("Project", project_id)]
        project["name"] = "SYNTHETIC USABILITY PROJECT · NOT FIELD ACCEPTANCE"
        # The regular demo data is intentionally rank 1 (strongest). A rank 3
        # assignment below provides a real-schema insufficient-rank example.
        project["qualificationRules"] = [{"discipline": scope["discipline"], "minimumRank": 1}]
        for history_key in [key for key in store.engine._history if key[:2] == ("Project", project_id)]:
            store.engine._history[history_key] = deepcopy(project)
        for group, actor in actors.items():
            actor["name"] = PRIMARY_NAMES.get(group, f"SYNTHETIC · {group}")
            party_key = ("Party", actor["partyId"])
            store.engine._records[party_key]["name"] = actor["name"]
            for history_key in [key for key in store.engine._history if key[:2] == party_key]:
                store.engine._history[history_key] = deepcopy(store.engine._records[party_key])
        for service_actor in seeded["serviceActors"].values():
            party_key = ("Party", service_actor["partyId"])
            party = store.engine._records[party_key]
            party["name"] = "SYNTHETIC · " + party["name"]
            service_actor["name"] = party["name"]
            for history_key in [key for key in store.engine._history if key[:2] == party_key]:
                store.engine._history[history_key] = deepcopy(party)

        owned_actors = _add_negative_identities(
            store, project_id, {**scope, "disciplines": [scope["discipline"]]},
            [record for (kind, _), record in store.engine._records.items()
             if kind == "RoleAssignment" and record["projectId"] == project_id],
            store.engine.get("RoleAssignment", actors["SUP"]["roleAssignmentId"])["validFrom"],
            store.engine.get("RoleAssignment", actors["SUP"]["roleAssignmentId"])["validTo"],
        )
        owned = sorted([[kind, oid] for kind, oid in set(store.engine._records) - before])
        blob_contents = seeded.pop("blobs")
        owned_blobs = sorted(blob_contents)
        for file_id, content in blob_contents.items():
            store.put_blob(file_id, content)

        organizations = {}
        role_assignments = []
        for (kind, _), role in store.engine._records.items():
            if (kind != "RoleAssignment" or role.get("projectId") != project_id
                    or role.get("actorGroup") not in HUMAN_GROUPS):
                continue
            role_assignments.append(role)
            organizations.setdefault(role["actorGroup"], role["organizationId"])
        config = _project_configuration(store.engine, project_id, actors, role_assignments,
            scope["packageId"], scope["locationId"], scope["discipline"], _stamp_now())

        previous_context = previous_meta
        fixture_meta = deepcopy(seeded)
        fixture_meta["projectConfiguration"] = config
        fixture_meta["actors"] = actors
        fixture_meta["negativeActors"] = owned_actors
        fixture_meta["mockProjectSetup"] = {
            "key": FIXTURE_KEY, "projectId": project_id, "owned": owned,
            "ownedBlobs": owned_blobs, "actors": deepcopy(actors),
            "negativeActors": owned_actors, "previousMeta": previous_context,
            "projectConfiguration": config,
        }
        fixture_meta["scope"] = scope
        store.meta.clear()
        store.meta.update(fixture_meta)
        return {"projectId": project_id, "created": True, "actors": actors,
                "negativeActors": owned_actors, "evidenceId": seeded["evidenceId"]}


def cleanup(store: SQLiteSnapshotAdapter) -> dict:
    """Remove only records/blobs named in this setup's owner marker."""
    with store.transaction(True):
        marker = store.meta.get("mockProjectSetup")
        if not marker or marker.get("key") != FIXTURE_KEY:
            raise RuntimeError("Mock fixture owner marker is missing or unknown; refusing cleanup")
        project = marker["projectId"]
        owned = {tuple(entry) for entry in marker["owned"]}
        if any(upload.get("public", {}).get("projectId") == project for upload in store.uploads.values()):
            raise RuntimeError("Fixture project has later upload sessions; refusing cleanup")
        if any(document.get("projectId") == project for document in store.documents._snapshots.values()):
            raise RuntimeError("Fixture project has later document snapshots; refusing cleanup")
        unexpected = [(kind, oid) for (kind, oid), record in store.engine._records.items()
                      if record.get("projectId") == project and (kind, oid) not in owned]
        if unexpected:
            raise RuntimeError("Fixture project has unowned records; refusing cleanup: " + repr(unexpected[:5]))
        for kind, oid in owned:
            store.engine._records.pop((kind, oid), None)
            for history_key in [key for key in store.engine._history if key[:2] == (kind, oid)]:
                store.engine._history.pop(history_key, None)
            store.engine._record_machines.pop((kind, oid), None)
        for file_id in marker.get("ownedBlobs", []):
            store.db.execute("DELETE FROM blobs WHERE id=?", (file_id,))
        store.engine._audit = [event for event in store.engine._audit if event.get("projectId") != project]
        store.engine._idempotency = {key: value for key, value in store.engine._idempotency.items()
            if not (isinstance(key, tuple) and key and key[0] == project)}
        previous_meta = marker["previousMeta"]
        store.meta.clear()
        store.meta.update(previous_meta)
        return {"projectId": project, "removedRecords": len(owned),
                "removedBlobs": len(marker.get("ownedBlobs", []))}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="Dedicated local development SQLite database")
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
