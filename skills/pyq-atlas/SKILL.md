---
name: pyq-atlas
description: Turns past exam papers (scanned PDFs or phone photos) and an optional syllabus into a Campus Atlas college pack using an open-weight vision model (Gemma 4). Extracts every question, checks it, groups questions into units and topics, finds questions repeated across exams and flags blind spots. Use when someone wants to analyse previous-year question papers (PYQs) for a college course, find what their university repeats, or add their college to Campus Atlas.
license: Apache-2.0
compatibility: Needs Python 3.11+, a clone of the campus-atlas repository, and either a Gemini API key (to call Gemma 4) or any OpenAI-compatible endpoint serving an open-weight vision model, such as Ollama.
metadata:
  author: campus-atlas
  version: "1.1"
---

# pyq-atlas

Builds a **college pack** (one JSON file) from a college's past exam papers. The Campus Atlas
website reads only these packs, so running this skill is how a new college gets onto the map.

Every step runs through the **PYQ Trust Harness**: the model's output is validated, retried once
with the error, and anything it cannot verify goes to an "unsure" list. Nothing is silently dropped.

## When to use

- "Analyse these previous-year papers for my course."
- "Which questions does my university repeat from the mid-sems in the end-sem?"
- "Add my college to Campus Atlas."

## Inputs

1. A folder of exam papers: PDFs of scans or phone photos (one PDF per exam is fine).
2. A `manifest.yaml` in that folder saying which page is which subject and exam
   (format: [references/manifest.md](references/manifest.md)). The model also reads each page
   header; the manifest wins, and every disagreement is reported.
3. Optional: the syllabus. Without it, units and topics are built from the questions themselves.

## Steps

1. **Set up** (once), from the repository root:
   ```bash
   python -m venv .venv
   .venv/Scripts/python -m pip install -r pipeline/requirements.txt   # macOS/Linux: .venv/bin/python
   cp .env.example .env
   ```
   In `.env` set either `MODEL_PROVIDER=gemini` with `GEMINI_API_KEY` and `MODEL_ID` (a Gemma 4 id
   from the Google AI Studio model list), or `MODEL_PROVIDER=openai_compatible` with
   `OPENAI_BASE_URL` / `OPENAI_MODEL` (e.g. Ollama at `http://localhost:11434/v1`, `gemma4:e4b`).
2. **Put the papers** in `data/raw/<college-id>/<course-id>/sem<N>/` and write `manifest.yaml` there.
   Another year of the same course goes in the same folder and manifest (exam ids like `mst1-2024-25`),
   so one pack holds every year; the papers already there are answered from the cache.
3. **Try one subject first** and read its report:
   ```bash
   .venv/Scripts/python skills/pyq-atlas/scripts/run_pipeline.py --manifest data/raw/<college>/<course>/sem<N>/manifest.yaml --subjects <subject-id> --stage extract
   ```
   Compare the extracted questions in `data/work/<college-id>/<course-id>-sem<N>/extracted/<subject-id>.json` with the paper by eye.
4. **Run everything** (model answers are cached, so re-runs are cheap):
   ```bash
   .venv/Scripts/python skills/pyq-atlas/scripts/run_pipeline.py --manifest data/raw/<college>/<course>/sem<N>/manifest.yaml --all
   ```
5. **Check the run report** at `runs/<timestamp>/report.md`: questions kept, bleed-through dropped,
   unsure items, retries and AI-vs-manifest disagreements.
6. **Open a pull request** with the pack (`packs/<college-id>/<course-id>-sem<N>.json`), its
   `pages/` folder and the manifest.

## Outputs

- `packs/<college-id>/<course-id>-sem<N>.json`: the college pack. Schema: [references/pack-schema.md](references/pack-schema.md).
- `packs/<college-id>/pages/*.jpg`: page photos, so every question links to its original page.
- `runs/<timestamp>/report.md` and `report.json`: what the harness did.

## Common problems

- **Rotated or upside-down photos:** handled. The model reports the rotation and Pillow fixes it; set
  `rotation: 180` on a page in the manifest to override.
- **Bleed-through** (a fragment of another paper at the photo's edge): every bottom-of-page or cut-off
  question is checked against the photo and dropped if it is on a different sheet. Partly readable
  fragments go to "unsure". Both are listed in the report.
- **Unreliable course codes:** subjects are matched by name plus the manifest's alias table, never by code.
- **Old syllabus:** only ever a hint for naming units. The pack says which syllabus batch was used,
  and the website labels it as old.
- **API errors (500 / 503 / 504):** calls are retried with back-off and fall back to
  `FALLBACK_MODEL_ID` if set. A call that still fails goes to "unsure"; run again later and only the
  missing answers are requested.
- **Handwritten ticks and renumbering:** ignored. Questions are matched by text, never by number.
