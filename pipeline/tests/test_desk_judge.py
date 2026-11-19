"""What the desk works out about subjects (pipeline/desk/judge.py): one subject under two names, a
subject that is not printed, one paper photographed twice. No API key, no model calls: the model is
a stand-in that returns the replies each test gives it."""

import json
import unittest

from pipeline.desk import decisions, judge, reader, suggest
from pipeline.desk.decisions import Page, Part
from pipeline.manifest import match_exam
from pipeline.tests.test_desk_suggest import COURSES, StandIn, paper, reading

IT2 = ("mtech-it-dual", 2)
SUBJECTS = {IT2: [{"id": "numerical-analysis", "name": "Numerical Analysis", "aliases": []},
                  {"id": "mathematics-ii", "name": "Mathematics II", "aliases": []}]}
KNOWN = {IT2: {"sittings": {"numerical-analysis": {("s", "mst1", "2024-25")}},
               "samples": {"numerical-analysis": ["Find a root of x^3 - x - 1 = 0 by the bisection method"]}}}
HEAD = {"course_name": "M.Tech. (IT) 5 Yrs", "semester": "II Sem"}
ROOTS = ["Find a real root of the equation x^3 - 2x - 5 = 0 using Newton-Raphson method",
         "Solve the system of equations by Gauss elimination method",
         "Evaluate the integral using Simpson's one third rule taking six intervals",
         "State and derive Lagrange's interpolation formula for unequal intervals"]
CURVES = ["Fit a straight line to the following data by the method of least squares",
          "Solve dy/dx = x + y with y(0) = 1 by Euler's method",
          "Using Runge-Kutta method of fourth order find y(0.2)"]
CPP = ["What is a constructor? Explain copy constructor with a suitable example",
       "Differentiate between function overloading and function overriding with examples",
       "Write a C++ program to demonstrate multiple inheritance",
       "Explain the use of virtual functions and pure virtual functions"]


def subjects_for(course: str, sem: int) -> list[dict]:
    return SUBJECTS.get((course, sem), [])


def known_for(course: str, sem: int) -> dict:
    return {"subjects": subjects_for(course, sem), "sittings": {}, "samples": {}, **KNOWN.get((course, sem), {})}


def page(exam="Internal Test I", subject=None, date=None, questions=(), **more) -> dict:
    return reading(("question paper", paper(exam_title=exam, subject_name=subject, date=date, questions=list(questions), **HEAD, **more)))


class Desk(unittest.TestCase):
    def before(self, desk, keys):
        return suggest.suggestions(desk, keys, COURSES, subjects_for, {}, worked=False)

    def after(self, desk, keys):
        return {k: v["parts"][0] for k, v in suggest.suggestions(desk, keys, COURSES, subjects_for, {}).items()}

    def ask_all(self, desk, keys, replies):
        """Every open question put to a stand-in model and its answers kept, as the desk does after reading."""
        prov = StandIn(replies)
        todo = judge.waiting(desk.judged, judge.tasks(desk, keys, self.before(desk, keys), known_for))
        for t in todo:
            judge.keep(desk.judged, t, judge.judge_one(t, prov, "M.Tech. (IT) 5 Yrs"))
        return todo, prov


class ReadingGaps(unittest.TestCase):
    def test_a_roman_two_read_as_ones_and_ls_and_a_plural_are_still_a_test_number(self):
        for title, kind in (("Internal Test 1I", "mst2"), ("Internal Test lll", "mst3"), ("ll Internal Test", "mst2"),
                            ("1 internals", "mst1"), ("2 internal", "mst2"), ("Internal Test 1", "mst1")):
            self.assertEqual(match_exam(title), kind, title)
        self.assertIsNone(match_exam("11 Internal Test"))  # two digits are not a roman numeral
        self.assertIsNone(match_exam("III Semester Internal Test"))  # a semester, not a test number

    def test_a_date_with_a_two_digit_year_needs_its_day(self):
        self.assertEqual(suggest.parse_date("26Feb24"), "2024-02")
        self.assertEqual(suggest.parse_date("26 Feb 24"), "2024-02")
        self.assertEqual(suggest.parse_date("26Feb2024"), "2024-02")
        self.assertEqual(suggest.parse_date("5-Mar-23"), "2023-03")
        self.assertIsNone(suggest.parse_date("Feb 24"))  # the 24th of February, of a year not printed

    def test_the_reading_keeps_how_the_questions_begin(self):
        p = reader.PaperRead(questions=["  What is   a constructor? ", "", 7, None, "x" * 500] + [f"Question {i}" for i in range(20)])
        self.assertEqual(p.questions[0], "What is a constructor?")
        self.assertEqual((len(p.questions), len(p.questions[2])), (reader.QUESTIONS, reader.QUESTION_CHARS))
        self.assertEqual(reader.PaperRead(questions=None).questions, [])  # a model that sends null is not an error
        self.assertIn('"questions"', reader.READ_PROMPT)


class Names(Desk):
    def test_printed_variants_of_one_name_have_one_key(self):
        same = ["Mathematics II", "Maths-II", "MATHEMATICS - 2", "IT-201: Mathematics II", "IT – 201A (Mathematics-II)"]
        self.assertEqual({judge.name_key(n) for n in same}, {"mathematic 2"})
        for a, b in (("Data Structures", "Data structure"), ("Digital Computer Organisation", "Digital Computer Organizations"),
                     ("Data & Computer Communications", "Data and Computer Communication")):
            self.assertEqual(judge.name_key(a), judge.name_key(b))
        self.assertNotEqual(judge.name_key("Programming in C"), judge.name_key("Programming in C++"))
        self.assertNotEqual(judge.name_key("Mathematics II"), judge.name_key("Mathematics III"))
        self.assertTrue(judge.series_clash("Mathematics II", "Maths-III"))
        self.assertFalse(judge.series_clash("Numerical Analysis", "Numerical Methods"))
        self.assertFalse(judge.series_clash("Mathematics", "Mathematics II"))  # one of them prints no number

    def test_another_spelling_of_a_subject_is_that_subject_without_asking(self):
        desk = decisions.Desk(reads={"a.pdf#1": page(subject="Maths-II (IT-201)", date="12/03/2025")})
        s = self.after(desk, ["a.pdf#1"])["a.pdf#1"]
        self.assertEqual((s["subject"], s["new_subject"], s["sure"]), ("mathematics-ii", "", True))
        self.assertEqual(judge.tasks(desk, ["a.pdf#1"], self.before(desk, ["a.pdf#1"]), known_for), [])

    def test_a_new_name_is_asked_about_once_and_joins_the_subject_the_model_names(self):
        keys = ["a.pdf#1", "a.pdf#2"]
        desk = decisions.Desk(reads={"a.pdf#1": page(subject="Numerical Methods", date="10/03/2026", questions=ROOTS),
                                     "a.pdf#2": page("Internal Test II", subject="Numerical Methods", date="20/04/2026", questions=CURVES)})
        self.assertEqual(self.after(desk, keys)["a.pdf#1"]["new_subject"], "Numerical Methods")  # before asking: a new subject

        todo, prov = self.ask_all(desk, keys, lambda prompt: json.dumps({"same_as": 1, "reason": "both are numerical methods for roots and integration"}))
        self.assertEqual([(t["kind"], t["name"], [c.label for c in t["cands"]]) for t in todo], [("name", "Numerical Methods", ["Numerical Analysis", "Mathematics II"])])
        self.assertEqual(prov.seen, [[]])  # asked once for both papers, in words only: no picture
        for k in keys:
            s = self.after(desk, keys)[k]
            self.assertEqual((s["subject"], s["new_subject"], s["alias"], s["worked"]), ("numerical-analysis", "", "Numerical Methods", "name"))
            self.assertEqual((s["sure"], s["likely"], s["status"]), (False, True, "use"))  # not what is printed: likely, with a note
            self.assertIn('"Numerical Methods" taken as "Numerical Analysis" under another name (both are numerical methods for roots and integration)', s["notes"])
        self.assertEqual(judge.waiting(desk.judged, judge.tasks(desk, keys, self.before(desk, keys), known_for)), [])  # not asked twice
        # the answer is kept with the decisions, and saving the page's state does not lose it
        self.assertEqual(decisions.from_dict(decisions.to_dict(desk)).judged, desk.judged)

    def test_the_question_shows_the_evidence_and_leaves_out_what_cannot_be_the_same(self):
        desk = decisions.Desk(reads={"a.pdf#1": page(subject="Numerical Methods", date="10/03/2026", questions=ROOTS)})
        [t] = judge.tasks(desk, ["a.pdf#1"], self.before(desk, ["a.pdf#1"]), known_for)
        asked = []
        judge.judge_one(t, StandIn(lambda prompt: asked.append(prompt) or '{"same_as": null}'), "M.Tech. (IT) 5 Yrs")
        self.assertIn('prints its subject as: "Numerical Methods"', asked[0])
        self.assertIn("Find a real root of the equation", asked[0])  # how its own questions begin
        self.assertIn('1. "Numerical Analysis" — its papers ask: Find a root of x^3 - x - 1 = 0 by the bisection method', asked[0])
        self.assertIn('2. "Mathematics II"\n', asked[0])  # a subject with no paper to show is still a choice

    def test_two_names_with_a_paper_in_one_sitting_are_never_one_subject(self):
        # Numerical Analysis already has its MST-1 of 2024-25 in the manifest: a second paper of that sitting is another subject.
        desk = decisions.Desk(reads={"a.pdf#1": page(subject="Numerical Methods", date="12/03/2025", questions=ROOTS)})
        [t] = judge.tasks(desk, ["a.pdf#1"], self.before(desk, ["a.pdf#1"]), known_for)
        self.assertEqual([c.label for c in t["cands"]], ["Mathematics II"])
        # ... and so are two names printed in one file for the same test
        keys = ["b.pdf#1", "b.pdf#2"]
        desk = decisions.Desk(reads={"b.pdf#1": page(subject="Operating Systems"), "b.pdf#2": page(subject="System Software")})
        for t in judge.tasks(desk, keys, self.before(desk, keys), known_for):
            self.assertNotIn(t["name"], [c.label for c in t["cands"]])
            self.assertTrue({c.label for c in t["cands"]} <= {"Numerical Analysis", "Mathematics II"})

    def test_parts_of_a_series_are_not_even_asked_about(self):
        keys = ["2025.pdf#1", "2026.pdf#1"]
        desk = decisions.Desk(reads={"2025.pdf#1": page(subject="Applied Chemistry I", date="10/03/2025"),
                                     "2026.pdf#1": page(subject="Applied Chemistry II", date="11/03/2026")})
        todo = judge.tasks(desk, keys, self.before(desk, keys), known_for)
        # Part I has no choice left (Mathematics II carries another number, Numerical Analysis sat that test): nothing is asked.
        # Part II may be another name of a subject the semester has, but never of part I.
        self.assertEqual([(t["name"], [c.label for c in t["cands"]]) for t in todo], [("Applied Chemistry II", ["Numerical Analysis", "Mathematics II"])])

    def test_two_new_names_of_one_subject_become_one_subject_named_as_the_first(self):
        keys = ["2025.pdf#1", "2026.pdf#1"]
        desk = decisions.Desk(reads={"2025.pdf#1": page(subject="C++ Programming", date="10/03/2025", questions=CPP),
                                     "2026.pdf#1": page(subject="Programming with C++ (IT-205)", date="11/03/2026", questions=CPP[::-1])})
        todo, _ = self.ask_all(desk, keys, lambda prompt: json.dumps(
            {"same_as": 1 + [line.split('"')[1] for line in prompt.splitlines() if line[:2] in ("1.", "2.", "3.")].index(
                "Programming with C++" if 'as: "C++ Programming"' in prompt else "C++ Programming"), "reason": "the same language course"}))
        self.assertEqual(sorted(t["name"] for t in todo), ["C++ Programming", "Programming with C++"])
        first, second = (self.after(desk, keys)[k] for k in keys)
        self.assertEqual((first["new_subject"], first["alias"]), ("C++ Programming", ""))  # the first name printed stays the name
        self.assertEqual((second["new_subject"], second["alias"], second["worked"]), ("C++ Programming", "Programming with C++ (IT-205)", "name"))
        self.assertFalse(second["likely"])  # accepting adds a subject: the maintainer looks at it

    def test_no_and_a_failed_answer_change_nothing_and_a_failed_one_is_asked_again(self):
        desk = decisions.Desk(reads={"a.pdf#1": page(subject="Numerical Methods", date="10/03/2026", questions=ROOTS)})
        self.ask_all(desk, ["a.pdf#1"], lambda prompt: '{"same_as": null, "reason": "not sure"}')
        self.assertEqual(self.after(desk, ["a.pdf#1"])["a.pdf#1"]["new_subject"], "Numerical Methods")
        self.assertEqual(judge.waiting(desk.judged, judge.tasks(desk, ["a.pdf#1"], self.before(desk, ["a.pdf#1"]), known_for)), [])

        desk.judged = {}
        _, prov = self.ask_all(desk, ["a.pdf#1"], lambda prompt: '{"same_as": 9}')  # no such choice, twice (the retry)
        kept = desk.judged["names"]["mtech-it-dual/2"][judge.name_key("Numerical Methods")]
        self.assertEqual((kept["to"], len(prov.seen)), ("", 2))
        self.assertIn("1 to 2", kept["error"])
        self.assertEqual(self.after(desk, ["a.pdf#1"])["a.pdf#1"]["new_subject"], "Numerical Methods")
        self.assertEqual(len(judge.waiting(desk.judged, judge.tasks(desk, ["a.pdf#1"], self.before(desk, ["a.pdf#1"]), known_for))), 1)


class SubjectNotPrinted(Desk):
    def test_a_paper_with_no_subject_gets_the_one_its_questions_are_about(self):
        keys = ["a.pdf#1", "a.pdf#2"]
        desk = decisions.Desk(reads={"a.pdf#1": page(subject="Mathematics II", date="10/03/2026"),
                                     "a.pdf#2": page(date="11/03/2026", questions=ROOTS)})
        held = self.after(desk, keys)["a.pdf#2"]
        self.assertEqual((held["status"], held["reason"]), ("held", "no subject"))

        asked = []
        todo, prov = self.ask_all(desk, keys, lambda prompt: asked.append(prompt) or '{"subject": 1, "reason": "root finding and interpolation"}')
        self.assertEqual([(t["kind"], t["id"]) for t in todo], [("subject", "a.pdf#2:0")])
        self.assertIn("does not print its subject", asked[0])
        self.assertIn("- Find a real root of the equation", asked[0])
        # Mathematics II has its paper of this test in the same file: it is not a choice
        self.assertEqual([c.label for c in todo[0]["cands"]], ["Numerical Analysis"])
        s = self.after(desk, keys)["a.pdf#2"]
        self.assertEqual((s["status"], s["reason"], s["subject"], s["worked"], s["likely"], s["sure"]), ("use", "", "numerical-analysis", "questions", True, False))
        self.assertIn('no subject printed: "Numerical Analysis" worked out from the questions (root finding and interpolation)', s["notes"])

    def test_what_else_is_missing_still_holds_the_paper_back(self):
        desk = decisions.Desk(reads={"a.pdf#1": page(questions=ROOTS)})  # no subject and no year
        self.ask_all(desk, ["a.pdf#1"], lambda prompt: '{"subject": 1, "reason": "numerical methods"}')
        s = self.after(desk, ["a.pdf#1"])["a.pdf#1"]
        self.assertEqual((s["status"], s["reason"], s["subject"], s["likely"]), ("held", "no year", "numerical-analysis", False))

    def test_too_few_questions_or_no_answer_leave_it_held(self):
        desk = decisions.Desk(reads={"a.pdf#1": page(date="11/03/2026", questions=ROOTS[:1])})
        self.assertEqual(judge.tasks(desk, ["a.pdf#1"], self.before(desk, ["a.pdf#1"]), known_for), [])
        desk = decisions.Desk(reads={"a.pdf#1": page(date="11/03/2026", questions=ROOTS)})
        self.ask_all(desk, ["a.pdf#1"], lambda prompt: '{"subject": null, "reason": "could be either"}')
        self.assertEqual(self.after(desk, ["a.pdf#1"])["a.pdf#1"]["reason"], "no subject")

    def test_a_decided_page_counts_as_its_decision(self):
        # The maintainer put page 1 in Numerical Analysis: the paper without a subject in the same test is not that one.
        keys = ["a.pdf#1", "a.pdf#2"]
        desk = decisions.Desk(reads={"a.pdf#1": page(subject="NM", date="10/03/2026"), "a.pdf#2": page(date="10/03/2026", questions=ROOTS)},
                              pages={"a.pdf#1": Page(parts=[Part(status="use", course="mtech-it-dual", semester=2, subject="numerical-analysis",
                                                                 kind="mst1", session="2025-26")])})
        [t] = judge.tasks(desk, keys, self.before(desk, keys), known_for)
        self.assertEqual((t["kind"], [c.label for c in t["cands"]]), ("subject", ["Mathematics II"]))


class Copies(Desk):
    def test_questions_that_begin_the_same_are_one_paper(self):
        blurred = [q.replace("the", "thc", 1).upper() for q in CPP]  # a second photo, read a little differently
        self.assertTrue(judge.same_questions(CPP, blurred))
        self.assertTrue(judge.same_questions(CPP[:3], CPP))  # one photo cut the last question off
        self.assertFalse(judge.same_questions(CPP, ROOTS))
        self.assertFalse(judge.same_questions(CPP[:2], CPP[:2]))  # too few to tell
        self.assertFalse(judge.same_questions(CPP[:1] + ROOTS, CPP))  # one shared question is not a copy

    def test_the_copy_that_prints_the_year_is_kept(self):
        keys = ["one.pdf#1", "two.pdf#1"]
        desk = decisions.Desk(reads={"one.pdf#1": page(subject="Mathematics II", questions=CPP),
                                     "two.pdf#1": page(subject="Mathematics II", date="10/03/2026", questions=CPP)})
        out = suggest.suggestions(desk, keys, COURSES, subjects_for, {})
        first, second = out["one.pdf#1"]["parts"][0], out["two.pdf#1"]["parts"][0]
        self.assertEqual((first["status"], first["reason"], first["sure"]), ("skip", "duplicate", False))  # one prints no year: checked by eye
        self.assertIn('its questions begin the same way as those of "two.pdf" page 1', first["notes"][0])
        self.assertEqual(out["one.pdf#1"]["duplicate"]["of"], "two.pdf#1")  # "Show the other copy"
        self.assertEqual((second["status"], second["session"]), ("use", "2025-26"))

    def test_two_copies_that_print_the_same_year_are_sure_and_the_first_is_kept(self):
        keys = ["one.pdf#1", "two.pdf#1", "two.pdf#2"]
        desk = decisions.Desk(reads={"one.pdf#1": page(subject="Mathematics II", date="10/03/2026", questions=CPP),
                                     "two.pdf#1": page(subject="Mathematics II", date="10/03/2026", questions=CPP),
                                     "two.pdf#2": reading(("question paper", paper(has_header=False)))})
        after = self.after(desk, keys)
        self.assertEqual(after["one.pdf#1"]["status"], "use")
        self.assertEqual((after["two.pdf#1"]["status"], after["two.pdf#1"]["reason"], after["two.pdf#1"]["sure"]), ("skip", "duplicate", True))
        # the page that continues the copy goes with it, and does not join the paper before
        self.assertEqual((after["two.pdf#2"]["status"], after["two.pdf#2"]["continues"]), ("skip", False))

    def test_the_same_questions_in_two_printed_years_are_two_papers(self):
        keys = ["one.pdf#1", "two.pdf#1"]
        desk = decisions.Desk(reads={"one.pdf#1": page(subject="Mathematics II", date="10/03/2025", questions=CPP),
                                     "two.pdf#1": page(subject="Mathematics II", date="10/03/2026", questions=CPP)})
        after = self.after(desk, keys)
        self.assertEqual([after[k]["status"] for k in keys], ["use", "use"])
        self.assertIn("set again in another year", after["two.pdf#1"]["notes"][-1])

    def test_a_decided_page_is_never_the_one_suggested_away(self):
        keys = ["one.pdf#1", "two.pdf#1"]
        desk = decisions.Desk(reads={"one.pdf#1": page(subject="Mathematics II", questions=CPP),
                                     "two.pdf#1": page(subject="Mathematics II", date="10/03/2026", questions=CPP)},
                              pages={"one.pdf#1": Page(parts=[Part(status="use", course="mtech-it-dual", semester=2, subject="mathematics-ii",
                                                                   kind="mst1", session="2025-26")])})
        after = self.after(desk, keys)
        self.assertEqual((after["two.pdf#1"]["status"], after["two.pdf#1"]["reason"]), ("skip", "duplicate"))


if __name__ == "__main__":
    unittest.main()
