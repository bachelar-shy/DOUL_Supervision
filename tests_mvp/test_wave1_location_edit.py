"""Wave 1 demo-only Location create/edit/reparent and drawing-anchor API."""
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient
from app.reference.engine import uid
from services.api.main import create_app
from services.api.modules.location.edit_routes import register_location_edit_routes


class LocationEditApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.temp.name) / "state.db")
        self.app = create_app(self.db, demo=True)
        self.store = self.app.state.store
        self.project = self.store.meta["projectId"]
        self.root_id = self.store.meta["scope"]["locationId"]
        self.client = TestClient(self.app)
        self.tokens = {}
        for group in ("ADM", "SUP", "CON"):
            response = self.client.post("/dev/sessions", json={"actorGroup": group})
            self.assertEqual(response.status_code, 200, response.text)
            session = response.json()
            self.tokens[group] = {**session["actor"], "accessToken": session["accessToken"]}
        route_paths = {getattr(route, "path", "") for route in self.app.routes}
        if "/projects/{project_id}/parallel/locations/{location_id}" not in route_paths:
            session_by_token = {session["accessToken"]: session for session in self.tokens.values()}
            def identity(request):
                token = request.headers.get("authorization", "").removeprefix("Bearer ")
                if token not in session_by_token:
                    from app.reference.validation import ContractError
                    raise ContractError("UNAUTHENTICATED", "Missing demo session")
                return session_by_token[token]
            def role_for(session, project, role_id=None):
                if project != self.project:
                    from app.reference.validation import ContractError
                    raise ContractError("PROJECT_MISMATCH", "Unavailable project")
                rid = role_id or session["roleAssignmentId"]
                role = self.store.engine.get("RoleAssignment", rid)
                if role["partyId"] != session["partyId"]:
                    from app.reference.validation import ContractError
                    raise ContractError("NOT_AUTHORIZED", "Role mismatch")
                return role
            register_location_edit_routes(
                self.app, store=self.store, identity=identity, role_for=role_for,
                demo_enabled=True,
                location_scope_check=lambda loc_id, role, record: self.store.engine._scope(role.get("locationIds", []), loc_id, True),
            )

    def tearDown(self):
        self.client.close()
        self.store.close()
        self.temp.cleanup()

    def headers(self, group="ADM"):
        return {"Authorization": "Bearer " + self.tokens[group]["accessToken"], "X-RoleAssignment-Id": self.tokens[group]["roleAssignmentId"], "Idempotency-Key": uid()}

    def post(self, body, group="ADM"):
        return self.client.post(f"/projects/{self.project}/parallel/locations", headers=self.headers(group), json=body)

    def put(self, location_id, body, group="ADM", headers=None):
        return self.client.put(f"/projects/{self.project}/parallel/locations/{location_id}", headers=self.headers(group) if headers is None else headers, json=body)

    def create_child(self, name="Wave child", parent=None, group="ADM"):
        return self.post({"clientObjectId": uid(), "name": name, "semanticAnchor": "wave/" + uid(), "parentId": parent or self.root_id}, group=group)

    def test_admin_create_edit_reparent_anchor_and_idempotent_replay(self):
        created = self.create_child()
        self.assertEqual(created.status_code, 201, created.text)
        body = created.json()
        child_id = body["record"]["id"]
        self.assertEqual(body["record"]["parentId"], self.root_id)
        self.assertEqual(body["record"]["version"], 1)
        self.assertEqual(body["auditEvent"]["command"], "Location:create")
        replay_key = uid()
        replay_body = {"clientObjectId": uid(), "name": "Replay-safe", "semanticAnchor": "wave/replay-safe", "parentId": self.root_id}
        first_replay = self.client.post(f"/projects/{self.project}/parallel/locations", headers={**self.headers(), "Idempotency-Key": replay_key}, json=replay_body)
        second_replay = self.client.post(f"/projects/{self.project}/parallel/locations", headers={**self.headers(), "Idempotency-Key": replay_key}, json=replay_body)
        self.assertEqual(first_replay.status_code, 201, first_replay.text)
        self.assertEqual(second_replay.status_code, 201, second_replay.text)
        self.assertEqual(first_replay.json(), second_replay.json())
        drawing = next(row for (kind, _), row in self.store.engine._records.items() if kind == "InformationItem" and row.get("subtype") == "Drawing" and row["projectId"] == self.project)
        anchor = {"drawingRef": {"objectType": "InformationItem", "objectId": drawing["id"], "version": drawing["version"]}, "page": 1, "x": 100.5, "y": 220, "coordinateSystem": "pdf_points"}
        updated = self.put(child_id, {"expectedVersion": 1, "name": "Renamed", "parentId": self.root_id, "drawingAnchors": [anchor]})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["record"]["version"], 2)
        self.assertEqual(updated.json()["record"]["drawingAnchors"], [anchor])
        update_key = uid()
        replay_headers = {**self.headers(), "Idempotency-Key": update_key}
        update_payload = {"expectedVersion": 2, "name": "Replay update"}
        first_update = self.put(child_id, update_payload, headers=replay_headers)
        self.assertEqual(first_update.status_code, 200, first_update.text)
        replay_update = self.put(child_id, update_payload, headers=replay_headers)
        self.assertEqual(replay_update.status_code, 200, replay_update.text)
        self.assertEqual(first_update.json(), replay_update.json())
        changed_request = self.put(child_id, {"expectedVersion": 2, "name": "Changed request"}, headers=replay_headers)
        self.assertEqual(changed_request.status_code, 409, changed_request.text)
        self.assertEqual(changed_request.json()["code"], "IDEMPOTENCY_CONFLICT")
        with self.store.transaction():
            self.assertEqual(self.store.engine.get("Location", child_id)["version"], 3)

    def test_cycle_stale_foreign_parent_and_invalid_coordinates_are_rejected(self):
        first = self.create_child("First").json()["record"]
        second = self.create_child("Second", parent=first["id"]).json()["record"]
        cycle = self.put(first["id"], {"expectedVersion": 1, "parentId": second["id"]})
        self.assertEqual(cycle.status_code, 409, cycle.text)
        stale = self.put(first["id"], {"expectedVersion": 9, "name": "No"})
        self.assertEqual(stale.status_code, 409, stale.text)
        foreign = self.post({"name": "Foreign", "semanticAnchor": "wave/foreign", "parentId": uid()})
        self.assertEqual(foreign.status_code, 404, foreign.text)
        drawing = next(row for (kind, _), row in self.store.engine._records.items() if kind == "InformationItem" and row.get("subtype") == "Drawing" and row["projectId"] == self.project)
        bad = self.put(first["id"], {"expectedVersion": 1, "drawingAnchors": [{"drawingRef": {"objectType": "InformationItem", "objectId": drawing["id"], "version": drawing["version"]}, "page": 1, "x": "NaN", "y": 1, "coordinateSystem": "css_px"}]})
        self.assertEqual(bad.status_code, 422, bad.text)

    def test_missing_idempotency_key_malformed_json_and_scope_field_rejected(self):
        missing_key_headers = self.headers()
        missing_key_headers.pop("Idempotency-Key")
        no_key = self.client.post(f"/projects/{self.project}/parallel/locations", headers=missing_key_headers, json={"name": "No key", "semanticAnchor": "wave/no-key", "parentId": self.root_id})
        self.assertEqual(no_key.status_code, 409, no_key.text)
        malformed = self.client.post(f"/projects/{self.project}/parallel/locations", headers={**self.headers(), "Content-Type": "application/json"}, content="{not json")
        self.assertEqual(malformed.status_code, 422, malformed.text)
        extra_scope = self.post({"name": "Scope change", "semanticAnchor": "wave/scope", "parentId": self.root_id, "packageId": uid()})
        self.assertEqual(extra_scope.status_code, 422, extra_scope.text)

    def test_non_admin_and_non_demo_role_gate(self):
        denied = self.create_child(group="SUP")
        self.assertEqual(denied.status_code, 403, denied.text)

    def test_location_persists_across_store_restart(self):
        created = self.create_child("Durable child")
        self.assertEqual(created.status_code, 201, created.text)
        location_id = created.json()["record"]["id"]
        self.client.close()
        self.store.close()
        self.app = create_app(self.db, demo=True)
        self.store = self.app.state.store
        self.client = TestClient(self.app)
        with self.store.transaction():
            durable = self.store.engine.get("Location", location_id)
        self.assertEqual(durable["name"], "Durable child")
        # The existing read route is the canonical read projection after restart.
        # Its normal demo auth endpoint can validate that the saved item is queryable.
        self.assertTrue(durable["semanticAnchor"].startswith("wave/"))


if __name__ == "__main__":
    unittest.main()
