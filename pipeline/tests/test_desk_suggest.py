"""The desk's page reader, its suggestions and its picture matches. No API key, no model calls: the
model is a stand-in that returns the replies each test gives it."""

import json
import random
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import pymupdf
from PIL import Image, ImageDraw

from pipeline import intake
from pipeline.desk import decisions, dupes, reader, suggest
from pipeline.desk.decisions import Page, Part
from pipeline.desk.sources import list_sources
from pipeline.providers import Provider

COURSES = json.loads(intake.CATALOG.read_text(encoding="utf-8"))["courses"]
SUBJECTS = {("mtech-aids-dual", 5): [{"id": "data-engineering", "name": "Data Engineering", "aliases": ["DE"]}]}


def subjects_for(course: str, sem: int) -> list[dict]:
    return SUBJECTS.get((course, sem), [])


def paper(**fields) -> dict:
    return {"position": "whole", "has_header": True, "exam_title": None, "subject_name": None, "course_name": None,
            "semester": None, "date": None, "year": None, **fields}


def reading(*parts, split: str = "", rotation: int = 0, error: str = "") -> dict:
    return {"model": "stand-in", "rotation": rotation, "split": split, "error": error,
            "parts": [{"rotation": 0, "kind": kind, "paper": p, "error": ""} for kind, p in parts]}


class Parsing(unittest.TestCase):
    def test_semesters(self):
        cases = {"Semester-III": 3, "III Sem": 3, "5th Semester": 5, "Fifth Semester": 5, "Sem. V": 5, "VII": 7, "B.Tech. VII Sem": 7,
                 "semester 10": 10, "Mid Semester Test": None, "Second Mid-Sem Exam": None, "": None, None: None}
        self.assertEqual({k: suggest.parse_semester(k) for k in cases}, cases)

    def test_dates_and_sessions(self):
        dates = {"12/10/2025": "2025-10", "05.01.26": "2026-01", "Oct 2025": "2025-10", "October-2025": "2025-10",
                 "Nov-Dec 2024": "2024-12", "2025-10": "2025-10", "2025": "2025", "2024-25": None, "Session 2024-25, 12/10/2024": "2024-10", None: None}
        self.assertEqual({k: suggest.parse_date(k) for k in dates}, dates)
        sessions = {"2024-25": "2024-25", "Session 2024-2025": "2024-25", "2024-26": None, "2025-10": None, "12/10/2025": None}
        self.assertEqual({k: suggest.parse_session(k) for k in sessions}, sessions)

    def test_a_year_alone_gives_a_session_only_when_the_semester_settles_it(self):
        self.assertEqual(suggest.session_from_year(2025, 4, "end"), "2024-25")  # even semesters: January to June
        self.assertEqual(suggest.session_from_year(2025, 5, "mst1"), "2025-26")  # odd semesters' tests: autumn
        self.assertIsNone(suggest.session_from_year(2025, 5, "end"))  # December or January
        self.assertIsNone(suggest.session_from_year(2025, None, "mst1"))

    def test_course_names_as_printed(self):
        cases = {"M.Tech. (AI & DS) 5 Yrs": "mtech-aids-dual", "M.Tech (AIDS) Integrated": "mtech-aids-dual",
                 "B.Tech + M.Tech Integrated (Artificial Intelligence & Data Science)": "mtech-aids-dual",
                 "M.Tech. (Int.) Computer Science": "mtech-cs-dual", "MBA (Tourism) 5 Yrs": "mba-tourism-dual",
                 "B.Com.": None,  # taught in two schools: not guessed
                 "School of Data Science and Forecasting": None}
        self.assertEqual({k: suggest.match_course(k, COURSES) for k in cases}, cases)


class Suggestions(unittest.TestCase):
    def suggestions(self, desk, keys, dups=None):
        return suggest.suggestions(desk, keys, COURSES, subjects_for, dups or {})

    def test_a_reading_becomes_fields_and_reasons(self):
        desk = decisions.Desk(reads={
            "a.pdf#1": reading(("question paper", paper(position="top", exam_title="Mid Semester Test-I", subject_name="Data Engg.",
                                                         course_name="M.Tech. (AI & DS) 5 Yrs", semester="V Sem", date="12/10/2024")),
                               ("question paper", paper(position="bottom", exam_title="Mid Semester Test", subject_name="Cloud Computing")),
                               split="h"),
            "a.pdf#2": reading(("question paper", paper(has_header=False))),
            "a.pdf#3": reading(("answer sheet", None)),
            "a.pdf#4": reading(("", None), error="model call failed after retries"),
        })
        out = self.suggestions(desk, ["a.pdf#1", "a.pdf#2", "a.pdf#3", "a.pdf#4"])
        top, bottom = out["a.pdf#1"]["parts"]
        self.assertEqual(out["a.pdf#1"]["split"], "h")
        self.assertEqual({k: top[k] for k in ("status", "course", "semester", "subject", "kind", "session", "date")},
                         {"status": "use", "course": "mtech-aids-dual", "semester": 5, "subject": "", "kind": "mst1", "session": "2024-25", "date": "2024-10"})
        self.assertEqual(top["new_subject"], "Data Engg.")  # not matched to "Data Engineering": never guessed
        self.assertIn("Mid Semester Test-I", top["printed"])
        # The bottom paper prints no course, semester or year: course and semester from the paper above it.
        self.assertEqual((bottom["status"], bottom["reason"]), ("held", "no year, no test number"))
        self.assertEqual((bottom["course"], bottom["semester"], bottom["new_subject"]), ("mtech-aids-dual", 5, "Cloud Computing"))
        self.assertIn("course as the page before", bottom["notes"])
        self.assertTrue(out["a.pdf#2"]["parts"][0]["continues"])
        self.assertEqual((out["a.pdf#3"]["parts"][0]["status"], out["a.pdf#3"]["parts"][0]["reason"]), ("skip", "answer sheet"))
        self.assertEqual(out["a.pdf#4"]["parts"][0]["status"], "todo")  # nothing to accept; the page shows the error
        self.assertEqual(out["a.pdf#4"]["error"], "model call failed after retries")

    def test_subjects_match_by_name_and_alias(self):
        desk = decisions.Desk(reads={"a.pdf#1": reading(("question paper", paper(exam_title="TEST-II", subject_name="DE", course_name="M.Tech (AIDS)",
                                                                                  semester="Semester-V", date="Feb 2025")))})
        s = self.suggestions(desk, ["a.pdf#1"])["a.pdf#1"]["parts"][0]
        self.assertEqual((s["subject"], s["kind"], s["session"], s["new_subject"]), ("data-engineering", "mst2", "2024-25", ""))

    def test_a_decided_page_gives_its_course_to_the_next_reading(self):
        desk = decisions.from_dict({"pages": {"a.pdf#1": {"parts": [{"status": "use", "course": "bca", "semester": 3}]}}})
        desk.reads["a.pdf#2"] = reading(("question paper", paper(exam_title="End Semester Examination", subject_name="Maths", date="Dec 2024")))
        s = self.suggestions(desk, ["a.pdf#1", "a.pdf#2"])["a.pdf#2"]["parts"][0]
        self.assertEqual((s["course"], s["semester"], s["kind"], s["session"]), ("bca", 3, "end", "2024-25"))

    def test_a_copy_of_another_page_is_suggested_skip(self):
        out = self.suggestions(decisions.Desk(), ["a.pdf#1", "a.pdf#2"], {"a.pdf#2": {"label": '"a.pdf" page 1 in this folder', "of": "a.pdf#1"}})
        self.assertEqual(list(out), ["a.pdf#2"])
        s = out["a.pdf#2"]["parts"][0]
        self.assertEqual((s["status"], s["reason"]), ("skip", "duplicate"))
        self.assertIn('looks the same as "a.pdf" page 1 in this folder', s["notes"])


class StandIn(Provider):
    """A model that answers from a list (or a function of the call), and keeps the pictures it was sent."""

    name = "stand-in"
    model = "stand-in"

    def __init__(self, replies):
        self.replies, self.seen, self.lock = replies, [], threading.Lock()

    def generate(self, prompt, images=None, step=""):
        with self.lock:
            self.seen.append([im.size for im in images or []])
            return self.replies(prompt) if callable(self.replies) else self.replies.pop(0)


def page_reply(rotation=0, *papers, kind="question paper"):
    return json.dumps({"rotation": rotation, "kind": kind, "papers": list(papers)})


class Reading(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)
        doc = pymupdf.open()
        doc.new_page(width=200, height=300)
        doc.save(self.folder / "p.pdf")

    def test_a_sideways_page_is_read_again_upright(self):
        model = StandIn([page_reply(90, paper(subject_name="read sideways")), page_reply(0, paper(subject_name="Data Engineering"))])
        r = reader.read_page(self.folder, "p.pdf", 1, Page(), model)
        self.assertEqual((r["rotation"], r["split"], r["error"]), (90, "", ""))
        self.assertEqual(r["parts"][0]["paper"]["subject_name"], "Data Engineering")
        (w, h), = model.seen[0]
        self.assertEqual(model.seen[1], [(h, w)])  # the second picture is the page turned

    def test_two_papers_suggest_a_split_in_page_order(self):
        model = StandIn([page_reply(0, paper(position="right", subject_name="B"), paper(position="left", subject_name="A"))])
        r = reader.read_page(self.folder, "p.pdf", 1, Page(), model)
        self.assertEqual(r["split"], "v")
        self.assertEqual([p["paper"]["subject_name"] for p in r["parts"]], ["A", "B"])

    def test_a_page_already_split_is_read_half_by_half(self):
        model = StandIn([page_reply(0, paper(subject_name="top")), page_reply(180, paper(subject_name="bottom")),
                         page_reply(0, paper(subject_name="bottom, upright"))])
        pg = Page(split="h", at=0.5, parts=[Part(), Part()])
        r = reader.read_page(self.folder, "p.pdf", 1, pg, model)
        self.assertEqual([(p["rotation"], p["paper"]["subject_name"]) for p in r["parts"]], [(0, "top"), (180, "bottom, upright")])
        (w, h), = model.seen[0]
        self.assertAlmostEqual(h, 300 * 200 / 72 / 2, delta=2)  # each half is read on its own (the page is 300 pt at 200 dpi)
        self.assertEqual(len(model.seen), 3)

    def test_a_bad_answer_is_asked_again_then_kept_as_an_error(self):
        model = StandIn(["not JSON", page_reply(0, paper(position="top"), paper(position="left"))])
        r = reader.read_page(self.folder, "p.pdf", 1, Page(), model)
        self.assertIn('"top" and "bottom"', r["error"])
        self.assertEqual(r["parts"][0]["kind"], "")

    def test_black_out_boxes_are_burned_in_before_the_model_sees_the_page(self):
        doc = pymupdf.open()
        page = doc.new_page(width=200, height=300)
        page.draw_rect(pymupdf.Rect(20, 20, 80, 35), color=None, fill=(1, 0, 0))
        doc.save(self.folder / "named.pdf")
        sent = []
        with mock.patch.object(reader, "ask", side_effect=lambda prov, prompt, images, *a, **k: (sent.extend(images), (None, "stop", False))[1]):
            reader.read_page(self.folder, "named.pdf", 1, Page(boxes=[[0.05, 0.03, 0.45, 0.15]]), StandIn([]))
        data = sent[0].convert("RGB").tobytes()
        self.assertEqual(sum(1 for i in range(0, len(data), 3) if data[i] > 200 and data[i + 1] < 80), 0)

    def test_the_job_reads_every_page_and_gives_up_when_all_fail(self):
        stored = {}
        job = reader.Reader(lambda key: {"error": "", "key": key}, stored.__setitem__)
        self.assertEqual(job.add([f"p.pdf#{i}" for i in range(1, 8)]), 7)
        self.wait(job)
        self.assertEqual(sorted(stored), [f"p.pdf#{i}" for i in range(1, 8)])
        self.assertEqual((job.status()["done"], job.status()["failed"]), (7, 0))

        def fail(key):
            time.sleep(0.01)
            raise RuntimeError("API key not valid")
        job = reader.Reader(fail, stored.__setitem__, workers=1)
        job.add([f"q.pdf#{i}" for i in range(1, 30)])
        self.wait(job)
        st = job.status()
        self.assertEqual((st["done"], st["total"]), (reader.GIVE_UP, reader.GIVE_UP))
        self.assertIn("API key not valid", st["stopped"])
        self.assertIn("RuntimeError", stored["q.pdf#1"]["error"])  # shown on the page, never dropped

    def wait(self, job):
        for _ in range(200):
            if not job.status()["running"]:
                return
            time.sleep(0.02)
        self.fail("the reading job did not finish")


def document(seed: int, size=(600, 850)) -> Image.Image:
    """A white page with lines of 'text' (dark bars) laid out by the seed."""
    rnd = random.Random(seed)
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    y = 40
    while y < size[1] - 40:
        d.rectangle((40, y, 40 + rnd.randint(80, size[0] - 80), y + 10), fill=(30, 30, 30))
        y += rnd.randint(18, 60)
    return img


class Duplicates(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "repo"
        self.folder = Path(tmp.name) / "uploads"
        self.folder.mkdir()
        p = mock.patch.object(intake, "ROOT", self.root)
        p.start()
        self.addCleanup(p.stop)

    def test_the_same_picture_twice_matches_even_turned_and_recompressed(self):
        document(1).save(self.folder / "a.jpg", quality=95)
        document(2).save(self.folder / "b.jpg", quality=95)
        document(1).rotate(180).save(self.folder / "c copy.jpg", quality=40)
        sources, _ = list_sources(self.folder)
        found = dupes.find(self.folder, sources, set())
        self.assertEqual(list(found), ["c copy.jpg#1"])
        self.assertEqual(found["c copy.jpg#1"]["of"], "a.jpg#1")

    def test_a_page_already_in_data_raw_matches(self):
        raw = self.root / "data" / "raw" / "x" / "bca" / "sem1"
        raw.mkdir(parents=True)
        document(3).save(raw / "added.pdf")
        document(4).save(raw / "desk wrote this.pdf")
        document(3).save(self.folder / "again.jpg")
        document(4).save(self.folder / "mine.jpg")
        sources, _ = list_sources(self.folder)
        found = dupes.find(self.folder, sources, {(raw / "desk wrote this.pdf").resolve()})
        self.assertEqual(found, {"again.jpg#1": {"label": "data/raw/x/bca/sem1/added.pdf page 1, already added", "of": "data/raw/x/bca/sem1/added.pdf#1"}})
        self.assertTrue((self.root / dupes.CACHE).exists())

    def test_blank_and_nearly_empty_pages_match_nothing(self):
        for name in ("blank 1.png", "blank 2.png", "stamp 1.png", "stamp 2.png"):
            img = Image.new("RGB", (600, 850), "white")
            if name.startswith("stamp"):
                img.paste((200, 0, 0), (60, 60, 240, 110) if name == "stamp 1.png" else (300, 700, 480, 750))
            img.save(self.folder / name)
        sources, _ = list_sources(self.folder)
        self.assertEqual(dupes.find(self.folder, sources, set()), {})

    def test_different_pages_of_one_layout_do_not_match(self):
        for i in range(10, 30):
            document(i).save(self.folder / f"{i}.jpg")
        sources, _ = list_sources(self.folder)
        self.assertEqual(dupes.find(self.folder, sources, set()), {})


if __name__ == "__main__":
    unittest.main()
