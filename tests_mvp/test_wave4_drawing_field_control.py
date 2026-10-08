"""API tests for exact-source drawing field control metadata."""
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
from services.api.modules.drawing_field_control import install_drawing_field_routes
from services.api.store import SQLiteSnapshotAdapter

PDF = b"%PDF-1.7\n% wave four synthetic fixture\n%%EOF\n"


class DrawingFieldControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = SQLiteSnapshotAdapter(str(Path(self.temp.name) / "state.sqlite3"))
        self.project = self.store.meta["projectId"]
        self.actor = deepcopy(self.store.meta["actors"]["ADM"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        self.drawing = next(row for (kind, _), row in self.store.engine._records.items()
                            if kind == "InformationItem" and row.get("subtype") == "Drawing")
        self.drawing_ref = self.ref("InformationItem", self.drawing)
        self.pdf = self.add_pdf()
        self.binding_id = str(uuid4())
        with self.store.transaction(True):
            self.store.meta.setdefault("drawingPdfBindings", []).append({
                "id": self.binding_id, "projectId": self.project,
                "drawingRef": self.drawing_ref, "evidenceRef": self.ref("Evidence", self.pdf),
                "fileHash": self.pdf["fileHash"], "createdAt": self.store.engine.at(),
                "createdBy": self.actor["partyId"],
            })
        self._build_app()
        self.addCleanup(self.client.close)
        self.addCleanup(self.store.close)
        self.addCleanup(self.temp.cleanup)

    def _build_app(self, *, demo=True):
        app = FastAPI()

        def role_for(actor, project_id, role_id):
            row = self.store.engine.get("RoleAssignment", role_id or actor["roleAssignmentId"])
            require(row.get("projectId") == project_id and row.get("partyId") == actor["partyId"],
                    "PROJECT_MISMATCH", "Project role mismatch")
            return row

        install_drawing_field_routes(
            app, self.store, identity=lambda _request: self.actor, role_for=role_for,
            key_for=lambda request: request.headers.get("Idempotency-Key", ""), demo_enabled=demo,
        )
        self.client = TestClient(app)

    @staticmethod
    def ref(kind, record):
        return {"objectType": kind, "objectId": record["id"], "version": record["version"]}

    def add_pdf(self):
        template = next(row for (kind, _), row in self.store.engine._records.items()
                        if kind == "Evidence" and row.get("sourceType") == "original")
        data = {key: deepcopy(value) for key, value in template.items()
                if key not in {"id", "projectId", "version", "createdAt", "updatedAt", "createdBy",
                               "submittedBy", "uploadedAt", "status"}}
        file_id = uid()
        data.update(sourceType="original", mediaType="document", fileId=file_id,
                    fileHash=sha256(PDF).hexdigest(),
                    metadata={"name": "field-control.pdf", "mimeType": "application/pdf", "byteCount": len(PDF)})
        with self.store.transaction(True):
            self.store.engine.add_evidence(uid(), self.project, data, PDF,
                                           self.actor["partyId"], self.role["id"], uid())
            row = self.store.engine.get("Evidence", next(
                oid for (kind, oid), record in self.store.engine._records.items()
                if kind == "Evidence" and record.get("fileId") == file_id))
            self.store.put_blob(file_id, PDF)
        return row

    def headers(self, key="field-1"):
        return {"Idempotency-Key": key, "X-RoleAssignment-Id": self.actor["roleAssignmentId"]}

    def register_body(self, **updates):
        return {
            "bindingId": self.binding_id,
            "drawingNo": "A-201",
            "revision": self.drawing["revision"],
            "issuedFor": "construction",
            "requiredRecipientPartyIds": [self.store.meta["actors"]["CON"]["partyId"]],
            "approvalRef": None,
            "changeRefs": [],
            "supersedesId": None,
            **updates,
        }

    def register(self, body=None, key="field-1"):
        return self.client.post(f"/projects/{self.project}/parallel/drawing-field-revisions",
                                json=body or self.register_body(), headers=self.headers(key))

    def command(self, revision, command, payload, *, expected=None, key=None):
        return self.client.post(
            f"/projects/{self.project}/parallel/drawing-field-revisions/{revision['id']}/commands",
            json={"command": command, "expectedVersion": expected or revision["version"], "payload": payload},
            headers=self.headers(key or f"{command}-{uuid4()}"),
        )

    def test_exact_binding_registration_read_idempotency_and_release_gate(self):
        wrong_revision = self.register(self.register_body(revision="99"), key="wrong-revision")
        self.assertEqual(wrong_revision.status_code, 409, wrong_revision.text)
        self.assertEqual(wrong_revision.json()["code"], "REVISION_SOURCE_MISMATCH")
        self.assertEqual(self.store.meta.get("drawingFieldRevisions", []), [])

        created = self.register()
        self.assertEqual(created.status_code, 201, created.text)
        field_revision = created.json()
        self.assertEqual(field_revision["drawingRef"], self.drawing_ref)
        self.assertEqual(field_revision["evidenceRef"]["objectType"], "Evidence")
        self.assertEqual(field_revision["status"], "registered")
        self.assertFalse(field_revision["currentForConstruction"])
        replay = self.register()
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["id"], field_revision["id"])
        conflict = self.register(self.register_body(issuedFor="review"))
        self.assertEqual(conflict.status_code, 409, conflict.text)
        self.assertEqual(conflict.json()["code"], "IDEMPOTENCY_CONFLICT")

        detail = self.client.get(
            f"/projects/{self.project}/parallel/drawing-field-revisions/{field_revision['id']}",
            headers=self.headers(),
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["version"], 1)
        self.assertEqual(detail.json()["availableCommands"][0]["command"], "update_basis")
        foreign = self.client.get(f"/projects/{uid()}/parallel/drawing-field-revisions/{field_revision['id']}",
                                  headers=self.headers())
        self.assertEqual(foreign.status_code, 404)

        blocked = self.command(field_revision, "release", {}, key="release-no-approval")
        self.assertEqual(blocked.status_code, 409, blocked.text)
        self.assertEqual(blocked.json()["code"], "APPROVAL_MISSING")
        unchanged = self.client.get(
            f"/projects/{self.project}/parallel/drawing-field-revisions/{field_revision['id']}",
            headers=self.headers(),
        ).json()
        self.assertEqual(unchanged["status"], "registered")
        self.assertEqual(unchanged["version"], 1)
        self.assertEqual(len(self.store.meta["drawingFieldAudit"]), 1)

    def test_approved_release_distribution_and_recipient_acknowledgement(self):
        with self.store.transaction(True):
            drawing = self.store.engine.get("InformationItem", self.drawing["id"])
            approval = self.store.engine.bootstrap("Approval", {
                "id": uid(), "projectId": self.project, "status": "approved",
                "targetRef": self.drawing_ref, "requestedBy": self.store.meta["actors"]["CON"]["partyId"],
                "approvalKind": "technical", "approvedBy": self.store.meta["actors"]["SUP"]["partyId"],
                "approvedAt": self.store.engine.at(), "packageId": drawing["packageId"],
                "locationId": drawing["locationId"], "discipline": drawing["discipline"],
                "responsibleOrganizationId": drawing["responsibleOrganizationId"],
                "minimumQualificationRank": drawing["minimumQualificationRank"],
            })
        body = self.register_body(approvalRef=self.ref("Approval", approval))
        created = self.register(body, key="approved-register")
        self.assertEqual(created.status_code, 201, created.text)
        record = created.json()

        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        released = self.command(record, "release", {}, key="approved-release")
        self.assertEqual(released.status_code, 200, released.text)
        self.assertEqual(released.json()["status"], "released")
        self.assertEqual(released.json()["version"], 2)

        self.actor = deepcopy(self.store.meta["actors"]["ADM"])
        distributed = self.command(released.json(), "distribute", {
            "recipientPartyIds": [self.store.meta["actors"]["CON"]["partyId"]],
        }, key="approved-distribute")
        self.assertEqual(distributed.status_code, 200, distributed.text)
        self.assertFalse(distributed.json()["fieldDistributionComplete"])

        self.actor = deepcopy(self.store.meta["actors"]["CON"])
        acknowledged = self.command(distributed.json(), "acknowledge", {}, key="recipient-ack")
        self.assertEqual(acknowledged.status_code, 200, acknowledged.text)
        self.assertTrue(acknowledged.json()["fieldDistributionComplete"])
        self.assertTrue(acknowledged.json()["currentForConstruction"])

        # A new immutable Drawing source is required to supersede the old field issue.
        self.actor = deepcopy(self.store.meta["actors"]["ADM"])
        with self.store.transaction(True):
            successor_drawing_data = deepcopy(drawing)
            successor_drawing_data.update(id=uid(), revision="04", version=1,
                                          createdAt=self.store.engine.at(), updatedAt=self.store.engine.at(),
                                          createdBy=self.actor["partyId"])
            successor_drawing = self.store.engine.bootstrap("InformationItem", successor_drawing_data)
            successor_approval = self.store.engine.bootstrap("Approval", {
                "id": uid(), "projectId": self.project, "status": "approved",
                "targetRef": self.ref("InformationItem", successor_drawing),
                "requestedBy": self.store.meta["actors"]["CON"]["partyId"],
                "approvalKind": "technical", "approvedBy": self.store.meta["actors"]["SUP"]["partyId"],
                "approvedAt": self.store.engine.at(), "packageId": drawing["packageId"],
                "locationId": drawing["locationId"], "discipline": drawing["discipline"],
                "responsibleOrganizationId": drawing["responsibleOrganizationId"],
                "minimumQualificationRank": drawing["minimumQualificationRank"],
            })
        successor_pdf = self.add_pdf()
        successor_binding_id = str(uuid4())
        with self.store.transaction(True):
            self.store.meta["drawingPdfBindings"].append({
                "id": successor_binding_id, "projectId": self.project,
                "drawingRef": self.ref("InformationItem", successor_drawing),
                "evidenceRef": self.ref("Evidence", successor_pdf),
                "fileHash": successor_pdf["fileHash"], "createdAt": self.store.engine.at(),
                "createdBy": self.actor["partyId"],
            })
        successor_body = {
            "bindingId": successor_binding_id, "drawingNo": "A-201", "revision": "04",
            "issuedFor": "construction", "requiredRecipientPartyIds": [self.store.meta["actors"]["CON"]["partyId"]],
            "approvalRef": self.ref("Approval", successor_approval), "changeRefs": [], "supersedesId": record["id"],
        }
        successor_created = self.register(successor_body, key="successor-register")
        self.assertEqual(successor_created.status_code, 201, successor_created.text)
        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        successor_released = self.command(successor_created.json(), "release", {}, key="successor-release")
        self.assertEqual(successor_released.status_code, 200, successor_released.text)
        self.assertEqual(successor_released.json()["status"], "released")
        old_detail = self.client.get(
            f"/projects/{self.project}/parallel/drawing-field-revisions/{record['id']}", headers=self.headers())
        self.assertEqual(old_detail.json()["status"], "superseded")
        self.assertEqual(old_detail.json()["obsoleteCopiesOutstanding"], 1)
        self.assertFalse(old_detail.json()["currentForConstruction"])

        self.actor = deepcopy(self.store.meta["actors"]["CON"])
        returned = self.command(old_detail.json(), "return_copy", {"reason": "Successor issued"}, key="return-old-copy")
        self.assertEqual(returned.status_code, 200, returned.text)
        self.assertEqual(returned.json()["obsoleteCopiesOutstanding"], 0)

        # Approval revocation makes the current projection false without rewriting released status.
        approval_after = deepcopy(successor_approval)
        approval_after.update(status="revoked", version=successor_approval["version"] + 1,
                              updatedAt=self.store.engine.at())
        with self.store.transaction(True):
            self.store.engine._records[("Approval", approval_after["id"])] = approval_after
            self.store.engine._history[("Approval", approval_after["id"], approval_after["version"])] = deepcopy(approval_after)
        refreshed = self.client.get(
            f"/projects/{self.project}/parallel/drawing-field-revisions/{successor_created.json()['id']}",
            headers=self.headers())
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        self.assertEqual(refreshed.json()["status"], "released")
        self.assertFalse(refreshed.json()["currentForConstruction"])

        history = self.client.get(
            f"/projects/{self.project}/parallel/drawing-field-revisions/{record['id']}/history",
            headers=self.headers(),
        )
        self.assertEqual(history.status_code, 200, history.text)
        self.assertEqual([item["event"] for item in history.json()["items"]], ["registered", "release", "distribute", "acknowledge", "superseded", "return_copy"])

    def test_pending_approval_can_be_refreshed_after_canonical_approval(self):
        with self.store.transaction(True):
            drawing = self.store.engine.get("InformationItem", self.drawing["id"])
            pending = self.store.engine.bootstrap("Approval", {
                "id": uid(), "projectId": self.project, "status": "pending",
                "targetRef": self.drawing_ref, "requestedBy": self.store.meta["actors"]["CON"]["partyId"],
                "approvalKind": "technical", "packageId": drawing["packageId"],
                "locationId": drawing["locationId"], "discipline": drawing["discipline"],
                "responsibleOrganizationId": drawing["responsibleOrganizationId"],
                "minimumQualificationRank": drawing["minimumQualificationRank"],
            })
        created = self.register(self.register_body(approvalRef=self.ref("Approval", pending)), key="pending-register")
        self.assertEqual(created.status_code, 201, created.text)

        approved = deepcopy(pending)
        approved.update(status="approved", version=pending["version"] + 2,
                        approvedBy=self.store.meta["actors"]["SUP"]["partyId"],
                        approvedAt=self.store.engine.at(), updatedAt=self.store.engine.at())
        interim = deepcopy(pending)
        interim.update(status="under_review", version=pending["version"] + 1, updatedAt=self.store.engine.at())
        with self.store.transaction(True):
            self.store.engine._records[("Approval", pending["id"])] = approved
            self.store.engine._history[("Approval", pending["id"], interim["version"])] = interim
            self.store.engine._history[("Approval", pending["id"], approved["version"])] = deepcopy(approved)

        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        refreshed = self.command(created.json(), "update_basis", {
            "approvalRef": self.ref("Approval", approved), "changeRefs": [],
        }, key="refresh-approved-basis")
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        self.assertEqual(refreshed.json()["approvalRef"], self.ref("Approval", approved))
        self.assertEqual(refreshed.json()["version"], 2)
        replay = self.command(created.json(), "update_basis", {
            "approvalRef": self.ref("Approval", approved), "changeRefs": [],
        }, key="refresh-approved-basis")
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["version"], 2)
        changed_retry = self.command(refreshed.json(), "update_basis", {
            "approvalRef": None, "changeRefs": [],
        }, key="refresh-approved-basis")
        self.assertEqual(changed_retry.status_code, 409, changed_retry.text)

        released = self.command(refreshed.json(), "release", {}, key="release-after-refresh")
        self.assertEqual(released.status_code, 200, released.text)
        self.assertEqual(released.json()["status"], "released")

    def test_demo_write_gate_and_read_permission_revocation(self):
        record = self.register().json()
        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        denied = self.register(key="supervisor-registration")
        self.assertEqual(denied.status_code, 403, denied.text)
        detail = self.client.get(
            f"/projects/{self.project}/parallel/drawing-field-revisions/{record['id']}", headers=self.headers())
        self.assertEqual(detail.status_code, 200, detail.text)

        self.actor = deepcopy(self.store.meta["actors"]["ADM"])
        role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        with self.store.transaction(True):
            stored_role = self.store.engine._records[("RoleAssignment", role["id"])]
            stored_role["authorityCodes"] = [code for code in stored_role["authorityCodes"] if code != "render_document"]
        hidden = self.client.get(
            f"/projects/{self.project}/parallel/drawing-field-revisions/{record['id']}", headers=self.headers())
        self.assertEqual(hidden.status_code, 404, hidden.text)

        self._build_app(demo=False)
        denied_demo = self.register(key="disabled-demo")
        self.assertEqual(denied_demo.status_code, 403, denied_demo.text)
