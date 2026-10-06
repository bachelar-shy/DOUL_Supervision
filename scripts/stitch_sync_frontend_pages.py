"""Synchronize current React frontend route pages into the existing Stitch project.

This edits only generated/canonical Stitch draft screens and adds the missing
register page. Existing historical/user reference screens are not deleted.
Raw Stitch responses and downloaded HTML remain under .local/stitch/.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import re
import sys
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stitch_screen_set import call, screens  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "11486949689509673114"
DESIGN = "assets/4105194232699724772"
FRONTEND = "http://100.68.153.58:5174/#"
BASE_COMMIT = subprocess.check_output(["git", "rev-parse", "--short", "origin/main"], text=True).strip()
RAW = ROOT / ".local" / "stitch" / f"frontend-sync-{BASE_COMMIT}"
MANIFEST = ROOT / "design" / "stitch" / "screens.json"
OUT = ROOT / "design" / "stitch" / "frontend-page-sync.json"

ROUTES = {
    "today": "오늘",
    "inspections": "검측·검수",
    "capture": "현장·증빙",
    "observations": "관찰 후보",
    "issues": "부적합·이슈",
    "actions": "시정조치",
    "owner": "발주처 보고·결정",
    "documents": "문서 작성",
    "registers": "관리대장",
    "rfis": "설계질의",
    "admin": "배치·권한",
}

ROLE_ROUTES = {
    "SUP": [
        "today",
        "inspections",
        "capture",
        "observations",
        "issues",
        "actions",
        "owner",
        "documents",
        "registers",
        "rfis",
    ],
    "CON": [
        "today",
        "inspections",
        "capture",
        "issues",
        "actions",
        "rfis",
        "documents",
        "registers",
    ],
    "OWN": ["today", "owner", "issues", "documents", "registers"],
    "DES": ["today", "rfis", "capture", "documents", "registers"],
    "ADM": list(ROUTES),
}

# One canonical desktop screen per implemented frontend route.
# screenId is the currently adopted Stitch draft to edit. registers is new.
SPECS = [
    {
        "code": "SUP-TODAY-W",
        "actor": "SUP",
        "route": "today",
        "title": "감리 업무현황",
        "screenId": "9cfcdca7cee24bd3b4bcfa2b56f44dc0",
        "details": (
            "Page header 오늘. Four clickable KPI cards: 검측 대기, 미종결 이슈, "
            "시정조치, 발주처 수령·결정. Main left panel 우선 확인할 업무. "
            "Right column has 진행 전 확인 with the exact meaning 적합 판정과 "
            "후속공정 승인은 다릅니다, plus 최근 처리 이력 from server audit."
        ),
    },
    {
        "code": "SUP-INSPECTION-W",
        "actor": "SUP",
        "route": "inspections",
        "title": "검측·검수",
        "screenId": "451810a781cb430e9e28e5b401c0aaa3",
        "details": (
            "Master-detail workspace. Left 검측·검수 목록. Right selected inspection "
            "shows status badge, 위치/원본 버전/관련 증빙/담당 범위, simple floor plan, "
            "and StatusBoundaryGroup named 검측 결과와 후속공정 상태. Show three separate "
            "items: 검측 판정, 후속공정 허용, 필수확인점. 적합 does NOT mean 후속공정 허용. "
            "Below, 현재 가능한 업무 must show server action availability text such as "
            "실행 가능, 입력 필요, 선행조건 대기, 권한 없음, 오프라인 with reason."
        ),
    },
    {
        "code": "SUP-MEDIA-W",
        "actor": "SUP",
        "route": "capture",
        "title": "현장·증빙",
        "screenId": "34a012cd08274530b6746690d096e73c",
        "details": (
            "Two-column current Capture page. Left 현장 기록 가져오기 with 원본 보존, "
            "파일 선택, 카메라 촬영, 기기 저장·제출 대기 and server transfer. "
            "Right top 현재 촬영 맥락 with manual location and a simple floor-plan context. "
            "Right bottom 서버 증빙 list; clicking evidence opens a detail Sheet with "
            "기본정보 / 출처·연결 / 기술정보. Explicitly show AI 분석 · 서비스 미연결. "
            "Do not claim automatic positioning, AI pass/fail or automatic closure."
        ),
    },
    {
        "code": "SUP-OBSERVATION-W",
        "actor": "SUP",
        "route": "observations",
        "title": "관찰 후보",
        "screenId": "a3fdbdb99a4a4de090885fdebccb4aaf",
        "details": (
            "Use the same master-detail Workbench as the React frontend, not an invented "
            "video-analysis console. Left 관찰 후보 목록. Right selected observation with "
            "status, version/evidence metadata and notice 관찰 확인 ≠ 공식 이슈 발행. "
            "State that the current example is linked human/measurement evidence and "
            "AI 서비스 미연결. ActionGate shows only server-provided review actions. "
            "If confirmed, a separate 공식 이슈 발행 action may appear for SUP."
        ),
    },
    {
        "code": "SUP-REINSPECTION-W",
        "actor": "SUP",
        "route": "issues",
        "title": "부적합·이슈",
        "screenId": "7ee421fa511c4df6819abe1a5d56f28c",
        "details": (
            "Master-detail Workbench. Left 부적합·이슈 목록. Right issue status, location, "
            "source version, evidence count, correction-cycle notice and linked inspections/actions. "
            "Explain that current-cycle action verification, new reinspection and required signed "
            "record must be checked before closure. ActionGate uses server-provided commands only. "
            "No automatic close and no visual implication that correction submission equals issue closure."
        ),
    },
    {
        "code": "CON-CORRECTION-W",
        "actor": "CON",
        "route": "actions",
        "title": "시정조치",
        "screenId": "fd6ce199d34842cba5617dffb4626b85",
        "details": (
            "Contractor-role master-detail Workbench. Left 시정조치 목록 for readable own scope. "
            "Right selected action shows status, source version, evidence, root cause/action/prevention "
            "fields when present, and server ActionGate. Make it explicit contractor can submit correction "
            "or request reinspection when server allows, but cannot close official issue or perform supervisor pass."
        ),
    },
    {
        "code": "OWN-DECISION-W",
        "actor": "OWN",
        "route": "owner",
        "title": "발주처 보고·결정",
        "screenId": "d71403f944234f8aa8aa71a8e154c23f",
        "details": (
            "Current Owner Governance page. Top three compact summary metrics: 수령 확인 가능, "
            "결정 가능, 검증·종결 가능. Show workflow bar 보고 발행 → 수령 확인 → 결정·조치 "
            "→ 이행 검증 → 종결 and text 수령 확인은 승인과 다르며 기한 초과도 자동승인이 아님. "
            "Below split list and detail. Detail includes 원본 버전/증빙/기한/실행가능 count plus "
            "StatusBoundaryGroup 수령·결정 상태 경계 with 현재 객체 상태, 수령 확인, 결정 제출. "
            "Facts/cause/recommendation or decision options/impact, followed by ActionGate."
        ),
    },
    {
        "code": "DOC-AUTHOR-W",
        "actor": "SUP",
        "route": "documents",
        "title": "문서 작성",
        "screenId": "ac115ffe4db8436c9253d919e58d1e81",
        "details": (
            "Current data-linked document authoring screen. Left editor chooses one of currently implemented "
            "forms FM-20 발주처 즉시보고, FM-19 주간보고, FM-21 의사결정 요청서, FM-12 부적합 보고서, "
            "FM-09 검수기록, then chooses source record and fills draft fields. Right A4 미리보기. "
            "State 초안 · 법정 발행본 아님. Show source version and render snapshot/hash when created. "
            "DOCX 연동 전 and PDF 연동 전 remain disabled; do not imply all 36 forms are implemented."
        ),
    },
    {
        "code": "SUP-REGISTERS-W",
        "actor": "SUP",
        "route": "registers",
        "title": "관리대장",
        "screenId": "2cac65491b4640aca4c1acbdd77ce075",
        "details": (
            "Create the current Register page. Top RegisterNavigator has tabs 내 역할 추천 and 전체 29개. "
            "SUP recommendation starts at 11 검측·검수. Entire catalog is grouped into six 업무군 and searchable "
            "by number/name. Below show current register metadata, FilterBar, dense sticky-header RegisterTable, "
            "and row detail drawer pattern. Clearly state 29 registers are read-only projections of source domain "
            "objects; status changes happen only through the related work screen and server-authorized commands. "
            "Do not let the table look directly editable."
        ),
    },
    {
        "code": "DES-RFI-W",
        "actor": "DES",
        "route": "rfis",
        "title": "설계질의",
        "screenId": "0ffb870122fa49a987c836f7a4a612df",
        "details": (
            "Designer-role master-detail Workbench. Left 설계질의 목록, right selected RFI status/source version/"
            "evidence and question. Show notice RFI 답변은 설계변경 승인이 아닙니다. "
            "ActionGate shows only server-permitted answer workflow. Do not expose cost approval, contractor issue "
            "closure or supervisor inspection approval."
        ),
    },
    {
        "code": "ADM-ROLES-W",
        "actor": "ADM",
        "route": "admin",
        "title": "배치·권한",
        "screenId": "47e48fc436bc498f982875bfeee1030a",
        "details": (
            "Current Admin read-only role assignment page. Header 프로젝트 역할배정 / 현재 조회 전용. "
            "Notice: 관리자 계정은 기술승인·법정서명 권한을 자동으로 갖지 않습니다; 시험기관·외부검토기관은 "
            "자료 출처만 보존하고 로그인 대상에서 제외. Dense table columns 사용자군, 프로젝트 역할, 분야, "
            "배치 종료, 상태. No all-powerful admin technical approval controls."
        ),
    },
]

BASE = (
    "Update the selected Stitch page to mirror the CURRENT implemented React frontend, not an aspirational product. "
    f"Source baseline commit is {BASE_COMMIT}. Keep the existing DOUL Supervision visual language: white and neutral "
    "gray, restrained navy accent, black readable type, compact professional task-tool density, 4-8px radii, minimal "
    "shadow, no gradients, no oversized generic SaaS cards. Korean labels. Desktop operational workspace, not a "
    "landing page, presentation board or marketing mockup. All sample records/counts must be labelled 개발 미리보기 · "
    "예시 데이터. Status meaning must be readable in text, not color only. Never invent current weather, actual site "
    "progress, safety clearance, AI confidence, technical approval, legal signature or backend capability. "
    "Authority and action availability come from server. "
)


def nav_prompt(actor: str) -> str:
    lines = [
        "Every visible main navigation item must be a REAL clickable HTML <a> anchor with target=\"_self\".",
        "Use these exact labels and hrefs for this role. Do not use href=\"#\" for navigation:",
    ]
    for route in ROLE_ROUTES[actor]:
        lines.append(f"{ROUTES[route]}={FRONTEND}/{route}")
    lines.append(
        "The active route must remain visually selected. If a dashboard card or text action navigates to one of these "
        "pages, make that element a real anchor to the same exact href."
    )
    return "\n".join(lines)


def make_prompt(spec: dict) -> str:
    return (
        BASE
        + f"\n\nScreen code/title: {spec['code']} | {spec['title']}\n"
        + f"Actor: {spec['actor']}; implemented route: /{spec['route']}.\n"
        + spec["details"]
        + "\n\n"
        + nav_prompt(spec["actor"])
    )


def sync_one(spec: dict) -> dict:
    RAW.mkdir(parents=True, exist_ok=True)
    response_path = RAW / f"{spec['code']}.json"
    fallback_path = RAW / f"{spec['code']}-canvas-fallback.json"
    if fallback_path.exists():
        data = json.loads(fallback_path.read_text())
    elif response_path.exists():
        data = json.loads(response_path.read_text())
    else:
        args = {
            "projectId": PROJECT,
            "deviceType": "DESKTOP",
            "modelId": "GEMINI_3_8_FLASH",
            "prompt": make_prompt(spec),
        }
        if spec["screenId"]:
            args["selectedScreenIds"] = [spec["screenId"]]
            data = call("edit_screens", args, 390)
        else:
            args["designSystem"] = DESIGN
            data = call("generate_screen_from_text", args, 390)
        response_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    found = list(screens(data))
    if not found:
        raise RuntimeError(f"{spec['code']}: no Stitch screen returned")
    screen = found[0]
    return {
        **spec,
        "previousStitchScreenId": spec["screenId"],
        "stitchScreenId": screen["name"].split("/")[-1],
        "resourceName": screen["name"],
        "returnedTitle": screen.get("title"),
        "returnedWidth": screen.get("width"),
        "returnedHeight": screen.get("height"),
    }


def fetch_verify(record: dict, project: dict, listed_ids: set[str]) -> dict:
    sid = record["stitchScreenId"]
    detail = call(
        "get_screen",
        {"name": f"projects/{PROJECT}/screens/{sid}"},
        90,
    )
    (RAW / f"{record['code']}.get.json").write_text(
        json.dumps(detail, ensure_ascii=False, indent=2)
    )
    html = urllib.request.urlopen(
        detail["htmlCode"]["downloadUrl"], timeout=30
    ).read().decode("utf-8", "replace")
    (RAW / f"{record['code']}.html").write_text(html)

    expected_urls = [f"{FRONTEND}/{route}" for route in ROLE_ROUTES[record["actor"]]]
    hrefs = re.findall(r"href=[\"']([^\"']+)", html)
    missing = [url for url in expected_urls if url not in hrefs]
    source_name = f"projects/{PROJECT}/screens/{sid}"
    instance = next(
        (x for x in project.get("screenInstances", []) if x.get("sourceScreen") == source_name),
        None,
    )
    return {
        **record,
        "readbackVerified": detail.get("name") == source_name,
        "listVerified": sid in listed_ids,
        "canvasVerified": instance is not None,
        "canvasInstanceId": instance.get("id") if instance else None,
        "canvasWidth": instance.get("width") if instance else None,
        "canvasHeight": instance.get("height") if instance else None,
        "frontendUrl": f"{FRONTEND}/{record['route']}",
        "expectedNavigationUrls": expected_urls,
        "navigationHrefCount": sum(1 for url in hrefs if url in expected_urls),
        "navigationVerified": not missing,
        "missingNavigationUrls": missing,
        "hashOnlyHrefCount": sum(1 for href in hrefs if href == "#"),
        "screenTitle": detail.get("title"),
        "screenWidth": detail.get("width"),
        "screenHeight": detail.get("height"),
    }


def update_manifest(records: list[dict]) -> None:
    manifest = json.loads(MANIFEST.read_text())
    by_code = {s["code"]: s for s in manifest.get("screens", [])}
    for r in records:
        target = by_code.get(r["code"])
        if target is None:
            target = {
                "code": r["code"],
                "title": r["title"],
                "actor": r["actor"],
                "surface": "desktop",
                "route": f"/{r['route']}",
                "commands": [],
            }
            manifest.setdefault("screens", []).append(target)
            by_code[r["code"]] = target
        old = target.get("stitchScreenId")
        target.update(
            {
                "previousStitchScreenId": old,
                "stitchScreenId": r["stitchScreenId"],
                "resourceName": r["resourceName"],
                "canvasInstanceId": r["canvasInstanceId"],
                "canvasWidth": r["canvasWidth"],
                "canvasHeight": r["canvasHeight"],
                "formatVerified": True,
                "canvasVerified": r["canvasVerified"],
                "readbackVerified": r["readbackVerified"],
                "listVerified": r["listVerified"],
                "status": "react_frontend_synced_not_user_approved",
                "frontendUrl": r["frontendUrl"],
                "frontendSyncCommit": BASE_COMMIT,
                "navigationVerified": r["navigationVerified"],
                "navigationHrefCount": r["navigationHrefCount"],
            }
        )
    manifest["baseCommit"] = BASE_COMMIT
    manifest["verifiedAt"] = datetime.now(timezone.utc).isoformat()
    manifest["reviewStatus"] = "awaiting_user_design_review"
    manifest["frontendPageSync"] = {
        "baseCommit": BASE_COMMIT,
        "routeCount": len(records),
        "readbackVerifiedCount": sum(r["readbackVerified"] for r in records),
        "listVerifiedCount": sum(r["listVerified"] for r in records),
        "canvasVerifiedCount": sum(r["canvasVerified"] for r in records),
        "navigationVerifiedCount": sum(r["navigationVerified"] for r in records),
        "liveFrontendBase": FRONTEND,
        "nativeStitchPrototypeLinkApiAvailable": False,
        "navigationStrategy": "real_html_anchor_to_live_frontend_hash_routes",
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
    }
    manifest["screens"].sort(key=lambda s: s["code"])
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)

    # The Today page was validated first to confirm Stitch generates real hrefs.
    preseed = ROOT / ".local" / "stitch" / "sync-today-response.json"
    today_raw = RAW / "SUP-TODAY-W.json"
    if preseed.exists() and not today_raw.exists():
        today_raw.write_text(preseed.read_text())

    synced: list[dict] = []
    errors: list[dict] = []
    # Keep Stitch updates page-by-page so each route can be inspected independently.
    for spec in SPECS:
        try:
            record = sync_one(spec)
            synced.append(record)
            print(spec["code"], "->", record["stitchScreenId"], flush=True)
        except Exception as exc:
            errors.append({"code": spec["code"], "error": type(exc).__name__})
            print(spec["code"], "FAILED", type(exc).__name__, flush=True)

    listed = call("list_screens", {"projectId": PROJECT}, 90)
    listed_ids = {
        item["name"].split("/")[-1]
        for item in screens(listed)
        if item.get("name")
    }
    project = call("get_project", {"name": f"projects/{PROJECT}"}, 90)
    (RAW / "project-after.json").write_text(
        json.dumps(project, ensure_ascii=False, indent=2)
    )
    verified = [fetch_verify(r, project, listed_ids) for r in synced]
    verified.sort(key=lambda x: list(ROUTES).index(x["route"]))

    result = {
        "projectId": PROJECT,
        "projectTitle": project.get("title"),
        "designSystemId": DESIGN,
        "baseCommit": BASE_COMMIT,
        "liveFrontendBase": FRONTEND,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "navigationStrategy": "real_html_anchor_to_live_frontend_hash_routes",
        "nativeStitchPrototypeLinkApiAvailable": False,
        "routes": verified,
        "errors": errors,
        "allRouteScreensCreatedOrUpdated": len(verified) == len(SPECS) and not errors,
        "allReadbackVerified": all(r["readbackVerified"] for r in verified),
        "allListVerified": all(r["listVerified"] for r in verified),
        "allCanvasVerified": all(r["canvasVerified"] for r in verified),
        "allNavigationVerified": all(r["navigationVerified"] for r in verified),
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    if not errors and len(verified) == len(SPECS):
        update_manifest(verified)

    print(
        json.dumps(
            {
                "updated": len(verified),
                "errors": errors,
                "readback": sum(r["readbackVerified"] for r in verified),
                "listed": sum(r["listVerified"] for r in verified),
                "canvas": sum(r["canvasVerified"] for r in verified),
                "navigation": sum(r["navigationVerified"] for r in verified),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
