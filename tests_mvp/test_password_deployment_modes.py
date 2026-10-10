"""Reject a web/API authentication-mode mismatch before field deployment."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PasswordDeploymentModesTest(unittest.TestCase):
    def test_external_base_has_no_private_signing_key_requirement(self):
        base = (ROOT / "infra/compose/compose.operational.yml").read_text()
        self.assertNotIn("DOUL_AUTH_MODE:", base)
        self.assertNotIn("DOUL_AUTH_PRIVATE_KEY_FILE:", base)
        self.assertNotIn("auth-private-key", base)

    def test_password_overlay_requires_explicit_mode_and_private_key(self):
        overlay = (ROOT / "infra/compose/compose.operational.password.yml").read_text()
        self.assertIn("DOUL_AUTH_MODE: local-password", overlay)
        self.assertIn("DOUL_AUTH_PRIVATE_KEY_FILE: /run/secrets/auth-private-key", overlay)
        self.assertIn("- auth-private-key", overlay)
        self.assertIn("auth-private-key:", overlay)

    def test_vite_auth_is_explicit_at_build_time(self):
        docker = (ROOT / "infra/docker/web.Dockerfile").read_text()
        app = (ROOT / "apps/web/src/App.tsx").read_text()
        self.assertIn("ARG VITE_DOUL_AUTH_MODE=external", docker)
        self.assertIn("ENV VITE_DOUL_AUTH_MODE=", docker)
        self.assertIn('configured === "password"', app)
        self.assertIn('mode === "password" ? "valid" : "invalid"', app)
        self.assertIn('if (!localDev && !passwordMode)', app)


if __name__ == "__main__":
    unittest.main()
