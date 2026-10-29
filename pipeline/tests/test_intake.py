import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pymupdf
import yaml
from PIL import Image

from pipeline import intake

CATALOG = {
    "courses": [
        {"id": "bca", "name": "BCA", "school": "Test School", "college": "test-college", "field": "computer-applications", "years": 3},
    ]
}


def make_pdf(path: Path, pages: int) -> None:
    doc = pymupdf.open()
    for _ in range(pages):
        doc.new_page()
    doc.save(path)


def quiet(fn, *args):
    """Run fn, return (result, what it printed)."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        result = fn(*args)
    return result, out.getvalue()


class IntakeTest(unittest.TestCase):
    """Each test gets its own repo root (data/raw, catalog) in a temporary folder."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "catalog").mkdir()
        (self.root / "catalog" / "davv.json").write_text(json.dumps(CATALOG), encoding="utf-8")
        patches = [mock.patch.object(intake, "ROOT", self.root), mock.patch.object(intake, "CATALOG", self.root / "catalog" / "davv.json")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)
        self.folder = self.root / "data" / "raw" / "test-college" / "bca" / "sem1"

    def fill(self, manifest: Path, **changes) -> None:
        """Replace the TODOs the way a maintainer would."""
        m = yaml.safe_load(manifest.read_text(encoding="utf-8"))
        m["exams"] = [{"id": "end", "name": "End Sem", "date": "2026-01", "session": "2025-26"}]
        m["subjects"] = [{"id": "maths", "name": "Mathematics", "aliases": []}]
        for f in m["files"]:
            f["exam"] = "end"
            for p in f["pages"]:
                p["subject"] = "maths"
        m.update(changes)
        manifest.write_text(yaml.safe_dump(m, sort_keys=False), encoding="utf-8")


class Photos(IntakeTest):
    def test_photos_become_one_pdf_in_name_order_and_upright(self):
        src = self.root / "photos"
        src.mkdir()
        Image.new("RGB", (300, 200), "white").save(src / "02.jpg")
        exif = Image.Exif()
        exif[0x0112] = 6  # the phone was held sideways: rotate 90 degrees
        Image.new("RGB", (300, 200), "white").save(src / "01.jpg", exif=exif)
        out = self.root / "paper.pdf"
        _, printed = quiet(intake.photos, src, out)
        doc = pymupdf.open(out)
        self.assertEqual(doc.page_count, 2)
        self.assertLess(doc[0].rect.width, doc[0].rect.height)  # 01.jpg, turned upright
        self.assertGreater(doc[1].rect.width, doc[1].rect.height)
        self.assertIn("page 1: 01.jpg", printed)

    def test_no_photos(self):
        (self.root / "empty").mkdir()
        with self.assertRaises(SystemExit):
            quiet(intake.photos, self.root / "empty", self.root / "x.pdf")


class NewAndCheck(IntakeTest):
    def test_new_then_check(self):
        _, printed = quiet(intake.new, "bca", 1)
        manifest = self.folder / "manifest.yaml"
        self.assertIn("Created", printed)
        self.assertIn("course:\n  id: bca", manifest.read_text(encoding="utf-8"))

        make_pdf(self.folder / "bca-sem1_2025-26_end.pdf", 2)
        _, printed = quiet(intake.new, "bca", 1)
        self.assertIn("Added 1 PDF", printed)
        text = manifest.read_text(encoding="utf-8")
        self.assertIn("{page: 2, subject: TODO}", text)
        _, printed = quiet(intake.new, "bca", 1)
        self.assertIn("already lists every PDF", printed)

        ok, printed = quiet(intake.check, manifest)
        self.assertFalse(ok)
        self.assertIn("still say TODO", printed)

        self.fill(manifest)
        ok, printed = quiet(intake.check, manifest)
        self.assertTrue(ok, printed)
        self.assertIn("ready", printed)

    def test_unknown_course_or_semester(self):
        with self.assertRaises(SystemExit):
            quiet(intake.new, "no-such-course", 1)
        with self.assertRaises(SystemExit):
            quiet(intake.new, "bca", 7)  # 3 years: semesters 1 to 6

    def test_check_finds_page_and_id_problems(self):
        quiet(intake.new, "bca", 1)
        make_pdf(self.folder / "bca-sem1_2025-26_end.pdf", 3)
        quiet(intake.new, "bca", 1)
        manifest = self.folder / "manifest.yaml"
        self.fill(manifest)
        m = yaml.safe_load(manifest.read_text(encoding="utf-8"))
        m["files"][0]["pages"] = [
            {"page": 1, "subject": "maths", "continues_previous": True},
            {"page": 1, "subject": "physics"},
            {"page": 4, "subject": "maths", "rotation": 45},
        ]
        manifest.write_text(yaml.safe_dump(m), encoding="utf-8")
        ok, printed = quiet(intake.check, manifest)
        self.assertFalse(ok)
        for problem in ("[2, 3] not listed", "[4] listed, but the PDF has only 3", "[1] listed twice", "'physics' is not one of the subjects", "continues_previous", "rotation must be"):
            self.assertIn(problem, printed)

    def test_two_courses_of_a_school_never_share_a_file_name(self):
        quiet(intake.new, "bca", 1)
        make_pdf(self.folder / "paper.pdf", 1)
        quiet(intake.new, "bca", 1)
        self.fill(self.folder / "manifest.yaml")
        other = self.root / "data" / "raw" / "test-college" / "bsc" / "sem1"
        other.mkdir(parents=True)
        (other / "manifest.yaml").write_text(yaml.safe_dump({"files": [{"file": "paper.pdf"}]}), encoding="utf-8")
        ok, printed = quiet(intake.check, self.folder / "manifest.yaml")
        self.assertFalse(ok)
        self.assertIn("uses this file name too", printed)


if __name__ == "__main__":
    unittest.main()
