"""Read pages with the model so the desk can pre-fill its fields ("Read pages" on the desk page).

A reading is raw material: suggest.py turns it into suggested fields, and nothing counts until the
maintainer accepts it. Nothing is read until the button is pressed. Answers are cached in
data/work/cache like the pipeline's, so reading a folder again costs no calls.

The model is DESK_MODEL_ID from .env, or the pipeline's model when that is empty.
"""

import os
import threading
from collections import deque
from pathlib import Path
from typing import Callable, Literal

from PIL import Image
from pydantic import BaseModel, Field

from pipeline import providers
from pipeline.desk.decisions import Page
from pipeline.desk.geometry import render_part, turn
from pipeline.desk.sources import load_page
from pipeline.validate import ask

READ_PROMPT = """This is a photo or scan of one page that a student sent in as a university exam paper.
Reply with JSON only:
{"rotation": R,
 "kind": "question paper" or "answer sheet" or "notes" or "blank" or "other",
 "papers": [{"position": "whole" or "top" or "bottom" or "left" or "right",
             "has_header": true or false,
             "exam_title": "<exam name exactly as printed, e.g. 'Mid Semester Test-I', 'TEST-II', 'Semester End Examination'> or null",
             "subject_name": "<subject exactly as printed> or null",
             "course_name": "<course or programme exactly as printed, e.g. 'M.Tech. (AI & DS) 5 Yrs'> or null",
             "semester": "<semester as printed, e.g. 'III Sem'> or null",
             "date": "<exam date or month as printed, e.g. '12/10/2025' or 'Dec 2024'> or null",
             "year": "<academic year or session as printed, e.g. '2024-25'> or null"}]}
Rules:
- R: how many degrees the image must be turned CLOCKWISE so the printed text reads normally: 0, 90, 180 or 270.
- kind: "question paper" for a printed exam question paper; "answer sheet" for a student's written answers; "notes" for notes or a book page.
- papers: one entry per question paper on the page, as seen after turning it upright. Two papers side by side are "left" and "right"; one above the other "top" and "bottom"; a single paper is one entry with "whole". For anything that is not a question paper, papers is [].
- Read only PRINTED text. Ignore handwriting (names, roll numbers, answers, ticks) and pieces of other papers at the edges.
- has_header false: this page of the paper has no printed header (it continues an earlier page); set the other fields to null.
- Copy text exactly as printed. Never guess: anything not printed is null."""

KINDS = ("question paper", "answer sheet", "notes", "blank", "other")
WORKERS = 3  # pages read at the same time
GIVE_UP = 3  # stop when the first pages all fail (a wrong key or model id fails every page)


class PaperRead(BaseModel):
    position: Literal["whole", "top", "bottom", "left", "right"] = "whole"
    has_header: bool = True
    exam_title: str | None = None
    subject_name: str | None = None
    course_name: str | None = None
    semester: str | None = None
    date: str | None = None
    year: str | None = None


class PageRead(BaseModel):
    rotation: Literal[0, 90, 180, 270]
    kind: Literal["question paper", "answer sheet", "notes", "blank", "other"]
    papers: list[PaperRead] = Field(default_factory=list)


def check_read(r: PageRead) -> str | None:
    if r.kind != "question paper":
        return None
    if not 1 <= len(r.papers) <= 2:
        return f"a question paper page holds one or two papers, not {len(r.papers)}"
    if len(r.papers) == 2 and sorted(p.position for p in r.papers) not in (["bottom", "top"], ["left", "right"]):
        return 'two papers on one page are "top" and "bottom", or "left" and "right"'
    return None


def model_name() -> str:
    if os.environ.get("DESK_MODEL_ID"):
        return os.environ["DESK_MODEL_ID"]
    if os.environ.get("MODEL_PROVIDER", "gemini") == "openai_compatible":
        return os.environ.get("OPENAI_MODEL", "gemma4:e4b")
    return os.environ.get("MODEL_ID", "")


def problem() -> str:
    """Why reading cannot start (shown on the page), or ""."""
    if os.environ.get("MODEL_PROVIDER", "gemini") == "gemini" and not os.environ.get("GEMINI_API_KEY"):
        return "no GEMINI_API_KEY in .env"
    if not model_name():
        return "no MODEL_ID (or DESK_MODEL_ID) in .env"
    return ""


def provider() -> providers.Provider:
    return providers.get_provider(os.environ.get("DESK_MODEL_ID", ""))


def read_image(img: Image.Image, prov: providers.Provider) -> dict:
    """One reading of a picture: {"rotation", "kind", "papers", "error"}. A picture the model says is
    turned is read again upright, where printed text is read better."""
    res, err, _ = ask(prov, READ_PROMPT, [img], PageRead, "desk-read", check_read)
    if res is None or err:
        return {"rotation": 0, "kind": "", "papers": [], "error": err or "no answer"}
    out = {"rotation": res.rotation, "kind": res.kind, "papers": [p.model_dump() for p in res.papers], "error": ""}
    if res.rotation and res.kind == "question paper":
        again, err2, _ = ask(prov, READ_PROMPT, [turn(img, res.rotation)], PageRead, "desk-read", check_read)
        if again is not None and not err2 and again.rotation == 0:
            out.update(kind=again.kind, papers=[p.model_dump() for p in again.papers])
    return out


def read_page(folder: Path, src: str, n: int, pg: Page, prov: providers.Provider) -> dict:
    """Read one page as the maintainer has it now: black-out boxes burned in, turned as set. A page
    already split is read half by half; otherwise the reading may suggest a split.
    Returns {"model", "rotation", "split", "parts": [{"rotation", "kind", "paper"}], "error"}:
    turns are whole turns of the source page (and of each half), not changes."""
    img = load_page(folder, src, n)
    out = {"model": prov.model, "rotation": pg.rotation, "split": pg.split, "parts": [], "error": ""}
    if pg.split:
        for i, part in enumerate(pg.parts):
            r = read_image(render_part(img, pg.boxes, pg.rotation, pg.split, pg.at, i, part.rotation), prov)
            out["parts"].append({"rotation": (part.rotation + r["rotation"]) % 360, "kind": r["kind"],
                                 "paper": r["papers"][0] if r["papers"] else None, "error": r["error"]})
        out["error"] = "; ".join(p["error"] for p in out["parts"] if p["error"])
        return out
    r = read_image(render_part(img, pg.boxes, pg.rotation, "", 0.5, 0), prov)
    out["rotation"] = (pg.rotation + r["rotation"]) % 360
    out["error"] = r["error"]
    papers = r["papers"]
    if len(papers) == 2:
        order = {"top": 0, "left": 0, "bottom": 1, "right": 1}
        papers = sorted(papers, key=lambda p: order[p["position"]])
        out["split"] = "h" if papers[0]["position"] == "top" else "v"
        out["parts"] = [{"rotation": 0, "kind": r["kind"], "paper": p, "error": ""} for p in papers]
    else:
        out["split"] = ""
        out["parts"] = [{"rotation": 0, "kind": r["kind"], "paper": papers[0] if papers else None, "error": r["error"]}]
    return out


class Reader:
    """Reads pages in the background, a few at a time. `read(key)` returns a reading and `store(key,
    reading)` keeps it; the desk page polls status()."""

    def __init__(self, read: Callable[[str], dict], store: Callable[[str, dict], None], workers: int = WORKERS):
        self.read, self.store, self.workers = read, store, workers
        self.lock = threading.Lock()
        self.queue: deque[str] = deque()
        self.busy: set[str] = set()
        self.active = 0
        self.total = self.done = self.failed = 0
        self.stopped_because = ""

    def add(self, keys: list[str]) -> int:
        with self.lock:
            if self.active == 0:
                self.total = self.done = self.failed = 0
                self.stopped_because = ""
            new = [k for k in keys if k not in self.queue and k not in self.busy]
            self.queue.extend(new)
            self.total += len(new)
            start = min(self.workers - self.active, len(self.queue))
            self.active += start
        for _ in range(start):
            threading.Thread(target=self._work, daemon=True).start()
        return len(new)

    def stop(self, because: str = "") -> None:
        with self.lock:
            self.total -= len(self.queue)
            self.queue.clear()
            if because:
                self.stopped_because = because

    def _work(self) -> None:
        while True:
            with self.lock:
                if not self.queue:
                    self.active -= 1
                    return
                key = self.queue.popleft()
                self.busy.add(key)
            try:
                reading = self.read(key)
            except Exception as e:  # a page the model could not read is shown with the reason, never dropped
                reading = {"error": f"{type(e).__name__}: {e}"[:300]}
            self.store(key, reading)
            with self.lock:
                self.busy.discard(key)
                self.done += 1
                self.failed += bool(reading.get("error"))
                give_up = self.failed >= GIVE_UP and self.failed == self.done
            if give_up:
                self.stop(f"the first {self.failed} pages all failed: {reading.get('error', '')}")

    def status(self) -> dict:
        with self.lock:
            return {"running": self.active > 0, "total": self.total, "done": self.done, "failed": self.failed,
                    "reading": sorted(self.busy), "stopped": self.stopped_because}
