"""Real password/JWT HTTP tests with actual staging gates on isolated synthetic SQLite."""
from copy import deepcopy
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption, PublicFormat
from fastapi.testclient import TestClient

from app.reference.engine import uid
from app.reference.validation import ContractError
from scripts.install_site_test_project import install, CLASSIFICATION
from scripts.import_site_test_reference import import_reference
from services.api.main import create_app
from services.api.persistence import create_local_persistence
from services.deployment.auth import PinnedJWT, subject_key
from services.deployment.password_auth import PasswordAccounts


class ProjectSettingsHTTPTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); self.addCleanup(self.folder.cleanup)
        self.path = str(Path(self.folder.name) / 'state.sqlite3')
        with patch.dict(os.environ, DOUL_ENVIRONMENT='development'):
            self.store = create_local_persistence(self.path, demo=True)
        self.addCleanup(lambda: self.store.close())
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        path = Path(self.folder.name) / 'private.pem'
        path.write_bytes(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())); path.chmod(0o600)
        self.issuer = 'https://auth.doul.example'
        self.verifier = PinnedJWT(key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo), self.issuer, 'doul-supervision', 'settings-test')
        self.env = patch.dict(os.environ, {'DOUL_ENVIRONMENT':'staging','DOUL_AUTH_MODE':'local-password',
            'DOUL_AUTH_PRIVATE_KEY_FILE':str(path), 'DOUL_API_ALLOWED_ORIGINS':'https://app.example',
            'DOUL_API_ALLOWED_HOSTS':'testserver', 'DOUL_QUEUE_ENABLED':'false'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.admin = deepcopy(self.store.meta['actors']['ADM']); self.project = self.store.meta['projectId']
        with self.store.transaction(True):
            for group in ('ADM','SUP','OWN','CON'):
                role=self.store.engine.get('RoleAssignment',self.store.meta['actors'][group]['roleAssignmentId'])
                self.store.engine.bootstrap('Party',dict(id=role['organizationId'],projectId=self.project,kind='ORGANIZATION',name='기존 '+group+' 회사',loginEnabled=False))
        self.accounts = PasswordAccounts(self.store, self.verifier)
        self.accounts.create(dict(actorGroup='ADM',projectId=self.project), 'operator', 'Synthetic-Password-12', self.admin['partyId'], self.admin['roleAssignmentId'])
        with self.store.transaction(True):
            self.store.meta['provisioning'] = dict(environment='staging', snapshotFormat=1,
                syntheticData=True, approvedBy='synthetic-test-owner', approvalRef='unit-fixture')
        self.sample = install(self.store, issuer=self.issuer, username='operator', approval_ref='unit-fixture', enable_project_settings=True)
        self.http = TestClient(create_app(demo=False,persistence=self.store,authentication=self.verifier))
        self.http.__enter__(); self.addCleanup(lambda: self.http.__exit__(None,None,None))
        self.headers = self.login('operator', 'Synthetic-Password-12')
        self.url = '/projects/' + self.project + '/settings'

    def login(self, username, password):
        result = self.http.post('/auth/login',json=dict(username=username,password=password),headers={'Origin':'https://app.example'})
        self.assertEqual(result.status_code,200,result.text)
        return {'Origin':'https://app.example','Authorization':'Bearer '+result.json()['accessToken']}

    def read(self):
        result=self.http.get(self.url,headers=self.headers); self.assertEqual(result.status_code,200,result.text)
        return result.json()

    def save(self, command, values, *, version=None, key=None, expected=200):
        payload=dict(expectedVersion=self.read()['project']['version'] if version is None else version,**values)
        result=self.http.post(self.url+'/commands/'+command,json=payload,headers={**self.headers,'Idempotency-Key':key or uid()})
        self.assertEqual(result.status_code,expected,result.text)
        return result

    def test_four_roles_version_replay_history_and_restart(self):
        data=self.read(); self.assertEqual([p['name'] for p in data['roleProfiles']],['관리자','감리자','발주처','시공사'])
        original=deepcopy(data['project']); key=uid(); payload=dict(name='테스트 현장 새 이름',country='VN',timezone='Asia/Ho_Chi_Minh',classification='공장')
        result=self.save('update_project',payload,version=original['version'],key=key).json()
        self.assertEqual(result['project']['version'],original['version']+1)
        self.assertEqual(self.save('update_project',payload,version=original['version'],key=key).json(),result)
        self.save('update_project',dict(payload,name='다른 이름'),version=original['version'],key=key,expected=409)
        self.save('update_project',payload,version=original['version'],expected=409)
        with self.store.transaction():
            self.assertEqual(self.store.engine.get('Project',self.project,original['version']),original)
            self.assertEqual(sum(e['command']=='project_settings:update_project' for e in self.store.engine.audit_events),1)
        self.store.close(); self.store=create_local_persistence(self.path,demo=False)
        with self.store.transaction():
            self.assertEqual(self.store.engine.get('Project',self.project)['name'],payload['name'])

    def test_company_participant_scopes_and_no_fabricated_qualifications(self):
        data=self.save('add_organization',dict(name='시험 감리회사',actorGroup='SUP')).json()
        org=next(o for o in data['organizations'] if o['name']=='시험 감리회사')
        scope=data['scope']; values=dict(name='시험 감리자',actorGroup='SUP',organizationId=org['id'],startDate='2026-01-01',endDate='2027-12-31',
            disciplines=['architecture'],packageIds=[scope['packageId']],locationIds=[scope['locationId']])
        data=self.save('add_participant',values).json(); person=next(p for p in data['participants'] if p['name']==values['name'])
        assignment=next(a for a in data['assignments'] if a['partyId']==person['id'])
        with self.store.transaction():
            actual=self.store.engine.get('RoleAssignment',assignment['id'])
            self.assertEqual(actual['qualificationIds'],[]); self.assertNotIn('manage_project_roles',actual['authorityCodes'])
        self.save('add_participant',dict(values,locationIds=[uid()]),expected=403)
        self.save('add_participant',dict(values,organizationId=self.sample['partyId']),expected=403)

    def test_malformed_input_and_immutable_fields_rollback(self):
        initial=self.read()['project']; version=initial['version']
        self.save('add_organization',dict(name='회사',actorGroup=[]),expected=422)
        self.save('add_participant',dict(name='담당자',actorGroup={},organizationId=uid(),startDate='',endDate='',disciplines=[],packageIds=[],locationIds=[]),expected=422)
        self.save('update_project',dict(name='x',country=[],timezone='UTC',classification=''),expected=422)
        self.save('update_project',dict(name='x',country='VN',timezone='bad timezone',classification=''),expected=422)
        self.save('update_project',dict(name='x',country='VN',timezone='UTC',classification='',qualificationRules=[]),expected=422)
        self.save('set_work_scope',dict(discipline='architecture',packageId='*',locationId='*',responsibleOrganizationId=[],minimumQualificationRank=1),expected=403)
        self.assertEqual(self.read()['project']['version'],version)

    def test_qualification_criteria_cannot_be_weakened_and_self_assignment_readonly(self):
        data=self.read(); scope=data['scope']
        self.save('set_work_scope',dict(scope,minimumQualificationRank=1))
        self.save('set_work_scope',dict(scope,minimumQualificationRank=3),expected=422)
        own=next(a for a in self.read()['assignments'] if a['id']==self.admin['roleAssignmentId'])
        self.save('update_assignment',dict(roleId=own['id'],expectedRoleVersion=own['version'],active=False,
            startDate=own['startDate'],endDate=own['endDate'],disciplines=['*'],packageIds=['*'],locationIds=['*']),expected=403)

    def test_non_admin_inactive_admin_and_unsigned_requests_denied(self):
        sup=self.store.meta['actors']['SUP']
        self.accounts.create(dict(actorGroup='ADM',projectId=self.project),'supervisor','Synthetic-Password-34',sup['partyId'],sup['roleAssignmentId'])
        headers=self.login('supervisor','Synthetic-Password-34')
        self.assertEqual(self.http.get(self.url,headers=headers).status_code,403)
        self.assertEqual(self.http.get(self.url).status_code,401)
        with self.store.transaction(True):
            role=self.store.engine.get('RoleAssignment',self.admin['roleAssignmentId']); role['active']=False; self.store.engine._save('RoleAssignment',role)
        self.assertEqual(self.http.get(self.url,headers=self.headers).status_code,403)

    def test_project_switch_revokes_previous_token_and_isolates_project_records(self):
        directory=self.http.get('/auth/projects',headers=self.headers).json()
        self.assertEqual({p['projectId'] for p in directory['items']},{self.project,self.sample['projectId']})
        self.assertTrue(next(p for p in directory['items'] if p['projectId']==self.sample['projectId'])['synthetic'])
        old=self.headers.copy(); selected=self.http.post('/auth/project-session',json=dict(projectId=self.sample['projectId']),headers=old)
        self.assertEqual(selected.status_code,200,selected.text)
        self.assertEqual(selected.json()['actor']['partyId'],self.sample['partyId'])
        self.headers['Authorization']='Bearer '+selected.json()['accessToken']
        self.assertEqual(self.http.get(self.url,headers=old).status_code,401)
        self.assertEqual(self.http.get(self.url,headers=self.headers).status_code,404)
        workspace=self.http.get('/projects/'+self.sample['projectId']+'/workspace',headers=self.headers)
        self.assertEqual(workspace.status_code,200,workspace.text)
        self.assertEqual(workspace.json()['context']['dataClassification'],CLASSIFICATION)
        self.assertFalse(workspace.json()['demo']); self.assertGreater(len(workspace.json()['items']),5)
        foreign=self.http.post('/auth/project-session',json=dict(projectId=uid()),headers=self.headers)
        self.assertEqual(foreign.status_code,403)
        self.assertEqual(self.http.post('/auth/project-session',json=dict(projectId=self.project,partyId=self.admin['partyId']),headers=self.headers).status_code,422)
        back=self.http.post('/auth/project-session',json=dict(projectId=self.project),headers=self.headers)
        self.assertEqual(back.status_code,200,back.text)

    def test_disabled_target_membership_and_pilot_installation_fail_closed(self):
        with self.store.transaction(True):
            party=self.store.engine.get('Party',self.sample['partyId']); party['loginEnabled']=False; self.store.engine._save('Party',party)
        response=self.http.post('/auth/project-session',json=dict(projectId=self.sample['projectId']),headers=self.headers)
        self.assertEqual(response.status_code,401)
        with patch.dict(os.environ,DOUL_ENVIRONMENT='pilot'):
            with self.assertRaises(ContractError): install(self.store,issuer=self.issuer,username='operator',approval_ref='unit-fixture')

    def test_installation_idempotent_and_preserves_existing_records(self):
        with self.store.transaction():
            before=deepcopy(self.store.engine._records); audit=deepcopy(self.store.engine.audit_events)
        marker=install(self.store,issuer=self.issuer,username='operator',approval_ref='unit-fixture',enable_project_settings=True)
        self.assertEqual(marker,self.sample)
        with self.store.transaction():
            self.assertEqual(before,self.store.engine._records); self.assertEqual(audit,self.store.engine.audit_events)
        self.assertNotIn('passwordAccounts',self.read()); self.assertNotIn('identityBindings',self.read())

    def test_original_construction_pdf_restoration_is_scoped_immutable_and_restart_safe(self):
        from hashlib import sha256
        # A large byte fixture tests the existing server limit, not PDF rendering.
        content = b'%PDF-1.4\n' + b' ' * (21 * 1024 * 1024)
        args = dict(project_id=self.sample['projectId'], issuer=self.issuer, username='operator',
                    content=content, filename='original.pdf', expected_hash=sha256(content).hexdigest(),
                    source_reference='user-upload-fixture', approval_ref='test-only-restoration')
        before = self.read()['project']
        record = import_reference(self.store, **args)
        self.assertNotIn('drawingRef', record)
        self.assertEqual(record['metadata']['documentPurpose'], 'construction')
        self.assertEqual(record['metadata']['sourceApprovalStatus'], 'unverified')
        self.assertEqual(record['metadata']['name'], 'original.pdf')
        with self.store.transaction():
            audit = deepcopy(self.store.engine.audit_events)
            self.assertEqual(self.store.blob(record['fileId']), content)
        self.assertEqual(import_reference(self.store, **args), record)
        with self.store.transaction(): self.assertEqual(self.store.engine.audit_events, audit)
        for changes in [dict(project_id=self.project), dict(expected_hash='0'*64), dict(filename='../original.pdf')]:
            with self.assertRaises(ContractError): import_reference(self.store, **(args | changes))
        with patch.dict(os.environ, DOUL_ENVIRONMENT='pilot'):
            with self.assertRaises(ContractError): import_reference(self.store, **args)
        self.assertEqual(self.read()['project'], before)
        self.store.close(); self.store=create_local_persistence(self.path,demo=False)
        with self.store.transaction(): self.assertEqual(sha256(self.store.blob(record['fileId'])).hexdigest(), args['expected_hash'])

    def test_create_blank_project_replay_membership_and_no_cloned_authority(self):
        before=self.read()['project']; url=self.url+'/projects'; key=uid()
        body=dict(name='새 실제 프로젝트',country='VN',timezone='Asia/Ho_Chi_Minh',classification='공장',organizationName='운영관리 회사')
        headers={**self.headers,'Idempotency-Key':key}
        first=self.http.post(url,json=body,headers=headers);self.assertEqual(first.status_code,200,first.text)
        project=first.json()['project']; target=project['id']; self.assertNotEqual(target,self.project)
        replay=self.http.post(url,json=body,headers=headers);self.assertEqual(replay.json(),first.json())
        changed=self.http.post(url,json=body|{'name':'다른 프로젝트'},headers=headers);self.assertEqual(changed.status_code,409)
        self.assertEqual(self.read()['project'],before)
        directory=self.http.get('/auth/projects',headers=self.headers).json()['items']
        self.assertTrue(any(p['projectId']==target and not p['synthetic'] for p in directory))
        selection=self.http.post('/auth/project-session',json=dict(projectId=target),headers=self.headers)
        self.assertEqual(selection.status_code,200,selection.text)
        current={**self.headers,'Authorization':'Bearer '+selection.json()['accessToken']}
        workspace=self.http.get('/projects/'+target+'/workspace',headers=current)
        self.assertEqual(workspace.status_code,200,workspace.text);self.assertEqual(workspace.json()['items'],[])
        self.assertNotIn('scope',workspace.json()['context']);self.assertNotIn('drawingRef',workspace.json()['context'])
        data=self.http.get('/projects/'+target+'/settings',headers=current).json()
        self.assertTrue(data['canCreateProject']);self.assertIsNone(data['scope']);self.assertEqual(len(data['assignments']),1)
        role=data['assignments'][0]
        with self.store.transaction():
            actual=self.store.engine.get('RoleAssignment',role['id'])
            self.assertEqual(actual['qualificationIds'],[])
            self.assertEqual(set(actual['authorityCodes']),{'manage_project_roles','render_document'})
            self.assertEqual(actual['validTo'],self.store.engine.get('RoleAssignment',self.admin['roleAssignmentId'])['validTo'])
        self.assertEqual(self.http.get(self.url,headers=current).status_code,404)
        self.store.close();self.store=create_local_persistence(self.path,demo=False)
        with self.store.transaction(): self.assertEqual(self.store.engine.get('Project',target),project)

    def test_create_project_rejects_other_roles_bad_inputs_and_revoked_identity(self):
        url=self.url+'/projects'; body=dict(name='새 프로젝트',country='KR',timezone='Asia/Seoul',classification='',organizationName='관리회사')
        for change in [dict(country=[]),dict(timezone='invalid timezone'),dict(name=' '),dict(qualificationRules=[]),dict(partyId=uid())]:
            result=self.http.post(url,json=body|change,headers={**self.headers,'Idempotency-Key':uid()})
            self.assertEqual(result.status_code,422,result.text)
        actor=self.store.meta['actors']['SUP']
        self.accounts.create(dict(actorGroup='ADM',projectId=self.project),'supervisor','Synthetic-Password-34',actor['partyId'],actor['roleAssignmentId'])
        denied=self.http.post(url,json=body,headers={**self.login('supervisor','Synthetic-Password-34'),'Idempotency-Key':uid()})
        self.assertEqual(denied.status_code,403,denied.text)
        with self.store.transaction(True):
            binding=self.store.meta['identityBindings'][subject_key(self.issuer,'local:operator')];binding['active']=False
        revoked=self.http.post(url,json=body,headers={**self.headers,'Idempotency-Key':uid()});self.assertEqual(revoked.status_code,401)


    def test_project_personnel_request_delivery_admin_only_accounts_and_isolation(self):
        path='/projects/'+self.project+'/personnel-requests'
        created={}
        for group in ('CON','SUP','OWN'):
            person=self.store.meta['actors'][group]
            username='staff_'+group.lower()
            self.accounts.create(dict(actorGroup='ADM',projectId=self.project),
                username,'Synthetic-Password-'+group+'-35',person['partyId'],person['roleAssignmentId'])
            headers=self.login(username,'Synthetic-Password-'+group+'-35')
            response=self.http.get(path,headers=headers)
            self.assertEqual(response.status_code,200,response.text)
            self.assertFalse(response.json()['canReview'])
            self.assertEqual(response.json()['items'],[])
            payload=dict(name='추가인원 '+group,organization='시험회사 '+group,requestedRole=group,reason='현장 검측 업무 인력 보강')
            key=uid()
            send=self.http.post(path,json=payload,headers={**headers,'Idempotency-Key':key})
            self.assertEqual(send.status_code,200,send.text)
            self.assertEqual(send.json()['deliveredTo'],'project_admin_inbox')
            self.assertEqual(send.json()['record']['status'],'pending')
            created[group]=send.json()['record']
            self.assertEqual(self.http.post(path,json=payload,headers={**headers,'Idempotency-Key':key}).json(),send.json())
            self.assertEqual(self.http.post(path,json=payload|{'reason':'다름'},headers={**headers,'Idempotency-Key':key}).status_code,409)
            self.assertEqual(self.http.post(path,json=payload|{'requesterPartyId':uid()},headers={**headers,'Idempotency-Key':uid()}).status_code,422)
            self.assertEqual(self.http.post(path,json=payload|{'requestedRole':'ADM'},headers={**headers,'Idempotency-Key':uid()}).status_code,422)
            self.assertEqual(self.http.post(path,json=payload|{'requestedRole':[]},headers={**headers,'Idempotency-Key':uid()}).status_code,422)
            account_body=dict(username='forbidden_'+group.lower(),password='Synthetic-Password-99',
                              partyId=person['partyId'],roleAssignmentId=person['roleAssignmentId'])
            self.assertEqual(self.http.post('/auth/accounts',json=account_body,headers=headers).status_code,403)
            self.assertEqual(self.http.get(self.url,headers=headers).status_code,403)
            self.assertEqual(self.http.post(self.url+'/projects',
                json=dict(name='금지',country='VN',timezone='Asia/Ho_Chi_Minh',classification='',organizationName='금지'),
                headers={**headers,'Idempotency-Key':uid()}).status_code,403)
            self.assertEqual(self.http.post(path+'/'+created[group]['id']+'/decision',
                json=dict(expectedVersion=1,status='approved',note=''),
                headers={**headers,'Idempotency-Key':uid()}).status_code,403)
            own=self.http.get(path,headers=headers).json()['items']
            self.assertEqual([item['id'] for item in own],[created[group]['id']])

        inbox=self.http.get(path,headers=self.headers)
        self.assertEqual(inbox.status_code,200,inbox.text)
        self.assertTrue(inbox.json()['canReview'])
        self.assertEqual(inbox.json()['pendingCount'],3)
        self.assertEqual({item['id'] for item in inbox.json()['items']},{record['id'] for record in created.values()})
        self.assertEqual(self.http.post(path,
            json=dict(name='관리자',organization='관리',requestedRole='CON',reason='금지'),
            headers={**self.headers,'Idempotency-Key':uid()}).status_code,403)

        request_id=created['CON']['id']
        review_path=path+'/'+request_id+'/decision'
        decision=dict(expectedVersion=1,status='approved',note='배정과 계정은 별도 등록')
        key=uid()
        approved=self.http.post(review_path,json=decision,headers={**self.headers,'Idempotency-Key':key})
        self.assertEqual(approved.status_code,200,approved.text)
        self.assertEqual(approved.json()['record']['version'],2)
        self.assertFalse(approved.json()['accountCreated'])
        self.assertEqual(self.http.post(review_path,json=decision,headers={**self.headers,'Idempotency-Key':key}).json(),approved.json())
        self.assertEqual(self.http.post(review_path,json=decision,headers={**self.headers,'Idempotency-Key':uid()}).status_code,409)
        self.assertEqual(self.http.post(path+'/'+created['SUP']['id']+'/decision',
            json=dict(expectedVersion=1,status='rejected',note=' '),
            headers={**self.headers,'Idempotency-Key':uid()}).status_code,422)
        rejected=self.http.post(path+'/'+created['SUP']['id']+'/decision',
            json=dict(expectedVersion=1,status='rejected',note='인력 계획 자료 미비'),
            headers={**self.headers,'Idempotency-Key':uid()})
        self.assertEqual(rejected.status_code,200,rejected.text)
        self.assertEqual(rejected.json()['record']['status'],'rejected')

        con_headers=self.login('staff_con','Synthetic-Password-CON-35')
        con_record=self.http.get(path,headers=con_headers).json()['items'][0]
        self.assertEqual(con_record['status'],'approved')
        self.assertEqual(con_record['reviewNote'],decision['note'])
        with self.store.transaction():
            events=self.store.meta['personnelRequestAudit'][self.project]
            self.assertEqual(len(events),5)
            self.assertEqual({event['event'] for event in events},{'submitted','approved','rejected'})

        selected=self.http.post('/auth/project-session',json=dict(projectId=self.sample['projectId']),headers=self.headers)
        self.assertEqual(selected.status_code,200,selected.text)
        in_sample={**self.headers,'Authorization':'Bearer '+selected.json()['accessToken']}
        self.assertEqual(self.http.get(path,headers=in_sample).status_code,404)
        sample_list=self.http.get('/projects/'+self.sample['projectId']+'/personnel-requests',headers=in_sample)
        self.assertEqual(sample_list.status_code,200,sample_list.text)
        self.assertEqual(sample_list.json()['items'],[])
        self.assertEqual(self.http.post('/projects/'+self.sample['projectId']+'/personnel-requests/'+request_id+'/decision',
            json=decision,headers={**in_sample,'Idempotency-Key':uid()}).status_code,404)
        self.store.close();self.store=create_local_persistence(self.path,demo=False)
        with self.store.transaction():
            self.assertEqual(self.store.meta['personnelRequests'][self.project][request_id]['status'],'approved')
            self.assertEqual(len(self.store.meta['personnelRequestAudit'][self.project]),5)


if __name__ == '__main__': unittest.main()
