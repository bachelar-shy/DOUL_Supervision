"""Read-only final reconciliation: screen resource AND project canvas instance.

Select one canonical design per planned screen code. Preserve user screens and
all generation iterations. Resource retrieval is not human design approval.
"""
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone
from hashlib import sha256
import json
import sys
from stitch_screen_set import call,PROJECT,DESIGN,RAW,OUT,SPECS

PRESERVED=['cc94d5225c01416c9947c9f63db21ae1','026ed09c69054acc97a2a1d678cb9b52']


def main():
 listing=call('list_screens',{'projectId':PROJECT},90)
 project=call('get_project',{'name':'projects/'+PROJECT},90)
 RAW.joinpath('verified-project-canvas.json').write_text(json.dumps(project,ensure_ascii=False))
 RAW.joinpath('verified-screen-list.json').write_text(json.dumps(listing,ensure_ascii=False))
 instances={s['sourceScreen']:s for s in project.get('screenInstances',[])}
 rows=listing.get('screens',[])
 machines=json.loads((OUT.parents[1]/'app/schema/state_machines_v1.json').read_text())['machines']
 known_commands={name+':'+t['command'] for name,m in machines.items() for t in m['transitions']}
 result=dict(projectId=PROJECT,projectTitle=project.get('title'),designSystemId=DESIGN,baseCommit='d13e744f23ac183ca5246f1ed431f40fe74ef0c1',verifiedAt=datetime.now(timezone.utc).isoformat(),preservedScreenIds=PRESERVED,screens=[],errors=[],canvasInstanceCount=len(instances),reviewStatus='awaiting_user_design_review',pixelPerfectImplementationClaimed=False)
 jobs=[]
 for code,device,actor,title,route,description,commands in SPECS:
  candidates=[s for s in rows if s.get('title','').startswith(code) and s['name'] in instances]
  target=[s for s in candidates if (int(instances[s['name']]['width'])<=600)==(device=='MOBILE')]
  target.sort(key=lambda s:(' v2' in s.get('title',''),s.get('name','')),reverse=True)
  if not target:
   result['errors'].append(dict(code=code,error='missing_correct_format_on_canvas'));continue
  chosen=target[0];instance=instances[chosen['name']]
  invalid=[c for c in commands if c not in known_commands]
  if invalid:result['errors'].append(dict(code=code,error='unknown_contract_commands',commands=invalid))
  record=dict(code=code,title=title,actor=actor,surface=device.lower(),route=route,commands=commands,stitchScreenId=chosen['name'].split('/')[-1],resourceName=chosen['name'],canvasInstanceId=instance['id'],canvasWidth=instance['width'],canvasHeight=instance['height'],formatVerified=True,canvasVerified=True,readbackVerified=False,referenceOnlyScreenIds=[s['name'].split('/')[-1] for s in candidates if s!=chosen],status='generated_not_user_approved')
  jobs.append(record)
 def read(record):
  data=call('get_screen',{'name':record['resourceName']},90)
  require_name=data.get('name')==record['resourceName']
  record['readbackVerified']=require_name
  record['screenStatus']=data.get('screenMetadata',{}).get('status')
  record['metadataSnapshotSha256']=sha256(json.dumps(data,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
  RAW.joinpath(record['code']+'-canonical.json').write_text(json.dumps(data,ensure_ascii=False))
  return record
 with ThreadPoolExecutor(max_workers=3) as pool:
  futures={pool.submit(read,r):r['code'] for r in jobs}
  for f in as_completed(futures):
   try:
    record=f.result();result['screens'].append(record)
    print(record['code']+' canvas='+str(record['canvasWidth'])+' readback='+str(record['readbackVerified']),flush=True)
   except Exception as exc:result['errors'].append(dict(code=futures[f],error=type(exc).__name__))
 names={name.split('/')[-1] for name in instances}
 result['preservedVerified']=all(s in names for s in PRESERVED)
 result['screens'].sort(key=lambda s:s['code'])
 result['allPlannedScreensVerified']=len(result['screens'])==len(SPECS) and not result['errors'] and all(s['readbackVerified'] for s in result['screens'])
 result['canonicalCounts']={surface:sum(s['surface']==surface for s in result['screens']) for surface in ['mobile','desktop']}
 OUT.joinpath('screens.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 md=['# Stitch 화면 기준표','','프로젝트: **DOUL Supervision MVP** (`'+PROJECT+'`)','','기존 사용자 화면 2개를 보존한다. 아래 ID가 이번 골격에 대응하는 채택 초안이다. 보정 전 참고 화면은 삭제하지 않았다. 사용자 디자인 승인은 아직 받지 않았다.','','| 화면 코드 | 사용자 | 환경 | 캔버스 폭 | Stitch Screen ID |','|---|---|---|---:|---|']
 for s in result['screens']:md.append('| '+s['code']+' | '+s['actor']+' | '+s['surface']+' | '+str(s['canvasWidth'])+' | `'+s['stitchScreenId']+'` |')
 md+=['','화면 경로·업무명령은 `screens.json`에 연결되어 있다. 화면 디자인은 API 권한을 부여하지 않으며, 실제 실행은 서버 계약을 따른다.','', '캔버스 폭은 CSS 작업면 기준이다. `get_screen` 이미지 픽셀 크기와 2배 차이날 수 있다.','']
 OUT.joinpath('README.md').write_text('\n'.join(md))
 print(json.dumps({k:result[k] for k in ['allPlannedScreensVerified','preservedVerified','canonicalCounts','canvasInstanceCount','errors']}),flush=True)
 return 0 if result['allPlannedScreensVerified'] and result['preservedVerified'] else 1
if __name__=='__main__':sys.exit(main())
