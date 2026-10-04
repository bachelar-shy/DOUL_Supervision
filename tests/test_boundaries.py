from copy import deepcopy
from datetime import timedelta
import hashlib
import unittest
from app.reference.engine import uid
from app.reference.validation import ContractError,validate
from tests.fixtures import Fixture,DUE


class Boundaries(unittest.TestCase):
    def setUp(self):self.f=Fixture();self.e=self.f.engine;self.subject=self.f.inspection()
    def denies(self,code,fn):
        before=deepcopy(self.e._records);audit=self.e.audit_events
        with self.assertRaises(ContractError) as error:fn()
        self.assertEqual(error.exception.code,code)
        self.assertEqual(self.e._records,before);self.assertEqual(self.e.audit_events,audit)
    def role(self,actor='SUP',**changes):
        original=self.e.get('RoleAssignment',self.f.actors[actor][1]);original.update(changes);original['id']=uid()
        return self.e.bootstrap('RoleAssignment',original)
    def authorize(self,role,record=None,party=None,authority='judge_inspection'):
        return self.e.authorize(record or self.subject,authority,party or role['partyId'],role['id'])
    def test_contractor_cannot_judge_inspection(self):
        r=self.f.inspect(self.f.inspection())
        self.denies('NOT_AUTHORIZED',lambda:self.f.command('inspection',r,'release_next_work',actor='CON'))
    def test_nonhuman_cannot_confirm_or_issue(self):
        obs=self.f.create('observation',dict(source='supervisor',description='관찰',grounding=[dict(evidenceId=self.f.evidence,channel='visual',claimSupport='observed')]))
        obs=self.f.command('observation',obs,'begin_review')
        for actor in ['AI','SYSTEM','INTEGRATION']:
            with self.subTest(actor=actor):self.denies('NOT_AUTHORIZED',lambda:self.f.command('observation',obs,'confirm',{'verificationNote':'해당 없음'},actor))
    def test_unconfirmed_candidate_cannot_be_official_issue(self):
        obs=self.f.create('observation',dict(source='supervisor',description='관찰',grounding=[dict(evidenceId=self.f.evidence,channel='visual',claimSupport='observed')]))
        self.denies('OBSERVATION_UNVERIFIED',lambda:self.f.create('issue',dict(subtype='NCR',title='후보',observationIds=[obs['id']],actionIds=[],inspectionIds=[],correctionCycle=0)))
    def test_expired_deployment_even_with_valid_qualification(self):
        r=self.role(validTo='2026-10-04T12:00:00Z');self.denies('ASSIGNMENT_EXPIRED',lambda:self.authorize(r))
    def test_future_deployment(self):
        r=self.role(validFrom='2026-10-05T00:00:00Z');self.denies('ASSIGNMENT_EXPIRED',lambda:self.authorize(r))
    def test_party_cannot_borrow_another_assignment(self):
        r=self.role();self.denies('NOT_AUTHORIZED',lambda:self.authorize(r,party=self.f.actors['CON'][0]))
    def test_wrong_discipline(self):
        r=self.role(disciplines=['electrical']);self.denies('SCOPE_MISMATCH',lambda:self.authorize(r))
    def test_wrong_package(self):
        r=self.role(packageIds=[uid()]);self.denies('SCOPE_MISMATCH',lambda:self.authorize(r))
    def test_wrong_location(self):
        r=self.role(locationIds=[uid()]);self.denies('SCOPE_MISMATCH',lambda:self.authorize(r))
    def test_wrong_project(self):
        r=self.role(projectId=uid());self.denies('PROJECT_MISMATCH',lambda:self.authorize(r))
    def test_actor_group_alone_does_not_authorize(self):
        r=self.role(authorityCodes=[]);self.denies('NOT_AUTHORIZED',lambda:self.authorize(r))
    def test_chief_duty_not_given_to_discipline_supervisor(self):
        r=self.role(roleCode='discipline_supervisor');self.denies('NOT_AUTHORIZED',lambda:self.authorize(r,authority='close_issue'))
    def qualification(self,**changes):
        q=self.e.get('Qualification',self.e.get('RoleAssignment',self.f.actors['SUP'][1])['qualificationIds'][0]);q.update(changes);q['id']=uid();return self.e.bootstrap('Qualification',q)
    def test_expired_qualification(self):
        q=self.qualification(validTo='2026-10-04T12:00:00Z');r=self.role(qualificationIds=[q['id']]);self.denies('QUALIFICATION_INVALID',lambda:self.authorize(r))
    def test_revoked_qualification(self):
        q=self.qualification(revoked=True);r=self.role(qualificationIds=[q['id']]);self.denies('QUALIFICATION_INVALID',lambda:self.authorize(r))
    def test_insufficient_qualification_rank(self):
        q=self.qualification(rank=3);r=self.role(qualificationIds=[q['id']]);record=self.f.inspection();record['minimumQualificationRank']=1
        self.denies('QUALIFICATION_INVALID',lambda:self.authorize(r,record))
    def test_unverified_qualification(self):
        q=self.qualification(verified=False);r=self.role(qualificationIds=[q['id']]);self.denies('QUALIFICATION_INVALID',lambda:self.authorize(r))
    def test_caller_cannot_weaken_trusted_project_qualification_rank(self):
        project=self.e.get('Project',self.f.project);project['qualificationRules']=[dict(discipline='architecture',minimumRank=1)];project['version']+=1;self.e._save('Project',project)
        q=self.qualification(rank=3);role=self.role(qualificationIds=[q['id']]);record=self.subject.copy();record['minimumQualificationRank']=3
        self.denies('QUALIFICATION_INVALID',lambda:self.authorize(role,record))
    def test_technical_approval_checks_actual_target_location(self):
        foreign=uid();self.e.bootstrap('Location',dict(id=foreign,projectId=self.f.project,name='배치 외 구역',semanticAnchor='outside'))
        target=self.subject.copy();target['id']=uid();target['locationId']=foreign;self.e.bootstrap('Inspection',target)
        approval=self.f.create('approval',dict(targetRef=self.f.ref('Inspection',target['id']),requestedBy=self.f.actors['CON'][0],approvalKind='technical'),'CON')
        approval=self.f.command('approval',approval,'review')
        self.denies('SCOPE_MISMATCH',lambda:self.f.command('approval',approval,'approve'))
    def test_contractor_organization(self):
        r=self.role('CON',organizationId=uid());self.denies('ORGANIZATION_MISMATCH',lambda:self.authorize(r,authority='submit_inspection_request'))
    def test_location_ancestor_scope(self):
        child=uid();self.e.bootstrap('Location',dict(id=child,projectId=self.f.project,parentId=self.f.location,name='하위 위치',semanticAnchor='child'))
        record=self.f.inspection(locationId=child);self.authorize(self.role(),record)
    def test_version_conflict_preserves_current_state(self):
        r=self.f.inspection();new=self.f.command('inspection',r,'request',dict(requestedAt=DUE,requestedInspectionAt=DUE),'CON')
        self.denies('VERSION_CONFLICT',lambda:self.e.execute('inspection',r['id'],'receive',r['version'],{},[],*self.f.actors['SUP'],uid()))
        self.assertEqual(self.e.get('Inspection',r['id']),new)
    def test_idempotent_replay_is_exact_without_duplicate_audit(self):
        r=self.f.inspection();key=uid();args=('inspection',r['id'],'request',r['version'],dict(requestedAt=DUE,requestedInspectionAt=DUE),[self.f.evidence],*self.f.actors['CON'],key)
        first=self.e.execute(*args);count=len(self.e.audit_events);self.assertEqual(first,self.e.execute(*args));self.assertEqual(len(self.e.audit_events),count)
    def test_reused_idempotency_key_with_changed_body(self):
        r=self.f.inspection();key=uid();self.f.command('inspection',r,'request',dict(requestedAt=DUE,requestedInspectionAt=DUE),'CON',key=key)
        self.denies('IDEMPOTENCY_CONFLICT',lambda:self.e.execute('inspection',r['id'],'request',r['version'],dict(requestedAt='2026-10-06T12:00:00Z'),[],*self.f.actors['CON'],key))
    def test_idempotent_replay_does_not_bypass_expired_role(self):
        r=self.f.inspection();key=uid();args=('inspection',r['id'],'request',r['version'],dict(requestedAt=DUE),[],*self.f.actors['CON'],key)
        self.e.execute(*args);self.f.clock+=timedelta(days=100)
        self.denies('ASSIGNMENT_EXPIRED',lambda:self.e.execute(*args))
    def test_caller_cannot_patch_raw_status_or_release_flag(self):
        r=self.f.inspection()
        self.denies('COMMAND_FIELD_INVALID',lambda:self.f.command('inspection',r,'request',{'status':'completed','nextWorkAllowed':True},'CON'))
        self.denies('IMMUTABLE_FIELD',lambda:self.f.inspection(nextWorkAllowed=True))
    def test_checksum_mismatch_rejected_without_save(self):
        payload=self.e.get('Evidence',self.f.evidence);payload={k:v for k,v in payload.items() if k not in ['id','projectId','version','createdAt','updatedAt','createdBy','submittedBy','uploadedAt']}
        self.denies('CHECKSUM_MISMATCH',lambda:self.e.add_evidence(uid(),self.f.project,payload,b'tampered',*self.f.actors['CON'],uid()))
    def test_evidence_cannot_be_overwritten(self):self.denies('EVIDENCE_IMMUTABLE',lambda:self.f.evidence_record(self.f.evidence))
    def test_cross_project_evidence(self):
        e=uid();self.e.bootstrap('Evidence',dict(id=e,projectId=uid(),sourceType='original',mediaType='photo',fileId=uid(),fileHash=hashlib.sha256(b'other').hexdigest(),sourcePartyId=self.f.actors['CON'][0],submittedBy=self.f.actors['CON'][0],uploadedAt=DUE,**self.f.scope()))
        self.denies('EVIDENCE_INVALID',lambda:self.f.inspection(evidenceIds=[e]))
    def test_stale_requirement_blocks_official_flow_and_preserves_history(self):
        r=self.f.inspection();self.e.revise_requirement(self.f.requirement,1,{'title':'개정 검측기준'},*self.f.actors['ADM'],uid())
        self.denies('REQUIREMENT_STALE',lambda:self.f.command('inspection',r,'request',{'requestedAt':DUE},'CON'))
        self.assertEqual(self.e.get('Requirement',self.f.requirement,1)['title'],'계약 검측기준')
    def test_stale_drawing_blocked(self):
        source=self.e.get('InformationItem',self.f.drawing);ref=self.f.ref('InformationItem',self.f.drawing);source['version']+=1;source['revision']='B';self.e._save('InformationItem',source) # trusted fixture of an upstream drawing service
        self.denies('DRAWING_STALE',lambda:self.f.inspection(drawingRef=ref))
    def test_upstream_hold_cannot_be_skipped(self):
        upstream=self.f.inspection();self.denies('HOLD_NOT_RELEASED',lambda:self.f.inspection(upstreamInspectionIds=[upstream['id']]))
    def test_no_all_na_fake_pass(self):
        r=self.f.inspection()
        for cmd,payload,actor in [('request',{'requestedAt':DUE},'CON'),('receive',{},'SUP'),('schedule',{'scheduledAt':DUE},'SUP'),('start',{},'SUP'),('submit_results',{'checkResults':[dict(itemId='dimension',requirementRef=self.f.ref('Requirement',self.f.requirement),result='not_applicable',note='적용제외 검토',evidenceIds=[self.f.evidence])]},'SUP')]:r=self.f.command('inspection',r,cmd,payload,actor)
        self.denies('ALL_CHECKS_PASS',lambda:self.f.command('inspection',r,'pass'))
    def test_external_lab_identity_is_retained_without_login(self):
        lab=uid();self.e.bootstrap('Party',dict(id=lab,projectId=self.f.project,kind='TEST_LAB',name='시험기관',loginEnabled=False))
        evidence=self.f.evidence_record(uid(),sourcePartyId=lab,mediaType='document')
        self.assertEqual(evidence['sourcePartyId'],lab);self.assertNotEqual(evidence['sourcePartyId'],evidence['submittedBy'])
    def test_workitem_data_cannot_shadow_state(self):
        self.denies('SCHEMA_INVALID',lambda:self.f.create('rfi',dict(title='질의',data={'status':'closed'}),'CON'))
    def test_nonfinite_model_confidence_rejected(self):
        self.denies('SCHEMA_INVALID',lambda:validate(float('nan'),{'type':'number'},{}))
