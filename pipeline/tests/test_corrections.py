import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from pipeline import corrections
from pipeline.corrections import Correction, Corrections, apply, audit_summary, load, unknown_pages

PAGE = "paper_end.pdf#p1"


def q(n: int, text: str, marks: float | None = 5, page: str = PAGE, **more) -> dict:
    return {"id": f"physics-end-q{n}", "exam": "end", "text": text, "marks": marks, "sub_parts": [], "has_table": False,
            "table_markdown": None, "page_ref": page, "repeat_of": [], **more}


def fix(match: str, status: str = "confirmed", page: str = PAGE, **action) -> Correction:
    return Correction.model_validate({"page": page, "match": match, "why": "checked against the photo", "status": status, **action})


class Apply(unittest.TestCase):
    def setUp(self):
        self.qs = [
            q(1, "Derive the Lorentz transformation equations.", 16),
            q(2, "Explain the working of a He-Ne laser."),
            q(3, "State and prove Gauss's theorem.", page="paper_end.pdf#p2"),
        ]

    def test_a_confirmed_fix_changes_only_the_fields_it_sets(self):
        dropped, applied, problems = apply(self.qs, [fix("Derive the Lorentz", set={"marks": 10})])
        self.assertEqual((dropped, problems), (set(), []))
        self.assertEqual(self.qs[0]["marks"], 10)
        self.assertEqual(self.qs[0]["text"], "Derive the Lorentz transformation equations.")
        self.assertTrue(self.qs[0]["corrected"])
        self.assertNotIn("corrected", self.qs[1])
        self.assertEqual(applied, [{"id": "physics-end-q1", "page_ref": PAGE, "fields": ["marks"], "drop": False, "why": "checked against the photo"}])

    def test_a_question_is_found_by_its_text_whatever_the_case_and_punctuation(self):
        _, applied, problems = apply(self.qs, [fix("working of a HE-NE LASER", set={"text": "Explain the working of a He-Ne laser with a diagram."})])
        self.assertEqual(problems, [])
        self.assertEqual(self.qs[1]["text"], "Explain the working of a He-Ne laser with a diagram.")
        self.assertEqual(applied[0]["fields"], ["text"])

    def test_null_marks_means_none_are_printed(self):
        apply(self.qs, [fix("Derive the Lorentz", set={"marks": None})])
        self.assertIsNone(self.qs[0]["marks"])
        self.assertTrue(self.qs[0]["corrected"])

    def test_a_table_fix_sets_has_table(self):
        apply(self.qs, [fix("He-Ne laser", set={"table_markdown": "| x | y |\n|---|---|\n| 1 | 2 |"})])
        self.assertTrue(self.qs[1]["has_table"])
        apply(self.qs, [fix("He-Ne laser", set={"table_markdown": None})])
        self.assertFalse(self.qs[1]["has_table"])

    def test_drop_returns_the_id_and_leaves_the_question_alone(self):
        dropped, applied, _ = apply(self.qs, [fix("He-Ne laser", drop=True)])
        self.assertEqual(dropped, {"physics-end-q2"})
        self.assertTrue(applied[0]["drop"])
        self.assertNotIn("corrected", self.qs[1])

    def test_a_proposed_fix_is_not_applied(self):
        dropped, applied, problems = apply(self.qs, [fix("Derive the Lorentz", status="proposed", set={"marks": 10})])
        self.assertEqual((dropped, applied, problems), (set(), [], []))
        self.assertEqual(self.qs[0]["marks"], 16)

    def test_no_match_or_two_matches_go_to_unsure_and_change_nothing(self):
        self.qs.append(q(4, "Derive the Lorentz force law.", 4))
        _, applied, problems = apply(self.qs, [fix("Derive the Lorentz", set={"marks": 10}), fix("Planck's constant", set={"marks": 2})])
        self.assertEqual(applied, [])
        self.assertEqual([p["step"] for p in problems], ["corrections", "corrections"])
        self.assertIn("2 questions", problems[0]["error"])
        self.assertIn("no question", problems[1]["error"])
        self.assertEqual(self.qs[0]["marks"], 16)

    def test_a_match_that_is_one_questions_whole_text_means_that_question(self):
        self.qs += [q(4, "Write a program to print:\n******\n*****"), q(5, "Write a program to print:\nABCDEFG FEDCBA")]
        _, applied, problems = apply(self.qs, [fix("Write a program to print:", set={"marks": 10})])
        self.assertEqual(([a["id"] for a in applied], problems), (["physics-end-q4"], []))

    def test_a_drop_takes_every_copy_of_a_line_printed_twice(self):
        self.qs += [q(4, "Differentiate briefly regression and clustering."), q(5, "Differentiate briefly regression and clustering.")]
        dropped, applied, problems = apply(self.qs, [fix("Differentiate briefly regression", drop=True)])
        self.assertEqual((dropped, len(applied), problems), ({"physics-end-q4", "physics-end-q5"}, 2, []))
        _, applied, problems = apply(self.qs, [fix("Differentiate briefly regression", set={"marks": 5})])  # a fix must name one question
        self.assertEqual((applied, len(problems)), ([], 1))

    def test_the_page_must_match_too(self):
        _, applied, problems = apply(self.qs, [fix("Gauss's theorem", set={"marks": 8})])  # that question is on page 2
        self.assertEqual(applied, [])
        self.assertEqual(len(problems), 1)

    def test_every_entry_is_matched_against_the_text_as_the_model_read_it(self):
        both = [fix("Derive the Lorentz", set={"text": "Derive the Lorentz transformation equations for space and time."}), fix("Lorentz transformation equations", set={"marks": 10})]
        _, applied, problems = apply(self.qs, both)
        self.assertEqual((len(applied), problems), (2, []))
        self.assertEqual(self.qs[0]["marks"], 10)


class Format(unittest.TestCase):
    def test_an_entry_needs_exactly_one_action(self):
        for action in ({}, {"set": {}}, {"set": {"marks": 5}, "drop": True}):
            with self.assertRaises(ValidationError):
                fix("Derive the Lorentz", **action)

    def test_bad_values_are_refused(self):
        for action in ({"set": {"marks": 0}}, {"set": {"text": "too"}}, {"set": {"topic": "Optics"}}):
            with self.assertRaises(ValidationError):
                fix("Derive the Lorentz", **action)
        with self.assertRaises(ValidationError):
            fix("a b", set={"marks": 5})  # a match this short finds half the page

    def test_load(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.assertIsNone(load(folder))
            (folder / corrections.FILE_NAME).write_text(
                'audited_pages: ["paper_end.pdf#p1"]\nreader: "a person"\ncorrections:\n'
                '  - {page: "paper_end.pdf#p1", match: "Derive the Lorentz", set: {marks: 10}, why: "photo prints 10"}\n'
                'missed:\n  - {page: "paper_end.pdf#p1", text: "Define proper time."}\n',
                encoding="utf-8",
            )
            c = load(folder)
            self.assertEqual((c.corrections[0].status, c.corrections[0].fields, len(c.missed)), ("proposed", {"marks": 10}, 1))
            (folder / corrections.FILE_NAME).write_text("corrections:\n  - {page: x, match: 'Derive the Lorentz', drop: true}\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "why"):  # a fix with no reason is refused, and the run stops
                load(folder)

    def test_pages_the_manifest_does_not_have_are_reported(self):
        m = {"files": [{"file": "paper_end.pdf", "pages": [{"page": 1}, {"page": 2}]}]}
        c = Corrections.model_validate({
            "audited_pages": ["paper_end.pdf#p1", "paper_end.pdf#p9"],
            "corrections": [{"page": "paper_mst.pdf#p1", "match": "Derive the Lorentz", "drop": True, "why": "typo in the page"}],
            "missed": [{"page": "paper_end.pdf#p2", "text": "Define proper time."}],
        })
        problems = unknown_pages(c, m)
        self.assertEqual(len(problems), 2)
        self.assertIn("paper_end.pdf#p9", problems[0])
        self.assertIn("paper_mst.pdf#p1", problems[1])


class Audit(unittest.TestCase):
    def test_the_summary_is_counted_from_the_file_and_the_pack(self):
        c = Corrections.model_validate({
            "audited_pages": ["paper_end.pdf#p1", "paper_end.pdf#p2", "another_course.pdf#p1"],
            "reader": "a person, 2026-11-15",
            "corrections": [
                {"page": PAGE, "match": "Derive the Lorentz", "set": {"marks": 10}, "why": "photo prints 10", "status": "confirmed"},
                {"page": PAGE, "match": "He-Ne laser", "drop": True, "why": "from the paper underneath", "status": "confirmed"},
                {"page": PAGE, "match": "Gauss's theorem", "set": {"marks": 8}, "why": "not looked at yet"},
            ],
            "missed": [{"page": PAGE, "text": "Define proper time."}, {"page": "another_course.pdf#p1", "text": "Not in this pack."}],
        })
        qs = [q(1, "Derive the Lorentz transformation equations."), q(2, "Explain the working of a He-Ne laser.")]
        _, applied, _ = apply(qs, c.corrections)
        summary = audit_summary(c, 2, {"paper_end.pdf#p1", "paper_end.pdf#p2"}, applied)
        self.assertEqual(summary, {"reader": "a person, 2026-11-15", "pages": 2, "questions_checked": 2, "corrected": 1, "dropped": 1, "missed": 1, "proposed": 1})

    def test_no_audited_page_no_summary(self):
        self.assertIsNone(audit_summary(Corrections(), 0, {"paper_end.pdf#p1"}, []))


if __name__ == "__main__":
    unittest.main()
