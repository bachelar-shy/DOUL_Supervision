"""HTTP authorization acceptance across two actual project records.

Project B and its assignment are synthetic, trusted fixture configuration. The
records under test are created/read through the real HTTP application.
"""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


class AcceptanceAuthorityHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(str(Path(self.temp.name) / "state.db"), demo=True)
        self.store = self.app.state.store
        self.client = TestClient(self.app)
        self.project_a = self.store.meta["projectId"]
        self.sessions = {}
        for group in ("SUP", "CON", "ADM"):
            self.sessions[group] = self.login(group)
        self.project_b, self.b_contractor = self.seed_project_b()
        self.session_b = self.login_for_project_b()
        self.rfi_a = self.create_rfi(self.sessions["CON"], self.project_a, "A-private RFI")
        self.rfi_b = self.create_rfi(self.session_b, self.project_b, "B-private RFI")
        self.report_a = next(
            record for (kind, _), record in self.store.engine._records.items()
            if kind == "InformationItem" and record.get("subtype") == "Report"
            and record.get("projectId") == self.project_a
        )
        self.document_a = self.create_document_a()

    def tearDown(self):
        self.client.close()
        self.store.close()
        self.temp.cleanup()

    def login(self, group):
        response = self.client.post("/dev/sessions", json={"actorGroup": group})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    @staticmethod
    def headers(session, *, key=None):
        result = {
            "Authorization": "Bearer " + session["accessToken"],
            "X-RoleAssignment-Id": session["actor"]["roleAssignmentId"],
        }
        if key:
            result["Idempotency-Key"] = key
        return result

    def seed_project_b(self):
        """Trusted test setup for an independent, valid project and actor."""
        project, package, location, party, role, qualification = (uid() for _ in range(6))
        now = self.store.engine.at()
        from datetime import datetime, timedelta, timezone
        stamp = lambda value: value.isoformat().replace("+00:00", "Z")
        start = stamp(datetime.now(timezone.utc) - timedelta(days=1))
        end = stamp(datetime.now(timezone.utc) + timedelta(days=365))
        organization = uid()
        actor = dict(partyId=party, roleAssignmentId=role, name="Synthetic Project B contractor", actorGroup="CON")
        with self.store.transaction(True):
            engine = self.store.engine
            engine.bootstrap("Project", dict(
                id=project, projectId=project, name="Synthetic Project B",
                country="VN", timezone="Asia/Ho_Chi_Minh",
                qualificationRules=[dict(discipline="architecture", minimumRank=3)],
            ))
            engine.bootstrap("Location", dict(
                id=location, projectId=project, name="B test location", semanticAnchor="test/B/location",
            ))
            engine.bootstrap("Party", dict(
                id=party, projectId=project, kind="PERSON", name=actor["name"],
                loginEnabled=True, organizationId=organization,
            ))
            engine.bootstrap("Qualification", dict(
                id=qualification, projectId=project, partyId=party,
                number="TEST-FIXTURE-NOT-A-CERTIFICATE", rank=1,
                disciplines=["architecture"], validFrom=start, validTo=end,
                verified=True, revoked=False,
            ))
            engine.bootstrap("RoleAssignment", dict(
                id=role, projectId=project, partyId=party, organizationId=organization,
                actorGroup="CON", roleCode="contractor_technical_lead",
                authorityCodes=[code for code, policy in engine.policies.items() if "CON" in policy["actor_groups"]],
                disciplines=["architecture"], packageIds=[package], locationIds=[location],
                qualificationIds=[qualification], validFrom=start, validTo=end,
                active=True, approvedBy=party,
            ))
        actor["scope"] = dict(packageId=package, locationId=location, discipline="architecture", responsibleOrganizationId=organization, minimumQualificationRank=3)
        return project, actor

    def login_for_project_b(self):
        """Mint a development token bound to B, restoring demo metadata immediately."""
        old_project = self.store.meta["projectId"]
        old_actor = deepcopy(self.store.meta["actors"]["CON"])
        actor = {key: value for key, value in self.b_contractor.items() if key != "scope"}
        with self.store.transaction(True):
            self.store.meta["projectId"] = self.project_b
            self.store.meta["actors"]["CON"] = actor
        try:
            return self.login("CON")
        finally:
            with self.store.transaction(True):
                self.store.meta["projectId"] = old_project
                self.store.meta["actors"]["CON"] = old_actor

    def create_rfi(self, session, project, title):
        scope = self.store.meta["scope"] if project == self.project_a else self.b_contractor["scope"]
        response = self.client.post(
            f"/projects/{project}/rfis",
            headers=self.headers(session, key=uid()),
            json={
                "roleAssignmentId": session["actor"]["roleAssignmentId"],
                "clientObjectId": uid(),
                "payload": {**scope, "title": title, "data": {}},
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def create_document_a(self):
        session = self.sessions["SUP"]
        workspace = self.client.get(
            f"/projects/{self.project_a}/workspace", headers=self.headers(session)
        ).json()
        form = workspace["formSchemas"]["FM-20"]
        data = {}
        for table in form["tables"]:
            node = data
            for part in table["path"].split(".")[:-1]:
                node = node.setdefault(part, {})
            node[table["path"].split(".")[-1]] = (
                {column: "" for column in table["columns"]}
                if table["type"] in ("review_table", "check_table") else []
            )
        response = self.client.post(
            f"/projects/{self.project_a}/forms/FM-20/preview",
            headers=self.headers(session, key=uid()),
            json={
                "roleAssignmentId": session["actor"]["roleAssignmentId"],
                "sourceDomainRefs": [{
                    "objectType": "InformationItem", "objectId": self.report_a["id"],
                    "version": self.report_a["version"],
                }],
                "data": data, "language": "en", "output": "html_a4",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_state_unchanged(self, before):
        after = (
            deepcopy(self.store.engine._records), deepcopy(self.store.engine._history),
            deepcopy(self.store.engine.audit_events), deepcopy(self.store.documents._snapshots),
            deepcopy(self.store.documents._bytes), deepcopy(self.store.documents._signatures),
        )
        self.assertEqual(after, before)

    def state_snapshot(self):
        return (
            deepcopy(self.store.engine._records), deepcopy(self.store.engine._history),
            deepcopy(self.store.engine.audit_events), deepcopy(self.store.documents._snapshots),
            deepcopy(self.store.documents._bytes), deepcopy(self.store.documents._signatures),
        )

    def test_project_b_identity_cannot_read_command_link_or_download_project_a_data(self):
        # Establish B's session is valid and B's own real API data is reachable.
        own = self.client.get(
            f"/projects/{self.project_b}/rfis/{self.rfi_b['id']}",
            headers=self.headers(self.session_b),
        )
        self.assertEqual(own.status_code, 200, own.text)
        self.assertEqual(own.json()["projectId"], self.project_b)

        before = self.state_snapshot()
        a_paths = [
            ("GET", f"/projects/{self.project_a}/rfis/{self.rfi_a['id']}"),
            ("POST", f"/projects/{self.project_a}/rfis/{self.rfi_a['id']}/submit"),
        ]
        for method, path in a_paths:
            with self.subTest(method=method, path=path):
                if method == "GET":
                    response = self.client.get(path, headers=self.headers(self.session_b))
                else:
                    response = self.client.post(
                        path, headers=self.headers(self.session_b, key=uid()),
                        json={"roleAssignmentId": self.session_b["actor"]["roleAssignmentId"],
                              "expectedVersion": self.rfi_a["version"],
                              "payload": {"dueAt": "2030-01-01T00:00:00Z", "question": "Cross-project attempt", "references": [{"objectType": "InformationItem", "objectId": self.report_a["id"], "version": self.report_a["version"]}]},
                              "evidenceIds": []},
                    )
                self.assertEqual(response.status_code, 404, response.text)
        # The valid B identity also cannot use an A object ID on B's resource route.
        self.assertEqual(self.client.get(
            f"/projects/{self.project_b}/rfis/{self.rfi_a['id']}",
            headers=self.headers(self.session_b),
        ).status_code, 404)

        linked = self.client.post(
            f"/projects/{self.project_b}/forms/FM-20/preview",
            headers=self.headers(self.session_b, key=uid()),
            json={
                "roleAssignmentId": self.session_b["actor"]["roleAssignmentId"],
                "sourceDomainRefs": [{
                    "objectType": "InformationItem", "objectId": self.report_a["id"],
                    "version": self.report_a["version"],
                }],
                "data": {}, "language": "en", "output": "html_a4",
            },
        )
        self.assertEqual(linked.status_code, 404, linked.text)
        download = self.client.get(
            f"/projects/{self.project_b}/documents/{self.document_a['id']}/content",
            headers=self.headers(self.session_b),
        )
        self.assertEqual(download.status_code, 404, download.text)
        self.assert_state_unchanged(before)

    def test_admin_cannot_make_technical_decision_or_close_issue_but_can_manage_location(self):
        sup = self.sessions["SUP"]
        admin = self.sessions["ADM"]
        drawing = next(
            record for (kind, _), record in self.store.engine._records.items()
            if kind == "InformationItem" and record.get("subtype") == "Drawing"
            and record.get("projectId") == self.project_a
        )
        approval_create = self.client.post(
            f"/projects/{self.project_a}/approvals",
            headers=self.headers(sup, key=uid()),
            json={
                "roleAssignmentId": sup["actor"]["roleAssignmentId"], "clientObjectId": uid(),
                "payload": {**self.store.meta["scope"],
                    "targetRef": {"objectType": "InformationItem", "objectId": drawing["id"], "version": drawing["version"]},
                    "requestedBy": sup["actor"]["partyId"], "approvalKind": "technical"},
            },
        )
        self.assertEqual(approval_create.status_code, 201, approval_create.text)
        approval = approval_create.json()["record"]
        reviewed = self.client.post(
            f"/projects/{self.project_a}/approvals/{approval['id']}/review",
            headers=self.headers(sup, key=uid()),
            json={"roleAssignmentId": sup["actor"]["roleAssignmentId"], "expectedVersion": approval["version"], "payload": {}, "evidenceIds": []},
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.text)

        issue = next(
            record for (kind, _), record in self.store.engine._records.items()
            if kind == "Issue" and record.get("projectId") == self.project_a and record.get("status") == "in_progress"
        )
        for path, body in (
            (f"/projects/{self.project_a}/approvals/{approval['id']}/approve", {
                "roleAssignmentId": admin["actor"]["roleAssignmentId"],
                "expectedVersion": reviewed.json()["record"]["version"], "payload": {}, "evidenceIds": [],
            }),
            (f"/projects/{self.project_a}/issues/{issue['id']}/close", {
                "roleAssignmentId": admin["actor"]["roleAssignmentId"],
                "expectedVersion": issue["version"], "payload": {"closureEvidenceIds": issue.get("evidenceIds", [])},
                "evidenceIds": issue.get("evidenceIds", []),
            }),
        ):
            before = self.state_snapshot()
            response = self.client.post(path, headers=self.headers(admin, key=uid()), json=body)
            self.assertEqual(response.status_code, 403, response.text)
            self.assert_state_unchanged(before)

        root_id = self.store.meta["scope"]["locationId"]
        created = self.client.post(
            f"/projects/{self.project_a}/parallel/locations",
            headers=self.headers(admin, key=uid()),
            json={"clientObjectId": uid(), "name": "Authority acceptance admin child",
                  "semanticAnchor": "acceptance/authority/" + uid(), "parentId": root_id},
        )
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()["record"]["projectId"], self.project_a)


if __name__ == "__main__":
    unittest.main()
