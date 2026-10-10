"""Approved C2 reference commands: real HTTP refusals and persistent replay.

Trusted synthetic upstream profiles/records come from the existing F-07 fixture;
these tests establish development contract behavior, not field acceptance.
"""
from copy import deepcopy
import unittest

from app.reference.engine import uid
from tests_mvp import test_handover_http


class CompletionReferenceRefusalHttpTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_handover_http.HandoverHttpTests()
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def assert_atomic_refusal(self, collection, record, command, payload, **kwargs):
        f = self.fixture
        before = deepcopy(f.engine.get("WorkItem", record["id"]))
        audit_before = deepcopy(f.engine._audit)
        response = f.command(collection, record, command, payload,
                             actor=kwargs.pop("actor", "SUP"), evidence=[], **kwargs)
        self.assertIn(response.status_code, (400, 403, 409, 422), response.text)
        self.assertEqual(f.engine.get("WorkItem", record["id"]), before)
        self.assertEqual(f.engine._audit, audit_before)
        return response

    def handover_draft(self):
        f = self.fixture
        commissioning = f._pass_commissioning()
        issue_ref, action_ref = f._new_punch_and_action()
        scope = {"scopeId": "REFUSAL-SCOPE", "system": "SYS-A",
                 "locationIds": [f.scope["locationId"]],
                 "assetRefs": [f.ref("Asset", x) for x in f.asset_ids]}
        data = {
            "handoverNo": "REFUSAL-HO", "handoverScope": scope,
            "handoverProfileRef": f.ref("Requirement", f.handover_profile_id),
            "commissioningPackageRefs": [f.ref("WorkItem", commissioning["id"])],
            "openIssueRefs": [issue_ref], "reservationProposals": [],
        }
        for field, document in (("asBuiltRefs", "asBuilt"), ("omManualRefs", "omManual"),
                                ("trainingRefs", "training"), ("sparePartsRefs", "spareParts"),
                                ("certificateRefs", "certificates"),
                                ("statutoryAcceptanceRefs", "statutoryAcceptance")):
            data[field] = [f.ref("InformationItem", f.document_ids[document])]
        handover = f.create("handover-packages", {
            **f.scope, "subtype": "HandoverPackage", "title": "Reference refusal fixture",
            "requirementRefs": [f.ref("Requirement", f.requirement_id)],
            "drawingRef": f.ref("InformationItem", f.drawing_id), "data": data,
        }, "CON")
        issue = f.engine.get("Issue", issue_ref["objectId"])
        with f.store.transaction(True):
            f.engine._record_machines[("Issue", issue["id"])] = "issue"
        f.expect("issues", issue, "assign", {
            "responsiblePartyId": issue["responsiblePartyId"],
            "responsibleOrganizationId": issue["responsibleOrganizationId"],
            "dueAt": f.tomorrow, "actionIds": issue["actionIds"],
        }, actor="SUP", evidence=[])
        return handover, issue_ref, f.ref("Issue", issue["id"]), action_ref

    def test_handover_refresh_refusals_are_atomic(self):
        f = self.fixture
        handover, original, current, _ = self.handover_draft()
        other, _ = f._new_punch_and_action()
        forbidden = {
            "remove": [], "substitute": [other], "add": [current, other],
            "duplicate": [current, current], "stale": [original],
            "missing_version": [{"objectType": "Issue", "objectId": current["objectId"]}],
            "non_object": [None], "boolean_version": [{**current, "version": True}],
            "extra_keys": [{**current, "autoRefresh": True}],
            "wrong_type": [{**current, "objectType": "Action"}],
        }
        for name, refs in forbidden.items():
            with self.subTest(name=name):
                self.assert_atomic_refusal("handover-packages", handover,
                                           "refresh_issue_references", {"currentIssueRefs": refs})
        self.assert_atomic_refusal("handover-packages", handover, "refresh_issue_references",
                                   {"currentIssueRefs": [current]}, actor="CON")
        self.assert_atomic_refusal("handover-packages", handover, "refresh_issue_references",
                                   {"currentIssueRefs": [current]}, version=handover["version"] + 1)
        self.assert_atomic_refusal("handover-packages", handover, "refresh_issue_references",
                                   {"currentIssueRefs": [current], "currentOpenIssueRefs": []})

    def test_handover_refresh_replay_retains_one_history_and_audit_event(self):
        f = self.fixture
        handover, original, current, _ = self.handover_draft()
        payload = {"currentIssueRefs": [current]}
        key = uid()
        before_audit = len(f.engine._audit)
        first = f.command("handover-packages", handover, "refresh_issue_references",
                          payload, actor="SUP", evidence=[], key=key)
        self.assertEqual(first.status_code, 200, first.text)
        replay = f.command("handover-packages", handover, "refresh_issue_references",
                           payload, actor="SUP", evidence=[], key=key)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["record"], first.json()["record"])
        self.assertEqual(len(f.engine._audit), before_audit + 1)

        result = f.engine.get("WorkItem", handover["id"])
        self.assertEqual(result["data"]["openIssueRefs"], [original])
        self.assertEqual(len(result["data"]["issueReferenceRefreshHistory"]), 1)
        altered = f.command("handover-packages", handover, "refresh_issue_references",
                            {"currentIssueRefs": []}, actor="SUP", evidence=[], key=key)
        self.assertEqual(altered.status_code, 409, altered.text)
        self.assertEqual(altered.json()["code"], "IDEMPOTENCY_CONFLICT")
        self.assertEqual(f.engine.get("WorkItem", handover["id"]), result)
        self.assertEqual(len(f.engine._audit), before_audit + 1)

    def test_commissioning_refresh_requires_the_exact_complete_paired_cycle(self):
        f = self.fixture
        original, action = f._new_punch_and_action()
        package = f.create("commissioning-packages", f._commissioning_payload(punch_refs=[original]), "CON")
        for command in ("start_prerequisite_review", "start_precommissioning"):
            package = f.expect("commissioning-packages", package, command, actor="SUP", evidence=[])
        package = f.expect("commissioning-packages", package, "declare_test_ready", {
            "precommissioningChecklist": [{"itemId": "P-01", "completed": True,
                                           "evidenceIds": [f.evidence_id]}],
        }, actor="SUP", evidence=[])
        package = f.expect("commissioning-packages", package, "start_test", actor="SUP")
        package = f.expect("commissioning-packages", package, "submit_test_result", {
            "testResultRef": f.ref("Evidence", f.evidence_id), "outcome": "pass",
            "acceptanceCriteriaMet": True,
        }, actor="CON")
        package = f.expect("commissioning-packages", package, "accept_test", actor="SUP")
        closed = f._close_issue_via_http(original, action)
        current = f.ref("Issue", closed["id"])
        other_issue, other_action = f._new_punch_and_action()
        unlinked_action = deepcopy(f.engine.get("Action", action["objectId"]))
        unlinked_action.update(id=uid(), version=1)
        with f.store.transaction(True):
            f.engine.bootstrap("Action", unlinked_action)
        unlinked_ref = f.ref("Action", unlinked_action["id"])
        forbidden = {
            "one_sided_issue": {"punchIssueRefs": [current]},
            "one_sided_actions": {"correctionActionRefs": [action]},
            "remove_issue": {"punchIssueRefs": [], "correctionActionRefs": []},
            "remove_actions": {"punchIssueRefs": [current], "correctionActionRefs": []},
            "substitute_issue": {"punchIssueRefs": [other_issue], "correctionActionRefs": [other_action]},
            "cross_issue_action": {"punchIssueRefs": [current], "correctionActionRefs": [other_action]},
            "unlinked_action": {"punchIssueRefs": [current], "correctionActionRefs": [action, unlinked_ref]},
            "stale_issue": {"punchIssueRefs": [original], "correctionActionRefs": [action]},
            "forged_projection": {"punchIssueRefs": [current], "correctionActionRefs": [action],
                                  "currentPunchIssueRefs": [current]},
        }
        for name, payload in forbidden.items():
            with self.subTest(name=name):
                self.assert_atomic_refusal("commissioning-packages", package,
                                           "mark_ready_for_handover", payload)
        valid = {"punchIssueRefs": [current], "correctionActionRefs": [action]}
        self.assert_atomic_refusal("commissioning-packages", package, "mark_ready_for_handover",
                                   valid, actor="CON")
        accepted = f.expect("commissioning-packages", package, "mark_ready_for_handover",
                            valid, actor="SUP")
        self.assertEqual(accepted["status"], "ready_for_handover")
        self.assertEqual(accepted["data"]["punchIssueRefs"], [original])
        self.assertEqual(accepted["data"]["currentPunchIssueRefs"], [current])



if __name__ == "__main__":
    unittest.main()
