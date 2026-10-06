"""HTTP/SQLite development integration tests; no real signatures or site data."""
import base64
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from services.api.main import create_app
from app.reference.engine import uid

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=')


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=str(Path(self.temp.name)/'state.db')
        self.app=create_app(self.path,demo=True);self.client=TestClient(self.app)
        self.login('SUP')

    def tearDown(self):
        self.client.close();self.app.state.store.close();self.temp.cleanup()

    def login(self,role,client=None):
        client=client or self.client
        self.session=client.post('/dev/sessions',json={'actorGroup':role}).json()
        self.project=self.session['projectId'];self.role=self.session['actor']['roleAssignmentId']
        self.headers={'Authorization':'Bearer '+self.session['accessToken'],'X-RoleAssignment-Id':self.role}
        return self.session

    def get(self,suffix):return self.client.get('/projects/'+self.project+suffix,headers=self.headers)
    def workspace(self):return self.get('/workspace').json()
    def item(self,machine,status=None):return next(x for x in self.workspace()['items'] if x['machine']==machine and (status is None or x['record']['status']==status))
    def command(self,collection,item,command,payload=None,version=None,key=None):
        return self.client.post(f'/projects/{self.project}/{collection}/{item["record"]["id"]}/{command}',headers={**self.headers,'Idempotency-Key':key or uid()},json={'roleAssignmentId':self.role,'expectedVersion':version or item['record']['version'],'payload':payload or {},'evidenceIds':item['record'].get('evidenceIds',[])})

    def start_upload(self,content=PNG,mime='image/png',expected=None):
        w=self.workspace();scope=w['context']['scope'];capture=uid()
        payload=dict(roleAssignmentId=self.role,captureId=capture,fileName='sample.png',mimeType=mime,byteCount=len(content),expectedHash=expected or sha256(content).hexdigest(),sourcePartyId=self.session['actor']['partyId'],mediaType='photo',discipline=scope['discipline'],packageId=scope['packageId'],locationId=scope['locationId'])
        result=self.client.post(f'/projects/{self.project}/uploads',headers={**self.headers,'Idempotency-Key':capture},json=payload)
        self.assertEqual(result.status_code,201,result.text)
        return result.json(),payload

    def chunk(self,upload,content=PNG,offset=0,key=None):
        return self.client.put(f'/projects/{self.project}/uploads/{upload["id"]}/chunks',headers={**self.headers,'Idempotency-Key':key or uid(),'Upload-Offset':str(offset),'Content-Type':'application/octet-stream'},content=content)

    def complete(self,upload):
        return self.client.post(f'/projects/{self.project}/uploads/{upload["id"]}/complete',headers={**self.headers,'Idempotency-Key':'complete-'+upload['id']},json={'roleAssignmentId':self.role,'expectedHash':upload['expectedHash']})

    def test_explicit_demo_required(self):
        with self.assertRaises(RuntimeError):create_app()

    def test_unauthenticated_read(self):
        self.assertEqual(self.client.get('/projects/'+self.project+'/workspace').status_code,401)

    def test_bad_origin_login(self):
        self.assertEqual(self.client.post('/dev/sessions',headers={'Origin':'https://untrusted.example'},json={'actorGroup':'SUP'}).status_code,403)

    def test_configured_loopback_origins_allow_alternate_web_port(self):
        configured='http://127.0.0.1:5182,http://localhost:5182,http://127.0.0.1:8791,http://localhost:8791'
        with patch.dict('os.environ',{'DOUL_API_ALLOWED_ORIGINS':configured}):
            app=create_app(':memory:',demo=True);client=TestClient(app)
        try:
            for origin in ['http://127.0.0.1:5182','http://localhost:5182']:
                with self.subTest(origin=origin):
                    session=client.post('/dev/sessions',headers={'Origin':origin},json={'actorGroup':'SUP'})
                    self.assertEqual(session.status_code,200,session.text)
                    payload=session.json();headers={'Origin':origin,'Authorization':'Bearer '+payload['accessToken'],'X-RoleAssignment-Id':payload['actor']['roleAssignmentId']}
                    workspace=client.get('/projects/'+payload['projectId']+'/workspace',headers=headers)
                    self.assertEqual(workspace.status_code,200,workspace.text)
                    self.assertEqual(workspace.headers.get('access-control-allow-origin'),origin)
            denied=client.post('/dev/sessions',headers={'Origin':'https://untrusted.example'},json={'actorGroup':'SUP'})
            self.assertEqual(denied.status_code,403)
        finally:client.close();app.state.store.close()

    def test_configured_origin_rejects_non_loopback_hosts(self):
        with patch.dict('os.environ',{'DOUL_API_ALLOWED_ORIGINS':'https://untrusted.example'}):
            with self.assertRaises(RuntimeError):create_app(':memory:',demo=True)

    def test_source_and_service_parties_cannot_login(self):
        for role in ['TEST_LAB','EXTERNAL_REVIEWER','AI','SYSTEM','SYS','INTEGRATION']:
            with self.subTest(role=role):self.assertEqual(self.client.post('/dev/sessions',json={'actorGroup':role}).status_code,422)

    def test_cross_project_hidden(self):
        self.assertEqual(self.client.get('/projects/'+uid()+'/workspace',headers=self.headers).status_code,404)

    def test_cannot_supply_other_role(self):
        con=self.app.state.store.meta['actors']['CON']['roleAssignmentId']
        self.assertEqual(self.client.get('/projects/'+self.project+'/workspace',headers={**self.headers,'X-RoleAssignment-Id':con}).status_code,403)

    def test_revoked_assignment_denied(self):
        store=self.app.state.store
        with store.transaction(True):store.engine._records[('RoleAssignment',self.role)]['active']=False
        self.assertEqual(self.get('/workspace').status_code,403)

    def test_preflight_has_no_side_effects(self):
        store=self.app.state.store;before=len(store.engine.audit_events)
        for _ in range(3):self.assertEqual(self.get('/workspace').status_code,200)
        self.assertEqual(before,len(store.engine.audit_events))

    def test_real_state_transition_and_duplicate_idempotency(self):
        item=self.item('inspection','scheduled');key=uid();before=len(self.app.state.store.engine.audit_events)
        first=self.command('inspections',item,'start',key=key);again=self.command('inspections',item,'start',key=key)
        self.assertEqual(first.status_code,200,first.text);self.assertEqual(again.json(),first.json())
        self.assertEqual(first.json()['record']['status'],'in_progress')
        self.assertEqual(len(self.app.state.store.engine.audit_events),before+1)

    def test_stale_version_conflict(self):
        item=self.item('inspection','scheduled');self.command('inspections',item,'start')
        result=self.command('inspections',item,'start')
        self.assertEqual(result.status_code,409);self.assertEqual(result.json()['code'],'VERSION_CONFLICT')
        self.assertEqual(result.json()['currentVersion'],item['record']['version']+1)

    def test_client_cannot_write_status(self):
        item=self.item('inspection','scheduled')
        r=self.command('inspections',item,'start',{'status':'completed'})
        self.assertEqual(r.status_code,422);self.assertEqual(self.item('inspection','scheduled')['record']['version'],item['record']['version'])

    def test_empty_rfi_submission_rejected_without_changing_draft(self):
        self.login('CON');scope=self.workspace()['context']['scope']
        created=self.client.post('/projects/'+self.project+'/rfis',headers={**self.headers,'Idempotency-Key':uid()},json=dict(roleAssignmentId=self.role,clientObjectId=uid(),payload=dict(**scope,title='Empty RFI',data={})))
        self.assertEqual(created.status_code,201,created.text)
        item={'record':created.json()['record']}
        response=self.command('rfis',item,'submit')
        self.assertEqual(response.status_code,422)
        self.assertEqual(self.get('/rfis/'+item['record']['id']).json()['status'],'draft')

    def test_contractor_cannot_close_issue(self):
        self.login('CON');item=self.item('issue')
        self.assertNotIn('close',[x['command'] for x in item['actions']])
        r=self.command('issues',item,'close');self.assertEqual(r.status_code,403,r.text)

    def test_pass_does_not_release_hold(self):
        item=self.item('inspection','passed');self.assertFalse(item['record']['nextWorkAllowed'])
        r=self.command('inspections',item,'release-next-work')
        self.assertEqual(r.status_code,409,r.text);self.assertFalse(self.item('inspection','passed')['record']['nextWorkAllowed'])

    def test_action_submit_is_not_issue_close(self):
        self.login('CON');action=self.item('action','in_progress')
        r=self.command('actions',action,'submit',dict(correction='예시 보수',rootCause='치수 확인',preventiveAction='재검측'))
        self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['record']['status'],'submitted')
        self.assertNotEqual(self.item('issue')['record']['status'],'closed')

    def test_owner_receipt_does_not_approve(self):
        self.login('OWN');report=self.item('report','issued');r=self.command('owner-reports',report,'acknowledge')
        self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['record']['status'],'acknowledged')
        self.assertEqual(self.item('decision')['record']['status'],'reported')

    def test_internal_candidates_hidden_from_owner(self):
        self.login('OWN');self.assertFalse(any(x['machine']=='observation' and x['record']['status']=='candidate' for x in self.workspace()['items']))

    def test_upload_exact_bytes_checksum_and_immutable_final(self):
        upload,payload=self.start_upload();self.assertEqual(self.chunk(upload).status_code,200)
        result=self.complete(upload);self.assertEqual(result.status_code,201,result.text)
        evidence=result.json();self.assertEqual(evidence['fileHash'],sha256(PNG).hexdigest())
        self.assertEqual(self.get('/evidence/'+evidence['id']+'/content').content,PNG)
        self.assertEqual(self.complete(upload).json()['id'],evidence['id'])
        self.assertEqual(self.chunk(upload,b'x',len(PNG)).status_code,409)

    def test_resume_offset_and_chunk_replay(self):
        upload,payload=self.start_upload();key=uid()
        self.assertEqual(self.chunk(upload,PNG[:20],key=key).json()['offset'],20)
        self.assertEqual(self.chunk(upload,PNG[:20],key=key).json()['offset'],20)
        self.assertEqual(self.chunk(upload,PNG[20:],19).status_code,409)
        self.assertEqual(self.chunk(upload,PNG[20:],20).status_code,200)
        self.assertEqual(self.complete(upload).status_code,201)

    def test_incomplete_upload_denied(self):
        upload,payload=self.start_upload();self.chunk(upload,PNG[:10]);r=self.complete(upload)
        self.assertEqual(r.status_code,409);self.assertEqual(r.json()['code'],'UPLOAD_INCOMPLETE')

    def test_bad_hash_denied(self):
        upload,payload=self.start_upload(expected='0'*64);self.chunk(upload)
        r=self.complete(upload);self.assertEqual(r.status_code,409);self.assertEqual(r.json()['code'],'CHECKSUM_MISMATCH')

    def test_spoofed_mime_denied(self):
        upload,payload=self.start_upload(content=b'not a png');self.chunk(upload,b'not a png')
        r=self.complete(upload);self.assertEqual(r.status_code,415)

    def test_other_party_cannot_resume_upload(self):
        upload,payload=self.start_upload();self.login('CON');self.assertEqual(self.chunk(upload).status_code,403)

    def test_expired_upload_denied(self):
        upload,payload=self.start_upload()
        with self.app.state.store.transaction(True):self.app.state.store.uploads[upload['id']]['public']['expiresAt']='2000-01-01T00:00:00Z'
        self.assertEqual(self.chunk(upload).status_code,409)

    def test_restart_preserves_state_history_and_replay(self):
        item=self.item('inspection','scheduled');key=uid();first=self.command('inspections',item,'start',key=key)
        second_app=create_app(self.path,demo=True);second=TestClient(second_app)
        try:
            self.login('SUP',second)
            body={'roleAssignmentId':self.role,'expectedVersion':item['record']['version'],'payload':{},'evidenceIds':item['record']['evidenceIds']}
            replay=second.post(f'/projects/{self.project}/inspections/{item["record"]["id"]}/start',headers={**self.headers,'Idempotency-Key':key},json=body)
            self.assertEqual(replay.json(),first.json());self.assertEqual(second_app.state.store.engine.get('Inspection',item['record']['id'],item['record']['version'])['status'],'scheduled')
        finally:second.close();second_app.state.store.close()

    def test_concurrent_commands_one_wins(self):
        item=self.item('inspection','scheduled')
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:self.command('inspections',item,'start'),range(2)))
        self.assertEqual(sorted(r.status_code for r in results),[200,409])

    def test_analysis_adapter_is_explicitly_unavailable(self):
        r=self.client.post('/projects/'+self.project+'/analysis-runs',headers={**self.headers,'Idempotency-Key':uid()},json={})
        self.assertEqual(r.status_code,501);self.assertEqual(r.json()['code'],'ADAPTER_NOT_CONFIGURED')

    def test_admin_not_inherently_official_supervisor(self):
        self.login('ADM');item=self.item('inspection','scheduled');r=self.command('inspections',item,'start')
        self.assertEqual(r.status_code,403,r.text)

    def test_no_raw_patch_route(self):
        item=self.item('issue');r=self.client.patch(f'/projects/{self.project}/issues/{item["record"]["id"]}',headers=self.headers,json={'status':'closed'})
        self.assertEqual(r.status_code,405)

if __name__=='__main__':unittest.main()
