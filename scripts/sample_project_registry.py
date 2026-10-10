"""Register one persistent synthetic project alongside the default development site.

The registry is DEVELOPMENT ONLY. It neither creates user credentials nor touches
any operational database. Idempotent, and preserves both projects' original IDs.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path

from scripts.mock_project_setup import FIXTURE_KEY, setup as setup_mock, _project_configuration
from scripts.sample_project_materials import LOCATIONS
from app.reference.engine import uid
from uuid import uuid5, NAMESPACE_URL
from services.api.store import SQLiteSnapshotAdapter

SAMPLE_NAME = "DOUL SAMPLE · WWT 공장 (합성 시험자료)"
TRADES = ("architecture", "structure", "mechanical", "electrical")
EXTRA_STAFF = (
    ("SUP", "SYNTHETIC · 감리 토목 담당"),
    ("SUP", "SYNTHETIC · 감리 구조 담당"),
    ("CON", "SYNTHETIC · 시공 현장소장"),
    ("CON", "SYNTHETIC · 시공 품질담당"),
    ("OWN", "SYNTHETIC · 발주처 기술담당"),
)
REGISTRY_VERSION = 1
CONTEXT_KEYS = ("projectId", "scope", "requirementRef", "drawingRef", "evidenceId", "analysisProfile")


def _entry(meta, project_name, *, sample=False):
    return {
        "projectId": meta["projectId"],
        "name": project_name,
        "sample": sample,
        "actors": deepcopy(meta["actors"]),
        "context": {key: deepcopy(meta[key]) for key in CONTEXT_KEYS if key in meta},
    }


def register(store: SQLiteSnapshotAdapter) -> dict:
    """Reuse mock_project_setup's safe marker; never delete another project."""
    if not isinstance(store, SQLiteSnapshotAdapter):
        raise RuntimeError("Sample registration requires a development-only SQLite store")
    info = setup_mock(store)
    with store.transaction(True):
        marker = store.meta.get("mockProjectSetup")
        if not marker or marker.get("key") != FIXTURE_KEY:
            raise RuntimeError("Unrecognized synthetic fixture; refusing registration")
        original = marker["previousMeta"]
        if "projectId" not in original or "actors" not in original:
            raise RuntimeError("Original development project is missing; refusing registration")
        sample_id = info["projectId"]
        if not store.meta.get("sampleLocations"):
            original_scope=store.meta["scope"]
            root=store.engine
            names={}
            for code,name,zone,floor in LOCATIONS:
                location_id=str(uuid5(NAMESPACE_URL, f"doul-sample:{sample_id}:location:{code}"))
                if ("Location",location_id) not in root._records:
                    root.bootstrap("Location", dict(id=location_id, projectId=sample_id, name=name,
                        semanticAnchor=f"sample/{zone}/{floor}/{code}"))
                    marker["owned"].append(["Location",location_id])
                names[code]=location_id
            store.meta["sampleLocations"]=names
            loc_ids=list(names.values())+[original_scope["locationId"]]
            primary=store.meta["actors"]
            for group,actor in primary.items():
                role=root._records[("RoleAssignment",actor["roleAssignmentId"])]
                role["disciplines"]=list(TRADES)
                role["locationIds"]=loc_ids
                for key in [k for k in root._history if k[:2]==("RoleAssignment",role["id"])]:
                    root._history[key]=deepcopy(role)
                for qid in role["qualificationIds"]:
                    qualification=root._records[("Qualification",qid)]
                    qualification["disciplines"]=list(TRADES)
                    for key in [k for k in root._history if k[:2]==("Qualification",qid)]:
                        root._history[key]=deepcopy(qualification)
            for offset,(group,name) in enumerate(EXTRA_STAFF):
                base=root.get("RoleAssignment",primary[group]["roleAssignmentId"])
                new_id=str(uuid5(NAMESPACE_URL,f"doul-sample:{sample_id}:staff:{offset}"))
                assignment_id=str(uuid5(NAMESPACE_URL,f"doul-sample:{sample_id}:assignment:{offset}"))
                qualification_id=str(uuid5(NAMESPACE_URL,f"doul-sample:{sample_id}:qualification:{offset}"))
                if ("Party",new_id) in root._records:
                    continue
                root.bootstrap("Party",dict(id=new_id,projectId=sample_id,kind="PERSON",
                    name=name,loginEnabled=False,organizationId=base["organizationId"]))
                root.bootstrap("Qualification",dict(id=qualification_id,projectId=sample_id,
                    partyId=new_id,number=f"SYNTHETIC-ROLE-{offset+1}-NOT-A-CERTIFICATE",
                    rank=1,disciplines=list(TRADES),validFrom=base["validFrom"],
                    validTo=base["validTo"],verified=True,revoked=False))
                root.bootstrap("RoleAssignment",dict(id=assignment_id,projectId=sample_id,
                    partyId=new_id,organizationId=base["organizationId"],
                    actorGroup=group,roleCode=base["roleCode"],
                    authorityCodes=deepcopy(base["authorityCodes"]),disciplines=list(TRADES),
                    packageIds=deepcopy(base["packageIds"]),locationIds=loc_ids,
                    qualificationIds=[qualification_id],validFrom=base["validFrom"],
                    validTo=base["validTo"],active=True,approvedBy=primary["ADM"]["partyId"]))
                marker["owned"].extend([["Party",new_id],["Qualification",qualification_id],
                                        ["RoleAssignment",assignment_id]])
            sample_roles=[r for (kind,_),r in root._records.items()
                          if kind=="RoleAssignment" and r["projectId"]==sample_id
                          and r["actorGroup"] in ("SUP","CON","OWN","DES","ADM")]
            pack=_project_configuration(root,sample_id,primary,sample_roles,
                original_scope["packageId"],original_scope["locationId"],
                original_scope["discipline"],store.meta["projectConfiguration"]["effectiveFrom"])
            pack["scopes"]["disciplines"]=list(TRADES)
            pack["scopes"]["locations"]=loc_ids
            store.meta["projectConfiguration"]=pack
            marker["projectConfiguration"]=deepcopy(pack)
        project = store.engine._records[("Project", sample_id)]
        project["name"] = SAMPLE_NAME
        project["qualificationRules"]=[{"discipline":trade,"minimumRank":1}
                                       for trade in TRADES]
        for key in [k for k in store.engine._history if k[:2] == ("Project", sample_id)]:
            store.engine._history[key] = deepcopy(project)
        base_project = store.engine.get("Project", original["projectId"])
        entries = {
            original["projectId"]: _entry(original, base_project["name"]),
            sample_id: _entry(store.meta, SAMPLE_NAME, sample=True),
        }
        store.meta["demoProjectDirectory"] = {
            "version": REGISTRY_VERSION, "defaultProjectId": sample_id, "projects": entries
        }
        return {
            "sampleProjectId": sample_id,
            "existingProjectId": original["projectId"],
            "created": info["created"],
            "projects": [{"id": e["projectId"], "name": e["name"], "sample": e["sample"]} for e in entries.values()],
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    args = parser.parse_args()
    db = Path(args.database).resolve()
    db.parent.mkdir(parents=True, exist_ok=True)
    store = SQLiteSnapshotAdapter(str(db), demo=True)
    try:
        print(json.dumps(register(store), ensure_ascii=False, indent=2))
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
