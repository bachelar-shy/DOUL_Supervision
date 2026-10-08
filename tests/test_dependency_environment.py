import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("dependency_environment", Path(__file__).resolve().parents[1] / "scripts/dependency_environment.py")
dep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dep)

class DependencyEnvironmentTests(unittest.TestCase):
    def test_exact_python_versions_and_pollution(self):
        self.assertEqual(dep.compare_python({"a-b": "1"}, [("A_B", "1"), ("pip", "25")]), [])
        self.assertEqual(len(dep.compare_python({"a": "1", "b": "2"}, [("a", "3"), ("other", "1")])), 3)

    def test_duplicate_distribution_fails(self):
        self.assertTrue(dep.compare_python({"a": "1"}, [("a", "1"), ("A", "1")]))

    def test_exact_pin_parser_and_binary_extra(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lock"
            path.write_text("psycopg[binary]==3.2.10\n")
            self.assertEqual(dep.read_pins(path), {"psycopg": "3.2.10", "psycopg-binary": "3.2.10"})
            for invalid in ("foo>=1", "foo==1; python_version > '3'", "foo[unknown]==1", ""):
                path.write_text(invalid)
                with self.assertRaises(ValueError):
                    dep.read_pins(path)

    def test_hash_changes_on_lock_change(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lock"
            path.write_text("a==1")
            old = dep.digest(path)
            path.write_text("a==2")
            self.assertNotEqual(old, dep.digest(path))

    def test_node_missing_optional_and_wrong_exact_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text('{"dependencies":{"a":"^1"}}')
            package = root / "node_modules/a"
            package.mkdir(parents=True)
            (package / "package.json").write_text('{"version":"1.2"}')
            locked = {"": {"dependencies": {"a": "^1"}},
                      "node_modules/a": {"version": "1.1"},
                      "node_modules/optional": {"version": "1", "optional": True},
                      "node_modules/required": {"version": "1"}}
            errors, _, _ = dep.compare_node(root, locked)
            self.assertEqual(len(errors), 2)
            locked[""]["dependencies"]["a"] = "^2"
            self.assertEqual(len(dep.compare_node(root, locked)[0]), 3)

    def test_workspace_link_must_point_to_current_worktree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "apps/current").mkdir(parents=True)
            (root / "apps/other").mkdir(parents=True)
            (root / "node_modules").mkdir()
            link = root / "node_modules/client"
            link.symlink_to(root / "apps/other")
            packages = {"node_modules/client": {"link": True, "resolved": "apps/current"}}
            self.assertTrue(dep.compare_node(root, packages)[0])
            link.unlink()
            link.symlink_to(root / "apps/current")
            self.assertFalse(dep.compare_node(root, packages)[0])

    def test_node_only_cannot_bypass_python_suite_validation(self):
        result = subprocess.run([sys.executable, spec.origin, "--node-only", "--suite", "api"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--suite requires Python validation", result.stderr)

    def test_failed_preflight_never_executes_test_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "requirements.lock").write_text("definitely-missing-package==1\n")
            marker = root / "executed"
            result = subprocess.run([sys.executable, spec.origin, "--root", str(root),
                                     "--python", sys.executable, "--lock", "requirements.lock",
                                     "--", "{python}", "-c", f"open({str(marker)!r}, 'w').close()"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(marker.exists())
            report = json.loads((root / ".local/dependency-environment.json").read_text())
            self.assertFalse(report["ok"])
            self.assertIn("lock_sha256", report["python"])

if __name__ == "__main__":
    unittest.main()
