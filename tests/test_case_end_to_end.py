"""End-to-end inspection case lifecycle through owner-report closure."""
import unittest

from app.reference.engine import uid
from services.api.application import (
    build_inspection_case,
    create_case_owner_report,
    create_issue_package,
    create_reinspection_request,
)
from tests.fixtures import AT, DUE, Fixture


class CaseEndToEnd(unittest.TestCase):
    def setUp(self):
        self.f=Fixture()
        self.e=self.f.engine

    def group(self,root_id,issue_id):
        graph=build_inspection_case(self.e,root_id)
        return graph,next(group for group in graph['issues'] if group['issue']['id']==issue_id)

    def test_correction_reinspection_closure_and_owner_reporting_are_one_traceable_case(self):
        root=self.f.inspect(self.f.inspection(),result='fail')
        observation=self.f.observation()
        packaged=create_issue_package(
            self.e,
            root['id'],
            uid(),
            uid(),
            [observation['id']],
            'NCR',
            '벽체 치수 부적합',
            '벽체 치수 시정 및 재발방지',
            self.f.actors['CON'][0],
            DUE,
            *self.f.actors['SUP'],
            uid(),
        )
        issue=packaged['issue']
        action=packaged['correctiveAction']

        graph,group=self.group(root['id'],issue['id'])
        self.assertEqual(group['readiness']['stage'],'corrective_action')
        self.assertFalse(group['readiness']['correctionSubmitted'])
        self.assertFalse(graph['readiness']['complete'])

        action=self.f.command('action',action,'start',actor='CON')
        issue=self.f.command('issue',issue,'start_correction',actor='CON')
        action=self.f.command(
            'action',
            action,
            'submit',
            dict(
                correction='벽체 위치 및 치수 보완 완료',
                rootCause='기준선 확인 누락',
                preventiveAction='시공 전 기준선 체크리스트 강화',
            ),
            actor='CON',
        )

        _,group=self.group(root['id'],issue['id'])
        self.assertTrue(group['readiness']['correctionSubmitted'])
        self.assertEqual(group['readiness']['stage'],'reinspection_request')
        self.assertFalse(group['readiness']['correctionVerified'])

        requested=create_reinspection_request(
            self.e,
            root['id'],
            issue['id'],
            uid(),
            '벽체 치수 재검측',
            DUE,
            True,
            {key:True for key in ['drawing','material','test','previous','change']},
            [self.f.evidence],
            *self.f.actors['CON'],
            uid(),
        )
        issue=requested['issue']
        reinspection=requested['reinspection']
        self.assertEqual(
            reinspection['correctiveActionRefs'],
            [self.f.ref('Action', action['id'])],
        )

        action=self.f.command('action',action,'verify')
        action=self.f.command('action',action,'close')
        issue=self.f.command('issue',issue,'start_reinspection')

        reinspection=self.f.command('inspection',reinspection,'receive',dict(receivedAt=AT))
        reinspection=self.f.command('inspection',reinspection,'schedule',dict(scheduledAt=AT))
        reinspection=self.f.command('inspection',reinspection,'start')
        reinspection=self.f.command(
            'inspection',
            reinspection,
            'submit_results',
            dict(checkResults=[dict(
                itemId='dimension',
                requirementRef=self.f.ref('Requirement',self.f.requirement),
                result='pass',
                evidenceIds=[self.f.evidence],
                measuredValue=120,
                unit='mm',
            )]),
        )
        reinspection=self.f.command('inspection',reinspection,'pass')
        reinspection=self.f.finish(reinspection)

        _,group=self.group(root['id'],issue['id'])
        self.assertTrue(group['readiness']['correctionVerified'])
        self.assertTrue(group['readiness']['reinspectionPassed'])
        self.assertTrue(group['readiness']['closeReady'])
        self.assertEqual(group['readiness']['closeBlockedReasons'],[])
        self.assertEqual(group['readiness']['closureEvidenceCandidateIds'],[self.f.evidence])

        issue=self.e.get('Issue',issue['id'])
        issue=self.f.command('issue',issue,'close',{'closureEvidenceIds':[self.f.evidence]})
        graph,group=self.group(root['id'],issue['id'])
        self.assertEqual(issue['status'],'closed')
        self.assertTrue(group['readiness']['ownerReportDraftReady'])
        self.assertEqual(graph['readiness']['ownerReportingPendingIssueIds'],[issue['id']])

        drafted=create_case_owner_report(
            self.e,
            root['id'],
            issue['id'],
            uid(),
            '벽체 치수 부적합 종결 보고',
            '1',
            'regular',
            'P2',
            [self.f.actors['OWN'][0]],
            '시정조치 및 재검측 완료, 기준 치수 충족 확인',
            '기준선 확인 누락',
            {'quality':'resolved','schedule':'closed','cost':'no_additional_impact'},
            '재검측 합격 및 후속 공정 진행 가능',
            '본 건 종결 확인',
            DUE,
            DUE,
            *self.f.actors['SUP'],
            uid(),
        )
        report=drafted['report']
        graph,group=self.group(root['id'],issue['id'])
        self.assertEqual(report['status'],'draft')
        self.assertFalse(group['readiness']['ownerReportDraftReady'])
        self.assertTrue(group['readiness']['ownerReportIssuePending'])
        self.assertFalse(group['readiness']['ownerReceiptPending'])
        self.assertFalse(graph['readiness']['complete'])

        issue_ref=next(
            reference for reference in report['report']['sourceDomainRefs']
            if reference['objectType']=='Issue' and reference['objectId']==issue['id']
        )
        self.assertEqual(self.e.resolve(issue_ref,self.f.project)['status'],'closed')
        source_ids={reference['objectId'] for reference in report['report']['sourceDomainRefs']}
        self.assertTrue({root['id'],issue['id'],observation['id'],action['id'],reinspection['id']}<=source_ids)

        report=self.f.command('report',report,'submit')
        report=self.f.command('report',report,'issue')
        _,group=self.group(root['id'],issue['id'])
        self.assertFalse(group['readiness']['ownerReportIssuePending'])
        self.assertTrue(group['readiness']['ownerReceiptPending'])
        self.assertFalse(group['readiness']['ownerReceiptConfirmed'])

        report=self.f.command('report',report,'acknowledge',actor='OWN')
        _,group=self.group(root['id'],issue['id'])
        self.assertFalse(group['readiness']['ownerReceiptPending'])
        self.assertTrue(group['readiness']['ownerReceiptConfirmed'])
        self.assertFalse(group['readiness']['ownerReportingComplete'])

        report=self.f.command('report',report,'dispatch')
        report=self.f.command('report',report,'verify')
        report=self.f.command('report',report,'close')
        graph,group=self.group(root['id'],issue['id'])
        self.assertEqual(report['status'],'closed')
        self.assertTrue(group['readiness']['ownerReportingComplete'])
        self.assertEqual(graph['readiness']['openIssueIds'],[])
        self.assertEqual(graph['readiness']['ownerReportingPendingIssueIds'],[])
        self.assertTrue(graph['readiness']['complete'])
        self.assertIn(report['id'],[item['id'] for item in graph['ownerReports']])
        timeline_ids={event['objectRef']['objectId'] for event in graph['timeline']}
        self.assertTrue({root['id'],issue['id'],action['id'],reinspection['id'],report['id']}<=timeline_ids)


if __name__=='__main__':
    unittest.main()
