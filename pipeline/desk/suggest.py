"""Turn the model's readings (reader.py) and the picture matches (dupes.py) into suggested decisions.

A suggestion is "sure" when nothing about it needs a second look: every field matched, nothing
worked out from a guess, or a page that only continues the paper before it, or a copy found by its
picture. "Accept all sure pages" takes those in one go and leaves the doubtful ones to the maintainer.

No model calls here. The printed exam title, subject, course, semester and date become an exam kind,
a subject id, a course id, a semester, a session and an exam date, matched the way the pipeline
matches them (subjects by name and aliases, never by course code). What cannot be matched stays
empty, with a note saying what was printed. The maintainer accepts or changes every suggestion. What the paper does not print (often the year) is taken
from the file's name and folders when they say it ('Sem 3 Int1 2k25.pdf'), with a note saying so.
"""

import re
from typing import Callable

from pipeline.desk.decisions import Desk, pieces
from pipeline.manifest import match_exam, match_subject, session_of

ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10}
WORDS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10}
MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
# Short forms printed on papers -> the words in the course list (catalog/davv.json).
COURSE_WORDS = {"ai": "artificial intelligence", "ds": "data science", "aids": "artificial intelligence data science",
                "ml": "machine learning", "cs": "computer science", "cse": "computer science",
                "it": "information technology", "iot": "internet of things"}
COURSE_STOP = {"and", "of", "in", "the", "with", "years", "year", "yrs", "yr", "integrated", "int", "dual", "hons",
               "honours", "programme", "program", "course", "degree", "five", "four", "three"}
SESSION = r"\b((?:19|20)\d{2})\s*[-–/]\s*(\d{4}|\d{2})\b"
SKIP_FOR = {"answer sheet": "answer sheet"}  # any other kind that is not a question paper: "not a question paper"


def _number(tok: str) -> int | None:
    if tok in WORDS:
        return WORDS[tok]
    tok = re.sub(r"(st|nd|rd|th)$", "", tok)
    if tok.isdigit():
        return int(tok) if 1 <= int(tok) <= 12 else None
    return ROMAN.get(tok)


def parse_semester(text: str | None) -> int | None:
    """'Semester-III', 'III Sem', '5th Semester', 'Fifth Semester', 'Sem. V', 'VII' -> the number."""
    if not text:
        return None
    toks = re.findall(r"[a-z0-9]+", text.lower())
    for i, t in enumerate(toks):
        if t.startswith("sem"):
            for j in (i + 1, i - 1):
                if 0 <= j < len(toks) and (n := _number(toks[j])):
                    return n
    return _number(toks[0]) if len(toks) == 1 else None


def parse_date(text: str | None) -> str | None:
    """A printed date -> "YYYY-MM", or "YYYY" when only the year is printed. Day first (12/10/2025 is October)."""
    if not text:
        return None
    s = re.sub(SESSION, lambda m: " " if parse_session(m[0]) else m[0], text.lower())  # "2024-25" is a session, not a date
    m = re.search(r"\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})\b", s)
    if m and 1 <= int(m[2]) <= 12:
        y = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
        return f"{y}-{int(m[2]):02d}"
    m = re.search(r"\b((?:19|20)\d{2})\s*[./-]\s*(\d{1,2})\b", s)  # 2025-10
    if m and 1 <= int(m[2]) <= 12:
        return f"{m[1]}-{int(m[2]):02d}"
    m = re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s,/'-]*((?:19|20)\d{2})\b", s)
    if m:
        return f"{m[2]}-{MONTHS[m[1]]:02d}"
    m = re.search(r"\b((?:19|20)\d{2})\b", s)
    return m[1] if m else None


def parse_session(text: str | None) -> str | None:
    """'2024-25', 'Session 2024-2025', '2024–25' -> "2024-25" (only a pair of years in a row)."""
    if not text:
        return None
    m = re.search(SESSION, text)
    if not m:
        return None
    a, b = int(m[1]), int(m[2][-2:])
    return f"{a}-{b:02d}" if b == (a + 1) % 100 else None


def session_from_year(year: int, semester: int | None, kind: str) -> str | None:
    """The session when a paper prints only a year. Odd semesters run July to December (their End Sem
    can fall in December or January, so it is not guessed); even semesters January to June."""
    if not semester or not kind:
        return None
    if semester % 2 == 0:
        return f"{year - 1}-{year % 100:02d}"
    if kind != "end":
        return f"{year}-{(year + 1) % 100:02d}"
    return None


def from_name(source: str) -> dict:
    """What a source's path inside the folder says: {"semester", "kind", "session", "date"}, None where
    it says nothing. 'M.tech_Sem1_ENDSEMQP_2k24-25.pdf' -> semester 1, end, session 2024-25;
    'Sem 3 Int1 2k25.pdf' -> semester 3, mst1, date 2025; '1st sem ll-internal.pdf' -> semester 1, mst2."""
    s = source.lower()
    s = re.sub(r"\.(pdf|jpe?g|png|webp)$", "", s)
    s = re.sub(r"\(\d+\)", " ", s)  # "(1)": a second download of the same file
    s = re.sub(r"[_./\\]+", " ", s)
    s = re.sub(r"(?<![a-z0-9])2k(\d{2})(?!\d)", r"20\1", s)  # 2k24 -> 2024
    s = re.sub(r"endsem\w*", " end sem ", s)  # ENDSEMQP
    s = re.sub(r"(\d)(st|nd|rd|th)?(sem)", r"\1\2 \3", s)  # 1stSem -> 1st sem
    s = re.sub(r"(sem|semester)(\d)", r"\1 \2", s)  # Sem1 -> sem 1
    s = re.sub(r"\b(int|internal|mst|test|ut)\s*-?\s*(\d)\b", r"internal \2", s)  # Int1 -> internal 1
    s = re.sub(r"\b(i{1,3}|l{1,3})\s*-?\s*(int|internal|mst|test)\b", lambda m: f"internal {len(m[1])}", s)  # "ll-internal": II
    session = parse_session(s)
    years = set(re.findall(r"(?<!\d)((?:19|20)\d{2})(?!\d)", re.sub(SESSION, " ", s)))
    date = parse_date(s) if not session and len(years) == 1 else None
    nth = r"(?:\d{1,2}(?:st|nd|rd|th)?|[ivx]+|" + "|".join(WORDS) + ")"
    exam = re.sub(rf"(?:\b{nth}[\s-]+)?\bsem(?:ester)?\b(?:[\s-]+{nth}\b)?", " ", s)  # "Second Sem", "sem 3rd": the semester, not a test number
    return {"semester": parse_semester(s), "kind": match_exam(exam), "session": session, "date": date}


def course_words(name: str) -> set[str]:
    s = re.sub(r"[^a-z0-9]+", " ", name.lower().replace(".", "").replace("&", " and "))
    words = " ".join(COURSE_WORDS.get(t, t) for t in s.split())
    return {w for w in words.split() if w not in COURSE_STOP and not w.isdigit()}


def match_course(name: str | None, courses: list[dict]) -> str | None:
    """The one course in the course list whose name shares most words with the printed name, or None
    when none is close or two are equally close (B.Com. is taught in two schools)."""
    if not name:
        return None
    printed = course_words(name)
    if not printed:
        return None
    scored = sorted(((len(printed & (w := course_words(c["name"]))) / len(printed | w), c["id"]) for c in courses), reverse=True)
    if not scored or scored[0][0] < 0.5 or (len(scored) > 1 and scored[0][0] - scored[1][0] < 0.15):
        return None
    return scored[0][1]


def _blank(rotation: int = 0) -> dict:
    return {"status": "todo", "reason": "", "continues": False, "course": "", "semester": None, "subject": "", "kind": "",
            "session": "", "rotation": rotation, "date": "", "printed": "", "new_subject": "", "notes": [], "error": "", "sure": False}


def part_suggestion(reading: dict, ctx: dict, courses: list[dict], subjects_for: Callable[[str, int], list[dict]],
                    source: str = "") -> dict:
    """Suggested fields for one part from its reading {"rotation", "kind", "paper", "error"}.
    ctx: the course and semester of the page before, for a paper that does not print them.
    source: the file's path in the folder, for what the paper does not print (from_name)."""
    s = _blank(reading.get("rotation", 0))
    s["error"] = reading.get("error", "")
    kind = reading.get("kind", "")
    if not kind:
        return s
    if kind != "question paper":
        s.update(status="skip", reason=SKIP_FOR.get(kind, "not a question paper"))
        s["notes"].append(f"the model sees {'an' if kind[0] in 'aeiou' else 'a'} {kind}")
        return s
    paper = reading.get("paper") or {}
    if not paper.get("has_header", True):
        s.update(status="use", continues=True, sure=not s["error"])
        s["notes"].append("no printed header: the next page of the paper before it")
        return s
    s["printed"] = " · ".join(paper[k] for k in ("exam_title", "subject_name", "course_name", "semester", "date", "year") if paper.get(k))
    sems = {c["id"]: c["years"] * 2 for c in courses}
    doubts = 0  # things worked out from a guess or not matching what is printed

    course = match_course(paper.get("course_name"), courses)
    if not course and ctx.get("course"):
        course = ctx["course"]
        s["notes"].append("course as the page before" + (f' (printed: "{paper["course_name"]}")' if paper.get("course_name") else ""))
    s["course"] = course or ""

    named = from_name(source)
    sem = parse_semester(paper.get("semester")) or parse_semester(paper.get("course_name"))
    if sem and named["semester"] and named["semester"] != sem:
        s["notes"].append(f"the file name says semester {named['semester']}, the paper {sem}")
        doubts += 1
    if not sem and named["semester"]:
        sem = named["semester"]
        s["notes"].append("semester from the file name")
    if sem and course and sem > sems.get(course, 12):
        s["notes"].append(f"semester {sem} is printed, but the course has {sems[course]}")
        sem = None
        doubts += 1
    if not sem and course and ctx.get("course") == course and ctx.get("semester"):
        sem = ctx["semester"]
        s["notes"].append("semester as the page before")
    s["semester"] = sem

    s["kind"] = match_exam(paper.get("exam_title")) or ""
    if s["kind"] and named["kind"] and named["kind"] != s["kind"]:
        s["notes"].append(f"the file name says {named['kind']}, the paper {s['kind']}")
        doubts += 1
    if not s["kind"] and named["kind"]:
        s["kind"] = named["kind"]
        s["notes"].append("exam from the file name")

    date = parse_date(paper.get("date"))
    session = parse_session(paper.get("year")) or parse_session(paper.get("date"))
    where = "printed"
    if not date and not session and (named["session"] or named["date"]):
        date, session, where = named["date"], named["session"], "in the file name"
        s["notes"].append("year from the file name")
    if not session and date and len(date) == 7:
        session = session_of(date)
    elif session and date and len(date) == 7 and session_of(date) != session:
        s["notes"].append(f"the date {date} is not in the printed session {session}")
        doubts += 1
    if not session and date:
        session = session_from_year(int(date), sem, s["kind"])
        s["notes"].append(f"only the year {date} is {where}: " + (f"session {session} worked out from the semester" if session else "pick the session"))
        doubts += 1
    s["session"], s["date"] = session or "", date or ""

    name = paper.get("subject_name")
    if course and sem and name:
        subs = subjects_for(course, sem)
        s["subject"] = (match_subject({"subjects": subs}, name) if subs else None) or ""
        if not s["subject"]:
            s["new_subject"] = name
            s["notes"].append(f'"{name}" is not a subject of this semester yet: accepting adds it')

    held = []
    if not date and not session:
        held.append("no year")
    if not s["kind"]:
        held.append("no test number")
    if not name:
        held.append("no subject")
    s.update(status="held" if held else "use", reason=", ".join(held))
    s["sure"] = (not held and not doubts and not s["error"] and not s["new_subject"]
                 and all(s[k] for k in ("course", "semester", "subject", "kind", "session")))
    return s


def suggestions(desk: Desk, keys: list[str], courses: list[dict], subjects_for: Callable[[str, int], list[dict]],
                dupes: dict[str, dict]) -> dict[str, dict]:
    """Suggested decisions for every page with a reading or a picture match, in desk order:
    {key: {"model", "rotation", "split", "parts": [...], "error", "duplicate"}}. A paper that does not
    print its course takes the course (and semester) of the page before it, decided or suggested."""
    decided: dict[str, list] = {}
    for p in pieces(desk, keys):
        decided.setdefault(p.key, []).append(p)
    out, ctx = {}, {}
    for key in keys:
        pg = desk.page(key)
        reading, dup = desk.reads.get(key), dupes.get(key)
        if reading or dup:
            if reading:
                parts = []
                for r in reading.get("parts") or []:  # the lower half of a page follows the upper one
                    parts.append(part_suggestion(r, ctx, courses, subjects_for, key[:key.rindex("#")]))
                    ctx = _follow(ctx, parts[-1])
                parts = parts or [_blank(pg.rotation)]
                sug = {"model": reading.get("model", ""), "rotation": reading.get("rotation", pg.rotation),
                       "split": reading.get("split", pg.split), "parts": parts, "error": reading.get("error", "")}
            else:
                sug = {"model": "", "rotation": pg.rotation, "split": pg.split, "parts": [_blank(p.rotation) for p in pg.parts], "error": ""}
            if dup:
                sug["duplicate"] = dup
                for s in sug["parts"]:
                    s.update(status="skip", reason="duplicate", continues=False, sure=True)
                    s["notes"].insert(0, f"looks the same as {dup['label']}")
            out[key] = sug
        if any(p.decision.status != "todo" for p in decided.get(key, [])):  # what the maintainer decided wins
            for p in decided[key]:
                ctx = _follow(ctx, {"status": p.decision.status, "continues": False, "course": p.decision.course, "semester": p.decision.semester})
    return out


def _follow(ctx: dict, s: dict) -> dict:
    """The course and semester a later paper without them takes: from the last used or held one."""
    if s["status"] in ("use", "held") and not s["continues"] and s["course"]:
        return {"course": s["course"], "semester": s["semester"]}
    return ctx
