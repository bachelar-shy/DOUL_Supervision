"""Inspection case application-read-model tests."""
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from services.api.main import create_app
from app.reference.engine import uid


class InspectionCaseHTTPTests(unittest.TestCase):
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

    def command(self,collection,record,command,payload=None):
        return self.client.post(
            f'/projects/{self.project}/{collection}/{record["id"]}/{command}',
            headers={**self.headers,'Idempotency-Key':uid()},
            json={
                'roleAssignmentId':self.session['actor']['roleAssignmentId'],
                'expectedVersion':record['version'],
                'payload':payload or {},
                'evidenceIds':record.get('evidenceIds',[]),
            },
        )

    def test_case_follows_explicit_issue_action_and_observation_links(self):
        workspace=self.workspace()
        issue=next(x for x in workspace['items'] if x['machine']=='issue')['record']
        root_id=issue['inspectionIds'][0]
        response=self.client.get(
            f'/projects/{self.project}/inspection-cases/{root_id}',
            headers=self.headers,
        )
        self.assertEqual(response.status_code,200,response.text)
        case=response.json()
        self.assertEqual(case['caseId'],root_id)
        self.assertEqual(case['rootInspection']['record']['id'],root_id)
        self.assertEqual(len(case['issues']),1)
        group=case['issues'][0]
        self.assertEqual(group['issue']['record']['id'],issue['id'])
        self.assertEqual(
            [x['record']['id'] for x in group['correctiveActions']],
            issue['actionIds'],
        )
        self.assertEqual(
            [x['record']['id'] for x in group['observations']],
            issue['observationIds'],
        )
        self.assertEqual(
            [x['record']['id'] for x in group['inspections']],
            issue['inspectionIds'],
        )

    def test_case_exposes_server_preflight_not_client_business_rules(self):
        self.login('CON')
        workspace=self.workspace()
        issue=next(x for x in workspace['items'] if x['machine']=='issue')['record']
        root_id=issue['inspectionIds'][0]
        case=self.client.get(
            f'/projects/{self.project}/inspection-cases/{root_id}',
            headers=self.headers,
        ).json()
        issue_actions=case['issues'][0]['issue']['actions']
        request_reinspection=next(x for x in issue_actions if x['command']=='request_reinspection')
        self.assertFalse(request_reinspection['ready'])
        self.assertTrue(request_reinspection['requiresEvidence'])
        self.assertEqual(request_reinspection['blockedReason']['code'],'EVIDENCE_REQUIRED')

    def test_evidence_only_commands_are_input_requests_not_disabled_actions(self):
        workspace = self.workspace()
        evidence_only = [action for item in workspace['items'] for action in item['actions']
                         if action['requiresEvidence'] and not action['fields']]
        self.assertTrue(evidence_only)
        for action in evidence_only:
            self.assertTrue(action['requiresInput'], action)
            self.assertFalse(action['ready'], action)
            self.assertEqual(action['blockedReason']['code'], 'EVIDENCE_REQUIRED')

    def test_unlinked_inspection_has_no_issue_and_no_unrelated_timeline(self):
        workspace=self.workspace()
        linked={iid for x in workspace['items'] if x['machine']=='issue' for iid in x['record']['inspectionIds']}
        root=next(x['record'] for x in workspace['items'] if x['machine']=='inspection' and x['record']['id'] not in linked)
        case=self.client.get(
            f'/projects/{self.project}/inspection-cases/{root["id"]}',
            headers=self.headers,
        ).json()
        self.assertEqual(case['issues'],[])
        self.assertTrue(all(event['objectRef']['objectId']==root['id'] for event in case['timeline']))

    def test_reinspection_resolves_to_stable_original_case(self):
        self.login('CON')
        workspace=self.workspace()
        issue=next(x['record'] for x in workspace['items'] if x['machine']=='issue')
        action=next(x['record'] for x in workspace['items'] if x['machine']=='action' and x['record']['id'] in issue['actionIds'])
        root=next(x['record'] for x in workspace['items'] if x['machine']=='inspection' and x['record']['id']==issue['inspectionIds'][0])

        submitted=self.command(
            'actions',
            action,
            'submit',
            {'correction':'예시 보수 완료','rootCause':'시공 치수 오차','preventiveAction':'재검측 실시'},
        )
        self.assertEqual(submitted.status_code,200,submitted.text)

        reinspection_id=uid()
        payload={
            'packageId':root['packageId'],
            'locationId':root['locationId'],
            'discipline':root['discipline'],
            'responsibleOrganizationId':root['responsibleOrganizationId'],
            'minimumQualificationRank':root['minimumQualificationRank'],
            'workName':'벽체 치수 재검측 · 예시',
            'selfInspectionComplete':True,
            'precheck':root['precheck'],
            'holdPoint':False,
            'nextWorkAllowed':False,
            'requirementRefs':root['requirementRefs'],
            'drawingRef':root['drawingRef'],
            'evidenceIds':root['evidenceIds'],
            'relatedIssueId':issue['id'],
            'previousInspectionId':root['id'],
            'correctionCycle':issue['correctionCycle'],
        }
        created=self.client.post(
            f'/projects/{self.project}/inspections',
            headers={**self.headers,'Idempotency-Key':uid()},
            json={
                'roleAssignmentId':self.session['actor']['roleAssignmentId'],
                'clientObjectId':reinspection_id,
                'payload':payload,
            },
        )
        self.assertEqual(created.status_code,201,created.text)

        linked=self.command(
            'issues',
            issue,
            'request-reinspection',
            {'inspectionIds':issue['inspectionIds']+[reinspection_id]},
        )
        self.assertEqual(linked.status_code,200,linked.text)

        response=self.client.get(
            f'/projects/{self.project}/inspection-cases/{reinspection_id}',
            headers=self.headers,
        )
        self.assertEqual(response.status_code,200,response.text)
        case=response.json()
        self.assertEqual(case['caseId'],root['id'])
        self.assertEqual(case['requestedInspectionId'],reinspection_id)
        self.assertEqual(case['rootInspection']['record']['id'],root['id'])
        self.assertEqual(
            [x['record']['id'] for x in case['issues'][0]['inspections']],
            [root['id'],reinspection_id],
        )

    def test_case_requires_existing_same_project_inspection(self):
        response=self.client.get(
            f'/projects/{self.project}/inspection-cases/{uid()}',
            headers=self.headers,
        )
        self.assertEqual(response.status_code,404,response.text)


if __name__=='__main__':unittest.main()
