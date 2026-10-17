"""Harness step 11 (quizzes): pre-generate 3 MCQs per topic, stored in the pack.

The demo never calls a model, so quizzes are written ahead of time by the open LLM from the
topic's real exam questions, then validated: exactly 4 distinct options, one correct answer,
a short explanation. A topic whose quiz still fails after one retry gets no quiz and an
entry on the unsure list.

Usage: python -m pipeline.build_pack --stage quiz      (updates the pack file in place)
"""

import hashlib
import json
import random
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

from pipeline.providers import CALLS, get_provider
from pipeline.validate import ask

QUIZ_PROMPT = """Write 3 multiple-choice questions that check whether a student understands the topic "{topic}" of the university course "{subject}".
They should test the ideas needed to answer these real exam questions (do not just copy them):
{questions}

Rules:
- Each question has exactly 4 different options and exactly one correct option.
- "answer" is the index (0-3) of the correct option.
- "why" explains the correct answer in one or two sentences.
- Write mathematics in LaTeX inside $...$.

Reply with JSON only:
{{"quiz": [{{"q": "...", "options": ["...", "...", "...", "..."], "answer": 0, "why": "..."}}]}}"""


class QuizItem(BaseModel):
    q: str = Field(min_length=8)
    options: list[str] = Field(min_length=4, max_length=4)
    answer: int = Field(ge=0, le=3)
    why: str = Field(min_length=8)

    @field_validator("options")
    @classmethod
    def distinct_options(cls, v: list[str]) -> list[str]:
        v = [o.strip() for o in v]
        if any(not o for o in v) or len({o.lower() for o in v}) != 4:
            raise ValueError("options must be 4 non-empty, different strings")
        return v


class QuizSet(BaseModel):
    quiz: list[QuizItem] = Field(min_length=3, max_length=3)


def shuffle_options(item: dict) -> dict:
    """Models put the right answer in the same few positions (B far more than D).
    Shuffle the options deterministically (seeded by the question) and remap the answer."""
    rng = random.Random(hashlib.sha256(item["q"].encode()).hexdigest())
    order = list(range(len(item["options"])))
    rng.shuffle(order)
    return {**item, "options": [item["options"][i] for i in order], "answer": order.index(item["answer"])}


def quiz_for_topic(subject: str, topic: dict) -> tuple[list[dict] | None, str | None]:
    qs = "\n".join(f"- {' '.join(q['text'].split())[:300]}" for q in topic["questions"][:8])
    res, err, _ = ask(get_provider(), QUIZ_PROMPT.format(topic=topic["name"], subject=subject, questions=qs), [], QuizSet, "quiz")
    if res is None or err:
        return None, err or "no answer"
    return [shuffle_options(i.model_dump()) for i in res.quiz], None


def add_quizzes(pack_path: Path, workers: int = 4) -> None:
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    jobs = [(s, t) for s in pack["subjects"] for u in s["units"] for t in u["topics"] if t["questions"] and not t.get("quiz")]
    print(f"quizzes to write: {len(jobs)} topics", flush=True)

    def run(job):
        s, t = job
        quiz, err = quiz_for_topic(s["name"], t)
        return s, t, quiz, err

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for s, t, quiz, err in pool.map(run, jobs):
            if quiz:
                t["quiz"] = quiz
                done += 1
            else:
                pack["unsure"].append({"subject": s["id"], "page_ref": "", "step": "quiz", "error": err, "raw": t["name"]})
            # save as we go: a long run that dies half way keeps what it finished
            pack_path.write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"quizzes written: {done} of {len(jobs)} | calls {CALLS.summary()}", flush=True)
