#!/usr/bin/env python3
"""Safely connect an existing registered Evidence PDF to page-by-page drawings.

Dry-run by default. This script cannot upload files or create Evidence. It
requires an explicit expected name, hash, Evidence version and page count.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from time import monotonic, sleep
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from scripts.verify_drawing_originals import CatalogQAError, HASH_RE, inspect_catalog, require_safe_api_url

MAX_BYTES = 64 * 1024 * 1024


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CatalogQAError("Unexpected redirect; token will not be forwarded")


def read_manifest(path: Path) -> dict:
    obj = json.loads(path.read_text(encoding="utf-8"))
    expected = {"projectId", "evidenceId", "version", "fileName", "sha256", "pages", "size"}
    if not isinstance(obj, dict) or set(obj) != expected:
        raise CatalogQAError("Required fields: " + ", ".join(sorted(expected)))
    if any(not isinstance(obj[field], str) or not obj[field] or
           "/" in obj[field] for field in ("projectId", "evidenceId")):
        raise CatalogQAError("Invalid project/evidence ID")
    if type(obj["version"]) is not int or obj["version"] < 1:
        raise CatalogQAError("Positive Evidence version required")
    if not isinstance(obj["fileName"], str) or not obj["fileName"].lower().endswith(".pdf") or \
            Path(obj["fileName"]).name != obj["fileName"]:
        raise CatalogQAError("Exact PDF filename required")
    if not isinstance(obj["sha256"], str) or HASH_RE.fullmatch(obj["sha256"]) is None:
        raise CatalogQAError("Lowercase SHA-256 required")
    if type(obj["pages"]) is not int or not 1 <= obj["pages"] <= 150:
        raise CatalogQAError("Supported page count: 1..150")
    if type(obj["size"]) is not int or not 0 < obj["size"] <= MAX_BYTES:
        raise CatalogQAError("Expected existing PDF must be 1..64 MiB")
    return obj


def verify_workspace_evidence(workspace: dict, expected: dict) -> dict:
    if not isinstance(workspace, dict) or workspace.get("project", {}).get("id") != expected["projectId"]:
        raise CatalogQAError("Authenticated workspace is not the expected project")
    records = [item["record"] for item in workspace.get("items", [])
               if isinstance(item, dict) and item.get("machine") == "evidence" and
               isinstance(item.get("record"), dict) and
               item["record"].get("id") == expected["evidenceId"]]
    if len(records) != 1:
        raise CatalogQAError("Exact Evidence was not visible in the authorized project workspace")
    item = records[0]
    fields = {"projectId": expected["projectId"], "version": expected["version"],
              "fileHash": expected["sha256"], "sourceType": "original", "mediaType": "document"}
    for field, value in fields.items():
        if item.get(field) != value:
            raise CatalogQAError("Evidence " + field + " differs from the explicitly supplied original")
    meta = item.get("metadata", {})
    if (not isinstance(meta, dict) or meta.get("name") != expected["fileName"] or
            meta.get("mimeType") != "application/pdf" or meta.get("byteCount") != expected["size"]):
        raise CatalogQAError("Evidence filename, PDF type or size does not match")
    return {"objectType": "Evidence", "objectId": item["id"], "version": item["version"]}


def check_existing(sets: list[dict], expected: dict) -> dict | None:
    matches = [row for row in sets if row.get("sourceEvidenceId") == expected["evidenceId"]]
    for row in matches:
        if row.get("sha256") != expected["sha256"] or row.get("fileName") != expected["fileName"]:
            raise CatalogQAError("An indexed Evidence ID has a conflicting PDF identity")
    if len(matches) > 1:
        raise CatalogQAError("Multiple drawing sets reference the same registered Evidence")
    return matches[0] if matches else None


class AuthenticatedAPI:
    def __init__(self, base_url: str, token: str, origin: str | None = None):
        self.base = require_safe_api_url(base_url)
        if not token or any(ch.isspace() for ch in token):
            raise CatalogQAError("A single access token is required via environment variable")
        self.headers = {"Authorization": "Bearer " + token}
        if origin:
            self.headers["Origin"] = origin
        self.opener = build_opener(NoRedirects())

    def json(self, method: str, route: str, payload: dict | None = None, idem: str | None = None) -> dict:
        if method not in ("GET", "POST") or not route.startswith("/projects/"):
            raise CatalogQAError("Unsupported API operation")
        headers = dict(self.headers)
        data = None
        if payload is not None:
            data = json.dumps(payload, sort_keys=True).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idem:
            headers["Idempotency-Key"] = idem
        req = Request(self.base + route, method=method, data=data, headers=headers)
        try:
            with self.opener.open(req, timeout=30) as result:
                response = result.read(8 * 1024 * 1024 + 1)
                if len(response) > 8 * 1024 * 1024:
                    raise CatalogQAError("Response too large")
                decoded = json.loads(response)
                if not isinstance(decoded, dict):
                    raise CatalogQAError("API returned unexpected JSON")
                return decoded
        except (HTTPError, URLError) as exc:
            raise CatalogQAError("Authenticated API failed: HTTP " +
                                 str(getattr(exc, "code", "network unavailable"))) from exc


def import_one(api: AuthenticatedAPI, expected: dict, *, apply: bool,
               timeout_seconds: int = 1800, pause_seconds: int = 10) -> dict:
    project = quote(expected["projectId"], safe="")
    base = "/projects/" + project
    ref = verify_workspace_evidence(api.json("GET", base + "/workspace"), expected)
    existing = check_existing(api.json("GET", base + "/drawing-sets").get("items", []), expected)
    if existing is None and not apply:
        return {"result": "verified_dry_run", "wouldImport": ref,
                "expectedPages": expected["pages"], "sha256": expected["sha256"]}
    if existing is None:
        key = "registered-drawing-" + sha256(
            (expected["projectId"] + ":" + expected["evidenceId"] + ":" +
             str(expected["version"]) + ":" + expected["sha256"]).encode()).hexdigest()
        created = api.json("POST", base + "/drawing-sets/from-evidence",
                           {"evidenceRef": ref}, key)
        existing = created.get("set")
    if not isinstance(existing, dict) or not isinstance(existing.get("id"), str):
        raise CatalogQAError("Import did not return a registered drawing set")
    set_id = quote(existing["id"], safe="")
    until = monotonic() + timeout_seconds
    last = None
    while True:
        current = api.json("GET", base + "/drawing-sets/" + set_id).get("set")
        if not isinstance(current, dict):
            raise CatalogQAError("Missing registered drawing set")
        for name, value in (("sourceEvidenceId", expected["evidenceId"]),
                            ("sha256", expected["sha256"]), ("pageCount", expected["pages"]),
                            ("size", expected["size"])):
            if current.get(name) != value:
                raise CatalogQAError("Indexed original identity mismatch: " + name)
        progress = (current.get("completedPages"), current.get("pageCount"), current.get("status"))
        if progress != last:
            print(f"Drawing pages: {progress[0]}/{progress[1]} ({progress[2]})")
            last = progress
        if current.get("status") == "failed":
            raise CatalogQAError("Some pages failed; keep completed pages and use guarded retry")
        if current.get("status") == "ready":
            break
        if not apply:  # Inspect-only mode must not await someone else's background import.
            return {"result": "existing_processing", "setId": current["id"]}
        if monotonic() > until:
            raise CatalogQAError("Import timeout; source was not re-uploaded")
        sleep(pause_seconds)
    sheets = api.json("GET", base + "/drawing-sheets").get("items", [])
    report = inspect_catalog([current], sheets, [{
        "fileName": expected["fileName"], "sha256": expected["sha256"],
        "pages": expected["pages"], "expectEvidenceReuse": True,
    }])
    if report["errors"]:
        raise CatalogQAError("; ".join(report["errors"]))
    return {"result": "ready", "setId": current["id"], "sha256": current["sha256"],
            "pages": report["selectedPages"],
            "numberCandidates": report["sources"][0]["numberCandidates"],
            "humanVerified": report["sources"][0]["humanVerified"],
            "requiresImageAndVisualQA": True}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--origin")
    parser.add_argument("--token-env", default="DOUL_QA_ACCESS_TOKEN")
    parser.add_argument("--apply", action="store_true", help="Explicitly create a drawing index if missing")
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    args = parser.parse_args(argv)
    try:
        if not 1 <= args.timeout_seconds <= 7200:
            raise CatalogQAError("Timeout must be 1..7200 seconds")
        manifest = read_manifest(args.manifest)
        api = AuthenticatedAPI(args.api_url, os.environ.get(args.token_env, ""), args.origin)
        result = import_one(api, manifest, apply=args.apply,
                            timeout_seconds=args.timeout_seconds)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (CatalogQAError, ValueError, OSError) as exc:
        print("Import check failed: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
