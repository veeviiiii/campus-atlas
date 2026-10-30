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
from pipeline.desk import decisions, export, geometry
from pipeline.desk.decisions import Desk, Page, Part
from pipeline.desk.sources import list_sources

RED = (255, 0, 0)
CATALOG = {"courses": [{"id": "bca", "name": "BCA", "school": "Test School", "college": "test-college", "field": "computer-applications", "years": 3}]}


def reds(img: Image.Image) -> int:
    """Pixels that are clearly red (the 'name' the black-out must hide)."""
    data = img.convert("RGB").tobytes()
    return sum(1 for i in range(0, len(data), 3) if data[i] > 200 and data[i + 1] < 80 and data[i + 2] < 80)


def source_image(w: int = 120, h: int = 80, name: tuple[int, int, int, int] = (10, 50, 40, 60)) -> Image.Image:
    """A white page with a red 'name' and a distinct mark in each corner, so turns are visible."""
    img = Image.new("RGB", (w, h), "white")
    img.paste(RED, name)
    img.paste((0, 0, 255), (0, 0, 4, 4))
    return img


class Geometry(unittest.TestCase):
    def test_box_to_upright_and_back(self):
        box = (0.1, 0.2, 0.35, 0.3)
        for rot in geometry.TURNS:
            back = geometry.to_source(geometry.to_upright(box, rot), rot)
            for a, b in zip(back, box):
                self.assertAlmostEqual(a, b)

    def test_turn_box_matches_turning_the_pixels(self):
        img = source_image()
        box = (10 / 120, 50 / 80, 40 / 120, 60 / 80)  # exactly the red patch
        for rot in geometry.TURNS:
            turned = geometry.turn(img, rot)
            x0, y0, x1, y1 = geometry.box_pixels(geometry.to_upright(box, rot), turned.size)
            inside = turned.crop((x0, y0, x1, y1))
            self.assertEqual(reds(inside), (x1 - x0) * (y1 - y0), f"turn {rot}")
            self.assertEqual(reds(turned), 30 * 10)

    def test_a_box_drawn_on_the_turned_page_hides_the_name_after_any_turn_and_split(self):
        img = source_image()
        name_on_source = (10 / 120, 50 / 80, 40 / 120, 60 / 80)
        for drawn_at in geometry.TURNS:
            # The maintainer draws the box around the name as it shows on the turned page.
            seen = geometry.to_upright(name_on_source, drawn_at)
            stored = geometry.to_source(seen, drawn_at)
            for rot in geometry.TURNS:  # and turns the page again afterwards
                for split in geometry.SPLITS:
                    for part in (0, 1) if split else (0,):
                        for part_rot in (0, 90):
                            out = geometry.render_part(img, [stored], rot, split, 0.4, part, part_rot)
                            self.assertEqual(reds(out), 0, f"drawn at {drawn_at}, turned {rot}, split {split!r} part {part}")

    def test_the_parts_add_up_to_the_page(self):
        img = source_image()
        boxes = [(0.05, 0.6, 0.4, 0.8)]
        for rot in geometry.TURNS:
            whole = geometry.render_part(img, boxes, rot, "", 0.5, 0)
            self.assertEqual(whole.tobytes(), geometry.turn(geometry.burn(img, boxes), rot).tobytes())
            for split, at in (("h", 0.37), ("v", 0.61)):
                a, b = (geometry.render_part(img, boxes, rot, split, at, i) for i in (0, 1))
                joined = Image.new("RGB", whole.size)
                joined.paste(a, (0, 0))
                joined.paste(b, (0, a.height) if split == "h" else (a.width, 0))
                self.assertEqual(joined.tobytes(), whole.tobytes(), f"turn {rot}, split {split}")
                self.assertEqual(a.size[0] if split == "h" else a.size[1], whole.size[0] if split == "h" else whole.size[1])

    def test_burn_covers_partial_pixels_and_does_not_change_the_original(self):
        img = Image.new("RGB", (10, 10), "white")
        out = geometry.burn(img, [(0.11, 0.11, 0.29, 0.29)])  # 1.1 px to 2.9 px: pixels 1 and 2
        black = {(x, y) for y in range(10) for x in range(10) if out.getpixel((x, y)) == (0, 0, 0)}
        self.assertEqual(black, {(x, y) for x in (1, 2) for y in (1, 2)})
        self.assertEqual(img.getpixel((1, 1)), (255, 255, 255))


class Decisions(unittest.TestCase):
    def test_round_trip(self):
        desk = Desk(
            pages={
                "a.pdf#1": Page(rotation=90, split="h", at=0.42, boxes=[[0.1, 0.2, 0.3, 0.4]], parts=[
                    Part(status="use", course="bca", semester=1, subject="maths", kind="mst1", session="2024-25", note="top"),
                    Part(status="held", reason="no year", rotation=180),
                ]),
                "photos/b.jpg#1": Page(parts=[Part(status="skip", reason="duplicate")]),
            },
            subjects={"bca/1": [{"id": "maths", "name": "Mathematics", "aliases": ["Maths"]}]},
            exam_dates={"bca/1/2024-25/mst1": "2024-09"},
            written={"data/raw/x/manifest.yaml": {"files": ["f.pdf"], "exams": ["mst1"], "subjects": ["maths"]}},
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = decisions.save(Path(tmp), desk)
            self.assertEqual(path.name, "desk-decisions.json")
            self.assertEqual(decisions.load(Path(tmp)), desk)
            self.assertEqual(decisions.from_dict(json.loads(path.read_text(encoding="utf-8"))), desk)
            self.assertFalse(any(p.name.endswith(".tmp") for p in Path(tmp).iterdir()))

    def test_missing_file_and_missing_keys_mean_nothing_decided(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(decisions.load(Path(tmp)), Desk())
        desk = decisions.from_dict({"pages": {"a.pdf#1": {"split": "v"}}})
        self.assertEqual(len(desk.pages["a.pdf#1"].parts), 2)  # a split page always has two parts
        self.assertEqual(desk.page("a.pdf#9"), Page())

    def test_bad_values_are_refused(self):
        for bad in ({"rotation": 45}, {"split": "x"}, {"at": 1.0}, {"boxes": [[0.5, 0.5, 0.2, 0.9]]}, {"boxes": [[0, 0, 1, 1.5]]},
                    {"parts": [{"status": "maybe"}]}, {"parts": [{"kind": "mst9"}]}, {"parts": [{"rotation": 30}]}):
            with self.assertRaises(ValueError, msg=bad):
                decisions.from_dict({"pages": {"a.pdf#1": bad}})
        with self.assertRaises(ValueError):
            decisions.from_dict({"version": 99})

    def test_continuing_pages_take_the_paper_before_them(self):
        desk = decisions.from_dict({"pages": {
            "a.pdf#1": {"parts": [{"continues": True}]},  # nothing before it
            "a.pdf#2": {"parts": [{"status": "use", "course": "bca", "semester": 1, "subject": "maths", "kind": "end", "session": "2024-25"}]},
            "a.pdf#3": {"parts": [{"status": "skip", "reason": "answer sheet"}]},
            "a.pdf#4": {"parts": [{"continues": True, "note": "page 2"}]},
        }})
        ps = decisions.pieces(desk, [f"a.pdf#{n}" for n in range(1, 5)])
        self.assertIsNone(ps[0].follows)
        self.assertIs(ps[3].follows, ps[1])  # the skipped answer sheet in between does not count
        self.assertEqual((ps[3].decision.status, ps[3].decision.subject, ps[3].decision.note), ("use", "maths", "page 2"))
        self.assertEqual(ps[3].label, '"a.pdf" page 4')


class Names(unittest.TestCase):
    def test_file_names(self):
        base = export.pdf_base("bca", 1, "2024-25", "end")
        self.assertEqual(base, "bca-sem1_2024-25_end")
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.assertEqual(export.file_name(folder, base, set(), set(), set()), "bca-sem1_2024-25_end.pdf")
            (folder / "bca-sem1_2024-25_end.pdf").write_bytes(b"made by hand")
            self.assertEqual(export.file_name(folder, base, set(), set(), set()), "bca-sem1_2024-25_end_2.pdf")
            self.assertEqual(export.file_name(folder, base, set(), {"bca-sem1_2024-25_end.pdf"}, set()), "bca-sem1_2024-25_end.pdf")  # the desk's own
            self.assertEqual(export.file_name(folder, base, {"bca-sem1_2024-25_end_2.pdf"}, set(), set()), "bca-sem1_2024-25_end_3.pdf")  # listed, PDF elsewhere

    def test_exam_ids(self):
        new = export.assign_exam_ids([], [("2024-25", "mst1"), ("2023-24", "end"), ("2024-25", "end")])
        self.assertEqual(new, {("2024-25", "mst1"): "mst1", ("2023-24", "end"): "end-2023-24", ("2024-25", "end"): "end"})
        existing = [{"id": "mst1", "date": "2025-09", "session": "2025-26"}, {"id": "end-2024-25", "date": "2024-12"}]
        ids = export.assign_exam_ids(existing, [("2025-26", "end"), ("2024-25", "end"), ("2024-25", "mst2"), ("2026-27", "mst1")])
        self.assertEqual(ids, {("2025-26", "end"): "end", ("2024-25", "end"): "end-2024-25", ("2024-25", "mst2"): "mst2-2024-25", ("2026-27", "mst1"): "mst1-2026-27"})


SEM5 = """\
# Human ground truth for the Semester 5 papers.
#
# Waiting for the maintainer (not listed here): a Python "MID Test".

schema_version: "1.0"

college:
  id: test-college
  name: Test School, DAVV

course:
  id: bca
  name: BCA
  semester: 1

exams:
  # 2025-26
  - {id: mst1, name: MST-1, date: "2025-09", session: "2025-26"}
  - {id: end-2024-25, name: End Sem, date: "2024-12", session: "2024-25"}

subjects:
  - id: maths
    name: Mathematics
    aliases: []

files:
  - file: bca-sem1_2025-26_mst1.pdf
    exam: mst1
    pages:
      - {page: 1, subject: maths}   # "Mid Semester Test I"

  - file: bca-sem1_2024-25_end.pdf
    exam: end-2024-25
    pages:
      - {page: 1, subject: maths}
"""


class Merge(unittest.TestCase):
    exam = {"id": "mst2-2024-25", "name": "MST-2", "date": "2024-10", "session": "2024-25"}
    subject = {"id": "c-lang", "name": "C: Programming", "aliases": ["C", "yes"]}
    file = {"file": "bca-sem1_2024-25_mst2.pdf", "exam": "mst2-2024-25", "comment": 'made by the intake desk from "x"',
            "pages": [{"page": 1, "subject": "c-lang", "continues": False, "comment": '"a.pdf" page 1 (top half); blacked out'},
                      {"page": 2, "subject": "c-lang", "continues": True, "comment": ""}]}
    nothing = {"files": [], "exams": [], "subjects": []}
    mine = {"files": ["bca-sem1_2024-25_mst2.pdf"], "exams": ["mst2-2024-25"], "subjects": ["c-lang"]}

    def merged(self, text=SEM5, before=None, **kw):
        args = {"exams": [self.exam], "subjects": [self.subject], "files": [self.file], "held": ['"b.pdf" page 3: no year'], **kw}
        return export.merge(text, before=before or self.nothing, desk_name="M.Tech Int AIDS 5 year", **args)

    def test_existing_lines_stay_and_new_ones_go_at_the_end(self):
        out = self.merged()
        lines = out.splitlines()
        it = iter(lines)
        self.assertTrue(all(line in it for line in SEM5.splitlines()), "every original line, in the original order")
        m = yaml.safe_load(out)
        self.assertEqual([e["id"] for e in m["exams"]], ["mst1", "end-2024-25", "mst2-2024-25"])
        self.assertEqual(m["subjects"][-1], {"id": "c-lang", "name": "C: Programming", "aliases": ["C", "yes"]})
        self.assertEqual(m["files"][-1]["pages"], [{"page": 1, "subject": "c-lang"}, {"page": 2, "subject": "c-lang", "continues_previous": True}])
        header = out.split("schema_version")[0]
        self.assertIn('# Held back by the intake desk from "M.Tech Int AIDS 5 year"', header)
        self.assertIn('#   - "b.pdf" page 3: no year', header)

    def test_writing_again_is_the_same_and_replaces_in_place(self):
        once = self.merged()
        self.assertEqual(self.merged(once, before=self.mine), once)
        exam = {**self.exam, "date": "2024-11"}
        file = {**self.file, "pages": self.file["pages"][:1]}
        again = self.merged(once, before=self.mine, exams=[exam], files=[file], held=[])
        m = yaml.safe_load(again)
        self.assertEqual([e["id"] for e in m["exams"]], ["mst1", "end-2024-25", "mst2-2024-25"])
        self.assertEqual(m["exams"][-1]["date"], "2024-11")
        self.assertEqual(len(m["files"][-1]["pages"]), 1)
        self.assertNotIn("Held back", again)

    def test_removing_the_desks_entries_gives_back_the_original(self):
        once = self.merged()
        self.assertEqual(export.merge(once, exams=[], subjects=[], files=[], held=[], before=self.mine, desk_name="M.Tech Int AIDS 5 year"), SEM5)

    def test_another_desks_held_back_lines_are_left_alone(self):
        once = self.merged()
        other = export.merge(once, exams=[], subjects=[], files=[], held=["page 9: no subject"], before=self.nothing, desk_name="Other senior")
        self.assertIn('#   - "b.pdf" page 3: no year', other)
        self.assertIn("#   - page 9: no subject", other)

    def test_template_placeholders_go_when_unused(self):
        c = CATALOG["courses"][0]
        with mock.patch.object(intake, "ROOT", Path("/repo")):
            text = intake.template(c, 1)
        out = export.merge(text, exams=[{**self.exam, "id": "mst2"}], subjects=[self.subject], files=[{**self.file, "exam": "mst2"}], held=[], before=self.nothing, desk_name="x")
        self.assertNotIn("TODO", "\n".join(line.split("#")[0] for line in out.splitlines()))
        m = yaml.safe_load(out)
        self.assertEqual([e["id"] for e in m["exams"]], ["mst2"])
        self.assertEqual([s["id"] for s in m["subjects"]], ["c-lang"])


def page_image(doc, i: int) -> Image.Image:
    pix = doc[i].get_pixmap(dpi=200)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def make_pdf(path: Path, pages: int, landscape: bool = False) -> None:
    """Pages with a red 'name' near the top left."""
    doc = pymupdf.open()
    for _ in range(pages):
        page = doc.new_page(width=300 if landscape else 200, height=200 if landscape else 300)
        page.draw_rect(pymupdf.Rect(20, 20, 80, 35), color=None, fill=(1, 0, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)


class Write(unittest.TestCase):
    """A whole write, in a temporary repo (catalog + data/raw) with a folder of sources."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "repo"
        (self.root / "catalog").mkdir(parents=True)
        (self.root / "catalog" / "davv.json").write_text(json.dumps(CATALOG), encoding="utf-8")
        for p in (mock.patch.object(intake, "ROOT", self.root), mock.patch.object(intake, "CATALOG", self.root / "catalog" / "davv.json")):
            p.start()
            self.addCleanup(p.stop)
        self.src = Path(tmp.name) / "Senior folder"
        make_pdf(self.src / "tests.pdf", 3)
        make_pdf(self.src / "end" / "two papers.pdf", 1, landscape=True)
        self.sem1 = self.root / "data" / "raw" / "test-college" / "bca" / "sem1"
        self.sem2 = self.root / "data" / "raw" / "test-college" / "bca" / "sem2"

    def desk(self) -> Desk:
        use = {"status": "use", "course": "bca", "semester": 1, "kind": "mst1", "session": "2024-25"}
        return decisions.from_dict({
            "pages": {
                "tests.pdf#1": {"boxes": [[0.05, 0.03, 0.45, 0.15]], "parts": [{**use, "subject": "maths"}]},
                "tests.pdf#2": {"parts": [{"continues": True}]},
                "tests.pdf#3": {"parts": [{"status": "held", "reason": "no test number", "course": "bca", "semester": 2, "subject": "physics", "note": "20 marks"}]},
                "end/two papers.pdf#1": {"split": "v", "at": 0.5, "parts": [
                    {**use, "kind": "end", "subject": "maths"},
                    {**use, "kind": "end", "subject": "c-lang", "rotation": 90},
                ]},
            },
            "subjects": {"bca/1": [{"id": "c-lang", "name": "C Programming", "aliases": ["C"]}], "bca/2": []},
            "exam_dates": {"bca/1/2024-25/mst1": "2024-09", "bca/1/2024-25/end": "2024-12"},
        })

    def write(self, desk):
        sources, broken = list_sources(self.src)
        self.assertEqual(broken, [])
        return export.write(self.src, desk, sources)

    def test_write_check_and_write_again(self):
        intake.find_course("bca", 1)
        self.sem1.mkdir(parents=True)
        (self.sem1 / "manifest.yaml").write_text(intake.template(CATALOG["courses"][0], 1).replace(
            "subjects:\n  - id: TODO-subject-id\n    name: TODO Subject Name\n    aliases: []",
            "subjects:\n  - id: maths\n    name: Mathematics\n    aliases: [Maths]"), encoding="utf-8")
        desk = self.desk()
        plan, results = self.write(desk)
        self.assertEqual(plan.errors, [])
        self.assertEqual([r["manifest"] for r in results], ["data/raw/test-college/bca/sem1/manifest.yaml", "data/raw/test-college/bca/sem2/manifest.yaml"])
        self.assertTrue(results[0]["ok"], results[0]["check"])
        self.assertTrue(results[0]["check"].startswith("data/raw/test-college/bca/sem1/manifest.yaml: ready"), results[0]["check"])
        self.assertFalse(results[1]["ok"])  # only a held-back page: the new manifest still has its TODOs

        m = yaml.safe_load((self.sem1 / "manifest.yaml").read_text(encoding="utf-8"))
        self.assertEqual({e["id"]: e["date"] for e in m["exams"]}, {"mst1": "2024-09", "end": "2024-12"})
        self.assertEqual([s["id"] for s in m["subjects"]], ["maths", "c-lang"])
        files = {f["file"]: f for f in m["files"]}
        self.assertEqual(files["bca-sem1_2024-25_mst1.pdf"]["pages"], [{"page": 1, "subject": "maths"}, {"page": 2, "subject": "maths", "continues_previous": True}])
        self.assertEqual(files["bca-sem1_2024-25_end.pdf"]["pages"], [{"page": 1, "subject": "maths"}, {"page": 2, "subject": "c-lang"}])
        held = (self.sem2 / "manifest.yaml").read_text(encoding="utf-8")
        self.assertTrue(held.splitlines()[1].startswith("# Made by the intake desk"))
        self.assertIn('"tests.pdf" page 3: no test number. physics. 20 marks', held)

        # The PDFs: 200 dpi pages, the name blacked out, the right half turned.
        with pymupdf.open(self.sem1 / "bca-sem1_2024-25_mst1.pdf") as doc:
            self.assertEqual(doc.page_count, 2)
            first = page_image(doc, 0)
            self.assertEqual(first.width, 556)  # the 200 dpi render of a 200 x 300 pt page, as the pipeline will see it
            self.assertAlmostEqual(first.height, 833, delta=1)
            self.assertLess(reds(first), 50)  # the red name is gone (JPEG edges aside)
            second = page_image(doc, 1)
            self.assertGreater(reds(second), 5000)  # page 2 had no box: its 60 x 15 pt name is still there
        with pymupdf.open(self.sem1 / "bca-sem1_2024-25_end.pdf") as doc:
            self.assertEqual([(round(p.rect.width), round(p.rect.height)) for p in doc], [(150, 200), (200, 150)])

        # Writing again changes nothing; moving the second test page elsewhere rewrites in place.
        before = (self.sem1 / "manifest.yaml").read_text(encoding="utf-8")
        self.assertEqual(self.write(desk)[0].errors, [])
        self.assertEqual((self.sem1 / "manifest.yaml").read_text(encoding="utf-8"), before)
        desk.pages["tests.pdf#2"].parts[0] = Part(status="skip", reason="duplicate")
        desk.pages["end/two papers.pdf#1"].parts[1].status = "skip"
        plan, results = self.write(desk)
        m = yaml.safe_load((self.sem1 / "manifest.yaml").read_text(encoding="utf-8"))
        self.assertEqual([len(f["pages"]) for f in m["files"]], [1, 1])
        self.assertEqual([s["id"] for s in m["subjects"]], ["maths"])  # c-lang is on no page now
        self.assertTrue(results[0]["ok"], results[0]["check"])

        # Every page skipped: the desk takes back its files, exams and subjects.
        for pg in desk.pages.values():
            for part in pg.parts:
                part.status, part.continues = "skip", False
        plan, results = self.write(desk)
        m = yaml.safe_load((self.sem1 / "manifest.yaml").read_text(encoding="utf-8"))
        self.assertEqual((m["files"], m["exams"]), (None, None))
        self.assertEqual(sorted(p.name for p in self.sem1.iterdir()), ["manifest.yaml"])

    def test_a_pdf_the_desk_did_not_make_is_never_touched(self):
        self.sem1.mkdir(parents=True)
        make_pdf(self.sem1 / "bca-sem1_2024-25_mst1.pdf", 1)  # made by hand, before the desk
        by_hand = (self.sem1 / "bca-sem1_2024-25_mst1.pdf").read_bytes()
        (self.sem1 / "manifest.yaml").write_text(SEM5.replace("bca-sem1_2025-26_mst1", "bca-sem1_2024-25_mst1"), encoding="utf-8")
        plan, _ = self.write(self.desk())
        names = [f["file"] for t in plan.targets for f in t.files]
        self.assertIn("bca-sem1_2024-25_mst1_2.pdf", names)
        self.assertEqual((self.sem1 / "bca-sem1_2024-25_mst1.pdf").read_bytes(), by_hand)
        m = yaml.safe_load((self.sem1 / "manifest.yaml").read_text(encoding="utf-8"))
        ids = [e["id"] for e in m["exams"]]
        self.assertEqual(ids[:2], ["mst1", "end-2024-25"])  # untouched; the 2024-25 papers join end-2024-25
        self.assertIn("mst1-2024-25", ids)
        warnings = " ".join(w["message"] for w in plan.warnings)
        self.assertIn("already has maths in end-2024-25", warnings)

    def test_nothing_is_written_while_a_page_is_unfinished(self):
        desk = self.desk()
        desk.pages["tests.pdf#1"].parts[0].subject = ""
        desk.exam_dates["bca/1/2024-25/end"] = "2023-12"
        plan, results = self.write(desk)
        self.assertEqual(results, [])
        messages = [e["message"] for e in plan.errors]
        self.assertTrue(any("needs subject" in x for x in messages), messages)
        self.assertTrue(any("falls in session 2023-24" in x for x in messages), messages)
        self.assertFalse(self.sem1.exists())


class Server(Write):
    """The desk page's API, on a real local server."""

    def setUp(self):
        super().setUp()
        import http.client
        import threading
        from http.server import ThreadingHTTPServer

        from pipeline.desk import server

        self.app = server.App()
        self.app.open(self.src)
        self.wait(lambda: self.app.dupes_ready)  # the picture matches run in the background, in the temporary repo
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(self.app, 0))
        port = self.httpd.server_address[1]
        self.httpd.RequestHandlerClass = server.make_handler(self.app, port)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.conn = lambda: http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        self.host = f"127.0.0.1:{port}"

    def wait(self, done):
        import time

        for _ in range(250):
            if done():
                return
            time.sleep(0.02)
        self.fail("timed out")

    def request(self, method, path, body=None, **headers):
        c = self.conn()
        data = json.dumps(body).encode() if body is not None else None
        c.request(method, path, body=data, headers={"Host": self.host, **({"Content-Type": "application/json"} if data else {}), **headers})
        r = c.getresponse()
        return r.status, r.read()

    def test_saving_keeps_what_the_desk_wrote_and_reopening_restores_it(self):
        self.app.desk.written = {"data/raw/x/manifest.yaml": {"files": ["f.pdf"], "exams": [], "subjects": []}}
        state = {"pages": {"tests.pdf#1": {"rotation": 270, "parts": [{"status": "skip", "reason": "duplicate"}]}}, "written": {}}
        status, _ = self.request("PUT", "/api/state", state)
        self.assertEqual(status, 200)
        again = decisions.load(self.src)
        self.assertEqual(again.pages["tests.pdf#1"].rotation, 270)
        self.assertEqual(again.written, {"data/raw/x/manifest.yaml": {"files": ["f.pdf"], "exams": [], "subjects": []}})
        status, body = self.request("GET", "/api/folder")
        info = json.loads(body)
        self.assertEqual(info["state"]["pages"]["tests.pdf#1"]["parts"][0]["reason"], "duplicate")
        self.assertNotIn("written", info["state"])
        self.assertEqual([(s["id"], s["pages"]) for s in info["sources"]], [("end/two papers.pdf", 1), ("tests.pdf", 3)])
        status, _ = self.request("PUT", "/api/state", {"pages": {"tests.pdf#1": {"rotation": 45}}})
        self.assertEqual(status, 400)
        self.assertEqual(decisions.load(self.src).pages["tests.pdf#1"].rotation, 270)  # a bad state is not saved

    def test_pictures(self):
        status, body = self.request("GET", "/api/thumb?src=tests.pdf&page=1&rot=90&split=h&at=0.5&part=1&prot=0&boxes=0.1,0.1,0.5,0.2&w=100")
        self.assertEqual(status, 200)
        self.assertEqual(Image.open(io.BytesIO(body)).format, "JPEG")
        self.assertEqual(self.request("GET", "/api/image?src=../secret.pdf&page=1")[0], 400)

    def test_a_run_shows_the_reports_unsure_list(self):
        import sys
        import time

        from pipeline.desk import server

        run_dir = self.root / "runs" / "20261031-000000"
        run_dir.mkdir(parents=True)
        unsure = [{"page_ref": "x.pdf#p2", "step": "validate", "error": "text too short", "raw": "Q3"}]
        (run_dir / "report.json").write_text(json.dumps({"unsure": unsure, "papers": [{"questions": 7}], "dropped": [], "disagreements": [{}]}), encoding="utf-8")
        # A stand-in for build_pack: prints like it, calls no model.
        r = server.Run("data/raw/x/manifest.yaml", cmd=[sys.executable, "-c", "print('model: m | papers: 1'); print('report: runs/20261031-000000/report.md')"])
        for _ in range(100):
            if r.code is not None:
                break
            time.sleep(0.05)
        self.assertEqual(r.code, 0)
        self.assertIn("model: m | papers: 1", r.lines)
        rep = r.report()
        self.assertEqual((rep["unsure"], rep["questions"], rep["disagreements"]), (unsure, 7, 1))

    def test_one_file_opens_on_its_own(self):
        status, body = self.request("POST", "/api/open", {"folder": f'"{self.src / "tests.pdf"}"'})  # quotes as Windows copies a path
        self.assertEqual(status, 200, body)
        info = json.loads(body)
        self.assertEqual(([s["id"] for s in info["sources"]], info["name"], info["state_file"]), (["tests.pdf"], "tests.pdf", "tests.pdf.desk-decisions.json"))
        self.wait(lambda: self.app.dupes_ready)
        self.request("PUT", "/api/state", {"pages": {"tests.pdf#1": {"parts": [{"status": "skip"}]}}})
        self.assertTrue((self.src / "tests.pdf.desk-decisions.json").exists())
        self.assertFalse((self.src / "desk-decisions.json").exists())
        status, body = self.request("GET", "/api/browse?path=" + str(self.src).replace(" ", "%20"))
        self.assertEqual([f["name"] for f in json.loads(body)["files"]], ["tests.pdf"])

    def test_reading_pages_through_the_api(self):
        from pipeline.desk import reader
        from pipeline.providers import Provider

        class StandIn(Provider):  # answers every page the same way; no model is called
            model = "stand-in"

            def generate(self, prompt, images=None, step=""):
                return json.dumps({"rotation": 0, "kind": "question paper", "papers": [
                    {"position": "whole", "has_header": True, "exam_title": "MST-1", "subject_name": "Maths", "course_name": "BCA",
                     "semester": "I Sem", "date": "Sept. 2024", "year": None}]})

        for p in (mock.patch.object(reader, "provider", lambda: StandIn()), mock.patch.object(reader, "problem", lambda: "")):
            p.start()
            self.addCleanup(p.stop)
        self.sem1.mkdir(parents=True)
        (self.sem1 / "manifest.yaml").write_text(intake.template(CATALOG["courses"][0], 1).replace(
            "subjects:\n", "subjects:\n  - id: maths\n    name: Mathematics\n    aliases: [Maths]\n", 1), encoding="utf-8")
        decided = {"pages": {"tests.pdf#3": {"parts": [{"status": "skip"}]}}}  # a decided page is not read
        self.request("PUT", "/api/state", decided)
        status, body = self.request("POST", "/api/read", {})
        self.assertEqual(json.loads(body), {"queued": 3, "model": "stand-in"})
        self.wait(lambda: not json.loads(self.request("GET", "/api/read")[1])["running"])
        r = json.loads(self.request("GET", "/api/read")[1])
        self.assertEqual((r["done"], r["failed"], r["dupes_ready"]), (3, 0, True))
        s = r["suggestions"]["tests.pdf#1"]["parts"][0]
        self.assertEqual({k: s[k] for k in ("status", "course", "semester", "subject", "kind", "session", "date")},
                         {"status": "use", "course": "bca", "semester": 1, "subject": "maths", "kind": "mst1", "session": "2024-25", "date": "2024-09"})
        # Readings are kept in the decisions file, and saving the page's state does not drop them.
        self.request("PUT", "/api/state", decided)
        self.assertEqual(sorted(decisions.load(self.src).reads), ["end/two papers.pdf#1", "tests.pdf#1", "tests.pdf#2"])
        self.assertNotIn("reads", json.loads(self.request("GET", "/api/folder")[1])["state"])
        self.assertEqual(json.loads(self.request("POST", "/api/read", {})[1])["queued"], 0)  # all read already
        self.assertEqual(json.loads(self.request("POST", "/api/read", {"pages": ["tests.pdf#1", "nope.pdf#1"]})[1])["queued"], 1)

    def test_reading_needs_a_key_but_nothing_else_does(self):
        from pipeline.desk import reader

        with mock.patch.dict("os.environ", {"MODEL_PROVIDER": "gemini", "GEMINI_API_KEY": ""}):
            self.assertEqual(reader.problem(), "no GEMINI_API_KEY in .env")
            status, body = self.request("POST", "/api/read", {})
            self.assertEqual((status, json.loads(body)["error"]), (400, "cannot read pages: no GEMINI_API_KEY in .env"))
            self.assertEqual(json.loads(self.request("GET", "/api/folder")[1])["reader"]["problem"], "no GEMINI_API_KEY in .env")

    def test_other_sites_cannot_use_it(self):
        self.assertEqual(self.request("GET", "/api/folder", Host="evil.example:80")[0], 403)
        self.assertEqual(self.request("PUT", "/api/state", {"pages": {}}, Origin="https://evil.example")[0], 403)
        c = self.conn()
        c.request("POST", "/api/run", body=b'{"manifest": "x"}', headers={"Host": self.host, "Content-Type": "text/plain"})
        self.assertEqual(c.getresponse().status, 403)  # a form post from another page cannot start a paid run


if __name__ == "__main__":
    unittest.main()
