"""Harness steps 2-4: orient each page, read its header, extract the questions of each paper."""

from pathlib import Path

from PIL import Image

from pipeline.manifest import PageInfo, Paper, exam_name, match_exam, match_subject, subject_name
from pipeline.providers import get_provider
from pipeline.report import RunReport
from pipeline.validate import Extraction, Header, Orientation, Question, ask, validate_items


ORIENT_PROMPT = """This is a phone photo of one page of a printed exam paper.
Which way is the printed text facing?
Reply with JSON only: {"rotation": R}
R is how many degrees the image must be rotated CLOCKWISE so the printed text reads normally:
0 (already upright), 90, 180 (upside down) or 270."""

HEADER_PROMPT = """This is a phone photo of one page of a university exam paper.
Read only the PRINTED header at the top of the paper. Ignore handwriting and any other paper visible at the edges.
Reply with JSON only:
{"has_header": true or false,
 "exam_title": "<exam name exactly as printed, e.g. 'Mid Semester -1 Test', 'TEST-II', 'Semester End Examination'> or null",
 "subject_name": "<subject exactly as printed> or null",
 "course_code": "<course code as printed> or null",
 "date": "<date as printed> or null",
 "semester": "<semester as printed> or null",
 "max_marks": <number or null>}
If the page has no header (it continues a previous page), set has_header to false and everything else to null."""

EXTRACT_PROMPT = """These {n} image(s) are phone photos of a university exam paper, in page order.
Subject: "{subject}". Exam: "{exam}".

Extract EVERY question printed on the page(s).

Rules:
- One item per independently answerable question. If a question has parts (a), (b) that ask about different things, make each part its own item. Each alternative of an OR choice is its own item with "is_or_choice": true.
- Small listed parts that belong to one ask (e.g. "Write short notes on (i) X (ii) Y") stay in one item; put them in "sub_parts".
- Copy the wording as printed (fix only obvious misreadings). Ignore handwritten ticks, marks and renumbering.
- Write all mathematics in LaTeX inside $...$, e.g. $\\sum_{{n=1}}^{{\\infty}} \\frac{{1}}{{n^2}}$.
- If a question includes a data table, set "has_table": true and copy the table as a markdown table in "table_markdown".
- "marks": marks for this item if printed or given by a section rule (e.g. "each question carries 5 marks"), else null.
- "position_on_page": "top", "middle" or "bottom" third of its page.
- "page": 1-based index of the image the item is on.
- "looks_cut_off": true if the item is partly outside the photo or hidden, or looks like a fragment of a DIFFERENT paper lying underneath (often at the bottom edge). Do not skip such fragments; include them with "looks_cut_off": true. Another check decides.
- "label": the question number as printed (e.g. "Q2(b)"), or null. "section": section as printed, or null.

Reply with JSON only, no commentary:
{{"questions": [{{"label": null, "section": null, "text": "...", "marks": null, "sub_parts": [], "has_table": false, "table_markdown": null, "is_or_choice": false, "position_on_page": "top", "page": 1, "looks_cut_off": false}}]}}"""


def orient_page(page: PageInfo, report: RunReport, work: Path) -> Path:
    """Step 2: ask which way the page faces; rotate with Pillow. Manifest wins if it disagrees."""
    src = work / "pages" / f"{page.stem}.png"
    res, err, retried = ask(get_provider(), ORIENT_PROMPT, [src], Orientation, "orient")
    if retried:
        report.add("retries", page_ref=page.ref, step="orient", error=err or "invalid JSON", fixed=res is not None and err is None)
    ai_rot = res.rotation if res and err is None else None
    if ai_rot is None:
        report.add("unsure", page_ref=page.ref, step="orient", error=err or "no answer", raw="")
    rot = ai_rot or 0
    if page.rotation is not None and page.rotation != ai_rot:
        report.add("disagreements", page_ref=page.ref, field="rotation", ai=ai_rot, manifest=page.rotation)
        rot = page.rotation

    (work / "oriented").mkdir(parents=True, exist_ok=True)
    out = work / "oriented" / f"{page.stem}.png"
    Image.open(src).rotate(-rot, expand=True).save(out)  # PIL rotates counter-clockwise
    report.add("pages", page_ref=page.ref, rotation=rot)
    return out


def read_header(page: PageInfo, image: Path, m: dict, report: RunReport) -> Header | None:
    """Step 3: read exam type, subject, code, date. The manifest overrides; disagreements are logged."""
    res, err, retried = ask(get_provider(), HEADER_PROMPT, [image], Header, "header")
    if retried:
        report.add("retries", page_ref=page.ref, step="header", error=err or "invalid JSON", fixed=err is None)
    if res is None or err:
        report.add("unsure", page_ref=page.ref, step="header", error=err or "no answer", raw="")
        return None
    ai_subject = match_subject(m, res.subject_name)
    ai_exam = match_exam(res.exam_title)
    with report._lock:
        rec = next(x for x in report.pages if x["page_ref"] == page.ref)
        rec.update(header_subject=res.subject_name, header_exam=res.exam_title, header_code=res.course_code)
    if res.has_header:
        if ai_subject != page.subject:
            report.add("disagreements", page_ref=page.ref, field="subject", ai=f"{res.subject_name!r} -> {ai_subject}", manifest=page.subject)
        if ai_exam != page.exam:
            report.add("disagreements", page_ref=page.ref, field="exam", ai=f"{res.exam_title!r} -> {ai_exam}", manifest=page.exam)
    elif not page.continues_previous:
        report.add("disagreements", page_ref=page.ref, field="header", ai="no header found", manifest="first page of a paper")
    return res


PAGE_NOTE = "\n\nNote: this image is page {k} of {n} of the same paper. It may start or end in the middle of a question."


def _extract_once(paper: Paper, images: list[Path], note: str, ref: str, max_marks: float | None, m: dict, report: RunReport) -> tuple[list[Question], bool]:
    prompt = EXTRACT_PROMPT.format(n=len(images), subject=subject_name(m, paper.subject), exam=exam_name(m, paper.exam)) + note
    n = len(images)

    def check(ex: Extraction) -> str | None:
        _, bad = validate_items(ex.questions, max_marks, n)
        return "; ".join(f"item {ex.questions.index(raw)}: {e}" for raw, e in bad) or None

    res, err, retried = ask(get_provider(), prompt, images, Extraction, "extract", check)
    if retried:
        report.add("retries", page_ref=ref, step="extract", error=err or "first reply invalid", fixed=err is None)
    if res is None:
        report.add("unsure", page_ref=ref, step="extract", error=err or "no answer", raw="whole page(s)")
        return [], retried

    good, bad = validate_items(res.questions, max_marks, n)
    for raw, e in bad:
        report.add("unsure", page_ref=ref, step="validate", error=e, raw=raw.get("text", raw))
    return good, retried


def extract_paper(paper: Paper, images: list[Path], max_marks: float | None, m: dict, report: RunReport) -> list[dict]:
    """Steps 4-5: extract questions from all pages of one paper, validate each, retry once, unsure the rest.

    Multi-page papers are read one page at a time and merged (one big request with several photos
    kept failing on the API).
    """
    if len(images) == 1:
        good, retried = _extract_once(paper, images, "", paper.ref, max_marks, m, report)
    else:
        good, retried = [], False
        for k, (img, page) in enumerate(zip(images, paper.pages), start=1):
            qs, r = _extract_once(paper, [img], PAGE_NOTE.format(k=k, n=len(images)), page.ref, max_marks, m, report)
            good += [q.model_copy(update={"page": k}) for q in qs]
            retried = retried or r

    out = []
    for i, q in enumerate(sorted(good, key=lambda q: q.page), start=1):
        pg = paper.pages[q.page - 1]
        out.append({
            "id": f"{paper.subject}-{paper.exam}-q{i}",
            "exam": paper.exam,
            **q.model_dump(),
            "page_ref": pg.ref,
            "extract_retried": retried,
        })
    return out
