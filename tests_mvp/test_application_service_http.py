"""HTTP tests for inspection-case application services."""
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


class ApplicationServiceHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=str(Path(self.temp.name)/'state.db')
        self.app=create_app(self.path,demo=True)
        self.client=TestClient(self.app)
        self.login('SUP')

    def tearDown(self):
        self.client.close();self.app.state.store.close();self.temp.cleanup()

    def login(self,actor_group):
        self.session=self.client.post('/dev/sessions',json={'actorGroup':actor_group}).json()
        self.project=self.session['projectId']
        self.headers={
            'Authorization':'Bearer '+self.session['accessToken'],
            'X-RoleAssignment-Id':self.session['actor']['roleAssignmentId'],
        }

    def workspace(self):
        return self.client.get('/projects/'+self.project+'/workspace',headers=self.headers).json()

    def command(self,collection,record,command,payload=None,key=None,evidence_ids=None):
        return self.client.post(
            f'/projects/{self.project}/{collection}/{record["id"]}/{command}',
            headers={**self.headers,'Idempotency-Key':key or uid()},
            json={
                'roleAssignmentId':self.session['actor']['roleAssignmentId'],
                'expectedVersion':record['version'],
                'payload':payload or {},
                'evidenceIds':evidence_ids if evidence_ids is not None else record.get('evidenceIds',[]),
            },
        )

    def fail_scheduled_inspection(self):
        workspace=self.workspace()
        inspection=next(x['record'] for x in workspace['items'] if x['machine']=='inspection' and x['record']['status']=='scheduled')
        started=self.command('inspections',inspection,'start')
        self.assertEqual(started.status_code,200,started.text)
        inspection=started.json()['record']
        results=[{
            'itemId':'dimension',
            'requirementRef':inspection['requirementRefs'][0],
            'result':'fail',
            'evidenceIds':inspection['evidenceIds'],
            'measuredValue':95,
            'unit':'mm',
        }]
        pending=self.command('inspections',inspection,'submit-results',{'checkResults':results})
        self.assertEqual(pending.status_code,200,pending.text)
        inspection=pending.json()['record']
        failed=self.command('inspections',inspection,'fail',{'failureReason':'벽체 치수 허용오차 초과'})
        self.assertEqual(failed.status_code,200,failed.text)
        return failed.json()['record']

    def issue_package_body(self,inspection):
        workspace=self.workspace()
        observation=next(x['record'] for x in workspace['items'] if x['machine']=='observation' and x['record']['status']=='confirmed')
        contractor=next(x for x in workspace['participants'] if x['actorGroup']=='CON')
        return {
            'roleAssignmentId':self.session['actor']['roleAssignmentId'],
            'issueObjectId':uid(),
            'actionObjectId':uid(),
            'observationIds':[observation['id']],
            'subtype':'NCR',
            'title':'벽체 치수 부적합',
            'actionTitle':'벽체 치수 시정조치',
            'responsiblePartyId':contractor['partyId'],
            'dueAt':'2026-10-20T09:00:00Z',
        }

    def test_issue_package_is_atomic_and_inherits_failed_inspection_scope(self):
        inspection=self.fail_scheduled_inspection()
        body=self.issue_package_body(inspection)
        response=self.client.post(
            f'/projects/{self.project}/inspection-cases/{inspection["id"]}/issues',
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )
        self.assertEqual(response.status_code,201,response.text)
        result=response.json()
        issue=result['issue'];action=result['correctiveAction']
        self.assertEqual(issue['status'],'assigned')
        self.assertEqual(action['status'],'assigned')
        self.assertEqual(issue['inspectionIds'],[inspection['id']])
        self.assertEqual(issue['actionIds'],[action['id']])
        self.assertEqual(action['relatedIssueId'],issue['id'])
        for field in ['packageId','locationId','discipline','responsibleOrganizationId','drawingRef','requirementRefs']:
            self.assertEqual(issue[field],inspection[field])
            self.assertEqual(action[field],inspection[field])

    def test_issue_package_rejects_nonfailed_inspection_without_partial_records(self):
        workspace=self.workspace()
        inspection=next(x['record'] for x in workspace['items'] if x['machine']=='inspection' and x['record']['status']=='requested')
        body=self.issue_package_body(inspection)
        response=self.client.post(
            f'/projects/{self.project}/inspection-cases/{inspection["id"]}/issues',
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )
        self.assertEqual(response.status_code,409,response.text)
        self.assertEqual(response.json()['code'],'INSPECTION_NOT_FAILED')
        self.assertEqual(self.client.get(f'/projects/{self.project}/issues/{body["issueObjectId"]}',headers=self.headers).status_code,404)
        self.assertEqual(self.client.get(f'/projects/{self.project}/actions/{body["actionObjectId"]}',headers=self.headers).status_code,404)

    def test_issue_package_is_idempotent_at_application_boundary(self):
        inspection=self.fail_scheduled_inspection()
        body=self.issue_package_body(inspection);key=uid()
        before=len(self.app.state.store.engine.audit_events)
        first=self.client.post(
            f'/projects/{self.project}/inspection-cases/{inspection["id"]}/issues',
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        again=self.client.post(
            f'/projects/{self.project}/inspection-cases/{inspection["id"]}/issues',
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(first.status_code,201,first.text)
        self.assertEqual(again.status_code,201,again.text)
        self.assertEqual(again.json(),first.json())
        self.assertEqual(len(self.app.state.store.engine.audit_events),before+4)

        changed={**body,'title':'같은 키로 변경된 제목'}
        conflict=self.client.post(
            f'/projects/{self.project}/inspection-cases/{inspection["id"]}/issues',
            headers={**self.headers,'Idempotency-Key':key},
            json=changed,
        )
        self.assertEqual(conflict.status_code,409,conflict.text)
        self.assertEqual(conflict.json()['code'],'IDEMPOTENCY_CONFLICT')

        other=next(
            x['record'] for x in self.workspace()['items']
            if x['machine']=='inspection' and x['record']['id']!=inspection['id']
        )
        other_parent=self.client.post(
            f'/projects/{self.project}/inspection-cases/{other["id"]}/issues',
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(other_parent.status_code,409,other_parent.text)
        self.assertEqual(other_parent.json()['code'],'IDEMPOTENCY_CONFLICT')

        missing_parent=self.client.post(
            f'/projects/{self.project}/inspection-cases/{uid()}/issues',
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(missing_parent.status_code,404,missing_parent.text)
        self.assertEqual(missing_parent.json()['code'],'OBJECT_NOT_FOUND')

    def test_issue_package_does_not_expand_contractor_authority(self):
        inspection=self.fail_scheduled_inspection()
        body=self.issue_package_body(inspection)
        self.login('CON')
        body['roleAssignmentId']=self.session['actor']['roleAssignmentId']
        response=self.client.post(
            f'/projects/{self.project}/inspection-cases/{inspection["id"]}/issues',
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )
        self.assertEqual(response.status_code,403,response.text)
        self.assertEqual(response.json()['code'],'NOT_AUTHORIZED')

    def bootstrap_closed_case(self):
        """Trusted HTTP-adapter fixture; lifecycle semantics are tested in tests/test_case_end_to_end.py."""
        store=self.app.state.store
        root_id=uid();issue_id=uid()
        with store.transaction(True):
            scope=store.meta['scope']
            root=store.engine.bootstrap('Inspection',dict(
                id=root_id,
                projectId=self.project,
                status='completed',
                workName='종결보고 API 검증용 원검측',
                selfInspectionComplete=True,
                precheck={key:True for key in ['drawing','material','test','previous','change']},
                holdPoint=False,
                nextWorkAllowed=False,
                resultStatus='fail',
                failureReason='HTTP 어댑터 검증용 부적합',
                requirementRefs=[store.meta['requirementRef']],
                drawingRef=store.meta['drawingRef'],
                evidenceIds=[store.meta['evidenceId']],
                **scope,
            ))
            issue=store.engine.bootstrap('Issue',dict(
                id=issue_id,
                projectId=self.project,
                status='closed',
                subtype='NCR',
                title='종결보고 API 검증용 이슈',
                observationIds=[],
                actionIds=[],
                inspectionIds=[root['id']],
                correctionCycle=0,
                evidenceIds=[store.meta['evidenceId']],
                closureEvidenceIds=[store.meta['evidenceId']],
                closedBy=store.meta['actors']['SUP']['partyId'],
                **scope,
            ))
        return root,issue

    def owner_report_body(self):
        owner=self.app.state.store.meta['actors']['OWN']
        return {
            'roleAssignmentId':self.session['actor']['roleAssignmentId'],
            'reportObjectId':uid(),
            'title':'시정 및 재검측 종결 보고',
            'revision':'1',
            'type':'regular',
            'priority':'P2',
            'recipientIds':[owner['partyId']],
            'facts':'시정조치 및 재검측 완료',
            'cause':'시공 기준선 확인 누락',
            'impact':{'quality':'resolved','schedule':'closed'},
            'immediateActions':'재검측 합격 및 후속공정 진행',
            'recommendation':'본 건 종결 확인',
            'dueAt':'2026-10-20T09:00:00Z',
            'receiptDueAt':'2026-10-21T09:00:00Z',
        }

    def reinspection_body(self,root):
        return {
            'roleAssignmentId':self.session['actor']['roleAssignmentId'],
            'reinspectionObjectId':uid(),
            'workName':'벽체 치수 재검측',
            'requestedInspectionAt':'2026-10-21T09:00:00Z',
            'selfInspectionComplete':True,
            'precheck':root['precheck'],
            'evidenceIds':root['evidenceIds'],
        }

    def test_closeout_owner_report_http_is_draft_idempotent_and_visible_in_case(self):
        root,issue=self.bootstrap_closed_case()
        body=self.owner_report_body();key=uid()
        path=f'/projects/{self.project}/inspection-cases/{root["id"]}/issues/{issue["id"]}/owner-reports'
        response=self.client.post(
            path,
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(response.status_code,201,response.text)
        report=response.json()['report']
        self.assertEqual(report['status'],'draft')
        issue_ref=next(
            reference for reference in report['report']['sourceDomainRefs']
            if reference['objectType']=='Issue'
        )
        self.assertEqual(issue_ref['objectId'],issue['id'])
        self.assertEqual(issue_ref['version'],issue['version'])

        replay=self.client.post(
            path,
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(replay.status_code,201,replay.text)
        self.assertEqual(replay.json(),response.json())

        case=self.client.get(
            f'/projects/{self.project}/inspection-cases/{root["id"]}',
            headers=self.headers,
        )
        self.assertEqual(case.status_code,200,case.text)
        payload=case.json()
        group=next(item for item in payload['issues'] if item['issue']['record']['id']==issue['id'])
        self.assertEqual([item['record']['id'] for item in group['ownerReports']],[report['id']])
        self.assertEqual(group['readiness']['closeoutReportIds'],[report['id']])
        self.assertFalse(group['readiness']['ownerReportDraftReady'])
        self.assertTrue(group['readiness']['ownerReportIssuePending'])
        self.assertFalse(group['readiness']['ownerReceiptPending'])
        self.assertFalse(group['readiness']['ownerReceiptConfirmed'])
        self.assertFalse(group['readiness']['ownerReportingComplete'])
        self.assertIn(issue['id'],payload['readiness']['ownerReportingPendingIssueIds'])
        self.assertFalse(payload['readiness']['complete'])
        self.assertIn(report['id'],[item['record']['id'] for item in payload['ownerReports']])
        self.assertIn(report['id'],{event['objectRef']['objectId'] for event in payload['timeline']})

    def test_closeout_owner_report_requires_closed_issue_and_does_not_expand_contractor_authority(self):
        workspace=self.workspace()
        open_issue=next(x['record'] for x in workspace['items'] if x['machine']=='issue' and x['record']['status']=='in_progress')
        root_id=open_issue['inspectionIds'][0]
        body=self.owner_report_body()
        path=f'/projects/{self.project}/inspection-cases/{root_id}/issues/{open_issue["id"]}/owner-reports'
        response=self.client.post(
            path,
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )
        self.assertEqual(response.status_code,409,response.text)
        self.assertEqual(response.json()['code'],'ISSUE_NOT_CLOSED')
        self.assertEqual(
            self.client.get(
                f'/projects/{self.project}/owner-reports/{body["reportObjectId"]}',
                headers=self.headers,
            ).status_code,
            404,
        )

        root,closed_issue=self.bootstrap_closed_case()
        self.login('CON')
        body=self.owner_report_body()
        body['roleAssignmentId']=self.session['actor']['roleAssignmentId']
        response=self.client.post(
            f'/projects/{self.project}/inspection-cases/{root["id"]}/issues/{closed_issue["id"]}/owner-reports',
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )
        self.assertEqual(response.status_code,403,response.text)
        self.assertEqual(response.json()['code'],'NOT_AUTHORIZED')

    def test_reinspection_service_creates_requested_inspection_and_links_issue(self):
        self.login('CON')
        workspace=self.workspace()
        issue=next(x['record'] for x in workspace['items'] if x['machine']=='issue' and x['record']['status']=='in_progress')
        action=next(x['record'] for x in workspace['items'] if x['machine']=='action' and x['record']['id'] in issue['actionIds'])
        root=next(x['record'] for x in workspace['items'] if x['machine']=='inspection' and x['record']['id']==issue['inspectionIds'][0])
        submitted=self.command(
            'actions',action,'submit',
            {'correction':'보수 완료','rootCause':'시공 치수 오차','preventiveAction':'재검측 및 체크리스트 강화'},
        )
        self.assertEqual(submitted.status_code,200,submitted.text)

        body=self.reinspection_body(root);key=uid()
        response=self.client.post(
            f'/projects/{self.project}/inspection-cases/{root["id"]}/issues/{issue["id"]}/reinspections',
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(response.status_code,201,response.text)
        result=response.json()
        self.assertEqual(result['reinspection']['status'],'requested')
        self.assertEqual(result['reinspection']['relatedIssueId'],issue['id'])
        self.assertEqual(result['reinspection']['previousInspectionId'],root['id'])
        self.assertEqual(result['issue']['status'],'ready_for_recheck')
        self.assertEqual(result['issue']['inspectionIds'],[root['id'],body['reinspectionObjectId']])

        replay=self.client.post(
            f'/projects/{self.project}/inspection-cases/{root["id"]}/issues/{issue["id"]}/reinspections',
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(replay.status_code,201,replay.text)
        self.assertEqual(replay.json(),result)

        changed=self.client.post(
            f'/projects/{self.project}/inspection-cases/{root["id"]}/issues/{issue["id"]}/reinspections',
            headers={**self.headers,'Idempotency-Key':key},
            json={**body,'workName':'같은 키로 변경된 재검측 작업'},
        )
        self.assertEqual(changed.status_code,409,changed.text)
        self.assertEqual(changed.json()['code'],'IDEMPOTENCY_CONFLICT')

        other=next(
            x['record'] for x in self.workspace()['items']
            if x['machine']=='inspection' and x['record']['id'] not in issue['inspectionIds']
        )
        other_parent=self.client.post(
            f'/projects/{self.project}/inspection-cases/{other["id"]}/issues/{issue["id"]}/reinspections',
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(other_parent.status_code,409,other_parent.text)
        self.assertEqual(other_parent.json()['code'],'IDEMPOTENCY_CONFLICT')

        missing_inspection=self.client.post(
            f'/projects/{self.project}/inspection-cases/{uid()}/issues/{issue["id"]}/reinspections',
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(missing_inspection.status_code,404,missing_inspection.text)
        self.assertEqual(missing_inspection.json()['code'],'OBJECT_NOT_FOUND')

        missing_issue=self.client.post(
            f'/projects/{self.project}/inspection-cases/{root["id"]}/issues/{uid()}/reinspections',
            headers={**self.headers,'Idempotency-Key':key},
            json=body,
        )
        self.assertEqual(missing_issue.status_code,404,missing_issue.text)
        self.assertEqual(missing_issue.json()['code'],'OBJECT_NOT_FOUND')

    def test_reinspection_service_rolls_back_when_corrective_action_not_submitted(self):
        self.login('CON')
        workspace=self.workspace()
        issue=next(x['record'] for x in workspace['items'] if x['machine']=='issue' and x['record']['status']=='in_progress')
        root=next(x['record'] for x in workspace['items'] if x['machine']=='inspection' and x['record']['id']==issue['inspectionIds'][0])
        body=self.reinspection_body(root)
        response=self.client.post(
            f'/projects/{self.project}/inspection-cases/{root["id"]}/issues/{issue["id"]}/reinspections',
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )
        self.assertEqual(response.status_code,409,response.text)
        self.assertEqual(response.json()['code'],'CORRECTIVE_ACTION_SUBMITTED')
        self.assertEqual(
            self.client.get(f'/projects/{self.project}/inspections/{body["reinspectionObjectId"]}',headers=self.headers).status_code,
            404,
        )
        current=self.client.get(f'/projects/{self.project}/issues/{issue["id"]}',headers=self.headers).json()
        self.assertEqual(current['status'],'in_progress')
        self.assertEqual(current['inspectionIds'],issue['inspectionIds'])

    def test_reinspection_service_does_not_expand_supervisor_authority(self):
        self.login('CON')
        workspace=self.workspace()
        issue=next(x['record'] for x in workspace['items'] if x['machine']=='issue' and x['record']['status']=='in_progress')
        action=next(x['record'] for x in workspace['items'] if x['machine']=='action' and x['record']['id'] in issue['actionIds'])
        root=next(x['record'] for x in workspace['items'] if x['machine']=='inspection' and x['record']['id']==issue['inspectionIds'][0])
        submitted=self.command(
            'actions',action,'submit',
            {'correction':'보수 완료','rootCause':'시공 치수 오차','preventiveAction':'재검측'},
        )
        self.assertEqual(submitted.status_code,200,submitted.text)

        self.login('SUP')
        body=self.reinspection_body(root)
        response=self.client.post(
            f'/projects/{self.project}/inspection-cases/{root["id"]}/issues/{issue["id"]}/reinspections',
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )
        self.assertEqual(response.status_code,403,response.text)
        self.assertEqual(response.json()['code'],'NOT_AUTHORIZED')
        self.assertEqual(
            self.client.get(f'/projects/{self.project}/inspections/{body["reinspectionObjectId"]}',headers=self.headers).status_code,
            404,
        )


if __name__=='__main__':unittest.main()
