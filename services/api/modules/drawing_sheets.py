"""Authenticated page-to-sheet catalog layered over the existing Drawing domain.

The existing InformationItem/Drawing, drawingPdfBindings, drawingMarkups,
drawingMarkupIssueLinks and drawingFieldRevisions remain authoritative.
An uploaded, rasterized PDF creates DRAFT sheet entries, not forged Evidence,
formal issued-for-construction drawings, or approved inspection results.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import unquote
from uuid import uuid4
import json
import logging
import time

from fastapi import BackgroundTasks, Request
from fastapi.responses import Response

from app.reference.validation import ContractError, require
from .drawing_raster import MAX_SOURCE_BYTES, PdfSheetError, pdf_pages, page_image, pdf_page_text
from .drawing_sheet_metadata import extract_sheet_candidate
from .drawing_sheet_metadata_review import install_sheet_metadata_review_routes
from .drawing_sheet_annotations import install_sheet_markup_routes
from .drawing_sheet_revision_links import install_sheet_revision_routes
from .drawing_pin_replies import install_sheet_pin_reply_routes

LOG = logging.getLogger(__name__)
WRITERS = frozenset({"ADM", "SUP", "CON"})
KINDS = frozenset({"issue", "inspection", "site"})
LINK_TYPES = frozenset({"Issue", "Inspection", "Observation", "Action"})
MAX_PIN_TEXT = 1500


def _scope(store, project_id, request, actor, role_for):
    role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
    require(role["id"] == actor["roleAssignmentId"], "NOT_AUTHORIZED", "Role switching is not permitted")
    store.engine.get("Project", project_id)
    return role


def _folder(filename):
    value = Path(filename).stem.strip()[:100]
    return value if value else "업로드 도면"


def _sheet_result(row):
    result = {key: deepcopy(value) for key, value in row.items()
              if key not in {"previewBlobId", "thumbBlobId"}}
    result["hasPreview"] = bool(row.get("previewBlobId"))
    result["hasThumb"] = bool(row.get("thumbBlobId"))
    return result


def _audit(store, project_id, kind, actor, role, detail):
    store.meta.setdefault("drawingSheetAudit", {}).setdefault(project_id, []).append({
        "id": str(uuid4()), "event": kind, "at": store.engine.at(),
        "partyId": actor["partyId"], "roleAssignmentId": role["id"], **detail,
    })


def _render_set(store, project_id, set_id):
    """Render unfinished pages, reclaiming abandoned jobs after process failure."""
    token = str(uuid4())
    with store.transaction(write=True):
        root = store.meta["drawingSets"][project_id][set_id]
        if root["status"] != "processing":
            return
        now = time.time()
        if root.get("renderOwner") and now - root.get("renderHeartbeat", 0) < 120:
            return
        root["renderOwner"] = token
        root["renderHeartbeat"] = now
    try:
        with store.transaction():
            source = store.meta["drawingSets"][project_id][set_id]
            content = store.blob(source["sourceBlobId"])
            pages = source["pageCount"]
            pending = [
                (store.meta["drawingSheets"][project_id][sheet_id]["pageNo"], sheet_id)
                for sheet_id in source["sheetIds"]
                if store.meta["drawingSheets"][project_id][sheet_id]["status"] != "ready"
            ]
        with TemporaryDirectory(prefix="doul-drawing-") as folder:
            pdf = Path(folder) / "original.pdf"
            pdf.write_bytes(content)
            if pdf_pages(pdf) != pages:
                raise PdfSheetError("등록된 원본 PDF의 페이지 수가 변경되었습니다")

            def raster_job(number: int):
                # Metadata is advisory; a scanned titleblock cannot fail the raster.
                try:
                    info = extract_sheet_candidate(number, pdf_page_text(pdf, number))
                except (PdfSheetError, ValueError):
                    info = None
                return page_image(pdf, number, thumb=True), page_image(pdf, number), info

            # Only two futures exist at a time, even for a 145-page source.
            # This bounds decoded JPEGs and Poppler children in a small worker.
            with ThreadPoolExecutor(max_workers=2, thread_name_prefix="doul-sheet-raster") as pool:
                for offset in range(0, len(pending), 2):
                    jobs = {pool.submit(raster_job, number): sheet_id
                            for number, sheet_id in pending[offset:offset + 2]}
                    for future in as_completed(jobs):
                        sheet_id = jobs[future]
                        try:
                            thumb, preview, info = future.result()
                        except Exception:
                            LOG.exception("Could not rasterize drawing sheet %s", sheet_id)
                            with store.transaction(write=True):
                                root = store.meta["drawingSets"][project_id][set_id]
                                if root.get("renderOwner") != token:
                                    return
                                root["renderHeartbeat"] = time.time()
                                sheet = store.meta["drawingSheets"][project_id][sheet_id]
                                if sheet["status"] != "ready":
                                    sheet["status"] = "failed"
                                    sheet["updatedAt"] = store.engine.at()
                            continue
                        with store.transaction(write=True):
                            root = store.meta["drawingSets"][project_id][set_id]
                            if root.get("renderOwner") != token:
                                return
                            root["renderHeartbeat"] = time.time()
                            sheet = store.meta["drawingSheets"][project_id][sheet_id]
                            if sheet["status"] == "ready":
                                continue  # Never rewrite a previously completed page.
                            thumb_id = "drawing-thumb:" + sheet_id
                            preview_id = "drawing-preview:" + sheet_id
                            store.put_blob(thumb_id, thumb)
                            store.put_blob(preview_id, preview)
                            sheet.update(thumbBlobId=thumb_id, previewBlobId=preview_id,
                                         status="ready", updatedAt=store.engine.at())
                            if info is not None:
                                sheet["extractedNumber"] = info.number
                                sheet["extractedTitle"] = info.title
                                sheet["metadataSource"] = info.provenance
                                sheet["metadataNeedsReview"] = info.needs_review
                                # A retry must never discard an operator's metadata edit.
                                if info.number and sheet["number"].startswith("Sheet-"):
                                    sheet["number"] = info.number
                                if info.title and (sheet["title"].startswith("Sheet ")
                                                   or sheet["title"].endswith("번째 도면")):
                                    sheet["title"] = info.title
                            root = store.meta["drawingSets"][project_id][set_id]
                            root["completedPages"] = sum(
                                store.meta["drawingSheets"][project_id][sid]["status"] == "ready"
                                for sid in root["sheetIds"])
                            root["updatedAt"] = store.engine.at()

        with store.transaction(write=True):
            root = store.meta["drawingSets"][project_id][set_id]
            if root.get("renderOwner") != token:
                return
            rows = [store.meta["drawingSheets"][project_id][sid] for sid in root["sheetIds"]]
            root["completedPages"] = sum(sheet["status"] == "ready" for sheet in rows)
            root["status"] = "ready" if root["completedPages"] == pages else "failed"
            if root["status"] == "ready":
                root.pop("error", None)
            else:
                root["error"] = "일부 페이지 변환에 실패했습니다. 실패한 페이지만 다시 시도할 수 있습니다."
            root["updatedAt"] = store.engine.at()
            root.pop("renderOwner", None)
            root.pop("renderHeartbeat", None)
    except Exception:
        LOG.exception("Raster import failed for set %s", set_id)
        with store.transaction(write=True):
            root = store.meta["drawingSets"][project_id][set_id]
            if root.get("renderOwner") != token:
                return
            for sheet_id in root["sheetIds"]:
                sheet = store.meta["drawingSheets"][project_id][sheet_id]
                if sheet["status"] == "processing":
                    sheet["status"] = "failed"
                    sheet["updatedAt"] = store.engine.at()
            root["completedPages"] = sum(
                store.meta["drawingSheets"][project_id][sid]["status"] == "ready"
                for sid in root["sheetIds"])
            root["status"] = "failed"
            root["error"] = "PDF 이미지 변환에 실패했습니다. 원본을 확인한 뒤 다시 시도하십시오."
            root["updatedAt"] = store.engine.at()
            root.pop("renderOwner", None)
            root.pop("renderHeartbeat", None)


def _refresh_existing_metadata(store, project_id, set_id):
    """One-page-at-a-time indexer, never changes a manually assigned drawing number."""
    try:
        with store.transaction():
            root = store.meta["drawingSets"][project_id][set_id]
            content = store.blob(root["sourceBlobId"])
            ids = list(root["sheetIds"])
        with TemporaryDirectory(prefix="doul-metadata-") as folder:
            pdf = Path(folder) / "original.pdf"
            pdf.write_bytes(content)
            require(pdf_pages(pdf) == len(ids), "SOURCE_INVALID", "Page identity changed")
            for n, sheet_id in enumerate(ids, 1):
                try:
                    candidate = extract_sheet_candidate(n, pdf_page_text(pdf, n))
                except (PdfSheetError, ValueError):
                    candidate = None
                with store.transaction(write=True):
                    sheet = store.meta["drawingSheets"][project_id][sheet_id]
                    if candidate is not None:
                        sheet["extractedNumber"] = candidate.number
                        sheet["extractedTitle"] = candidate.title
                        sheet["metadataSource"] = candidate.provenance
                        sheet["metadataNeedsReview"] = candidate.needs_review
                        if sheet["number"].startswith("Sheet-") and candidate.number:
                            sheet["number"] = candidate.number
                            if candidate.title:
                                sheet["title"] = candidate.title
                            sheet["version"] += 1
                    row = store.meta["drawingSets"][project_id][set_id]
                    row["metadataCompletedPages"] = n
                    row["updatedAt"] = store.engine.at()
        with store.transaction(write=True):
            store.meta["drawingSets"][project_id][set_id]["metadataStatus"] = "ready"
    except Exception:
        LOG.exception("Sheet metadata extraction failed for %s", set_id)
        with store.transaction(write=True):
            store.meta["drawingSets"][project_id][set_id]["metadataStatus"] = "failed"

def install_drawing_sheet_routes(app, store, *, identity, role_for, key_for):
    def context(project_id, request, actor):
        return _scope(store, project_id, request, actor, role_for)

    def sheet_for(project_id, sheet_id):
        row = store.meta.get("drawingSheets", {}).get(project_id, {}).get(sheet_id)
        require(row is not None, "NOT_FOUND", "도면을 찾을 수 없습니다")
        return row

    def set_for(project_id, set_id):
        row = store.meta.get("drawingSets", {}).get(project_id, {}).get(set_id)
        require(row is not None, "NOT_FOUND", "도면 묶음을 찾을 수 없습니다")
        return row

    @app.get("/projects/{project_id}/drawing-sets")
    def list_sets(project_id: str, request: Request):
        actor = identity(request)
        with store.transaction():
            context(project_id, request, actor)
            values = list(store.meta.get("drawingSets", {}).get(project_id, {}).values())
            return {"items": sorted(deepcopy(values), key=lambda x: x["createdAt"], reverse=True)}

    @app.get("/projects/{project_id}/drawing-sets/{set_id}")
    def get_set(project_id: str, set_id: str, request: Request):
        actor = identity(request)
        with store.transaction():
            context(project_id, request, actor)
            return {"set": deepcopy(set_for(project_id, set_id))}

    @app.post("/projects/{project_id}/drawing-sets", status_code=202)
    async def upload_set(project_id: str, request: Request, tasks: BackgroundTasks):
        actor = identity(request)
        key = key_for(request)
        # Authenticate role before spending CPU or memory on untrusted PDF decoding.
        with store.transaction():
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "도면 등록 권한이 없습니다")
        require(request.headers.get("content-type", "").split(";")[0].strip().lower() == "application/pdf",
                "MIME_INVALID", "PDF 형식만 업로드할 수 있습니다")
        filename = unquote(request.query_params.get("filename", ""))
        require(bool(filename) and filename.lower().endswith(".pdf")
                and filename == Path(filename).name and len(filename) <= 180
                and not any(ord(c) < 32 for c in filename), "INVALID_REQUEST", "PDF 파일명을 확인하십시오")
        data = bytearray()
        async for chunk in request.stream():
            require(len(data) + len(chunk) <= MAX_SOURCE_BYTES, "PAYLOAD_TOO_LARGE", "PDF는 20MB 이하만 지원합니다")
            data.extend(chunk)
        pdf_bytes = bytes(data)
        require(pdf_bytes.startswith(b"%PDF-"), "MIME_INVALID", "유효한 PDF 파일이 아닙니다")
        digest = sha256(pdf_bytes).hexdigest()
        # Validate before writing any domain or blob record.
        try:
            with TemporaryDirectory(prefix="doul-pdfinfo-") as folder:
                original = Path(folder) / "upload.pdf"
                original.write_bytes(pdf_bytes)
                count = pdf_pages(original)
        except PdfSheetError as exc:
            raise ContractError("INVALID_REQUEST", str(exc)) from exc

        fingerprint = sha256((project_id + ":" + filename + ":" + digest).encode()).hexdigest()
        request_key = "drawing-set:" + project_id + ":" + actor["partyId"] + ":" + key
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "도면 등록 권한이 없습니다")
            cached = store.requests.get(request_key)
            if cached is not None:
                require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "동일 요청 키의 파일이 다릅니다")
                row = set_for(project_id, cached["setId"])
                return {"set": deepcopy(row)}

            now = store.engine.at()
            set_id = str(uuid4())
            file_id = "drawing-original:" + set_id
            ids = [str(uuid4()) for _ in range(count)]
            row = dict(id=set_id, version=1, projectId=project_id, fileName=filename,
                       folder=_folder(filename), sha256=digest, size=len(pdf_bytes),
                       sourceBlobId=file_id, sheetIds=ids, pageCount=count, completedPages=0,
                       status="processing", createdAt=now, updatedAt=now,
                       createdByPartyId=actor["partyId"], dataClassification="DRAFT_NOT_ISSUED")
            store.put_blob(file_id, pdf_bytes)
            store.meta.setdefault("drawingSets", {}).setdefault(project_id, {})[set_id] = row
            sheets = store.meta.setdefault("drawingSheets", {}).setdefault(project_id, {})
            for index, sheet_id in enumerate(ids, start=1):
                sheets[sheet_id] = dict(
                    id=sheet_id, version=1, projectId=project_id, setId=set_id,
                    pageNo=index, number=f"Sheet-{index:03d}", title=f"{index}번째 도면",
                    folder=row["folder"], status="processing", revision="초안",
                    drawingRef=None, bindingId=None,
                    thumbBlobId=None, previewBlobId=None, createdAt=now,
                    updatedAt=now, createdByPartyId=actor["partyId"])
            _audit(store, project_id, "set_uploaded", actor, role, {
                "setId": set_id, "pageCount": count, "sha256": digest})
            store.requests[request_key] = {"hash": fingerprint, "setId": set_id}
            result = deepcopy(row)
        tasks.add_task(_render_set, store, project_id, set_id)
        return {"set": result}

    @app.post("/projects/{project_id}/drawing-sets/from-evidence", status_code=202)
    async def import_registered_evidence(project_id: str, request: Request, tasks: BackgroundTasks):
        """Index a previously registered project PDF without writing its original bytes twice."""
        actor = identity(request)
        key = key_for(request)
        body = await request.json()
        require(isinstance(body, dict) and set(body) == {"evidenceRef"}, "INVALID_REQUEST",
                "A registered Evidence reference is required")
        ref = body["evidenceRef"]
        require(isinstance(ref, dict) and set(ref) == {"objectType", "objectId", "version"}
                and ref["objectType"] == "Evidence" and isinstance(ref["objectId"], str)
                and type(ref["version"]) is int and ref["version"] > 0, "INVALID_REQUEST",
                "A current Evidence version is required")
        require(isinstance(key, str) and key.strip(), "IDEMPOTENCY_KEY_INVALID", "Request key required")
        with store.transaction():
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "Drawing registration forbidden")
            source = store.engine.resolve(ref, project_id)
            store.engine.authorize_read(source, actor["partyId"], role["id"])
            require(source.get("sourceType") == "original" and source.get("mediaType") == "document"
                    and source.get("metadata", {}).get("mimeType") == "application/pdf",
                    "SOURCE_INVALID", "Registered original PDF required")
            filename = source["metadata"].get("name", "drawing.pdf")
            require(Path(filename).name == filename and filename.lower().endswith(".pdf"),
                    "SOURCE_INVALID", "Invalid filename")
            blob_id = source["fileId"]
            original = store.blob(blob_id)
            digest = sha256(original).hexdigest()
            require(original.startswith(b"%PDF-") and len(original) <= 64 * 1024 * 1024
                    and digest == source["fileHash"], "SOURCE_INVALID", "PDF identity mismatch")
        try:
            with TemporaryDirectory(prefix="doul-existing-pdf-") as folder:
                path = Path(folder) / "original.pdf"
                path.write_bytes(original)
                count = pdf_pages(path)
        except PdfSheetError as exc:
            raise ContractError("INVALID_REQUEST", str(exc)) from exc

        request_key = "drawing-from-evidence:" + project_id + ":" + actor["partyId"] + ":" + key
        fingerprint = sha256(json.dumps(ref, sort_keys=True).encode()).hexdigest()
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "Drawing registration forbidden")
            source = store.engine.resolve(ref, project_id)
            store.engine.authorize_read(source, actor["partyId"], role["id"])
            require(source["fileId"] == blob_id and source["fileHash"] == digest,
                    "REFERENCE_STALE", "Original Evidence changed")
            cached = store.requests.get(request_key)
            if cached:
                require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Request changed")
                return {"set": deepcopy(set_for(project_id, cached["setId"]))}
            for existing in store.meta.get("drawingSets", {}).get(project_id, {}).values():
                if existing.get("sourceEvidenceId") == source["id"] and existing.get("sha256") == digest:
                    store.requests[request_key] = {"hash": fingerprint, "setId": existing["id"]}
                    return {"set": deepcopy(existing)}
            now = store.engine.at()
            set_id = str(uuid4())
            ids = [str(uuid4()) for _ in range(count)]
            row = dict(id=set_id, version=1, projectId=project_id, fileName=filename,
                       folder=_folder(filename), sha256=digest, size=len(original),
                       sourceBlobId=blob_id, sourceEvidenceId=source["id"],
                       sheetIds=ids, pageCount=count, completedPages=0,
                       status="processing", createdAt=now, updatedAt=now,
                       createdByPartyId=actor["partyId"],
                       dataClassification="USER_PROVIDED_ORIGINAL_NOT_ISSUED")
            store.meta.setdefault("drawingSets", {}).setdefault(project_id, {})[set_id] = row
            sheets = store.meta.setdefault("drawingSheets", {}).setdefault(project_id, {})
            for index, sheet_id in enumerate(ids, start=1):
                sheets[sheet_id] = dict(
                    id=sheet_id, version=1, projectId=project_id, setId=set_id,
                    pageNo=index, number=f"Sheet-{index:03d}", title=f"Sheet {index} (verify)",
                    folder=row["folder"], status="processing", revision="unverified",
                    drawingRef=None, bindingId=None, thumbBlobId=None, previewBlobId=None,
                    createdAt=now, updatedAt=now, createdByPartyId=actor["partyId"])
            _audit(store, project_id, "registered_evidence_indexed", actor, role,
                   {"setId": set_id, "evidenceId": source["id"], "pageCount": count, "sha256": digest})
            store.requests[request_key] = {"hash": fingerprint, "setId": set_id}
            result = deepcopy(row)
        tasks.add_task(_render_set, store, project_id, set_id)
        return {"set": result}

    @app.post("/projects/{project_id}/drawing-sets/{set_id}/retry", status_code=202)
    async def retry_failed_set(project_id: str, set_id: str, request: Request, tasks: BackgroundTasks):
        """Resume only failed pages with version and role guards; keep ready images."""
        actor = identity(request)
        key = key_for(request)
        require(isinstance(key, str) and 1 <= len(key) <= 160, "IDEMPOTENCY_KEY_INVALID",
                "Request key required")
        try:
            body = await request.json()
        except ValueError as exc:
            raise ContractError("INVALID_REQUEST", "Invalid JSON") from exc
        require(isinstance(body, dict) and set(body) == {"expectedVersion"}
                and type(body["expectedVersion"]) is int and body["expectedVersion"] > 0,
                "INVALID_REQUEST", "Expected drawing-set version required")
        fingerprint = sha256(json.dumps({"setId": set_id, **body}, sort_keys=True).encode()).hexdigest()
        request_key = f"drawing-set-retry:{project_id}:{actor['partyId']}:{key}"
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "도면 변환 재시도 권한이 없습니다")
            cached = store.requests.get(request_key)
            if cached:
                require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Request changed")
                return {"set": deepcopy(set_for(project_id, cached["setId"]))}
            root = set_for(project_id, set_id)
            require(root["version"] == body["expectedVersion"], "VERSION_CONFLICT",
                    "도면 묶음 버전이 변경되었습니다")
            require(root["status"] == "failed", "INVALID_REQUEST",
                    "실패한 도면 묶음만 재시도할 수 있습니다")
            pending = [store.meta["drawingSheets"][project_id][sid] for sid in root["sheetIds"]
                       if store.meta["drawingSheets"][project_id][sid]["status"] != "ready"]
            require(bool(pending), "INVALID_REQUEST", "재처리할 페이지가 없습니다")
            original = store.blob(root["sourceBlobId"])
            require(sha256(original).hexdigest() == root["sha256"], "SOURCE_INVALID",
                    "원본 PDF가 변경되어 재시도할 수 없습니다")
            now = store.engine.at()
            root["version"] += 1
            root["status"] = "processing"
            root.pop("error", None)
            root["updatedAt"] = now
            for sheet in pending:
                sheet["status"] = "processing"
                sheet["updatedAt"] = now
            _audit(store, project_id, "sheet_raster_retry_requested", actor, role,
                   {"setId": set_id, "remainingPages": len(pending),
                    "sha256": root["sha256"], "version": root["version"]})
            store.requests[request_key] = {"hash": fingerprint, "setId": set_id}
            result = deepcopy(root)
        tasks.add_task(_render_set, store, project_id, set_id)
        return {"set": result}

    @app.post("/projects/{project_id}/drawing-sets/{set_id}/refresh-metadata", status_code=202)
    async def refresh_registered_metadata(project_id: str, set_id: str, request: Request, tasks: BackgroundTasks):
        """Refresh extracted sheet titleblock candidates without rewriting the PDF or manual edits."""
        actor = identity(request)
        key = key_for(request)
        require(isinstance(key, str) and key.strip(), "IDEMPOTENCY_KEY_INVALID", "Request key required")
        cache_key = f"sheet-metadata-refresh:{project_id}:{actor['partyId']}:{key}"
        fingerprint = sha256((project_id + ":" + set_id).encode()).hexdigest()
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "Drawing edit forbidden")
            cache = store.requests.get(cache_key)
            if cache:
                require(cache["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Request changed")
                return {"set": deepcopy(set_for(project_id, cache["setId"]))}
            row = set_for(project_id, set_id)
            require(row["status"] == "ready", "INVALID_REQUEST", "Drawing images not ready")
            if row.get("metadataStatus") != "processing":
                row["metadataStatus"] = "processing"
                row["metadataCompletedPages"] = 0
                row["updatedAt"] = store.engine.at()
                tasks.add_task(_refresh_existing_metadata, store, project_id, set_id)
            _audit(store, project_id, "sheet_metadata_refresh_requested", actor, role,
                   {"setId": set_id, "sha256": row["sha256"]})
            store.requests[cache_key] = {"setId": set_id, "hash": fingerprint}
            return {"set": deepcopy(row)}

    @app.get("/projects/{project_id}/drawing-sheets")
    def list_sheets(project_id: str, request: Request):
        actor = identity(request)
        with store.transaction():
            context(project_id, request, actor)
            sheets = store.meta.get("drawingSheets", {}).get(project_id, {})
            items = sorted(sheets.values(), key=lambda row: (row["createdAt"], row["setId"], row["pageNo"]))
            return {"items": [_sheet_result(item) for item in items], "count": len(items)}

    def visible_pins(project_id, sheet_id, actor, role):
        pins = store.meta.get("drawingSheetPins", {}).get(project_id, {}).get(sheet_id, {})
        values = []
        for pin in pins.values():
            reference = pin.get("recordRef")
            if reference:
                try:
                    record = store.engine.resolve(reference, project_id)
                    store.engine.authorize_read(record, actor["partyId"], role["id"])
                except (ContractError, KeyError):
                    continue
            values.append(deepcopy(pin))
        return sorted(values, key=lambda item: item["createdAt"])

    @app.get("/projects/{project_id}/drawing-sheets/pin-index")
    def pin_index(project_id: str, request: Request):
        """One permission-filtered read for Today and per-sheet count/thumbnail overlays."""
        actor = identity(request)
        with store.transaction():
            role = context(project_id, request, actor)
            sheets = store.meta.get("drawingSheets", {}).get(project_id, {})
            reply_project = store.meta.get("drawingPinReplies", {}).get(project_id, {})
            rows = []
            for sheet in sheets.values():
                for pin in visible_pins(project_id, sheet["id"], actor, role):
                    replies = reply_project.get(sheet["id"], {}).get(pin["id"], [])
                    latest = replies[-1] if replies else None
                    rows.append({
                        "pinId": pin["id"], "sheetId": sheet["id"],
                        "kind": pin["kind"], "comment": pin["comment"],
                        "status": pin["status"], "recordRef": pin.get("recordRef"),
                        "x": pin["x"], "y": pin["y"],
                        "createdAt": pin["createdAt"],
                        "lastActivityAt": latest["createdAt"] if latest else pin["createdAt"],
                        "replyCount": len(replies),
                        "latestReply": latest["message"][:180] if latest else None,
                        "sheetNumber": sheet["number"], "sheetTitle": sheet["title"],
                        "sheetRevision": sheet.get("revision", ""),
                    })
            rows.sort(key=lambda item: (item["lastActivityAt"], item["pinId"]), reverse=True)
            return {"items": rows, "count": len(rows)}

    @app.get("/projects/{project_id}/drawing-sheets/{sheet_id}")
    def get_sheet(project_id: str, sheet_id: str, request: Request):
        actor = identity(request)
        with store.transaction():
            role = context(project_id, request, actor)
            row = sheet_for(project_id, sheet_id)
            return {"sheet": _sheet_result(row),
                    "pins": visible_pins(project_id, sheet_id, actor, role)}

    @app.get("/projects/{project_id}/drawing-sheets/{sheet_id}/image")
    def sheet_image(project_id: str, sheet_id: str, request: Request, size: str = "preview"):
        actor = identity(request)
        require(size in {"preview", "thumb"}, "INVALID_REQUEST", "Unknown image size")
        with store.transaction():
            context(project_id, request, actor)
            row = sheet_for(project_id, sheet_id)
            image_id = row.get("previewBlobId" if size == "preview" else "thumbBlobId")
            require(image_id is not None and row["status"] == "ready", "NOT_FOUND", "이미지 변환 중입니다")
            content = store.blob(image_id)
        return Response(content, media_type="image/jpeg", headers={
            "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff",
        })

    @app.patch("/projects/{project_id}/drawing-sheets/{sheet_id}")
    async def update_sheet(project_id: str, sheet_id: str, request: Request):
        actor = identity(request)
        key = key_for(request)
        try:
            body = await request.json()
        except ValueError as exc:
            raise ContractError("INVALID_REQUEST", "Invalid JSON") from exc
        require(isinstance(body, dict) and set(body) == {"expectedVersion", "number", "title"},
                "INVALID_REQUEST", "Required fields: expectedVersion, number, title")
        require(isinstance(body["expectedVersion"], int) and not isinstance(body["expectedVersion"], bool)
                and body["expectedVersion"] > 0, "INVALID_REQUEST", "Invalid expected version")
        for field, limit in (("number", 60), ("title", 220)):
            require(isinstance(body[field], str) and 0 < len(body[field].strip()) <= limit,
                    "INVALID_REQUEST", f"Invalid {field}")
        fingerprint = sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        request_key = "drawing-sheet-edit:" + project_id + ":" + actor["partyId"] + ":" + key
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "도면 수정 권한이 없습니다")
            cached = store.requests.get(request_key)
            if cached:
                require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Same key has different payload")
                return deepcopy(cached["result"])
            row = sheet_for(project_id, sheet_id)
            require(row["version"] == body["expectedVersion"], "VERSION_CONFLICT", "도면 정보가 변경되었습니다")
            row.update(version=row["version"] + 1, number=body["number"].strip(),
                       title=body["title"].strip(), updatedAt=store.engine.at())
            # Editing the identity after verification must invalidate that review.
            if row.get("metadataReview", {}).get("status") == "verified":
                row["metadataReview"] = {**row["metadataReview"], "status": "needs_review",
                    "note": "The drawing identity was edited after verification; recheck required."}
            _audit(store, project_id, "sheet_renamed", actor, role, {
                "sheetId": sheet_id, "version": row["version"]})
            result = {"sheet": _sheet_result(row)}
            store.requests[request_key] = {"hash": fingerprint, "result": deepcopy(result)}
            return result

    @app.get("/projects/{project_id}/drawing-sheets/{sheet_id}/pins")
    def list_pins(project_id: str, sheet_id: str, request: Request):
        actor = identity(request)
        with store.transaction():
            role = context(project_id, request, actor)
            sheet_for(project_id, sheet_id)
            values = visible_pins(project_id, sheet_id, actor, role)
            return {"items": values, "count": len(values)}

    @app.post("/projects/{project_id}/drawing-sheets/{sheet_id}/pins")
    async def add_pin(project_id: str, sheet_id: str, request: Request):
        actor = identity(request)
        key = key_for(request)
        try:
            body = await request.json()
        except ValueError as exc:
            raise ContractError("INVALID_REQUEST", "Invalid JSON") from exc
        require(isinstance(body, dict) and set(body) == {"x", "y", "kind", "comment", "recordRef"},
                "INVALID_REQUEST", "Pin requires x, y, kind, comment, recordRef")
        for coord in ("x", "y"):
            require(type(body[coord]) in (float, int) and 0 <= body[coord] <= 1,
                    "INVALID_REQUEST", "Pin coordinates are normalized 0-1")
        require(body["kind"] in KINDS, "INVALID_REQUEST", "Unknown pin category")
        require(isinstance(body["comment"], str) and
                0 < len(body["comment"].strip()) <= MAX_PIN_TEXT, "INVALID_REQUEST", "Pin comment required")
        reference = body["recordRef"]
        require(reference is None or (isinstance(reference, dict)
            and set(reference) == {"objectType", "objectId", "version"}
            and reference["objectType"] in LINK_TYPES
            and isinstance(reference["objectId"], str)
            and type(reference["version"]) is int and reference["version"] > 0),
            "INVALID_REQUEST", "Invalid linked record")
        fingerprint = sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        request_key = "drawing-sheet-pin:" + project_id + ":" + actor["partyId"] + ":" + key
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "핀 생성 권한이 없습니다")
            cached = store.requests.get(request_key)
            if cached:
                require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Pin key payload changed")
                return deepcopy(cached["result"])
            sheet = sheet_for(project_id, sheet_id)
            require(sheet["status"] == "ready", "INVALID_REQUEST", "준비된 도면을 선택하십시오")
            if reference:
                record = store.engine.resolve(reference, project_id)
                store.engine.authorize_read(record, actor["partyId"], role["id"])
            now = store.engine.at()
            pin = dict(id=str(uuid4()), version=1, sheetId=sheet_id, projectId=project_id,
                       x=float(body["x"]), y=float(body["y"]),
                       kind=body["kind"], comment=body["comment"].strip(),
                       recordRef=deepcopy(reference), status="draft" if not reference else "linked",
                       createdAt=now, createdByPartyId=actor["partyId"], createdByRole=role["actorGroup"])
            store.meta.setdefault("drawingSheetPins", {}).setdefault(project_id, {}).setdefault(sheet_id, {})[pin["id"]] = pin
            _audit(store, project_id, "pin_created", actor, role, {"sheetId": sheet_id, "pinId": pin["id"]})
            result = {"pin": deepcopy(pin)}
            store.requests[request_key] = {"hash": fingerprint, "result": deepcopy(result)}
            return result

    install_sheet_metadata_review_routes(
        app, store, identity=identity, context=context, sheet_for=sheet_for,
        set_for=set_for, key_for=key_for, audit=_audit)
    install_sheet_markup_routes(app, store, identity=identity, context=context,
                                sheet_for=sheet_for, key_for=key_for, audit=_audit)

    install_sheet_revision_routes(app, store, identity=identity, context=context,
                                  sheet_for=sheet_for, set_for=set_for,
                                  key_for=key_for, audit=_audit)
    install_sheet_pin_reply_routes(
        app, store, identity=identity, context=context, sheet_for=sheet_for,
        visible_pins=visible_pins, key_for=key_for, audit=_audit)
