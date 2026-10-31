import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from pipeline import report


class RunFolders(unittest.TestCase):
    def test_two_runs_started_in_the_same_second_keep_both_reports(self):
        with tempfile.TemporaryDirectory() as root, mock.patch.object(report, "get_provider", return_value=SimpleNamespace(name="test", model="m")):
            first = report.RunReport(["sem1"], started="20261031-120000").write(Path(root))
            second = report.RunReport(["sem5"], started="20261031-120000").write(Path(root))
            self.assertNotEqual(first, second)
            self.assertIn("sem1", (first / "report.md").read_text(encoding="utf-8"))
            self.assertIn("sem5", (second / "report.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
