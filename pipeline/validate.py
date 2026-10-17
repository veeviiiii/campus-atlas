"""Harness step 5 (validate): every AI output is JSON checked by pydantic.

Invalid -> retry once with the validation error in the prompt; still invalid -> the caller
puts it on the unsure list. Nothing is silently dropped.
"""

import json
import re
from typing import Any, Callable, Literal, TypeVar

from pydantic import BaseModel, Field, ValidationError, field_validator

from pipeline.providers import Provider

MIN_TEXT_LEN = 8

RETRY_SUFFIX = (
    "\n\nYour previous reply was not valid: {error}\n"
    "Reply again with corrected JSON only, no commentary."
)


class Orientation(BaseModel):
    rotation: Literal[0, 90, 180, 270]


class Header(BaseModel):
    has_header: bool
    exam_title: str | None = None
    subject_name: str | None = None
    course_code: str | None = None
    date: str | None = None
    semester: str | None = None
    max_marks: float | None = None


class Question(BaseModel):
    label: str | None = None  # as printed; never used for matching
    section: str | None = None
    text: str
    marks: float | None = None
    sub_parts: list[str] = Field(default_factory=list)
    has_table: bool = False
    table_markdown: str | None = None
    is_or_choice: bool = False
    position_on_page: Literal["top", "middle", "bottom"]
    page: int = 1
    looks_cut_off: bool = False

    @field_validator("text")
    @classmethod
    def text_long_enough(cls, v: str) -> str:
        v = v.strip()
        if len(v) < MIN_TEXT_LEN:
            raise ValueError(f"text too short ({len(v)} chars)")
        return v


class Extraction(BaseModel):
    questions: list[dict[str, Any]]  # each item is checked separately with Question


class Belongs(BaseModel):
    on_main_paper: bool
    likely_subject: str | None = None
    reason: str = ""


M = TypeVar("M", bound=BaseModel)


def parse_json(text: str) -> Any:
    """Parse a model reply that should be JSON, tolerating ```json fences or stray prose."""
    t = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text.strip())
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start != -1 and end > start:
            return json.loads(t[start : end + 1])
        raise


def _check(reply: str, model_cls: type[M], extra: Callable[[M], str | None] | None) -> tuple[M | None, str | None]:
    try:
        value = model_cls.model_validate(parse_json(reply))
    except (json.JSONDecodeError, ValidationError) as e:
        return None, str(e).replace("\n", " ")[:600]
    return value, (extra(value) if extra else None)


def ask(
    provider: Provider,
    prompt: str,
    images: list,
    model_cls: type[M],
    step: str,
    extra_check: Callable[[M], str | None] | None = None,
) -> tuple[M | None, str | None, bool]:
    """Ask for JSON, validate, retry once with the error.

    Returns (value, error, retried). value is the parsed object whenever the schema passed,
    even if extra_check still failed (so callers can keep the good parts).
    """
    try:
        value, err = _check(provider.generate(prompt, images, step), model_cls, extra_check)
    except RuntimeError as e:  # model unreachable after all retries -> caller sends it to unsure
        return None, str(e)[:300], False
    if err is None:
        return value, None, False
    try:
        retry_reply = provider.generate(prompt + RETRY_SUFFIX.format(error=err), images, step + ":retry")
    except RuntimeError:
        return value, err, True
    retry_value, retry_err = _check(retry_reply, model_cls, extra_check)
    if retry_value is None and value is not None:
        return value, err, True  # the retry broke the schema; keep the first parse
    return retry_value, retry_err, True


def validate_items(items: list[dict], max_marks: float | None, n_pages: int) -> tuple[list[Question], list[tuple[dict, str]]]:
    """Check each extracted question: schema, text length, marks plausible for the paper, page index."""
    good, bad = [], []
    for raw in items:
        try:
            q = Question.model_validate(raw)
        except ValidationError as e:
            bad.append((raw, str(e).replace("\n", " ")[:300]))
            continue
        if q.marks is not None and (q.marks <= 0 or (max_marks and q.marks > max_marks)):
            bad.append((raw, f"marks {q.marks} not plausible for a paper of {max_marks}"))
        elif not 1 <= q.page <= n_pages:
            bad.append((raw, f"page {q.page} outside 1..{n_pages}"))
        else:
            good.append(q)
    return good, bad
