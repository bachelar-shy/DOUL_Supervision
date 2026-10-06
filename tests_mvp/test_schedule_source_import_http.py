"""Source import acceptance through real upload + HTTP + durable SQLite."""
from copy import deepcopy
from hashlib import sha256
import json
from unittest.mock import patch
from app.reference.engine import uid
from tests_mvp import test_schedule_http as existing
from services.api.schedule_import import portable


class ScheduleSourceImportTests(existing.ScheduleHttpPersistenceTests):
    def package(self, kind='baseline', baseline=None, activities=None, changes=None):
        oid = uid()
        # Reuse existing contract fixture values, but never bootstrap source activities.
        original = self.bootstrap_activity
        self.bootstrap_activity = lambda *args, **kwargs: {'objectType':'WorkItem','objectId':uid(),'version':1}
        try:
            payload = self.progress_payload(baseline, oid) if kind=='progress_update' else self.baseline_payload(oid)
        finally:
            self.bootstrap_activity = original
        schedule = payload['schedule']
        schedule.pop('criticalPathRef'); schedule.pop('activityCount')
        schedule['scheduleKind'] = kind
        schedule['sourceFormat'] = 'normalized_json'
        schedule.update(changes or {})
        package = dict(roleAssignmentId=self.sessions['CON']['actor']['roleAssignmentId'],clientObjectId=oid,
                       scope={k:self.scope[k] for k in ['packageId','locationId','discipline','responsibleOrganizationId']},title='Imported source',sourceEvidenceRef={},inputMode='normalized_json',
                       parserVersion='doul-normalized-json-v1',schedule=schedule,
                       activities=activities or [dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='Critical',critical=True))],criticalActivityId='A1')
        content = json.dumps(portable(package),ensure_ascii=False).encode()
        checksum = sha256(content).hexdigest()
        capture = uid()
        headers = {**self.headers['CON'],'Idempotency-Key':uid()}
        start = self.client.post(f'/projects/{self.project_id}/uploads',headers=headers,json=dict(
            roleAssignmentId=package['roleAssignmentId'],captureId=capture,fileName='schedule.json',mimeType='application/json',
            byteCount=len(content),expectedHash=checksum,sourcePartyId=self.sessions['CON']['actor']['partyId'],mediaType='document',
            **{k:self.scope[k] for k in ['discipline','packageId','locationId']}))
        self.assertEqual(start.status_code,201,start.text)
        upload_id = start.json()['id']
        chunk = self.client.put(f'/projects/{self.project_id}/uploads/{upload_id}/chunks',headers={**headers,'Idempotency-Key':uid(),'Upload-Offset':'0'},content=content)
        self.assertEqual(chunk.status_code,200,chunk.text)
        completed = self.client.post(f'/projects/{self.project_id}/uploads/{upload_id}/complete',headers={**headers,'Idempotency-Key':uid()},json=dict(roleAssignmentId=package['roleAssignmentId'],expectedHash=checksum))
        self.assertEqual(completed.status_code,201,completed.text)
        package['sourceEvidenceRef']=self.ref(completed.json(),'Evidence')
        package['schedule'].update(sourceFileRef=upload_id,sourceFileHash=checksum)
        return package

    def submit(self, package, key=None, actor='CON', project=None):
        return self.client.post(f'/projects/{project or self.project_id}/schedule-source-imports',headers={**self.headers[actor],'Idempotency-Key':key or uid()},json=package)

    def imported(self, package):
        response=self.submit(package)
        self.assertEqual(response.status_code,201,response.text)
        return response.json()

    def source(self, oid, actor='CON'):
        return self.client.get(f'/projects/{self.project_id}/schedule-source-imports/{oid}',headers=self.headers[actor])

    def assert_rollback(self, package, code):
        before=json.loads(json.dumps(self.app.state.store.export_state()))
        response=self.submit(package)
        self.assertEqual(response.status_code,409,response.text)
        self.assertEqual(response.json()['code'],code,response.text)
        self.assertEqual(json.loads(json.dumps(self.app.state.store.export_state())),before)

    def test_import_atomic_derived_refs_audit_and_original_history(self):
        activities=[dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='Critical',critical=True),successorActivityIds=['A2']),
                    dict(clientObjectId=uid(),data=dict(activityId='A2',wbsPath='1',activityName='Next'),predecessorActivityIds=['A1'])]
        package=self.package(activities=activities)
        result=self.imported(package); baseline=result['record']
        self.assertEqual(baseline['status'],'draft')
        self.assertEqual(baseline['schedule']['activityCount'],2)
        self.assertEqual(len(result['activityAuditEvents']),2)
        baseline=self.activate_baseline(baseline)
        self.assertEqual(baseline['status'],'effective')
        detail=self.source(baseline['id']);self.assertEqual(detail.status_code,200,detail.text)
        original=detail.json();self.assertEqual(original['record']['version'],1)
        self.assertEqual(original['record']['status'],'draft')
        self.assertEqual(original['activities'][0]['data']['sourceScheduleRef'],result['sourceScheduleRef'])
        self.assertEqual(original['activities'][0]['data']['successorRefs'],[result['activityRefs'][1]])
        workspace=self.client.get(f'/projects/{self.project_id}/workspace',headers=self.headers['CON']).json()
        projections=[i for i in workspace['items'] if i['machine']=='schedule_activity']
        self.assertEqual(len(projections),2)
        self.assertTrue(all(not i['actions'] for i in projections))

    def test_import_replay_survives_restart_and_changed_body_conflicts(self):
        package=self.package();key=uid();result=self.imported_with_key(package,key)
        before=len(self.app.state.store.engine.audit_events)
        self.reopen()
        replay=self.submit(package,key);self.assertEqual(replay.status_code,201,replay.text)
        self.assertEqual(replay.json(),result);self.assertEqual(len(self.app.state.store.engine.audit_events),before)
        changed=deepcopy(package);changed['title']='Different'
        self.assertEqual(self.submit(changed,key).json()['code'],'IDEMPOTENCY_CONFLICT')

    def imported_with_key(self,package,key):
        r=self.submit(package,key);self.assertEqual(r.status_code,201,r.text);return r.json()

    def test_source_hash_file_and_content_spoof_rejected(self):
        p=self.package();bad=deepcopy(p);bad['schedule']['sourceFileHash']='0'*64;self.assert_rollback(bad,'SOURCE_HASH_MISMATCH')
        bad=deepcopy(p);bad['schedule']['sourceFileRef']=uid();self.assert_rollback(bad,'SOURCE_REFERENCE_INVALID')
        bad=deepcopy(p);bad['activities'][0]['data']['activityName']='Injected';self.assert_rollback(bad,'SOURCE_CONTENT_MISMATCH')

    def test_duplicate_activity_and_dangling_logic_rejected(self):
        p=self.package(activities=[dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='A',critical=True)),dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='B'))])
        self.assert_rollback(p,'ACTIVITY_ID_DUPLICATE')
        p=self.package(activities=[dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='A',critical=True),predecessorActivityIds=['MISSING'])]);self.assert_rollback(p,'ACTIVITY_LOGIC_INVALID')

    def test_partial_insert_and_storage_failure_leave_no_records(self):
        p=self.package(activities=[dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='A',critical=True)),dict(clientObjectId=uid(),data=dict(activityId='A2',wbsPath='1',activityName='B'))])
        engine=self.app.state.store.engine;save=engine._save;before=json.loads(json.dumps(self.app.state.store.export_state()))
        def fail(kind,record):
            if record['id']==p['activities'][1]['clientObjectId']:raise RuntimeError('injected partial insert failure')
            return save(kind,record)
        with patch.object(engine,'_save',side_effect=fail):
            with self.assertRaises(RuntimeError):self.submit(p)
        self.assertEqual(json.loads(json.dumps(self.app.state.store.export_state())),before)
        with patch.object(self.app.state.store,'blob',side_effect=OSError('storage unavailable')):
            self.assert_rollback(p,'SOURCE_STORAGE_UNAVAILABLE')
        self.imported(p)

    def test_imported_source_fields_cannot_change_but_equal_resend_allowed(self):
        result=self.imported(self.package());baseline=result['record']
        r=self.command('schedule-baselines',baseline,'submit_baseline','CON',{'revision':'FORGED'})
        self.assertEqual(r.json()['code'],'IMMUTABLE_FIELD')
        r=self.command('schedule-baselines',baseline,'submit_baseline','CON',{'revision':baseline['revision']})
        self.assertEqual(r.status_code,200,r.text)

    def test_server_managed_provenance_cannot_be_forged(self):
        imported=self.imported(self.package());payload={k:v for k,v in imported['record'].items() if k not in ['id','projectId','version','createdAt','updatedAt','createdBy','status','subtype']}
        r=self.client.post(f'/projects/{self.project_id}/schedule-baselines',headers={**self.headers['CON'],'Idempotency-Key':uid()},json=dict(roleAssignmentId=self.sessions['CON']['actor']['roleAssignmentId'],clientObjectId=uid(),payload=payload))
        self.assertEqual(r.status_code,409,r.text);self.assertEqual(r.json()['code'],'IMMUTABLE_FIELD')

    def test_supporting_recovery_cannot_activate_baseline(self):
        result=self.imported(self.package(kind='recovery'));self.assertEqual(result['record']['status'],'snapshot')
        r=self.command('schedule-baselines',result['record'],'activate_baseline','SUP')
        self.assertEqual(r.status_code,404,r.text)
        self.assertEqual(self.source(result['record']['id']).status_code,200)

    def test_cross_project_and_expired_role_rejected(self):
        p=self.package();r=self.submit(p,project=uid());self.assertEqual(r.status_code,404,r.text)
        role_id=p['roleAssignmentId']
        with self.app.state.store.transaction(True):
            role=self.app.state.store.engine.get('RoleAssignment',role_id);role['validTo']='2020-01-01T00:00:00Z';self.app.state.store.engine._save('RoleAssignment',role)
        r=self.submit(p);self.assertEqual(r.status_code,403,r.text);self.assertEqual(r.json()['code'],'ASSIGNMENT_EXPIRED')

    def test_actual_dates_cannot_exceed_data_date(self):
        p=self.package(activities=[dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='A',critical=True,actualStartAt='2026-02-01T00:00:00Z'))]);self.assert_rollback(p,'ACTIVITY_DATE_INVALID')

    def test_progress_import_requires_effective_current_baseline(self):
        baseline=self.imported(self.package())['record']
        p=self.package(kind='progress_update',baseline=baseline)
        self.assert_rollback(p,'SCHEDULE_STATUS_INVALID')

    def bootstrap_approval(self, baseline):
        # Override legacy fixture helper with actual approval commands for this suite.
        r=self.client.post(f'/projects/{self.project_id}/approvals',headers={**self.headers['CON'],'Idempotency-Key':uid()},json=dict(roleAssignmentId=self.sessions['CON']['actor']['roleAssignmentId'],clientObjectId=uid(),payload=dict(targetRef=self.ref(baseline),requestedBy=self.sessions['CON']['actor']['partyId'],approvalKind='technical',**self.scope)))
        self.assertEqual(r.status_code,201,r.text);approval=r.json()['record']
        for command in ['review','approve']:
            r=self.command('approvals',approval,command,'SUP');self.assertEqual(r.status_code,200,r.text);approval=r.json()['record']
        return self.ref(approval,'Approval')

    def freeze_imported(self, baseline, package):
        progress=self.imported(package)['record']
        previous_create=self.create_progress
        self.create_progress=lambda *args,**kwargs:progress
        try:return self.freeze_progress(baseline)[0]
        finally:self.create_progress=previous_create

    def test_progress_freeze_correction_preserves_baseline_and_originals(self):
        decisions_before={key:deepcopy(value) for key,value in self.app.state.store.engine._records.items() if key[0]=='Decision'}
        baseline=self.activate_baseline(self.imported(self.package())['record'])
        activity=self.source(baseline['id']).json()['activityRefs'][0]
        p=self.package(kind='progress_update',baseline=baseline,activities=[dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='Progress',critical=True,percentComplete=30,baselineActivityRef=activity))])
        first=self.freeze_imported(baseline,p)
        baseline_after=self.app.state.store.engine.get('InformationItem',baseline['id'])
        self.assertEqual(baseline_after,baseline)
        prior=self.ref(first)
        corrected=self.package(kind='progress_update',baseline=baseline,changes=dict(previousScheduleRef=prior,correctionOfRef=prior,correctionReason='Correct actuals'))
        second=self.freeze_imported(baseline,corrected)
        self.assertEqual(second['status'],'frozen')
        self.assertEqual(self.app.state.store.engine.get('InformationItem',first['id'])['status'],'superseded')
        self.assertEqual(self.source(first['id']).json()['record']['status'],'submitted')
        self.reopen();self.assertEqual(self.source(second['id']).json()['record']['version'],1)
        # Imported progress and baseline do not create an owner closure decision.
        self.assertEqual({key:value for key,value in self.app.state.store.engine._records.items() if key[0]=='Decision'}, decisions_before)

    def test_stale_baseline_reference_rolls_back(self):
        baseline=self.imported(self.package())['record']
        p=self.package(kind='progress_update',baseline=baseline)
        self.activate_baseline(baseline)
        self.assert_rollback(p,'REFERENCE_STALE')

    def test_invalid_baseline_mapping_rolls_back(self):
        baseline=self.activate_baseline(self.imported(self.package())['record'])
        unrelated=self.imported(self.package(kind='recovery'))
        p=self.package(kind='progress_update',baseline=baseline,activities=[dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='Progress',critical=True,baselineActivityRef=unrelated['activityRefs'][0]))])
        self.assert_rollback(p,'ACTIVITY_BASELINE_INVALID')

    def test_unsupported_parser_and_client_derived_fields_rejected(self):
        p=self.package();p['parserVersion']='xer-pretend'
        r=self.submit(p);self.assertEqual(r.status_code,422,r.text)
        p=self.package();p['schedule']['activityCount']=999
        r=self.submit(p);self.assertEqual(r.status_code,422,r.text)
        self.assertEqual(self.source(p['clientObjectId']).status_code,404)

    def test_stale_source_evidence_is_rejected(self):
        p=self.package()
        with self.app.state.store.transaction(True):
            evidence=self.app.state.store.engine.get('Evidence',p['sourceEvidenceRef']['objectId'])
            evidence['version']+=1;self.app.state.store.engine._save('Evidence',evidence)
        self.assert_rollback(p,'REFERENCE_STALE')

    def test_critical_object_collision_and_invalid_authority_rejected(self):
        p=self.package(activities=[dict(clientObjectId=uid(),data=dict(activityId='A1',wbsPath='1',activityName='A',critical=False))]);self.assert_rollback(p,'CRITICAL_ACTIVITY_INVALID')
        p=self.package();p['activities'][0]['clientObjectId']=p['clientObjectId'];self.assert_rollback(p,'IDENTITY_COLLISION')
        p=self.package();p['roleAssignmentId']=self.sessions['OWN']['actor']['roleAssignmentId']
        r=self.submit(p,actor='OWN');self.assertEqual(r.status_code,403,r.text);self.assertEqual(r.json()['code'],'NOT_AUTHORIZED')

    def test_import_response_matches_generated_api_schema(self):
        from services.api.main import SCHEMAS
        from app.reference.validation import validate
        result=self.imported(self.package());validate(result,SCHEMAS['ScheduleSourceImportResult'],SCHEMAS)
        detail=self.source(result['record']['id']);self.assertEqual(detail.status_code,200,detail.text)
        validate(detail.json(),SCHEMAS['ScheduleSourceImportDetail'],SCHEMAS)
