#!/usr/bin/env python3
"""Prevent DOUL Actions from silently reverting to a self-hosted runner."""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[2]
workflows = sorted((root / ".github/workflows").glob("*.yml"))
workflows += sorted((root / ".github/workflows").glob("*.yaml"))
required = {
    "backend-worker-integration.yml", "contracts.yml", "mvp.yml",
    "platform-container.yml", "platform-deployment.yml",
    "platform-documents.yml", "platform-observability.yml",
    "platform-postgres-backup.yml", "platform-recovery.yml",
    "platform-storage-policy.yml", "platform-worker.yml",
    "ci-runner-policy.yml", "menu-usability.yml", "sample-project.yml",
    "ux-200-full-journeys.yml",
}
errors = []
if required - {p.name for p in workflows}:
    errors.append(f"Missing workflows: {sorted(required - {p.name for p in workflows})}")

for path in workflows:
    data = path.read_text(encoding="utf-8")
    runners = re.findall(r"^\s*runs-on:\s*(\S.*?)\s*$", data, re.MULTILINE)
    if not runners:
        errors.append(f"{path.name}: no runs-on declaration")
    for actual in runners:
        value = actual.split(" #", 1)[0].strip()
        if value != "ubuntu-24.04":
            errors.append(f"{path.name}: expected ubuntu-24.04, got {value}")

if errors:
    for error in errors:
        print(f"CI runner policy FAIL: {error}", file=sys.stderr)
    sys.exit(1)
print(f"CI runner policy PASS: {len(workflows)} workflows on GitHub-hosted ubuntu-24.04")
