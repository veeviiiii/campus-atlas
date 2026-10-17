"""Harness steps 7-10 and 12: group, find repeats, score, and write the college pack JSON."""

import json
import re
from pathlib import Path

from pipeline.manifest import load_manifest, work_dir
from pipeline.match import group_subject
from pipeline.providers import CALLS, ROOT, get_provider
from pipeline.repeats import EXAM_ORDER, find_repeats



def export_pages(src: Path, dest: Path, max_side: int = 1400) -> None:
    """Copy the oriented page photos as small JPEGs so every question can link to its original page."""
    from PIL import Image

    dest.mkdir(parents=True, exist_ok=True)
    for png in sorted(src.glob("*.png")):
        im = Image.open(png).convert("RGB")
        im.thumbnail((max_side, max_side))
        im.save(dest / f"{png.stem}.jpg", quality=78, optimize=True)


def confidence(q: dict) -> float:
    """How much the harness could verify about this question (documented in the README)."""
    c = 0.9
    if q.get("contamination_checked"):
        c -= 0.1  # sat at the bottom edge / looked cut off; kept after the visual check
    if q.get("extract_retried"):
        c -= 0.1  # the first extraction failed validation
    return round(c, 2)


def printed_question_key(q: dict) -> tuple:
    """Parts split from one printed question share its marks: count them once per topic."""
    m = re.search(r"\d+", q.get("label") or "")
    return (q["exam"], q["page_ref"], m.group() if m else q["id"], q.get("marks"))


def topic_marks(qs: list[dict]) -> float:
    seen = {printed_question_key(q): q.get("marks") or 0 for q in qs}
    total = sum(seen.values())
    return int(total) if float(total).is_integer() else round(total, 1)


def build_subject(m: dict, sid: str, workers: int) -> tuple[dict, list[dict], dict]:
    ex = json.loads((work_dir(m) / "extracted" / f"{sid}.json").read_text(encoding="utf-8"))
    subj = next(s for s in m["subjects"] if s["id"] == sid)
    questions = [q for p in ex["papers"] for q in p["questions"]]
    unsure = [{**u, "subject": sid} for u in ex.get("unsure", [])]
    print(f"  {sid}: {len(questions)} questions", flush=True)

    by_id = {q["id"]: q for q in questions}

    # steps 7-8: units and topics (bottom-up; no syllabus available for this batch)
    grouping, missing, gerr = group_subject(subj["name"], questions)
    for qid in missing:
        q = by_id[qid]
        unsure.append({"subject": sid, "page_ref": q["page_ref"], "step": "group", "error": gerr or "not placed in any topic", "raw": q["text"]})

    # step 9: repeats (embeddings + LLM judge; the topic grouping is a second candidate signal)
    same_topic = {(a, b) for u in (grouping.units if grouping else []) for t in u.topics for a in t.question_ids for b in t.question_ids if a != b}
    links, judged, rep_unsure = find_repeats(subj["name"], questions, workers, same_topic)
    unsure += [{**u, "subject": sid} for u in rep_unsure]
    for q in questions:
        q["repeat_of"] = []
    for link in links:
        by_id[link["from"]]["repeat_of"].append({"id": link["to"], "type": link["type"], "similarity": link["similarity"]})

    def out_q(q: dict) -> dict:
        keep = ("id", "exam", "text", "marks", "has_table", "table_markdown", "sub_parts", "is_or_choice", "page_ref", "repeat_of")
        return {**{k: q.get(k) for k in keep}, "confidence": confidence(q)}

    units = []
    for k, u in enumerate(grouping.units if grouping else [], start=1):
        topics = []
        for j, t in enumerate(u.topics, start=1):
            qs = sorted((by_id[i] for i in t.question_ids), key=lambda q: (EXAM_ORDER[q["exam"]], q["id"]))
            exams = {q["exam"] for q in qs}
            topics.append({
                "id": f"{sid}-u{k}-t{j}",
                "name": t.name,
                "exams_count": len(exams),
                "is_repeat": "end" in exams and bool(exams & {"mst1", "mst2"}),  # in an MST and the End Sem
                "total_marks": topic_marks(qs),
                "questions": [out_q(q) for q in qs],
                "quiz": [],
            })
        topics.sort(key=lambda t: (not t["is_repeat"], -t["exams_count"], -t["total_marks"]))
        exams_in_unit = {q["exam"] for t in topics for q in t["questions"]}
        units.append({
            "id": f"{sid}-u{k}",
            "name": u.name,
            "from_syllabus": False,
            "blind_spot": "end" in exams_in_unit and not exams_in_unit & {"mst1", "mst2"},
            "topics": topics,
            "fog_topics": [],
        })

    subject = {
        "id": sid,
        "name": subj["name"],
        "aliases": subj.get("aliases", []),
        "codes_seen": ex.get("codes_seen", []),
        "units": units,
        "off_syllabus": [],  # needs a syllabus to decide what is "off" it
    }
    harness = {
        "dropped_bleed_through": [{**d, "subject": sid} for d in ex.get("dropped", [])],
        "disagreements": [{**d, "subject": sid} for d in ex.get("disagreements", [])],
        "repeat_judgements": judged,
        "papers_with_questions": sum(1 for p in ex["papers"] if p["questions"]),
    }
    return subject, unsure, harness


def build_pack(manifest_path: Path, workers: int = 4) -> Path:
    m = load_manifest(manifest_path)
    subjects, unsure, dropped, disagreements, judged, papers = [], [], [], [], [], 0
    for s in m["subjects"]:
        if not (work_dir(m) / "extracted" / f"{s['id']}.json").exists():
            print(f"  {s['id']}: no extracted file, skipped", flush=True)
            continue
        subject, u, h = build_subject(m, s["id"], workers)
        subjects.append(subject)
        unsure += u
        dropped += h["dropped_bleed_through"]
        disagreements += h["disagreements"]
        judged += h["repeat_judgements"]
        papers += h["papers_with_questions"]

    all_q = [q for s in subjects for u in s["units"] for t in u["topics"] for q in t["questions"]]
    exam_of = {q["id"]: q["exam"] for q in all_q}
    p = get_provider()
    pack = {
        "schema_version": "1.0",
        "college": m["college"],
        "course": m["course"],
        "sources": {
            "exams": m["exams"],
            "syllabus": None,
            "units_from": "questions (no syllabus was available; units and topics are derived bottom-up)",
        },
        "subjects": subjects,
        "unsure": unsure,
        "stats": {
            "papers": papers,
            "questions": len(all_q),
            # questions that came back (word for word or nearly) from an MST in the End Sem
            "repeats": sum(1 for q in all_q for r in q["repeat_of"] if q["exam"] == "end" and exam_of.get(r["id"]) in ("mst1", "mst2") and r["type"] in ("exact", "near")),
            "same_topic_links": sum(1 for q in all_q for r in q["repeat_of"] if q["exam"] == "end" and exam_of.get(r["id"]) in ("mst1", "mst2") and r["type"] == "same-topic"),
            "dropped_bleed_through": len(dropped),
        },
        "harness": {
            "model": p.model,
            "fallback_model": p.fallback or None,
            "embedding_model": "all-MiniLM-L6-v2",
            "dropped_bleed_through": dropped,
            "manifest_disagreements": disagreements,
            "repeat_judgements": judged,
        },
    }
    out = ROOT / "packs" / m["college"]["id"] / f"{m['course']['id']}-sem{m['course']['semester']}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():  # keep quizzes already written (step 11) for topics that still exist
        old = json.loads(out.read_text(encoding="utf-8"))
        quizzes = {(s["id"], t["name"]): t["quiz"] for s in old["subjects"] for u in s["units"] for t in u["topics"] if t.get("quiz")}
        for s in subjects:
            for u in s["units"]:
                for t in u["topics"]:
                    t["quiz"] = quizzes.get((s["id"], t["name"]), [])
        # ...and the quiz failures, for topics that still have no quiz
        no_quiz = {(s["id"], t["name"]) for s in subjects for u in s["units"] for t in u["topics"] if not t["quiz"]}
        pack["unsure"] += [x for x in old.get("unsure", []) if x.get("step") == "quiz" and (x["subject"], x["raw"]) in no_quiz]
        if old.get("harness", {}).get("eval"):  # last eval result, until eval runs again
            pack["harness"]["eval"] = old["harness"]["eval"]
    out.write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    export_pages(work_dir(m) / "oriented", out.parent / "pages")
    print(f"pack: {out}  | {pack['stats']} | calls {CALLS.summary()}", flush=True)
    return out


def pack_path(manifest_path: Path) -> Path:
    m = load_manifest(manifest_path)
    return ROOT / "packs" / m["college"]["id"] / f"{m['course']['id']}-sem{m['course']['semester']}.json"
