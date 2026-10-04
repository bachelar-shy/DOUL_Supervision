from copy import deepcopy
from datetime import timedelta
import hashlib
import unittest
from app.reference.engine import uid
from app.reference.media import validate_analysis_outputs
from app.reference.validation import ContractError
from tests.fixtures import Fixture,DUE


class Media(unittest.TestCase):
    def setUp(self):self.f=Fixture();self.e=self.f.engine
    def denies(self,code,fn):
        with self.assertRaises(ContractError) as caught:fn()
        self.assertEqual(caught.exception.code,code)
    def analysis_fixture(self,**changes):
        # Variable frame rate intentionally makes index/fps timecode wrong.
        eid=uid();self.f.evidence_record(eid,mediaType='video',durationMs=1000,frameCount=3,metadata={'framePtsMs':[0,360,900]})
        value=dict(sourceEvidenceIds=[eid],mode='every_frame',model={'provider':'fixture','name':'fixture-model','version':'v1'},promptVersion='p1',policyVersion='1',languages=['vi'])|changes
        r=self.f.create('analysis_run',value);return self.f.command('analysis_run',r,'start',actor='SYSTEM'),self.e.get('Evidence',eid)
    def outputs(self,r,e,indices=(0,1,2),complete=True):
        frames=[dict(kind='frame',sourceEvidenceId=e['id'],derivedEvidenceId=uid(),analysisRunId=r['id'],modelVersion='v1',frameIndex=i,ptsMs=e['metadata']['framePtsMs'][i]) for i in indices]
        return dict(outputs=frames,coverage={'sources':[dict(sourceEvidenceId=e['id'],decodedFrameCount=3,analyzedFrameCount=len(indices),analyzedRanges=[{'startMs':0,'endMs':1000}],missingRanges=[] if complete else [{'startMs':360,'endMs':1000}],audioProcessedRanges=[],complete=complete)]},completedAt=DUE)
    def test_vfr_frame_pts_preserved(self):
        r,e=self.analysis_fixture();payload=self.outputs(r,e)
        validate_analysis_outputs({**r,**payload},[e]);self.assertEqual(payload['outputs'][1]['ptsMs'],360)
    def test_every_frame_claim_rejects_missing_frame(self):
        r,e=self.analysis_fixture();payload=self.outputs(r,e,(0,2));self.denies('COVERAGE_OVERCLAIM',lambda:validate_analysis_outputs({**r,**payload},[e]))
    def test_frame_count_cannot_be_faked(self):
        r,e=self.analysis_fixture();p=self.outputs(r,e);p['coverage']['sources'][0]['analyzedFrameCount']=99
        self.denies('COVERAGE_INVALID',lambda:validate_analysis_outputs({**r,**p},[e]))
    def test_selected_frames_are_partial_coverage(self):
        r,e=self.analysis_fixture(mode='keyframes');p=self.outputs(r,e,(0,),False);validate_analysis_outputs({**r,**p},[e])
        p['coverage']['sources'][0]['complete']=True;self.denies('COVERAGE_OVERCLAIM',lambda:validate_analysis_outputs({**r,**p},[e]))
    def test_frame_pts_cannot_use_constant_fps_formula(self):
        r,e=self.analysis_fixture();p=self.outputs(r,e);p['outputs'][1]['ptsMs']=333
        self.denies('FRAME_INVALID',lambda:validate_analysis_outputs({**r,**p},[e]))
    def test_transcript_keeps_source_time_and_original_text(self):
        r,e=self.analysis_fixture();p=self.outputs(r,e)
        p['outputs'].append(dict(kind='transcript',segmentId=uid(),sourceEvidenceId=e['id'],analysisRunId=r['id'],startMs=100,endMs=900,speakerLabel='speaker_1',originalLanguage='vi',originalText='Không đạt 120 mm',translatedText='120 mm에 미달'))
        validate_analysis_outputs({**r,**p},[e])
        p['outputs'][-1].pop('originalText');self.denies('TRANSCRIPT_INVALID',lambda:validate_analysis_outputs({**r,**p},[e]))
    def test_transcript_out_of_original_duration(self):
        r,e=self.analysis_fixture();p=self.outputs(r,e);p['outputs'].append(dict(kind='transcript',sourceEvidenceId=e['id'],analysisRunId=r['id'],startMs=900,endMs=1500))
        self.denies('MEDIA_RANGE_INVALID',lambda:validate_analysis_outputs({**r,**p},[e]))
    def test_worker_cannot_set_official_workflow_state(self):
        r,e=self.analysis_fixture();p=self.outputs(r,e);p['outputs'][0]['nextWorkAllowed']=True
        self.denies('NONHUMAN_OFFICIAL_DENIED',lambda:validate_analysis_outputs({**r,**p},[e]))
    def test_ai_candidate_requires_human_confirmation_and_corroboration(self):
        r=self.f.create('analysis_run',dict(sourceEvidenceIds=[self.f.evidence],mode='photo',model={'provider':'fixture','name':'fixture','version':'v1'},promptVersion='p1',policyVersion='1',languages=['vi']))
        r=self.f.command('analysis_run',r,'start',actor='SYSTEM')
        candidate=dict(kind='candidate',sourceEvidenceId=self.f.evidence,analysisRunId=r['id'],description='치수 결함 후보',confidence=.8,reviewFlags=['requires_measurement'],grounding=[dict(evidenceId=self.f.evidence,channel='visual',claimSupport='inferred')])
        coverage={'sources':[dict(sourceEvidenceId=self.f.evidence,analyzedRanges=[],missingRanges=[],audioProcessedRanges=[],complete=True)]}
        r=self.f.command('analysis_run',r,'complete',dict(outputs=[candidate],coverage=coverage,completedAt=DUE),'SYSTEM')
        obs=self.f.create('observation',dict(source='ai',description=candidate['description'],grounding=candidate['grounding'],analysisRunId=r['id'],confidence=.8,reviewFlags=['requires_measurement']),'AI')
        self.assertEqual(obs['status'],'candidate')
        obs=self.f.command('observation',obs,'begin_review');obs=self.f.command('observation',obs,'confirm',{'verificationNote':'추정만 확인'})
        self.denies('CLAIM_UNCORROBORATED',lambda:self.f.create('issue',dict(subtype='NCR',title='단독 추정',observationIds=[obs['id']],actionIds=[],inspectionIds=[],correctionCycle=0)))
    def test_derived_evidence_preserves_parent_range_and_run(self):
        r,e=self.analysis_fixture();eid=uid();payload=dict(sourceType='derived',mediaType='photo',fileId=uid(),fileHash=hashlib.sha256(b'frame').hexdigest(),sourcePartyId=self.f.actors['CON'][0],originalEvidenceId=e['id'],sourceRange=dict(startMs=360,endMs=360,frameIndex=1,ptsMs=360),derivationRunId=r['id'],**self.f.scope())
        child=self.e.add_evidence(eid,self.f.project,payload,b'frame',*self.f.actors['SYSTEM'],uid())['record']
        self.assertEqual(child['originalEvidenceId'],e['id']);payload['sourceRange']['endMs']=2000
        self.denies('MEDIA_RANGE_INVALID',lambda:self.e.add_evidence(uid(),self.f.project,payload,b'frame',*self.f.actors['SYSTEM'],uid()))
    def test_audio_full_coverage_rejects_gap(self):
        e=self.f.evidence_record(uid(),mediaType='audio',durationMs=1000);r=dict(id=uid(),mode='audio',outputs=[],coverage={'sources':[dict(sourceEvidenceId=e['id'],analyzedRanges=[],missingRanges=[],audioProcessedRanges=[dict(startMs=0,endMs=500),dict(startMs=600,endMs=1000)],complete=True)]})
        self.denies('COVERAGE_OVERCLAIM',lambda:validate_analysis_outputs(r,[e]))


class Snapshots(unittest.TestCase):
    def setUp(self):self.f=Fixture();self.e=self.f.engine;self.docs=self.f.docs
    def denies(self,code,fn):
        with self.assertRaises(ContractError) as caught:fn()
        self.assertEqual(caught.exception.code,code)
    def test_all_25_forms_validate_populated_dto_and_html_structure(self):
        for form in self.docs.templates:
            with self.subTest(form=form):
                kind,oid={'FM-07':('Inspection',None),'FM-09':('Inspection',None),'FM-13':('Action',None),'FM-15':('WorkItem',None),'FM-20':('InformationItem',None),'FM-21':('Decision',None)}.get(form,('Requirement',self.f.requirement))
                if form in ['FM-07','FM-09']:record=self.f.inspect(self.f.inspection())
                elif form=='FM-13':record=self.f.complete_action(self.f.action())
                elif form=='FM-15':record=self.f.create('rfi',dict(title='질의',data={'question':'질의','response':'답변','changeRequired':False}),'CON')
                elif form=='FM-20':record=self.f.report()
                elif form=='FM-21':record=self.f.create('decision',dict(title='결정',options=[{'id':'A'}],impact={'quality':'영향'},recommendation='A',actionIds=[],dueAt=DUE))
                else:record=self.e.get(kind,oid)
                doc=self.docs.render(form,[self.f.ref(kind,record['id'])],self.f.form_data(form),*self.f.actors['SUP'],uid())
                output=self.docs.rerender(doc['id']);self.assertEqual(hashlib.sha256(output).hexdigest(),doc['renderHash'])
                self.assertIn(b'charset="utf-8"',output);self.assertIn(b'DOUL INTERNATIONAL',output)
    def test_current_domain_change_does_not_change_old_snapshot(self):
        doc=self.docs.render('FM-12',[self.f.ref('Requirement',self.f.requirement)],self.f.form_data('FM-12'),*self.f.actors['SUP'],uid())
        original=self.docs.rerender(doc['id']);self.e.revise_requirement(self.f.requirement,1,{'title':'개정'},*self.f.actors['ADM'],uid())
        self.assertEqual(self.docs.rerender(doc['id']),original);self.assertEqual(doc['sourceDomainRefs'][0]['version'],1)
    def test_missing_final_field_blocks_render(self):
        self.denies('FORM_FIELD_MISSING',lambda:self.docs.render('FM-12',[self.f.ref('Requirement',self.f.requirement)],{},*self.f.actors['SUP'],uid()))
    def test_statutory_final_language(self):
        r=self.f.inspect(self.f.inspection())
        self.denies('STATUTORY_LANGUAGE_REQUIRED',lambda:self.docs.render('FM-09',[self.f.ref('Inspection',r['id'])],self.f.form_data('FM-09'),*self.f.actors['SUP'],uid(),language='ko'))
    def test_result_fields_come_from_versioned_inspection_not_caller(self):
        r=self.f.inspect(self.f.inspection(),'fail');data=self.f.form_data('FM-09');data['result']['status']='pass';data['result']['next_work_allowed']=True
        doc=self.docs.render('FM-09',[self.f.ref('Inspection',r['id'])],data,*self.f.actors['SUP'],uid())
        self.assertEqual(doc['sourcePayload']['data']['result']['status'],'fail');self.assertFalse(doc['sourcePayload']['data']['result']['next_work_allowed'])
    def test_long_text_100_rows_and_untrusted_html_escaped(self):
        data=self.f.form_data('FM-22',100);data['items'][0]['issue']='<script>alert(1)</script>'+'장문 문장 · tiếng Việt '*100
        doc=self.docs.render('FM-22',[self.f.ref('Requirement',self.f.requirement)],data,*self.f.actors['SUP'],uid());output=self.docs.rerender(doc['id']).decode()
        self.assertEqual(output.count('<tbody>'),1);self.assertEqual(output.count('<tr>'),101);self.assertIn('&lt;script&gt;',output);self.assertNotIn('<script>',output)
    def test_conditional_subcontractor_signature_required(self):
        r=self.f.inspect(self.f.inspection());doc=self.f.acceptance(r,True)
        self.assertEqual(doc['status'],'final');self.denies('ACCEPTANCE_SIGNED',lambda:self.f.command('inspection',r,'release_next_work'))
    def test_signature_without_trusted_verification_receipt_denied(self):
        r=self.f.inspect(self.f.inspection());doc=self.docs.render('FM-09',[self.f.ref('Inspection',r['id'])],self.f.form_data('FM-09'),*self.f.actors['SUP'],uid())
        self.denies('SIGNATURE_UNVERIFIED',lambda:self.docs.sign(doc['id'],*self.f.actors['SUP'],'owner_side_supervisor','approved_e_signature',{'verified':False},uid()))
    def test_expired_signer_does_not_sign(self):
        r=self.f.inspect(self.f.inspection());doc=self.docs.render('FM-09',[self.f.ref('Inspection',r['id'])],self.f.form_data('FM-09'),*self.f.actors['SUP'],uid())
        self.f.clock+=timedelta(days=100)
        self.denies('ASSIGNMENT_EXPIRED',lambda:self.docs.sign(doc['id'],*self.f.actors['SUP'],'owner_side_supervisor','approved_e_signature',{},uid()))
    def test_mutating_returned_snapshot_cannot_alter_stored_bytes_or_source(self):
        r=self.f.inspect(self.f.inspection());doc=self.f.acceptance(r);stored=self.docs.rerender(doc['id']);doc['sourcePayload']['data']['result']['status']='fail'
        self.assertEqual(self.docs.get(doc['id'])['sourcePayload']['data']['result']['status'],'pass');self.assertEqual(self.docs.rerender(doc['id']),stored)
    def test_fixed_templates_blocked_until_verified_installation(self):
        self.denies('LEGAL_TEMPLATE_NOT_INSTALLED',lambda:self.docs.render_official('VN-ND207-IIb'))
    def test_authority_inspection_result_form_is_receive_only(self):self.denies('LEGAL_FORM_RECEIVE_ONLY',lambda:self.docs.render_official('VN-ND207-VIII'))

if __name__=='__main__':unittest.main()
