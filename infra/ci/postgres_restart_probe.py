#!/usr/bin/env python3
"""Create and verify a persistence probe through the development HTTP API."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import urllib.error
import urllib.request
import uuid


def request_json(url: str, *, method: str = "GET", headers=None, payload=None):
    data = None
    headers = dict(headers or {})
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            body = response.read()
            return response.status, json.loads(body or b"{}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {body}") from exc


def login(base_url: str):
    status, session = request_json(
        f"{base_url}/dev/sessions",
        method="POST",
        payload={"actorGroup": "CON"},
    )
    if status != 200:
        raise RuntimeError(f"Unexpected session status: {status}")
    headers = {
        "Authorization": "Bearer " + session["accessToken"],
        "X-RoleAssignment-Id": session["actor"]["roleAssignmentId"],
    }
    return session, headers


def create_probe(base_url: str, state_path: Path):
    session, headers = login(base_url)
    project_id = session["projectId"]

    status, workspace = request_json(
        f"{base_url}/projects/{project_id}/workspace",
        headers=headers,
    )
    if status != 200:
        raise RuntimeError(f"Unexpected workspace status: {status}")

    source = next(
        item["record"]
        for item in workspace["items"]
        if item.get("machine") == "inspection"
    )

    payload = {
        "packageId": source.get("packageId"),
        "locationId": source.get("locationId"),
        "discipline": source.get("discipline"),
        "responsibleOrganizationId": source.get("responsibleOrganizationId"),
        "minimumQualificationRank": source["minimumQualificationRank"],
        "workName": "Platform PostgreSQL restart persistence probe",
        "selfInspectionComplete": True,
        "precheck": source["precheck"],
        "holdPoint": False,
        "nextWorkAllowed": False,
        "requirementRefs": source.get("requirementRefs", []),
        "evidenceIds": source.get("evidenceIds", []),
    }
    if source.get("drawingRef") is not None:
        payload["drawingRef"] = source["drawingRef"]
    payload = {key: value for key, value in payload.items() if value is not None}

    probe_id = str(uuid.uuid4())
    create_headers = dict(headers)
    create_headers["Idempotency-Key"] = str(uuid.uuid4())
    status, created = request_json(
        f"{base_url}/projects/{project_id}/inspections",
        method="POST",
        headers=create_headers,
        payload={
            "roleAssignmentId": session["actor"]["roleAssignmentId"],
            "clientObjectId": probe_id,
            "payload": payload,
        },
    )
    if status != 201:
        raise RuntimeError(f"Unexpected create status: {status}")

    record = created.get("record", {})
    if record.get("id") != probe_id:
        raise RuntimeError("Created inspection id does not match persistence probe id")

    state_path.write_text(
        json.dumps(
            {
                "projectId": project_id,
                "probeId": probe_id,
                "workName": payload["workName"],
            }
        ),
        encoding="utf-8",
    )
    print("persistence-probe-created")


def verify_probe(base_url: str, state_path: Path):
    expected = json.loads(state_path.read_text(encoding="utf-8"))
    session, headers = login(base_url)
    if session["projectId"] != expected["projectId"]:
        raise RuntimeError("Restarted API returned a different demo project")

    status, record = request_json(
        f"{base_url}/projects/{expected['projectId']}/inspections/{expected['probeId']}",
        headers=headers,
    )
    if status != 200:
        raise RuntimeError(f"Unexpected persistence probe status: {status}")
    if record.get("id") != expected["probeId"]:
        raise RuntimeError("Persistence probe id changed after API restart")
    if record.get("workName") != expected["workName"]:
        raise RuntimeError("Persistence probe payload changed after API restart")

    print("persistence-probe-survived-api-restart")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("create", "verify"))
    parser.add_argument("--base-url", default="http://127.0.0.1:8791")
    parser.add_argument("--state", default="/tmp/doul-postgres-restart-probe.json")
    args = parser.parse_args()

    state_path = Path(args.state)
    if args.mode == "create":
        create_probe(args.base_url.rstrip("/"), state_path)
    else:
        verify_probe(args.base_url.rstrip("/"), state_path)


if __name__ == "__main__":
    main()
