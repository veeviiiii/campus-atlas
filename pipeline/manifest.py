"""Manifest loading plus subject / exam name matching.

Subjects are identified by normalized NAME + alias table, never by course code.

One manifest (and one pack) holds every year of one course-semester. Exam ids are a kind
(mst1 / mst2 / mst3 / end) for the first year added and "<kind>-<session>" for every other year,
e.g. mst1-2024-25, so the first year's question ids never change when older papers arrive.
An exam's date is "YYYY-MM", or just "YYYY" when the paper does not print the month.
"""

import difflib
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}
EXAM_KINDS = ("mst1", "mst2", "mst3", "end")  # in the order they are held within a semester


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
    check_exams(m)
    return m


def exam_kind(eid: str) -> str:
    """'mst1' -> 'mst1', 'end-2024-25' -> 'end'."""
    return eid.split("-", 1)[0]


def session_of(date: str) -> str:
    """Academic session of an exam month: '2025-10' and '2026-01' -> '2025-26' (sessions start in July)."""
    if not re.fullmatch(r"\d{4}-\d{2}", date):
        raise ValueError(f"date {date!r} has no month, so the session can't be worked out: add session: \"YYYY-YY\"")
    y, mo = (int(x) for x in date.split("-"))
    start = y if mo >= 7 else y - 1
    return f"{start}-{(start + 1) % 100:02d}"


def check_exams(m: dict) -> None:
    """Give every exam its session (from its date unless the manifest says) and refuse ids the pack builder would misread."""
    ids = [e["id"] for e in m["exams"]]
    for e in m["exams"]:
        if not re.fullmatch(r"\d{4}(-\d{2})?", str(e["date"])):
            raise ValueError(f"exam {e['id']!r}: date {e['date']!r} should look like \"2025-10\" (or \"2025\" when the month is not printed)")
        if "session" not in e:
            e["session"] = session_of(e["date"])
        kind = exam_kind(e["id"])
        if kind not in EXAM_KINDS or e["id"] not in (kind, f"{kind}-{e['session']}"):
            raise ValueError(f"exam id {e['id']!r}: use mst1 / mst2 / mst3 / end, or add the session for another year (e.g. mst1-{e['session']})")
    if len(set(ids)) != len(ids):
        raise ValueError(f"exam ids must be unique: {ids}")
    files = [f["file"] for f in m["files"]]
    if len(set(files)) != len(files):
        raise ValueError("file names must be unique (page photos are named after them)")
    for f in m["files"]:
        if f["exam"] not in ids:
            raise ValueError(f"{f['file']}: unknown exam {f['exam']!r}")


def exam_order(m: dict) -> dict[str, int]:
    """Exam id -> position in time, oldest first: by session, then MST-1, MST-2, MST-3, End Sem
    (dates alone can't order them when a paper prints only the year)."""
    ranked = sorted(m["exams"], key=lambda e: (e["session"], EXAM_KINDS.index(exam_kind(e["id"])), e["date"]))
    return {e["id"]: i for i, e in enumerate(ranked)}


def sessions(m: dict, exam_ids: set[str] | None = None) -> list[str]:
    """The academic sessions in the manifest (or of these exams), oldest first."""
    return sorted({e["session"] for e in m["exams"] if exam_ids is None or e["id"] in exam_ids})


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
    """Map an exam title read from a header ('Mid Semester -1 Test', 'TEST-II', ...) to its kind: mst1 / mst2 / mst3 / end.
    An internal test is a mid-semester test: 'II Internal Test' is mst2."""
    if not title:
        return None
    s = normalize(title)
    # A number glued to the word: 'TestI', 'TESTII', 'MSTI' (normalize splits only 'Test-I' and 'Test I').
    s = re.sub(r"\binternaltest", "internal test ", s)
    s = re.sub(r"\b(test|mst|ut|internal)(iii|ii|i|\d)\b", r"\1 \2", s)
    s = re.sub(r"\b(iii|ii|i)(st|nd|rd|th)\b", r"\1", s)  # 'IInd Internal'
    s = normalize(s)  # the roman numerals split off above become digits
    s = re.sub(r"\b(no|number)\s+(\d)\b", r"\2", s)  # 'Internal Test No. 2'
    # An internal test is a mid-semester test: 'II Internal Test' (normalized '2 internal test') is internal 2.
    # Not a semester number: 'Semester II Internal Test I' is internal 1.
    s = re.sub(r"(?<!sem )(?<!semester )\b([1-3])(?:st|nd|rd|th)?\s+(internal|mst|ut)\b", r"\2 \1", s)
    if re.search(r"\bend\b", s):
        return "end"
    for n, word, nth in (("3", "third", "3rd"), ("2", "second", "2nd"), ("1", "first", "1st")):
        if (re.search(rf"\b(test|mst|ut|internal|mid semester|exam)\s*{n}(st|nd|rd|th)?\b", s) or re.search(rf"\b{word}\b", s)
                or re.search(rf"\b{nth}\s+(term|test|class|mid|internal)", s)):  # "1st Term exam", not "3rd semester"
            return f"mst{n}"
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
