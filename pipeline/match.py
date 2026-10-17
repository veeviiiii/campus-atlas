"""Harness steps 7-8: put every question into a unit and a topic.

We have no syllabus for this batch (the old 2024-29 syllabus is optional and was not available),
so units and topics are derived bottom-up from the real questions: the model groups each
subject's questions into units (chapters) and short topics. Every question id must be placed
exactly once; the reply is validated, retried once with the error, and anything still missing
goes to the unsure list. Units built this way are marked from_syllabus = false.
"""

from pydantic import BaseModel, Field

from pipeline.providers import get_provider
from pipeline.validate import ask

GROUP_PROMPT = """These are all the questions asked in the "{subject}" exams (MST-1, MST-2 and End Sem) of one university semester.
Group them into the course's units (chapters) and, inside each unit, into short topics.

Rules:
- 3 to 7 units, named like syllabus chapters (e.g. "Oscillations and Waves", "Special Relativity").
- Inside each unit, 1 to 8 topics with short names of 2 to 5 words (e.g. "Damped oscillation").
- Questions that ask about the same thing, even in different exams and even if worded differently, must be in the same topic.
- Every question id must appear exactly once.

Questions:
{questions}

Reply with JSON only:
{{"units": [{{"name": "...", "topics": [{{"name": "...", "question_ids": ["..."]}}]}}]}}"""


class TopicGroup(BaseModel):
    name: str = Field(min_length=2)
    question_ids: list[str]


class UnitGroup(BaseModel):
    name: str = Field(min_length=2)
    topics: list[TopicGroup] = Field(min_length=1)


class Grouping(BaseModel):
    units: list[UnitGroup] = Field(min_length=1)


def question_line(q: dict) -> str:
    text = " ".join(q["text"].split())
    if q.get("sub_parts"):
        text += " [parts: " + "; ".join(q["sub_parts"]) + "]"
    return f"[{q['id']}] ({q['exam']}) {text[:400]}"


def group_subject(subject: str, questions: list[dict]) -> tuple[Grouping | None, list[str], str | None]:
    """Return (grouping with every id placed at most once, ids that could not be placed, error)."""
    ids = [q["id"] for q in questions]
    prompt = GROUP_PROMPT.format(subject=subject, questions="\n".join(question_line(q) for q in questions))

    def check(g: Grouping) -> str | None:
        placed = [i for u in g.units for t in u.topics for i in t.question_ids]
        missing = sorted(set(ids) - set(placed))
        unknown = sorted(set(placed) - set(ids))
        dupes = sorted({i for i in placed if placed.count(i) > 1})
        errs = []
        if missing:
            errs.append(f"missing ids: {', '.join(missing)}")
        if unknown:
            errs.append(f"unknown ids: {', '.join(unknown)}")
        if dupes:
            errs.append(f"ids placed more than once: {', '.join(dupes)}")
        return "; ".join(errs) or None

    g, err, _ = ask(get_provider(), prompt, [], Grouping, "group", check)
    if g is None:
        return None, ids, err

    # Keep what is usable: first placement wins, unknown ids are ignored, missing ids are reported.
    seen: set[str] = set()
    for u in g.units:
        for t in u.topics:
            t.question_ids = [i for i in t.question_ids if i in ids and not (i in seen or seen.add(i))]
        u.topics = [t for t in u.topics if t.question_ids]
    g.units = [u for u in g.units if u.topics]
    missing = [i for i in ids if i not in seen]
    return g, missing, err
