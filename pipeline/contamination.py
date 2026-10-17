"""Harness step 6 (contamination check): drop bleed-through from other papers.

Phone photos often capture part of a DIFFERENT exam paper lying underneath, usually at the
bottom edge. Every bottom-of-page or cut-off question is checked against the page photo:
is it printed on the main sheet, or on another sheet visible at the edge?

The first version asked "does this question belong to <subject>?" from the text alone. On the
full run it dropped 6 real questions (e.g. the OOP section of the Programming paper) because
their topic looked "too advanced" for the rest of the paper. The check is now visual and told
not to judge by topic. "Not on the main sheet" -> dropped and logged; unclear -> unsure.
"""

from pathlib import Path

from pipeline.providers import get_provider
from pipeline.report import RunReport
from pipeline.validate import Belongs, ask

BELONGS_PROMPT = """This is a phone photo of a page from a university "{subject}" exam paper.
Phone photos sometimes also capture part of a DIFFERENT sheet of paper lying underneath or beside it, usually at an edge of the photo (a fragment of another exam).

This text was read from the photo ({where}):
"{text}"

Is this text printed on the main "{subject}" paper as one of its own questions, or on a different sheet visible at the edge of the photo?
Judge ONLY by what you can see: is it on the same sheet, with the same layout, font and numbering as the paper's other questions?
Do NOT judge by topic. Exam papers often include advanced or unexpected topics.

Reply with JSON only: {{"on_main_paper": true or false, "likely_subject": "<subject of the other sheet, or null>", "reason": "<one short sentence about the visual evidence>"}}"""


def needs_check(q: dict) -> bool:
    return q["position_on_page"] == "bottom" or q["looks_cut_off"]


def is_partial(text: str) -> bool:
    """The extractor writes '...' where it could not read the text."""
    return "..." in text or "…" in text


def check_paper(questions: list[dict], subject: str, page_images: dict[str, Path], report: RunReport) -> list[dict]:
    """Return the questions that stay; drop (and log) bleed-through; send unclear ones to unsure."""
    kept = []
    for q in questions:
        if not needs_check(q):
            kept.append({**q, "contamination_checked": False})
            continue
        where = "near the bottom of the page" if q["position_on_page"] == "bottom" else "partly cut off"
        if q["looks_cut_off"] and q["position_on_page"] == "bottom":
            where = "near the bottom of the page, partly cut off"
        prompt = BELONGS_PROMPT.format(subject=subject, where=where, text=q["text"])
        res, err, retried = ask(get_provider(), prompt, [page_images[q["page_ref"]]], Belongs, "contamination")
        if retried:
            report.add("retries", page_ref=q["page_ref"], step="contamination", error=err or "invalid JSON", fixed=err is None)
        if res is None or err:
            report.add("unsure", page_ref=q["page_ref"], step="contamination", error=err or "no answer", raw=q["text"])
        elif res.on_main_paper and q["looks_cut_off"] and is_partial(q["text"]):
            # On the main sheet but only partly readable: we cannot say what it asks.
            report.add("unsure", page_ref=q["page_ref"], step="contamination", error="cut off and only partly readable", raw=q["text"])
        elif res.on_main_paper:
            kept.append({**q, "contamination_checked": True})
        else:
            report.add("dropped", page_ref=q["page_ref"], text=q["text"], likely_subject=res.likely_subject, reason=res.reason)
    return kept
