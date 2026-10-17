"""Run report: everything the harness did, so nothing is silently dropped.

Writes runs/<timestamp>/report.md (for people) and report.json (for the eval / pack builder).
"""

import json
import threading
from dataclasses import dataclass, field, fields
from datetime import datetime
from pathlib import Path

from pipeline.providers import CALLS, get_provider


@dataclass
class RunReport:
    subjects: list[str]
    started: str = field(default_factory=lambda: datetime.now().strftime("%Y%m%d-%H%M%S"))
    pages: list[dict] = field(default_factory=list)
    disagreements: list[dict] = field(default_factory=list)
    dropped: list[dict] = field(default_factory=list)
    unsure: list[dict] = field(default_factory=list)
    retries: list[dict] = field(default_factory=list)
    papers: list[dict] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add(self, kind: str, **item) -> None:
        with self._lock:
            getattr(self, kind).append(item)

    def write(self, root: Path) -> Path:
        run_dir = root / "runs" / self.started
        run_dir.mkdir(parents=True, exist_ok=True)
        p = get_provider()
        calls = CALLS.summary()
        for kind in ("pages", "disagreements", "dropped", "unsure", "retries", "papers"):
            getattr(self, kind).sort(key=lambda x: str(x.get("page_ref", "")))
        n_questions = sum(x["questions"] for x in self.papers)

        data = {f.name: getattr(self, f.name) for f in fields(self) if not f.name.startswith("_")}
        data["model"] = {"provider": p.name, "model": p.model}
        data["calls"] = calls
        (run_dir / "report.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

        L = [f"# Run report {self.started}", ""]
        L += [f"- Model: `{p.model}` via `{p.name}`", f"- Subjects: {', '.join(self.subjects)}", ""]
        L += ["## Summary", "", "| Pages | Papers | Questions kept | Dropped (bleed-through) | Unsure | Retries | Model calls (live / cached / failed) |", "|---|---|---|---|---|---|---|"]
        L += [f"| {len(self.pages)} | {len(self.papers)} | {n_questions} | {len(self.dropped)} | {len(self.unsure)} | {len(self.retries)} | {calls['live_calls']} / {calls['cached_calls']} / {calls['failed_calls']} |", ""]

        L += ["## AI vs manifest disagreements", ""]
        if self.disagreements:
            L += ["The manifest (human ground truth) wins in every case below.", "", "| Page | Field | AI read | Manifest |", "|---|---|---|---|"]
            L += [f"| {d['page_ref']} | {d['field']} | {d['ai']} | {d['manifest']} |" for d in self.disagreements]
        else:
            L += ["None."]
        L += ["", "## Dropped as bleed-through", ""]
        if self.dropped:
            L += ["| Page | Text | Likely subject | Reason |", "|---|---|---|---|"]
            L += [f"| {d['page_ref']} | {_cell(d['text'])} | {d.get('likely_subject') or ''} | {_cell(d.get('reason', ''))} |" for d in self.dropped]
        else:
            L += ["None."]
        L += ["", "## Unsure", ""]
        if self.unsure:
            L += ["| Page | Step | Problem | Raw |", "|---|---|---|---|"]
            L += [f"| {u['page_ref']} | {u['step']} | {_cell(u['error'])} | {_cell(str(u.get('raw', '')))} |" for u in self.unsure]
        else:
            L += ["None."]
        L += ["", "## Retries", ""]
        if self.retries:
            L += ["| Page | Step | First error | Fixed by retry |", "|---|---|---|---|"]
            L += [f"| {r['page_ref']} | {r['step']} | {_cell(r['error'])} | {'yes' if r['fixed'] else 'no'} |" for r in self.retries]
        else:
            L += ["None."]
        L += ["", "## Pages", "", "| Page | Rotation applied | Header subject | Header exam |", "|---|---|---|---|"]
        L += [f"| {pg['page_ref']} | {pg['rotation']} | {pg.get('header_subject') or ''} | {pg.get('header_exam') or ''} |" for pg in self.pages]
        L += ["", "## Papers", "", "| Paper | Subject | Exam | Questions kept |", "|---|---|---|---|"]
        L += [f"| {x['page_ref']} | {x['subject']} | {x['exam']} | {x['questions']} |" for x in self.papers]
        L += ["", f"Model time: {calls['live_seconds']} s over {calls['live_calls']} live calls."]
        (run_dir / "report.md").write_text("\n".join(L) + "\n", encoding="utf-8")
        return run_dir


def _cell(s: str, n: int = 140) -> str:
    s = " ".join(str(s).split()).replace("|", "\\|")
    return s if len(s) <= n else s[: n - 1] + "…"
