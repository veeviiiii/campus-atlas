import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline import providers


class Flaky(providers.Provider):
    """Fails each model's first try with an overload error, then answers; remembers the temperatures."""

    name = "test"
    model = "primary"

    def __init__(self, failures: int):
        self.failures = failures
        self.temperatures = []

    def _generate(self, prompt, images, model, temperature):
        self.temperatures.append(temperature)
        if len(self.temperatures) <= self.failures:
            raise RuntimeError("ServerError: 504 DEADLINE_EXCEEDED")
        return '{"ok": true}'


class Retries(unittest.TestCase):
    def setUp(self):
        self.cache = tempfile.TemporaryDirectory()
        patches = [mock.patch.object(providers, "CACHE_DIR", Path(self.cache.name)), mock.patch.object(providers.time, "sleep")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.cache.cleanup)

    def test_first_try_at_temperature_0_retries_with_some_randomness(self):
        p = Flaky(failures=1)
        self.assertEqual(p.generate("group these"), '{"ok": true}')
        self.assertEqual(p.temperatures, [0.0, providers.RETRY_TEMPERATURE])
        cached = [json.loads(f.read_text(encoding="utf-8")) for f in Path(self.cache.name).glob("*.json")]
        self.assertEqual([c["temperature"] for c in cached], [providers.RETRY_TEMPERATURE])

    def test_a_cached_answer_needs_no_call(self):
        Flaky(failures=0).generate("group these")
        again = Flaky(failures=0)
        self.assertEqual(again.generate("group these"), '{"ok": true}')
        self.assertEqual(again.temperatures, [])


if __name__ == "__main__":
    unittest.main()
