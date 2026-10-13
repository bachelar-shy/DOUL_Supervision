"""End-to-end HTTP contracts for five parallel Fieldwire-style field features.

Only original DOUL Domain/Authority/State Machine records are authoritative.
This suite checks actual API mounting, auth, persistence, idempotency and
separation of informal collaboration from official workflow commands.
"""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from app.reference.engine import uid
from app.reference.validation import ContractError
from services.api.main import create_app


class FieldwireFiveHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.temp.name) / "state.sqlite")
        self.app = create_app(self.db, demo=True)
        self.store = self.app.state.store
        self.http = TestClient(self.app)
        self.project = self.store.meta["projectId"]
        self.tokens = {}
        self.actors = {}
        for group in ("ADM", "SUP", "CON", "OWN"):
            response = self.http.post("/dev/sessions", json={"actorGroup": group})
            self.assertEqual(response.status_code, 200, response.text)
            session = response.json()
            self.tokens[group] = session["accessToken"]
            self.actors[group] = session["actor"]
        # Synthetic fixtures normally give ADM a bounded task scope. The
        # project-settings authority requires explicit full-site scope.
        # Grant it *only* to this disposable demo actor (never production).
        with self.store.transaction(write=True):
            role_id = self.actors["ADM"]["roleAssignmentId"]
            role = self.store.engine.get("RoleAssignment", role_id)
            role["disciplines"] = ["*"]
            role["packageIds"] = ["*"]
            role["locationIds"] = ["*"]
            self.store.engine._save("RoleAssignment", role)

    def tearDown(self):
        self.http.close()
        self.store.close()
        self.temp.cleanup()

    def headers(self, group="ADM", *, key=None):
        return {"Authorization": "Bearer " + self.tokens[group],
                "X-RoleAssignment-Id": self.actors[group]["roleAssignmentId"],
                "Idempotency-Key": key or uid()}

    def endpoint(self, suffix):
        return f"/projects/{self.project}/field/{suffix}"

    def visible(self, kind, group="ADM"):
        actor = self.actors[group]
        with self.store.transaction():
            for (obj_type, _), row in self.store.engine._records.items():
                if obj_type != kind or row.get("projectId") != self.project:
                    continue
                try:
                    self.store.engine.authorize_read(
                        row, actor["partyId"], actor["roleAssignmentId"])
                    return {"objectType": kind, "objectId": row["id"], "version": row["version"]}
                except ContractError:
                    continue
        self.fail("Demo fixture needs visible " + kind)

    def test_photo_gallery_filters_and_read_security(self):
        path = self.endpoint("photos")
        res = self.http.get(path, headers=self.headers("SUP"),
            params={"media": "photo", "limit": 25, "offset": 0})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["projectId"], self.project)
        self.assertTrue(all(item["mediaType"] == "photo" for item in body["items"]))
        self.assertEqual(self.http.get(path).status_code, 401)
        self.assertEqual(self.http.get(self.endpoint("photos").replace(self.project, uid()),
            headers=self.headers("SUP")).status_code, 404)
        self.assertEqual(self.http.get(path, headers=self.headers("ADM"),
            params={"limit": 201}).status_code, 422)
        forbidden = self.http.post(self.endpoint("photos/tags"),
            headers=self.headers("OWN"),
            json={"evidenceIds": [uid()], "tags": ["지붕"], "expectedVersions": {}})
        self.assertNotEqual(forbidden.status_code, 200)

    def test_project_checklist_publish_attach_answer_and_idempotency(self):
        path = self.endpoint("checklists/templates")
        item = {"title": "철근·거푸집 검측", "items": [
            {"key": "spacing", "label": "철근 간격", "type": "number", "required": True},
            {"key": "surface", "label": "상태", "type": "pass_fail", "required": False}]}
        own = self.http.post(path, headers=self.headers("OWN"), json=item)
        self.assertEqual(own.status_code, 403, own.text)
        key = uid()
        first = self.http.post(path, headers=self.headers("ADM", key=key), json=item)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(self.http.post(path, headers=self.headers("ADM", key=key), json=item).json(), first.json())
        template = first.json()["template"]
        self.assertEqual(template["status"], "draft")
        self.assertEqual(self.http.post(self.endpoint("checklists/templates/" + template["id"] + "/publish"),
            headers=self.headers("ADM"), json={"expectedVersion": 99}).status_code, 409)
        published = self.http.post(self.endpoint("checklists/templates/" + template["id"] + "/publish"),
            headers=self.headers("ADM"), json={"expectedVersion": 1})
        self.assertEqual(published.status_code, 200, published.text)
        self.assertEqual(published.json()["template"]["status"], "published")
        subject = self.visible("Inspection", "ADM")
        created = self.http.post(self.endpoint("checklists/runs"), headers=self.headers("ADM"),
            json={"templateId": template["id"], "templateVersion": 2, "subjectRef": subject})
        self.assertEqual(created.status_code, 200, created.text)
        run = created.json()["run"]
        answer = self.http.post(self.endpoint("checklists/runs/" + run["id"] + "/answers"),
            headers=self.headers("ADM"), json={"expectedVersion": 1, "answers": {"spacing": 160}})
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(answer.json()["run"]["answers"]["spacing"]["value"], 160)
        self.assertEqual(answer.json()["run"]["status"], "draft")
        self.assertEqual(self.http.post(self.endpoint("checklists/runs/" + run["id"] + "/answers"),
            headers=self.headers("ADM"),
            json={"expectedVersion": 1, "answers": {"spacing": 170}}).status_code, 409)
        revised = self.http.post(self.endpoint("checklists/templates/" + template["id"] + "/revise"),
            headers=self.headers("ADM"), json={"expectedVersion": 2,
                "title": item["title"], "items": item["items"]})
        self.assertEqual(revised.status_code, 200, revised.text)
        edited = self.http.post(self.endpoint("checklists/templates/" + template["id"] + "/draft"),
            headers=self.headers("ADM"), json={"expectedVersion": 3,
                "title": "철근·거푸집 검측 개정", "items": [
                    {**item["items"][0], "label": "철근 간격(mm)"},
                    item["items"][1]]})
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()["template"]["version"], 4)
        newer = self.http.post(self.endpoint("checklists/templates/" + template["id"] + "/publish"),
            headers=self.headers("ADM"), json={"expectedVersion": 4})
        self.assertEqual(newer.status_code, 200, newer.text)
        self.assertEqual(newer.json()["template"]["version"], 5)
        runs = self.http.get(self.endpoint("checklists/runs"), headers=self.headers("ADM"),
            params={"subjectId": subject["objectId"]})
        self.assertEqual(runs.status_code, 200, runs.text)
        self.assertEqual(runs.json()["items"][0]["templateSnapshot"]["items"][0]["label"], "철근 간격")
        with self.store.transaction():
            official = self.store.engine.get("Inspection", subject["objectId"])
            self.assertEqual(official["version"], subject["version"])

    def test_work_area_nested_create_rename_and_cycle_prevention(self):
        base = self.endpoint("work-areas")
        root = self.store.meta["scope"]["locationId"]
        self.assertEqual(self.http.post(base, headers=self.headers("CON"),
            json={"name": "A동", "parentId": root, "kind": "building"}).status_code, 403)
        created = self.http.post(base, headers=self.headers("ADM"),
            json={"name": "A동", "parentId": root, "kind": "building"})
        self.assertEqual(created.status_code, 200, created.text)
        area = created.json()["record"]
        self.assertEqual(area["parentId"], root)
        child = self.http.post(base, headers=self.headers("ADM"),
            json={"name": "2층", "parentId": area["id"], "kind": "floor"})
        self.assertEqual(child.status_code, 200, child.text)
        child_id = child.json()["record"]["id"]
        read = self.http.get(base, headers=self.headers("ADM"))
        self.assertEqual(read.status_code, 200, read.text)
        self.assertIn(child_id, [r["reference"]["objectId"] for r in read.json()["items"]])
        cycle = self.http.post(base + "/" + area["id"] + "/edit",
            headers=self.headers("ADM"),
            json={"name": "A동", "parentId": child_id, "expectedVersion": 1})
        self.assertEqual(cycle.status_code, 409, cycle.text)
        rename = self.http.post(base + "/" + child_id + "/edit",
            headers=self.headers("ADM"),
            json={"name": "3층", "parentId": area["id"], "expectedVersion": 1})
        self.assertEqual(rename.status_code, 200, rename.text)
        self.assertEqual(rename.json()["record"]["version"], 2)

    def test_offline_preflight_checks_real_versions_without_executing(self):
        target = self.visible("Inspection", "SUP")
        actor = self.actors["SUP"]
        ref = {"projectId": self.project, "actorId": actor["partyId"],
               "roleId": actor["roleAssignmentId"],
               "machine": "inspection", "itemId": target["objectId"],
               "command": "request", "payload": {},
               "evidenceIds": [], "requestKey": uid(),
               "expectedVersion": target["version"]}
        path = self.endpoint("offline/preflight")
        exact = self.http.post(path, headers=self.headers("SUP"), json={"intents": [ref]})
        self.assertEqual(exact.status_code, 200, exact.text)
        self.assertTrue(exact.json()["items"][0]["autoSubmit"])
        stale = self.http.post(path, headers=self.headers("SUP"),
            json={"intents": [{**ref, "expectedVersion": target["version"] + 1}]})
        self.assertEqual(stale.status_code, 200, stale.text)
        self.assertEqual(stale.json()["items"][0]["result"], "conflict_requires_user_review")
        self.assertEqual(stale.json()["officialCommandsExecuted"], 0)
        other_user = self.http.post(path, headers=self.headers("SUP"),
            json={"intents": [{**ref, "actorId": uid()}]})
        self.assertEqual(other_user.status_code, 403)
        with self.store.transaction():
            official = self.store.engine.get("Inspection", target["objectId"])
            self.assertEqual(official["version"], target["version"])

    def test_discussions_are_persistent_and_not_formal_approvals(self):
        ref = self.visible("Issue", "SUP")
        path = self.endpoint("discussions/comments")
        body = {"subjectRef": ref, "message": "현장 철근 간격 확인 바랍니다.",
                "mentionPartyIds": [], "evidenceRefs": []}
        key = uid()
        first = self.http.post(path, headers=self.headers("SUP", key=key), json=body)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertFalse(first.json()["comment"]["officialDecision"])
        replay = self.http.post(path, headers=self.headers("SUP", key=key), json=body)
        self.assertEqual(replay.json(), first.json())
        bad = self.http.post(path, headers=self.headers("SUP"),
            json={**body, "subjectRef": {**ref, "objectId": uid()}})
        self.assertNotEqual(bad.status_code, 200)
        res = self.http.get(self.endpoint("discussions"), headers=self.headers("SUP"),
            params={"subjectType": ref["objectType"], "subjectId": ref["objectId"], "version": ref["version"]})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["count"], 1)
        with self.store.transaction():
            official = self.store.engine.get("Issue", ref["objectId"])
            self.assertEqual(official["version"], ref["version"])
        self.http.close()
        self.store.close()
        reopened = create_app(self.db, demo=True)
        try:
            with reopened.state.store.transaction():
                self.assertEqual(len(reopened.state.store.meta["fieldTaskDiscussions"][self.project]["Issue:" + ref["objectId"]]["comments"]), 1)
        finally:
            reopened.state.store.close()
        self.app = create_app(self.db, demo=True)
        self.store = self.app.state.store
        self.http = TestClient(self.app)


if __name__ == "__main__":
    unittest.main()
