"""HTTP integration tests for the demo evidence quarantine adapter."""
import hashlib
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.api.modules.evidence.test_routes import (
    LocalFilesystemQuarantineStore,
    install_evidence_quarantine_routes,
)


class ParallelEvidenceUploadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = FastAPI()
        self.app.state.actors = {
            "owner": {"partyId": "party_owner", "projectId": "project_1"},
            "other": {"partyId": "party_other", "projectId": "project_1"},
        }
        self.app.state.roles = {
            "project_1": {"projectId": "project_1", "authorityCodes": ["create_evidence"]},
        }

        def get_actor(request):
            token = request.headers.get("authorization", "").removeprefix("Bearer ")
            actor = self.app.state.actors.get(token)
            if actor is None:
                from app.reference.validation import ContractError
                raise ContractError("UNAUTHENTICATED", "Session missing")
            return actor

        def get_role(project_id, request, actor):
            role = self.app.state.roles.get(project_id)
            if role is None or actor["projectId"] != project_id:
                from app.reference.validation import ContractError
                raise ContractError("PROJECT_MISMATCH", "Project unavailable")
            return role

        install_evidence_quarantine_routes(
            self.app, get_actor=get_actor, get_role=get_role,
            quarantine_root=self.root / "quarantine", staging_root=self.root / "staging",
            max_upload_bytes=32,
        )
        self.client = TestClient(self.app)
        self.headers = {"Authorization": "Bearer owner"}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def upload(self, body=b"field evidence", *, sha=None, size=None, headers=None):
        digest = sha or hashlib.sha256(body).hexdigest()
        request_headers = {
            **self.headers,
            "X-Upload-Id": "upload_1",
            "X-Upload-Size": str(len(body) if size is None else size),
            "X-Upload-SHA256": digest,
            "Content-Type": "application/octet-stream",
        }
        request_headers.update(headers or {})
        return self.client.post(
            "/projects/project_1/parallel/evidence-quarantine",
            content=body,
            headers=request_headers,
        )

    def test_upload_verifies_and_lists_only_owner_quarantine(self):
        body = b"field evidence bytes"
        response = self.upload(body)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["status"], "quarantined")
        self.assertEqual(payload["byteCount"], len(body))
        self.assertEqual(payload["sha256"], hashlib.sha256(body).hexdigest())
        self.assertEqual(payload["quarantineKey"], "evidence/project_1/upload_1/original")

        listing = self.client.get("/projects/project_1/parallel/evidence-quarantine", headers=self.headers)
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(len(listing.json()["items"]), 1)
        self.assertEqual(listing.json()["items"][0]["status"], "quarantined")

        other = self.client.get("/projects/project_1/parallel/evidence-quarantine",
                                headers={"Authorization": "Bearer other"})
        self.assertEqual(other.status_code, 200, other.text)
        self.assertEqual(other.json()["items"], [])
        self.assertEqual(list(self.root.joinpath("staging").glob("doul-evidence-http-*")), [])
        self.assertEqual(list(self.root.joinpath("staging").glob("project_1/party_owner/doul-evidence-*")), [])

    def test_concurrent_same_content_retries_use_independent_temporary_files(self):
        body = b"same-content retry" * 128
        digest = hashlib.sha256(body).hexdigest()
        store = LocalFilesystemQuarantineStore(self.root / "quarantine", "project_1", "party_owner")
        key = "evidence/project_1/upload_1/original"

        def write_one():
            return store.put_quarantine(
                key, BytesIO(body), content_length=len(body),
                content_type="application/octet-stream", sha256=digest,
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda _: write_one(), range(16)))

        target = store._target(key)
        self.assertEqual(target.read_bytes(), body)
        self.assertEqual(len(store.list_quarantine()), 1)
        self.assertEqual(list(target.parent.glob("*.tmp")), [])
        self.assertEqual(list(target.parent.glob(".*.tmp")), [])

    def test_retry_reuses_one_local_object_without_replacing_original(self):
        body = b"same original"
        self.assertEqual(self.upload(body).status_code, 200)
        store = LocalFilesystemQuarantineStore(self.root / "quarantine", "project_1", "party_owner")
        target = store._target("evidence/project_1/upload_1/original")
        first = target.stat()
        self.assertEqual(self.upload(body).status_code, 200)
        second = target.stat()
        self.assertEqual((first.st_ino, first.st_mtime_ns), (second.st_ino, second.st_mtime_ns))
        self.assertEqual(len(store.list_quarantine()), 1)

    def test_same_upload_id_changed_content_or_type_returns_conflict(self):
        self.assertEqual(self.upload(b"first").status_code, 200)
        for body, headers in [(b"other", {}), (b"first", {"Content-Type": "text/plain"})]:
            with self.subTest(body=body, headers=headers):
                response = self.upload(body, headers=headers)
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(response.json()["code"], "QUARANTINE_UPLOAD_CONFLICT")
        store = LocalFilesystemQuarantineStore(self.root / "quarantine", "project_1", "party_owner")
        self.assertEqual(store._target("evidence/project_1/upload_1/original").read_bytes(), b"first")

    def test_partial_local_commit_requires_reconciliation_without_overwrite(self):
        self.assertEqual(self.upload(b"original").status_code, 200)
        store = LocalFilesystemQuarantineStore(self.root / "quarantine", "project_1", "party_owner")
        target = store._target("evidence/project_1/upload_1/original")
        target.with_suffix(".json").unlink()
        response = self.upload(b"original")
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["code"], "QUARANTINE_RECONCILIATION_REQUIRED")
        self.assertEqual(target.read_bytes(), b"original")

    def test_legacy_objects_remain_readable_but_used_ids_are_not_silently_migrated(self):
        body = b"legacy original"
        digest = hashlib.sha256(body).hexdigest()
        store = LocalFilesystemQuarantineStore(self.root / "quarantine", "project_1", "party_owner")
        key = f"evidence/project_1/upload_1/{digest}"
        store.put_quarantine(key, BytesIO(body), content_length=len(body),
            content_type="application/octet-stream", sha256=digest)
        response = self.upload(body)
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(store.list_quarantine()[0]["key"], key)
        with store.open_quarantine(key) as original:
            self.assertEqual(original.read(), body)

    def test_local_key_cannot_cross_project_namespace(self):
        store = LocalFilesystemQuarantineStore(self.root / "quarantine", "project_1", "party_owner")
        with self.assertRaises(ValueError):
            store._target("evidence/project_other/upload_1/original")

    def test_bad_hash_is_rejected_and_staging_is_removed(self):
        response = self.upload(b"tampered", sha="0" * 64)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["code"], "UPLOAD_INVALID")
        self.assertEqual(self.client.get("/projects/project_1/parallel/evidence-quarantine",
                                         headers=self.headers).json()["items"], [])
        self.assertEqual(list(self.root.joinpath("staging").glob("doul-evidence-http-*")), [])

    def test_declared_oversize_rejected_before_staging(self):
        response = self.upload(b"x", size=33, sha=hashlib.sha256(b"x").hexdigest())
        self.assertEqual(response.status_code, 413, response.text)
        self.assertEqual(response.json()["code"], "PAYLOAD_TOO_LARGE")
        self.assertFalse(self.root.joinpath("staging").exists())

    def test_unauthenticated_and_foreign_project_reads_are_denied(self):
        unauthenticated = self.client.get("/projects/project_1/parallel/evidence-quarantine")
        self.assertEqual(unauthenticated.status_code, 401)
        foreign = self.client.get("/projects/project_2/parallel/evidence-quarantine", headers=self.headers)
        self.assertEqual(foreign.status_code, 404)

    def test_upload_requires_existing_evidence_authority(self):
        self.app.state.roles["project_1"]["authorityCodes"] = []
        response = self.upload(b"no permission")
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["code"], "NOT_AUTHORIZED")


if __name__ == "__main__":
    unittest.main()
