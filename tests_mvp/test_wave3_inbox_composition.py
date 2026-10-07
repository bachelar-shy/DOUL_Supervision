"""Real API role projections remain identical when full preflight is paged."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from services.api.main import create_app
from services.api.modules.work_inbox import build_work_inbox

class InboxCompositionTests(unittest.TestCase):
    def test_all_human_roles_match_the_legacy_preflight_path_including_next_page(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(str(Path(directory) / "state.db"), demo=True)
            try:
                with TestClient(app) as client:
                    for group in ("SUP", "CON", "OWN", "DES", "ADM"):
                        session = client.post("/dev/sessions", json={"actorGroup": group}).json()
                        headers = {"Authorization": "Bearer " + session["accessToken"], "X-RoleAssignment-Id": session["actor"]["roleAssignmentId"]}
                        url = "/projects/" + session["projectId"] + "/parallel/work-inbox"
                        def legacy(*args, **kwargs):
                            kwargs.pop("has_candidates", None)
                            return build_work_inbox(*args, **kwargs)
                        cursor = None
                        for page in range(2):
                            with self.subTest(role=group, page=page):
                                params = {"limit": 2}
                                if cursor: params["cursor"] = cursor
                                actual = client.get(url, headers=headers, params=params)
                                with patch("services.api.main.build_work_inbox", legacy):
                                    expected = client.get(url, headers=headers, params=params)
                                self.assertEqual(actual.status_code, 200, actual.text)
                                self.assertEqual(expected.status_code, 200, expected.text)
                                self.assertEqual(actual.json(), expected.json())
                                cursor = actual.json()["nextCursor"]
                                if cursor is None: break
            finally:
                app.state.store.close()
