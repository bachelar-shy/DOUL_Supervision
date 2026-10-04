"""Record successfully generated mobile resources without falsely claiming canvas placement."""
from datetime import datetime,timezone
from hashlib import sha256
import json
from stitch_screen_set import call,PROJECT,RAW,OUT,SPECS,screens

PENDING={
 'SUP-INSPECTION-M':('1ecce73fe9c24d0f9574ed6e8ccb30ed','048b400c85fa4d92abc9fce3c6002a7b'),
 'SUP-CAPTURE-M':('6fbf64fc3c6148a3952927f0d4ef3d40','658ccd3ea0f94470b876aad68b6fab1e'),
 'CON-CORRECTION-M':('b9a29a02f53d4f85b71190b8fb39523f','dffbbb0427fa40059d167e0c8b371be7'),
}


def main():
 manifest=json.loads((OUT/'screens.json').read_text())
 manifest['screens']=[s for s in manifest['screens'] if s['code'] not in PENDING]
 project=call('get_project',{'name':'projects/'+PROJECT},90)
 instances={s['sourceScreen'].split('/')[-1]:s for s in project.get('screenInstances',[])}
 manifest['canvasInstanceCount']=len(instances)
 for code,(new_id,old_id) in PENDING.items():
  spec=next(s for s in SPECS if s[0]==code)
  name='projects/'+PROJECT+'/screens/'+new_id
  data=call('get_screen',{'name':name},90)
  assert data['name']==name and data['deviceType']=='MOBILE'
  RAW.joinpath(code+'-canonical.json').write_text(json.dumps(data,ensure_ascii=False))
  placed=new_id in instances and int(instances[new_id]['width'])<=600
  record=dict(code=code,title=spec[3],actor=spec[2],surface='mobile',route=spec[4],commands=spec[6],stitchScreenId=new_id,resourceName=name,readbackVerified=True,mobileResourceVerified=True,imageWidth=data.get('width'),imageHeight=data.get('height'),intendedCanvasWidth=390,canvasVerified=placed,formatVerified=placed,canvasWidth=instances[new_id]['width'] if placed else None,canvasHeight=instances[new_id]['height'] if placed else None,currentCanvasScreenId=old_id,currentCanvasWidth=instances.get(old_id,{}).get('width'),status='generated_not_user_approved' if placed else 'resource_created_canvas_replacement_pending',metadataSnapshotSha256=sha256(json.dumps(data,ensure_ascii=False,sort_keys=True).encode()).hexdigest())
  manifest['screens'].append(record)
  print(code,'resource verified; canvas',placed,flush=True)
 manifest['screens'].sort(key=lambda x:x['code'])
 manifest['resourceVerifiedCount']=sum(bool(s['readbackVerified']) for s in manifest['screens'])
 manifest['canvasVerifiedCount']=sum(bool(s['canvasVerified']) for s in manifest['screens'])
 manifest['allPlannedResourcesVerified']=manifest['resourceVerifiedCount']==len(SPECS)
 manifest['allPlannedScreensVerified']=manifest['canvasVerifiedCount']==len(SPECS)
 manifest['canonicalCounts']={surface:sum(s['surface']==surface for s in manifest['screens']) for surface in ['mobile','desktop']}
 manifest['preservedVerified']=all(i in instances for i in manifest['preservedScreenIds'])
 manifest['errors']=[dict(code=s['code'],error='mobile_resource_exists_but_project_canvas_replacement_not_verified') for s in manifest['screens'] if not s['canvasVerified']]
 manifest['verifiedAt']=datetime.now(timezone.utc).isoformat()
 (OUT/'screens.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 lines=['# Stitch 화면 기준표','','프로젝트: **DOUL Supervision MVP** (`'+PROJECT+'`)','','16종 리소스를 생성·조회했다. 캔버스 크기까지 확인한 것은 13종이다. 모바일 3종은 390px용 보정 리소스가 있지만 기존 캔버스 프레임은 아직 1280px이므로 교체 확인을 완료로 표시하지 않는다. 기존 사용자 화면 2개는 보존했다.','','| 코드 | 사용자 | 환경 | 리소스 조회 | 캔버스 확인 | Screen ID |','|---|---|---|---|---|---|']
 for s in manifest['screens']:lines.append('| '+s['code']+' | '+s['actor']+' | '+s['surface']+' | 확인 | '+('확인' if s['canvasVerified'] else '**보정본 반영 미확인**')+' | `'+s['stitchScreenId']+'` |')
 lines+=['','생성된 화면은 사용자 승인 전 초안이다. `screens.json`은 실제 코드 경로 및 기존 상태모델 명령과 연결한다. 원시 생성 응답·임시 자산 URL은 `.local/stitch/`에만 보관한다.','', 'MCP 편집 응답의 DOM 변경 이벤트만으로는 서버 캔버스 크기가 변경됐다고 판단하지 않는다. `get_project`로 재조회한 실제 인스턴스와 비교한다.','']
 (OUT/'README.md').write_text('\n'.join(lines))
 result=OUT.parents[0]/'verification/mvp-results.json'
 if result.exists():
  d=json.loads(result.read_text());d['stitch']={k:manifest[k] for k in ['projectId','resourceVerifiedCount','canvasVerifiedCount','canonicalCounts','preservedVerified','allPlannedScreensVerified','errors']};result.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:manifest[k] for k in ['resourceVerifiedCount','canvasVerifiedCount','canonicalCounts','preservedVerified']}),flush=True)

if __name__=='__main__':main()
