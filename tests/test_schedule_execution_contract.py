import hashlib
import json
import unittest

from app.reference.engine import uid
from app.reference.validation import ContractError
from tests.fixtures import AT, AFTER, BEFORE, Fixture


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


class ScheduleExecutionContractTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.contract = json.loads(__import__('pathlib').Path('app/schema/schedule_execution_contract_v1.json').read_text(encoding='utf-8'))

    def activity(self, schedule_id, name='Critical', percent=25):
        activity_id = uid()
        self.f.engine.bootstrap('WorkItem', dict(
            id=activity_id, projectId=self.f.project, subtype='ScheduleActivity', status='snapshot', title=name,
            data=dict(activityId='A-'+activity_id[:8], wbsPath='1.0', activityName=name,
                      percentComplete=percent, critical=True,
                      sourceScheduleRef=dict(objectType='InformationItem', objectId=schedule_id, version=1)),
            **self.f.scope()))
        return self.f.ref('WorkItem', activity_id)

    def baseline_payload(self, schedule_id, revision='B0', basis=None):
        file_id = uid(); critical = self.activity(schedule_id)
        schedule = dict(
            scheduleNo='BL-'+revision, scheduleKind='baseline', revision=revision,
            sourceFileRef=file_id, sourceFormat='xer', sourceFileHash=sha('baseline-'+revision), sourceFileVersion=revision,
            dataDate='2026-01-01T00:00:00Z', projectStartAt='2026-01-01T00:00:00Z', contractualCompletionAt='2026-12-31T00:00:00Z',
            forecastCompletionAt='2026-12-31T00:00:00Z', calendars=[dict(calendarId='STD',name='Standard',timezone='Asia/Ho_Chi_Minh',workingDays=[1,2,3,4,5],hoursPerDay=8)],
            wbsVersion='1', milestoneSet=[dict(milestoneId='M1',name='Completion',plannedAt='2026-12-31T00:00:00Z',contractualAt='2026-12-31T00:00:00Z')],
            criticalPathRef=critical, activityCount=10,
            scheduleQualitySummary={k:True for k in ['contractDatesAligned','wbsComplete','activityIdsUnique','calendarsDefined','logicComplete','openEndsIdentified','constraintsReviewed','durationOutliersReviewed','criticalPathComputable','floatOutliersReviewed','interfacesReviewed','sourceFilePreserved']})
        if basis:schedule['revisionBasisRef']=basis
        return dict(title='Contract Baseline '+revision, revision=revision, fileIds=[file_id], evidenceIds=[self.f.evidence], schedule=schedule)

    def approve_baseline(self, baseline):
        baseline=self.f.command('schedule_baseline',baseline,'submit_baseline',{},'CON')
        baseline=self.f.command('schedule_baseline',baseline,'receive_baseline',{},'SUP')
        baseline=self.f.command('schedule_baseline',baseline,'start_baseline_review',{},'SUP')
        baseline=self.f.command('schedule_baseline',baseline,'request_baseline_decision',{},'SUP')
        approval=self.f.create('approval',dict(targetRef=self.f.ref('InformationItem',baseline['id']),requestedBy=self.f.actors['CON'][0],approvalKind='technical'),'CON')
        approval=self.f.command('approval',approval,'review',{},'SUP')
        approval=self.f.command('approval',approval,'approve',{},'SUP')
        baseline=self.f.command('schedule_baseline',baseline,'approve_baseline',{'approvalRef':self.f.ref('Approval',approval['id'])},'SUP')
        return self.f.command('schedule_baseline',baseline,'activate_baseline',{},'SUP')

    def make_baseline(self, revision='B0', basis=None):
        schedule_id=uid()
        baseline=self.f.create('schedule_baseline',self.baseline_payload(schedule_id,revision,basis),'CON',oid=schedule_id)
        return self.approve_baseline(baseline)

    def progress_payload(self, baseline, schedule_id, data_date='2026-06-30T00:00:00Z', previous=None, correction=False):
        file_id=uid();critical=self.activity(schedule_id,'Progress Critical')
        schedule=dict(
            scheduleNo='UP-'+data_date[:10],scheduleKind='progress_update',revision='U1',sourceFileRef=file_id,sourceFormat='xer',sourceFileHash=sha(schedule_id),sourceFileVersion='U1',
            dataDate=data_date,periodStart='2026-06-01T00:00:00Z',periodEnd=data_date,forecastCompletionAt='2027-01-15T00:00:00Z',
            milestoneSet=[dict(milestoneId='M1',name='Completion',forecastAt='2027-01-15T00:00:00Z')],criticalPathRef=critical,activityCount=10,
            baselineScheduleRef=self.f.ref('InformationItem',baseline['id']))
        if previous:
            schedule['previousScheduleRef']=self.f.ref('InformationItem',previous['id'])
            if correction:
                schedule['correctionOfRef']=schedule['previousScheduleRef'];schedule['correctionReason']='현장 실적 정정'
        return dict(title='Progress Update',revision='U1',fileIds=[file_id],evidenceIds=[self.f.evidence],schedule=schedule)

    def freeze_progress(self, baseline, data_date='2026-06-30T00:00:00Z', previous=None, correction=False):
        oid=uid();progress=self.f.create('schedule_progress',self.progress_payload(baseline,oid,data_date,previous,correction),'CON',oid=oid)
        progress=self.f.command('schedule_progress',progress,'receive_progress',{},'SUP')
        progress=self.f.command('schedule_progress',progress,'start_progress_verification',{},'SUP')
        progress=self.f.command('schedule_progress',progress,'accept_progress_for_reporting',dict(actualsVerified=True,forecastVerified=True,criticalPathReviewed=True,varianceExplained=True),'SUP')
        return self.f.command('schedule_progress',progress,'freeze_progress',{},'SUP')

    def delay(self, baseline, current):
        data=dict(delayEventNo='DE-001',eventType='forecast_delay',observedAt=AT,knownAt=AT,description='완료예정일 지연',
                  baselineScheduleRef=self.f.ref('InformationItem',baseline['id']),currentScheduleRef=self.f.ref('InformationItem',current['id']))
        return self.f.create('delay_event',dict(title='Forecast delay',data=data,evidenceIds=[self.f.evidence]),'SUP')

    def recovery_schedule(self):
        oid=uid();file_id=uid()
        record=dict(id=oid,projectId=self.f.project,subtype='Schedule',title='Recovery Schedule',revision='R1',status='frozen',fileIds=[file_id],
                    schedule=dict(scheduleNo='REC-SCH-01',scheduleKind='recovery',revision='R1',sourceFileRef=file_id,sourceFormat='xer',sourceFileHash=sha('recovery'),sourceFileVersion='R1'),
                    **self.f.scope())
        self.f.engine.bootstrap('InformationItem',record)
        return self.f.ref('InformationItem',oid)

    def test_four_f04_lifecycles_are_separate(self):
        machines=self.f.engine.machines
        self.assertEqual(machines['schedule_baseline']['initial'],'draft')
        self.assertEqual(machines['schedule_progress']['initial'],'submitted')
        self.assertEqual(machines['delay_event']['initial'],'observed')
        self.assertEqual(machines['recovery_plan']['initial'],'requested')
        self.assertNotEqual(machines['schedule_baseline']['states'],machines['schedule_progress']['states'])

    def test_baseline_can_become_effective_without_becoming_forecast(self):
        baseline=self.make_baseline()
        self.assertEqual(baseline['status'],'effective')
        self.assertEqual(baseline['schedule']['scheduleKind'],'baseline')
        self.assertIn('effectiveAt',baseline['schedule'])

    def test_progress_freeze_preserves_baseline_and_derives_variance(self):
        baseline=self.make_baseline();baseline_before=self.f.engine.get('InformationItem',baseline['id'])
        progress=self.freeze_progress(baseline)
        baseline_after=self.f.engine.get('InformationItem',baseline['id'])
        self.assertEqual(baseline_after,baseline_before)
        self.assertEqual(progress['status'],'frozen')
        self.assertGreater(progress['schedule']['variance']['forecastCompletionVarianceDays'],0)
        self.assertTrue(self.contract['progress_freeze']['forecast_never_rewrites_baseline'])

    def test_data_date_cannot_move_backward_and_same_date_requires_correction(self):
        baseline=self.make_baseline();first=self.freeze_progress(baseline)
        oid=uid();payload=self.progress_payload(baseline,oid,'2026-06-01T00:00:00Z',first)
        with self.assertRaisesRegex(ContractError,'Data Date cannot move backward'):
            self.f.create('schedule_progress',payload,'CON',oid=oid)
        oid=uid();payload=self.progress_payload(baseline,oid,'2026-06-30T00:00:00Z',first)
        with self.assertRaisesRegex(ContractError,'Same Data Date requires explicit correction'):
            self.f.create('schedule_progress',payload,'CON',oid=oid)

    def test_corrected_progress_supersedes_prior_only_when_new_snapshot_freezes(self):
        baseline=self.make_baseline();first=self.freeze_progress(baseline)
        second=self.freeze_progress(baseline,'2026-06-30T00:00:00Z',first,True)
        prior=self.f.engine.get('InformationItem',first['id'])
        self.assertEqual(prior['status'],'superseded')
        self.assertEqual(second['status'],'frozen')
        self.assertEqual(second['schedule']['supersedesRef']['objectId'],first['id'])

    def test_baseline_revision_atomically_supersedes_prior_effective_baseline(self):
        first=self.make_baseline('B0')
        decision_id=uid()
        self.f.engine.bootstrap('Decision',dict(id=decision_id,projectId=self.f.project,status='decided',title='EOT approved',targetRef=self.f.ref('InformationItem',first['id']),options=[{'id':'A'}],impact={'schedule':'10d'},recommendation='approve',actionIds=[],decision='approved',decisionReason='Approved change',decisionAt=AT,**self.f.scope()))
        second=self.make_baseline('B1',self.f.ref('Decision',decision_id))
        first_current=self.f.engine.get('InformationItem',first['id'])
        self.assertEqual(first_current['status'],'superseded')
        self.assertEqual(second['status'],'effective')
        self.assertEqual(second['schedule']['supersedesRef']['objectId'],first['id'])

    def test_delay_event_rejects_cross_project_evidence(self):
        baseline=self.make_baseline()
        other_evidence=uid()
        self.f.engine.bootstrap('Evidence',dict(
            id=other_evidence,projectId=uid(),sourceType='original',mediaType='photo',
            fileId=uid(),fileHash=hashlib.sha256(b'other-project-delay-evidence').hexdigest(),
            sourcePartyId=self.f.actors['CON'][0],submittedBy=self.f.actors['CON'][0],
            uploadedAt=AT,**self.f.scope()))
        data=dict(
            delayEventNo='DE-CROSS-PROJECT',
            eventType='forecast_delay',
            observedAt=AT,
            knownAt=AT,
            description='Cross-project evidence must be rejected',
            baselineScheduleRef=self.f.ref('InformationItem',baseline['id']),
            currentScheduleRef=self.f.ref('InformationItem',baseline['id']),
        )
        with self.assertRaises(ContractError) as error:
            self.f.create(
                'delay_event',
                dict(title='Invalid evidence delay',data=data,evidenceIds=[other_evidence]),
                'SUP',
            )
        self.assertEqual(error.exception.code,'EVIDENCE_INVALID')

    def test_delay_event_is_factual_and_closes_without_entitlement_mutation(self):
        baseline=self.make_baseline();progress=self.freeze_progress(baseline)
        delay=self.delay(baseline,progress)
        delay=self.f.command('delay_event',delay,'notify',{},'SUP')
        delay=self.f.command('delay_event',delay,'start_assessment',{'assignedPartyId':self.f.actors['CON'][0],'causeCategory':'procurement_delay'},'SUP')
        delay=self.f.command('delay_event',delay,'start_impact_analysis',{'affectedMilestoneIds':['M1'],'currentForecastImpactDays':15,'criticalPathAffected':True,'totalFloatImpact':-15},'SUP')
        action=self.f.action()
        analysis=dict(baselineScheduleRef=self.f.ref('InformationItem',baseline['id']),dataDate=progress['schedule']['dataDate'],scheduleRef=self.f.ref('InformationItem',progress['id']),affectedActivityRefs=[],affectedMilestoneIds=['M1'],criticalPathAffected=True,beforeForecastAt='2026-12-31T00:00:00Z',afterForecastAt='2027-01-15T00:00:00Z',forecastImpactDays=15,mitigationIncluded=True,assumptions=['procurement'])
        delay=self.f.command('delay_event',delay,'start_mitigation',{'impactAnalysis':analysis,'mitigationActionRefs':[self.f.ref('Action',action['id'])]},'SUP')
        delay=self.f.command('delay_event',delay,'monitor',{'currentForecastImpactDays':10,'criticalPathAffected':True,'totalFloatImpact':-10},'SUP')
        delay=self.f.command('delay_event',delay,'resolve_event',{'eventEndAt':AT,'resolutionSummary':'납기 회복'},'SUP')
        delay=self.f.command('delay_event',delay,'close_delay_event',{'closureSummary':'Schedule event closed; entitlement not decided'},'SUP')
        self.assertEqual(delay['status'],'closed')
        self.assertTrue(self.contract['delay_boundary']['delay_event_is_fact_not_entitlement'])
        self.assertNotIn('entitlement',delay['data'])

    def test_recovery_acceptance_does_not_revise_baseline_or_approve_eot(self):
        baseline=self.make_baseline();progress=self.freeze_progress(baseline);delay=self.delay(baseline,progress)
        delay=self.f.command('delay_event',delay,'notify',{},'SUP')
        recovery=self.f.create('recovery_plan',dict(title='Recovery Plan',data={'triggerDelayEventRefs':[self.f.ref('WorkItem',delay['id'])]}),'SUP')
        recovery=self.f.command('recovery_plan',recovery,'begin_recovery_draft',{},'CON')
        payload=dict(recoveryPlanNo='RP-001',targetMilestoneIds=['M1'],targetCompletionAt='2026-12-31T00:00:00Z',currentForecastCompletionAt='2027-01-15T00:00:00Z',proposedForecastCompletionAt='2026-12-31T00:00:00Z',strategy='Resequence critical activities',qualityImpact='none',safetyImpact='none',costImpact='subject to separate review',contractImpact='none admitted',qualityStandardsRelaxed=False,safetyStandardsRelaxed=False,recoveryScheduleRef=self.recovery_schedule(),ownerDecisionRequired=False,monitoringPeriod='weekly',monitoringKpis=['forecast completion','critical float'])
        recovery=self.f.command('recovery_plan',recovery,'submit_recovery',payload,'CON')
        recovery=self.f.command('recovery_plan',recovery,'receive_recovery',{},'SUP')
        recovery=self.f.command('recovery_plan',recovery,'start_recovery_review',{},'SUP')
        recovery=self.f.command('recovery_plan',recovery,'accept_recovery',{},'SUP')
        self.assertEqual(recovery['status'],'accepted_for_execution')
        self.assertEqual(self.f.engine.get('InformationItem',baseline['id'])['status'],'effective')
        self.assertTrue(self.contract['recovery_boundary']['accepted_recovery_does_not_revise_baseline'])
        self.assertTrue(self.contract['recovery_boundary']['accepted_recovery_does_not_approve_eot_or_cost'])

    def test_recovery_owner_decision_must_target_exact_current_recovery_version(self):
        baseline=self.make_baseline();progress=self.freeze_progress(baseline);delay=self.delay(baseline,progress)
        delay=self.f.command('delay_event',delay,'notify',{},'SUP')
        recovery=self.f.create('recovery_plan',dict(title='Recovery Decision Plan',data={'triggerDelayEventRefs':[self.f.ref('WorkItem',delay['id'])]}),'SUP')
        recovery=self.f.command('recovery_plan',recovery,'begin_recovery_draft',{},'CON')
        payload=dict(
            recoveryPlanNo='RP-DECISION-001',
            targetMilestoneIds=['M1'],
            targetCompletionAt='2026-12-31T00:00:00Z',
            currentForecastCompletionAt='2027-01-15T00:00:00Z',
            proposedForecastCompletionAt='2026-12-31T00:00:00Z',
            strategy='Owner decision required',
            qualityImpact='none',
            safetyImpact='none',
            costImpact='separate',
            contractImpact='Owner decision required',
            qualityStandardsRelaxed=False,
            safetyStandardsRelaxed=False,
            recoveryScheduleRef=self.recovery_schedule(),
            ownerDecisionRequired=True,
            monitoringPeriod='weekly',
            monitoringKpis=['completion'],
        )
        recovery=self.f.command('recovery_plan',recovery,'submit_recovery',payload,'CON')
        recovery=self.f.command('recovery_plan',recovery,'receive_recovery',{},'SUP')
        recovery=self.f.command('recovery_plan',recovery,'start_recovery_review',{},'SUP')
        recovery=self.f.command('recovery_plan',recovery,'request_recovery_decision',{},'SUP')
        self.assertEqual(recovery['status'],'decision_pending')

        def decision(target_ref, title, **scope_changes):
            oid=uid()
            scope=self.f.scope()
            scope.update(scope_changes)
            self.f.engine.bootstrap('Decision',dict(
                id=oid,projectId=self.f.project,status='decided',title=title,
                targetRef=target_ref,options=[{'id':'approve'}],impact={'schedule':'recovery'},
                recommendation='approve',actionIds=[],decision='approved',
                decisionReason='Owner approved',decisionAt=AT,**scope))
            return self.f.ref('Decision',oid)

        wrong=decision(self.f.ref('InformationItem',baseline['id']),'Wrong target')
        with self.assertRaisesRegex(ContractError,'exact current Recovery Plan version'):
            self.f.command('recovery_plan',recovery,'accept_recovery',{'decisionRefs':[wrong]},'SUP')

        other=self.f.create('recovery_plan',dict(title='Other Recovery',data={'triggerDelayEventRefs':[self.f.ref('WorkItem',delay['id'])]}),'SUP')
        other_decision=decision(self.f.ref('WorkItem',other['id']),'Other recovery target')
        with self.assertRaisesRegex(ContractError,'exact current Recovery Plan version'):
            self.f.command('recovery_plan',recovery,'accept_recovery',{'decisionRefs':[other_decision]},'SUP')

        stale_target={'objectType':'WorkItem','objectId':recovery['id'],'version':recovery['version']-1}
        stale=decision(stale_target,'Stale recovery version')
        with self.assertRaisesRegex(ContractError,'exact current Recovery Plan version'):
            self.f.command('recovery_plan',recovery,'accept_recovery',{'decisionRefs':[stale]},'SUP')

        wrong_scope=decision(self.f.ref('WorkItem',recovery['id']),'Wrong scope',locationId=uid())
        with self.assertRaisesRegex(ContractError,'exact current Recovery Plan version'):
            self.f.command('recovery_plan',recovery,'accept_recovery',{'decisionRefs':[wrong_scope]},'SUP')

        stale_decision=decision(self.f.ref('WorkItem',recovery['id']),'Stale Decision ref')
        current_decision=self.f.engine.get('Decision',stale_decision['objectId'])
        current_decision['version']+=1
        current_decision['updatedAt']=self.f.engine.at()
        self.f.engine._save('Decision',current_decision)
        with self.assertRaises(ContractError) as stale_error:
            self.f.command('recovery_plan',recovery,'accept_recovery',{'decisionRefs':[stale_decision]},'SUP')
        self.assertEqual(stale_error.exception.code,'REFERENCE_STALE')

        exact=decision(self.f.ref('WorkItem',recovery['id']),'Exact recovery decision')
        recovery=self.f.command('recovery_plan',recovery,'accept_recovery',{'decisionRefs':[exact]},'SUP')
        self.assertEqual(recovery['status'],'accepted_for_execution')

    def test_recovery_effectiveness_is_command_derived(self):
        baseline=self.make_baseline();progress=self.freeze_progress(baseline);delay=self.delay(baseline,progress)
        delay=self.f.command('delay_event',delay,'notify',{},'SUP')
        recovery=self.f.create('recovery_plan',dict(title='Recovery Plan',data={'triggerDelayEventRefs':[self.f.ref('WorkItem',delay['id'])]}),'SUP')
        recovery=self.f.command('recovery_plan',recovery,'begin_recovery_draft',{},'CON')
        payload=dict(recoveryPlanNo='RP-002',targetMilestoneIds=['M1'],targetCompletionAt='2026-12-31T00:00:00Z',currentForecastCompletionAt='2027-01-15T00:00:00Z',proposedForecastCompletionAt='2026-12-31T00:00:00Z',strategy='Recover',qualityImpact='none',safetyImpact='none',costImpact='separate',contractImpact='separate',qualityStandardsRelaxed=False,safetyStandardsRelaxed=False,recoveryScheduleRef=self.recovery_schedule(),ownerDecisionRequired=False,monitoringPeriod='weekly',monitoringKpis=['completion'])
        recovery=self.f.command('recovery_plan',recovery,'submit_recovery',payload,'CON')
        recovery=self.f.command('recovery_plan',recovery,'receive_recovery',{},'SUP')
        recovery=self.f.command('recovery_plan',recovery,'start_recovery_review',{},'SUP')
        recovery=self.f.command('recovery_plan',recovery,'accept_recovery',{},'SUP')
        recovery=self.f.command('recovery_plan',recovery,'activate_recovery',{},'CON')
        recovery=self.f.command('recovery_plan',recovery,'start_recovery_monitoring',{},'SUP')
        with self.assertRaisesRegex(ContractError,'Only command-specific fields'):
            self.f.command('recovery_plan',recovery,'mark_recovery_effective',{'effectivenessResult':'ineffective','effectivenessSummary':'wrong'},'SUP')
        recovery=self.f.command('recovery_plan',recovery,'mark_recovery_effective',{'effectivenessSummary':'forecast recovered'},'SUP')
        self.assertEqual(recovery['data']['effectivenessResult'],'effective')

    def test_schedule_activity_100_percent_does_not_imply_quality_or_handover(self):
        self.assertTrue(self.contract['activity_boundary']['percent_complete_100_does_not_change_inspection_or_handover'])
        oid=uid();activity_ref=self.activity(oid,percent=100)
        activity=self.f.engine.resolve(activity_ref,self.f.project)
        self.assertEqual(activity['data']['percentComplete'],100)
        self.assertNotIn('nextWorkAllowed',activity['data'])


if __name__ == '__main__':
    unittest.main()
