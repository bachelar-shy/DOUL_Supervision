"""Wave 2 validation for exact, bounded Location drawing-anchor references."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app
from services.api.modules.location.edit_routes import register_location_edit_routes


class LocationAnchorValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(str(Path(self.temp.name) / "state.sqlite3"), demo=True)
        self.store = self.app.state.store
        self.project = self.store.meta["projectId"]
        self.root_id = self.store.meta["scope"]["locationId"]
        self.client = TestClient(self.app)
        self.sessions = {group: self.login(group) for group in ("ADM", "SUP")}
        route_paths = {getattr(route, "path", "") for route in self.app.routes}
        if "/projects/{project_id}/parallel/locations/{location_id}" not in route_paths:
            # Wave 2's isolated worktree may predate the root installer. Exercise
            # the same adapter with real demo-session identities either way.
            def identity(request):
                token = request.headers.get("authorization", "").removeprefix("Bearer ")
                for session in self.sessions.values():
                    if token == session["accessToken"]:
                        return {**session["actor"], "accessToken": session["accessToken"]}
                from app.reference.validation import ContractError
                raise ContractError("UNAUTHENTICATED", "Demo login required")

            def role_for(session, project, role_id=None):
                from app.reference.validation import ContractError
                if project != self.project:
                    raise ContractError("PROJECT_MISMATCH", "Unavailable project")
                selected = role_id or session["roleAssignmentId"]
                role = self.store.engine.get("RoleAssignment", selected)
                if role["partyId"] != session["partyId"]:
                    raise ContractError("NOT_AUTHORIZED", "Role mismatch")
                return role

            register_location_edit_routes(
                self.app,
                store=self.store,
                identity=identity,
                role_for=role_for,
                demo_enabled=True,
                location_scope_check=lambda loc_id, role, record: self.store.engine._scope(
                    role.get("locationIds", []), loc_id, True
                ),
            )
        self.location = self.create_location()
        self.drawing = next(
            row for (kind, _), row in self.store.engine._records.items()
            if kind == "InformationItem" and row.get("subtype") == "Drawing"
            and row["projectId"] == self.project
        )

    def tearDown(self):
        self.client.close()
        self.store.close()
        self.temp.cleanup()

    def login(self, group):
        response = self.client.post("/dev/sessions", json={"actorGroup": group})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def headers(self, group="ADM", key=None):
        session = self.sessions[group]
        return {
            "Authorization": "Bearer " + session["accessToken"],
            "X-RoleAssignment-Id": session["actor"]["roleAssignmentId"],
            "Idempotency-Key": key or uid(),
        }

    def create_location(self):
        response = self.client.post(
            f"/projects/{self.project}/parallel/locations",
            headers=self.headers(),
            json={"clientObjectId": uid(), "name": "Anchor test", "semanticAnchor": "wave2/" + uid(), "parentId": self.root_id},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def anchor(self, **overrides):
        result = {
            "drawingRef": {"objectType": "InformationItem", "objectId": self.drawing["id"], "version": self.drawing["version"]},
            "page": 1,
            "x": 125.25,
            "y": 900.5,
            "coordinateSystem": "pdf_points",
        }
        return {**result, **overrides}

    def put(self, body, group="ADM", key=None):
        return self.client.put(
            f"/projects/{self.project}/parallel/locations/{self.location['id']}",
            headers=self.headers(group, key),
            json={"expectedVersion": self.location["version"], **body},
        )

    def stored_location(self):
        with self.store.transaction():
            return self.store.engine.get("Location", self.location["id"])

    def test_exact_historical_drawing_revision_is_preserved_without_page_box_guess(self):
        old_ref = {"objectType": "InformationItem", "objectId": self.drawing["id"], "version": self.drawing["version"]}
        newer = deepcopy(self.drawing)
        newer["version"] += 1
        newer["updatedAt"] = self.store.engine.at()
        with self.store.transaction(write=True):
            self.store.engine._save("InformationItem", newer)
        anchor = self.anchor(drawingRef=old_ref, x=1_000_000.25, y=-50_000.5)
        response = self.put({"drawingAnchors": [anchor]})
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()["record"]["drawingAnchors"]
        self.assertEqual(saved, [anchor])
        self.assertEqual(saved[0]["drawingRef"]["version"], old_ref["version"])

    def test_exact_cross_project_drawing_reference_is_hidden_without_location_mutation(self):
        foreign_revision = deepcopy(self.drawing)
        foreign_revision["version"] += 1
        foreign_revision["projectId"] = uid()
        foreign_revision["updatedAt"] = self.store.engine.at()
        with self.store.transaction(write=True):
            self.store.engine._save("InformationItem", foreign_revision)
        ref = {"objectType": "InformationItem", "objectId": self.drawing["id"], "version": foreign_revision["version"]}
        response = self.put({"drawingAnchors": [self.anchor(drawingRef=ref)]})
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.stored_location()["version"], self.location["version"])
        self.assertNotIn("drawingAnchors", self.stored_location())

    def test_duplicate_and_oversized_anchor_lists_return_422_without_mutation(self):
        one = self.anchor()
        duplicate = self.put({"drawingAnchors": [one, deepcopy(one)]})
        self.assertEqual(duplicate.status_code, 422, duplicate.text)
        self.assertIn("duplicate", duplicate.json().get("message", "").lower())
        self.assertEqual(self.stored_location()["version"], self.location["version"])

        oversized = [self.anchor(page=index + 1) for index in range(1001)]
        too_many = self.put({"drawingAnchors": oversized})
        self.assertEqual(too_many.status_code, 422, too_many.text)
        self.assertEqual(self.stored_location()["version"], self.location["version"])
        self.assertNotIn("drawingAnchors", self.stored_location())

    def test_anchor_shape_uuid_numeric_and_page_validation(self):
        malformed = self.anchor(drawingRef={"objectType": "InformationItem", "objectId": "not-a-uuid", "version": 1})
        cases = [
            malformed,
            {**self.anchor(), "extra": "ignored?"},
            self.anchor(page=True),
            self.anchor(page=0),
            self.anchor(x=float("inf")),
            self.anchor(y=float("nan")),
            self.anchor(x=True),
            self.anchor(coordinateSystem="css_pixels"),
        ]
        for candidate in cases:
            with self.subTest(candidate=str(candidate)):
                if candidate.get("x") == float("inf") or candidate.get("y") != candidate.get("y"):
                    response = self.client.put(
                        f"/projects/{self.project}/parallel/locations/{self.location['id']}",
                        headers=self.headers(),
                        content=json.dumps({"expectedVersion": self.location["version"], "drawingAnchors": [candidate]}, allow_nan=True),
                    )
                else:
                    response = self.put({"drawingAnchors": [candidate]})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(self.stored_location()["version"], self.location["version"])

    def test_non_admin_hidden_source_and_stale_partial_update_are_rejected(self):
        denied = self.put({"drawingAnchors": [self.anchor()]}, group="SUP")
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(self.stored_location()["version"], self.location["version"])

        saved = self.put({"drawingAnchors": [self.anchor()]})
        self.assertEqual(saved.status_code, 200, saved.text)
        previous_version = self.location["version"]
        stale = self.client.put(
            f"/projects/{self.project}/parallel/locations/{self.location['id']}",
            headers=self.headers(),
            json={"expectedVersion": previous_version, "name": "partial stale replacement", "drawingAnchors": []},
        )
        self.assertEqual(stale.status_code, 409, stale.text)
        current = self.stored_location()
        self.assertEqual(current["drawingAnchors"], [self.anchor()])
        self.assertEqual(current["version"], previous_version + 1)

        clear = self.client.put(
            f"/projects/{self.project}/parallel/locations/{self.location['id']}",
            headers=self.headers(),
            json={"expectedVersion": current["version"], "drawingAnchors": []},
        )
        self.assertEqual(clear.status_code, 200, clear.text)
        self.assertEqual(clear.json()["record"]["drawingAnchors"], [])

        hidden_revision = deepcopy(self.drawing)
        hidden_revision["version"] += 1
        hidden_revision["updatedAt"] = self.store.engine.at()
        hidden_revision["locationId"] = uid()
        with self.store.transaction(write=True):
            self.store.engine._save("InformationItem", hidden_revision)
        hidden_anchor = self.anchor(drawingRef={"objectType": "InformationItem", "objectId": self.drawing["id"], "version": hidden_revision["version"]})
        current_version = clear.json()["record"]["version"]
        hidden = self.client.put(
            f"/projects/{self.project}/parallel/locations/{self.location['id']}",
            headers=self.headers(),
            json={"expectedVersion": current_version, "drawingAnchors": [hidden_anchor]},
        )
        self.assertEqual(hidden.status_code, 403, hidden.text)
        after = self.stored_location()
        self.assertEqual(after["version"], current_version)
        self.assertEqual(after["drawingAnchors"], [])




if __name__ == "__main__":
    unittest.main()
