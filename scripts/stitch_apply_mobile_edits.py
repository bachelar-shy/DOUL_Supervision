"""Apply MOBILE reflow only to three generated canvas drafts, never user originals."""
import json,subprocess
from stitch_long_request import wrapper
from stitch_screen_set import CONFIG,PROJECT,RAW

ids=['048b400c85fa4d92abc9fce3c6002a7b','658ccd3ea0f94470b876aad68b6fab1e','dffbbb0427fa40059d167e0c8b371be7']
args=dict(projectId=PROJECT,selectedScreenIds=ids,deviceType='MOBILE',modelId='GEMINI_3_8_FLASH',prompt='Edit the THREE SELECTED EXISTING SCREENS IN THE PROJECT CANVAS. Each is mistakenly desktop-sized. Reflow each into a true 390 CSS-pixel-wide smartphone screen. Keep its existing code and Korean title: SUP-INSPECTION-M, SUP-CAPTURE-M, CON-CORRECTION-M. Keep the same functional purpose, role and content, single-column and fixed thumb-friendly mobile bottom navigation. NO desktop sidebar, NO presentation board. Preserve all other screens. Apply the resulting edits to these existing project canvas screens rather than producing unattached alternatives. Inspection must separate result from signature/Hold release. Capture must say manual location and AI unavailable. Contractor can submit corrections/request reinspection, never close an official issue. All examples labelled 예시 데이터. White-gray navy #17365D, compact 4px corners. Do not invent technical camera telemetry or new site facts.')
p=subprocess.run(['node',str(wrapper()),'--config',str(CONFIG),'--server','stitch','--method','tools/call','--tool-name','edit_screens','--tool-args-json',json.dumps(args,ensure_ascii=False),'--format','json'],capture_output=True,text=True,timeout=350)
RAW.joinpath('mobile-canvas-edit-response.json').write_text(p.stdout)
RAW.joinpath('mobile-canvas-edit-error.log').write_text(p.stderr)
print('exitCode',p.returncode,flush=True)
try:
 r=json.loads(p.stdout).get('result',{});print('toolError',bool(r.get('isError')),flush=True)
 d=r.get('structuredContent') or json.loads(r['content'][0]['text'])
 from stitch_screen_set import screens
 for s in screens(d):print({k:s.get(k) for k in ['name','title','width','height']},flush=True)
except (ValueError,KeyError,IndexError):print('No parsed screen result; inspect server before retrying',flush=True)
