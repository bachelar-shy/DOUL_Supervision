"""Deterministic translation adapter checks (Ollama network mocked)."""
import io
import json
import unittest
from unittest.mock import patch

from services.api.modules.translation_preview import protected_tokens, translate_text


class FakeResponse:
    def __enter__(self): return self
    def __exit__(self, *args): return None
    def read(self, max_bytes): return json.dumps({
        "response": "B-3 구역 스터럽 철근을 콘크리트 타설 전에 보완해야 합니다.",
        "eval_count": 36, "total_duration": 2_500_000_000
    }).encode()


class TranslationTests(unittest.TestCase):
    def test_numeric_and_drawing_token_protection(self):
        self.assertEqual(protected_tokens("B-3 / 25 mm / 30 mm"), protected_tokens("B-3 25 mm 30 mm"))
        self.assertNotEqual(protected_tokens("25 mm"), protected_tokens("26 mm"))

    def test_model_preview_never_changes_source_or_grants_issue(self):
        original = "Khu vực B-3 cần bổ sung thép đai trước khi đổ bê tông."
        with patch("services.api.modules.translation_preview.urlopen", return_value=FakeResponse()) as call:
            result = translate_text(original, "vi", "ko")
        self.assertEqual(result["original"], original)
        self.assertTrue(result["protectedTokensMatch"])
        self.assertEqual(result["reviewStatus"], "automatic_unverified")
        self.assertFalse(result["usableForOfficialIssue"])
        request = call.call_args.args[0]
        self.assertFalse(json.loads(request.data)["think"])

    def test_reject_invalid_languages_and_ssrf(self):
        with self.assertRaises(ValueError):
            translate_text("hello", "en", "ko")
        with self.assertRaises(ValueError):
            translate_text("test", "vi", "ko", endpoint="http://example.org/api/generate")

    def test_reject_unusable_empty_model_output(self):
        class EmptyResponse(FakeResponse):
            def read(self, max_bytes):
                return b'{"response": "", "eval_count": 200}'
        with patch("services.api.modules.translation_preview.urlopen", return_value=EmptyResponse()):
            with self.assertRaisesRegex(ValueError, "TRANSLATION_EMPTY"):
                translate_text("hello", "vi", "ko")


if __name__ == "__main__":
    unittest.main()
