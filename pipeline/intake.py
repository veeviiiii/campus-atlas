"""Get uploaded papers ready for the pipeline. No model calls, no API key needed.

    python -m pipeline.intake photos <folder of photos> <out.pdf>   # phone photos -> one PDF (file-name order)
    python -m pipeline.intake new --course bca --semester 1        # folder + manifest.yaml from catalog/davv.json
    python -m pipeline.intake check <manifest.yaml>                # anything missing? run before spending API calls

`new` again on a folder that already has a manifest appends the PDFs it does not list yet (adding
another year), and keeps everything else as it is. The full walkthrough is in ADDING-PAPERS.md.
"""

import argparse
import json
import sys
from pathlib import Path

import pymupdf
import yaml
from PIL import Image, ImageOps

from pipeline.manifest import check_exams

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog" / "davv.json"
PHOTOS = {".jpg", ".jpeg", ".png", ".webp"}

TEMPLATE = """\
# {name}, Semester {sem} · {school}
# Made by `python -m pipeline.intake new`. Replace every TODO, then run
#   .venv/Scripts/python -m pipeline.intake check {rel}
# Human ground truth: the pipeline reads every page header too, but this file wins.

schema_version: "1.0"

college:
  id: {college}
  name: {school}, DAVV
  city: Indore
  # DAVV Takshashila Campus (campus-level point, OpenStreetMap). The site does not show maps.
  lat: 22.6880762
  lng: 75.8749798

course:
  id: {course}
  name: {name}
  semester: {sem}

# One line per exam you have papers for; delete the ones you don't have.
# The first year you add uses the ids mst1 / mst2 / end. Every other year adds its session:
#   - {{id: end-2024-25, name: End Sem, date: "2025-01", session: "2024-25"}}
# date: year and month the exam was held. session: academic year (July to June).
exams:
  - {{id: mst1, name: MST-1, date: "TODO-YYYY-MM", session: "TODO-2025-26"}}
  - {{id: mst2, name: MST-2, date: "TODO-YYYY-MM", session: "TODO-2025-26"}}
  - {{id: end, name: End Sem, date: "TODO-YYYY-MM", session: "TODO-2025-26"}}

# Every subject of the semester. id: short, lowercase, words joined by hyphens (e.g. data-structures).
# aliases: other names printed on the papers for the same subject (never match by course code).
subjects:
  - id: TODO-subject-id
    name: TODO Subject Name
    aliases: []

# Every page of every PDF, once. A paper's second page: {{page: 2, subject: x, continues_previous: true}}
# Optional: rotation: 180 for an upside-down photo (the model also detects it).
files:
"""


def die(msg: str) -> None:
    sys.exit(f"error: {msg}")


def file_block(pdf: Path) -> str:
    n = pymupdf.open(pdf).page_count
    lines = [
        f"  - file: {pdf.name}            # {n} page{'s' if n != 1 else ''}",
        "    exam: TODO                   # an id from exams above",
        "    pages:",
    ]
    lines += [f"      - {{page: {p}, subject: TODO}}" for p in range(1, n + 1)]
    return "\n".join(lines) + "\n"


def photos(src: Path, out: Path) -> None:
    """All photos in a folder -> one PDF, in file-name order (rename to 01.jpg, 02.jpg... to set the order)."""
    files = sorted(p for p in src.iterdir() if p.suffix.lower() in PHOTOS) if src.is_dir() else []
    if not files:
        die(f"no photos (.jpg / .png / .webp) in {src}")
    if out.suffix.lower() != ".pdf":
        die("the output must end in .pdf")
    pages = [ImageOps.exif_transpose(Image.open(p)).convert("RGB") for p in files]  # phones store rotation in EXIF
    out.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(out, save_all=True, append_images=pages[1:], resolution=200.0)
    print(f"{out}: {len(pages)} pages")
    for i, p in enumerate(files, start=1):
        print(f"  page {i}: {p.name}")


def new(course_id: str, sem: int) -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    c = next((x for x in catalog["courses"] if x["id"] == course_id), None)
    if c is None:
        die(f"no course {course_id!r} in catalog/davv.json. Ids: " + ", ".join(x["id"] for x in catalog["courses"]))
    if not 1 <= sem <= c["years"] * 2:
        die(f"{c['name']} has semesters 1 to {c['years'] * 2}")
    folder = ROOT / "data" / "raw" / c["college"] / c["id"] / f"sem{sem}"
    folder.mkdir(parents=True, exist_ok=True)
    manifest = folder / "manifest.yaml"
    rel = manifest.relative_to(ROOT).as_posix()
    pdfs = sorted(folder.glob("*.pdf"))

    if manifest.exists():
        listed = {f["file"] for f in (yaml.safe_load(manifest.read_text(encoding="utf-8")).get("files") or [])}
        fresh = [p for p in pdfs if p.name not in listed]
        if not fresh:
            print(f"{rel} already lists every PDF in the folder.")
            return
        with manifest.open("a", encoding="utf-8") as f:  # `files:` is the manifest's last section
            f.write("".join(file_block(p) for p in fresh))
        print(f"Added {len(fresh)} PDF(s) to {rel}: {', '.join(p.name for p in fresh)}. Fill in their TODOs.")
        return

    text = TEMPLATE.format(name=c["name"], sem=sem, school=c["school"], college=c["college"], course=c["id"], rel=rel)
    manifest.write_text(text + "".join(file_block(p) for p in pdfs), encoding="utf-8")
    print(f"Created {rel}")
    if pdfs:
        print(f"  listed {len(pdfs)} PDF(s): {', '.join(p.name for p in pdfs)}")
    else:
        print(f"  no PDFs yet: put them in {folder.relative_to(ROOT).as_posix()}/ and run this command again to list them.")


def check(path: Path) -> bool:
    """Print every problem found; True when the manifest is ready for the pipeline."""
    problems: list[str] = []
    text = path.read_text(encoding="utf-8")
    todos = [i for i, line in enumerate(text.splitlines(), start=1) if "TODO" in line.split("#")[0]]
    if todos:
        problems.append(f"{len(todos)} line(s) still say TODO (lines {', '.join(map(str, todos[:12]))}{'…' if len(todos) > 12 else ''})")
    m = yaml.safe_load(text)
    for key in ("college", "course", "exams", "subjects", "files"):
        if not m.get(key):
            problems.append(f"`{key}` is missing or empty")
    if problems and not m.get("files"):
        return report(path, problems)

    try:
        check_exams(m)
    except (ValueError, KeyError, TypeError) as e:
        problems.append(f"exams: {e} (dates look like \"2025-10\", sessions like \"2025-26\")")
    exam_ids = {e.get("id") for e in m.get("exams") or []}
    subject_ids = {s.get("id") for s in m.get("subjects") or []}
    used_subjects, used_exams = set(), set()

    for f in m.get("files") or []:
        pdf = path.parent / f["file"]
        if not pdf.exists():
            problems.append(f"{f['file']}: not in {path.parent.name}/")
            continue
        n = pymupdf.open(pdf).page_count
        if f.get("exam") not in exam_ids:
            problems.append(f"{f['file']}: exam {f.get('exam')!r} is not one of the exams above")
        used_exams.add(f.get("exam"))
        pages = [p.get("page") for p in f.get("pages") or []]
        missing = sorted(set(range(1, n + 1)) - set(pages))
        extra = sorted(set(pages) - set(range(1, n + 1)))
        twice = sorted({p for p in pages if pages.count(p) > 1})
        if missing:
            problems.append(f"{f['file']}: page(s) {missing} not listed (the PDF has {n})")
        if extra:
            problems.append(f"{f['file']}: page(s) {extra} listed, but the PDF has only {n}")
        if twice:
            problems.append(f"{f['file']}: page(s) {twice} listed twice")
        prev = None
        for p in f.get("pages") or []:
            if p.get("subject") not in subject_ids:
                problems.append(f"{f['file']} page {p.get('page')}: subject {p.get('subject')!r} is not one of the subjects above")
            if p.get("continues_previous") and (prev is None or prev.get("subject") != p.get("subject")):
                problems.append(f"{f['file']} page {p.get('page')}: continues_previous, but the page before is a different subject")
            if p.get("rotation") not in (None, 0, 90, 180, 270):
                problems.append(f"{f['file']} page {p.get('page')}: rotation must be 0, 90, 180 or 270")
            used_subjects.add(p.get("subject"))
            prev = p

    for e in sorted(exam_ids - used_exams - {None}):
        problems.append(f"exam {e!r} has no file; delete it if you have no such paper")
    for s in sorted(subject_ids - used_subjects - {None}):
        problems.append(f"subject {s!r} is on no page; delete it or fix a page")

    # Page photos are published as packs/<college>/pages/<file>_p<N>.jpg, shared by every course of
    # the college: two manifests must never use the same file name.
    college = (m.get("college") or {}).get("id")
    if college:
        mine = {f["file"] for f in m.get("files") or []}
        for other in (ROOT / "data" / "raw" / college).glob("**/manifest.yaml"):
            if other.resolve() == path.resolve():
                continue
            theirs = {f["file"] for f in (yaml.safe_load(other.read_text(encoding="utf-8")).get("files") or [])}
            for name in sorted(mine & theirs):
                problems.append(f"{name}: {other.relative_to(ROOT).as_posix()} uses this file name too; rename one")

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    course = (m.get("course") or {}).get("id")
    if not any(c["id"] == course and c["college"] == college for c in catalog["courses"]):
        print(f"note: {college}/{course} is not in catalog/davv.json, so the site lists it under \"Other\" courses.")
    return report(path, problems)


def report(path: Path, problems: list[str]) -> bool:
    if problems:
        print(f"{path.as_posix()}: {len(problems)} problem(s)")
        for p in problems:
            print(f"  - {p}")
        return False
    print(f"{path.as_posix()}: ready. Next:")
    print(f"  .venv/Scripts/python -m pipeline.build_pack --manifest {path.as_posix()} --all")
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description="Get uploaded papers ready for the pipeline (no model calls).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("photos", help="photos in a folder -> one PDF")
    p.add_argument("folder", type=Path)
    p.add_argument("out", type=Path)
    n = sub.add_parser("new", help="folder + manifest.yaml for a course-semester (or add new PDFs to it)")
    n.add_argument("--course", required=True, help="course id from catalog/davv.json, e.g. bca")
    n.add_argument("--semester", type=int, required=True)
    c = sub.add_parser("check", help="find problems in a manifest before running the pipeline")
    c.add_argument("manifest", type=Path)
    args = ap.parse_args()
    if args.cmd == "photos":
        photos(args.folder, args.out)
    elif args.cmd == "new":
        new(args.course, args.semester)
    elif not check(args.manifest):
        sys.exit(1)


if __name__ == "__main__":
    main()
