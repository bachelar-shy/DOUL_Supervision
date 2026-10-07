"""Exact-version drawing/PDF index is demo-admin-only and source-read authorized."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.reference.engine import uid
from app.reference.validation import ContractError, require
from services.api.modules.drawing_pdf_bindings import install_drawing_pdf_binding_routes
from services.api.store import SQLiteSnapshotAdapter

PDF = b"%PDF-1.7\n% synthetic binding fixture\n%%EOF\n"


class DrawingPdfBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name) / "state.sqlite3"
        self.store = SQLiteSnapshotAdapter(str(self.state))
        self.actor = deepcopy(self.store.meta["actors"]["ADM"])
        self.project = self.store.meta["projectId"]
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        self.drawing = next(record for (kind, _), record in self.store.engine._records.items()
                            if kind == "InformationItem" and record.get("subtype") == "Drawing")
        self.drawing_ref = self.ref("InformationItem", self.drawing)
        self.pdf_evidence = self.add_pdf(PDF)
        self.pdf_ref = self.ref("Evidence", self.pdf_evidence)
        self._build_app()
        self.addCleanup(self.client.close)
        self.addCleanup(self.store.close)
        self.addCleanup(self.temp.cleanup)

    def _build_app(self, *, demo=True):
        self.app = FastAPI()

        def role_for(actor, project_id, role_id):
            role = self.store.engine.get("RoleAssignment", role_id or actor["roleAssignmentId"])
            require(role.get("projectId") == project_id and role.get("partyId") == actor["partyId"],
                    "NOT_AUTHORIZED", "Project role mismatch")
            return role

        install_drawing_pdf_binding_routes(
            self.app, self.store, identity=lambda _request: self.actor,
            role_for=role_for, key_for=lambda request: request.headers.get("Idempotency-Key", ""),
            demo_enabled=demo,
        )
        self.client = TestClient(self.app)

    @staticmethod
    def ref(kind, record):
        return {"objectType": kind, "objectId": record["id"], "version": record["version"]}

    def add_pdf(self, content, *, mime="application/pdf", media_type="document", role=None):
        source = next(record for (kind, _), record in self.store.engine._records.items()
                      if kind == "Evidence" and record.get("sourceType") == "original")
        payload = {key: deepcopy(value) for key, value in source.items()
                   if key not in {"id", "projectId", "version", "createdAt", "updatedAt", "createdBy",
                                  "submittedBy", "uploadedAt", "status"}}
        file_id = uid()
        payload.update(sourceType="original", mediaType=media_type, fileId=file_id,
                       fileHash=sha256(content).hexdigest(),
                       metadata={"name": "plan.pdf", "mimeType": mime, "byteCount": len(content)})
        actor = self.actor
        role_id = (role or self.role)["id"]
        with self.store.transaction(True):
            self.store.engine.add_evidence(uid(), self.project, payload, content, actor["partyId"], role_id, uid())
            record = self.store.engine.get("Evidence", next(oid for (kind, oid), r in self.store.engine._records.items()
                                                             if kind == "Evidence" and r.get("fileId") == file_id))
            self.store.put_blob(file_id, content)
        return record

    def request(self, body, *, key="bind-1", project=None, role=None, headers=True):
        req_headers = {}
        if headers:
            req_headers = {"Idempotency-Key": key, "X-RoleAssignment-Id": (role or self.role)["id"]}
        return self.client.post(f"/projects/{project or self.project}/parallel/drawing-pdf-bindings",
                                json=body, headers=req_headers)

    def body(self, drawing_ref=None, evidence_ref=None):
        return {"drawingRef": drawing_ref or self.drawing_ref,
                "evidenceRef": evidence_ref or self.pdf_ref}

    def test_binding_is_append_only_audited_and_idempotent_across_restart(self):
        source_before = (self.store.engine.get("InformationItem", self.drawing["id"]),
                         self.store.engine.get("Evidence", self.pdf_evidence["id"]))
        first = self.request(self.body())
        self.assertEqual(first.status_code, 201, first.text)
        binding = first.json()
        self.assertEqual(binding["drawingRef"], self.drawing_ref)
        self.assertEqual(binding["evidenceRef"], self.pdf_ref)
        self.assertEqual(binding["fileHash"], self.pdf_evidence["fileHash"])
        self.assertEqual(len(self.store.meta["drawingPdfBindingAudit"]), 1)
        replay = self.request(self.body())
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["id"], binding["id"])
        other_key_replay = self.request(self.body(), key="bind-2")
        self.assertEqual(other_key_replay.status_code, 200, other_key_replay.text)
        self.assertEqual(other_key_replay.json()["id"], binding["id"])
        listing = self.client.get(f"/projects/{self.project}/parallel/drawing-pdf-bindings")
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(listing.json(), {"items": [binding]})
        self.assertEqual(self.store.engine.get("InformationItem", self.drawing["id"]), source_before[0])
        self.assertEqual(self.store.engine.get("Evidence", self.pdf_evidence["id"]), source_before[1])

        self.client.close()
        self.store.close()
        self.store = SQLiteSnapshotAdapter(str(self.state))
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        self._build_app()
        persisted = self.client.get(f"/projects/{self.project}/parallel/drawing-pdf-bindings")
        self.assertEqual(persisted.status_code, 200, persisted.text)
        self.assertEqual(persisted.json(), {"items": [binding]})

    def test_different_pdf_for_same_exact_drawing_and_idempotency_reuse_conflict(self):
        self.assertEqual(self.request(self.body()).status_code, 201)
        second_evidence = self.add_pdf(b"%PDF-1.7\nother bytes\n%%EOF\n")
        second_ref = self.ref("Evidence", second_evidence)
        conflict = self.request(self.body(evidence_ref=second_ref), key="bind-2")
        self.assertEqual(conflict.status_code, 409, conflict.text)
        idem_conflict = self.request(self.body(evidence_ref=second_ref), key="bind-1")
        self.assertEqual(idem_conflict.status_code, 409, idem_conflict.text)
        self.assertEqual(len(self.store.meta["drawingPdfBindings"]), 1)
        self.assertEqual(len(self.store.meta["drawingPdfBindingAudit"]), 1)

    def test_invalid_source_mime_hash_signature_and_cross_project_rejected(self):
        bad_cases = [
            (self.ref("InformationItem", self.store.engine.get("Requirement", next(
                oid for (kind, oid) in self.store.engine._records if kind == "Requirement"))), self.pdf_ref),
        ]
        for drawing_ref, evidence_ref in bad_cases:
            response = self.request(self.body(drawing_ref, evidence_ref))
            self.assertIn(response.status_code, (404, 422))
        for malformed in (
            {"objectType": "InformationItem", "objectId": "not-a-uuid", "version": 1},
            {"objectType": "InformationItem", "objectId": self.drawing["id"], "version": True},
            {"objectType": "InformationItem", "objectId": self.drawing["id"], "version": 0},
        ):
            response = self.request(self.body(drawing_ref=malformed), key="malformed-ref")
            self.assertEqual(response.status_code, 422, response.text)
        wrong_mime = self.add_pdf(PDF, mime="image/png")
        response = self.request(self.body(evidence_ref=self.ref("Evidence", wrong_mime)), key="mime")
        self.assertEqual(response.status_code, 422, response.text)
        wrong_media = self.add_pdf(PDF, media_type="photo")
        response = self.request(self.body(evidence_ref=self.ref("Evidence", wrong_media)), key="media")
        self.assertEqual(response.status_code, 422, response.text)
        non_pdf = self.add_pdf(b"not a pdf")
        response = self.request(self.body(evidence_ref=self.ref("Evidence", non_pdf)), key="signature")
        self.assertEqual(response.status_code, 422, response.text)
        corrupt = deepcopy(self.pdf_evidence)
        with self.store.transaction(True):
            self.store.put_blob(corrupt["fileId"], b"%PDF-1.7\nchanged but still a PDF\n%%EOF\n")
        response = self.request(self.body(), key="checksum")
        self.assertEqual(response.status_code, 422, response.text)
        response = self.request(self.body(), project=uid(), key="foreign")
        self.assertEqual(response.status_code, 403, response.text)
        response = self.request(self.body(), key="long", headers=False)
        self.assertEqual(response.status_code, 422, response.text)
        response = self.client.post(f"/projects/{self.project}/parallel/drawing-pdf-bindings",
                                    json=self.body(), headers={"Idempotency-Key": "x" * 161})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.store.meta.get("drawingPdfBindings", []), [])

    def test_historical_exact_versions_bind_and_content_is_pinned(self):
        changed_drawing = deepcopy(self.drawing)
        changed_drawing["version"] = self.drawing["version"] + 1
        with self.store.transaction(True):
            self.store.engine._records[("InformationItem", changed_drawing["id"])] = deepcopy(changed_drawing)
            self.store.engine._history[("InformationItem", changed_drawing["id"], changed_drawing["version"])] = deepcopy(changed_drawing)
        changed = deepcopy(self.pdf_evidence)
        changed["version"] = self.pdf_evidence["version"] + 1
        changed["fileHash"] = sha256(b"%PDF-1.7\nnew version\n%%EOF\n").hexdigest()
        changed["metadata"] = {**changed["metadata"], "name": "new-version.pdf"}
        with self.store.transaction(True):
            self.store.engine._records[("Evidence", changed["id"])] = deepcopy(changed)
            self.store.engine._history[("Evidence", changed["id"], changed["version"])] = deepcopy(changed)
        response = self.request(self.body())
        self.assertEqual(response.status_code, 201, response.text)
        binding = response.json()
        content = self.client.get(
            f"/projects/{self.project}/parallel/drawing-pdf-bindings/{binding['id']}/content")
        self.assertEqual(content.status_code, 200, content.text)
        self.assertEqual(content.content, PDF)
        self.assertEqual(content.headers["content-type"], "application/pdf")
        self.assertEqual(content.headers["cache-control"], "no-store")
        wrong_project = self.client.get(
            f"/projects/{uid()}/parallel/drawing-pdf-bindings/{binding['id']}/content")
        self.assertEqual(wrong_project.status_code, 404)

    def test_admin_demo_gate_and_scope_revocation(self):
        supervisor = self.store.engine.get("RoleAssignment", self.store.meta["actors"]["SUP"]["roleAssignmentId"])
        denied = self.request(self.body(), role=supervisor)
        self.assertEqual(denied.status_code, 403, denied.text)
        saved_authorities = deepcopy(self.role.get("authorityCodes", []))
        with self.store.transaction(True):
            self.store.engine._records[("RoleAssignment", self.role["id"])]["authorityCodes"] = []
        denied = self.request(self.body(), key="no-render")
        self.assertEqual(denied.status_code, 403, denied.text)
        with self.store.transaction(True):
            self.store.engine._records[("RoleAssignment", self.role["id"])]["authorityCodes"] = saved_authorities
        wrong_actor = deepcopy(self.actor)
        wrong_actor["actorGroup"] = "SUP"
        old_identity = self.actor
        self.actor = wrong_actor
        try:
            denied = self.request(self.body(), key="wrong-actor")
            self.assertEqual(denied.status_code, 403, denied.text)
        finally:
            self.actor = old_identity
        no_demo_app = FastAPI()
        install_drawing_pdf_binding_routes(
            no_demo_app, self.store, identity=lambda _request: self.actor,
            role_for=lambda _a, _p, _r: self.role, key_for=lambda _r: "no-demo", demo_enabled=False,
        )
        no_demo = TestClient(no_demo_app)
        try:
            response = no_demo.post(f"/projects/{self.project}/parallel/drawing-pdf-bindings",
                                    json=self.body(), headers={"Idempotency-Key": "no-demo"})
            self.assertEqual(response.status_code, 403, response.text)
        finally:
            no_demo.close()

        self.assertEqual(self.request(self.body()).status_code, 201)
        with self.store.transaction(True):
            self.store.engine._records[("RoleAssignment", self.role["id"])]["active"] = False
            self.store.engine._history[("RoleAssignment", self.role["id"], self.role["version"])]["active"] = False
        listing = self.client.get(f"/projects/{self.project}/parallel/drawing-pdf-bindings")
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(listing.json(), {"items": []})


if __name__ == "__main__":
    unittest.main()
