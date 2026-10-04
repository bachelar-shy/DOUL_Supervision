"""Create the requested UI set through the already configured MCP Inspector.

No API key is read or printed. Existing screens are never edited/deleted.
Responses may contain temporary asset URLs, so raw files remain under .local/.
Generation is not automatically retried after a timeout (avoid duplicate screens).
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PROJECT = '11486949689509673114'
DESIGN = 'assets/4105194232699724772'
CONFIG = Path.home() / '.config/mcp-inspector/stitch.json'
RAW = ROOT / '.local/stitch'
OUT = ROOT / 'design/stitch'

SPECS = [
 ('SUP-TODAY-W','DESKTOP','SUP','감리 업무현황','/today', 'Desktop supervisor workbench. Sidebar today, inspections, evidence, observations, issues, reports, documents. Compact KPI counts, inspection queue table left, urgent Hold approval and owner immediate-report queue right. Drawing context lower pane. No charts that compete with tasks. No invented live weather or crane safety conclusion.', []),
 ('SUP-INSPECTION-M','MOBILE','SUP','검측 상세','/inspections', 'Inspection detail, A동 2층 벽체. State scheduled. Drawing A-201 Rev.03, baseline checklist, 5 prerequisite indicators, evidence thumbnails. Primary 검측 시작. Show result not yet entered, next-work NOT allowed. After pass, show separate signature and Hold approval checklist; never a combined pass-and-release button.', ['inspection:start','inspection:submit_results','inspection:pass','inspection:release_next_work']),
 ('SUP-INSPECTION-W','DESKTOP','SUP','검측 검토','/inspections', 'Desktop split view: inspection list at left; large clean schematic floor plan center with grid and location pin marked 도면 예시; checklist, evidence and command panel right. Separate 판정, 서명상태, 후속공정 허용. Display missing required evidence and disabled release with reason. Revision and source links visible.', ['inspection:start','inspection:submit_results','inspection:pass','inspection:release_next_work']),
 ('SUP-CAPTURE-M','MOBILE','SUP','현장 촬영','/capture', 'Native capture design: large neutral camera-preview placeholder labelled 카메라 미리보기, photo/video/audio mode controls, timer, microphone permission indicator, A동 2F C-5 position marked 수동 지정. QR rescan and manual pin fallback. 원본 보존, 기기 저장, 전송 대기 are separate. Primary 촬영, finish 저장. No automatic GPS/AR accuracy claim. AI status 분석 전.', []),
 ('SUP-MEDIA-W','DESKTOP','SUP','증빙 작업실','/capture', 'Desktop media intake workbench. Upload drop zone photo/video/audio, queue with bytes/offset/checksum status, immutable original and derived columns, evidence metadata and source author vs uploader. Detail panel associates drawing/version/location. Analysis disabled with 분석 서비스 미연결. Show bulk upload and local pending, not automatic confirmed findings.', []),
 ('SUP-OBSERVATION-M','MOBILE','SUP','관찰 후보 검토','/observations', 'Review a candidate observation, badge 공식 판정 대기. Representative frame marked 파생 프레임, original clip PTS 00:42-00:48, original Korean speech and optional Vietnamese translation tabs, speaker 화자 후보 미확정. Coverage 42/120초 분석, 누락 78초 (예시) and 근거 부족. Human verification note; confirm observation / reject; separate disabled 공식 이슈 발행 until observed visual or measurement corroboration. No confidence percent.', ['observation:begin_review','observation:confirm','observation:reject']),
 ('SUP-OBSERVATION-W','DESKTOP','SUP','영상·발화 검토','/observations', 'Three-pane desktop evidence review. Original video with PTS timeline and visibly shaded skipped ranges, transcript with provisional speakers at left/bottom, candidate list and source drawing revision at right. Distinguish original, derived frame, spoken allegation, observed fact. Show partial coverage not entire-video analyzed. Human verification action and separate issue command.', ['observation:begin_review','observation:confirm','observation:reject']),
 ('SUP-REINSPECTION-M','MOBILE','SUP','재검측·종결 검토','/issues', 'Issue NCR-008 current correction cycle 2; before/after evidence side by side, expandable previous failed cycles read-only. New inspection I-044 required. Separate action verified, reinspection passed, signed record, Hold approval. 종결 button disabled with 필수 서명 미완료. Primary 재검측 시작, failure 재시정 요청. Original failed inspection remains visible.', ['issue:start_reinspection','issue:reject_reinspection','issue:close']),
 ('SUP-REINSPECTION-W','DESKTOP','SUP','부적합·시정 이력','/issues', 'Desktop issue board and detail. Timeline original inspection -> issue -> correction cycle1 fail -> cycle2 reinspection. Before/after images and checklist and source versions. Closure gate checklist with missing signature. Owner-report thread visible independently, not delayed until closure. Only supervisor closure, explicit disabled reason.', ['issue:start_reinspection','issue:reject_reinspection','issue:close']),
 ('CON-CORRECTION-M','MOBILE','CON','시공사 시정조치','/actions', 'Contractor mobile role clearly labelled 시공사. My issue NCR-008, assigned company and due date, fields 원인, 시정내용, 재발방지, after evidence. Primary 시정조치 제출 then 재검측 요청 as a separate step linking a NEW inspection. Never show issue close or supervisor pass buttons. Offline draft banner 저장됨·아직 제출되지 않음.', ['action:start','action:submit','issue:request_reinspection']),
 ('CON-CORRECTION-W','DESKTOP','CON','시정·재검측 요청','/actions', 'Contractor desktop workspace. Left own-company tasks, right correction form root cause/action/prevention, evidence uploads, checklist and new reinspection request reference. Separate own self-check and official supervisor inspection. Cannot view other contractor private data or close official issue. Submission receipts and version conflict banner pattern.', ['action:start','action:submit','issue:request_reinspection']),
 ('OWN-DECISION-M','MOBILE','OWN','발주처 결정','/owner', 'Owner mobile concise decision request: immediate report, received/not received badge, facts/cause, quality/schedule/cost impact labelled 예시, A/B options and supervision recommendation, decision deadline. Separate 수령 확인 and 결정 제출 requiring reason. Decision not technical inspection approval or issue closure. No direct contractor instruction button.', ['report:acknowledge','decision:acknowledge','decision:decide']),
 ('OWN-DECISION-W','DESKTOP','OWN','발주처 현황·결정','/owner', 'Owner desktop overview and decision panel. KPI outstanding decisions, receipt overdue, major issues; table with decision deadline. Right options comparison, impact and recommendation, received timestamp, decision reason and option selection. Show report receipt -> decision -> execution -> supervisor verification -> closure. No auto approval on overdue.', ['report:acknowledge','decision:acknowledge','decision:decide']),
 ('DOC-AUTHOR-W','DESKTOP','SUP','보고서 작성','/documents', 'Document authoring desktop: left approved template catalog FM-19/20/21; middle A4 white page preview with black typography and gray table headers; right linked sourceDomainRefs exact object versions, evidence citations and snapshot hash. Draft editable vs issued snapshot read-only. Save draft, preview HTML, request review. DOCX/PDF disabled 어댑터 미연결. Do not label draft legally signed.', ['report:submit','report:issue']),
 ('DES-RFI-W','DESKTOP','DES','설계질의 답변','/rfis', 'Designer desktop RFI inbox scoped to assignment, center drawing revision and query, right response editor and related design documents. Explicit separate 설계변경 필요 checkbox, response submission. Banner RFI 답변은 설계변경 승인이 아닙니다. No contractor closure, no cost approval.', ['rfi:answer']),
 ('ADM-ROLES-W','DESKTOP','ADM','프로젝트 배치·권한','/admin', 'Project admin desktop human groups SUP ADM CON OWN DES only. Table organization/person/project role/disciplines/package/location/validity/qualification status. Detail effective authority read-only preview with reason when expired. Separate service actors AI SYSTEM INTEGRATION without human approval powers. TEST_LAB/EXTERNAL_REVIEWER exist only as document source parties without login invite. No all-powerful admin technical-sign override.', []),
]

BASE = '''Create exactly ONE operational screen for DOUL Supervision, not a landing page. Use the specified screen code as part of its title. Preserve all existing project screens. Follow design system DOUL Supervision, white and neutral gray, restrained navy #17365D accent, black readable type, 4px corners, minimal shadow, no gradients. Korean UI with concise labels. Respect the existing compact 390px mobile layout in screen 026ed09c69054acc97a2a1d678cb9b52. Use Noto Sans KR-style Korean typography. All numbers/examples are explicitly labelled 개발 미리보기 · 예시 데이터. No invented current weather, real construction progress, safety approval, AI confidence or site facts. Date only if necessary: 2026.10.05 (월). Mobile uses 390x844 viewport with real scroll and 44px targets, fixed bottom nav with safe area; do not squeeze all content into tiny text. Desktop uses 1440x960 with compact sidebar, master-detail workspace. Tablet should reflow into two panes. On mobile show 오늘/검측/촬영/이슈/더보기; contractor/owner labels must match role. A pass result is not release to proceed. Candidate confirmation is not official issue issuance. Authority and guards come from server. This is a design reference, not a claim the displayed services are running. '''


def call(tool, args, timeout=240):
    command=['npx','-y','@modelcontextprotocol/inspector','--cli','--config',str(CONFIG),'--server','stitch','--method','tools/call','--tool-name',tool,'--tool-args-json',json.dumps(args,ensure_ascii=False),'--format','json']
    if tool in {'generate_screen_from_text','edit_screens','generate_variants'}:
        from stitch_long_request import wrapper
        command=['node',str(wrapper())]+command[4:]
        timeout=max(timeout,350)
    p=subprocess.run(command,capture_output=True,text=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError('Inspector request failed; check local log (no automatic retry)')
    r=json.loads(p.stdout).get('result',{})
    if r.get('isError'):raise RuntimeError('Stitch returned an error')
    d=r.get('structuredContent')
    if d is None:
        d=next((json.loads(c['text']) for c in r.get('content',[]) if c.get('type')=='text'),{})
    return d


def screens(data):
    if isinstance(data,dict):
        if data.get('name','').startswith('projects/') and '/screens/' in data.get('name','') and ('htmlCode' in data or 'width' in data):
            yield data
        for value in data.values():yield from screens(value)
    elif isinstance(data,list):
        for value in data:yield from screens(value)


def generate(spec):
    code,device,actor,title,route,details,commands=spec
    result_path=RAW/(code+'.json')
    if result_path.exists():
        d=json.loads(result_path.read_text())
    else:
        d=call('generate_screen_from_text',dict(projectId=PROJECT,designSystem=DESIGN,deviceType=device,modelId='GEMINI_3_8_FLASH',prompt=BASE+'\nTitle: '+code+' | '+title+'\nActor: '+actor+'\n'+details))
        result_path.write_text(json.dumps(d,ensure_ascii=False,indent=2))
    found={s['name']:s for s in screens(d)}
    if not found:raise RuntimeError(code+': no screen returned; inspect project before retry')
    s=next(iter(found.values()))
    print(code+' generated '+s['name'].split('/')[-1],flush=True)
    return dict(code=code,title=title,actor=actor,surface=device.lower(),route=route,commands=commands,stitchScreenId=s['name'].split('/')[-1],resourceName=s['name'],width=s.get('width'),height=s.get('height'),status='generated_not_user_approved')


def main():
    p=argparse.ArgumentParser();p.add_argument('--generate',action='store_true');args=p.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);RAW.mkdir(parents=True,exist_ok=True)
    plan=[dict(code=s[0],surface=s[1].lower(),actor=s[2],title=s[3],route=s[4],description=s[5],commands=s[6]) for s in SPECS]
    (OUT/'screen-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
    if not args.generate:return
    manifest=dict(projectId=PROJECT,designSystemId=DESIGN,baseCommit='d13e744f23ac183ca5246f1ed431f40fe74ef0c1',generatedAt=datetime.now(timezone.utc).isoformat(),preservedScreenIds=['cc94d5225c01416c9947c9f63db21ae1','026ed09c69054acc97a2a1d678cb9b52'],screens=[],errors=[])
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures={pool.submit(generate,s):s[0] for s in SPECS}
        for future in as_completed(futures):
            try:manifest['screens'].append(future.result())
            except Exception as error:
                manifest['errors'].append(dict(code=futures[future],error=type(error).__name__))
                print(futures[future]+' FAILED: '+type(error).__name__,flush=True)
            manifest['screens'].sort(key=lambda s:s['code'])
            (OUT/'screens.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    latest=call('list_screens',{'projectId':PROJECT},90)
    RAW.joinpath('final-list.json').write_text(json.dumps(latest,ensure_ascii=False))
    ids={s['name'].split('/')[-1] for s in latest.get('screens',[])}
    manifest['readbackVerified']=all(s['stitchScreenId'] in ids for s in manifest['screens'])
    manifest['preservedVerified']=all(s in ids for s in manifest['preservedScreenIds'])
    (OUT/'screens.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(created=len(manifest['screens']),errors=manifest['errors'],readback=manifest['readbackVerified'],preserved=manifest['preservedVerified'])),flush=True)

if __name__=='__main__':main()
