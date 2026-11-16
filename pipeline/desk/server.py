"""The desk's web page and its JSON API, on 127.0.0.1 only (Python's http.server, no framework).

One folder of sources (or one file) is open at a time. The page holds the decisions and sends them
after every change (PUT /api/state); everything that reads or writes files happens here, and so do
the model readings ("Read pages", in the background) and the picture matches. Files dropped on the
start screen are saved into data/inbox/ as they arrive. The small cards are cut from small pictures of
the pages, kept in data/work/desk/thumbs/. The desk stops on "Close the desk", or by itself once no page
has called for half an hour.
"""

import copy
import hashlib
import http.client
import io
import json
import os
import re
import shutil
import string
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yaml
from PIL import Image

from pipeline import intake
from pipeline.desk import decisions, dupes, export, reader, suggest
from pipeline.desk.geometry import render_part
from pipeline.desk.sources import PREVIEW_SIDE, SMALL_SIDE, is_source, is_source_name, list_sources, load_page, load_pages, page_key, stamp
from pipeline.manifest import EXAM_KINDS

STATIC = Path(__file__).resolve().parent / "static"
RECENT = "data/work/desk/recent.json"  # folders and files opened before, newest first
RUNNING = "data/work/desk/running.json"  # {"port"} of the desk while it runs, so a second start opens it instead
INBOX = "data/inbox"  # files dropped on the desk page: one folder per drop (gitignored)
THUMBS = "data/work/desk/thumbs"  # a small picture of every page seen, by file, size, time and page (gitignored)
THUMB_DAYS = 30  # small pictures older than this are removed when the desk starts
UNZIP_BYTES, UNZIP_FILES = 4 * 1024**3, 5000  # the most a dropped .zip may unpack to
FONTS = ("inter-latin.woff2", "space-grotesk-latin.woff2", "ibm-plex-mono-400-latin.woff2", "ibm-plex-mono-500-latin.woff2",
         "silkscreen-700-latin.woff2")  # the site's own fonts, from web/src/app/fonts
PORTS = 20  # the desk takes the first free port from --port on
IDLE = 30 * 60  # seconds without the page open (it calls /api/ping every minute) before the desk stops itself


def page() -> bytes:
    """desk.html with its stylesheet and script inside it: one response, so the page is never unstyled."""
    html = (STATIC / "desk.html").read_text(encoding="utf-8")
    css = (STATIC / "desk.css").read_text(encoding="utf-8")
    js = (STATIC / "desk.js").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="desk.css">', f"<style>\n{css}</style>")
    return html.replace('<script src="desk.js"></script>', f"<script>\n{js}</script>").encode("utf-8")


def safe_parts(name: str) -> list[str]:
    """The folders and the file name of a dropped file's path, safe to join under an inbox folder:
    no "..", no drive, none of the characters Windows refuses."""
    parts = [re.sub(r'[<>:"|?*\x00-\x1f]', "_", s).strip().rstrip(".") for s in re.split(r"[\\/]+", name)]
    return [s for s in parts if s]


def free_path(folder: Path, parts: list[str]) -> Path:
    """folder/parts, or "name (2).pdf" and so on when that file is there already; its folder is made."""
    target = folder.joinpath(*parts)
    stem, suffix, n = target.stem, target.suffix, 2
    while target.exists():
        target, n = target.with_name(f"{stem} ({n}){suffix}"), n + 1
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def unzip(f, folder: Path, name: str) -> int:
    """Unpack the PDFs and photos of a dropped .zip into the folder, keeping its folders. Returns how many."""
    n = total = 0
    try:
        with zipfile.ZipFile(f) as z:
            for info in z.infolist():
                parts = safe_parts(info.filename)
                if info.is_dir() or not parts or not is_source_name(parts[-1]) or any(s.startswith((".", "__MACOSX")) for s in parts[:-1]):
                    continue
                n, total = n + 1, total + info.file_size
                if total > UNZIP_BYTES or n > UNZIP_FILES:
                    raise ValueError(f"{name} unpacks to too much (over {UNZIP_BYTES // 1024**3} GB or {UNZIP_FILES} files)")
                with z.open(info) as src, open(free_path(folder, parts), "wb") as out:
                    shutil.copyfileobj(src, out, 1 << 20)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as e:  # not a zip, or one with a password
        raise ValueError(f"{name} would not open as a zip ({e})") from e
    if not n:
        raise ValueError(f"no PDFs or photos in {name}")
    return n


def prune_thumbs() -> None:
    """Remove the small pictures not made in the last THUMB_DAYS days (they are made again when needed)."""
    old = time.time() - THUMB_DAYS * 86400
    for f in (intake.ROOT / THUMBS).glob("*.jpg"):
        try:
            if f.stat().st_mtime < old:
                f.unlink()
        except OSError:
            pass


class Run:
    """One pipeline run: `build_pack --manifest <m> --all` in the background, its output kept line by line."""

    def __init__(self, manifest: str, cmd: list[str] | None = None):
        self.manifest = manifest
        self.lines: list[str] = []
        self.code: int | None = None
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
        cmd = cmd or [sys.executable, "-m", "pipeline.build_pack", "--manifest", manifest, "--all"]
        self.lines.append("$ " + " ".join(f'"{c}"' if " " in c else c for c in cmd))
        self.proc = subprocess.Popen(cmd, cwd=intake.ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, encoding="utf-8", errors="replace", bufsize=1,
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))  # no console window from intake-desk.cmd
        threading.Thread(target=self._drain, daemon=True).start()

    def _drain(self) -> None:
        for line in self.proc.stdout:
            self.lines.append(line.rstrip("\n"))
        self.proc.stdout.close()
        self.code = self.proc.wait()

    def report(self) -> dict | None:
        """The run report's unsure list (and counts), once build_pack has printed where it is."""
        path = next((line[len("report: "):].strip() for line in reversed(self.lines) if line.startswith("report: ")), None)
        if not path:
            return None
        rj = Path(path).with_name("report.json")
        if not rj.is_absolute():
            rj = intake.ROOT / rj
        if not rj.exists():
            return None
        r = json.loads(rj.read_text(encoding="utf-8"))
        return {"path": Path(path).as_posix(), "unsure": r.get("unsure", []), "disagreements": len(r.get("disagreements", [])),
                "dropped": len(r.get("dropped", [])), "papers": len(r.get("papers", [])), "questions": sum(p.get("questions", 0) for p in r.get("papers", []))}


class App:
    def __init__(self):
        self.lock = threading.RLock()
        self.folder: Path | None = None
        self.only = ""  # one file of the folder open on its own, or "" for the whole folder
        self.sources = []
        self.broken: list[str] = []
        self.desk = decisions.Desk()
        self.previews: OrderedDict = OrderedDict()  # (src, page) -> preview image (the editor's, large)
        self.smalls: dict = {}  # (src, page) -> the small picture as JPEG bytes
        self.run: Run | None = None
        self.gen = 0  # which open this is: readings that finish after another open are dropped
        self.reader: reader.Reader | None = None
        self.dupes: dict[str, dict] = {}
        self.dupes_ready = False
        self.seen = time.time()  # the page's last request

    def busy(self) -> bool:
        """Reading pages or running the pipeline: the desk does not stop itself then."""
        return bool((self.reader and self.reader.status()["running"]) or (self.run and self.run.code is None))

    # ------------------------------------------------------------ folder and state

    def open(self, path: Path) -> None:
        """Open a folder of sources, or one PDF or photo on its own (its decisions go next to it)."""
        if path.is_file():
            if not is_source(path):
                raise ValueError(f"{path.name} is not a PDF or a photo (.jpg / .png / .webp)")
            folder, only = path.parent, path.name
        elif path.is_dir():
            folder, only = path, ""
        else:
            raise ValueError(f"{path} is not a folder or a file")
        sources, broken = list_sources(folder, only)
        if not sources:
            raise ValueError(f"{path.name} would not open as a PDF" if only else f"no PDFs or photos (.jpg / .png / .webp) in {folder}")
        desk = decisions.load(folder, only)
        with self.lock:
            if self.reader:
                self.reader.stop()
            self.gen += 1
            self.folder, self.only, self.sources, self.broken, self.desk = folder.resolve(), only, sources, broken, desk
            self.previews.clear()
            self.smalls.clear()
            self.reader, self.dupes, self.dupes_ready = None, {}, False
        threading.Thread(target=self.background, args=(self.gen,), daemon=True).start()
        opened = str(self.folder / only) if only else str(self.folder)
        recent = self.recent()
        rp = intake.ROOT / RECENT
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text(json.dumps([opened] + [r for r in recent if r != opened][:7], indent=1), encoding="utf-8")

    def recent(self) -> list[str]:
        path = intake.ROOT / RECENT
        try:
            return [r for r in json.loads(path.read_text(encoding="utf-8")) if Path(r).exists()]
        except (OSError, ValueError):
            return []

    def recent_info(self) -> list[dict]:
        """The recent folders and files with how far their work has got, for the start screen."""
        out = []
        for r in self.recent():
            path = Path(r)
            folder, only = (path.parent, path.name) if path.is_file() else (path, "")
            try:
                sources, _ = list_sources(folder, only)
                desk = decisions.load(folder, only)
            except Exception:  # a folder that no longer opens is simply not offered
                continue
            parts = [part for s in sources for n in range(1, s.pages + 1) for part in desk.page(page_key(s.id, n)).parts]
            out.append({"path": r, "name": only or folder.name, "file": bool(only), "inbox": self.in_inbox(folder),
                        "pages": sum(s.pages for s in sources), "parts": len(parts), "decided": sum(p.status != "todo" for p in parts),
                        "written": len(desk.written)})
        return out

    def in_inbox(self, folder: Path) -> bool:
        inbox = (intake.ROOT / INBOX).resolve()
        return inbox in folder.resolve().parents

    def upload(self, name: str, given: str, chunks) -> dict:
        """Save one dropped file (`chunks`: its bytes as they arrive) into data/inbox/<date time>/, or into
        the inbox folder given. `name` may carry folders ("Sem 5/MST 1.pdf"): a dropped folder keeps its
        layout, which the file names are read from. A .zip is unpacked: its PDFs and photos only."""
        parts = safe_parts(name)
        is_zip = bool(parts) and parts[-1].lower().endswith(".zip")
        if not parts or not (is_zip or is_source_name(parts[-1])):
            raise ValueError(f"{parts[-1] if parts else 'that'} is not a PDF, a photo (.jpg / .png / .webp) or a .zip of them")
        inbox = (intake.ROOT / INBOX).resolve()
        folder = Path(given).resolve() if given else inbox / time.strftime("%Y-%m-%d %H.%M.%S")
        if inbox not in folder.parents:
            raise ValueError("dropped files go into data/inbox/ only")
        made = not folder.exists()
        folder.mkdir(parents=True, exist_ok=True)
        target = None
        try:
            if is_zip:
                with tempfile.TemporaryFile() as tmp:
                    for data in chunks:
                        tmp.write(data)
                    tmp.seek(0)
                    return {"folder": str(folder), "file": parts[-1], "files": unzip(tmp, folder, parts[-1])}
            target = free_path(folder, parts)
            with open(target, "wb") as f:
                for data in chunks:
                    f.write(data)
            return {"folder": str(folder), "file": target.relative_to(folder).as_posix()}
        except Exception:  # nothing half-copied stays behind
            if target:
                target.unlink(missing_ok=True)
            if made:
                shutil.rmtree(folder, ignore_errors=True)
            raise

    def keys(self) -> list[str]:
        return [page_key(s.id, n) for s in self.sources for n in range(1, s.pages + 1)]

    def courses(self) -> list[dict]:
        return json.loads(intake.CATALOG.read_text(encoding="utf-8"))["courses"]

    def folder_info(self) -> dict:
        state = decisions.to_dict(self.desk)
        state.pop("written")
        state.pop("reads")
        return {
            "folder": str(self.folder / self.only) if self.only else str(self.folder), "name": self.only or self.folder.name,
            "only": self.only, "state_file": decisions.state_file(self.folder, self.only).name, "inbox": self.in_inbox(self.folder),
            "written": sorted(self.desk.written),
            "sources": [{"id": s.id, "kind": s.kind, "pages": s.pages} for s in self.sources], "broken": self.broken,
            "state": state, "reader": {"model": reader.model_name(), "problem": reader.problem()},
            "courses": [{"id": c["id"], "name": c["name"], "school": c["school"], "semesters": c["years"] * 2} for c in self.courses()],
            "kinds": [{"id": k, "name": export.KIND_NAMES[k]} for k in EXAM_KINDS],
            "skip_reasons": list(decisions.SKIP_REASONS), "held_reasons": list(decisions.HELD_REASONS),
        }

    def save_state(self, d: dict) -> None:
        with self.lock:
            # The page never changes `written` (what the desk wrote) or `reads` (what the model read).
            desk = decisions.from_dict({**d, "written": self.desk.written, "reads": self.desk.reads})
            decisions.save(self.folder, desk, self.only)
            self.desk = desk

    def manifest_info(self, course: str, sem: int) -> dict:
        c = intake.find_course(course, sem)
        path = intake.manifest_path(c, sem)
        rel = path.relative_to(intake.ROOT).as_posix()
        m = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
        mine = self.desk.written.get(rel, {})
        subjects = [s for s in m.get("subjects") or [] if "TODO" not in str(s.get("id")) and s.get("id") not in mine.get("subjects", [])]
        exams = [{"id": str(e.get("id")), "name": e.get("name"), "date": None if e.get("date") is None else str(e.get("date")), "session": export._session(e)}
                 for e in m.get("exams") or [] if "TODO" not in str(e.values()) and e.get("id") not in mine.get("exams", [])]
        papers = [{"subject": p.get("subject"), "exam": f.get("exam"), "file": f.get("file"), "page": p.get("page")}
                  for f in m.get("files") or [] if f.get("file") not in mine.get("files", []) for p in f.get("pages") or []]
        return {"manifest": rel, "exists": path.exists(), "subjects": subjects, "exams": exams, "papers": papers}

    # ------------------------------------------------------------ pictures

    def check(self, src: str, page: int) -> None:
        if not any(s.id == src and 1 <= page <= s.pages for s in self.sources):
            raise KeyError(f"no page {page} in {src}")

    def preview(self, src: str, page: int) -> Image.Image:
        """The page as the editor shows it (PREVIEW_SIDE px)."""
        self.check(src, page)
        key = (src, page)
        with self.lock:
            if key in self.previews:
                self.previews.move_to_end(key)
                return self.previews[key]
        img = load_page(self.folder, src, page, PREVIEW_SIDE)
        with self.lock:
            self.previews[key] = img
            while len(self.previews) > 12:
                self.previews.popitem(last=False)
        return img

    @staticmethod
    def small_file(folder: Path, src: str, page: int) -> Path:
        path = (folder / src).resolve()
        name = hashlib.sha1(f"{path.as_posix()}|{stamp(path)}|{page}|{SMALL_SIDE}".encode()).hexdigest()
        return intake.ROOT / THUMBS / f"{name}.jpg"

    @staticmethod
    def keep_small(file: Path, img: Image.Image) -> bytes:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        file.parent.mkdir(parents=True, exist_ok=True)
        tmp = file.with_suffix(f".{threading.get_ident()}.tmp")
        tmp.write_bytes(buf.getvalue())
        try:
            tmp.replace(file)
        except OSError:  # Windows: a card is reading this picture, or made it, at this very moment; it is the same one
            tmp.unlink(missing_ok=True)
        return buf.getvalue()

    def small(self, src: str, page: int) -> Image.Image:
        """The page SMALL_SIDE px on its longest side, which the small cards are cut from: several times
        quicker to make than the editor's picture, and kept in data/work/desk/thumbs/ (by the file's
        size and time), so a folder opened again shows its cards at once."""
        self.check(src, page)
        key = (src, page)
        with self.lock:
            data, folder = self.smalls.get(key), self.folder
        if data is None:
            file = self.small_file(folder, src, page)
            try:
                data = file.read_bytes()
            except OSError:
                data = self.keep_small(file, load_page(folder, src, page, SMALL_SIDE))
            with self.lock:
                if folder == self.folder:
                    self.smalls[key] = data
        return Image.open(io.BytesIO(data)).convert("RGB")

    def warm(self, gen: int) -> None:
        """Make the small pictures that are missing, one file after another, so the cards do not wait."""
        with self.lock:
            folder, sources = self.folder, list(self.sources)
        for s in sources:
            files = [self.small_file(folder, s.id, n) for n in range(1, s.pages + 1)]
            if all(f.exists() for f in files):
                continue
            try:
                for file, img in zip(files, load_pages(folder, s.id, SMALL_SIDE)):
                    if gen != self.gen:
                        return
                    if not file.exists():
                        self.keep_small(file, img)
            except Exception as e:  # a page that will not render shows as a broken card; the desk works on
                print(f"small pictures of {s.id} failed: {type(e).__name__}: {e}", flush=True)

    # ------------------------------------------------------------ reading pages (model) and picture matches

    def background(self, gen: int) -> None:
        """After a folder opens: the picture matches first (the suggestions wait for them), then the small pictures."""
        self.find_dupes(gen)
        self.warm(gen)

    def find_dupes(self, gen: int) -> None:
        with self.lock:
            folder, sources = self.folder, list(self.sources)
            mine = {((intake.ROOT / rel).parent / f).resolve() for rel, w in self.desk.written.items() for f in w["files"]}
        try:
            found = dupes.find(folder, sources, mine)
        except Exception as e:  # the desk works on without them
            print(f"picture matches failed: {type(e).__name__}: {e}", flush=True)
            found = {}
        with self.lock:
            if gen == self.gen:
                self.dupes, self.dupes_ready = found, True

    def start_reading(self, keys: list[str] | None) -> dict:
        """Queue pages for the model: the given ones (read again), or every undecided page that has no
        good reading yet and is not a copy of another page."""
        if reader.problem():
            raise ValueError(f"cannot read pages: {reader.problem()}")
        prov = reader.provider()
        with self.lock:
            if keys is None:
                keys = [k for k in self.keys() if all(p.status == "todo" for p in self.desk.page(k).parts)
                        and (k not in self.desk.reads or self.desk.reads[k].get("error")) and k not in self.dupes]
            else:
                known = set(self.keys())
                keys = [k for k in keys if k in known]
            gen = self.gen
            if self.reader is None:
                self.reader = reader.Reader(lambda key: self.read_one(gen, key, prov), lambda key, r: self.store(gen, key, r))
            r = self.reader
        return {"queued": r.add(keys), "model": prov.model}

    def read_one(self, gen: int, key: str, prov) -> dict:
        with self.lock:
            if gen != self.gen:
                return {"error": "another folder was opened"}
            folder, pg = self.folder, copy.deepcopy(self.desk.page(key))
        src, n = key.rsplit("#", 1)
        return reader.read_page(folder, src, int(n), pg, prov)

    def store(self, gen: int, key: str, reading: dict) -> None:
        with self.lock:
            if gen != self.gen:
                return
            self.desk.reads[key] = reading
            decisions.save(self.folder, self.desk, self.only)

    def subjects_for(self, course: str, sem: int) -> list[dict]:
        try:
            subs = self.manifest_info(course, sem)["subjects"]
        except ValueError:
            subs = []
        return subs + self.desk.subjects.get(f"{course}/{sem}", [])

    def read_status(self) -> dict:
        with self.lock:
            status = self.reader.status() if self.reader else {"running": False, "total": 0, "done": 0, "failed": 0, "reading": [], "stopped": ""}
            cache: dict = {}

            def subjects_for(c: str, sem: int) -> list[dict]:
                if (c, sem) not in cache:
                    cache[(c, sem)] = self.subjects_for(c, sem)
                return cache[(c, sem)]

            sugs = suggest.suggestions(self.desk, self.keys(), self.courses(), subjects_for, self.dupes)
            return {**status, "dupes_ready": self.dupes_ready, "suggestions": sugs}


def make_handler(app: App, port: int):
    hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # quiet: the terminal shows only errors
            pass

        def send(self, code: int, body: bytes, ctype: str, cache: bool = False) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "max-age=3600" if cache else "no-store")
            self.end_headers()
            self.wfile.write(body)

        def json(self, data, code: int = 200) -> None:
            self.send(code, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

        def jpeg(self, img: Image.Image) -> None:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=82)
            self.send(200, buf.getvalue(), "image/jpeg", cache=True)

        def allowed(self) -> bool:
            """Only this page may use the API: no other site in the browser, no DNS rebinding."""
            if self.headers.get("Host") not in hosts:
                return False
            origin = self.headers.get("Origin")
            if origin and origin.split("//", 1)[-1] not in hosts:
                return False
            kind = self.headers.get("Content-Type", "")
            # A dropped file comes as its own bytes. Like JSON, that type cannot be sent from another site's page.
            return self.command == "GET" or kind.startswith("application/json") or (self.streamed and kind.startswith("application/octet-stream"))

        def body(self) -> dict:
            return json.loads(self.raw or b"{}")

        def chunks(self):
            """The request body as it arrives (a dropped file is written to disk, not held in memory)."""
            while self.left:
                data = self.rfile.read(min(self.left, 1 << 20))
                if not data:
                    raise ValueError("the upload was cut off")
                self.left -= len(data)
                yield data

        def drain(self) -> None:
            for _ in self.chunks():
                pass

        def drain_quietly(self) -> None:
            try:
                self.drain()
            except ValueError:  # the upload was cut off: there is nothing left to read
                self.left = 0

        def do_GET(self):
            self.handle_any()

        def do_POST(self):
            self.handle_any()

        def do_PUT(self):
            self.handle_any()

        def handle_any(self):
            url = urlparse(self.path)
            self.left = int(self.headers.get("Content-Length") or 0)  # bytes of the body not read yet
            self.streamed = (self.command, url.path) == ("POST", "/api/upload")
            try:
                # Always read the body, before answering: closing on unread data resets the connection.
                self.raw = b"" if self.streamed else b"".join(self.chunks())
                if not self.allowed():
                    self.drain()
                    return self.json({"error": "not allowed"}, 403)
                app.seen = time.time()
                q = {k: v[0] for k, v in parse_qs(url.query).items()}
                self.route(url.path, q)
            except (ValueError, KeyError) as e:
                self.drain_quietly()
                self.json({"error": str(e).strip("'\"")}, 400)
            except Exception as e:  # show it on the page instead of a dead request
                self.drain_quietly()
                self.json({"error": f"{type(e).__name__}: {e}"}, 500)
                raise

        def route(self, path: str, q: dict) -> None:
            m = (self.command, path)
            if m == ("GET", "/"):
                return self.send(200, page(), "text/html; charset=utf-8")
            if self.command == "GET" and path.startswith("/fonts/") and path[7:] in FONTS:
                f = intake.ROOT / "web" / "src" / "app" / "fonts" / path[7:]
                return self.send(200, f.read_bytes(), "font/woff2", cache=True) if f.exists() else self.json({"error": "no font"}, 404)
            if m == ("GET", "/api/ping"):
                return self.json({"busy": app.busy()})
            if m == ("GET", "/api/start"):
                return self.json({"root": str(intake.ROOT), "folder": str(app.folder) if app.folder else None, "recent": app.recent_info(),
                                  "home": str(Path.home()), "inbox": str(intake.ROOT / INBOX)})
            if m == ("POST", "/api/upload"):
                if not self.headers.get("Content-Type", "").startswith("application/octet-stream"):
                    raise ValueError("a dropped file is sent as its own bytes (application/octet-stream)")
                return self.json(app.upload(q.get("name", ""), q.get("folder", ""), self.chunks()))
            if m == ("POST", "/api/quit"):
                if app.run and app.run.code is None:
                    app.run.proc.terminate()
                if app.reader:
                    app.reader.stop("the desk was closed")
                self.json({"closed": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if m == ("GET", "/api/browse"):
                return self.json(browse(q.get("path", "")))
            if m == ("POST", "/api/open"):
                app.open(Path(self.body()["folder"].strip().strip('"')).expanduser())
                return self.json(app.folder_info())
            if app.folder is None:
                raise ValueError("open a folder first")
            if m == ("GET", "/api/folder"):
                return self.json(app.folder_info())
            if m == ("GET", "/api/manifest"):
                return self.json(app.manifest_info(q["course"], int(q["sem"])))
            if m == ("GET", "/api/image"):
                return self.jpeg(app.preview(q["src"], int(q["page"])))
            if m == ("GET", "/api/thumb"):
                w = int(q.get("w", 240))
                img = (app.small if 2 * w <= SMALL_SIDE else app.preview)(q["src"], int(q["page"]))
                boxes = [[float(x) for x in b.split(",")] for b in q.get("boxes", "").split(";") if b]
                out = render_part(img, boxes, int(q.get("rot", 0)), q.get("split", ""), float(q.get("at", 0.5)), int(q.get("part", 0)), int(q.get("prot", 0)))
                out.thumbnail((w, w * 3))
                return self.jpeg(out)
            if m == ("PUT", "/api/state"):
                app.save_state(self.body())
                return self.json({"saved": time.strftime("%H:%M:%S")})
            if m == ("GET", "/api/read"):
                return self.json(app.read_status())
            if m == ("POST", "/api/read"):
                return self.json(app.start_reading(self.body().get("pages")))
            if m == ("POST", "/api/read/stop"):
                if app.reader:
                    app.reader.stop("stopped")
                return self.json(app.read_status())
            if m == ("POST", "/api/plan"):
                with app.lock:
                    return self.json(export.summary(export.make_plan(app.folder, app.desk, app.sources, app.only)))
            if m == ("POST", "/api/write"):
                with app.lock:
                    plan, results = export.write(app.folder, app.desk, app.sources, log=lambda s: print(s, flush=True), only=app.only)
                return self.json({"plan": export.summary(plan), "results": results, "written": sorted(app.desk.written)})
            if m == ("POST", "/api/run"):
                rel = self.body()["manifest"]
                if not (intake.ROOT / rel).is_file() or not rel.startswith("data/raw/"):
                    raise ValueError(f"no manifest {rel}")
                if app.run and app.run.code is None:
                    raise ValueError(f"the pipeline is still running on {app.run.manifest}")
                app.run = Run(rel)
                return self.json({"started": rel})
            if m == ("GET", "/api/run"):
                r = app.run
                if r is None:
                    return self.json({"lines": [], "next": 0, "done": True, "code": None})
                start = int(q.get("from", 0))
                lines = r.lines[start:]
                done = r.code is not None
                return self.json({"manifest": r.manifest, "lines": lines, "next": start + len(lines), "done": done, "code": r.code,
                                  "report": r.report() if done else None})
            self.json({"error": f"no {self.command} {path}"}, 404)

    return Handler


def browse(path: str) -> dict:
    """Folders and source files inside `path` (the drives, on Windows, when it is empty)."""
    if not path:
        if os.name == "nt":
            drives = [f"{d}:\\" for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
            return {"path": "", "parent": None, "dirs": [{"name": d, "path": d} for d in drives], "files": [], "here": 0}
        path = "/"
    p = Path(path).expanduser()
    if not p.is_dir():
        raise ValueError(f"{path} is not a folder")
    dirs, files = [], []
    try:
        for d in sorted(p.iterdir(), key=lambda d: d.name.lower()):
            if d.is_dir() and not d.name.startswith((".", "$")):
                dirs.append({"name": d.name, "path": str(d)})
            elif is_source(d):
                files.append({"name": d.name, "path": str(d)})
    except PermissionError:
        pass
    parent = str(p.parent) if p.parent != p else ("" if os.name == "nt" else None)
    return {"path": str(p), "parent": parent, "dirs": dirs, "files": files, "here": len(files)}


def running_desk() -> int | None:
    """The port this repository's desk already runs on, if one does. (Double-clicking the launcher
    twice then opens the same desk instead of starting a second one.)"""
    try:
        p = int(json.loads((intake.ROOT / RUNNING).read_text(encoding="utf-8"))["port"])
        c = http.client.HTTPConnection("127.0.0.1", p, timeout=2)
        c.request("GET", "/api/start", headers={"Host": f"127.0.0.1:{p}"})
        r = c.getresponse()
        return p if r.status == 200 and json.loads(r.read()).get("root") == str(intake.ROOT) else None
    except (OSError, ValueError, KeyError, TypeError):  # none written, or left by a desk that is gone
        return None


def serve(folder: Path | None, port: int, open_browser: bool, idle: float = IDLE) -> None:
    if (p := running_desk()) is not None:
        url = f"http://127.0.0.1:{p}/"
        if folder:
            c = http.client.HTTPConnection("127.0.0.1", p, timeout=60)
            c.request("POST", "/api/open", body=json.dumps({"folder": str(folder.resolve())}),
                      headers={"Host": f"127.0.0.1:{p}", "Content-Type": "application/json"})
            c.getresponse().read()
        print(f"The intake desk is already running: {url}", flush=True)
        if open_browser:
            import webbrowser
            webbrowser.open(url)
        return
    prune_thumbs()
    app = App()
    if folder:
        try:
            app.open(folder)
        except ValueError as e:
            sys.exit(f"error: {e}")
    for p in range(port, port + PORTS):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", p), make_handler(app, p))
            break
        except OSError:
            continue
    else:
        sys.exit(f"error: ports {port} to {port + PORTS - 1} are all busy")
    url = f"http://127.0.0.1:{p}/"
    print(f"Intake desk: {url}  (Ctrl+C to stop)", flush=True)
    if folder:
        print(f"  {'file' if app.only else 'folder'}: {app.folder / app.only if app.only else app.folder} ({sum(s.pages for s in app.sources)} pages in {len(app.sources)} files)")
    can = reader.problem()
    print(f"  Read pages: {reader.model_name() or '-'}" + (f" (cannot read yet: {can})" if can else " (only when you press the button; answers cached in data/work/cache)"))
    if open_browser:
        import webbrowser
        webbrowser.open(url)

    def watch() -> None:  # stop when the page has been closed for a while and nothing is running
        last = time.time()
        while True:
            time.sleep(min(30, idle / 3))
            if time.time() - last > 120:  # the laptop slept: give the open page time to call again
                app.seen = time.time()
            last = time.time()
            if time.time() - app.seen > idle and not app.busy():
                print(f"no page open for {idle / 60:.0f} minutes: stopping", flush=True)
                server.shutdown()
                return

    threading.Thread(target=watch, daemon=True).start()
    running = intake.ROOT / RUNNING
    running.parent.mkdir(parents=True, exist_ok=True)
    running.write_text(json.dumps({"port": p}), encoding="utf-8")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        running.unlink(missing_ok=True)
    print("stopped", flush=True)
