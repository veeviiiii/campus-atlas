"""Turn the desk's decisions into the pipeline's inputs.

One PDF per course-semester, session and exam, named <course>-sem<N>_<session>_<exam>.pdf, in
data/raw/<school>/<course>/sem<N>/, merged into that folder's manifest.yaml (made from intake's
template if missing). Then `intake check` on every manifest it touched.

The merge edits the manifest as text, so every comment and line already in it stays as it is. The
desk only changes what it added itself, recorded in desk-decisions.json under `written`: its exams,
subjects and files, and its "Held back" lines in the header comment. Writing again replaces those in
place; an existing exam id is never renamed or moved. A PDF name already used by a file the desk did
not write gets _2, _3 (the desk never adds pages to a PDF it did not make).
"""

import contextlib
import io
import itertools
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import yaml

from pipeline import intake
from pipeline.desk.decisions import DATE, SESSION, Desk, Piece, exam_key, pieces, save
from pipeline.desk.geometry import render_part
from pipeline.desk.sources import Source, load_page, page_key
from pipeline.manifest import EXAM_KINDS, exam_kind, session_of

KIND_NAMES = {"mst1": "MST-1", "mst2": "MST-2", "mst3": "MST-3", "end": "End Sem"}
SUBJECT_ID = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")


# ---------------------------------------------------------------- names and exam ids

def pdf_base(course: str, semester: int, session: str, kind: str) -> str:
    return f"{course}-sem{semester}_{session}_{kind}"


def file_name(folder: Path, base: str, foreign: set[str], owned: set[str], assigned: set[str]) -> str:
    """<base>.pdf, or <base>_2.pdf, _3... when a file the desk did not write already has the name."""
    for n in itertools.count(1):
        name = f"{base}.pdf" if n == 1 else f"{base}_{n}.pdf"
        if name in assigned or name in foreign:
            continue
        if name in owned or not (folder / name).exists():
            return name
    raise AssertionError("unreachable")


def _session(e: dict) -> str | None:
    if e.get("session"):
        return str(e["session"])
    try:
        return session_of(str(e.get("date", "")))
    except ValueError:
        return None


def assign_exam_ids(existing: list[dict], wanted: list[tuple[str, str]]) -> dict[tuple[str, str], str]:
    """(session, kind) -> exam id. An exam already in the manifest keeps its id. Otherwise the manifest's
    first year uses the bare kind (mst1, end) and every other year adds its session (end-2024-25). In a
    manifest with no exams yet, the newest session the desk adds counts as the first year."""
    plain = {_session(e) for e in existing if e.get("id") in EXAM_KINDS}
    base = max(plain - {None}) if plain - {None} else max((s for s, _ in wanted), default=None)
    ids = {str(e.get("id")) for e in existing}
    out = {}
    for s, k in wanted:
        hit = next((str(e["id"]) for e in existing if _session(e) == s and exam_kind(str(e.get("id"))) == k), None)
        out[(s, k)] = hit or (k if s == base and k not in ids else f"{k}-{s}")
    return out


# ---------------------------------------------------------------- manifest text

def scalar(s: str) -> str:
    """s as a YAML value: plain when that reads back as the same text, else double-quoted."""
    try:
        if s and "#" not in s and yaml.safe_load(f"k: {s}") == {"k": s} and yaml.safe_load(f"[{s}]") == [s]:
            return s
    except yaml.YAMLError:
        pass
    return json.dumps(s, ensure_ascii=False)


def exam_lines(e: dict, ind: int) -> list[str]:
    return [" " * ind + f'- {{id: {e["id"]}, name: {e["name"]}, date: "{e["date"]}", session: "{e["session"]}"}}']


def subject_lines(s: dict, ind: int) -> list[str]:
    pad = " " * (ind + 2)
    return [" " * ind + f"- id: {s['id']}", pad + f"name: {scalar(s['name'])}", pad + f"aliases: [{', '.join(scalar(a) for a in s['aliases'])}]"]


def file_lines(f: dict, ind: int) -> list[str]:
    pad = " " * (ind + 2)
    out = [" " * ind + f"- file: {f['file']}" + (f"   # {f['comment']}" if f.get("comment") else ""), pad + f"exam: {f['exam']}", pad + "pages:"]
    for p in f["pages"]:
        line = pad + f"  - {{page: {p['page']}, subject: {p['subject']}" + (", continues_previous: true" if p["continues"] else "") + "}"
        out.append(line + (f"   # {p['comment']}" if p.get("comment") else ""))
    return out


def _section(lines: list[str], key: str) -> tuple[int, int]:
    """(line of `key:`, line after the section's last non-blank line). ValueError if there is none."""
    for start, line in enumerate(lines):
        if re.match(rf"{key}:\s*(\[\]\s*)?(#.*)?$", line):
            if re.match(rf"{key}:\s*\[\]", line):
                lines[start] = f"{key}:"  # `subjects: []` -> a block list the desk can add to
            end = next((i for i in range(start + 1, len(lines)) if lines[i] and not lines[i][0].isspace()), len(lines))
            while end > start + 1 and not lines[end - 1].strip():
                end -= 1
            return start, end
    raise ValueError(f"the manifest has no `{key}:` section")


def _indent(lines: list[str], start: int, end: int) -> int:
    """Indent of the section's list items (2 in every manifest so far)."""
    for line in lines[start + 1:end]:
        m = re.match(r"(\s*)-\s", line)
        if m:
            return len(m.group(1))
    return 2


def _item(lines: list[str], start: int, end: int, field_: str, value: str) -> tuple[int, int] | None:
    """Lines [i, j) of the list item `- field: value ...` or `- {field: value, ...}` in the section."""
    pat = re.compile(rf"(\s*)-\s*(\{{\s*)?{field_}:\s*[\"']?{re.escape(value)}[\"']?\s*([,}}#]|$)")
    for i in range(start + 1, end):
        m = pat.match(lines[i])
        if m:
            ind, j = len(m.group(1)), i + 1
            if not m.group(2):  # block style: the item goes on while lines are indented deeper
                while j < end and lines[j].strip() and len(lines[j]) - len(lines[j].lstrip()) > ind:
                    j += 1
            return i, j
    return None


def _sync(lines: list[str], key: str, field_: str, items: list[tuple[str, Callable[[int], list[str]]]], before: list[str], gap: bool = False) -> None:
    """Put the desk's items into section `key`: replace its earlier version in place, append new ones
    at the end, remove the ones it wrote before and no longer wants. items: (name, lines(indent))."""
    want = {name for name, _ in items}
    for name in before:
        if name in want:
            continue
        span = _item(lines, *_section(lines, key), field_, name)
        if span:
            i, j = span
            if gap and i > 0 and not lines[i - 1].strip():
                i -= 1  # and the blank line before it
            del lines[i:j]
    for name, make in items:
        start, end = _section(lines, key)
        new = make(_indent(lines, start, end))
        span = _item(lines, start, end, field_, name)
        if span:
            lines[span[0]:span[1]] = new
        else:
            lines[end:end] = ([""] if gap and end > start + 1 else []) + new


def drop_placeholders(lines: list[str]) -> None:
    """Remove the template's TODO exams and TODO subject when nothing uses them."""
    m = yaml.safe_load("\n".join(lines)) or {}
    used_exams = {f.get("exam") for f in m.get("files") or []}
    used_subjects = {p.get("subject") for f in m.get("files") or [] for p in f.get("pages") or []}
    for key, things, used in (("exams", m.get("exams"), used_exams), ("subjects", m.get("subjects"), used_subjects)):
        for t in things or []:
            if "TODO" in " ".join(str(v) for v in t.values()) and t.get("id") not in used:
                span = _item(lines, *_section(lines, key), "id", str(t.get("id")))
                if span:
                    del lines[span[0]:span[1]]


def held_marker(desk_name: str) -> str:
    return f'# Held back by the intake desk from "{desk_name}" (not listed below until the missing detail is known):'


def set_held(lines: list[str], desk_name: str, held: list[str]) -> None:
    """Replace this desk's "Held back" lines at the end of the header comment (or remove them)."""
    marker = held_marker(desk_name)
    if marker in lines:
        i = j = lines.index(marker)
        j += 1
        while j < len(lines) and lines[j].startswith("#   - "):
            j += 1
        if i > 0 and lines[i - 1] == "#":
            i -= 1
        del lines[i:j]
    if held:
        k = 0
        while k < len(lines) and lines[k].startswith("#"):
            k += 1
        lines[k:k] = (["#"] if k else []) + [marker] + [f"#   - {h}" for h in held] + ([] if k else [""])


def merge(text: str, *, exams: list[dict], subjects: list[dict], files: list[dict], held: list[str], before: dict, desk_name: str) -> str:
    """The manifest with the desk's entries in it. exams / subjects / files: only the ones the desk owns
    (never one the manifest already had); before: what the desk wrote last time ({files, exams, subjects})."""
    lines = text.splitlines()
    drop_placeholders(lines)
    _sync(lines, "exams", "id", [(e["id"], lambda ind, e=e: exam_lines(e, ind)) for e in exams], before.get("exams", []))
    _sync(lines, "subjects", "id", [(s["id"], lambda ind, s=s: subject_lines(s, ind)) for s in subjects], before.get("subjects", []))
    _sync(lines, "files", "file", [(f["file"], lambda ind, f=f: file_lines(f, ind)) for f in files], before.get("files", []), gap=True)
    set_held(lines, desk_name, held)
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- the plan

@dataclass
class Target:
    """Everything the desk writes for one course-semester."""

    course: dict  # catalog entry
    semester: int
    path: Path  # manifest.yaml
    text: str  # current manifest, or the template for a new one
    exists: bool
    before: dict  # what the desk wrote last time
    groups: dict = field(default_factory=dict)  # (session, kind) -> [Piece]
    held: list[str] = field(default_factory=list)
    files: list[dict] = field(default_factory=list)
    exams: list[dict] = field(default_factory=list)  # owned by the desk: added or updated
    kept_exams: list[dict] = field(default_factory=list)  # already in the manifest, used as they are
    subjects: list[dict] = field(default_factory=list)
    remove: list[str] = field(default_factory=list)

    @property
    def rel(self) -> str:
        return self.path.relative_to(intake.ROOT).as_posix()


@dataclass
class Plan:
    targets: list[Target] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)  # {piece, message}; nothing is written while there are any
    warnings: list[dict] = field(default_factory=list)
    undecided: int = 0
    held_nowhere: list[str] = field(default_factory=list)  # held back with no course or semester

    def problem(self, kind: str, message: str, piece: Piece | None = None) -> None:
        getattr(self, kind).append({"piece": piece.id if piece else None, "message": message})


def subject_names(t: Target, desk: Desk) -> dict[str, str]:
    m = yaml.safe_load(t.text) or {}
    names = {str(s.get("id")): str(s.get("name")) for s in m.get("subjects") or []}
    names.update({s["id"]: s["name"] for s in desk.subjects.get(f"{t.course['id']}/{t.semester}", [])})
    return names


def describe(d, names: dict[str, str]) -> str:
    """What is known about a held-back part: "Software Engineering, MST-2 2024-25"."""
    exam = " ".join(x for x in (KIND_NAMES.get(d.kind, ""), d.session) if x)
    return ", ".join(x for x in (names.get(d.subject, d.subject), exam) if x)


def make_plan(folder: Path, desk: Desk, sources: list[Source]) -> Plan:
    plan = Plan()
    targets: dict[tuple[str, int], Target] = {}

    def target(course_id: str, sem: int) -> Target:
        if (course_id, sem) not in targets:
            c = intake.find_course(course_id, sem)
            path = intake.manifest_path(c, sem)
            exists = path.exists()
            rel = path.relative_to(intake.ROOT).as_posix()
            text = path.read_text(encoding="utf-8") if exists else intake.template(c, sem).replace(
                "# Made by `python -m pipeline.intake new`.", "# Made by the intake desk (python -m pipeline.desk).")
            before = desk.written.get(rel, {"files": [], "exams": [], "subjects": []})
            targets[(course_id, sem)] = Target(c, sem, path, text, exists, before)
        return targets[(course_id, sem)]

    keys = [page_key(s.id, n) for s in sources for n in range(1, s.pages + 1)]
    for p in pieces(desk, keys):
        d = p.decision
        if p.decision.continues and p.follows is None:
            plan.problem("errors", "continues the previous page, but no page before it is used or held back", p)
            continue
        if d.status == "todo":
            plan.undecided += 1
            continue
        if d.status == "skip":
            continue
        try:
            t = target(d.course, d.semester) if d.course and d.semester else None
        except ValueError as e:
            plan.problem("errors", str(e), p)
            continue
        if d.status == "held":
            reason = d.reason or "held back"
            line = f"{p.label}: {reason}" + "".join(f". {x}" for x in (describe(d, subject_names(t, desk)) if t else "", d.note) if x)
            (t.held if t else plan.held_nowhere).append(line)
            continue
        missing = [name for name, v in (("course", d.course), ("semester", d.semester), ("subject", d.subject), ("exam", d.kind), ("session", d.session)) if not v]
        if missing:
            plan.problem("errors", f"needs {', '.join(missing)} (or mark it skip / held back)", p)
        elif not SESSION.fullmatch(d.session) or int(d.session[5:]) != (int(d.session[:4]) + 1) % 100:
            plan.problem("errors", f"session {d.session!r} should look like 2024-25", p)
        else:
            t.groups.setdefault((d.session, d.kind), []).append(p)

    for rel in desk.written:  # a semester the desk wrote to before, maybe with nothing now
        path = intake.ROOT / rel
        if path.exists():
            m = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            course = m.get("course") or {}
            try:
                target(course.get("id"), int(course.get("semester")))
            except (ValueError, TypeError):
                plan.problem("warnings", f"{rel}: could not read its course and semester, so the desk left it alone")

    for t in targets.values():
        _fill(t, desk, plan, folder.name)
    plan.targets = sorted(targets.values(), key=lambda t: (t.course["id"], t.semester))
    if plan.undecided:
        plan.problem("warnings", f"{plan.undecided} page(s) not decided yet (use, skip or held back): they are not written anywhere")
    for line in plan.held_nowhere:
        plan.problem("warnings", f"{line}: held back with no course and semester, so it is in desk-decisions.json only")
    return plan


def _fill(t: Target, desk: Desk, plan: Plan, desk_name: str) -> None:
    """Exams, subjects, files and removals for one course-semester."""
    lines = t.text.splitlines()
    drop_placeholders(lines)
    m = yaml.safe_load("\n".join(lines)) or {}
    folder = t.path.parent
    existing = [e for e in m.get("exams") or [] if str(e.get("id")) not in t.before["exams"]]
    existing_ids = {str(e.get("id")) for e in existing}
    order = sorted(t.groups, key=lambda sk: (sk[0], -EXAM_KINDS.index(sk[1])), reverse=True)  # newest session first, MST-1 first
    ids = assign_exam_ids(existing, order)

    for s, k in order:
        eid, first = ids[(s, k)], t.groups[(s, k)][0]
        date = desk.exam_dates.get(exam_key(t.course["id"], t.semester, s, k), "")
        if eid in existing_ids:
            e = next(e for e in existing if str(e.get("id")) == eid)
            t.kept_exams.append({"id": eid, "name": e.get("name"), "date": str(e.get("date")), "session": s})
            if date and date != str(e.get("date")):
                plan.problem("warnings", f"{t.rel}: exam {eid} is already in the manifest with date {e.get('date')}; kept it (the desk says {date})", first)
        elif not date:
            plan.problem("errors", f"{KIND_NAMES[k]} {s} of semester {t.semester} needs a date (\"2024-12\", or \"2024\" if no paper prints the month)", first)
        elif not DATE.fullmatch(date):
            plan.problem("errors", f"{KIND_NAMES[k]} {s}: date {date!r} should look like \"2024-12\" or \"2024\"", first)
        elif len(date) == 7 and session_of(date) != s:
            plan.problem("errors", f"{KIND_NAMES[k]} {s}: {date} falls in session {session_of(date)}, not {s}", first)
        else:
            t.exams.append({"id": eid, "name": KIND_NAMES[k], "date": date, "session": s})

    # Subjects: the manifest's, plus the ones added in the desk that a used page needs.
    known = {str(x.get("id")) for x in m.get("subjects") or [] if str(x.get("id")) not in t.before["subjects"]}
    mine = {x["id"]: x for x in desk.subjects.get(f"{t.course['id']}/{t.semester}", [])}
    for sid in sorted({p.decision.subject for ps in t.groups.values() for p in ps} - known):
        first = next(p for ps in t.groups.values() for p in ps if p.decision.subject == sid)
        if sid not in mine:
            plan.problem("errors", f"subject {sid!r} is not in {t.rel}; pick one or add it", first)
        elif not SUBJECT_ID.fullmatch(sid):
            plan.problem("errors", f"subject id {sid!r}: lowercase letters, digits and hyphens only (e.g. data-structures)", first)
        else:
            t.subjects.append(mine[sid])

    # Files: one per exam; warn when the manifest already has this subject in this exam.
    foreign_files = [f for f in m.get("files") or [] if f.get("file") not in t.before["files"]]
    have = {(p.get("subject"), f.get("exam")): f"{f.get('file')} p{p.get('page')}" for f in foreign_files for p in f.get("pages") or []}
    assigned: set[str] = set()
    for s, k in order:
        name = file_name(folder, pdf_base(t.course["id"], t.semester, s, k), {str(f.get("file")) for f in foreign_files}, set(t.before["files"]), assigned)
        assigned.add(name)
        pages = []
        for i, p in enumerate(t.groups[(s, k)], start=1):
            d = p.decision
            if (d.subject, ids[(s, k)]) in have and not d.continues:
                plan.problem("warnings", f"{t.rel} already has {d.subject} in {ids[(s, k)]} ({have[(d.subject, ids[(s, k)])]}): is this a duplicate?", p)
            page = desk.page(p.key)
            comment = "; ".join(x for x in (p.label, "blacked out" if page.boxes else "", d.note.replace("\n", " ")) if x)
            pages.append({"page": i, "subject": d.subject, "continues": d.continues, "comment": comment, "piece": p})
        t.files.append({"file": name, "exam": ids[(s, k)], "session": s, "kind": k, "pages": pages, "comment": f'made by the intake desk from "{desk_name}"'})
    t.remove = [f for f in t.before["files"] if f not in assigned]


def summary(plan: Plan) -> dict:
    """The plan as JSON for the desk page."""
    out = []
    for t in plan.targets:
        out.append({
            "manifest": t.rel, "exists": t.exists, "course": t.course["id"], "course_name": t.course["name"], "semester": t.semester,
            "files": [{"file": f["file"], "exam": f["exam"], "exam_name": f"{KIND_NAMES[f['kind']]} {f['session']}", "exists": (t.path.parent / f["file"]).exists(),
                       "pages": [{"page": p["page"], "piece": p["piece"].id, "label": p["piece"].label, "subject": p["subject"], "continues": p["continues"]} for p in f["pages"]]}
                      for f in t.files],
            "exams": [{**e, "state": "add" if e["id"] not in t.before["exams"] else "update"} for e in t.exams] + [{**e, "state": "kept"} for e in t.kept_exams],
            "subjects": t.subjects, "remove": t.remove, "held": t.held,
        })
    return {"targets": out, "errors": plan.errors, "warnings": plan.warnings, "undecided": plan.undecided}


# ---------------------------------------------------------------- writing

def _write_text(path: Path, text: str) -> None:
    """Write a manifest, keeping the line endings it had."""
    if path.exists() and b"\r\n" in path.read_bytes():
        text = text.replace("\n", "\r\n")
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(text.encode("utf-8"))
    os.replace(tmp, path)


def check(path: Path) -> tuple[bool, str]:
    """intake check, with what it printed (paths relative to the repo, as on the command line)."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        ok = intake.check(path)
    return ok, out.getvalue().replace(intake.ROOT.as_posix() + "/", "")


def write(folder: Path, desk: Desk, sources: list[Source], log=lambda msg: None) -> tuple[Plan, list[dict]]:
    """Write every PDF and manifest of the plan, save the desk, run intake check. Nothing is written
    when the plan has errors. Returns the plan and, per manifest, {manifest, ok, check}."""
    plan = make_plan(folder, desk, sources)
    if plan.errors:
        return plan, []
    desk_name = folder.name
    results = []
    for t in plan.targets:
        t.path.parent.mkdir(parents=True, exist_ok=True)
        for f in t.files:
            log(f"{t.rel}: writing {f['file']} ({len(f['pages'])} pages)")
            images, cache = [], {}
            for p in f["pages"]:
                piece: Piece = p["piece"]
                if piece.key not in cache:
                    src, n = piece.key.rsplit("#", 1)
                    cache = {piece.key: load_page(folder, src, int(n))}  # full size; keep one page at a time
                pg = desk.page(piece.key)
                images.append(render_part(cache[piece.key], pg.boxes, pg.rotation, pg.split, pg.at, piece.part, pg.parts[piece.part].rotation))
            out = t.path.parent / f["file"]
            tmp = out.with_name(out.stem + ".tmp.pdf")
            intake.save_pdf(images, tmp)
            os.replace(tmp, out)
        for name in t.remove:
            log(f"{t.rel}: removing {name} (no page goes there any more)")
            (t.path.parent / name).unlink(missing_ok=True)
        files = [{**f, "pages": [{k: v for k, v in p.items() if k != "piece"} for p in f["pages"]]} for f in t.files]
        text = merge(t.text, exams=t.exams, subjects=t.subjects, files=files, held=t.held, before=t.before, desk_name=desk_name)
        yaml.safe_load(text)  # never leave a manifest the pipeline cannot read
        _write_text(t.path, text)
        desk.written[t.rel] = {"files": [f["file"] for f in t.files], "exams": [e["id"] for e in t.exams], "subjects": [s["id"] for s in t.subjects]}
        save(folder, desk)  # after each manifest, so a crash midway still knows what the desk wrote
    for t in plan.targets:
        ok, printed = check(t.path)
        results.append({"manifest": t.rel, "ok": ok, "check": printed})
    return plan, results
