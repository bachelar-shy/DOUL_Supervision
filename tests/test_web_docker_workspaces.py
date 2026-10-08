"""Guard Docker web build copies all required local npm workspaces.

The Docker image intentionally installs dependencies before copying sources.
Both the root workspace manifests (npm ci) and recursively used web workspace
sources (tsc/Vite) must be present; host builds alone cannot guarantee this.
"""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WebDockerWorkspaceTests(unittest.TestCase):
    def test_web_docker_copies_workspace_manifests_and_imported_sources(self):
        root = json.loads((ROOT / "package.json").read_text())
        docker = (ROOT / "infra/docker/web.Dockerfile").read_text()

        workspaces = {}
        for path in root["workspaces"]:
            package_file = ROOT / path / "package.json"
            self.assertTrue(package_file.is_file(), str(package_file))
            workspace = json.loads(package_file.read_text())
            workspaces[workspace["name"]] = (path, workspace)
            manifest_copy = f"COPY {path}/package.json ./{path}/package.json"
            self.assertIn(manifest_copy, docker)
            self.assertLess(docker.index(manifest_copy), docker.index("RUN --mount"))
        self.assertEqual(len(workspaces), len(root["workspaces"]))

        queue = ["@doul/web"]
        visited = set()
        while queue:
            name = queue.pop()
            if name in visited:
                continue
            visited.add(name)
            self.assertIn(name, workspaces)
            path, workspace = workspaces[name]
            source_copy = f"COPY {path} ./{path}"
            self.assertIn(source_copy, docker)
            self.assertGreater(docker.index(source_copy), docker.index("RUN --mount"))
            self.assertLess(docker.index(source_copy), docker.index("RUN npm run web:build"))
            dependencies = workspace.get("dependencies", {})
            queue.extend(key for key in dependencies if key in workspaces)
        self.assertIn("@doul/localization", visited)
        self.assertIn("@doul/client", visited)

    def test_platform_container_workflow_triggers_on_shared_localization_changes(self):
        workflow = (ROOT / ".github/workflows/platform-container.yml").read_text()
        self.assertEqual(workflow.count('"packages/localization/**"'), 2)
        mvp = (ROOT / ".github/workflows/mvp.yml").read_text()
        self.assertIn("npx playwright test --config=playwright.config.ts", mvp)
        self.assertIn(
            "npx playwright test --config=playwright.localization.config.ts",
            mvp,
        )
        live = (ROOT / "playwright.config.ts").read_text()
        mock = (ROOT / "playwright.localization.config.ts").read_text()
        self.assertIn('testIgnore: ["localization.spec.ts"]', live)
        self.assertIn('testMatch: "localization.spec.ts"', mock)
        self.assertIn("doul-browser-${randomUUID()}.sqlite3", live)
        self.assertEqual(live.count("reuseExistingServer: false"), 2)


if __name__ == "__main__":
    unittest.main()
