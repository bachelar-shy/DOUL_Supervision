"""Isolated FastAPI fixture with two overlapping trusted Inspection baselines.

The additional active Requirement and its link on the unstarted scheduled
Inspection are trusted startup configuration for this browser test. The
Inspection remains scheduled and has no result rows; all result authoring and
submission in the test use the real API through the UI.
"""

import argparse
from copy import deepcopy
import os

import uvicorn

from app.reference.engine import uid
from services.api.main import create_app


def configure_fixture(app):
    store = app.state.store
    with store.transaction(write=True):
        engine = store.engine
        original_ref = deepcopy(store.meta["requirementRef"])
        original_requirement = engine.get("Requirement", original_ref["objectId"])
        source_inspections = [
            record for (kind, _), record in engine._records.items()
            if kind == "Inspection"
            and record["projectId"] == store.meta["projectId"]
            and record.get("status") == "scheduled"
            and not record.get("checkResults")
        ]
        if len(source_inspections) != 1:
            raise RuntimeError("Expected exactly one empty scheduled demo Inspection")

        alternate_id = uid()
        alternate_payload = deepcopy(original_requirement)
        for server_field in ("id", "projectId", "version", "createdAt", "updatedAt", "createdBy"):
            alternate_payload.pop(server_field, None)
        alternate_payload["title"] = "Synthetic overlapping dimension baseline"
        alternate = engine.bootstrap("Requirement", {
            "id": alternate_id,
            "projectId": store.meta["projectId"],
            **alternate_payload,
        })
        alternate_ref = {
            "objectType": "Requirement",
            "objectId": alternate["id"],
            "version": alternate["version"],
        }

        # This is startup baseline configuration only. Preserve the demo
        # Inspection's scheduled status, version, and empty result set.
        inspection = deepcopy(source_inspections[0])
        inspection["requirementRefs"] = [original_ref, alternate_ref]
        engine._save("Inspection", inspection)
        store.meta["overlapRequirementRef"] = alternate_ref
        store.meta["overlapInspectionId"] = inspection["id"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.getenv("DOUL_INSPECTION_FIXTURE_PORT", "8799")))
    parser.add_argument("--database", default=os.getenv("DOUL_INSPECTION_FIXTURE_DB", ".local/inspection-result.sqlite3"))
    args = parser.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(args.database)), exist_ok=True)
    app = create_app(args.database, demo=True)
    configure_fixture(app)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
