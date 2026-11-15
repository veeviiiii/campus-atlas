"""Human corrections to what the model read: data/raw/<college>/<course>/sem<N>/corrections.yaml.

Like the manifest, this file is human ground truth and it wins. It exists because a pack is never
edited by hand: when a person has compared a question with the photo of its page and the pack is
wrong, the fix goes here, the pipeline applies it and the pack says so (harness.corrections).

    audited_pages: ["End_sem_pyq_sem1.pdf#p5", ...]   # pages a second reader compared with the pack
    reader: "who checked, and when"
    corrections:
      - page: "End_sem_pyq_sem1.pdf#p5"
        match: "Derive the Lorentz transformation"    # a piece of the question's text as the pack has it
        set: {marks: 10}                              # any of: text, marks, sub_parts, table_markdown
        why: "the photo prints 10 marks, the pack says 16"
        status: confirmed                             # "proposed" entries are NOT applied
      - {page: "...", match: "...", drop: true, why: "belongs to the paper underneath", status: confirmed}
    missed:                                           # printed on the page, absent from the pack
      - {page: "...", text: "...", why: "..."}        # reported and counted; never typed into the pack

A question is found by its page and its text, never by its number (handwritten renumbering). An entry
that finds no question, or more than one, is not applied: it goes to the pack's unsure list.

Corrections are applied after the questions are grouped into topics and compared for repeats, so a
fix never reshuffles the topics; marks fixes do reach the topic's marks.
"""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from pipeline.manifest import normalize
from pipeline.validate import MIN_TEXT_LEN

FILE_NAME = "corrections.yaml"
MIN_MATCH_LEN = 6  # normalized characters: shorter than this finds half the page


class Fix(BaseModel):
    """The fields a correction may set. Only the ones written in the file are touched."""

    model_config = ConfigDict(extra="forbid")

    text: str | None = None
    marks: float | None = None  # null: the paper prints no marks for it
    sub_parts: list[str] | None = None
    table_markdown: str | None = None  # null: there is no table

    @field_validator("text")
    @classmethod
    def text_long_enough(cls, v: str | None) -> str | None:
        if v is not None and len(v.strip()) < MIN_TEXT_LEN:
            raise ValueError(f"text too short ({len(v.strip())} chars)")
        return v.strip() if v is not None else v

    @field_validator("marks")
    @classmethod
    def marks_positive(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("marks must be more than 0 (use null when none are printed)")
        return v


class Correction(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    page: str
    match: str
    set_: Fix | None = Field(default=None, alias="set")
    drop: bool = False
    why: str = Field(min_length=3)
    status: Literal["proposed", "confirmed"] = "proposed"

    @field_validator("match")
    @classmethod
    def match_long_enough(cls, v: str) -> str:
        if len(normalize(v)) < MIN_MATCH_LEN:
            raise ValueError("match is too short to find one question")
        return v

    @model_validator(mode="after")
    def one_action(self) -> "Correction":
        fields = self.set_.model_fields_set if self.set_ else set()
        if self.drop == bool(fields):
            raise ValueError("give either `set` (with at least one field) or `drop: true`")
        return self

    @property
    def fields(self) -> dict:
        """What `set` changes, as written in the file (a null is a value: 'no marks printed')."""
        return self.set_.model_dump(include=self.set_.model_fields_set) if self.set_ else {}


class Missed(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: str
    text: str = Field(min_length=3)
    why: str = ""


class Corrections(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audited_pages: list[str] = Field(default_factory=list)
    reader: str = ""
    corrections: list[Correction] = Field(default_factory=list)
    missed: list[Missed] = Field(default_factory=list)


def load(folder: Path) -> Corrections | None:
    """The corrections next to a manifest, or None when there is no file. A file that does not follow
    the format stops the run with what is wrong: a half-read corrections file must never be applied."""
    path = folder / FILE_NAME
    if not path.exists():
        return None
    try:
        return Corrections.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})
    except (yaml.YAMLError, ValidationError) as e:
        raise ValueError(f"{path.as_posix()}: {str(e)[:800]}") from e


def unknown_pages(c: Corrections, m: dict) -> list[str]:
    """Problems with page refs the manifest does not have (a typo would otherwise be silently skipped)."""
    known = {f"{f.get('file')}#p{p.get('page')}" for f in m.get("files") or [] for p in f.get("pages") or []}
    out = [f"audited_pages: {p!r} is not a page of the manifest" for p in c.audited_pages if p not in known]
    out += [f"correction {x.match[:40]!r}: page {x.page!r} is not a page of the manifest" for x in c.corrections if x.page not in known]
    out += [f"missed {x.text[:40]!r}: page {x.page!r} is not a page of the manifest" for x in c.missed if x.page not in known]
    return out


def _text_of(q: dict) -> str:
    return normalize(" ".join([q.get("text") or "", *(q.get("sub_parts") or [])]))


def apply(questions: list[dict], corrections: list[Correction]) -> tuple[set[str], list[dict], list[dict]]:
    """Apply the confirmed corrections to these questions, in place.

    Returns (ids of dropped questions, what was applied, problems for the unsure list). Every entry
    is matched against the text as the model read it, before any other entry changed it.
    """
    confirmed = [c for c in corrections if c.status == "confirmed"]
    found: list[tuple[Correction, dict]] = []
    problems: list[dict] = []
    for c in confirmed:
        key = normalize(c.match)
        hits = [q for q in questions if q.get("page_ref") == c.page and key in _text_of(q)]
        if len(hits) == 1:
            found.append((c, hits[0]))
        else:
            what = "no question on that page has this text" if not hits else f"{len(hits)} questions on that page have this text; make `match` longer"
            problems.append({"page_ref": c.page, "step": "corrections", "error": what, "raw": c.match})

    dropped: set[str] = set()
    applied: list[dict] = []
    for c, q in found:
        if c.drop:
            dropped.add(q["id"])
        else:
            fields = c.fields
            q.update(fields)
            if "table_markdown" in fields:
                q["has_table"] = bool(fields["table_markdown"])
            q["corrected"] = True
        applied.append({"id": q["id"], "page_ref": c.page, "fields": sorted(c.fields), "drop": c.drop, "why": c.why})
    return dropped, applied, problems


def audit_summary(c: Corrections, questions_checked: int, pages_in_pack: set[str], applied: list[dict]) -> dict | None:
    """What a second reader's check of the pack came to, for harness.reading_audit. Counted from the
    corrections file and the pack, never typed in. None when no page was audited."""
    pages = set(c.audited_pages) & pages_in_pack
    if not pages:
        return None
    return {
        "reader": c.reader,
        "pages": len(pages),
        "questions_checked": questions_checked,
        "corrected": sum(1 for a in applied if not a["drop"]),
        "dropped": sum(1 for a in applied if a["drop"]),
        "missed": sum(1 for x in c.missed if x.page in pages),
        "proposed": sum(1 for x in c.corrections if x.status == "proposed"),  # waiting for a person to confirm
    }
