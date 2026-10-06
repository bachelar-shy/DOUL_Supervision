from datetime import datetime, timezone
import unittest

from tests_runtime.safety_operational import safety_window


class SafetyOperationalWindowTests(unittest.TestCase):
    def test_window_remains_valid_for_future_clock(self):
        for now in (
            datetime(2026, 10, 6, tzinfo=timezone.utc),
            datetime(2028, 2, 29, 12, 0, tzinfo=timezone.utc),
            datetime(2035, 1, 1, tzinfo=timezone.utc),
        ):
            with self.subTest(now=now.isoformat()):
                window = safety_window(now)
                parse = lambda value: datetime.fromisoformat(value.replace("Z", "+00:00"))
                valid_from = parse(window["validFrom"])
                valid_to = parse(window["validTo"])
                observed = parse(window["observedAt"])
                effective = parse(window["effectiveAt"])
                self.assertLess(valid_from, now)
                self.assertGreater(valid_to, now)
                self.assertLessEqual(observed, effective)
                self.assertEqual(effective, now)


if __name__ == "__main__":
    unittest.main()
