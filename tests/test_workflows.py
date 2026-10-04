import unittest
from app.reference.engine import uid
from app.reference.validation import ContractError
from tests.fixtures import Fixture,AT,DUE


class Workflows(unittest.TestCase):
    def setUp(self):self.f=Fixture();self.e=self.f.engine
    def denies(self,code,fn):
        with self.assertRaises(ContractError) as raised:fn()
        self.assertEqual(raised.exception.code,code)
    def test_pass_without_ai_to_signed_acceptance_and_snapshot(self):
        r=self.f.inspect(self.f.inspection());self.assertFalse(r['nextWorkAllowed'])
        self.denies('ACCEPTANCE_SIGNED',lambda:self.f.command('inspection',r,'release_next_work'))
        doc=self.f.acceptance(r);finished=self.f.command('inspection',r,'release_next_work')
        self.assertEqual(finished['status'],'completed');self.assertTrue(finished['nextWorkAllowed'])
        self.assertEqual(doc['sourceDomainRefs'][0]['version'],r['version'])
        self.assertEqual(doc['sourcePayload']['data']['result']['status'],'pass')
        self.assertFalse(any(k=='AnalysisRun' for k,i in self.e._records))
    def test_failure_reinspection_fails_then_new_cycle_passes_and_closes(self):
        original=self.f.finish(self.f.inspect(self.f.inspection(),'fail'));issue=self.f.issue(original)
        action=self.f.action(relatedIssueId=issue['id']);action=self.f.complete_action(action)
        issue=self.f.command('issue',issue,'assign',dict(responsiblePartyId=self.f.actors['CON'][0],responsibleOrganizationId=self.f.organization,dueAt=DUE,actionIds=[action['id']]))
        issue=self.f.command('issue',issue,'start_correction',actor='CON')
        for result in ['fail','pass']:
            previous=issue['inspectionIds'][-1]
            new=self.f.inspection(relatedIssueId=issue['id'],previousInspectionId=previous,correctionCycle=issue['correctionCycle'])
            issue=self.f.command('issue',issue,'request_reinspection',dict(inspectionIds=issue['inspectionIds']+[new['id']]),actor='CON')
            issue=self.f.command('issue',issue,'start_reinspection')
            new=self.f.finish(self.f.inspect(new,result))
            if result=='fail':
                self.denies('REINSPECTION_PASSED',lambda:self.f.command('issue',issue,'close'))
                issue=self.f.command('issue',issue,'reject_reinspection')
                self.assertEqual(issue['correctionCycle'],1)
                issue=self.f.command('issue',issue,'restart_correction',actor='CON')
                next_action=self.f.complete_action(self.f.action(relatedIssueId=issue['id']))
                issue=self.f.command('issue',issue,'link_actions',{'actionIds':issue['actionIds']+[next_action['id']]})
            else:issue=self.f.command('issue',issue,'close')
        self.assertEqual(issue['status'],'closed');self.assertEqual(len(issue['inspectionIds']),3)
        self.assertFalse(self.e.get('Inspection',original['id'])['nextWorkAllowed'])
        doc=self.f.docs.render('FM-12',[self.f.ref('Issue',issue['id'])],self.f.form_data('FM-12'),*self.f.actors['SUP'],uid())
        self.assertEqual(doc['sourcePayload']['sources'][0]['record']['status'],'closed')
    def test_owner_report_action_receipt_verify_close(self):
        report=self.f.issue_report(self.f.report());self.assertIn('issuedAt',report['report'])
        self.denies('REPORT_FOLLOWUP_LINKED',lambda:self.f.command('report',self.f.command('report',report,'acknowledge',actor='OWN'),'dispatch'))
        action=self.f.complete_action(self.f.action(reportId=report['id']))
        report=self.f.command('report',report,'link_followup',dict(actionIds=[action['id']],decisionIds=[]))
        report=self.f.command('report',report,'dispatch');report=self.f.command('report',report,'verify');report=self.f.command('report',report,'close')
        self.assertEqual(report['status'],'closed');self.assertEqual(report['report']['acknowledgedBy'],self.f.actors['OWN'][0])
    def test_information_only_report_still_requires_receipt_and_verification(self):
        r=self.f.issue_report(self.f.report(True))
        self.denies('TRANSITION_INVALID',lambda:self.f.command('report',r,'verify'))
        for cmd,actor in [('acknowledge','OWN'),('dispatch','SUP'),('verify','SUP'),('close','SUP')]:r=self.f.command('report',r,cmd,actor=actor)
        self.assertEqual(r['status'],'closed')
    def test_approval_independence_hold_and_version(self):
        r=self.f.inspect(self.f.inspection(holdPoint=True));self.f.acceptance(r)
        self.denies('HOLD_APPROVAL_VALID',lambda:self.f.command('inspection',r,'release_next_work'))
        approval=self.f.create('approval',dict(targetRef=self.f.ref('Inspection',r['id']),requestedBy=self.f.actors['CON'][0],approvalKind='technical'),'CON')
        approval=self.f.command('approval',approval,'review');approval=self.f.command('approval',approval,'approve')
        r=self.f.command('inspection',r,'release_next_work');self.assertTrue(r['nextWorkAllowed'])
        self.assertNotEqual(approval['targetRef']['version'],r['version'])
    def test_self_approval_denied(self):
        r=self.f.inspection();a=self.f.create('approval',dict(targetRef=self.f.ref('Inspection',r['id']),requestedBy=self.f.actors['SUP'][0],approvalKind='technical'))
        a=self.f.command('approval',a,'review')
        self.denies('INDEPENDENT_APPROVER',lambda:self.f.command('approval',a,'approve'))
    def test_rfi_response_requires_separate_change_path(self):
        r=self.f.create('rfi',dict(title='기술질의',data={}),actor='CON')
        r=self.f.command('rfi',r,'submit',dict(question='치수 확인',references=[self.f.ref('InformationItem',self.f.drawing)],dueAt=DUE),'CON')
        r=self.f.command('rfi',r,'receive');r=self.f.command('rfi',r,'refer',dict(responsiblePartyId=self.f.actors['DES'][0]))
        r=self.f.command('rfi',r,'answer',dict(response='승인 도면 치수 적용',responseInformationRefs=[self.f.ref('InformationItem',self.f.drawing)],changeRequired=False),'DES')
        r=self.f.command('rfi',r,'review_response');r=self.f.command('rfi',r,'accept_response');r=self.f.command('rfi',r,'close')
        self.assertEqual(r['status'],'closed');self.assertFalse(any(k=='Approval' for k,i in self.e._records))
    def test_rfi_answer_marked_change_required_cannot_close_unrouted(self):
        r=self.f.create('rfi',dict(title='변경 필요 질의',data={'response':'변경 검토','responseInformationRefs':[self.f.ref('InformationItem',self.f.drawing)],'changeRequired':True}),'CON')
        for cmd,payload,actor in [('submit',{'question':'변경 필요','references':[]},'CON'),('receive',{},'SUP'),('refer',{'responsiblePartyId':self.f.actors['DES'][0]},'SUP'),('answer',{'response':'검토','responseInformationRefs':[self.f.ref('InformationItem',self.f.drawing)],'changeRequired':True},'DES'),('review_response',{},'SUP')]:r=self.f.command('rfi',r,cmd,payload,actor)
        self.denies('CHANGE_ROUTED_IF_REQUIRED',lambda:self.f.command('rfi',r,'accept_response'))
    def test_owner_decision_and_change_are_separate_versioned_records(self):
        report=self.f.issue_report(self.f.report());decision_id=uid()
        change=self.f.create('change',dict(title='치수 변경',data={}),'CON');change=self.f.command('change',change,'review_impact')
        change=self.f.command('change',change,'request_decision',dict(impact={k:'검토됨' for k in ['quality','schedule','cost','permit']},decisionId=decision_id))
        decision=self.f.create('decision',dict(title='변경 결정',targetRef=self.f.ref('WorkItem',change['id']),reportId=report['id'],options=[{'id':'A','description':'수정'}],impact={'quality':'개선'},recommendation='A',actionIds=[],dueAt=DUE),oid=decision_id)
        decision=self.f.command('decision',decision,'report');decision=self.f.command('decision',decision,'acknowledge',actor='OWN')
        decision=self.f.command('decision',decision,'decide',dict(decision='approved',selectedOption='A',decisionReason='설계 충족',decisionAt=AT),'OWN')
        change=self.f.command('change',change,'approve',actor='OWN')
        change=self.f.command('change',change,'issue_revision',dict(revisedInformationRef=self.f.ref('InformationItem',self.f.drawing)),'DES')
        change=self.f.command('change',change,'implement',actor='CON');change=self.f.command('change',change,'verify');change=self.f.command('change',change,'close')
        action=self.f.complete_action(self.f.action(decisionId=decision_id,reportId=report['id']))
        decision=self.f.command('decision',decision,'dispatch',dict(actionIds=[action['id']],notifiedAt=AT));decision=self.f.command('decision',decision,'verify');decision=self.f.command('decision',decision,'close')
        self.assertEqual(change['status'],'closed');self.assertEqual(decision['status'],'closed')

if __name__=='__main__':unittest.main()
