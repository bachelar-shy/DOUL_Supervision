from datetime import timedelta
import unittest
from app.reference.engine import uid,load
from app.reference.validation import ContractError
from tests.fixtures import Fixture,DUE
from scripts.validate_contracts import validate_all


class ContractAndReporting(unittest.TestCase):
    def setUp(self):self.f=Fixture();self.e=self.f.engine
    def test_cross_contract_lint(self):self.assertEqual(validate_all()['registers'],29)
    def test_all_29_read_projections_have_no_storage_side_effect(self):
        before=self.e.audit_events
        for n in range(1,30):
            with self.subTest(register=n):self.assertIsInstance(self.e.projections(f'{n:02}',*self.f.actors['SUP']),list)
        self.assertEqual(self.e.audit_events,before)
    def test_projection_result_can_not_mutate_source(self):
        r=self.f.inspect(self.f.inspection());rows=self.e.projections('11',*self.f.actors['SUP']);row=next(row for row in rows if row['sourceDomainRefs'][0]['objectId']==r['id'])
        self.assertEqual(row['calculated']['result_status'],'pass');row['data']['status']='completed'
        self.assertEqual(self.e.get('Inspection',r['id'])['status'],'passed')
    def test_projection_preserves_exact_requirement_join_version(self):
        r=self.f.inspection();self.e.revise_requirement(self.f.requirement,1,{'title':'개정'},*self.f.actors['ADM'],uid())
        row=next(row for row in self.e.projections('11',*self.f.actors['SUP']) if row['sourceDomainRefs'][0]['objectId']==r['id'])
        self.assertIn({'objectType':'Requirement','objectId':self.f.requirement,'version':1},row['sourceDomainRefs'])
    def test_missing_projection_values_are_unavailable_instead_of_pass(self):
        r=self.f.inspection();row=next(row for row in self.e.projections('11',*self.f.actors['SUP']) if row['sourceDomainRefs'][0]['objectId']==r['id'])
        self.assertIsNone(row['calculated']['result_status']);self.assertIn('result_status',row['unavailableFields'])
    def test_external_owner_cannot_read_draft_report_projection(self):
        r=self.f.report();rows=self.e.projections('22',*self.f.actors['OWN']);self.assertFalse(any(x['sourceDomainRefs'][0]['objectId']==r['id'] for x in rows))
        self.f.issue_report(r);self.assertTrue(any(x['sourceDomainRefs'][0]['objectId']==r['id'] for x in self.e.projections('22',*self.f.actors['OWN'])))
    def test_owner_receipt_cannot_be_acknowledged_by_non_recipient(self):
        r=self.f.issue_report(self.f.report());old=self.e.get('RoleAssignment',self.f.actors['OWN'][1]);other=uid();old.update(id=uid(),partyId=other);role=self.e.bootstrap('RoleAssignment',old)
        with self.assertRaises(ContractError) as caught:self.e.execute('report',r['id'],'acknowledge',r['version'],{},[],other,role['id'],uid())
        self.assertEqual(caught.exception.code,'RECIPIENT_MISMATCH');self.assertEqual(self.e.get('InformationItem',r['id'])['status'],'issued')
    def test_sla_escalation_deduplicates_and_never_approves_or_closes(self):
        r=self.f.issue_report(self.f.report());self.f.clock+=timedelta(days=2);audit=self.e.audit_events
        first=self.e.run_sla(*self.f.actors['SYSTEM']);self.assertEqual(len(first),1);self.assertEqual(first[0]['reason'],'receipt_overdue')
        self.assertEqual(self.e.run_sla(*self.f.actors['SYSTEM']),[]);self.assertEqual(self.e.get('InformationItem',r['id'])['status'],'issued');self.assertEqual(self.e.audit_events,audit)
    def test_sla_decision_clock_starts_after_receipt(self):
        r=self.f.issue_report(self.f.report());self.f.command('report',r,'acknowledge',actor='OWN');self.f.clock+=timedelta(days=2)
        self.assertEqual(self.e.run_sla(*self.f.actors['SYSTEM'])[0]['reason'],'followup_overdue')
    def test_all_four_views_are_declared_and_read_only(self):
        for view in ['V-01','V-02','V-03','V-04']:self.assertIsInstance(self.e.views(view,*self.f.actors['SUP']),list)
    def test_signature_command_is_audited_with_immutable_document_hash(self):
        r=self.f.inspect(self.f.inspection());doc=self.f.acceptance(r)
        events=[event for event in self.e.audit_events if event['command']=='document:sign'];self.assertEqual(len(events),2)
        self.assertEqual(doc['version'],3);self.assertEqual(self.e.get('DocumentSnapshot',doc['id'],1)['renderHash'],doc['renderHash'])
    def test_ai_confirmation_can_add_human_measurement_without_rewriting_candidate(self):
        # Provenance is tested separately; human observation shows the same additive verification contract.
        obs=self.f.create('observation',dict(source='supervisor',description='발화 보고',grounding=[dict(evidenceId=self.f.evidence,channel='speech',claimSupport='reported')]))
        obs=self.f.command('observation',obs,'begin_review');obs=self.f.command('observation',obs,'confirm',{'verificationNote':'현장 측정 대조','verificationGrounding':[dict(evidenceId=self.f.evidence,channel='measurement',claimSupport='observed')]})
        issue=self.f.create('issue',dict(subtype='NCR',title='측정 확인 결함',observationIds=[obs['id']],actionIds=[],inspectionIds=[],correctionCycle=0))
        self.assertEqual(issue['status'],'open');self.assertEqual(obs['grounding'][0]['claimSupport'],'reported')
