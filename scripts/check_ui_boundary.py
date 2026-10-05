#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
UI_ROOT = ROOT / "apps" / "web" / "src"
SCAN_DIRS = [UI_ROOT / "app", UI_ROOT / "pages", UI_ROOT / "ui"]
SCAN_FILES = [UI_ROOT / "App.tsx"]

violations = []

for base in SCAN_DIRS:
    for path in base.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)
        if re.search(r'from\s+["\']@doul/client["\']', text):
            violations.append(f"{rel}: UI layer must use data/ui-contract or SupervisionClient facade, not @doul/client directly")
        if re.search(r"\bnew\s+ApiClient\b", text):
            violations.append(f"{rel}: ApiClient construction is allowed only in data/supervision-client.ts")
        if re.search(r"\bfetch\s*\(", text):
            violations.append(f"{rel}: direct fetch is forbidden in app/pages/ui; use SupervisionClient")
        if "services/api" in text or "app/reference" in text:
            violations.append(f"{rel}: UI layer must not import backend/reference implementation")

for path in SCAN_FILES:
    text = path.read_text(encoding="utf-8")
    rel = path.relative_to(ROOT)
    if "@doul/client" in text or re.search(r"\bfetch\s*\(", text):
        violations.append(f"{rel}: composition root must not bypass the web data facade")

app = (UI_ROOT / "App.tsx").read_text(encoding="utf-8")
if 'createSupervisionClient' not in app or '<AppShell client={client}' not in app:
    violations.append("apps/web/src/App.tsx: expected AppShell + SupervisionClient composition root")

data_facade = (UI_ROOT / "data" / "supervision-client.ts").read_text(encoding="utf-8")
if "new ApiClient" not in data_facade:
    violations.append("apps/web/src/data/supervision-client.ts: expected the sole web ApiClient construction point")

if violations:
    print("UI/function boundary violations:")
    for item in violations:
        print(f"- {item}")
    sys.exit(1)

print("UI/function boundary OK")
