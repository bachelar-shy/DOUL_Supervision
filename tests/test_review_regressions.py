"""Public command paths for the seven Context7 review findings."""
from copy import deepcopy
import unittest

from app.reference.engine import uid
from app.reference.validation import ContractError, validate
from scripts.generate_api import generate
from tests.fixtures import Fixture, AT, DUE, BEFORE, AFTER


class ReviewRegressions(unittest.TestCase):
    def setUp(self):
        self.f=Fixture();self.e=self.f.engine;self.docs=self.f.docs

    def denies(self,code,fn):
        with self.assertRaises(ContractError) as caught:fn()
        self.assertEqual(caught.exception.code,code)

    def sign(self,doc,actor,role):
        return self.docs.sign(doc['id'],*actor,role,'approved_e_signature',dict(verified=True,partyId=actor[0],documentHash=doc['renderHash']),uid())

    def other_contractor(self):
        party,role_id,q,organization=uid(),uid(),uid(),uid()
        self.e.bootstrap('Party',dict(id=party,projectId=self.f.project,kind='PERSON',name='Other contractor',organizationId=organization,loginEnabled=True))
        self.e.bootstrap('Qualification',dict(id=q,projectId=self.f.project,partyId=party,number='Other-CON',rank=1,disciplines=['architecture'],validFrom=BEFORE,validTo=AFTER,verified=True,revoked=False))
        role=self.e.get('RoleAssignment',self.f.actors['CON'][1])
        role.update(id=role_id,partyId=party,organizationId=organization,qualificationIds=[q])
        self.e.bootstrap('RoleAssignment',role)
        return party,role_id

    def test_other_contractor_cannot_fulfill_acceptance_signature(self):
        r=self.f.inspect(self.f.inspection())
        doc=self.docs.render('FM-09',[self.f.ref('Inspection',r['id'])],self.f.form_data('FM-09'),*self.f.actors['SUP'],uid())
        self.sign(doc,self.f.actors['SUP'],'owner_side_supervisor')
        other=self.other_contractor()
        self.denies('ORGANIZATION_MISMATCH',lambda:self.sign(doc,other,'contractor_technical_lead'))
        self.assertEqual(self.docs.get(doc['id'])['status'],'final')
        self.denies('ACCEPTANCE_SIGNED',lambda:self.f.command('inspection',r,'release_next_work'))
        self.sign(doc,self.f.actors['CON'],'contractor_technical_lead')
        self.assertTrue(self.f.command('inspection',r,'release_next_work')['nextWorkAllowed'])

    def test_acceptance_rejects_two_inspection_subjects(self):
        a=self.f.inspect(self.f.inspection());b=self.f.inspect(self.f.inspection(workName='Other work'))
        refs=[self.f.ref('Inspection',r['id']) for r in [a,b]]
        self.denies('FORM_SUBJECT_INVALID',lambda:self.docs.render('FM-09',refs,self.f.form_data('FM-09'),*self.f.actors['SUP'],uid()))
        self.denies('ACCEPTANCE_SIGNED',lambda:self.f.command('inspection',b,'release_next_work'))

    def test_ancillary_source_order_does_not_change_signature_subject(self):
        r=self.f.inspect(self.f.inspection())
        # Readable ancillary evidence must not become the qualification subject.
        req=self.e.get('Requirement',self.f.requirement);req['minimumQualificationRank']=1
        self.e._save('Requirement',req)
        con_role=self.e.get('RoleAssignment',self.f.actors['CON'][1])
        q=self.e.get('Qualification',con_role['qualificationIds'][0]);q['rank']=2;self.e._save('Qualification',q)
        subject=self.f.ref('Inspection',r['id'])
        doc=self.docs.render('FM-09',[self.f.ref('Requirement',req['id']),subject],self.f.form_data('FM-09'),*self.f.actors['SUP'],uid())
        self.assertEqual(doc['primarySourceRef'],subject)
        self.assertEqual(doc['sourcePayload']['data']['inspection']['no'],r['id'])
        self.sign(doc,self.f.actors['SUP'],'owner_side_supervisor');self.sign(doc,self.f.actors['CON'],'contractor_technical_lead')
        self.assertTrue(self.f.command('inspection',r,'release_next_work')['nextWorkAllowed'])

    def test_signed_acceptance_does_not_release_an_ancillary_inspection(self):
        a=self.f.inspect(self.f.inspection());b=self.f.inspect(self.f.inspection())
        doc=self.f.acceptance(a)
        # Simulate a legacy imported ambiguous envelope, bypassing the renderer.
        doc['sourceDomainRefs'].append(self.f.ref('Inspection',b['id']))
        self.e.documents[doc['id']]=doc
        self.denies('ACCEPTANCE_SIGNED',lambda:self.f.command('inspection',b,'release_next_work'))
        self.denies('ACCEPTANCE_VERSION_MISMATCH',lambda:self.f.command('inspection',a,'release_next_work'))

    def test_report_form_binds_report_instead_of_first_information_item(self):
        r=self.f.report()
        doc=self.docs.render('FM-20',[self.f.ref('InformationItem',self.f.drawing),self.f.ref('InformationItem',r['id'])],self.f.form_data('FM-20'),*self.f.actors['SUP'],uid())
        self.assertEqual(doc['sourcePayload']['data']['urgent']['fact'],r['report']['facts'])
        self.assertEqual(doc['primarySourceRef']['objectId'],r['id'])

    def test_draft_report_hidden_through_register_and_view_snapshots(self):
        r=self.f.report()
        doc=self.docs.render('FM-20',[self.f.ref('InformationItem',r['id'])],self.f.form_data('FM-20'),*self.f.actors['SUP'],uid())
        for actor in ['OWN','CON','DES']:
            for register in ['11','22']:
                rows=self.e.projections(register,*self.f.actors[actor])
                self.assertFalse(any(x['data']['id'] in [doc['id'],r['id']] for x in rows))
            self.assertFalse(any(x['data']['id']==doc['id'] for x in self.e.views('V-01',*self.f.actors[actor])))
        self.assertTrue(any(x['data']['id']==doc['id'] for x in self.e.projections('11',*self.f.actors['SUP'])))

    def test_external_renderer_cannot_read_draft_or_review_report(self):
        r=self.f.report()
        for status in ['draft','review']:
            if status=='review':r=self.f.command('report',r,'submit')
            for actor in ['OWN','CON','DES']:
                self.denies('NOT_FOUND',lambda:self.docs.render('FM-20',[self.f.ref('InformationItem',r['id'])],self.f.form_data('FM-20'),*self.f.actors[actor],uid()))

    def test_issuing_report_does_not_publish_old_draft_snapshot(self):
        r=self.f.report();draft_ref=self.f.ref('InformationItem',r['id'])
        doc=self.docs.render('FM-20',[draft_ref],self.f.form_data('FM-20'),*self.f.actors['SUP'],uid())
        issued=self.f.issue_report(r)
        self.e.authorize_read(issued,*self.f.actors['OWN'])
        self.denies('NOT_FOUND',lambda:self.e.authorize_read(doc,*self.f.actors['OWN']))
        self.denies('NOT_FOUND',lambda:self.docs.render('FM-20',[draft_ref],self.f.form_data('FM-20'),*self.f.actors['OWN'],uid()))

    def returned_inspection(self):
        r=self.f.inspection(precheck={k:k!='material' for k in ['drawing','material','test','previous','change']})
        r=self.f.command('inspection',r,'request',dict(requestedAt=AT,requestedInspectionAt=DUE),'CON')
        r=self.f.command('inspection',r,'receive')
        self.denies('INSPECTION_PACKAGE_COMPLETE',lambda:self.f.command('inspection',r,'schedule',dict(scheduledAt=AT)))
        return self.f.command('inspection',r,'return',dict(reason='Missing material review'))

    def test_returned_inspection_can_correct_package_and_schedule(self):
        r=self.returned_inspection();old=deepcopy(r)
        r=self.f.command('inspection',r,'resubmit',dict(precheck={k:True for k in r['precheck']},selfInspectionComplete=True,requestedAt=AT,requestedInspectionAt=DUE),'CON')
        self.assertEqual(r['version'],old['version']+1)
        self.assertFalse(self.e.get('Inspection',r['id'],old['version'])['precheck']['material'])
        r=self.f.command('inspection',r,'receive');r=self.f.command('inspection',r,'schedule',dict(scheduledAt=AT))
        self.assertEqual(r['status'],'scheduled');self.assertFalse(r['nextWorkAllowed'])

    def test_resubmit_cannot_change_scope_or_acceptance_result(self):
        r=self.returned_inspection()
        for fields in [dict(resultStatus='pass'),dict(nextWorkAllowed=True),dict(responsibleOrganizationId=uid()),dict(holdPoint=False)]:
            self.denies('COMMAND_FIELD_INVALID',lambda:self.f.command('inspection',r,'resubmit',fields,'CON'))

    def test_stale_requested_package_can_be_returned_and_rebased(self):
        r=self.f.inspection();r=self.f.command('inspection',r,'request',dict(requestedAt=AT,requestedInspectionAt=DUE),'CON')
        self.e.revise_requirement(self.f.requirement,1,dict(title='Updated baseline'),*self.f.actors['ADM'],uid())
        drawing=self.e.get('InformationItem',self.f.drawing);drawing.update(version=2,revision='B');self.e._save('InformationItem',drawing)
        r=self.f.command('inspection',r,'receive')
        self.denies('REQUIREMENT_STALE',lambda:self.f.command('inspection',r,'schedule',dict(scheduledAt=AT)))
        r=self.f.command('inspection',r,'return',dict(reason='Update package revisions'))
        r=self.f.command('inspection',r,'resubmit',dict(requirementRefs=[self.f.ref('Requirement',self.f.requirement)],drawingRef=self.f.ref('InformationItem',self.f.drawing)),'CON')
        r=self.f.command('inspection',r,'receive');r=self.f.command('inspection',r,'schedule',dict(scheduledAt=AT))
        self.assertEqual(r['status'],'scheduled');self.assertEqual(r['drawingRef']['version'],2)

    def direct_issue(self):
        obs=self.f.observation()
        return self.f.create('issue',dict(subtype='NCR',title='Direct observation',observationIds=[obs['id']],actionIds=[],inspectionIds=[],correctionCycle=0))

    def test_observation_issue_first_verification_can_close(self):
        issue=self.direct_issue();a=self.f.complete_action(self.f.action(relatedIssueId=issue['id']))
        issue=self.f.command('issue',issue,'assign',dict(responsiblePartyId=self.f.actors['CON'][0],responsibleOrganizationId=self.f.organization,dueAt=DUE,actionIds=[a['id']]))
        issue=self.f.command('issue',issue,'start_correction',actor='CON')
        inspection=self.f.inspection(relatedIssueId=issue['id'],correctionCycle=0)
        self.assertNotIn('previousInspectionId',inspection)
        issue=self.f.command('issue',issue,'request_reinspection',dict(inspectionIds=[inspection['id']]),'CON')
        issue=self.f.command('issue',issue,'start_reinspection')
        self.f.finish(self.f.inspect(inspection))
        self.assertEqual(self.f.command('issue',issue,'close',{'closureEvidenceIds':[self.f.evidence]})['status'],'closed')

    def test_issue_close_requires_explicit_current_cycle_closure_evidence(self):
        issue=self.direct_issue()
        closure_evidence=uid();self.f.evidence_record(closure_evidence)
        action=self.f.action(relatedIssueId=issue['id'],evidenceIds=[closure_evidence])
        action=self.f.command('action',action,'assign',dict(responsiblePartyId=self.f.actors['CON'][0],responsibleOrganizationId=self.f.organization,dueAt=DUE),evidence=[closure_evidence])
        action=self.f.command('action',action,'start',actor='CON',evidence=[closure_evidence])
        action=self.f.command('action',action,'submit',dict(correction='치수 보완',rootCause='기준선 미확인',preventiveAction='선행 확인'),actor='CON',evidence=[closure_evidence])
        action=self.f.command('action',action,'verify',evidence=[closure_evidence])
        action=self.f.command('action',action,'close',evidence=[closure_evidence])
        issue=self.f.command('issue',issue,'assign',dict(responsiblePartyId=self.f.actors['CON'][0],responsibleOrganizationId=self.f.organization,dueAt=DUE,actionIds=[action['id']]),evidence=[])
        issue=self.f.command('issue',issue,'start_correction',actor='CON',evidence=[])
        inspection=self.f.inspection(relatedIssueId=issue['id'],correctionCycle=0,evidenceIds=[closure_evidence])
        issue=self.f.command('issue',issue,'request_reinspection',dict(inspectionIds=[inspection['id']]),'CON',evidence=[closure_evidence])
        issue=self.f.command('issue',issue,'start_reinspection',evidence=[])
        inspection=self.f.command('inspection',inspection,'request',dict(requestedAt=AT,requestedInspectionAt=DUE),'CON',evidence=[closure_evidence])
        inspection=self.f.command('inspection',inspection,'receive',dict(receivedAt=AT),evidence=[closure_evidence])
        inspection=self.f.command('inspection',inspection,'schedule',dict(scheduledAt=AT),evidence=[closure_evidence])
        inspection=self.f.command('inspection',inspection,'start',evidence=[closure_evidence])
        inspection=self.f.command('inspection',inspection,'submit_results',dict(checkResults=[dict(itemId='dimension',requirementRef=self.f.ref('Requirement',self.f.requirement),result='pass',evidenceIds=[closure_evidence],measuredValue=120,unit='mm')]),evidence=[closure_evidence])
        inspection=self.f.command('inspection',inspection,'pass',evidence=[closure_evidence])
        self.f.acceptance(inspection)
        inspection=self.f.command('inspection',inspection,'release_next_work',evidence=[closure_evidence])
        self.denies('COMMAND_FIELD_REQUIRED',lambda:self.f.command('issue',issue,'close',evidence=[]))
        self.denies('CLOSURE_ACTION_EVIDENCE_REQUIRED',lambda:self.f.command('issue',issue,'close',{'closureEvidenceIds':[self.f.evidence]},evidence=[]))
        closed=self.f.command('issue',issue,'close',{'closureEvidenceIds':[closure_evidence]},evidence=[closure_evidence])
        self.assertEqual(closed['status'],'closed')
        self.assertEqual(closed['closureEvidenceIds'],[closure_evidence])

    def test_first_verification_rejects_invented_predecessor_cycle_and_scope(self):
        issue=self.direct_issue()
        for fields in [dict(previousInspectionId=uid()),dict(correctionCycle=1),dict(locationId=uid())]:
            # Widen role scope so the issue-link guard, not assignment scope, is tested.
            role=self.e.get('RoleAssignment',self.f.actors['CON'][1]);role['locationIds']=['*'];self.e._save('RoleAssignment',role)
            self.denies('REINSPECTION_CYCLE_INVALID',lambda:self.f.inspection(**(dict(relatedIssueId=issue['id'],correctionCycle=0)|fields)))

    def photo_run(self):
        second=uid();self.f.evidence_record(second)
        r=self.f.create('analysis_run',dict(sourceEvidenceIds=[self.f.evidence,second],mode='photo',model={'provider':'fixture','name':'fixture','version':'1'},promptVersion='1',policyVersion='1',languages=['vi']))
        r=self.f.command('analysis_run',r,'start',actor='SYSTEM')
        candidate=dict(kind='candidate',sourceEvidenceId=self.f.evidence,analysisRunId=r['id'],description='First photo',confidence=.8,reviewFlags=[],grounding=[dict(evidenceId=self.f.evidence,channel='visual',claimSupport='observed')])
        clean=dict(kind='photo_result',sourceEvidenceId=second,analysisRunId=r['id'],modelVersion='1',outcome='no_findings',summary='No finding detected in original photo')
        coverage={'sources':[dict(sourceEvidenceId=eid,analyzedRanges=[],missingRanges=[],audioProcessedRanges=[],complete=True) for eid in r['sourceEvidenceIds']]}
        return r,candidate,clean,coverage

    def test_photo_coverage_cannot_borrow_another_source_output(self):
        r,candidate,clean,coverage=self.photo_run()
        self.denies('COVERAGE_OVERCLAIM',lambda:self.f.command('analysis_run',r,'complete',dict(outputs=[candidate],coverage=coverage,completedAt=AT),'SYSTEM'))
        self.assertEqual(self.e.get('AnalysisRun',r['id'])['status'],'running')

    def test_photo_without_findings_completes_with_explicit_source_result(self):
        r,candidate,clean,coverage=self.photo_run()
        done=self.f.command('analysis_run',r,'complete',dict(outputs=[candidate,clean],coverage=coverage,completedAt=AT),'SYSTEM')
        self.assertEqual(done['status'],'succeeded');self.assertEqual(done['outputs'][1]['outcome'],'no_findings')

    def test_photo_result_requires_exact_model_and_own_grounding(self):
        r,candidate,clean,coverage=self.photo_run()
        bad={**clean,'modelVersion':'other'}
        self.denies('PHOTO_RESULT_INVALID',lambda:self.f.command('analysis_run',r,'complete',dict(outputs=[candidate,bad],coverage=coverage,completedAt=AT),'SYSTEM'))
        bad={**candidate,'sourceEvidenceId':clean['sourceEvidenceId']}
        self.denies('ANALYSIS_SOURCE_MISMATCH',lambda:self.f.command('analysis_run',r,'complete',dict(outputs=[bad,clean],coverage=coverage,completedAt=AT),'SYSTEM'))

    def test_photo_cannot_report_no_findings_alongside_a_candidate(self):
        r,candidate,clean,coverage=self.photo_run()
        second={**candidate,'sourceEvidenceId':clean['sourceEvidenceId'],'grounding':[dict(evidenceId=clean['sourceEvidenceId'],channel='visual',claimSupport='observed')]}
        self.denies('PHOTO_RESULT_INVALID',lambda:self.f.command('analysis_run',r,'complete',dict(outputs=[candidate,second,clean],coverage=coverage,completedAt=AT),'SYSTEM'))

    def test_empty_rfi_submit_rejected_by_engine_and_generated_schema(self):
        r=self.f.create('rfi',dict(title='Empty RFI',data={}),'CON');api=generate();schemas=api['components']['schemas']
        request=dict(expectedVersion=1,roleAssignmentId=self.f.actors['CON'][1],payload={},evidenceIds=[])
        self.denies('SCHEMA_INVALID',lambda:validate(request,schemas['Command_rfi_submit'],schemas))
        self.denies('COMMAND_FIELD_REQUIRED',lambda:self.f.command('rfi',r,'submit',{},'CON',evidence=[]))
        self.assertEqual(self.e.get('WorkItem',r['id'])['status'],'draft')

    def test_rfi_submission_rejects_blank_question_and_missing_reference(self):
        r=self.f.create('rfi',dict(title='RFI',data={}),'CON')
        complete=dict(question='Question',references=[self.f.ref('InformationItem',self.f.drawing)],dueAt=DUE)
        for changes in [dict(question=' \n '),dict(references=[]),dict(dueAt='invalid')]:
            with self.assertRaises(ContractError):self.f.command('rfi',r,'submit',complete|changes,'CON')
        bad={**complete,'references':[dict(objectType='InformationItem',objectId=uid(),version=1)]}
        self.denies('OBJECT_NOT_FOUND',lambda:self.f.command('rfi',r,'submit',bad,'CON'))

    def test_rfi_return_and_resubmit_preserve_complete_package(self):
        r=self.f.create('rfi',dict(title='RFI',data={}),'CON')
        payload=dict(question='Question',references=[self.f.ref('InformationItem',self.f.drawing)],dueAt=DUE)
        r=self.f.command('rfi',r,'submit',payload,'CON');r=self.f.command('rfi',r,'receive')
        r=self.f.command('rfi',r,'return',dict(reason='Clarify question'))
        self.denies('COMMAND_FIELD_REQUIRED',lambda:self.f.command('rfi',r,'resubmit',dict(question='Clarified'),'CON'))
        r=self.f.command('rfi',r,'resubmit',payload|dict(question='Clarified'),'CON')
        self.assertEqual(r['status'],'submitted');self.assertEqual(r['data']['question'],'Clarified');self.assertEqual(r['dueAt'],DUE)


if __name__=='__main__':unittest.main()
