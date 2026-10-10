#!/usr/bin/env python3
"""Populate the REAL local-development API through resumable upload routes.
Generated files are synthetic diagram cards, NOT photographic site evidence.
Run with DOUL_DEMO_PROFILE=wwt on an isolated development SQLite database.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import uuid
import zlib
import httpx

LABEL='합성 테스트 자료 / 실제 현장 증빙 아님'
CASE_NAMES=[
('Q-01','철근 검측 최초발견','ZONE-A','found'),('Q-01','철근 시정 완료','ZONE-A','corrected'),('Q-01','철근 재검측','ZONE-A','reinspection'),
('Q-02','거푸집 검측','ZONE-A','found'),('M-01','배관 설치','ZONE-B','installation'),('M-02','설비 설치','ZONE-B','installation'),
('Q-03','누수 결함 발견','ZONE-B','found'),('Q-03','누수 시정 완료','ZONE-B','corrected'),('Q-03','누수 재검측','ZONE-B','reinspection'),
('S-01','추락 위험 발견','ZONE-C','found'),('S-01','추락 위험 조치 완료','ZONE-C','corrected'),('S-02','크레인 장비검사','ZONE-C','inspection'),
('SCH-01','공정 지연 발견','ZONE-D','found'),('SCH-01','공정 회복 확인','ZONE-D','corrected'),
('PAY-01','토공 물량 확인','ZONE-D','measurement'),('PAY-02','철골 물량 확인','ZONE-E','measurement'),
('HO-01','준공 처리시설 확인','ZONE-E','handover'),('HO-02','시운전 펌프','ZONE-E','commissioning'),
('DEF-01','마감 하자 발견','ZONE-F','found'),('DEF-01','마감 하자 보수 확인','ZONE-F','corrected'),
]

def png_card(index):
    # Deterministic, clearly nonphotographic PNG with scenario-specific visual bands.
    w,h=640,360
    from math import sin
    raw=bytearray()
    for y in range(h):
        row=bytearray()
        for x in range(w):
            rail=(x%73<4 or y%79<4)
            base=(28+(index*19)%80,72+(index*13)%72,82+(index*11)%79)
            if y<70: rgb=(17,44,66)
            elif y>290: rgb=(20,35,43)
            elif rail:rgb=(187,201,196)
            else:rgb=base
            if (x-290)**2+(y-176)**2<37**2:rgb=(240,180,55)
            row.extend(rgb)
        raw.extend(b'\x00'+row)
    def chunk(t,v):return struct.pack('>I',len(v))+t+v+struct.pack('>I',zlib.crc32(t+v)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'tEXt',b'Notice\x00'+LABEL.encode('utf8'))+chunk(b'IDAT',zlib.compress(bytes(raw),6))+chunk(b'IEND',b'')

def main():
    a=argparse.ArgumentParser()
    a.add_argument('--api',required=True,help='Explicit dedicated WWT loopback API URL (e.g. http://127.0.0.1:8793)')
    a.add_argument('--expected-project-id',required=True,help='Exact project UUID from dedicated WWT /dev/sessions')
    a.add_argument('--out',default='.local/wwt-demo/manifest.json')
    opt=a.parse_args()
    if not opt.api.startswith(('http://127.0.0.1:', 'http://localhost:')):
        raise SystemExit('Use the dedicated loopback WWT API, never a shared or remote server')
    with httpx.Client(base_url=opt.api,timeout=30) as c:
        return register(c,opt)


def register(c,opt):
    # All checks precede uploads, manifest writes, and filesystem side-effects.
    health=c.get('/health');health.raise_for_status()
    if health.json().get('mode')!='local-demo' or health.json().get('demoProfile')!='wwt':
        raise SystemExit('Refusing API without confirmed WWT demo profile')
    login=c.post('/dev/sessions',json={'actorGroup':'CON'});login.raise_for_status()
    info=login.json();p=info['projectId'];actor=info['actor'];auth={'Authorization':'Bearer '+info['accessToken'],'X-RoleAssignment-Id':actor['roleAssignmentId']}
    workspace=c.get(f'/projects/{p}/workspace',headers=auth);workspace.raise_for_status()
    w=workspace.json();ctx=w.get('context',{});zones=ctx.get('wwtZoneIds') or {}
    if p!=opt.expected_project_id or ctx.get('projectId')!=p or ctx.get('demoProfile')!='wwt' or ctx.get('dataClassification')!='SYNTHETIC_TEST_NOT_SITE_EVIDENCE' or set(zones)!={'ZONE-'+x for x in 'ABCDEF'}:
        raise SystemExit('WWT project identity/profile/zone preflight failed: no uploads performed')
    if 'WWT' not in w.get('project',{}).get('name',''):
        raise SystemExit('Refusing non-WWT project')
    for zone, loc in zones.items():
        if not isinstance(loc,str) or not loc:
            raise SystemExit('Invalid WWT zone location ' + zone)
    out=Path(opt.out)
    old=json.loads(out.read_text()) if out.exists() else {}
    if old and old.get('projectId')!=p:
        raise SystemExit('Manifest belongs to another project; no uploads performed')
    out.parent.mkdir(parents=True,exist_ok=True)
    # Current source metadata is deliberately fixture-derived, never live site evidence.
    scope=workspace.json().get('context',{}).get('scope') or {}
    if not scope:
        # Read persisted dev snapshot metadata via explicit local-test profile where available.
        from services.api.persistence import create_local_persistence
        raise SystemExit('Workspace scope unavailable; use --profile provisioner')
    manifest=[]
    for n,(case,title,zone,stage) in enumerate(CASE_NAMES,1):
        content=png_card(n);sha=hashlib.sha256(content).hexdigest()
        eid=str(uuid.uuid5(uuid.NAMESPACE_URL,'doul/wwt/demo/v1/'+str(n)))
        previous=(old.get('items') or [])
        match=next((x for x in previous if x['evidenceId']==eid and x['sha256']==sha and x.get('projectId')==p and x.get('locationId')==zones[zone]),None)
        if match:
            check=c.get(f'/projects/{p}/evidence/{eid}/content',headers=auth)
            detail=c.get(f'/projects/{p}/evidence/{eid}',headers=auth)
            if check.status_code==200 and hashlib.sha256(check.content).hexdigest()==sha and detail.status_code==200 and detail.json().get('locationId')==zones[zone] and detail.json().get('metadata',{}).get('demoCaseId')==case and detail.json().get('metadata',{}).get('demoStage')==stage:
                manifest.append(match);continue
        body=dict(roleAssignmentId=actor['roleAssignmentId'],captureId=eid,fileName=f'WWT__{case}__{stage}__{zone}__SYNTHETIC.png',mimeType='image/png',byteCount=len(content),expectedHash=sha,sourcePartyId=actor['partyId'],mediaType='photo',discipline=scope['discipline'],packageId=scope['packageId'],locationId=zones[zone],capturedAt=f'2026-09-{(n%28)+1:02d}T09:00:00+07:00')
        key='wwt-seed-v1-'+str(n)
        start=c.post(f'/projects/{p}/uploads',json=body,headers={**auth,'Idempotency-Key':key});start.raise_for_status()
        upload=start.json()['id']
        ch=c.put(f'/projects/{p}/uploads/{upload}/chunks',content=content,headers={**auth,'Idempotency-Key':key+'-chunk','Upload-Offset':'0','Content-Type':'application/octet-stream'})
        if ch.status_code not in (200,201):raise RuntimeError(ch.text)
        done=c.post(f'/projects/{p}/uploads/{upload}/complete',json={'roleAssignmentId':actor['roleAssignmentId'],'expectedHash':sha},headers={**auth,'Idempotency-Key':key+'-finish'})
        if done.status_code not in (200,201):raise RuntimeError(done.text)
        downloaded=c.get(f'/projects/{p}/evidence/{eid}/content',headers=auth)
        if downloaded.status_code!=200 or hashlib.sha256(downloaded.content).hexdigest()!=sha:raise RuntimeError('download/hash mismatch '+str(n))
        detail=c.get(f'/projects/{p}/evidence/{eid}',headers=auth);detail.raise_for_status()
        record=detail.json()
        if record.get('locationId')!=zones[zone] or record.get('metadata',{}).get('demoCaseId')!=case or record.get('metadata',{}).get('demoStage')!=stage or record.get('metadata',{}).get('demoClassification')!='SYNTHETIC_NOT_SITE_EVIDENCE':
            raise RuntimeError('server metadata/zone mismatch '+str(n))
        manifest.append(dict(fileId=upload,evidenceId=eid,projectId=p,caseId=case,description=title,location=zone,locationId=zones[zone],stage=stage,capturedAt=body['capturedAt'],sha256=sha,kind='generated_synthetic_diagram_not_photo',notice=LABEL,expected='upload_download_hash_and_project_scope_pass'))
        out.write_text(json.dumps({'schemaVersion':1,'projectId':p,'classification':'SYNTHETIC_NOT_APPROVED','items':manifest},ensure_ascii=False,indent=2))
    forbidden=c.get('/projects/'+str(uuid.uuid4())+'/evidence/'+manifest[0]['evidenceId']+'/content',headers=auth)
    if forbidden.status_code not in (403,404):raise RuntimeError('cross-project access allowed')
    print(json.dumps({'projectId':p,'uploadedOrReused':len(manifest),'crossProjectStatus':forbidden.status_code,'manifest':str(out)},ensure_ascii=False))
if __name__=='__main__':main()
