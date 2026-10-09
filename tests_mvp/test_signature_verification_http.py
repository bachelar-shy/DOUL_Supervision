"""HTTP boundary tests for injected trusted signature verification adapters.

The adapter below is an explicitly test-only mock. It does not assert that any
real provider, legal-signature workflow, or original-paper examination passed.
"""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


class MockTrustedVerifier:
    """A deterministic boundary double installed only by these tests."""

    def __init__(self):
        self.calls = []
        self.overrides = {}
        self.fail = False

    def verify(self, request):
        self.calls.append(request)
        if self.fail:
            raise RuntimeError("test adapter unavailable")
        receipt = {
            "verified": True,
            "partyId": request.party_id,
            "documentHash": request.document_hash,
            "method": request.method,
            "signerRole": request.signer_role,
            "mockAdapter": True,
        }
        if request.original_file_id is not None:
            receipt.update(
                originalFileId=request.original_file_id,
                originalFileHash=sha256(request.original_file_bytes).hexdigest(),
            )
        receipt.update(self.overrides)
        return deepcopy(receipt)


class SignatureVerificationHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "state.db")
        self.verifier = MockTrustedVerifier()
        self.app = create_app(
            self.path, demo=True, signature_verifier=self.verifier
        )
        self.client = TestClient(self.app)
        self.session, self.headers = self.login("SUP")
        self.project = self.session["projectId"]
        workspace = self.get(f"/projects/{self.project}/workspace").json()
        self.scope = workspace["context"]["scope"]
        self.original_evidence_id = workspace["context"]["evidenceId"]
        inspection = next(
            item["record"]
            for item in workspace["items"]
            if item["machine"] == "inspection" and item["record"].get("resultStatus") == "pass"
        )
        self.inspection = deepcopy(inspection)
        self.document = self.render_fm09(inspection)

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()
        self.temp.cleanup()

    def login(self, group):
        response = self.client.post("/dev/sessions", json={"actorGroup": group})
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()
        return session, {
            "Authorization": "Bearer " + session["accessToken"],
            "X-RoleAssignment-Id": session["actor"]["roleAssignmentId"],
        }

    def get(self, path):
        return self.client.get(path, headers=self.headers)

    def render_fm09(self, inspection):
        schema = self.app.state.store.documents.schemas["FM-09"]
        data = {}
        for path, rule in schema["scalar_fields"].items():
            value = (
                True
                if rule["type"] == "boolean"
                else "2026-10-04T12:00:00Z"
                if rule["type"] == "date-time"
                else "검측 확인 / verified"
            )
            target = data
            segments = path.split(".")
            for segment in segments[:-1]:
                target = target.setdefault(segment, {})
            target[segments[-1]] = value
        response = self.client.post(
            f"/projects/{self.project}/forms/FM-09/render",
            headers={**self.headers, "Idempotency-Key": "render-" + uid()},
            json={
                "roleAssignmentId": self.session["actor"]["roleAssignmentId"],
                "sourceDomainRefs": [
                    {
                        "objectType": "Inspection",
                        "objectId": inspection["id"],
                        "version": inspection["version"],
                    }
                ],
                "data": data,
                "language": "vi",
                "output": "html_a4",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def sign_body(self, *, document_hash=None, method="approved_e_signature", **extra):
        return {
            "roleAssignmentId": self.session["actor"]["roleAssignmentId"],
            "documentHash": document_hash or self.document["renderHash"],
            "roleCode": "owner_side_supervisor",
            "method": method,
            **extra,
        }

    def sign(self, body=None, key=None):
        return self.client.post(
            f"/projects/{self.project}/documents/{self.document['id']}/sign",
            headers={**self.headers, "Idempotency-Key": key or uid()},
            json=body or self.sign_body(),
        )

    def signature_state(self):
        documents = self.app.state.store.documents
        document = documents.get(self.document["id"])
        signatures = [
            record
            for (kind, _), record in self.app.state.store.engine._records.items()
            if kind == "Signature" and record.get("documentId") == self.document["id"]
        ]
        audit = [
            record
            for record in self.app.state.store.engine.audit_events
            if record.get("command") == "document:sign"
        ]
        return document, signatures, audit

    def test_success_is_bound_to_exact_document_and_retry_is_idempotent(self):
        key = "sign-once-" + uid()
        first = self.sign(key=key)
        self.assertEqual(first.status_code, 200, first.text)
        second = self.sign(key=key)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json(), first.json())
        document, signatures, audit = self.signature_state()
        self.assertEqual(len(signatures), 1)
        self.assertEqual(len(audit), 1)
        self.assertEqual(document["signatureIds"], [first.json()["id"]])
        self.assertEqual(document["status"], "final")
        self.assertEqual(len(self.verifier.calls), 1)
        request = self.verifier.calls[0]
        self.assertEqual(request.document_hash, self.document["renderHash"])
        self.assertEqual(sha256(request.rendered_bytes).hexdigest(), request.document_hash)
        self.assertEqual(request.idempotency_key, key)

    def test_adapter_mismatch_or_unverified_result_is_failure_atomic(self):
        baseline = self.signature_state()
        for override in (
            {"partyId": uid()},
            {"documentHash": "0" * 64},
            {"method": "wet_original_verified"},
            {"verified": False},
        ):
            with self.subTest(override=override):
                self.verifier.overrides = override
                response = self.sign()
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(response.json()["code"], "SIGNATURE_UNVERIFIED")
                current = self.signature_state()
                self.assertEqual(current, baseline)
        self.assertEqual(len(self.verifier.calls), 4)

    def test_client_cannot_submit_a_verified_receipt(self):
        response = self.sign(
            self.sign_body(receipt={"verified": True, "partyId": self.session["actor"]["partyId"]})
        )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.verifier.calls, [])
        document, signatures, _ = self.signature_state()
        self.assertEqual(document["status"], "final")
        self.assertEqual(signatures, [])

    def test_hash_and_current_signing_rights_are_rechecked_before_adapter(self):
        stale = self.sign(self.sign_body(document_hash="0" * 64))
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()["code"], "DOCUMENT_HASH_MISMATCH")
        self.assertEqual(self.verifier.calls, [])

        role_id = self.session["actor"]["roleAssignmentId"]
        with self.app.state.store.transaction(True):
            role = self.app.state.store.engine.get("RoleAssignment", role_id)
            role["active"] = False
            self.app.state.store.engine._save("RoleAssignment", role)
        denied = self.sign()
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(denied.json()["code"], "ASSIGNMENT_EXPIRED")
        self.assertEqual(self.verifier.calls, [])

    def test_revoked_signer_qualification_blocks_adapter_before_verification(self):
        role_id = self.session["actor"]["roleAssignmentId"]
        role = self.app.state.store.engine.get("RoleAssignment", role_id)
        qualification_id = role["qualificationIds"][0]
        with self.app.state.store.transaction(True):
            qualification = self.app.state.store.engine.get("Qualification", qualification_id)
            qualification["revoked"] = True
            self.app.state.store.engine._save("Qualification", qualification)
        response = self.sign()
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["code"], "QUALIFICATION_INVALID")
        self.assertEqual(self.verifier.calls, [])
        document, signatures, _ = self.signature_state()
        self.assertEqual(document["status"], "final")
        self.assertEqual(signatures, [])

    def test_revoking_signer_qualification_preserves_prior_signature_but_blocks_new_official_command(self):
        """A later qualification change cannot rewrite prior signed evidence or authorize new work."""
        signed = self.sign()
        self.assertEqual(signed.status_code, 200, signed.text)
        signature_id = signed.json()["id"]
        document_before, signatures_before, sign_audit_before = self.signature_state()
        self.assertEqual(len(signatures_before), 1)
        prior_signature = deepcopy(signatures_before[0])
        role_id = self.session["actor"]["roleAssignmentId"]
        role = self.app.state.store.engine.get("RoleAssignment", role_id)
        qualification_id = role["qualificationIds"][0]
        qualification_before = self.app.state.store.engine.get("Qualification", qualification_id)
        self.assertEqual(
            prior_signature["qualificationRefs"],
            [{"objectType": "Qualification", "objectId": qualification_id, "version": qualification_before["version"]}],
        )
        signature_history_before = {
            key: deepcopy(value)
            for key, value in self.app.state.store.engine._history.items()
            if key[0] == "Signature" and key[1] == signature_id
        }
        document_history_before = {
            key: deepcopy(value)
            for key, value in self.app.state.store.engine._history.items()
            if key[0] == "DocumentSnapshot" and key[1] == self.document["id"]
        }

        # Test fixture simulates a post-signing revocation. The existing legal
        # signature is historical evidence; this update must not mutate it.
        with self.app.state.store.transaction(True):
            revoked = self.app.state.store.engine.get("Qualification", qualification_id)
            revoked.update(revoked=True, version=revoked["version"] + 1, updatedAt=self.app.state.store.engine.at())
            self.app.state.store.engine._save("Qualification", revoked)
        current_qualification = self.app.state.store.engine.get("Qualification", qualification_id)
        self.assertTrue(current_qualification["revoked"])
        self.assertGreater(current_qualification["version"], prior_signature["qualificationRefs"][0]["version"])
        published_document_response = self.get(f"/projects/{self.project}/documents/{self.document['id']}")
        self.assertEqual(published_document_response.status_code, 200, published_document_response.text)
        published_document = published_document_response.json()
        self.assertEqual(published_document["version"], document_before["version"])
        self.assertEqual(published_document["renderHash"], document_before["renderHash"])
        self.assertEqual(published_document["signatureIds"], [signature_id])
        self.assertEqual(published_document["status"], document_before["status"])

        inspection_before = self.app.state.store.engine.get("Inspection", self.inspection["id"])
        audit_before_command = deepcopy(self.app.state.store.engine.audit_events)
        idempotency_before_command = deepcopy(self.app.state.store.engine._idempotency)
        rejected = self.client.post(
            f"/projects/{self.project}/inspections/{self.inspection['id']}/release_next_work",
            headers={**self.headers, "Idempotency-Key": "release-after-revocation-" + uid()},
            json={
                "roleAssignmentId": role_id,
                "expectedVersion": inspection_before["version"],
                "payload": {},
                "evidenceIds": [self.original_evidence_id],
            },
        )
        self.assertEqual(rejected.status_code, 403, rejected.text)
        self.assertEqual(rejected.json()["code"], "QUALIFICATION_INVALID")

        # The refusal is current-only: it creates no command audit, history,
        # idempotency record or state transition, while the prior signature,
        # document hash, signed-at time and recorded qualification ref survive.
        self.assertEqual(self.app.state.store.engine.get("Inspection", self.inspection["id"]), inspection_before)
        self.assertEqual(self.app.state.store.engine.audit_events, audit_before_command)
        self.assertEqual(self.app.state.store.engine._idempotency, idempotency_before_command)
        self.assertEqual(self.signature_state(), (document_before, signatures_before, sign_audit_before))
        final_document_response = self.get(f"/projects/{self.project}/documents/{self.document['id']}")
        self.assertEqual(final_document_response.status_code, 200, final_document_response.text)
        self.assertEqual(final_document_response.json(), published_document)
        signature_history_after = {
            key: value
            for key, value in self.app.state.store.engine._history.items()
            if key[0] == "Signature" and key[1] == signature_id
        }
        document_history_after = {
            key: value
            for key, value in self.app.state.store.engine._history.items()
            if key[0] == "DocumentSnapshot" and key[1] == self.document["id"]
        }
        self.assertEqual(signature_history_after, signature_history_before)
        self.assertEqual(document_history_after, document_history_before)
        self.assertEqual(len(self.verifier.calls), 1)

    def test_verifier_failure_creates_no_legal_signature(self):
        before = self.signature_state()
        cached_requests = deepcopy(self.app.state.store.requests)
        self.verifier.fail = True
        response = self.sign()
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["code"], "SIGNATURE_VERIFIER_FAILED")
        self.assertEqual(self.signature_state(), before)
        self.assertEqual(self.app.state.store.requests, cached_requests)

    def test_absent_verifier_keeps_signing_unavailable(self):
        before = self.signature_state()
        self.app.state.signature_verifier = None
        response = self.sign()
        self.assertEqual(response.status_code, 501, response.text)
        self.assertEqual(response.json()["code"], "ADAPTER_NOT_CONFIGURED")
        self.assertEqual(self.signature_state(), before)
        self.assertEqual(self.verifier.calls, [])

    def test_wet_original_verification_receives_only_project_readable_stored_bytes(self):
        evidence = self.app.state.store.engine.get("Evidence", self.original_evidence_id)
        response = self.sign(
            self.sign_body(
                method="wet_original_verified",
                originalFileId=evidence["fileId"],
            )
        )
        self.assertEqual(response.status_code, 200, response.text)
        request = self.verifier.calls[0]
        self.assertEqual(request.original_file_id, evidence["fileId"])
        self.assertEqual(request.original_file_bytes, self.app.state.store.blob(evidence["fileId"]))

    def test_tampered_stored_original_is_rejected_before_verifier(self):
        evidence = self.app.state.store.engine.get("Evidence", self.original_evidence_id)
        with self.app.state.store.transaction(True):
            self.app.state.store.put_blob(evidence["fileId"], b"tampered original")
        response = self.sign(
            self.sign_body(
                method="wet_original_verified",
                originalFileId=evidence["fileId"],
            )
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["code"], "SIGNATURE_ORIGINAL_INTEGRITY_FAILED")
        self.assertEqual(self.verifier.calls, [])
        document, signatures, _ = self.signature_state()
        self.assertEqual(document["status"], "final")
        self.assertEqual(signatures, [])

    def test_derived_evidence_cannot_be_submitted_as_a_wet_original(self):
        store = self.app.state.store
        with store.transaction(True):
            evidence = store.engine.get('Evidence', self.original_evidence_id)
            evidence.update(sourceType='derived', version=evidence['version'] + 1)
            store.engine._save('Evidence', evidence)
        response = self.sign(self.sign_body(method='wet_original_verified', originalFileId=evidence['fileId']))
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['code'], 'SIGNATURE_ORIGINAL_REQUIRED')
        self.assertEqual(self.verifier.calls, [])


if __name__ == "__main__":
    unittest.main()
