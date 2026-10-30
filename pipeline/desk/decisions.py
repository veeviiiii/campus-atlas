"""What the maintainer decided for every page, saved as desk-decisions.json next to the sources
("<file>.desk-decisions.json" when one file is open on its own).

The desk page sends the whole state after every change; the server checks it here and writes it
atomically, so closing the page loses nothing and opening the folder again restores the work.
`written` is the server's own record of what the desk put into which manifest (so writing again
replaces its own entries and never touches anything else); the page never changes it. `reads` is
what the model read on each page ("Read pages"): raw material for suggestions, never a decision.
"""

import json
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

from pipeline.desk.geometry import SPLITS, TURNS
from pipeline.manifest import EXAM_KINDS

FILE = "desk-decisions.json"
VERSION = 1
STATUSES = ("todo", "use", "skip", "held")
SKIP_REASONS = ("duplicate", "answer sheet", "not a question paper")
HELD_REASONS = ("no year", "no test number", "no subject")
SESSION = re.compile(r"\d{4}-\d{2}")
DATE = re.compile(r"\d{4}(-\d{2})?")


@dataclass
class Part:
    """One output page: a whole source page, or one half of a split one."""

    status: str = "todo"  # todo | use | skip | held
    reason: str = ""  # why skipped / held back (one of the reasons above, or the maintainer's words)
    note: str = ""  # free text; goes into the manifest as a comment
    continues: bool = False  # the next page of the paper before it: takes its course, subject and exam
    course: str = ""
    semester: int | None = None
    subject: str = ""
    kind: str = ""  # mst1 | mst2 | mst3 | end
    session: str = ""  # "2024-25"
    rotation: int = 0  # turn of this part after the split, clockwise


@dataclass
class Page:
    rotation: int = 0  # clockwise turn of the whole page
    split: str = ""  # "" | "h" (top / bottom) | "v" (left / right)
    at: float = 0.5  # where the split is, as a fraction of the upright page
    boxes: list[list[float]] = field(default_factory=list)  # black-out boxes, fractions of the source page
    parts: list[Part] = field(default_factory=lambda: [Part()])


@dataclass
class Desk:
    version: int = VERSION
    pages: dict[str, Page] = field(default_factory=dict)  # "<source>#<page>" -> Page
    subjects: dict[str, list[dict]] = field(default_factory=dict)  # "<course>/<sem>" -> new subjects [{id, name, aliases}]
    exam_dates: dict[str, str] = field(default_factory=dict)  # exam_key() -> "2024-12" or "2024"
    written: dict[str, dict] = field(default_factory=dict)  # manifest path in the repo -> {files, exams, subjects}
    reads: dict[str, dict] = field(default_factory=dict)  # "<source>#<page>" -> the model's reading (reader.py)

    def page(self, key: str) -> Page:
        return self.pages.get(key) or Page()


def exam_key(course: str, semester: int | None, session: str, kind: str) -> str:
    return f"{course}/{semester}/{session}/{kind}"


def _turn(v, what: str) -> int:
    if v not in TURNS:
        raise ValueError(f"{what}: a turn is 0, 90, 180 or 270, not {v!r}")
    return v


def _part(d: dict, where: str) -> Part:
    p = Part(**{k: d[k] for k in Part.__dataclass_fields__ if k in d})
    if p.status not in STATUSES:
        raise ValueError(f"{where}: status {p.status!r} is not one of {STATUSES}")
    if p.kind and p.kind not in EXAM_KINDS:
        raise ValueError(f"{where}: exam {p.kind!r} is not one of {EXAM_KINDS}")
    if p.semester is not None and (not isinstance(p.semester, int) or p.semester < 1):
        raise ValueError(f"{where}: semester {p.semester!r}")
    p.rotation = _turn(p.rotation, where)
    for k in ("reason", "note", "course", "subject", "kind", "session"):
        if not isinstance(getattr(p, k), str):
            raise ValueError(f"{where}: {k} must be text")
    p.continues = bool(p.continues)
    return p


def _page(d: dict, where: str) -> Page:
    pg = Page(rotation=_turn(d.get("rotation", 0), where), split=d.get("split", ""), at=float(d.get("at", 0.5)))
    if pg.split not in SPLITS:
        raise ValueError(f"{where}: split {pg.split!r} is not one of {SPLITS}")
    if not 0.05 <= pg.at <= 0.95:
        raise ValueError(f"{where}: the split must be inside the page")
    for b in d.get("boxes", []):
        b = [float(x) for x in b]
        if len(b) != 4 or not (0 <= b[0] < b[2] <= 1 and 0 <= b[1] < b[3] <= 1):
            raise ValueError(f"{where}: black-out box {b} is not inside the page")
        pg.boxes.append(b)
    parts = [_part(p, where) for p in d.get("parts") or [{}]]
    want = 2 if pg.split else 1
    pg.parts = (parts + [Part() for _ in range(want)])[:want]  # a split page always has two parts
    return pg


def from_dict(d: dict) -> Desk:
    """Check a state sent by the page (or read from disk); ValueError says what is wrong."""
    if d.get("version", VERSION) != VERSION:
        raise ValueError(f"desk-decisions.json version {d.get('version')} (this desk reads version {VERSION})")
    desk = Desk(pages={str(k): _page(v, str(k)) for k, v in (d.get("pages") or {}).items()})
    for key, subs in (d.get("subjects") or {}).items():
        desk.subjects[str(key)] = [{"id": str(s["id"]), "name": str(s["name"]), "aliases": [str(a) for a in s.get("aliases", [])]} for s in subs]
    desk.exam_dates = {str(k): str(v) for k, v in (d.get("exam_dates") or {}).items()}
    desk.written = {str(k): {n: list(v.get(n, [])) for n in ("files", "exams", "subjects")} for k, v in (d.get("written") or {}).items()}
    desk.reads = {str(k): dict(v) for k, v in (d.get("reads") or {}).items() if isinstance(v, dict)}
    return desk


def to_dict(desk: Desk) -> dict:
    return asdict(desk)


def state_file(folder: Path, only: str = "") -> Path:
    """desk-decisions.json in the folder, or "<file>.desk-decisions.json" when only that file is open."""
    return folder / (f"{only}.{FILE}" if only else FILE)


def load(folder: Path, only: str = "") -> Desk:
    path = state_file(folder, only)
    return from_dict(json.loads(path.read_text(encoding="utf-8"))) if path.exists() else Desk()


def save(folder: Path, desk: Desk, only: str = "") -> Path:
    """Write the decisions; a crash mid-write leaves the previous file whole."""
    path = state_file(folder, only)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(to_dict(desk), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return path


@dataclass
class Piece:
    """One part in desk order, with `continues` resolved: a continuing part takes its status, course,
    semester, subject and exam from the part before it that is not skipped."""

    key: str  # "<source>#<page>"
    part: int
    halves: int  # 1, or 2 for a split page
    split: str
    decision: Part
    follows: "Piece | None" = None  # the part it continues

    @property
    def label(self) -> str:
        src, page = self.key.rsplit("#", 1)
        side = {("h", 0): "top half", ("h", 1): "bottom half", ("v", 0): "left half", ("v", 1): "right half"}
        return f'"{src}" page {page}' + (f" ({side[(self.split, self.part)]})" if self.halves == 2 else "")

    @property
    def id(self) -> str:
        return f"{self.key}:{self.part}"


INHERITED = ("status", "reason", "course", "semester", "subject", "kind", "session")


def pieces(desk: Desk, page_keys: list[str]) -> list[Piece]:
    """Every part of every page, in desk order (source, page, top before bottom)."""
    out: list[Piece] = []
    last: Piece | None = None
    for key in page_keys:
        pg = desk.page(key)
        for i, part in enumerate(pg.parts):
            piece = Piece(key, i, len(pg.parts), pg.split, part)
            if part.continues and last is not None:
                piece.decision = Part(**{**asdict(part), **{k: getattr(last.decision, k) for k in INHERITED}})
                piece.follows = last
            out.append(piece)
            if piece.decision.status in ("use", "held"):
                last = piece
    return out
