#!/usr/bin/env python3
"""Read-only, original-PDF sheet catalog acceptance verifier.

Run against an authenticated staging API. This script NEVER uploads, patches,
posts, modifies drawing data, or saves PDF bytes. Only a JSON summary is written.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


MAX_IMAGE_BYTES = 4 * 1024 * 1024
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
IMAGE_KINDS = ("thumb", "preview")
HTTP_TIMEOUT = 20


class CatalogQAError(Exception):
    pass


def require_safe_api_url(base_url: str) -> str:
    value = base_url.rstrip("/")
    info = urlsplit(value)
    if info.query or info.fragment or info.username or info.password:
        raise CatalogQAError("API URL must not include credentials or query arguments")
    allowed_loopback = info.hostname in ("127.0.0.1", "localhost", "::1")
    if info.scheme != "https" and not (info.scheme == "http" and allowed_loopback):
        raise CatalogQAError("HTTPS is required outside loopback")
    if not info.netloc:
        raise CatalogQAError("API URL must include a host")
    return value


def parse_manifest(manifest: dict) -> tuple[str, list[dict]]:
    if not isinstance(manifest, dict) or set(manifest) != {"projectId", "sources"}:
        raise CatalogQAError("Expected projectId and sources")
    project = manifest["projectId"]
    source_specs = manifest["sources"]
    if not isinstance(project, str) or not project or "/" in project:
        raise CatalogQAError("Invalid project ID")
    if not isinstance(source_specs, list) or not 1 <= len(source_specs) <= 25:
        raise CatalogQAError("Manifest needs 1..25 expected original PDF sources")
    seen = set()
    for source in source_specs:
        if not isinstance(source, dict) or not {"fileName", "sha256", "pages", "expectEvidenceReuse"} <= set(source):
            raise CatalogQAError("Each source must declare name, sha256, page count and reuse policy")
        if not isinstance(source["fileName"], str) or not source["fileName"].lower().endswith(".pdf"):
            raise CatalogQAError("Expected a literal PDF filename")
        if source["fileName"] in seen:
            raise CatalogQAError("Manifest contains duplicate source names")
        seen.add(source["fileName"])
        if not isinstance(source["sha256"], str) or not HASH_RE.fullmatch(source["sha256"]):
            raise CatalogQAError("Expected a lower-case SHA-256")
        if type(source["pages"]) is not int or not 1 <= source["pages"] <= 150:
            raise CatalogQAError("PDF page count out of bounds")
        if type(source["expectEvidenceReuse"]) is not bool:
            raise CatalogQAError("Evidence reuse policy must be boolean")
    return project, source_specs


def inspect_catalog(sets: list[dict], sheets: list[dict], sources: list[dict]) -> dict:
    """Return per-source diagnostics and errors without inferring drawing approval."""
    errors = []
    catalog = []
    sheets_by_set = defaultdict(list)
    for sheet in sheets:
        sheets_by_set[sheet.get("setId")].append(sheet)

    source_set_ids = set()
    for expected in sources:
        matches = [s for s in sets if s.get("fileName") == expected["fileName"]
                   and s.get("sha256") == expected["sha256"]]
        if len(matches) != 1:
            errors.append(f"Source identity ambiguity: {expected['fileName']} ({len(matches)} matches)")
            continue
        group = matches[0]
        source_set_ids.add(group["id"])
        rows = sorted(sheets_by_set.get(group["id"], []), key=lambda s: s.get("pageNo", 0))
        pages = [r.get("pageNo") for r in rows]
        expected_pages = list(range(1, expected["pages"] + 1))
        if pages != expected_pages:
            errors.append(f"Page identity mismatch: {expected['fileName']}")
        if group.get("pageCount") != expected["pages"]:
            errors.append(f"Registered PDF page count mismatch: {expected['fileName']}")
        if group.get("status") != "ready" or group.get("completedPages") != expected["pages"]:
            errors.append(f"PDF not fully rendered: {expected['fileName']}")
        if expected["expectEvidenceReuse"] and not group.get("sourceEvidenceId"):
            errors.append(f"Registered original Evidence was not linked: {expected['fileName']}")
        for row in rows:
            if row.get("status") != "ready" or not row.get("hasThumb") or not row.get("hasPreview"):
                errors.append(f"Missing ready image: {expected['fileName']} page {row.get('pageNo')}")
        nums = Counter(x.get("extractedNumber") for x in rows if x.get("extractedNumber"))
        duplicates = sorted([name for name, occurrences in nums.items() if occurrences > 1])
        catalog.append({
            "fileName": expected["fileName"],
            "setId": group["id"],
            "sha256": group["sha256"],
            "sourceEvidenceId": group.get("sourceEvidenceId"),
            "expectedPages": expected["pages"],
            "actualPages": len(rows),
            "imageReadyPages": sum(row.get("status") == "ready" and row.get("hasThumb") and
                                   row.get("hasPreview") for row in rows),
            "numberCandidates": sum(bool(row.get("extractedNumber")) for row in rows),
            "titleCandidates": sum(bool(row.get("extractedTitle")) for row in rows),
            "humanVerified": sum((row.get("metadataReview") or {}).get("status") == "verified" for row in rows),
            "unverifiedPages": [row.get("pageNo") for row in rows
                                if (row.get("metadataReview") or {}).get("status") != "verified"],
            "duplicateNumberCandidates": duplicates,
            "sheets": [(row["id"], row.get("pageNo")) for row in rows],
        })

    expected_total = sum(x["pages"] for x in sources)
    selected_total = sum(len(x["sheets"]) for x in catalog)
    if selected_total != expected_total:
        errors.append(f"Requested page total mismatch: {selected_total}/{expected_total}")
    # No assumptions about extra synthetic/nonrequested drawing sets: report separately.
    return {
        "expectedPages": expected_total,
        "selectedPages": selected_total,
        "otherRegisteredPages": len([s for s in sheets if s.get("setId") not in source_set_ids]),
        "sources": catalog,
        "errors": errors,
    }


def valid_jpeg(data: bytes, content_type: str) -> bool:
    return (content_type.split(";", 1)[0].strip().lower() == "image/jpeg"
            and 1000 < len(data) <= MAX_IMAGE_BYTES
            and data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"))


class APIReader:
    def __init__(self, url: str, token: str, origin: str | None):
        self.base_url = require_safe_api_url(url)
        if not token or any(char.isspace() for char in token):
            raise CatalogQAError("Token must be a single nonempty string")
        self.headers = {"Authorization": "Bearer " + token}
        if origin:
            self.headers["Origin"] = origin

    def fetch(self, route: str, limit: int = 8 * 1024 * 1024) -> tuple[bytes, str]:
        request = Request(self.base_url + route, headers=self.headers, method="GET")
        try:
            with urlopen(request, timeout=HTTP_TIMEOUT) as response:
                content = response.read(limit + 1)
                if len(content) > limit:
                    raise CatalogQAError(f"Response exceeds allowed size: {route}")
                return content, response.headers.get("Content-Type", "")
        except (HTTPError, URLError) as exc:
            status = getattr(exc, "code", "network failure")
            raise CatalogQAError(f"Authenticated read failed ({status})") from exc

    def json(self, route: str) -> dict:
        content, _ = self.fetch(route)
        try:
            value = json.loads(content)
        except ValueError as exc:
            raise CatalogQAError("Invalid API JSON") from exc
        if not isinstance(value, dict) or not isinstance(value.get("items"), list):
            raise CatalogQAError("Expected an item collection")
        return value


def check_images(reader: APIReader, project: str, entries: list[dict], workers: int) -> dict:
    tasks = []
    for group in entries:
        for sheet_id, page_no in group["sheets"]:
            for kind in IMAGE_KINDS:
                tasks.append((group["fileName"], sheet_id, page_no, kind))

    def inspect(item: tuple[str, str, int, str]):
        file_name, sheet_id, page, kind = item
        route = ("/projects/" + quote(project, safe="") + "/drawing-sheets/"
                 + quote(sheet_id, safe="") + "/image?size=" + kind)
        try:
            body, mime = reader.fetch(route, limit=MAX_IMAGE_BYTES)
            valid = valid_jpeg(body, mime)
        except CatalogQAError:
            valid = False
        return (file_name, page, kind, valid)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(inspect, tasks))
    failures = [{"fileName":f, "page":p, "image":k}
                for f, p, k, valid in results if not valid]
    return {
        "requested": len(tasks), "passed": len(tasks) - len(failures),
        "failures": failures,
    }


def run() -> int:
    parser = argparse.ArgumentParser(description="Verify already registered original drawing sheets (read-only)")
    parser.add_argument("--api-url", required=True, help="HTTPS API root or localhost HTTP")
    parser.add_argument("--manifest", type=Path, required=True, help="Private JSON with projectId and expected sources")
    parser.add_argument("--token-env", default="DOUL_QA_ACCESS_TOKEN", help="Environment variable, never pass literal tokens")
    parser.add_argument("--origin", help="Exact permitted Origin header for staging")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--report", type=Path, required=True)
    options = parser.parse_args()
    if not 1 <= options.workers <= 6:
        parser.error("Worker count must be 1..6 to avoid stressing the staging server")
    start = monotonic()
    try:
        project, sources = parse_manifest(json.loads(options.manifest.read_text(encoding="utf-8")))
        token = os.environ.get(options.token_env, "")
        reader = APIReader(options.api_url, token, options.origin)
        prefix = "/projects/" + quote(project, safe="")
        sets = reader.json(prefix + "/drawing-sets")["items"]
        sheets = reader.json(prefix + "/drawing-sheets")["items"]
        result = inspect_catalog(sets, sheets, sources)
        images = check_images(reader, project, result["sources"], options.workers)
        result["images"] = images
        result["passed"] = not result["errors"] and images["requested"] == (
            result["expectedPages"] * len(IMAGE_KINDS)) and images["passed"] == images["requested"]
        result["checkedAt"] = datetime.now(timezone.utc).isoformat()
        result["elapsedSeconds"] = round(monotonic() - start, 2)
        result["classification"] = "READ_ONLY_SOURCE_QA_NOT_HUMAN_DRAWING_APPROVAL"
        # Exclude the authenticated URL, headers, session tokens and sheet IDs from report.
        for source in result["sources"]:
            source.pop("sheets", None)
            source.pop("setId", None)
        options.report.parent.mkdir(parents=True, exist_ok=True)
        options.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"passed": result["passed"], "pages": result["selectedPages"],
                          "images": result["images"]["passed"], "total": result["images"]["requested"],
                          "errors": len(result["errors"]) + len(result["images"]["failures"])},
                         ensure_ascii=False))
        return 0 if result["passed"] else 1
    except (CatalogQAError, OSError, ValueError, KeyError) as exc:
        print("Drawing original QA cannot complete: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
