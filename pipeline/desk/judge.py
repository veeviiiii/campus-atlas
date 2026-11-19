"""What the desk works out about subjects once the pages are read, so fewer papers wait for the maintainer.

Three things, each only ever a suggestion with a note saying how it was reached:

1. The same subject under another name. A paper prints "Numerical Methods" and the semester has
   "Numerical Analysis": the model is asked, in words only, whether they are one subject. Two names
   that both have a paper in one sitting (the same test of the same year) are never one subject, and
   neither are two parts of a series ("Mathematics II", "Mathematics III"); those are not even asked.
2. A subject that is not printed. The model is shown how the paper's questions begin and the
   semester's subjects, each with how some of its own questions begin, and names the one it is for.
   Subjects that already have a paper in that sitting are left out.
3. One paper photographed twice (no model): two parts whose questions begin the same way. The copy
   that prints less is suggested Skip, so the one that prints the year stays.

The answers are kept in desk-decisions.json (`judged`) and, like every model answer, in
data/work/cache. Nothing here decides anything: suggest.py shows it and the maintainer accepts it.
"""

import difflib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from pydantic import BaseModel

from pipeline.desk.decisions import Desk
from pipeline.manifest import normalize
from pipeline.validate import ask

CODE = re.compile(r"\b[a-z]{2,4}\s*[-–—]?\s*\d{3}[a-z]?\b", re.I)  # a course code printed with the name: IT-201, IC-101A
EDGE = " \t:;,.-–—"
SHORT = {"maths": "mathematic", "math": "mathematic", "mathematics": "mathematic"}
SAMPLES = 4  # question beginnings shown for each subject
SAMPLE_CHARS = 110
MIN_QUESTIONS = 2  # a paper needs this many readable questions before its subject is worked out from them
COPY_MIN, COPY_SHARE, COPY_ALIKE, COPY_WORDS = 3, 0.75, 0.86, 9  # see same_questions()

NAME_PROMPT = """Students sent in exam papers of {course}, semester {semester}, at a university in India.
One paper prints its subject as: "{name}"
{questions}
Is that the same subject as one of these, printed under another name (renamed, shortened, or worded differently)?
{candidates}
Reply with JSON only: {{"same_as": <the number of that subject, or null>, "reason": "<one short sentence>"}}
Rules:
- The same subject means one course of study with one syllabus: "Numerical Analysis" and "Numerical Methods" are the same subject; so are "C++ Programming" and "Programming with C++".
- Two parts of a series are different subjects ("Mathematics II" is not "Mathematics III"), and so are two different languages or fields ("Programming using C" is not "Programming with C++").
- Use the questions as evidence when they are given: one subject's papers ask about the same topics.
- When unsure, answer null. A wrong yes puts two subjects' papers together; a wrong null only leaves two names apart."""

SUBJECT_PROMPT = """A student sent in an exam paper of {course}, semester {semester}, at a university in India.
The paper does not print its subject. Its questions begin:
{questions}
Which of these subjects of that semester is the paper for?
{candidates}
Reply with JSON only: {{"subject": <the number of that subject, or null>, "reason": "<the topics that decide it, in one short sentence>"}}
Rules:
- Decide from what the questions ask about, and from how the other papers of each subject begin when that is given.
- Answer null when the questions could belong to two of these subjects, or to none of them. Never pick the nearest one just to give an answer."""


class SameName(BaseModel):
    same_as: int | None = None
    reason: str = ""


class WhichSubject(BaseModel):
    subject: int | None = None
    reason: str = ""


def clean_subject(name: str) -> str:
    """A printed subject name without its course code or brackets: "IC-101A: Mathematics I" -> "Mathematics I";
    a code with the name in brackets, "IT – 203A (Data & Computer Communications)", is that name."""
    rest = CODE.sub(" ", name)
    inner = (re.search(r"\((.*?)\)", rest) or [None, ""])[1]
    out = " ".join(re.sub(r"\(.*?\)", " ", rest).split()).strip(EDGE)
    return out if re.search(r"[a-z]", out, re.I) else inner.strip(EDGE)


def _word(t: str) -> str:
    t = SHORT.get(t) or (t[:-1] if len(t) > 3 and t.endswith("s") and not t.endswith("ss") else t)
    return re.sub(r"isation$", "ization", t)


def name_key(name: str) -> str:
    """What stays the same across printed variants of one name: case, "&", I or 1, a plural s, -isation,
    course codes, Maths. "Data Structures" and "Data structure", "Maths-II (IT-201)" and "Mathematics - 2"
    have one key; "C++" keeps its pluses, so it is never "C". (The desk page's subjectKey does the same.)"""
    return " ".join(_word(t) for t in normalize((clean_subject(name) or name).replace("++", " plus plus ")).split())


def series_clash(a: str, b: str) -> bool:
    """Both names carry a number and the numbers differ: two parts of a series."""
    na, nb = re.findall(r"\b\d+\b", name_key(a)), re.findall(r"\b\d+\b", name_key(b))
    return bool(na and nb and na != nb)


@dataclass
class Seen:
    """One paper part of the open folder: what its suggestion says, or its decision where there is one."""

    id: str  # "<key>:<part>"
    key: str
    source: str
    course: str = ""
    semester: int | None = None
    kind: str = ""
    session: str = ""
    date: str = ""
    name: str = ""  # the subject as printed, when it matched no subject of the semester
    subject: str = ""  # a subject of the semester (its id)
    header: bool = True
    questions: list[str] = field(default_factory=list)
    order: int = 0

    @property
    def where(self) -> str:
        return f"{self.course}/{self.semester}"

    def sittings(self) -> set[tuple]:
        """The sittings this paper may belong to: its test in its year when both are known, and in any
        case its test within its file (one file of internals is most often one sitting)."""
        out = {("f", self.source, self.kind)}
        when = self.session if self.session and self.session != "undated" else self.date
        if self.kind and when:
            out.add(("s", self.kind, when))
        return out


@dataclass
class Cand:
    """A subject a paper could belong to: one the semester has (id), or a name printed in the folder."""

    node: str  # "id:<subject id>" or "n:<name key>"
    label: str
    names: set[str] = field(default_factory=set)  # every printed form, as name keys
    sittings: set[tuple] = field(default_factory=set)
    samples: list[str] = field(default_factory=list)
    order: int = 10**9  # first place in the folder (printed names only)


def seen_parts(desk: Desk, keys: list[str], sugs: dict[str, dict]) -> list[Seen]:
    """Every part that has a reading, in desk order, with the fields of its suggestion (before any
    judgement); a part the maintainer decided already takes the decision's."""
    out: list[Seen] = []
    for key in keys:
        sug, pg = sugs.get(key), desk.page(key)
        reads = (desk.reads.get(key) or {}).get("parts") or []
        if not sug:
            continue
        decided = len(pg.parts) == len(sug["parts"]) and any(p.status != "todo" for p in pg.parts)
        for i, s in enumerate(sug["parts"]):
            if s["status"] not in ("use", "held"):
                continue
            paper = (reads[i].get("paper") if i < len(reads) else None) or {}
            p = Seen(id=f"{key}:{i}", key=key, source=key[:key.rindex("#")], course=s["course"], semester=s["semester"], kind=s["kind"],
                     session=s["session"], date=s["date"], name=s["new_subject"], subject=s["subject"],
                     header=not s["continues"], questions=[q for q in paper.get("questions") or [] if isinstance(q, str)], order=len(out))
            if decided:
                d = pg.parts[i]
                if d.status == "skip":
                    continue
                for f in ("course", "semester", "kind", "session"):
                    if getattr(d, f):
                        setattr(p, f, getattr(d, f))
                if d.subject:
                    p.subject, p.name = d.subject, ""
            out.append(p)
    return out


def candidates(where: str, parts: list[Seen], known: dict) -> list[Cand]:
    """The subjects of one course-semester: the ones it has (known["subjects"], with the sittings they
    have a paper in and how some of their questions begin), then the names printed in the folder."""
    cands: dict[str, Cand] = {}
    for sub in known.get("subjects") or []:
        c = Cand(f"id:{sub['id']}", sub["name"], {name_key(n) for n in [sub["name"], *sub.get("aliases", [])]})
        c.sittings |= {tuple(x) for x in known.get("sittings", {}).get(sub["id"], ())}
        c.samples = list(known.get("samples", {}).get(sub["id"], []))[:SAMPLES]
        cands[c.node] = c
    for p in parts:
        if p.where != where or not p.header:
            continue
        if p.subject and f"id:{p.subject}" in cands:
            c = cands[f"id:{p.subject}"]
        elif p.name and name_key(p.name):
            node = f"n:{name_key(p.name)}"
            c = cands.setdefault(node, Cand(node, clean_subject(p.name) or p.name, {name_key(p.name)}, order=p.order))
        else:
            continue
        c.sittings |= p.sittings()
        for q in p.questions:
            if len(c.samples) < SAMPLES and q not in c.samples:
                c.samples.append(q)
    return list(cands.values())


_PACKS: dict[str, tuple[float, dict]] = {}  # pack path -> (its time, samples)


def pack_samples(path: Path) -> dict[str, list[str]]:
    """How some questions of each subject begin, from a pack that is already built: one question from
    each of its first topics. {} when there is no pack yet."""
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {}
    if _PACKS.get(str(path), (0, {}))[0] != mtime:
        try:
            pack = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            return {}
        out = {}
        for sub in pack.get("subjects") or []:
            firsts = [t["questions"][0]["text"] for u in sub.get("units") or [] for t in u.get("topics") or [] if t.get("questions")]
            out[sub["id"]] = [" ".join(q.split()[:14]) for q in firsts[:SAMPLES]]
        _PACKS[str(path)] = (mtime, out)
    return _PACKS[str(path)][1]


def _lines(questions: list[str]) -> str:
    return "\n".join(f"- {q[:SAMPLE_CHARS]}" for q in questions)


def _listed(cands: list[Cand]) -> str:
    return "\n".join(f'{i}. "{c.label}"' + (" — its papers ask: " + " | ".join(q[:SAMPLE_CHARS] for q in c.samples) if c.samples else "")
                     for i, c in enumerate(cands, start=1))


def tasks(desk: Desk, keys: list[str], sugs: dict[str, dict], known_for: Callable[[str, int], dict]) -> list[dict]:
    """What there is to ask the model, from the suggestions as they are before any judgement:
    {"kind": "name", "where", "key", "name", "questions", "cands", "among"} for a printed name its
    semester does not have, and {"kind": "subject", "id", "where", "questions", "cands", "among"} for a
    paper that prints no subject. `among` names the choices, so a question is asked again only when
    they change."""
    parts = seen_parts(desk, keys, sugs)
    by_where: dict[str, list[Cand]] = {}
    out: list[dict] = []
    for p in parts:
        if not p.course or not p.semester or not p.header:
            continue
        if p.where not in by_where:
            by_where[p.where] = candidates(p.where, parts, known_for(p.course, p.semester))
        cands = by_where[p.where]
        if p.name and not p.subject:
            mine = next((c for c in cands if c.node == f"n:{name_key(p.name)}"), None)
            if mine is None or mine.order != p.order:  # asked once, for the first paper printing it
                continue
            others = [c for c in cands if c is not mine and not (c.sittings & mine.sittings) and not any(series_clash(p.name, n) for n in c.names)]
            if others:
                out.append({"kind": "name", "where": p.where, "key": name_key(p.name), "name": mine.label, "questions": mine.samples,
                            "cands": others, "among": sorted(c.node for c in others)})
        elif not p.name and not p.subject and len(p.questions) >= MIN_QUESTIONS:
            others = [c for c in cands if not (c.sittings & p.sittings())]
            if others:
                out.append({"kind": "subject", "id": p.id, "where": p.where, "questions": p.questions, "cands": others,
                            "among": sorted(c.node for c in others)})
    return out


def answered(judged: dict, t: dict) -> bool:
    """Asked already, among these same choices, and answered (an answer that failed is asked again)."""
    kept = (judged.get("names", {}).get(t["where"], {}).get(t["key"]) if t["kind"] == "name" else judged.get("subjects", {}).get(t["id"]))
    return bool(kept) and kept.get("among") == t["among"] and not kept.get("error")


def waiting(judged: dict, todo: list[dict]) -> list[dict]:
    return [t for t in todo if not answered(judged, t)]


def judge_one(t: dict, prov, course_name: str) -> dict:
    """Ask the model one question; the answer as it is kept: {"to": node or "", "to_name", "reason",
    "among", "model", "error"}. An answer that will not parse is kept as an error, with no subject."""
    sem = t["where"].rsplit("/", 1)[1]
    listed = _listed(t["cands"])
    if t["kind"] == "name":
        qs = ("Its questions begin:\n" + _lines(t["questions"])) if t["questions"] else ""
        prompt = NAME_PROMPT.format(course=course_name, semester=sem, name=t["name"], questions=qs, candidates=listed)
        res, err, _ = ask(prov, prompt, [], SameName, "desk-judge", lambda r: _in_range(r.same_as, t["cands"]))
        n = res.same_as if res is not None and not err else None
    else:
        prompt = SUBJECT_PROMPT.format(course=course_name, semester=sem, questions=_lines(t["questions"]), candidates=listed)
        res, err, _ = ask(prov, prompt, [], WhichSubject, "desk-judge", lambda r: _in_range(r.subject, t["cands"]))
        n = res.subject if res is not None and not err else None
    hit = t["cands"][n - 1] if n else None
    return {"name": t.get("name", ""), "to": hit.node if hit else "", "to_name": hit.label if hit else "",
            "reason": " ".join((res.reason if res is not None else "").split())[:240], "among": t["among"],
            "model": prov.model, "error": (err or "")[:240]}


def _in_range(n: int | None, cands: list) -> str | None:
    return None if n is None or 1 <= n <= len(cands) else f"the number must be 1 to {len(cands)}, or null"


def keep(judged: dict, t: dict, answer: dict) -> None:
    if t["kind"] == "name":
        judged.setdefault("names", {}).setdefault(t["where"], {})[t["key"]] = answer
    else:
        judged.setdefault("subjects", {})[t["id"]] = answer


# ------------------------------------------------------------ one paper photographed twice (no model)


def _start(q: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", q.lower())[:COPY_WORDS])


def same_questions(a: list[str], b: list[str]) -> bool:
    """Two readings of one paper: at least COPY_MIN questions of the shorter list begin (their first
    COPY_WORDS words) almost the same way as a question of the other, and they are most of that list."""
    a, b = [_start(q) for q in a if _start(q)], [_start(q) for q in b if _start(q)]
    if len(a) > len(b):
        a, b = b, a
    if len(a) < COPY_MIN:
        return False
    hits = sum(any(difflib.SequenceMatcher(None, x, y).ratio() >= COPY_ALIKE for y in b) for x in a)
    return hits >= COPY_MIN and hits >= COPY_SHARE * len(a)


def _printed(s: dict) -> int:
    """How much a suggestion knows of what a paper must print: its year, its test, its subject."""
    return bool(s["session"] or s["date"]) + bool(s["kind"]) + bool(s["subject"] or s["new_subject"])


def _label(key: str, i: int, n: int) -> str:
    src, page = key.rsplit("#", 1)
    return f'"{src}" page {page}' + (f" (part {i + 1})" if n > 1 else "")


def mark_copies(desk: Desk, keys: list[str], out: dict[str, dict]) -> None:
    """Suggest Skip for the copy of a paper whose questions begin the same way as another part's. The
    copy that prints more (the year above all) is the one kept; of two that print the same, the first.
    Two papers that print different years are both kept: the same questions were set again."""
    seen: list[tuple[str, int, dict, list[str]]] = []
    for key in keys:
        sug = out.get(key)
        reads = (desk.reads.get(key) or {}).get("parts") or []
        if not sug or sug.get("duplicate"):
            continue
        for i, s in enumerate(sug["parts"]):
            qs = ((reads[i].get("paper") if i < len(reads) else None) or {}).get("questions") or []
            if s["status"] not in ("use", "held") or len(qs) < COPY_MIN:
                continue
            for okey, oi, o, oqs in seen:
                if o["status"] == "skip" or not same_questions(qs, oqs):
                    continue
                if s["course"] and o["course"] and (s["course"], s["semester"]) != (o["course"], o["semester"]):
                    continue
                mine, theirs = s["session"] or s["date"], o["session"] or o["date"]
                here, there = _label(key, i, len(sug["parts"])), _label(okey, oi, len(out[okey]["parts"]))
                if mine and theirs and mine != theirs:
                    s["notes"].append(f"the same questions as {there}, which prints {theirs}: set again in another year, so both are kept")
                    break
                decided = any(p.status != "todo" for p in desk.page(okey).parts)
                loser, loser_key, kept = (o, okey, here) if _printed(s) > _printed(o) and not decided else (s, key, there)
                loser.update(status="skip", reason="duplicate", continues=False, likely=False,
                             sure=bool(mine and mine == theirs and not loser["error"]), copy_of=okey if loser is s else key)
                loser["notes"].insert(0, f"its questions begin the same way as those of {kept}: one paper photographed twice"
                                      + ("" if mine and theirs else " (or set again in a year one of them does not print: check)"))
                if len(out[loser_key]["parts"]) == 1:
                    out[loser_key]["duplicate"] = {"label": kept, "of": okey if loser is s else key, "by": "questions"}
                break
            seen.append((key, i, s, qs))
    copy = False  # a page with no header after a copy continues that copy: it goes with it
    for key in keys:
        for s in (out.get(key) or {"parts": []})["parts"]:
            if s["continues"] and s["status"] == "use":
                if copy:
                    s.update(status="skip", reason="duplicate", continues=False, likely=False, sure=False)
                    s["notes"].insert(0, "continues a paper that is suggested Skip as a copy")
            elif s["status"] in ("use", "held") or s.get("copy_of"):
                copy = bool(s.get("copy_of"))


# ------------------------------------------------------------ putting the answers into the suggestions


def apply(desk: Desk, keys: list[str], out: dict[str, dict], subjects_for: Callable[[str, int], list[dict]]) -> None:
    """Put what was worked out into the suggestions: a subject for a paper that prints none, one
    subject for two names, Skip for a copy. Every change adds a note saying how it was reached, sets
    `worked` ("questions" or "name") and, when nothing else about the part is in doubt, `likely`:
    the page counts with the sure ones, and its note goes into the manifest."""
    judged = desk.judged or {}
    order: dict[tuple[str, str], int] = {}  # (where, name key) -> first place in the folder
    parts = [(key, i, s) for key in keys if key in out for i, s in enumerate(out[key]["parts"])]
    for n, (key, i, s) in enumerate(parts):
        if s["new_subject"] and s["course"] and s["semester"]:
            order.setdefault((f"{s['course']}/{s['semester']}", name_key(s["new_subject"])), n)

    for key, i, s in parts:  # 1. a subject worked out from the questions
        got = judged.get("subjects", {}).get(f"{key}:{i}")
        if not got or not got.get("to") or s["subject"] or s["new_subject"] or "no subject" not in s["reason"] or not s["course"] or not s["semester"]:
            continue
        subs = {x["id"]: x for x in subjects_for(s["course"], s["semester"])}
        kind, _, ref = got["to"].partition(":")
        if kind == "id" and ref in subs:
            s["subject"] = ref
        elif kind == "n" and (f"{s['course']}/{s['semester']}", ref) in order:
            s["new_subject"] = got["to_name"]
        else:
            continue  # that subject is no longer there (the maintainer renamed or removed it)
        held = [r for r in s["reason"].split(", ") if r and r != "no subject"]
        s.update(status="held" if held else "use", reason=", ".join(held), worked="questions")
        s["notes"].append(f'no subject printed: "{got["to_name"]}" worked out from the questions' + (f" ({got['reason']})" if got.get("reason") else ""))

    for key, i, s in parts:  # 2. one subject under two names
        if not s["new_subject"] or not s["course"] or not s["semester"]:
            continue
        where = f"{s['course']}/{s['semester']}"
        names = judged.get("names", {}).get(where, {})
        subs = {x["id"]: x for x in subjects_for(s["course"], s["semester"])}
        group = _group(f"n:{name_key(s['new_subject'])}", names, subs, {k for (w, k) in order if w == where})
        ids = sorted(m[3:] for m in group if m.startswith("id:"))
        own = name_key(s["new_subject"])
        why = (names.get(own) or {}).get("reason") or next((names[m[2:]].get("reason", "") for m in group if m.startswith("n:") and m[2:] in names), "")
        if len(ids) == 1:
            s.update(subject=ids[0], same_as=subs[ids[0]]["name"], alias=s["new_subject"], new_subject="", worked=s.get("worked") or "name")
            s["notes"].append(f'"{s["alias"]}" taken as "{s["same_as"]}" under another name' + (f" ({why})" if why else ""))
        elif not ids and len(group) > 1:
            first = min((m[2:] for m in group if m.startswith("n:")), key=lambda k: order.get((where, k), 10**9))
            if first != own:
                label = next(clean_subject(x["new_subject"]) or x["new_subject"] for _, _, x in parts
                             if x["new_subject"] and x["course"] == s["course"] and x["semester"] == s["semester"] and name_key(x["new_subject"]) == first)
                s.update(alias=s["new_subject"], new_subject=label, same_as=label, worked=s.get("worked") or "name")
                s["notes"].append(f'"{s["alias"]}" taken as "{label}" under another name' + (f" ({why})" if why else ""))

    mark_copies(desk, keys, out)
    for key, i, s in parts:
        s["likely"] = bool(s.get("worked") and s["status"] == "use" and s["subject"] and not s["error"] and not s["doubts"]
                           and all(s[k] for k in ("course", "semester", "kind", "session")))


def _group(start: str, names: dict, subs: dict, present: set[str]) -> set[str]:
    """Every name and subject joined to `start` by a kept answer, in either direction, among the
    subjects the semester still has and the names still printed in the folder."""
    edges: dict[str, set[str]] = {}
    for k, got in names.items():
        to = got.get("to") or ""
        if not to or k not in present:
            continue
        if (to.startswith("id:") and to[3:] in subs) or (to.startswith("n:") and to[2:] in present):
            edges.setdefault(f"n:{k}", set()).add(to)
            edges.setdefault(to, set()).add(f"n:{k}")
    group, todo = {start}, [start]
    while todo:
        for nxt in edges.get(todo.pop(), ()):
            if nxt not in group:
                group.add(nxt)
                todo.append(nxt)
    return group
