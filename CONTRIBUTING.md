# Add your college

Not a developer? Just photograph your papers and upload them on the
[Send us your papers](https://campus-atlas.vercel.app/send/) page; we do the rest. This guide is for
building a pack yourself. The maintainer's step-by-step for publishing form uploads is
[ADDING-PAPERS.md](ADDING-PAPERS.md); its `pipeline.intake` helper works for you too.

Campus Atlas grows one college at a time, by pull request. You need your course's past exam
papers and about an hour. Everything runs on an open-weight model: Gemma 4 through the Gemini API,
or fully locally through Ollama.

## 1. Collect the papers

- Scans or phone photos of the mid-semester tests and the end-semester exam, one PDF per exam is fine.
- The syllabus too, if you have it (optional; it is only used to name units).
- Only question papers. No answer sheets, names or roll numbers.

Put them in `data/raw/<college-id>/<course-id>/sem<N>/`.

## 2. Write the manifest

`manifest.yaml` in the same folder says which page is which subject and exam. Format and example:
[skills/pyq-atlas/references/manifest.md](skills/pyq-atlas/references/manifest.md).
Use your college's real coordinates (for example from OpenStreetMap).

## 3. Run the skill

The `pyq-atlas` Agent Skill ([skills/pyq-atlas/SKILL.md](skills/pyq-atlas/SKILL.md)) works in any
skills-compatible agent, or by hand:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r pipeline/requirements.txt      # macOS/Linux: .venv/bin/python
cp .env.example .env                                                   # then set your model provider
.venv/Scripts/python skills/pyq-atlas/scripts/run_pipeline.py --manifest data/raw/<college>/<course>/sem<N>/manifest.yaml --all
```

## 4. Check the result

- Read `runs/<timestamp>/report.md`: dropped bleed-through, unsure items, disagreements with your manifest.
- Open the website locally (`cd web && npm install && npm run dev`) and check your course and subject pages.
- AI extraction can be wrong. Spot-check a few questions against the original pages.

## 5. Open a pull request

Include:
- `data/raw/<college>/<course>/sem<N>/manifest.yaml` (the PDFs stay local and are gitignored; the page photos in `packs/<college>/pages/` are the public record)
- `packs/<college>/<course>-sem<N>.json` and `packs/<college>/pages/`
- the run report (`runs/<timestamp>/report.md`) pasted into the PR description

## Code contributions

Small, focused pull requests are welcome. Run `npm run check` in `web/` before pushing.
All contributions are under the Apache-2.0 license.
