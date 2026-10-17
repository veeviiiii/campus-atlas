"""Run the PYQ Trust Harness.

extract stage (per paper): render -> orient -> header -> extract -> validate -> contamination check
    -> data/work/<college>/<course>-sem<N>/extracted/<subject>.json and runs/<timestamp>/report.md
pack stage (per subject): repeats -> units/topics -> scoring -> packs/<college>/<course>-sem<n>.json

Usage:
    python -m pipeline.build_pack --all                  # everything (model answers are cached)
    python -m pipeline.build_pack --subjects physics-1 --stage extract
    python -m pipeline.build_pack --stage pack           # rebuild the pack from extracted files
"""

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pipeline.contamination import check_paper
from pipeline.extract import extract_paper, orient_page, read_header
from pipeline.manifest import load_manifest, papers, subject_name, work_dir
from pipeline.pack import build_pack, pack_path
from pipeline.quiz import add_quizzes
from pipeline.providers import CALLS, ROOT, get_provider
from pipeline.render import render_all
from pipeline.report import RunReport

DEFAULT_MANIFEST = ROOT / "data/raw/davv-sdsf/mtech-aids-dual/sem1/manifest.yaml"


def run(manifest_path: Path, subjects: list[str] | None, workers: int) -> Path:
    m = load_manifest(manifest_path)
    todo = [p for p in papers(m) if not subjects or p.subject in subjects]
    sids = sorted({p.subject for p in todo})
    report = RunReport(subjects=sids)
    print(f"model: {get_provider().model} | papers: {len(todo)} | subjects: {', '.join(sids)}", flush=True)

    work = work_dir(m)
    render_all(m["_dir"], work / "pages")  # step 1 (cached)

    def do_paper(paper):
        images, headers = [], []
        for page in paper.pages:
            img = orient_page(page, report, work)
            headers.append(read_header(page, img, m, report))
            images.append(img)
        max_marks = next((h.max_marks for h in headers if h and h.max_marks), None)
        qs = extract_paper(paper, images, max_marks, m, report)
        page_images = {page.ref: img for page, img in zip(paper.pages, images)}
        kept = check_paper(qs, subject_name(m, paper.subject), page_images, report)
        report.add("papers", page_ref=paper.ref, subject=paper.subject, exam=paper.exam, questions=len(kept))
        print(f"  {paper.ref}: {len(qs)} extracted, {len(kept)} kept | calls so far {CALLS.summary()['calls']}", flush=True)
        codes = [h.course_code for h in headers if h and h.course_code]
        return paper, kept, codes

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(do_paper, todo))

    # One self-contained file per subject: questions plus everything the harness dropped or doubted.
    extracted_dir = work / "extracted"
    extracted_dir.mkdir(parents=True, exist_ok=True)
    for sid in sids:
        mine = [(p, qs, codes) for p, qs, codes in results if p.subject == sid]
        refs = {pg.ref for p, _, _ in mine for pg in p.pages}
        about_me = lambda items: [x for x in items if any(r in str(x.get("page_ref", "")) for r in refs)]  # noqa: E731
        out = {
            "subject_id": sid,
            "subject_name": subject_name(m, sid),
            "codes_seen": sorted({c for _, _, codes in mine for c in codes}),
            "papers": [{"exam": p.exam, "page_refs": [pg.ref for pg in p.pages], "questions": qs} for p, qs, _ in mine],
            "dropped": about_me(report.dropped),
            "unsure": about_me(report.unsure),
            "disagreements": about_me(report.disagreements),
        }
        (extracted_dir / f"{sid}.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    run_dir = report.write(ROOT)
    print(f"report: {run_dir / 'report.md'}")
    print(CALLS.summary())
    return run_dir


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the PYQ Trust Harness")
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--subjects", nargs="*", help="subject ids from the manifest")
    ap.add_argument("--all", action="store_true", help="all subjects in the manifest")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--stage", choices=["extract", "pack", "quiz", "all"], default="all",
                    help="extract = steps 1-6 per paper; pack = steps 7-10 + 12 from the extracted files; quiz = step 11, adds quizzes to the pack in place; all = extract + pack")
    args = ap.parse_args()
    if args.stage in ("extract", "all") and not args.all and not args.subjects:
        ap.error("pass --subjects ... or --all")
    if args.stage in ("extract", "all"):
        run(args.manifest, None if args.all else args.subjects, args.workers)
    if args.stage in ("pack", "all"):
        build_pack(args.manifest, args.workers)
    if args.stage == "quiz":
        add_quizzes(pack_path(args.manifest), args.workers)


if __name__ == "__main__":
    main()
