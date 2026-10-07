"""Tests for append-only PDF markup metadata and transactional issue links."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.reference.engine import uid
from app.reference.validation import require
from services.api.modules.drawing_markups import install_drawing_markup_routes
from services.api.store import SQLiteSnapshotAdapter

PDF = b"%PDF-1.7\n% wave three synthetic fixture\n%%EOF\n"


class DrawingMarkupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp.name) / "state.sqlite3")
        self.store = SQLiteSnapshotAdapter(self.db_path)
        self.project = self.store.meta["projectId"]
        self.actor = deepcopy(self.store.meta["actors"]["ADM"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        self.drawing = next(record for (kind, _), record in self.store.engine._records.items()
                            if kind == "InformationItem" and record.get("subtype") == "Drawing")
        self.drawing_ref = self.ref("InformationItem", self.drawing)
        self.pdf = self.add_pdf()
        self.pdf_ref = self.ref("Evidence", self.pdf)
        self.binding_id = str(uuid4())
        with self.store.transaction(True):
            self.store.meta.setdefault("drawingPdfBindings", []).append({
                "id": self.binding_id, "projectId": self.project,
                "drawingRef": self.drawing_ref, "evidenceRef": self.pdf_ref,
                "fileHash": self.pdf["fileHash"], "createdAt": self.store.engine.at(),
                "createdBy": self.actor["partyId"],
            })
        self._build_app()
        self.addCleanup(self.client.close)
        self.addCleanup(self.store.close)
        self.addCleanup(self.temp.cleanup)

    def _build_app(self, demo=True):
        self.app = FastAPI()

        def identity(_request):
            return self.actor

        def role_for(actor, project_id, role_id):
            role = self.store.engine.get("RoleAssignment", role_id or actor["roleAssignmentId"])
            require(role.get("projectId") == project_id and role.get("partyId") == actor["partyId"],
                    "PROJECT_MISMATCH", "Project role mismatch")
            return role

        install_drawing_markup_routes(
            self.app, self.store, identity=identity, role_for=role_for,
            key_for=lambda request: request.headers.get("Idempotency-Key", ""),
            demo_enabled=demo,
        )
        self.client = TestClient(self.app)

    @staticmethod
    def ref(kind, record):
        return {"objectType": kind, "objectId": record["id"], "version": record["version"]}

    def add_pdf(self):
        source = next(record for (kind, _), record in self.store.engine._records.items()
                      if kind == "Evidence" and record.get("sourceType") == "original")
        payload = {key: deepcopy(value) for key, value in source.items()
                   if key not in {"id", "projectId", "version", "createdAt", "updatedAt", "createdBy",
                                  "submittedBy", "uploadedAt", "status"}}
        file_id = uid()
        payload.update(sourceType="original", mediaType="document", fileId=file_id,
                       fileHash=sha256(PDF).hexdigest(),
                       metadata={"name": "markup-source.pdf", "mimeType": "application/pdf",
                                 "byteCount": len(PDF)})
        with self.store.transaction(True):
            self.store.engine.add_evidence(uid(), self.project, payload, PDF,
                                           self.actor["partyId"], self.role["id"], uid())
            record = self.store.engine.get("Evidence", next(
                oid for (kind, oid), row in self.store.engine._records.items()
                if kind == "Evidence" and row.get("fileId") == file_id))
            self.store.put_blob(file_id, PDF)
        return record

    def headers(self, key="markup-1"):
        return {"Idempotency-Key": key, "X-RoleAssignment-Id": self.actor["roleAssignmentId"]}

    def markup_body(self, **updates):
        return {"bindingId": self.binding_id, "page": 1,
                "rect": {"x1": 10.5, "y1": 22, "x2": 80, "y2": 90},
                "text": "  Check this junction  ", **updates}

    def create_markup(self, key="markup-1", **updates):
        return self.client.post(f"/projects/{self.project}/parallel/drawing-markups",
                                json=self.markup_body(**updates), headers=self.headers(key))

    def issue_fixture(self):
        observation = next(record for (kind, _), record in self.store.engine._records.items()
                           if kind == "Observation" and record.get("status") == "confirmed")
        inspection = next(record for (kind, _), record in self.store.engine._records.items()
                          if kind == "Inspection" and record.get("status") == "passed")
        failed = deepcopy(inspection)
        failed.update(status="failed", resultStatus="fail", failureReason="Verified dimensional defect",
                      version=inspection["version"] + 1, updatedAt=self.store.engine.at())
        with self.store.transaction(True):
            self.store.engine._records[("Inspection", failed["id"])] = deepcopy(failed)
            self.store.engine._history[("Inspection", failed["id"], failed["version"])] = deepcopy(failed)
        return failed, observation

    def issue_body(self, inspection, observation, *, issue_id=None, action_id=None):
        return {
            "roleAssignmentId": self.actor["roleAssignmentId"],
            "expectedMarkupVersion": 1,
            "inspectionRef": self.ref("Inspection", inspection),
            "observationRefs": [self.ref("Observation", observation)],
            "issueObjectId": issue_id or uid(), "actionObjectId": action_id or uid(),
            "subtype": "NCR", "title": "Verified drawing defect",
            "actionTitle": "Correct the measured junction",
            "responsiblePartyId": self.store.meta["actors"]["CON"]["partyId"],
            "dueAt": "2026-11-15T09:00:00Z",
        }

    def test_markup_validation_idempotency_read_scope_and_restart(self):
        created = self.create_markup()
        self.assertEqual(created.status_code, 201, created.text)
        markup = created.json()
        self.assertEqual(markup["version"], 1)
        self.assertEqual(markup["text"], "Check this junction")
        self.assertEqual(markup["drawingRef"], self.drawing_ref)
        self.assertEqual(markup["evidenceRef"], self.pdf_ref)
        self.assertEqual(len(self.store.meta["drawingMarkupAudit"]), 1)
        replay = self.create_markup()
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["id"], markup["id"])
        changed = self.create_markup(text="changed")
        self.assertEqual(changed.status_code, 409, changed.text)
        self.assertEqual(changed.json()["code"], "IDEMPOTENCY_CONFLICT")

        items = self.client.get(f"/projects/{self.project}/parallel/drawing-markups",
                                params={"bindingId": self.binding_id}, headers=self.headers())
        self.assertEqual(items.status_code, 200, items.text)
        self.assertEqual(items.json()["items"], [markup])
        detail = self.client.get(f"/projects/{self.project}/parallel/drawing-markups/{markup['id']}",
                                 headers=self.headers())
        self.assertEqual(detail.status_code, 200, detail.text)
        foreign_project = self.client.get(f"/projects/{uid()}/parallel/drawing-markups/{markup['id']}",
                                          headers=self.headers())
        self.assertEqual(foreign_project.status_code, 404)
        missing_binding = self.client.get(f"/projects/{self.project}/parallel/drawing-markups",
                                          params={"bindingId": uid()}, headers=self.headers())
        self.assertEqual(missing_binding.status_code, 404)

        for body in (
            self.markup_body(page=True),
            self.markup_body(page=100001),
            self.markup_body(rect={"x1": 0, "y1": 0, "x2": 0, "y2": 2}),
            self.markup_body(rect={"x1": 0, "y1": 0, "x2": True, "y2": 2}),
            self.markup_body(text="   "),
            self.markup_body(text="x" * 2001),
        ):
            rejected = self.client.post(f"/projects/{self.project}/parallel/drawing-markups",
                                        json=body, headers=self.headers(str(uuid4())))
            self.assertEqual(rejected.status_code, 422, rejected.text)
        nonfinite = self.client.post(
            f"/projects/{self.project}/parallel/drawing-markups",
            content=(f'{{"bindingId":"{self.binding_id}","page":1,"rect":{{"x1":0,"y1":0,"x2":1e999,"y2":2}},"text":"x"}}').encode(),
            headers={**self.headers(str(uuid4())), "Content-Type": "application/json"},
        )
        self.assertEqual(nonfinite.status_code, 422, nonfinite.text)
        oversized = self.client.post(f"/projects/{self.project}/parallel/drawing-markups",
                                     content=b" " * (16 * 1024 + 1),
                                     headers={**self.headers(str(uuid4())), "Content-Type": "application/json"})
        self.assertEqual(oversized.status_code, 413, oversized.text)

        self.client.close()
        self.store.close()
        self.store = SQLiteSnapshotAdapter(self.db_path)
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        self._build_app()
        persisted = self.client.get(f"/projects/{self.project}/parallel/drawing-markups",
                                    params={"bindingId": self.binding_id}, headers=self.headers())
        self.assertEqual(persisted.status_code, 200, persisted.text)
        self.assertEqual(persisted.json()["items"][0]["id"], markup["id"])

    def test_annotation_writer_gate_and_source_visibility(self):
        markup_id = self.create_markup().json()["id"]
        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        denied = self.create_markup(key="supervisor")
        self.assertEqual(denied.status_code, 403, denied.text)
        detail = self.client.get(f"/projects/{self.project}/parallel/drawing-markups/{markup_id}",
                                 headers=self.headers())
        self.assertEqual(detail.status_code, 200, detail.text)

        self.actor = deepcopy(self.store.meta["actors"]["ADM"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        with self.store.transaction(True):
            self.store.engine._records[("RoleAssignment", self.role["id"])]["authorityCodes"] = [
                code for code in self.role["authorityCodes"] if code != "render_document"
            ]
        hidden = self.client.get(f"/projects/{self.project}/parallel/drawing-markups/{markup_id}",
                                 headers=self.headers())
        self.assertEqual(hidden.status_code, 404, hidden.text)

    def test_failed_inspection_and_confirmed_current_observation_create_one_atomic_issue_link(self):
        markup = self.create_markup().json()
        inspection, observation = self.issue_fixture()
        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        body = self.issue_body(inspection, observation)
        route = f"/projects/{self.project}/parallel/drawing-markups/{markup['id']}/issues"
        source_before = (self.store.engine.get("Inspection", inspection["id"]),
                        self.store.engine.get("Observation", observation["id"]))
        first = self.client.post(route, json=body, headers=self.headers("issue-1"))
        self.assertEqual(first.status_code, 201, first.text)
        result = first.json()
        self.assertEqual(result["issue"]["status"], "assigned")
        self.assertEqual(result["correctiveAction"]["status"], "assigned")
        link = result["link"]
        self.assertEqual(link["markupId"], markup["id"])
        self.assertEqual(link["inspectionRef"], body["inspectionRef"])
        self.assertEqual(link["observationRefs"], body["observationRefs"])
        self.assertEqual(link["issueRef"]["objectId"], result["issue"]["id"])
        self.assertEqual(link["actionRef"]["objectId"], result["correctiveAction"]["id"])
        self.assertEqual(len(self.store.meta["drawingMarkupIssueLinks"]), 1)
        self.assertEqual(len(self.store.meta["drawingMarkupAudit"]), 2)
        self.assertEqual(self.store.engine.get("Inspection", inspection["id"]), source_before[0])
        self.assertEqual(self.store.engine.get("Observation", observation["id"]), source_before[1])

        replay = self.client.post(route, json=body, headers=self.headers("issue-1"))
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["link"], link)
        issue = self.store.engine.get("Issue", result["issue"]["id"])
        action = self.store.engine.get("Action", result["correctiveAction"]["id"])
        issue["version"] += 1
        action["version"] += 1
        with self.store.transaction(True):
            self.store.engine._records[("Issue", issue["id"])] = deepcopy(issue)
            self.store.engine._history[("Issue", issue["id"], issue["version"])] = deepcopy(issue)
            self.store.engine._records[("Action", action["id"])] = deepcopy(action)
            self.store.engine._history[("Action", action["id"], action["version"])] = deepcopy(action)
        replay_after_versions = self.client.post(route, json=body, headers=self.headers("issue-1"))
        self.assertEqual(replay_after_versions.status_code, 200, replay_after_versions.text)
        self.assertEqual(replay_after_versions.json(), result)

        changed = {**body, "title": "Changed retry"}
        conflict = self.client.post(route, json=changed, headers=self.headers("issue-1"))
        self.assertEqual(conflict.status_code, 409, conflict.text)
        duplicate_other_key = self.client.post(route, json=body, headers=self.headers("issue-2"))
        self.assertEqual(duplicate_other_key.status_code, 409, duplicate_other_key.text)

        detail = self.client.get(f"/projects/{self.project}/parallel/drawing-markups/{markup['id']}",
                                 headers=self.headers())
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["issueLink"]["markupId"], markup["id"])

        issue_hidden = deepcopy(issue)
        action_hidden = deepcopy(action)
        issue_hidden["projectId"] = uid()
        action_hidden["projectId"] = uid()
        with self.store.transaction(True):
            self.store.engine._records[("Issue", issue["id"])] = deepcopy(issue_hidden)
            self.store.engine._records[("Action", action["id"])] = deepcopy(action_hidden)
        hidden_detail = self.client.get(f"/projects/{self.project}/parallel/drawing-markups/{markup['id']}",
                                        headers=self.headers())
        self.assertEqual(hidden_detail.status_code, 200, hidden_detail.text)
        self.assertNotIn("issueLink", hidden_detail.json())
        with self.store.transaction(True):
            self.store.engine._records[("Issue", issue["id"])] = deepcopy(issue)
            self.store.engine._records[("Action", action["id"])] = deepcopy(action)

        self.client.close()
        self.store.close()
        self.store = SQLiteSnapshotAdapter(self.db_path)
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        self._build_app()
        self.addCleanup(self.client.close)
        self.addCleanup(self.store.close)
        self.assertEqual(len(self.store.meta["drawingMarkupIssueLinks"]), 1)
        persisted_detail = self.client.get(f"/projects/{self.project}/parallel/drawing-markups/{markup['id']}",
                                           headers=self.headers())
        self.assertEqual(persisted_detail.status_code, 200, persisted_detail.text)
        self.assertEqual(persisted_detail.json()["issueLink"], link)
        restart_replay = self.client.post(route, json=body, headers=self.headers("issue-1"))
        self.assertEqual(restart_replay.status_code, 200, restart_replay.text)
        self.assertEqual(restart_replay.json(), result)

    def test_invalid_issue_sources_and_workflow_failure_rollback_everything(self):
        markup = self.create_markup().json()
        inspection, observation = self.issue_fixture()
        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        route = f"/projects/{self.project}/parallel/drawing-markups/{markup['id']}/issues"

        stale_observation = deepcopy(observation)
        stale_observation["version"] += 1
        rejected = self.client.post(route, json=self.issue_body(inspection, stale_observation),
                                    headers=self.headers("stale"))
        self.assertEqual(rejected.status_code, 404, rejected.text)
        self.assertEqual(self.store.meta.get("drawingMarkupIssueLinks", []), [])

        unconfirmed = deepcopy(observation)
        unconfirmed["status"] = "candidate"
        with self.store.transaction(True):
            self.store.engine._records[("Observation", unconfirmed["id"])] = deepcopy(unconfirmed)
            self.store.engine._history[("Observation", unconfirmed["id"], unconfirmed["version"])] = deepcopy(unconfirmed)
        rejected = self.client.post(route, json=self.issue_body(inspection, unconfirmed),
                                    headers=self.headers("candidate"))
        self.assertEqual(rejected.status_code, 422, rejected.text)
        with self.store.transaction(True):
            self.store.engine._records[("Observation", observation["id"])] = deepcopy(observation)
            self.store.engine._history[("Observation", observation["id"], observation["version"])] = deepcopy(observation)

        mismatched = deepcopy(inspection)
        mismatched["drawingRef"] = {"objectType": "InformationItem", "objectId": uid(), "version": 1}
        with self.store.transaction(True):
            self.store.engine._records[("Inspection", mismatched["id"])] = deepcopy(mismatched)
            self.store.engine._history[("Inspection", mismatched["id"], mismatched["version"])] = deepcopy(mismatched)
        rejected = self.client.post(route, json=self.issue_body(mismatched, observation),
                                    headers=self.headers("drawing-mismatch"))
        self.assertEqual(rejected.status_code, 422, rejected.text)
        with self.store.transaction(True):
            self.store.engine._records[("Inspection", inspection["id"])] = deepcopy(inspection)
            self.store.engine._history[("Inspection", inspection["id"], inspection["version"])] = deepcopy(inspection)

        existing_action_id = next(oid for (kind, oid) in self.store.engine._records if kind == "Action")
        body = self.issue_body(inspection, observation, action_id=existing_action_id)
        before_issue_ids = {oid for kind, oid in self.store.engine._records if kind == "Issue"}
        before_audit = len(self.store.engine.audit_events)
        failed = self.client.post(route, json=body, headers=self.headers("rollback"))
        self.assertEqual(failed.status_code, 409, failed.text)
        after_issue_ids = {oid for kind, oid in self.store.engine._records if kind == "Issue"}
        self.assertEqual(after_issue_ids, before_issue_ids)
        self.assertEqual(len(self.store.engine.audit_events), before_audit)
        self.assertEqual(self.store.meta.get("drawingMarkupIssueLinks", []), [])
        self.assertEqual(len(self.store.meta["drawingMarkupAudit"]), 1)

    def test_markup_issue_requires_exact_body_and_demo(self):
        markup = self.create_markup().json()
        inspection, observation = self.issue_fixture()
        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        body = self.issue_body(inspection, observation)
        response = self.client.post(
            f"/projects/{self.project}/parallel/drawing-markups/{markup['id']}/issues",
            json={**body, "unexpected": True}, headers=self.headers("extra"),
        )
        self.assertEqual(response.status_code, 422, response.text)
        no_demo_app = FastAPI()
        install_drawing_markup_routes(
            no_demo_app, self.store, identity=lambda _request: self.actor,
            role_for=lambda actor, project, role_id: self.store.engine.get("RoleAssignment", role_id or actor["roleAssignmentId"]),
            key_for=lambda request: request.headers.get("Idempotency-Key", ""), demo_enabled=False,
        )
        no_demo = TestClient(no_demo_app)
        try:
            denied = no_demo.post(f"/projects/{self.project}/parallel/drawing-markups",
                                  json=self.markup_body(), headers=self.headers("no-demo"))
            self.assertEqual(denied.status_code, 403, denied.text)
        finally:
            no_demo.close()


if __name__ == "__main__":
    unittest.main()
