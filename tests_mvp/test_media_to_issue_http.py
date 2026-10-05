"""End-to-end Media Analysis -> Human Review -> Inspection Case -> Issue tests."""
import base64
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


PNG=base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
)


class MediaToIssueHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=str(Path(self.temp.name)/'state.db')
        self.app=create_app(self.path,demo=True)
        self.client=TestClient(self.app)
        self.login('SUP')

    def tearDown(self):
        self.client.close();self.app.state.store.close();self.temp.cleanup()

    def login(self,actor_group):
        response=self.client.post('/dev/sessions',json={'actorGroup':actor_group})
        self.assertEqual(response.status_code,200,response.text)
        self.session=response.json();self.project=self.session['projectId']
        self.role=self.session['actor']['roleAssignmentId']
        self.headers={
            'Authorization':'Bearer '+self.session['accessToken'],
            'X-RoleAssignment-Id':self.role,
        }

    def workspace(self):
        response=self.client.get(f'/projects/{self.project}/workspace',headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def scheduled_inspection(self):
        return next(
            item['record'] for item in self.workspace()['items']
            if item['machine']=='inspection' and item['record']['status']=='scheduled'
        )

    def command(self,collection,record,command,payload=None,evidence_ids=None):
        return self.client.post(
            f'/projects/{self.project}/{collection}/{record["id"]}/{command}',
            headers={**self.headers,'Idempotency-Key':uid()},
            json={
                'roleAssignmentId':self.role,
                'expectedVersion':record['version'],
                'payload':payload or {},
                'evidenceIds':evidence_ids if evidence_ids is not None else record.get('evidenceIds',[]),
            },
        )

    def fail_inspection(self,inspection):
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
        failed=self.command(
            'inspections',
            pending.json()['record'],
            'fail',
            {'failureReason':'미디어 검토와 현장 검측에서 부적합 확인'},
        )
        self.assertEqual(failed.status_code,200,failed.text)
        return failed.json()['record']

    def upload_photo(self):
        scope=self.workspace()['context']['scope'];capture=uid()
        body={
            'roleAssignmentId':self.role,
            'captureId':capture,
            'fileName':'media-to-issue.png',
            'mimeType':'image/png',
            'byteCount':len(PNG),
            'expectedHash':sha256(PNG).hexdigest(),
            'sourcePartyId':self.session['actor']['partyId'],
            'mediaType':'photo',
            'discipline':scope['discipline'],
            'packageId':scope['packageId'],
            'locationId':scope['locationId'],
        }
        started=self.client.post(
            f'/projects/{self.project}/uploads',
            headers={**self.headers,'Idempotency-Key':capture},
            json=body,
        )
        self.assertEqual(started.status_code,201,started.text)
        upload=started.json()
        chunk=self.client.put(
            f'/projects/{self.project}/uploads/{upload["id"]}/chunks',
            headers={
                **self.headers,
                'Idempotency-Key':uid(),
                'Upload-Offset':'0',
                'Content-Type':'application/octet-stream',
            },
            content=PNG,
        )
        self.assertEqual(chunk.status_code,200,chunk.text)
        completed=self.client.post(
            f'/projects/{self.project}/uploads/{upload["id"]}/complete',
            headers={**self.headers,'Idempotency-Key':'complete-'+capture},
            json={'roleAssignmentId':self.role,'expectedHash':sha256(PNG).hexdigest()},
        )
        self.assertEqual(completed.status_code,201,completed.text)
        return completed.json()

    def queue_photo_run(self,photo,inspection_id=None,retry_of_id=None):
        body={
            'roleAssignmentId':self.role,
            'clientObjectId':uid(),
            'sourceEvidenceIds':[photo['id']],
            'mode':'photo',
            'languages':['ko','vi'],
        }
        if inspection_id:body['inspectionId']=inspection_id
        if retry_of_id:body['retryOfId']=retry_of_id
        response=self.client.post(
            f'/projects/{self.project}/media-analysis-runs',
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )
        self.assertEqual(response.status_code,201,response.text)
        return response.json()

    def worker(self,suffix,body):
        return self.client.post(
            f'/dev/media-worker/projects/{self.project}{suffix}',
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )

    def complete_visual_candidate(self,run,photo,description='벽체 표면 결함 후보',claim_support='observed'):
        self.login('ADM')
        started=self.worker(f'/runs/{run["id"]}/start',{})
        self.assertEqual(started.status_code,200,started.text)
        candidate={
            'kind':'candidate',
            'sourceEvidenceId':photo['id'],
            'analysisRunId':run['id'],
            'description':description,
            'confidence':0.82,
            'reviewFlags':['human_confirmation_required'],
            'grounding':[{
                'evidenceId':photo['id'],
                'channel':'visual',
                'claimSupport':claim_support,
            }],
        }
        coverage={'sources':[{
            'sourceEvidenceId':photo['id'],
            'analyzedRanges':[],
            'missingRanges':[],
            'audioProcessedRanges':[],
            'complete':True,
        }]}
        complete=self.worker(
            f'/runs/{run["id"]}/complete',
            {
                'outputs':[candidate],
                'coverage':coverage,
                'completedAt':'2026-10-06T02:00:00Z',
            },
        )
        self.assertEqual(complete.status_code,200,complete.text)
        self.login('SUP')
        return complete.json()['candidates'][0]

    def confirm_candidate(self,candidate):
        begin=self.command('observations',candidate,'begin-review')
        self.assertEqual(begin.status_code,200,begin.text)
        confirmed=self.command(
            'observations',
            begin.json()['record'],
            'confirm',
            {'verificationNote':'원본 증빙과 현장 위치를 감리자가 확인함'},
        )
        self.assertEqual(confirmed.status_code,200,confirmed.text)
        return confirmed.json()['record']

    def issue_body(self,observation_id):
        contractor=next(x for x in self.workspace()['participants'] if x['actorGroup']=='CON')
        return {
            'roleAssignmentId':self.role,
            'issueObjectId':uid(),
            'actionObjectId':uid(),
            'observationIds':[observation_id],
            'subtype':'NCR',
            'title':'미디어 확인 부적합',
            'actionTitle':'미디어 확인사항 시정조치',
            'responsiblePartyId':contractor['partyId'],
            'dueAt':'2026-10-20T09:00:00Z',
        }

    def media_issue(self,run_id,body,key=None):
        return self.client.post(
            f'/projects/{self.project}/media-analysis-runs/{run_id}/issues',
            headers={**self.headers,'Idempotency-Key':key or uid()},
            json=body,
        )

    def review(self,run_id):
        return self.client.get(
            f'/projects/{self.project}/media-analysis-runs/{run_id}',
            headers=self.headers,
        )

    def test_explicit_inspection_context_reaches_issue_without_rebinding_version(self):
        inspection=self.scheduled_inspection();request_version=inspection['version']
        photo=self.upload_photo()
        run=self.queue_photo_run(photo,inspection['id'])
        self.assertEqual(
            run['inspectionRef'],
            {'objectType':'Inspection','objectId':inspection['id'],'version':request_version},
        )
        candidate=self.complete_visual_candidate(run,photo)

        review=self.review(run['id'])
        self.assertEqual(review.status_code,200,review.text)
        package=review.json()
        self.assertEqual(package['targetInspection']['record']['id'],inspection['id'])
        self.assertFalse(package['issueReadiness']['ready'])
        self.assertIn('INSPECTION_NOT_FAILED',package['issueReadiness']['blockedReasons'])
        self.assertIn('OBSERVATION_UNVERIFIED',package['issueReadiness']['blockedReasons'])

        confirmed=self.confirm_candidate(candidate)
        package=self.review(run['id']).json()
        self.assertEqual(package['issueReadiness']['confirmedObservationIds'],[confirmed['id']])
        self.assertEqual(package['issueReadiness']['blockedReasons'],['INSPECTION_NOT_FAILED'])

        premature_body=self.issue_body(confirmed['id'])
        premature=self.media_issue(run['id'],premature_body)
        self.assertEqual(premature.status_code,409,premature.text)
        self.assertEqual(premature.json()['code'],'INSPECTION_NOT_FAILED')
        self.assertEqual(
            self.client.get(
                f'/projects/{self.project}/issues/{premature_body["issueObjectId"]}',
                headers=self.headers,
            ).status_code,
            404,
        )

        failed=self.fail_inspection(inspection)
        package=self.review(run['id']).json()
        self.assertTrue(package['issueReadiness']['ready'])
        self.assertEqual(package['issueReadiness']['blockedReasons'],[])
        self.assertEqual(package['targetInspection']['record']['status'],'failed')
        self.assertGreater(package['targetInspection']['record']['version'],request_version)
        self.assertEqual(package['run']['record']['inspectionRef']['version'],request_version)

        body=self.issue_body(confirmed['id']);key=uid()
        issued=self.media_issue(run['id'],body,key)
        self.assertEqual(issued.status_code,201,issued.text)
        result=issued.json()
        self.assertEqual(result['issue']['inspectionIds'],[failed['id']])
        self.assertEqual(result['issue']['observationIds'],[confirmed['id']])
        self.assertEqual(result['issue']['status'],'assigned')
        self.assertEqual(result['correctiveAction']['status'],'assigned')

        replay=self.media_issue(run['id'],body,key)
        self.assertEqual(replay.status_code,201,replay.text)
        self.assertEqual(replay.json(),result)

        case=self.client.get(
            f'/projects/{self.project}/inspection-cases/{failed["id"]}',
            headers=self.headers,
        )
        self.assertEqual(case.status_code,200,case.text)
        linked=next(group for group in case.json()['issues'] if group['issue']['record']['id']==result['issue']['id'])
        self.assertEqual(linked['observations'][0]['record']['id'],confirmed['id'])
        self.assertEqual(linked['correctiveActions'][0]['record']['id'],result['correctiveAction']['id'])

    def test_media_issue_requires_explicit_link_and_rejects_candidate_from_other_run(self):
        inspection=self.scheduled_inspection()
        photo1=self.upload_photo();run1=self.queue_photo_run(photo1,inspection['id'])
        candidate1=self.confirm_candidate(self.complete_visual_candidate(run1,photo1,'Run 1 후보'))

        photo2=self.upload_photo();run2=self.queue_photo_run(photo2,inspection['id'])
        candidate2=self.confirm_candidate(self.complete_visual_candidate(run2,photo2,'Run 2 후보'))

        cross=self.media_issue(run1['id'],self.issue_body(candidate2['id']))
        self.assertEqual(cross.status_code,409,cross.text)
        self.assertEqual(cross.json()['code'],'ANALYSIS_CANDIDATE_MISMATCH')

        photo3=self.upload_photo();unlinked=self.queue_photo_run(photo3)
        candidate3=self.confirm_candidate(self.complete_visual_candidate(unlinked,photo3,'미연결 후보'))
        unlinked_issue=self.media_issue(unlinked['id'],self.issue_body(candidate3['id']))
        self.assertEqual(unlinked_issue.status_code,409,unlinked_issue.text)
        self.assertEqual(unlinked_issue.json()['code'],'INSPECTION_LINK_REQUIRED')

        # The correctly linked candidate remains untouched by failed attempts.
        self.assertEqual(
            self.client.get(
                f'/projects/{self.project}/observations/{candidate1["id"]}',
                headers=self.headers,
            ).json()['status'],
            'confirmed',
        )


    def test_issue_readiness_does_not_treat_inferred_confirmation_as_publishable(self):
        inspection=self.fail_inspection(self.scheduled_inspection())
        photo=self.upload_photo();run=self.queue_photo_run(photo,inspection['id'])
        candidate=self.complete_visual_candidate(run,photo,'추정 기반 후보','inferred')
        confirmed=self.confirm_candidate(candidate)

        review=self.review(run['id'])
        self.assertEqual(review.status_code,200,review.text)
        readiness=review.json()['issueReadiness']
        self.assertFalse(readiness['ready'])
        self.assertEqual(readiness['confirmedObservationIds'],[confirmed['id']])
        self.assertEqual(readiness['issueEligibleObservationIds'],[])
        self.assertIn('CLAIM_UNCORROBORATED',readiness['blockedReasons'])

        issue=self.media_issue(run['id'],self.issue_body(confirmed['id']))
        self.assertEqual(issue.status_code,409,issue.text)
        self.assertEqual(issue.json()['code'],'CLAIM_UNCORROBORATED')

    def test_retry_preserves_request_time_inspection_reference(self):
        inspection=self.scheduled_inspection();photo=self.upload_photo()
        run=self.queue_photo_run(photo,inspection['id'])
        original_ref=run['inspectionRef']

        self.login('ADM')
        started=self.worker(f'/runs/{run["id"]}/start',{})
        self.assertEqual(started.status_code,200,started.text)
        failed=self.worker(f'/runs/{run["id"]}/fail',{'reason':'개발용 worker 실패'})
        self.assertEqual(failed.status_code,200,failed.text)

        self.login('SUP')
        retry=self.queue_photo_run(photo,retry_of_id=run['id'])
        self.assertEqual(retry['retryOfId'],run['id'])
        self.assertEqual(retry['inspectionRef'],original_ref)

        other=next(
            item['record'] for item in self.workspace()['items']
            if item['machine']=='inspection' and item['record']['id']!=inspection['id']
        )
        body={
            'roleAssignmentId':self.role,
            'clientObjectId':uid(),
            'sourceEvidenceIds':[photo['id']],
            'mode':'photo',
            'languages':['ko'],
            'inspectionId':other['id'],
            'retryOfId':run['id'],
        }
        rejected=self.client.post(
            f'/projects/{self.project}/media-analysis-runs',
            headers={**self.headers,'Idempotency-Key':uid()},
            json=body,
        )
        self.assertEqual(rejected.status_code,409,rejected.text)
        self.assertEqual(rejected.json()['code'],'RETRY_INVALID')


if __name__=='__main__':
    unittest.main()
