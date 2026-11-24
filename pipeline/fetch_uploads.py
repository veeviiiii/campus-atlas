"""Bring papers uploaded on the site to this laptop, and tell their uploaders what became of them.

    python -m pipeline.fetch_uploads fetch     # uploads waiting to be checked -> data/inbox/uploads-<date>/
    python -m pipeline.fetch_uploads list      # what is waiting, held, and decided lately
    python -m pipeline.fetch_uploads mark <id> published --pack davv-sdsf/mtech-aids-dual-sem1
    python -m pipeline.fetch_uploads mark <id> rejected --why "an answer sheet, not a question paper"
    python -m pipeline.fetch_uploads mark <id> held --ask "Which year was this End Sem held?"
    python -m pipeline.fetch_uploads tidy      # delete photos left behind by withdrawn or decided uploads

<id> is an upload's id or its first characters, as `list` prints it.

The intake desk is the review queue: `fetch` names each upload's folder so the desk reads its course,
semester, exam and year from the path (pipeline.desk.suggest.from_name), and you carry on in the desk
as with any folder of papers (ADDING-PAPERS.md). `mark` is how the uploader hears back, on the site's
"My uploads": published (with a link), rejected (with the reason) or held (with your question; their
answer comes back with the next `fetch`).

Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in .env. The service key skips every access rule of the
database: it stays on this laptop, is never committed and never goes into the website's settings.
No model calls.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
BUCKET = "paper-uploads"
EXAM_WORDS = {"mst1": "MST-1", "mst2": "MST-2", "mst3": "MST-3", "end": "End Sem", "unknown": "exam not given"}
SAVED = ("id", "course_id", "semester", "subject", "exam_kind", "session", "exam_month", "note", "page_count", "status", "message", "answer", "created_at")


class Api:
    """The few Supabase HTTP calls this script makes (standard library only). Tests pass a fake."""

    def __init__(self, url: str, key: str) -> None:
        self.url = url.rstrip("/")
        # A new secret key (sb_secret_...) is not a JWT: Supabase wants it in apikey only. A legacy
        # service_role key is a JWT and goes in Authorization as well.
        self.headers = {"apikey": key} if key.startswith("sb_") else {"apikey": key, "Authorization": f"Bearer {key}"}

    def call(self, method: str, path: str, body: dict | None = None, headers: dict | None = None) -> bytes:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method, headers={**self.headers, "Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path.split('?')[0]}: {e.code} {e.read().decode(errors='replace')[:300]}") from e

    def rows(self, query: str) -> list[dict]:
        return json.loads(self.call("GET", f"/rest/v1/paper_uploads?{query}"))

    def update(self, upload_id: str, changes: dict) -> list[dict]:
        return json.loads(self.call("PATCH", f"/rest/v1/paper_uploads?id=eq.{upload_id}", changes, {"Prefer": "return=representation"}))

    def files(self, folder: str) -> list[str]:
        """Names directly inside a folder of the bucket (files and sub-folders), in name order."""
        body = {"prefix": folder, "limit": 1000, "offset": 0, "sortBy": {"column": "name", "order": "asc"}}
        return [x["name"] for x in json.loads(self.call("POST", f"/storage/v1/object/list/{BUCKET}", body))]

    def download(self, path: str) -> bytes:
        return self.call("GET", f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}")

    def delete(self, paths: list[str]) -> None:
        if paths:
            self.call("DELETE", f"/storage/v1/object/{BUCKET}", {"prefixes": paths})


def from_env() -> Api:
    load_dotenv(ROOT / ".env")
    url, key = os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_KEY are not set in .env (see .env.example).")
    return Api(url, key)


def tag(upload_id: str) -> str:
    """Eight letters from an upload's id, to keep two uploads of the same paper in separate folders.
    Letters a to p only: a digit or a word like "sem" in a folder name would be read as a semester or a year."""
    return "".join(chr(ord("a") + int(c, 16)) for c in upload_id.replace("-", "")[:8])


def folder_for(row: dict) -> Path:
    """<course>/Sem <N>/<exam> <year> <subject> <tag>: a path the intake desk reads the course, semester,
    exam and year from. The year is the session when the uploader gave it, else the year of the month."""
    year = row.get("session") or (row.get("exam_month") or "")[:4]
    subject = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", row["subject"])
    subject = " ".join(subject.split())[:60].rstrip(". ")
    name = " ".join(x for x in (EXAM_WORDS[row["exam_kind"]], year, subject, tag(row["id"])) if x)
    return Path(row["course_id"]) / f"Sem {row['semester']}" / name


def fetch(api: Api, inbox: Path, today: str) -> list[tuple[dict, Path]]:
    """Download every upload waiting to be checked (pending, or held and now answered). An upload
    already fetched into today's folder is left alone, so running it twice costs nothing."""
    waiting = api.rows("select=*&or=(status.eq.pending,and(status.eq.held,answer.not.is.null))&order=created_at.asc")
    out = []
    for row in waiting:
        folder = inbox / f"uploads-{today}" / folder_for(row)
        if not (folder / "upload.json").exists():
            prefix = f"{row['uploader']}/{row['id']}"
            names = [n for n in api.files(prefix) if re.fullmatch(r"\d{2}\.(jpg|jpeg|png|webp|pdf)", n)]
            folder.mkdir(parents=True, exist_ok=True)
            for n in names:
                (folder / n).write_bytes(api.download(f"{prefix}/{n}"))
            # Written last: a download that broke off half-way is fetched again next time.
            (folder / "upload.json").write_text(json.dumps({**{k: row.get(k) for k in SAVED}, "files": names}, indent=2, ensure_ascii=False), encoding="utf-8")
        out.append((row, folder))
    return out


def find(api: Api, short_id: str) -> dict:
    """The one upload whose id starts with these characters."""
    if not re.fullmatch(r"[0-9a-f-]{4,36}", short_id):
        sys.exit(f"{short_id!r} is not an upload id (use the id `list` prints, or its first characters).")
    hits = [r for r in api.rows("select=*&order=created_at.desc&limit=1000") if r["id"].startswith(short_id)]
    if len(hits) != 1:
        sys.exit(f"{len(hits)} uploads have an id starting with {short_id!r}; give more characters." if hits else f"No upload has an id starting with {short_id!r}.")
    return hits[0]


def mark(api: Api, row: dict, status: str, text: str | None = None, pack: str | None = None) -> dict:
    """Set what became of an upload. published / rejected: its photos are deleted from the bucket (the
    public copy is the page photo in packs/, made by the pipeline after any black-out). held: `text`
    is a question for the uploader, and an earlier answer is cleared."""
    if status == "published":
        changes = {"status": status, "pack_key": pack, "message": None}
    elif status == "rejected":
        changes = {"status": status, "message": text}
    else:
        changes = {"status": "held", "message": text, "answer": None}
    done = api.update(row["id"], changes)
    if not done:
        raise RuntimeError(f"upload {row['id']} was not changed")
    if status in ("published", "rejected"):
        prefix = f"{row['uploader']}/{row['id']}"
        api.delete([f"{prefix}/{n}" for n in api.files(prefix)])
    return done[0]


def tidy(api: Api) -> list[str]:
    """Delete photos nobody will look at again: of uploads withdrawn by their uploader (no row left)
    and of uploads already published or rejected. Returns the folders emptied."""
    keep = {f"{r['uploader']}/{r['id']}" for r in api.rows("select=id,uploader&status=in.(pending,held)&limit=10000")}
    emptied = []
    for user in api.files(""):
        for upload in api.files(user):
            prefix = f"{user}/{upload}"
            if prefix not in keep:
                api.delete([f"{prefix}/{n}" for n in api.files(prefix)])
                emptied.append(prefix)
    return emptied


def line(r: dict) -> str:
    year = r.get("session") or r.get("exam_month") or "year not given"
    return f"{r['id'][:8]}  {r['status']:<9}  {r['course_id']} sem {r['semester']} · {EXAM_WORDS[r['exam_kind']]} {year} · {r['subject']} · {r['page_count']} page(s)"


def main() -> None:
    ap = argparse.ArgumentParser(description="Papers uploaded on the site: fetch them, and tell the uploaders what became of them.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch", help="download the uploads waiting to be checked into data/inbox/")
    sub.add_parser("list", help="uploads waiting, held, and the last 20 decided")
    sub.add_parser("tidy", help="delete photos of withdrawn and decided uploads from the bucket")
    m = sub.add_parser("mark", help="published, rejected or held: what the uploader sees on the site")
    m.add_argument("id")
    m.add_argument("status", choices=["published", "rejected", "held"])
    m.add_argument("--pack", help='published: the pack it went into, e.g. "davv-sdsf/mtech-aids-dual-sem1"')
    m.add_argument("--why", help="rejected: the reason, in a sentence the uploader will read")
    m.add_argument("--ask", help="held: your question to the uploader")
    args = ap.parse_args()
    api = from_env()

    if args.cmd == "fetch":
        got = fetch(api, ROOT / "data" / "inbox", date.today().isoformat())
        for row, folder in got:
            print(line(row))
            for label, key in (("note", "note"), ("you asked", "message"), ("they answered", "answer")):
                if row.get(key):
                    print(f"          {label}: {row[key]}")
            print(f"          -> {folder.relative_to(ROOT).as_posix()}")
        if got:
            print(f'\n{len(got)} upload(s). Next: .venv/Scripts/python -m pipeline.desk "data/inbox/uploads-{date.today().isoformat()}"')
        else:
            print("Nothing is waiting.")
    elif args.cmd == "list":
        open_ = api.rows("select=*&status=in.(pending,held)&order=created_at.asc")
        decided = api.rows("select=*&status=in.(published,rejected)&order=updated_at.desc&limit=20")
        print("\n".join(line(r) for r in open_ + decided) or "No uploads yet.")
    elif args.cmd == "tidy":
        emptied = tidy(api)
        print(f"{len(emptied)} folder(s) emptied." if emptied else "Nothing to tidy.")
    else:
        text = {"published": args.pack, "rejected": args.why, "held": args.ask}[args.status]
        if not text:
            ap.error({"published": "published needs --pack", "rejected": "rejected needs --why", "held": "held needs --ask"}[args.status])
        if args.status == "published" and not (ROOT / "packs" / f"{args.pack}.json").exists():
            ap.error(f"packs/{args.pack}.json does not exist; --pack is <college>/<course>-sem<N>")
        row = mark(api, find(api, args.id), args.status, text, args.pack)
        print(line(row))


if __name__ == "__main__":
    main()
