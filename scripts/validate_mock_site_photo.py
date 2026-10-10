"""Exercise labeled synthetic image bytes through real local API and SQLite.

Accept only an explicit image path. Uses a fresh owned temporary database; never
connects to a production service. This is development validation, not a pilot.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from uuid import uuid4
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from fastapi.testclient import TestClient
from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter
from scripts.mock_project_setup import cleanup, setup

def validate(photo: Path):
    content=photo.read_bytes()
    if not content.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Explicit synthetic PNG required')
    digest=hashlib.sha256(content).hexdigest()
    checks=[]
    def check(name, condition):
        if not condition:raise AssertionError(name)
        checks.append(name)
    with tempfile.TemporaryDirectory(prefix='doul-mock-photo-api-') as temporary:
        db=str(Path(temporary)/'owned.sqlite3')
        store=SQLiteSnapshotAdapter(db,demo=True)
        fixture=setup(store)
        check('setup_rerun_no_duplicates',setup(store)['created'] is False)
        store.close()
        app=create_app(db,demo=True)
        with TestClient(app) as client:
            session=client.post('/dev/sessions',json={'actorGroup':'CON'}).json()
            project=session['projectId'];role=session['actor']['roleAssignmentId']
            check('fixture_project_selected',project==fixture['projectId'])
            h={'Authorization':'Bearer '+session['accessToken'],'X-RoleAssignment-Id':role}
            scope=client.get(f'/projects/{project}/workspace',headers=h).json()['context']['scope']
            capture=str(uuid4());key=str(uuid4());base=f'/projects/{project}'
            body=dict(roleAssignmentId=role,captureId=capture,fileName='SYNTHETIC_WWT_contact_sheet_P01-P12.png',mimeType='image/png',byteCount=len(content),expectedHash=digest,sourcePartyId=session['actor']['partyId'],mediaType='photo',capturedAt='2026-10-10T08:00:00+07:00',discipline=scope['discipline'],packageId=scope['packageId'],locationId=scope['locationId'])
            start=client.post(base+'/uploads',headers={**h,'Idempotency-Key':key},json=body)
            check('upload_start_201',start.status_code==201)
            repeat=client.post(base+'/uploads',headers={**h,'Idempotency-Key':key},json=body)
            check('upload_start_same_key_same_id',repeat.status_code==200 and repeat.json()['id']==start.json()['id'])
            conflict=client.post(base+'/uploads',headers={**h,'Idempotency-Key':key},json={**body,'fileName':'changed.png'})
            check('changed_body_same_key_rejected',conflict.status_code==409)
            upload=base+'/uploads/'+start.json()['id'];chunk_key=str(uuid4())
            chunk_headers={**h,'Idempotency-Key':chunk_key,'Upload-Offset':'0','Content-Type':'application/octet-stream'}
            put=client.put(upload+'/chunks',headers=chunk_headers,content=content)
            check('chunk_uploaded',put.status_code==200 and put.json()['offset']==len(content))
            put2=client.put(upload+'/chunks',headers=chunk_headers,content=content)
            check('chunk_retry_no_duplicate_bytes',put2.status_code==200 and put2.json()['offset']==len(content))
            completion=dict(roleAssignmentId=role,expectedHash=digest)
            finished=client.post(upload+'/complete',headers={**h,'Idempotency-Key':str(uuid4())},json=completion)
            check('completion_201',finished.status_code==201)
            evidence=finished.json()
            done2=client.post(upload+'/complete',headers={**h,'Idempotency-Key':str(uuid4())},json=completion)
            check('completion_retry_same_evidence_version',done2.status_code==200 and done2.json()==evidence)
            check('synthetic_name_preserved',evidence['metadata']['name'].startswith('SYNTHETIC_'))
            check('exact_hash_preserved',evidence['fileHash']==digest)
            check('scope_and_capture_time_preserved',evidence['locationId']==scope['locationId'] and evidence['capturedAt']==body['capturedAt'])
            downloaded=client.get(base+'/evidence/'+capture+'/content',headers=h)
            check('download_exact_original',downloaded.status_code==200 and downloaded.content==content)
            check('foreign_project_rejected',client.get(f'/projects/{uuid4()}/evidence/{capture}/content',headers=h).status_code in (403,404))
            check('unauthenticated_download_rejected',client.get(base+'/evidence/'+capture+'/content').status_code==401)
            try:
                cleanup(app.state.store)
            except RuntimeError:
                check('cleanup_refuses_later_upload_without_deleting_original',client.get(base+'/evidence/'+capture+'/content',headers=h).content==content)
            else:
                raise AssertionError('cleanup must preserve later uploaded evidence')
        app.state.store.close()
        reopened=create_app(db,demo=True)
        with TestClient(reopened) as client:
            session=client.post('/dev/sessions',json={'actorGroup':'CON'}).json()
            h={'Authorization':'Bearer '+session['accessToken'],'X-RoleAssignment-Id':session['actor']['roleAssignmentId']}
            download=client.get(base+'/evidence/'+capture+'/content',headers=h)
            check('restart_preserves_original_hash',download.status_code==200 and hashlib.sha256(download.content).hexdigest()==digest)
        reopened.state.store.close()
    return dict(classification='synthetic_asset_real_API_SQLite',actualFieldAcceptance=False,assetName=photo.name,sha256=digest,byteCount=len(content),checks=checks,passed=len(checks),syntheticScenarioCapturedAt=body['capturedAt'],limitations=['FastAPI TestClient and local SQLite, not production HTTP/storage/provider acceptance','One generated contact sheet with twelve panels, not twelve independently captured photos'])

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--photo',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();result=validate(args.photo)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'passed':result['passed'],'sha256':result['sha256'],'output':str(args.output)}))
