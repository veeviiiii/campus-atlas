"""The desk's web page and its JSON API, on 127.0.0.1 only (Python's http.server, no framework).

One folder of sources (or one file) is open at a time. The page holds the decisions and sends them
after every change (PUT /api/state); everything that reads or writes files happens here, and so do
the model readings ("Read pages", in the background) and the picture matches.
"""

import copy
import io
import json
import os
import string
import subprocess
import sys
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yaml
from PIL import Image

from pipeline import intake
from pipeline.desk import decisions, dupes, export, reader, suggest
from pipeline.desk.geometry import render_part
from pipeline.desk.sources import PREVIEW_SIDE, is_source, list_sources, load_page, page_key
from pipeline.manifest import EXAM_KINDS

STATIC = Path(__file__).resolve().parent / "static"
RECENT = "data/work/desk/recent.json"  # folders and files opened before, newest first
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}


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
                                     text=True, encoding="utf-8", errors="replace", bufsize=1)
        threading.Thread(target=self._drain, daemon=True).start()

    def _drain(self) -> None:
        for line in self.proc.stdout:
            self.lines.append(line.rstrip("\n"))
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
        self.previews: OrderedDict = OrderedDict()  # (src, page) -> preview image
        self.run: Run | None = None
        self.gen = 0  # which open this is: readings that finish after another open are dropped
        self.reader: reader.Reader | None = None
        self.dupes: dict[str, dict] = {}
        self.dupes_ready = False

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
            self.reader, self.dupes, self.dupes_ready = None, {}, False
        threading.Thread(target=self.find_dupes, args=(self.gen,), daemon=True).start()
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
            "only": self.only, "state_file": decisions.state_file(self.folder, self.only).name,
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
        exams = [{"id": str(e.get("id")), "name": e.get("name"), "date": str(e.get("date")), "session": export._session(e)}
                 for e in m.get("exams") or [] if "TODO" not in str(e.values()) and e.get("id") not in mine.get("exams", [])]
        papers = [{"subject": p.get("subject"), "exam": f.get("exam"), "file": f.get("file"), "page": p.get("page")}
                  for f in m.get("files") or [] if f.get("file") not in mine.get("files", []) for p in f.get("pages") or []]
        return {"manifest": rel, "exists": path.exists(), "subjects": subjects, "exams": exams, "papers": papers}

    # ------------------------------------------------------------ pictures

    def preview(self, src: str, page: int) -> Image.Image:
        if not any(s.id == src and 1 <= page <= s.pages for s in self.sources):
            raise KeyError(f"no page {page} in {src}")
        key = (src, page)
        with self.lock:
            if key in self.previews:
                self.previews.move_to_end(key)
                return self.previews[key]
        img = load_page(self.folder, src, page, PREVIEW_SIDE)
        with self.lock:
            self.previews[key] = img
            while len(self.previews) > 60:
                self.previews.popitem(last=False)
        return img

    # ------------------------------------------------------------ reading pages (model) and picture matches

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
            return self.command == "GET" or self.headers.get("Content-Type", "").startswith("application/json")

        def body(self) -> dict:
            return json.loads(self.raw or b"{}")

        def do_GET(self):
            self.handle_any()

        def do_POST(self):
            self.handle_any()

        def do_PUT(self):
            self.handle_any()

        def handle_any(self):
            self.raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))  # always read it: closing on unread data resets the connection
            if not self.allowed():
                return self.json({"error": "not allowed"}, 403)
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                self.route(url.path, q)
            except (ValueError, KeyError) as e:
                self.json({"error": str(e).strip("'\"")}, 400)
            except Exception as e:  # show it on the page instead of a dead request
                self.json({"error": f"{type(e).__name__}: {e}"}, 500)
                raise

        def route(self, path: str, q: dict) -> None:
            m = (self.command, path)
            if self.command == "GET" and path in ("/", "/desk.js", "/desk.css"):
                f = STATIC / ("desk.html" if path == "/" else path[1:])
                return self.send(200, f.read_bytes(), TYPES[f.suffix])
            if m == ("GET", "/api/start"):
                return self.json({"root": str(intake.ROOT), "folder": str(app.folder) if app.folder else None, "recent": app.recent(), "home": str(Path.home())})
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
                img = app.preview(q["src"], int(q["page"]))
                boxes = [[float(x) for x in b.split(",")] for b in q.get("boxes", "").split(";") if b]
                out = render_part(img, boxes, int(q.get("rot", 0)), q.get("split", ""), float(q.get("at", 0.5)), int(q.get("part", 0)), int(q.get("prot", 0)))
                w = int(q.get("w", 240))
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
                return self.json({"plan": export.summary(plan), "results": results})
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


def serve(folder: Path | None, port: int, open_browser: bool) -> None:
    app = App()
    if folder:
        try:
            app.open(folder)
        except ValueError as e:
            sys.exit(f"error: {e}")
    for p in range(port, port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", p), make_handler(app, p))
            break
        except OSError:
            continue
    else:
        sys.exit(f"error: ports {port} to {port + 19} are all busy")
    url = f"http://127.0.0.1:{p}/"
    print(f"Intake desk: {url}  (Ctrl+C to stop)", flush=True)
    if folder:
        print(f"  {'file' if app.only else 'folder'}: {app.folder / app.only if app.only else app.folder} ({sum(s.pages for s in app.sources)} pages in {len(app.sources)} files)")
    can = reader.problem()
    print(f"  Read pages: {reader.model_name() or '-'}" + (f" (cannot read yet: {can})" if can else " (only when you press the button; answers cached in data/work/cache)"))
    if open_browser:
        import webbrowser
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("stopped")
