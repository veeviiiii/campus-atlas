"""Harness step 9 (repeats): find questions that come back in a later exam.

An open embedding model (sentence-transformers, runs locally) compares every question with the
questions of LATER exams in the same subject (later in the same year, or any later year):
  cosine >= 0.85        -> repeat ("exact" if the wording is nearly identical, else "near")
  0.70 <= cosine < 0.85 -> the open LLM judges: exact / near / same-topic / different
The link is stored on the later question: repeat_of = [{id, type, similarity}].
"""

import difflib
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

import numpy as np
from pydantic import BaseModel

from pipeline.manifest import normalize
from pipeline.providers import get_provider
from pipeline.validate import ask

HIGH, LOW = 0.85, 0.70
SAME_TOPIC_LOW = 0.55  # pairs the topic grouping (step 8) put together are judged from this cosine

JUDGE_PROMPT = """Two exam questions from the "{subject}" course of the same university:
A ({exam_a}): "{text_a}"
B ({exam_b}): "{text_b}"

How are they related?
- "exact": the same question, word for word or nearly
- "near": the same question with small changes (other numbers, an extra part, reworded)
- "same-topic": different questions about the same specific topic
- "different": not the same specific topic
Reply with JSON only: {{"relation": "exact" | "near" | "same-topic" | "different", "reason": "<one short sentence>"}}"""


class Relation(BaseModel):
    relation: Literal["exact", "near", "same-topic", "different"]
    reason: str = ""


_MODEL = None


def embedder():
    global _MODEL
    if _MODEL is None:
        from sentence_transformers import SentenceTransformer

        _MODEL = SentenceTransformer(os.environ.get("EMBED_MODEL", "all-MiniLM-L6-v2"))
    return _MODEL


def full_text(q: dict) -> str:
    text = " ".join(q["text"].split())
    return text + (" " + "; ".join(q["sub_parts"]) if q.get("sub_parts") else "")


def facets(q: dict) -> list[str]:
    """The whole question, plus one text per sub-part ("Short notes on (a) X (b) Y" asks about X and Y)."""
    base = " ".join(q["text"].split())
    return [full_text(q)] + [f"{base} {p}" for p in q.get("sub_parts") or []]


def find_repeats(
    subject: str, questions: list[dict], order: dict[str, int], workers: int = 4, same_topic: set[tuple[str, str]] | None = None
) -> tuple[list[dict], list[dict], list[dict]]:
    """Return (links, judged pairs log, unsure items). Each link: {from, to, type, similarity}.

    `order` maps exam id -> position in time (manifest.exam_order); links only go from a later exam
    to an earlier one.

    `same_topic` holds (id, id) pairs that the topic grouping put in one topic. Two signals are
    better than one: such pairs are also sent to the judge from cosine SAME_TOPIC_LOW, because
    the same question reworded (e.g. "four biodiversity hot spots of India" vs "describe the
    biodiversity hotspots found in India") can score below 0.70 with a small embedding model.
    """
    same_topic = same_topic or set()
    owners, texts = [], []
    for i, q in enumerate(questions):
        for t in facets(q):
            owners.append(i)
            texts.append(t)
    emb = embedder().encode(texts, normalize_embeddings=True, show_progress_bar=False)
    sims = emb @ emb.T
    owners_arr = np.array(owners)

    pairs = []  # (earlier index, later index, best facet similarity)
    for a, qa in enumerate(questions):
        for b, qb in enumerate(questions):
            if order[qa["exam"]] >= order[qb["exam"]]:
                continue
            s = float(sims[np.ix_(owners_arr == a, owners_arr == b)].max())
            grouped = (qa["id"], qb["id"]) in same_topic or (qb["id"], qa["id"]) in same_topic
            if s >= LOW or (grouped and s >= SAME_TOPIC_LOW):
                pairs.append((a, b, s))

    links, judged, unsure = [], [], []

    def judge(pair):
        a, b, s = pair
        qa, qb = questions[a], questions[b]
        prompt = JUDGE_PROMPT.format(subject=subject, exam_a=qa["exam"], text_a=full_text(qa), exam_b=qb["exam"], text_b=full_text(qb))
        res, err, _ = ask(get_provider(), prompt, [], Relation, "repeat-judge")
        return pair, res, err

    for a, b, s in pairs:
        if s >= HIGH:
            same = difflib.SequenceMatcher(None, normalize(full_text(questions[a])), normalize(full_text(questions[b]))).ratio()
            links.append({"from": questions[b]["id"], "to": questions[a]["id"], "type": "exact" if same >= 0.8 else "near", "similarity": round(s, 3)})

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for (a, b, s), res, err in pool.map(judge, [p for p in pairs if p[2] < HIGH]):
            qa, qb = questions[a], questions[b]
            if res is None or err:
                unsure.append({"page_ref": qb["page_ref"], "step": "repeat-judge", "error": err or "no answer", "raw": f"{qa['id']} vs {qb['id']}"})
                continue
            judged.append({"a": qa["id"], "b": qb["id"], "similarity": round(s, 3), "relation": res.relation, "reason": res.reason})
            if res.relation != "different":
                links.append({"from": qb["id"], "to": qa["id"], "type": res.relation, "similarity": round(s, 3)})
    return links, judged, unsure
