"""The desk's web page and its JSON API, on 127.0.0.1 only (Python's http.server, no framework).

One folder of sources is open at a time. The page holds the decisions and sends them after every
change (PUT /api/state); everything that reads or writes files happens here.
"""

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
from pipeline.desk import decisions, export
from pipeline.desk.geometry import render_part
from pipeline.desk.sources import PREVIEW_SIDE, list_sources, load_page, page_key
from pipeline.manifest import EXAM_KINDS

STATIC = Path(__file__).resolve().parent / "static"
RECENT = "data/work/desk/recent.json"  # folders opened before, newest first
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
    def __init__(self, suggest: bool = False):
        self.suggest = suggest
        self.lock = threading.RLock()
        self.folder: Path | None = None
        self.sources = []
        self.broken: list[str] = []
        self.desk = decisions.Desk()
        self.previews: OrderedDict = OrderedDict()  # (src, page) -> preview image
        self.run: Run | None = None

    # ------------------------------------------------------------ folder and state

    def open(self, folder: Path) -> None:
        if not folder.is_dir():
            raise ValueError(f"{folder} is not a folder")
        sources, broken = list_sources(folder)
        if not sources:
            raise ValueError(f"no PDFs or photos (.jpg / .png / .webp) in {folder}")
        desk = decisions.load(folder)
        with self.lock:
            self.folder, self.sources, self.broken, self.desk = folder.resolve(), sources, broken, desk
            self.previews.clear()
        recent = self.recent()
        path = intake.ROOT / RECENT
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([str(self.folder)] + [r for r in recent if r != str(self.folder)][:7], indent=1), encoding="utf-8")

    def recent(self) -> list[str]:
        path = intake.ROOT / RECENT
        try:
            return [r for r in json.loads(path.read_text(encoding="utf-8")) if Path(r).is_dir()]
        except (OSError, ValueError):
            return []

    def folder_info(self) -> dict:
        catalog = json.loads(intake.CATALOG.read_text(encoding="utf-8"))
        state = decisions.to_dict(self.desk)
        state.pop("written")
        return {
            "folder": str(self.folder), "name": self.folder.name,
            "sources": [{"id": s.id, "kind": s.kind, "pages": s.pages} for s in self.sources], "broken": self.broken,
            "state": state, "suggest": self.suggest,
            "courses": [{"id": c["id"], "name": c["name"], "school": c["school"], "semesters": c["years"] * 2} for c in catalog["courses"]],
            "kinds": [{"id": k, "name": export.KIND_NAMES[k]} for k in EXAM_KINDS],
            "skip_reasons": list(decisions.SKIP_REASONS), "held_reasons": list(decisions.HELD_REASONS),
        }

    def save_state(self, d: dict) -> None:
        with self.lock:
            desk = decisions.from_dict({**d, "written": self.desk.written})  # the page never changes `written`
            decisions.save(self.folder, desk)
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

    # ------------------------------------------------------------ model suggestion (optional)

    def suggest_header(self, body: dict) -> dict:
        """Read one part's printed header with the pipeline's header step. Cached in data/work/cache;
        only a suggestion: the page shows it and the maintainer decides."""
        from pipeline.extract import HEADER_PROMPT
        from pipeline.manifest import match_exam, match_subject
        from pipeline.providers import get_provider
        from pipeline.validate import Header, ask

        pg, part = self.desk.page(page_key(body["src"], int(body["page"]))), int(body.get("part", 0))
        img = render_part(load_page(self.folder, body["src"], int(body["page"])), pg.boxes, pg.rotation, pg.split, pg.at, part, pg.parts[part].rotation)
        try:
            res, err, _ = ask(get_provider(), HEADER_PROMPT, [img], Header, "header")
        except Exception as e:  # no .env, no key, no network: the desk works on without it
            return {"error": f"{type(e).__name__}: {e}"}
        if res is None:
            return {"error": err or "no answer"}
        out = {"header": res.model_dump(), "kind": match_exam(res.exam_title), "subject": None}
        if body.get("course") and body.get("semester"):
            info = self.manifest_info(body["course"], int(body["semester"]))
            subs = info["subjects"] + self.desk.subjects.get(f"{body['course']}/{body['semester']}", [])
            out["subject"] = match_subject({"subjects": subs}, res.subject_name) if subs else None
        return out


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
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}")

        def do_GET(self):
            self.handle_any()

        def do_POST(self):
            self.handle_any()

        def do_PUT(self):
            self.handle_any()

        def handle_any(self):
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
                app.open(Path(self.body()["folder"]).expanduser())
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
            if m == ("POST", "/api/plan"):
                with app.lock:
                    return self.json(export.summary(export.make_plan(app.folder, app.desk, app.sources)))
            if m == ("POST", "/api/write"):
                with app.lock:
                    plan, results = export.write(app.folder, app.desk, app.sources, log=lambda s: print(s, flush=True))
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
            if m == ("POST", "/api/suggest") and app.suggest:
                return self.json(app.suggest_header(self.body()))
            self.json({"error": f"no {self.command} {path}"}, 404)

    return Handler


def browse(path: str) -> dict:
    """Folders inside `path` (the drives, on Windows, when it is empty), with how many sources each holds."""
    if not path:
        if os.name == "nt":
            drives = [f"{d}:\\" for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
            return {"path": "", "parent": None, "dirs": [{"name": d, "path": d} for d in drives], "here": 0}
        path = "/"
    p = Path(path).expanduser()
    if not p.is_dir():
        raise ValueError(f"{path} is not a folder")
    dirs = []
    try:
        for d in sorted(p.iterdir(), key=lambda d: d.name.lower()):
            if d.is_dir() and not d.name.startswith((".", "$")):
                dirs.append({"name": d.name, "path": str(d)})
    except PermissionError:
        pass
    here = sum(1 for f in p.iterdir() if f.is_file() and (f.suffix.lower() == ".pdf" or f.suffix.lower() in intake.PHOTOS))
    parent = str(p.parent) if p.parent != p else ("" if os.name == "nt" else None)
    return {"path": str(p), "parent": parent, "dirs": dirs, "here": here}


def serve(folder: Path | None, port: int, suggest: bool, open_browser: bool) -> None:
    app = App(suggest)
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
        print(f"  folder: {app.folder} ({sum(s.pages for s in app.sources)} pages in {len(app.sources)} files)")
    if suggest:
        print("  --suggest: the page can ask the model to read a header (cached in data/work/cache)")
    if open_browser:
        import webbrowser
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("stopped")
