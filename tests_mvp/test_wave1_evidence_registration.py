"""Quarantine promotion creates persisted official originals only after full validation."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.modules.evidence.registration_routes import install_evidence_registration_routes
from services.api.modules.evidence.test_routes import LocalFilesystemQuarantineStore
from services.api.store import SQLiteSnapshotAdapter


PNG = b"\x89PNG\r\n\x1a\n" + b"demo-image"


class EvidenceRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "quarantine"
        self.store = SQLiteSnapshotAdapter(str(Path(self.tmp.name) / "state.sqlite3"))
        self.actor = self.store.meta["actors"]["SUP"]
        self.project = self.store.meta["projectId"]
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        self._build_app()
        self.addCleanup(self.client.close)
        self.addCleanup(self.store.close)
        self.addCleanup(self.tmp.cleanup)
        self.scope = self.store.meta["scope"]
        self.baseline_evidence_count = len([1 for kind, _ in self.store.engine._records if kind == "Evidence"])

    def _build_app(self):
        self.app = FastAPI()
        install_evidence_registration_routes(
            self.app, store=self.store, get_actor=lambda _r: self.actor,
            get_role=lambda _p, _r, _a: self.role,
            key_for=lambda request: request.headers["idempotency-key"],
            quarantine_root=self.root,
            sniff=lambda data: "image/png" if data.startswith(b"\x89PNG\r\n\x1a\n") else (_ for _ in ()).throw(ValueError()),
        )
        self.client = TestClient(self.app)

    def quarantine(self, body=PNG, *, project=None, actor=None):
        qstore = LocalFilesystemQuarantineStore(self.root, project or self.project, actor or self.actor["partyId"])
        digest = sha256(body).hexdigest()
        key = f"evidence/{project or self.project}/upload_{uid().replace('-', '')[:12]}/{digest}"
        qstore.put_quarantine(key, BytesIO(body), content_length=len(body), content_type="image/png", sha256=digest)
        return key, digest

    def body(self, key, digest):
        return {
            "roleAssignmentId": self.role["id"], "quarantineKey": key, "sha256": digest,
            "sourcePartyId": self.actor["partyId"], "fileName": "field.png",
            "discipline": self.scope["discipline"], "packageId": self.scope["packageId"],
            "locationId": self.scope["locationId"],
        }

    def register(self, body, *, headers=None):
        return self.client.post(
            f"/projects/{self.project}/parallel/evidence-quarantine/register",
            json=body, headers={"Idempotency-Key": "registration-1", **(headers or {})},
        )

    def test_register_persists_official_record_and_replay_after_store_restart(self):
        key, digest = self.quarantine()
        response = self.register(self.body(key, digest))
        self.assertEqual(response.status_code, 201, response.text)
        record = response.json()
        self.assertEqual(record["sourceType"], "original")
        self.assertEqual(record["fileHash"], digest)
        self.assertEqual(self.store.blob(record["fileId"]), PNG)
        self.client.close()
        self.store.close()
        self.store = SQLiteSnapshotAdapter(str(Path(self.tmp.name) / "state.sqlite3"))
        self._build_app()
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        replay = self.register(self.body(key, digest))
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["id"], record["id"])
        self.assertEqual(self.store.blob(record["fileId"]), PNG)

    def test_bad_hash_or_foreign_actor_quarantine_creates_no_evidence(self):
        key, digest = self.quarantine()
        bad = self.register({**self.body(key, digest), "sha256": "0" * 64})
        self.assertEqual(bad.status_code, 422)
        self.assertEqual(
            len([1 for kind, _ in self.store.engine._records if kind == "Evidence"]),
            self.baseline_evidence_count,
        )
        foreign_key, foreign_hash = self.quarantine(actor=self.store.meta["actors"]["CON"]["partyId"])
        foreign = self.register(self.body(foreign_key, foreign_hash))
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(
            len([1 for kind, _ in self.store.engine._records if kind == "Evidence"]),
            self.baseline_evidence_count,
        )

    def test_requires_authenticated_role_and_rejects_idempotency_body_change(self):
        key, digest = self.quarantine()
        unauthorized = dict(self.role)
        unauthorized["authorityCodes"] = []
        self.role = unauthorized
        denied = self.register(self.body(key, digest), headers={"Idempotency-Key": "denied"})
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(
            len([1 for kind, _ in self.store.engine._records if kind == "Evidence"]),
            self.baseline_evidence_count,
        )
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        first = self.register(self.body(key, digest))
        self.assertEqual(first.status_code, 201, first.text)
        conflict = self.register({**self.body(key, digest), "fileName": "changed.png"})
        self.assertEqual(conflict.status_code, 422)
        count = len([1 for kind, _ in self.store.engine._records if kind == "Evidence"])
        self.assertEqual(count, self.baseline_evidence_count + 1)


if __name__ == "__main__":
    unittest.main()
