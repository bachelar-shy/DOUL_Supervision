"""Run the local skeleton checks and record exact commands/exit codes.

This is not production acceptance, a 300-use-case result, formal verification,
or evidence of a signed native build. Raw logs stay out of version control.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
LOGS=ROOT/'.local/verification'
OUT=ROOT/'design/verification/mvp-results.json'
STEPS=[
 ('contracts',['python3','scripts/validate_contracts.py'],'.'),
 ('api_codegen',['python3','scripts/generate_api.py','--check'],'.'),
 ('types_codegen',['python3','scripts/generate_types.py','--check'],'.'),
 ('reference_tests',['python3','-m','unittest','discover','-s','tests','-q'],'.'),
 ('http_tests',['.venv/bin/python','-m','unittest','discover','-s','tests_mvp','-v'],'.'),
 ('typecheck',['npm','run','typecheck'],'.'),
 ('web_lint',['npm','run','lint','--workspace','apps/web'],'.'),
 ('web_build',['npm','run','web:build'],'.'),
 ('browser_tests',['npx','playwright','test'],'.'),
 ('native_js_bundles',['npx','expo','export','--platform','ios','--platform','android','--output-dir','../../.local/mobile-export'],'apps/mobile'),
 ('git_whitespace',['git','diff','--check'],'.'),
]


def main():
 LOGS.mkdir(parents=True,exist_ok=True);OUT.parent.mkdir(parents=True,exist_ok=True)
 data=dict(verifiedAt=datetime.now(timezone.utc).isoformat(),baseCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),branch=subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),mode='local_development_synthetic_data',checks=[],productionAcceptance=False,nativeSignedBuildTested=False,realDeviceTested=False,formalModelCheckerExecuted=False,remoteCIExecuted=False,remaining=['production authentication and account lifecycle','normalized PostgreSQL/PostGIS and object storage','trusted legal signature verifier','video/audio AI and actual spatial positioning','DOCX/PDF adapters and statutory templates','dependency security remediation','field pilot and actual device tests'])
 for name,cmd,cwd in STEPS:
  start=time.monotonic()
  try:
   p=subprocess.run(cmd,cwd=ROOT/cwd,capture_output=True,text=True,timeout=300)
   output=p.stdout+p.stderr;code=p.returncode
  except subprocess.TimeoutExpired as exc:
   output='Timed out after 300 seconds';code=124
  (LOGS/(name+'.log')).write_text(output)
  row=dict(name=name,command=cmd,cwd=cwd,exitCode=code,status='passed' if code==0 else 'failed',seconds=round(time.monotonic()-start,2),logSha256=sha256(output.encode()).hexdigest())
  count=re.search(r'Ran (\d+) tests?',output)
  if count:row['testsExecuted']=int(count.group(1))
  if name=='browser_tests':
   results=ROOT/'.local/browser-results.json'
   if results.exists():
    report=json.loads(results.read_text());row['statistics']=report.get('stats',{})
  if name=='native_js_bundles':row['note']='JavaScript/Hermes export only; not APK/IPA, signing or real-device validation'
  data['checks'].append(row);OUT.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
  print(name+': '+row['status']+' ('+str(row['seconds'])+'s)',flush=True)
  if code:print(output[-2000:],flush=True)
 data['allExecutedChecksPassed']=all(c['exitCode']==0 for c in data['checks'])
 data['releaseStatus']='LOCAL_ONLY_SECURITY_AND_PRODUCTION_ADAPTERS_PENDING'
 manifest=ROOT/'design/stitch/screens.json'
 if manifest.exists():
  stitch=json.loads(manifest.read_text())
  data['stitch']={k:stitch.get(k) for k in ['projectId','resourceVerifiedCount','canvasVerifiedCount','canonicalCounts','preservedVerified','allPlannedScreensVerified','errors']}
 OUT.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 return 0 if data['allExecutedChecksPassed'] else 1

if __name__=='__main__':sys.exit(main())
