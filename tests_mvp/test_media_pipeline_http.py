"""HTTP integration tests for the normalized media-evidence pipeline."""
import base64
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
)
MP4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 48
WAV = b"RIFF" + b"\x00\x00\x00\x00" + b"WAVE" + b"fmt " + b"\x00" * 32


class MediaPipelineHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "state.db")
        self.app = create_app(self.path, demo=True)
        self.client = TestClient(self.app)
        self.login("SUP")

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()
        self.temp.cleanup()

    def login(self, actor_group):
        response = self.client.post("/dev/sessions", json={"actorGroup": actor_group})
        self.assertEqual(response.status_code, 200, response.text)
        self.session = response.json()
        self.project = self.session["projectId"]
        self.role = self.session["actor"]["roleAssignmentId"]
        self.headers = {
            "Authorization": "Bearer " + self.session["accessToken"],
            "X-RoleAssignment-Id": self.role,
        }
        return self.session

    def workspace(self):
        response = self.client.get(
            f"/projects/{self.project}/workspace", headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def upload(self, content, mime, media_type, file_name):
        scope = self.workspace()["context"]["scope"]
        capture = uid()
        body = {
            "roleAssignmentId": self.role,
            "captureId": capture,
            "fileName": file_name,
            "mimeType": mime,
            "byteCount": len(content),
            "expectedHash": sha256(content).hexdigest(),
            "sourcePartyId": self.session["actor"]["partyId"],
            "mediaType": media_type,
            "discipline": scope["discipline"],
            "packageId": scope["packageId"],
            "locationId": scope["locationId"],
        }
        started = self.client.post(
            f"/projects/{self.project}/uploads",
            headers={**self.headers, "Idempotency-Key": capture},
            json=body,
        )
        self.assertEqual(started.status_code, 201, started.text)
        upload = started.json()
        chunk = self.client.put(
            f"/projects/{self.project}/uploads/{upload['id']}/chunks",
            headers={
                **self.headers,
                "Idempotency-Key": uid(),
                "Upload-Offset": "0",
                "Content-Type": "application/octet-stream",
            },
            content=content,
        )
        self.assertEqual(chunk.status_code, 200, chunk.text)
        completed = self.client.post(
            f"/projects/{self.project}/uploads/{upload['id']}/complete",
            headers={**self.headers, "Idempotency-Key": "complete-" + capture},
            json={
                "roleAssignmentId": self.role,
                "expectedHash": sha256(content).hexdigest(),
            },
        )
        self.assertEqual(completed.status_code, 201, completed.text)
        return completed.json()

    def queue(self, evidence_ids, mode, languages=None, key=None, object_id=None, **extra):
        body = {
            "roleAssignmentId": self.role,
            "clientObjectId": object_id or uid(),
            "sourceEvidenceIds": evidence_ids,
            "mode": mode,
            "languages": languages or ["auto"],
            **extra,
        }
        return self.client.post(
            f"/projects/{self.project}/media-analysis-runs",
            headers={**self.headers, "Idempotency-Key": key or uid()},
            json=body,
        )

    def worker(self, suffix, body, key=None):
        return self.client.post(
            f"/dev/media-worker/projects/{self.project}{suffix}",
            headers={**self.headers, "Idempotency-Key": key or uid()},
            json=body,
        )

    def command(self, collection, record, command, payload=None, evidence_ids=None):
        return self.client.post(
            f"/projects/{self.project}/{collection}/{record['id']}/{command}",
            headers={**self.headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.role,
                "expectedVersion": record["version"],
                "payload": payload or {},
                "evidenceIds": (
                    evidence_ids
                    if evidence_ids is not None
                    else record.get("evidenceIds", [])
                ),
            },
        )

    def test_photo_candidate_requires_human_review_and_service_audit(self):
        photo = self.upload(PNG, "image/png", "photo", "site-photo.png")
        queued = self.queue([photo["id"]], "photo", ["ko", "vi"])
        self.assertEqual(queued.status_code, 201, queued.text)
        run = queued.json()
        self.assertEqual(run["status"], "queued")
        self.assertEqual(run["model"], self.app.state.store.meta["analysisProfile"]["model"])

        # The public request cannot select/replace the server-controlled model profile.
        tampered = self.queue(
            [photo["id"]],
            "photo",
            model={"provider": "caller", "name": "caller", "version": "x"},
        )
        self.assertEqual(tampered.status_code, 422, tampered.text)

        # Contractor cannot gain analysis authority through the application endpoint.
        self.login("CON")
        denied = self.queue([photo["id"]], "photo")
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(denied.json()["code"], "NOT_AUTHORIZED")

        self.login("ADM")
        started = self.worker(f"/runs/{run['id']}/start", {})
        self.assertEqual(started.status_code, 200, started.text)
        self.assertEqual(started.json()["status"], "running")
        system_party = self.app.state.store.meta["serviceActors"]["SYSTEM"]["partyId"]
        start_event = next(
            event
            for event in reversed(self.app.state.store.engine.audit_events)
            if event["command"] == "analysis_run:start"
            and event["objectRef"]["objectId"] == run["id"]
        )
        self.assertEqual(start_event["actorPartyId"], system_party)
        self.assertNotEqual(start_event["actorPartyId"], self.session["actor"]["partyId"])

        candidate = {
            "kind": "candidate",
            "sourceEvidenceId": photo["id"],
            "analysisRunId": run["id"],
            "description": "벽체 마감 균열 의심 구간",
            "confidence": 0.83,
            "reviewFlags": ["human_confirmation_required"],
            "grounding": [
                {
                    "evidenceId": photo["id"],
                    "channel": "visual",
                    "claimSupport": "observed",
                }
            ],
        }
        coverage = {
            "sources": [
                {
                    "sourceEvidenceId": photo["id"],
                    "analyzedRanges": [],
                    "missingRanges": [],
                    "audioProcessedRanges": [],
                    "complete": True,
                }
            ]
        }
        completion_body = {
            "outputs": [candidate],
            "coverage": coverage,
            "completedAt": "2026-10-06T01:00:00Z",
        }
        complete_key = uid()
        completed = self.worker(
            f"/runs/{run['id']}/complete", completion_body, complete_key
        )
        self.assertEqual(completed.status_code, 200, completed.text)
        result = completed.json()
        self.assertEqual(result["run"]["status"], "succeeded")
        self.assertEqual(len(result["candidates"]), 1)
        observation = result["candidates"][0]
        self.assertEqual(observation["status"], "candidate")
        self.assertEqual(observation["source"], "ai")
        ai_party = self.app.state.store.meta["serviceActors"]["AI"]["partyId"]
        candidate_event = next(
            event
            for event in reversed(self.app.state.store.engine.audit_events)
            if event["command"] == "create:observation"
            and event["objectRef"]["objectId"] == observation["id"]
        )
        self.assertEqual(candidate_event["actorPartyId"], ai_party)

        # Worker completion is idempotent and must not duplicate candidates.
        replay = self.worker(
            f"/runs/{run['id']}/complete", completion_body, complete_key
        )
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), result)
        with self.app.state.store.transaction():
            linked = [
                record
                for (kind, _), record in self.app.state.store.engine._records.items()
                if kind == "Observation" and record.get("analysisRunId") == run["id"]
            ]
        self.assertEqual(len(linked), 1)

        # Owner cannot see internal raw analysis or AI review candidates.
        self.login("OWN")
        self.assertEqual(
            self.client.get(
                f"/projects/{self.project}/media-analysis-runs/{run['id']}",
                headers=self.headers,
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.get(
                f"/projects/{self.project}/analysis-runs/{run['id']}",
                headers=self.headers,
            ).status_code,
            404,
        )

        # Supervisor performs the independent human review/confirmation.
        self.login("SUP")
        review = self.client.get(
            f"/projects/{self.project}/media-analysis-runs/{run['id']}",
            headers=self.headers,
        )
        self.assertEqual(review.status_code, 200, review.text)
        self.assertEqual(len(review.json()["candidates"]), 1)
        observation = review.json()["candidates"][0]["record"]
        begin = self.command("observations", observation, "begin-review")
        self.assertEqual(begin.status_code, 200, begin.text)
        under_review = begin.json()["record"]
        confirmed = self.command(
            "observations",
            under_review,
            "confirm",
            {"verificationNote": "현장사진 원본과 위치를 감리자가 확인함"},
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertEqual(confirmed.json()["record"]["status"], "confirmed")
        self.assertEqual(
            confirmed.json()["record"]["confirmedBy"], self.session["actor"]["partyId"]
        )

    def test_photo_no_findings_is_preserved_but_creates_no_official_result(self):
        photo = self.upload(PNG, "image/png", "photo", "no-findings.png")
        run = self.queue([photo["id"]], "photo").json()
        self.login("ADM")
        self.assertEqual(
            self.worker(f"/runs/{run['id']}/start", {}).status_code, 200
        )
        output = {
            "kind": "photo_result",
            "sourceEvidenceId": photo["id"],
            "analysisRunId": run["id"],
            "modelVersion": run["model"]["version"],
            "outcome": "no_findings",
            "summary": "모델 검토 범위에서 명확한 결함 후보를 제안하지 않음",
        }
        coverage = {
            "sources": [
                {
                    "sourceEvidenceId": photo["id"],
                    "analyzedRanges": [],
                    "missingRanges": [],
                    "audioProcessedRanges": [],
                    "complete": True,
                }
            ]
        }
        complete = self.worker(
            f"/runs/{run['id']}/complete",
            {
                "outputs": [output],
                "coverage": coverage,
                "completedAt": "2026-10-06T01:00:00Z",
            },
        )
        self.assertEqual(complete.status_code, 200, complete.text)
        self.assertEqual(complete.json()["candidates"], [])

        self.login("SUP")
        review = self.client.get(
            f"/projects/{self.project}/media-analysis-runs/{run['id']}",
            headers=self.headers,
        ).json()
        self.assertEqual(len(review["photoResults"]), 1)
        self.assertEqual(review["photoResults"][0]["outcome"], "no_findings")
        self.assertEqual(review["candidates"], [])
        self.assertFalse(
            any(
                item["machine"] == "inspection"
                and item["record"].get("resultStatus") == "pass"
                and item["record"].get("analysisRunId") == run["id"]
                for item in self.workspace()["items"]
            )
        )

    def test_video_requires_index_and_every_frame_preserves_vfr_pts(self):
        video = self.upload(MP4, "video/mp4", "video", "walkthrough.mp4")
        not_indexed = self.queue([video["id"]], "every_frame")
        self.assertEqual(not_indexed.status_code, 409, not_indexed.text)
        self.assertEqual(not_indexed.json()["code"], "MEDIA_NOT_INDEXED")

        self.login("ADM")
        indexed = self.worker(
            f"/evidence/{video['id']}/index",
            {
                "durationMs": 1000,
                "framePtsMs": [0, 360, 900],
                "metadata": {"codec": "h264", "indexer": "ffprobe"},
            },
        )
        self.assertEqual(indexed.status_code, 200, indexed.text)
        indexed_video = indexed.json()
        self.assertEqual(indexed_video["frameCount"], 3)
        self.assertEqual(indexed_video["metadata"]["framePtsMs"], [0, 360, 900])
        self.assertEqual(indexed_video["fileHash"], video["fileHash"])

        self.login("SUP")
        queued = self.queue([video["id"]], "every_frame")
        self.assertEqual(queued.status_code, 201, queued.text)
        run = queued.json()

        self.login("ADM")
        self.assertEqual(
            self.worker(f"/runs/{run['id']}/start", {}).status_code, 200
        )

        bad_frame_id = uid()
        bad = self.worker(
            f"/runs/{run['id']}/frames",
            {
                "frameObjectId": bad_frame_id,
                "fileObjectId": uid(),
                "sourceEvidenceId": video["id"],
                "frameIndex": 1,
                "ptsMs": 333,
                "mimeType": "image/png",
                "contentBase64": base64.b64encode(PNG).decode(),
            },
        )
        self.assertEqual(bad.status_code, 409, bad.text)
        self.assertEqual(bad.json()["code"], "FRAME_INVALID")

        frame_records = []
        for index, pts in enumerate([0, 360, 900]):
            frame_id, file_id = uid(), uid()
            response = self.worker(
                f"/runs/{run['id']}/frames",
                {
                    "frameObjectId": frame_id,
                    "fileObjectId": file_id,
                    "sourceEvidenceId": video["id"],
                    "frameIndex": index,
                    "ptsMs": pts,
                    "mimeType": "image/png",
                    "contentBase64": base64.b64encode(PNG).decode(),
                },
            )
            self.assertEqual(response.status_code, 201, response.text)
            frame_records.append(response.json())
            self.assertEqual(response.json()["originalEvidenceId"], video["id"])
            self.assertEqual(response.json()["sourceRange"]["ptsMs"], pts)

        outputs = [
            {
                "kind": "frame",
                "sourceEvidenceId": video["id"],
                "derivedEvidenceId": frame["id"],
                "analysisRunId": run["id"],
                "modelVersion": run["model"]["version"],
                "frameIndex": index,
                "ptsMs": pts,
            }
            for index, (pts, frame) in enumerate(zip([0, 360, 900], frame_records))
        ]
        coverage = {
            "sources": [
                {
                    "sourceEvidenceId": video["id"],
                    "decodedFrameCount": 3,
                    "analyzedFrameCount": 3,
                    "analyzedRanges": [{"startMs": 0, "endMs": 1000}],
                    "missingRanges": [],
                    "audioProcessedRanges": [],
                    "complete": True,
                }
            ]
        }
        completed = self.worker(
            f"/runs/{run['id']}/complete",
            {
                "outputs": outputs,
                "coverage": coverage,
                "completedAt": "2026-10-06T01:10:00Z",
            },
        )
        self.assertEqual(completed.status_code, 200, completed.text)
        self.assertEqual(completed.json()["run"]["status"], "succeeded")

        self.login("SUP")
        review = self.client.get(
            f"/projects/{self.project}/media-analysis-runs/{run['id']}",
            headers=self.headers,
        ).json()
        self.assertEqual([frame["ptsMs"] for frame in review["frames"]], [0, 360, 900])
        self.assertEqual(review["coverage"]["sources"][0]["decodedFrameCount"], 3)

    def test_audio_transcript_preserves_original_text_and_global_time(self):
        audio = self.upload(WAV, "audio/wav", "audio", "site-voice.wav")
        self.login("ADM")
        indexed = self.worker(
            f"/evidence/{audio['id']}/index",
            {
                "durationMs": 1000,
                "framePtsMs": [],
                "metadata": {"codec": "pcm_s16le", "sampleRate": 16000},
            },
        )
        self.assertEqual(indexed.status_code, 200, indexed.text)

        self.login("SUP")
        run_response = self.queue([audio["id"]], "audio", ["vi", "ko"])
        self.assertEqual(run_response.status_code, 201, run_response.text)
        run = run_response.json()

        self.login("ADM")
        self.assertEqual(
            self.worker(f"/runs/{run['id']}/start", {}).status_code, 200
        )
        transcript = {
            "kind": "transcript",
            "segmentId": uid(),
            "sourceEvidenceId": audio["id"],
            "analysisRunId": run["id"],
            "startMs": 100,
            "endMs": 900,
            "speakerLabel": "speaker_1",
            "originalLanguage": "vi",
            "originalText": "Không đạt 120 mm",
            "translatedText": "120 mm에 미달",
        }
        coverage = {
            "sources": [
                {
                    "sourceEvidenceId": audio["id"],
                    "analyzedRanges": [],
                    "missingRanges": [],
                    "audioProcessedRanges": [{"startMs": 0, "endMs": 1000}],
                    "complete": True,
                }
            ]
        }
        completed = self.worker(
            f"/runs/{run['id']}/complete",
            {
                "outputs": [transcript],
                "coverage": coverage,
                "completedAt": "2026-10-06T01:20:00Z",
            },
        )
        self.assertEqual(completed.status_code, 200, completed.text)

        self.login("SUP")
        review = self.client.get(
            f"/projects/{self.project}/media-analysis-runs/{run['id']}",
            headers=self.headers,
        ).json()
        self.assertEqual(len(review["transcripts"]), 1)
        self.assertEqual(review["transcripts"][0]["originalText"], "Không đạt 120 mm")
        self.assertEqual(review["transcripts"][0]["translatedText"], "120 mm에 미달")
        self.assertEqual(
            (review["transcripts"][0]["startMs"], review["transcripts"][0]["endMs"]),
            (100, 900),
        )

    def test_invalid_worker_completion_rolls_back_and_same_key_can_be_corrected(self):
        photo = self.upload(PNG, "image/png", "photo", "rollback.png")
        run = self.queue([photo["id"]], "photo").json()
        self.login("ADM")
        self.assertEqual(
            self.worker(f"/runs/{run['id']}/start", {}).status_code, 200
        )
        key = uid()
        invalid = {
            "outputs": [
                {
                    "kind": "candidate",
                    "sourceEvidenceId": photo["id"],
                    "analysisRunId": run["id"],
                    "description": "근거 없는 후보",
                    "confidence": 0.7,
                    "reviewFlags": [],
                    "grounding": [],
                }
            ],
            "coverage": {
                "sources": [
                    {
                        "sourceEvidenceId": photo["id"],
                        "analyzedRanges": [],
                        "missingRanges": [],
                        "audioProcessedRanges": [],
                        "complete": True,
                    }
                ]
            },
            "completedAt": "2026-10-06T01:30:00Z",
        }
        failed = self.worker(f"/runs/{run['id']}/complete", invalid, key)
        self.assertEqual(failed.status_code, 409, failed.text)
        self.assertEqual(failed.json()["code"], "ANALYSIS_SOURCE_MISMATCH")
        with self.app.state.store.transaction():
            current = self.app.state.store.engine.get("AnalysisRun", run["id"])
            candidates = [
                record
                for (kind, _), record in self.app.state.store.engine._records.items()
                if kind == "Observation" and record.get("analysisRunId") == run["id"]
            ]
        self.assertEqual(current["status"], "running")
        self.assertEqual(candidates, [])

        corrected = {
            "outputs": [
                {
                    "kind": "candidate",
                    "sourceEvidenceId": photo["id"],
                    "analysisRunId": run["id"],
                    "description": "근거 확인이 필요한 후보",
                    "confidence": 0.7,
                    "reviewFlags": ["human_confirmation_required"],
                    "grounding": [
                        {
                            "evidenceId": photo["id"],
                            "channel": "visual",
                            "claimSupport": "inferred",
                        }
                    ],
                }
            ],
            "coverage": invalid["coverage"],
            "completedAt": "2026-10-06T01:30:00Z",
        }
        recovered = self.worker(f"/runs/{run['id']}/complete", corrected, key)
        self.assertEqual(recovered.status_code, 200, recovered.text)
        self.assertEqual(recovered.json()["run"]["status"], "succeeded")
        self.assertEqual(len(recovered.json()["candidates"]), 1)

    def test_worker_ingress_is_demo_admin_only(self):
        photo = self.upload(PNG, "image/png", "photo", "worker-auth.png")
        run = self.queue([photo["id"]], "photo").json()
        self.login("SUP")
        denied = self.worker(f"/runs/{run['id']}/start", {})
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(denied.json()["code"], "NOT_AUTHORIZED")


if __name__ == "__main__":
    unittest.main()
