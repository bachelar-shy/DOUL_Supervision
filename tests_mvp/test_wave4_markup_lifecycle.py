"""Lifecycle, audit, idempotency and tombstone tests for PDF markups."""
from copy import deepcopy
from uuid import uuid4

from tests_mvp.test_wave3_drawing_markups import DrawingMarkupTests


class DrawingMarkupLifecycleTests(DrawingMarkupTests):
    def edit_body(self, expected_version=1, **overrides):
        return {
            "expectedVersion": expected_version,
            "text": "Relocated seal check",
            "rect": {"x1": 15, "y1": 25, "x2": 90, "y2": 110},
            "reason": "Clarified location after coordination",
            **overrides,
        }

    def edit_markup(self, markup_id, body, key="markup-edit-1"):
        return self.client.put(
            f"/projects/{self.project}/parallel/drawing-markups/{markup_id}",
            json=body, headers=self.headers(key),
        )

    def delete_markup(self, markup_id, body, key="markup-delete-1"):
        return self.client.request(
            "DELETE", f"/projects/{self.project}/parallel/drawing-markups/{markup_id}",
            json=body, headers=self.headers(key),
        )

    def test_edit_history_conflicts_tombstone_and_stable_retries(self):
        created = self.create_markup()
        self.assertEqual(created.status_code, 201, created.text)
        markup = created.json()
        markup_id = markup["id"]
        detail_path = f"/projects/{self.project}/parallel/drawing-markups/{markup_id}"
        history_path = detail_path + "/history"
        # Simulate a Wave 3 record that predates the history collection.
        with self.store.transaction(True):
            self.store.meta["drawingMarkupHistory"] = []

        detail = self.client.get(detail_path, headers=self.headers())
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual([item["command"] for item in detail.json()["availableCommands"]], ["edit", "delete"])
        self.assertEqual(detail.json()["historySummary"], {"count": 1, "latestVersion": 1})
        history1 = self.client.get(history_path, headers=self.headers())
        self.assertEqual(history1.status_code, 200, history1.text)
        self.assertEqual([item["version"] for item in history1.json()["items"]], [1])

        edit_body = self.edit_body()
        edited = self.edit_markup(markup_id, edit_body)
        self.assertEqual(edited.status_code, 200, edited.text)
        version2 = edited.json()
        self.assertEqual(version2["version"], 2)
        self.assertEqual(version2["text"], "Relocated seal check")
        self.assertEqual(version2["rect"], edit_body["rect"])
        self.assertEqual(version2["historySummary"], {"count": 2, "latestVersion": 2})
        replay = self.edit_markup(markup_id, edit_body)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), version2)
        changed = self.edit_markup(markup_id, self.edit_body(text="Different"))
        self.assertEqual(changed.status_code, 409, changed.text)
        stale = self.edit_markup(markup_id, self.edit_body(expected_version=1), key="stale-edit")
        self.assertEqual(stale.status_code, 409, stale.text)

        history2 = self.client.get(history_path, headers=self.headers())
        self.assertEqual([item["version"] for item in history2.json()["items"]], [1, 2])
        self.assertEqual(history2.json()["items"][0]["text"], markup["text"])
        self.assertEqual(history2.json()["items"][1]["rect"], edit_body["rect"])
        self.assertEqual(self.store.meta["drawingMarkupAudit"][-1]["reason"], edit_body["reason"])

        deleted_body = {"expectedVersion": 2, "reason": "Superseded annotation"}
        deleted = self.delete_markup(markup_id, deleted_body)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        tombstone = deleted.json()
        self.assertEqual(tombstone["version"], 3)
        self.assertTrue(tombstone["deletedAt"])
        self.assertEqual(tombstone["deletedBy"], self.actor["partyId"])
        self.assertEqual(tombstone["deleteReason"], deleted_body["reason"])
        self.assertEqual(tombstone["availableCommands"], [])
        delete_replay = self.delete_markup(markup_id, deleted_body)
        self.assertEqual(delete_replay.status_code, 200, delete_replay.text)
        self.assertEqual(delete_replay.json(), tombstone)
        delete_conflict = self.delete_markup(markup_id, {**deleted_body, "reason": "Different"})
        self.assertEqual(delete_conflict.status_code, 409, delete_conflict.text)
        post_delete_edit = self.edit_markup(markup_id, self.edit_body(expected_version=3), key="post-delete")
        self.assertEqual(post_delete_edit.status_code, 409, post_delete_edit.text)

        listing = self.client.get(f"/projects/{self.project}/parallel/drawing-markups",
                                  params={"bindingId": self.binding_id}, headers=self.headers())
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(listing.json()["items"], [])
        tombstone_detail = self.client.get(detail_path, headers=self.headers())
        self.assertEqual(tombstone_detail.status_code, 200, tombstone_detail.text)
        self.assertEqual(tombstone_detail.json()["deletedAt"], tombstone["deletedAt"])
        history3 = self.client.get(history_path, headers=self.headers())
        self.assertEqual([item["version"] for item in history3.json()["items"]], [1, 2, 3])
        self.assertTrue(history3.json()["items"][-1]["deletedAt"])

    def test_issue_link_retains_historical_markup_version_and_blocks_new_links_after_delete(self):
        created = self.create_markup()
        markup_id = created.json()["id"]
        first_edit = self.edit_markup(markup_id, self.edit_body(), key="pre-issue-edit")
        self.assertEqual(first_edit.status_code, 200, first_edit.text)
        markup_version = first_edit.json()["version"]
        self.assertEqual(markup_version, 2)

        inspection, observation = self.issue_fixture()
        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        issue_body = self.issue_body(inspection, observation)
        issue_body["expectedMarkupVersion"] = markup_version
        issue_key = "historical-markup-issue"
        issue_route = f"/projects/{self.project}/parallel/drawing-markups/{markup_id}/issues"
        issued = self.client.post(issue_route, json=issue_body, headers=self.headers(issue_key))
        self.assertEqual(issued.status_code, 201, issued.text)
        response = issued.json()
        self.assertEqual(response["link"]["markupVersion"], markup_version)

        self.actor = deepcopy(self.store.meta["actors"]["ADM"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        issue = deepcopy(response["issue"])
        action = deepcopy(response["correctiveAction"])
        hidden_issue, hidden_action = deepcopy(issue), deepcopy(action)
        hidden_issue["projectId"] = str(uuid4())
        hidden_action["projectId"] = str(uuid4())
        with self.store.transaction(True):
            self.store.engine._records[("Issue", issue["id"])] = hidden_issue
            self.store.engine._records[("Action", action["id"])] = hidden_action
        edit_retry = self.edit_markup(markup_id, self.edit_body(), key="pre-issue-edit")
        self.assertEqual(edit_retry.status_code, 200, edit_retry.text)
        self.assertNotIn("issueLink", edit_retry.json())
        with self.store.transaction(True):
            self.store.engine._records[("Issue", issue["id"])] = issue
            self.store.engine._records[("Action", action["id"])] = action
        later_edit = self.edit_markup(markup_id, self.edit_body(expected_version=2, text="Third revision"), key="post-issue-edit")
        self.assertEqual(later_edit.status_code, 200, later_edit.text)
        self.assertEqual(later_edit.json()["version"], 3)
        self.assertEqual(later_edit.json()["issueLink"]["markupVersion"], markup_version)

        deleted_body = {"expectedVersion": 3, "reason": "Markup no longer needed"}
        tombstone = self.delete_markup(markup_id, deleted_body, key="after-issue-delete")
        self.assertEqual(tombstone.status_code, 200, tombstone.text)
        self.assertEqual(tombstone.json()["issueLink"]["markupVersion"], markup_version)

        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        same_issue_retry = self.client.post(issue_route, json=issue_body, headers=self.headers(issue_key))
        self.assertEqual(same_issue_retry.status_code, 200, same_issue_retry.text)
        self.assertEqual(same_issue_retry.json(), response)
        new_issue = {**issue_body, "issueObjectId": str(uuid4()), "actionObjectId": str(uuid4())}
        blocked = self.client.post(issue_route, json=new_issue, headers=self.headers("new-after-delete"))
        self.assertEqual(blocked.status_code, 409, blocked.text)

    def test_tombstone_and_history_persist_across_restart_for_read_only_roles(self):
        markup_id = self.create_markup().json()["id"]
        edit = self.edit_markup(markup_id, self.edit_body(), key="persist-edit")
        self.assertEqual(edit.status_code, 200, edit.text)
        removed = self.delete_markup(markup_id, {"expectedVersion": 2, "reason": "No longer applicable"},
                                     key="persist-delete")
        self.assertEqual(removed.status_code, 200, removed.text)

        self.client.close()
        self.store.close()
        self.store = type(self.store)(self.db_path)
        self.actor = deepcopy(self.store.meta["actors"]["SUP"])
        self.role = self.store.engine.get("RoleAssignment", self.actor["roleAssignmentId"])
        self._build_app()
        self.addCleanup(self.client.close)
        self.addCleanup(self.store.close)

        detail_path = f"/projects/{self.project}/parallel/drawing-markups/{markup_id}"
        detail = self.client.get(detail_path, headers=self.headers())
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["version"], 3)
        self.assertEqual(detail.json()["deletedBy"], self.store.meta["actors"]["ADM"]["partyId"])
        self.assertEqual(detail.json()["availableCommands"], [])
        history = self.client.get(detail_path + "/history", headers=self.headers())
        self.assertEqual([item["version"] for item in history.json()["items"]], [1, 2, 3])
        listing = self.client.get(f"/projects/{self.project}/parallel/drawing-markups",
                                  params={"bindingId": self.binding_id}, headers=self.headers())
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(listing.json()["items"], [])
        denied = self.edit_markup(markup_id, self.edit_body(expected_version=3), key="readonly-edit")
        self.assertEqual(denied.status_code, 403, denied.text)
