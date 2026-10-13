"""Synthetic 56 MiB / 145-page end-to-end drawing ingestion acceptance.

Runs on GitHub-hosted CI only. This file is a generated test fixture, NOT the
client's original construction drawing. It uses the same 64 MiB upload API the
web UI uses for PDF files too large for the 20 MiB direct endpoint.
"""
from __future__ import annotations

from hashlib import sha256
import re
import shutil
import unittest

from app.reference.engine import uid
from tests_mvp.test_drawing_sheet_catalog_http import test_pdf
from tests_mvp.test_synthetic_role_login_http import SyntheticQuickLoginHTTPTest


def large_pdf():
    original = test_pdf(145, variant="A")
    marker = re.search(rb"startxref\n(\d+)\n%%EOF", original)
    assert marker is not None
    old_offset = int(marker.group(1))
    # Add a PDF 1.4 comment BEFORE xref, so offsets of all actual page objects
    # remain unchanged. The xref pointer itself is updated accordingly.
    pad = b"%" + b"X" * (56 * 1024 * 1024 - len(original) - 2) + b"\n"
    result = original[:old_offset] + pad + original[old_offset:]
    result = result.replace(
        b"startxref\n" + str(old_offset).encode() + b"\n",
        b"startxref\n" + str(old_offset + len(pad)).encode() + b"\n",
    )
    assert 56 * 1024 * 1024 <= len(result) <= 57 * 1024 * 1024
    return result


@unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdftoppm")
                     and shutil.which("pdftotext"), "Poppler required")
class LargeDrawingAcceptance(SyntheticQuickLoginHTTPTest):
    def test_56_mib_145_pages_chunked_upload_import_and_sheet_images(self):
        from services.api.modules.drawing_raster import pdf_pages
        from pathlib import Path
        from tempfile import TemporaryDirectory

        original = large_pdf()
        digest = sha256(original).hexdigest()
        with TemporaryDirectory() as temp:
            pdf = Path(temp) / "acceptance.pdf"
            pdf.write_bytes(original)
            self.assertEqual(pdf_pages(pdf), 145)
        login = self.http.post("/auth/test-role-login",
                               json={"role": "ADM"}, headers=self.origin)
        self.assertEqual(login.status_code, 200, login.text)
        session = login.json()
        actor = session["actor"]
        headers = {**self.origin, "Authorization": "Bearer " + session["accessToken"]}
        scope_response = self.http.get(
            "/projects/" + self.project + "/workspace", headers=headers)
        self.assertEqual(scope_response.status_code, 200, scope_response.text)
        scope = scope_response.json()["context"]["scope"]
        capture_id = uid()
        prefix = "/projects/" + self.project
        registration = {
            "roleAssignmentId": actor["roleAssignmentId"],
            "captureId": capture_id,
            "fileName": "SYNTHETIC_56MB_145PAGES.pdf",
            "mimeType": "application/pdf",
            "byteCount": len(original),
            "expectedHash": digest,
            "sourcePartyId": actor["partyId"],
            "mediaType": "document",
            "discipline": scope["discipline"],
            "packageId": scope["packageId"],
            "locationId": scope["locationId"],
        }
        started = self.http.post(prefix + "/uploads", headers={
            **headers, "Idempotency-Key": capture_id,
        }, json=registration)
        self.assertEqual(started.status_code, 201, started.text[:600])
        upload_id = started.json()["id"]

        size = 4 * 1024 * 1024
        for offset in range(0, len(original), size):
            part = original[offset:offset+size]
            result = self.http.put(prefix + "/uploads/" + upload_id + "/chunks",
                headers={**headers, "Idempotency-Key": f"{capture_id}-{offset}",
                         "Content-Type": "application/octet-stream",
                         "Upload-Offset": str(offset)}, content=part)
            self.assertEqual(result.status_code, 200, result.text[:500])
            self.assertEqual(result.json()["offset"], offset + len(part))
        completed = self.http.post(prefix + "/uploads/" + upload_id + "/complete",
            headers={**headers, "Idempotency-Key": capture_id + "-complete"},
            json={"roleAssignmentId": actor["roleAssignmentId"], "expectedHash": digest})
        self.assertEqual(completed.status_code, 201, completed.text[:500])
        evidence = completed.json()
        self.assertEqual(evidence["fileHash"], digest)
        self.assertEqual(evidence["id"], capture_id)

        body = {"evidenceRef": {"objectType": "Evidence",
                               "objectId": capture_id, "version": evidence["version"]}}
        route = prefix + "/drawing-sets/from-evidence"
        imported = self.http.post(route, headers={
            **headers, "Idempotency-Key": capture_id + "-drawings"}, json=body)
        self.assertEqual(imported.status_code, 202, imported.text[:600])
        drawing_set = imported.json()["set"]
        self.assertEqual(drawing_set["pageCount"], 145)
        with self.store.transaction():
            root = self.store.meta["drawingSets"][self.project][drawing_set["id"]]
            self.assertEqual(root["status"], "ready")
            self.assertEqual(root["completedPages"], 145)
            self.assertEqual(root["sourceEvidenceId"], capture_id)
            self.assertEqual(sha256(self.store.blob(root["sourceBlobId"])).hexdigest(), digest)
            rows = [self.store.meta["drawingSheets"][self.project][sid]
                    for sid in root["sheetIds"]]
            self.assertEqual(len(rows), 145)
            self.assertTrue(all(row["status"] == "ready" and
                row["previewBlobId"] and row["thumbBlobId"] for row in rows))
        # A disconnected upload response must not create a second original/set.
        replay = self.http.post(prefix + "/uploads", headers={
            **headers, "Idempotency-Key": capture_id}, json=registration)
        self.assertEqual(replay.json()["id"], upload_id)
        repeated = self.http.post(route, headers={
            **headers, "Idempotency-Key": uid()}, json=body)
        self.assertEqual(repeated.status_code, 202, repeated.text[:500])
        self.assertEqual(repeated.json()["set"]["id"], drawing_set["id"])
        with self.store.transaction():
            self.assertEqual(len(self.store.meta["drawingSets"][self.project]), 1)
        for row in (rows[0], rows[-1]):
            picture = self.http.get(prefix + "/drawing-sheets/" + row["id"] +
                "/image?size=preview", headers=headers)
            self.assertEqual(picture.status_code, 200, picture.text[:300] if
                             picture.status_code != 200 else "")
            self.assertTrue(picture.content.startswith(b"\xff\xd8\xff"))


if __name__ == "__main__":
    unittest.main()
