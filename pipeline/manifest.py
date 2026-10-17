"""Manifest loading plus subject / exam name matching.

Subjects are identified by normalized NAME + alias table, never by course code.
"""

import difflib
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}


@dataclass
class PageInfo:
    file: str
    exam: str
    page: int
    subject: str
    rotation: int | None = None
    continues_previous: bool = False

    @property
    def ref(self) -> str:
        return f"{self.file}#p{self.page}"

    @property
    def stem(self) -> str:
        return f"{Path(self.file).stem}_p{self.page}"


@dataclass
class Paper:
    """One exam paper of one subject: one or more consecutive pages."""

    subject: str
    exam: str
    pages: list[PageInfo]

    @property
    def ref(self) -> str:
        return ", ".join(p.ref for p in self.pages)


def load_manifest(path: Path) -> dict:
    m = yaml.safe_load(path.read_text(encoding="utf-8"))
    m["_dir"] = path.parent
    return m


def page_infos(m: dict) -> list[PageInfo]:
    out = []
    for f in m["files"]:
        for p in f["pages"]:
            out.append(PageInfo(f["file"], f["exam"], p["page"], p["subject"], p.get("rotation"), p.get("continues_previous", False)))
    return out


def papers(m: dict) -> list[Paper]:
    """Group pages into papers; a page with continues_previous joins the paper before it."""
    out: list[Paper] = []
    for p in page_infos(m):
        if p.continues_previous and out and out[-1].subject == p.subject and out[-1].exam == p.exam:
            out[-1].pages.append(p)
        else:
            out.append(Paper(p.subject, p.exam, [p]))
    return out


def normalize(name: str) -> str:
    """'PHYSICS-I' -> 'physics 1', 'Fundamentals & X' -> 'fundamentals and x'."""
    s = re.sub(r"[^a-z0-9]+", " ", name.lower().replace("&", " and "))
    return " ".join(ROMAN.get(t, t) for t in s.split())


def _strip_number(s: str) -> str:
    return re.sub(r"\s\d+$", "", s)


def match_subject(m: dict, name: str | None) -> str | None:
    """Map a subject name read from a header to a subject id, or None."""
    if not name:
        return None
    s = normalize(name)
    variants = []  # (normalized variant, subject id)
    for subj in m["subjects"]:
        for v in [subj["name"], *subj.get("aliases", [])]:
            variants.append((normalize(v), subj["id"]))

    for v, sid in variants:  # 1. exact
        if s == v or _strip_number(s) == _strip_number(v):
            return sid
    hits = [(len(v), sid) for v, sid in variants if len(_strip_number(v)) >= 5 and re.search(rf"\b{re.escape(_strip_number(v))}\b", s)]
    if hits:  # 2. a known name appears inside the header text; longest wins
        return max(hits)[1]
    best = max(variants, key=lambda x: difflib.SequenceMatcher(None, s, x[0]).ratio())  # 3. fuzzy
    return best[1] if difflib.SequenceMatcher(None, s, best[0]).ratio() >= 0.85 else None


def match_exam(title: str | None) -> str | None:
    """Map an exam title read from a header ('Mid Semester -1 Test', 'TEST-II', ...) to mst1 / mst2 / end."""
    if not title:
        return None
    s = normalize(title)
    if re.search(r"\bend\b", s):
        return "end"
    if re.search(r"\b(test|mst|mid semester|internal test)\s*2\b", s) or re.search(r"\bsecond\b", s):
        return "mst2"
    if re.search(r"\b(test|mst|mid semester|internal test)\s*1\b", s):
        return "mst1"
    return None


def subject_name(m: dict, sid: str) -> str:
    return next(s["name"] for s in m["subjects"] if s["id"] == sid)


def exam_name(m: dict, eid: str) -> str:
    return next(e["name"] for e in m["exams"] if e["id"] == eid)


def work_dir(m: dict) -> Path:
    """Intermediate files for one course: data/work/<college>/<course>-sem<N>/ (pages, oriented, extracted).
    Kept apart per course so two colleges with a 'physics-1' subject never overwrite each other."""
    root = Path(__file__).resolve().parent.parent
    return root / "data" / "work" / m["college"]["id"] / f"{m['course']['id']}-sem{m['course']['semester']}"
