# CAMPUS ATLAS — PRODUCT BRIEF (CLAUDE.md)

Same brief for every coding agent: AGENTS.md (Codex) mirrors this file. Change both together.

## 1. What we are building (one line)
Every past paper and the best notes for our university (DAVV, Indore), organised by subject, with
the topics most likely to come next. Mainly for freshers, useful to every year.

History: this started as a Hacktoberfest 2026 hackathon entry (3D planet, quizzes, fog of war,
"Exam tomorrow" arcs). It did not win, mostly because it did too many things to explain in one
sentence. We are now turning it into a simple, useful product. When in doubt, cut, don't add.

## 2. The product: three things, nothing else
1. **Past papers (PYQs).** Browse department -> course -> semester -> subject. Every paper shows its
   exam (MST-1, MST-2, End Sem), month and year, the questions as text (LaTeX for maths, tables as
   markdown) and a link to the original photo of each page.
2. **Likely topics.** Per subject, topics ranked by a transparent score, each with its reasons
   ("asked in 2 of 3 exams", "came back from MST-2 in the End Sem, word for word", "12 marks").
   Honesty rule: with fewer than 3 years of papers this is a frequency score, NOT machine learning,
   and the UI must say what it is based on. A learned model only once there are 3+ years, and only
   with a backtest (predict last year's End Sem from earlier years, publish the hit rate).
3. **Notes exchange (phase 3, not built yet).** Upload notes or request them, tagged by subject and
   topic. Topics are shared across departments, so a request reaches students in other departments
   who study the same subject. Requests + uploads + a "helpful" count. No chat, no feed, no DMs.

Small extras that come free from the data (later): marks by unit per subject; "same subject in
other departments" links; search across all questions.

CUT (do not bring back without asking): quizzes (incl. the Mentee quiz builder), "mark as studied" /
fog / progress, "Exam tomorrow" routes and arcs, the Constellation view, the study-space tabs, the
made-up demo dataset, the language picker (its Hindi was an unreviewed partial AI translation),
study sessions, the Earth globe, the 3D globe ("Map" tab). The planet look survives as the home-page
hero and as small spinning planets on the subject cards: decoration on a link, never a separate way
to navigate.

## 3. Build order
1. Simplify: remove the cut features; course page (subject cards with mini planets) and subject page
   (Papers, Likely topics). Static site. Done.
2. More papers: one pack holds every year of a course-semester (done: exam ids mst1/mst2/end for the
   first year added, <kind>-<session> such as mst1-2024-25 for every other year; year chips on the
   Papers tab); collect older papers from seniors. <- current
3. Community: sign-in, PYQ uploads into a review queue (an admin approves, then the pipeline runs),
   notes exchange. Until then, papers come in through a Google Form owned by the maintainer (link in
   web/src/lib/site.ts, shown on /send/); the maintainer runs the pipeline on the uploads. Planned stack: Supabase (Postgres + Storage + Auth) with the Next.js site on Vercel.
4. Backtested prediction once there are 3+ years.
Ask before starting a new phase. Ask before adding a backend, auth or any paid service.

## 4. Data we have
Path: data/raw/davv-sdsf/mtech-aids-dual/sem1/ — 3 PDFs of phone photos (MST-1 Oct 2025, MST-2 Dec
2025, End Sem Jan 2026) x 7 subjects = 21 papers, plus manifest.yaml (page -> subject/exam, human
ground truth). The PDFs stay local (gitignored); every page is public as a photo in
packs/<college>/pages/. No syllabus was used: units and topics are grouped bottom-up from the questions.
Known data problems the pipeline handles (keep it that way): unreliable course codes (match subjects
by name + alias table), name variants, bleed-through fragments of other papers (drop and log),
an upside-down page, handwritten ticks/renumbering (match by text, never by question number),
"Semester-III" misprint (manifest wins).
Old syllabus rule (if a syllabus is ever added): use it only as a hint for naming units, never present
it as current, label it "old syllabus".

## 5. Architecture
A. pipeline/ (Python 3.11, .venv): the PYQ Trust Harness. Raw PDFs + manifest -> one pack JSON.
   render (PyMuPDF) -> orient -> header (manifest overrides, disagreements logged) -> extract (strict
   JSON) -> validate (pydantic, retry once, else unsure list) -> bleed-through check -> group units and
   topics -> repeats (open embedding model all-MiniLM-L6-v2 + model judge) -> scoring -> pack + run
   report. Model: Gemma 4 (open weights) via the Gemini API, or any OpenAI-compatible endpoint
   (e.g. Ollama) — switch in .env. Every model answer is cached in data/work/cache, so re-runs are
   reproducible with no live calls. The quiz stage (build_pack --stage quiz) is legacy: the site no
   longer shows quizzes.
   Eval: `python -m pipeline.eval --write` checks 19 hand-found repeats
   (pipeline/eval/expected_repeats.json); current result 18 of 19, stored in the pack.
B. skills/pyq-atlas/: Agent Skill (agentskills.io standard) wrapping the pipeline, so any
   skills-compatible agent can add a course. Must keep passing `skills-ref validate`.
C. web/ (Next.js 16 App Router, static export, TypeScript, Tailwind v4, KaTeX; planets are 2D canvas, no 3D library).
   Reads ONLY pack JSON at build time; no AI calls at runtime. Fonts are bundled in
   web/src/app/fonts (works offline). This Next.js has breaking changes: read
   web/node_modules/next/dist/docs before using an API you are unsure of.
   Routes: / (home: hero, browse courses, how it works), /c/<college>/<pack>/ (course page),
   /c/<college>/<pack>/<subject>/ (subject page), /send/ (send us your papers). Deploy: Vercel, project Root Directory web (Next.js
   preset; the build reads ../packs). Live: https://campus-atlas.vercel.app
   Design: keep the current look (dark theme, lime/violet palette, Space Grotesk / Inter / Plex Mono,
   pixel accents). Must stay readable on a phone.

Pack schema 1.1 (packs/<college>/<course>-sem<N>.json, all years): college, course, sources.exams
[{id, name, date, session}], subjects[] -> units[] (blind_spot) -> topics[] (exams_count, is_repeat, total_marks,
questions[] with id, exam, text, marks, has_table, table_markdown, sub_parts, page_ref,
repeat_of [{id, type: exact|near|same-topic}], confidence), unsure[], stats, harness (models, eval).
Full reference: skills/pyq-atlas/references/pack-schema.md. Page photos: packs/<college>/pages/*.jpg.

## 6. Repo layout
data/raw/ (papers + manifest) · pipeline/ · packs/ · runs/sample/ · skills/pyq-atlas/ · web/ ·
README.md · CONTRIBUTING.md · LICENSE (Apache-2.0)

## 7. Rules for Claude Code
- Never hardcode findings or invent data, papers, colleges, numbers or answers. Everything shown
  comes from a pack built by the pipeline.
- Never call a frequency score "AI prediction" or "machine learning". Say what it is based on.
- Every AI output is JSON validated by pydantic. Failures go to the unsure list, never silently dropped.
- Keep it simple. A feature must be explainable in one sentence to a fresher, or it waits.
- Commit small and often with clear messages. Git author: veeviiiii <vedantkhare007@gmail.com>.
- Secrets only in .env (never committed). Check git history before anything goes public.
- When unsure, ask before building.
