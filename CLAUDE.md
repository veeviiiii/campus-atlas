# CAMPUS ATLAS — MASTER BRIEF (CLAUDE.md)

## 1. What we are building (one line)
Campus Atlas turns a college's past exam papers into an interactive 3D planet that shows what
YOUR university actually asks. It is powered by an open-weight AI model, wrapped in our own
"Trust Harness", packaged as an open-standard Agent Skill, and published as open source.

## 2. Context and target prize
- Event: Hacktoberfest 2026 Fest (MLH x DEV x DigitalOcean). Solo builder, building with Claude Code.
  The build starts now, before the event (the judges confirmed this is fine). Everything must be
  finished, deployed and rehearsed before judging.
- Target: DigitalOcean "Best Open-Source AI Project". ALL of these must be true:
  1. Open-source / open-weight AI is an IMPORTANT part of how it works (not decoration).
  2. Public GitHub repo with an open-source license (we use Apache-2.0).
  3. Any agent skill must comply with the Agent Skill Open Standard (agentskills.io).
  4. Any model-harness entry must include an original implementation.
- The card says teams may combine its examples. We combine THREE:
  (a) open-weight model: Gemma 4 (Apache-2.0) does all reading, matching and quiz writing
  (b) original harness: the "PYQ Trust Harness" (section 6), written from scratch
  (c) Agent Skill: "pyq-atlas" (section 8), so ANY skills-compatible agent can add a college
- Every design decision should make these three things obvious to a judge.

## 3. The problem and the insight
- Every university teaches the same subjects, but each one asks different exam questions.
  Students study generic material and never see their own university's pattern.
- Our real data (DAVV, School of Data Science & Forecasting, M.Tech Dual Degree AI&DS, Semester 1)
  suggests two patterns. The pipeline must DISCOVER these from the data. Never hardcode them:
  1. REPEATS: in every subject, topics from the mid-semester tests (MST-1, MST-2) came back
     in the End Sem, some word for word.
  2. BLIND SPOTS: units the MSTs never tested made up a big share of the End Sem
     (e.g., Physics optics/lasers, Statistics correlation/regression/index numbers, Programming OOP).
- Product promise: "See what your university actually asks."

## 4. Data we have
Path: data/raw/davv-sdsf/mtech-aids-dual/sem1/
- End_sem_pyq_sem1.pdf  (8 pages, phone photos)
- MST_1_PYQ_Sem_1.pdf   (7 pages, phone photos)
- MST2_PYQ.pdf          (7 pages, phone photos)
- syllabus-2024-29.docx (OLD syllabus, see "Old syllabus rule" below)

7 subjects x 3 exams = 21 papers (MST-1 ~Oct 2025, MST-2 ~Dec 2025, End Sem Dec 2025/Jan 2026):
Mathematics-I, Physics-I, Fundamentals of Programming, Descriptive Statistics,
Introduction to Computer Science, Fundamentals of Electronics, Environmental Science.

Page manifest (human ground truth; write it to data/raw/davv-sdsf/mtech-aids-dual/sem1/manifest.yaml):
- End Sem: p1 Programming, p2 Intro to CS, p3-p4 Descriptive Statistics (one paper, two pages),
  p5 Physics, p6 Electronics, p7 Mathematics, p8 Environmental Science
- MST-2: p1 Physics ("Applied physics"), p2 Environmental Science, p3 Electronics, p4 Intro to CS,
  p5 Descriptive Statistics, p6 Programming, p7 Mathematics
- MST-1: p1 Mathematics, p2 Electronics, p3 Physics (header says "test 2", treat as MST-1),
  p4 Descriptive Statistics, p5 Environmental Science (photo is UPSIDE DOWN), p6 Intro to CS,
  p7 Programming
Rule: the AI proposes subject/exam from each page header; the manifest overrides it.
The run report must list every disagreement between the AI and the manifest.

Known data problems the harness MUST handle:
- Course codes are unreliable (same code on two subjects, different codes for one subject).
  Identify subjects by normalized NAME plus an alias table, never by code.
- Name variants: "Physics-I" / "Physics" / "Applied physics"; "Fundamentals of Programming" /
  "Fundamental Of Programming language".
- Bleed-through: several photos show fragments of OTHER papers at the bottom (e.g., an
  Environmental Science or Electronics question at the bottom of a Physics page, a C++ MCQ
  fragment at the bottom of Statistics and Physics pages, an Intro to CS line at the bottom of
  the Programming End Sem page). These fragments must be DROPPED, not added to the wrong subject.
- Handwritten ticks and renumbering on papers. Never rely on question numbers; match by text.
- Maths questions contain formulas (store as LaTeX). Statistics questions contain data tables (flag has_table).
- One header says "Semester-III" for a Semester 1 paper (misprint). Trust the manifest.

OLD SYLLABUS RULE (important):
- The syllabus is from the 2024-29 batch and may be outdated for the current 2025-30 batch.
- Use it ONLY as a hint for naming units. Topics are derived bottom-up from the real questions.
- Questions that fit no syllabus unit go into an "off_syllabus" region (possible syllabus change).
- Syllabus topics with zero questions are "fog", always labelled "from old syllabus" in the UI.
- Never present the syllabus as current.

## 5. Architecture (three parts)
A. pipeline/ (Python): PYQ Trust Harness. Raw PDFs + optional syllabus -> one "college pack" JSON.
B. skills/pyq-atlas/: Agent Skill (agentskills.io standard) wrapping the pipeline.
C. web/ (Next.js): the website. Reads ONLY pack JSON files. No AI calls are needed at demo time.

Model provider (pipeline/providers.py), switchable by .env:
- "gemini": Gemma 4 via the Gemini API (fast, default). Set MODEL_ID from the Google AI Studio
  model list; do not guess it.
- "openai_compatible": any OpenAI-style endpoint serving an open-weight model, e.g. Ollama
  locally (http://localhost:11434/v1, model gemma4:e4b) or a DigitalOcean GPU Droplet.
  This proves the project needs NO proprietary API.
- Embeddings: open model via sentence-transformers (all-MiniLM-L6-v2 or bge-small-en-v1.5), local.
- temperature 0 everywhere. Keys only in .env (never committed). Add .env.example.

## 6. PYQ Trust Harness (our original implementation)
Principle: AI reading messy phone photos is unreliable, so every step is checked before anything
reaches the map. Nothing is silently dropped. Uncertain items go to an "unsure" list.

Steps:
1. render: PyMuPDF renders each PDF page to PNG at 200 dpi.
2. orient: ask the model whether the page is rotated or upside down; rotate with Pillow.
3. header: model reads exam type, subject name, code and date -> JSON. Manifest overrides; log disagreements.
4. extract: model returns questions as strict JSON: section, text (LaTeX for math), marks,
   sub_parts, has_table, is_or_choice, position_on_page (top/middle/bottom).
   Multi-page papers (Statistics End Sem) are merged into one paper.
5. validate (pydantic): schema valid, text long enough, marks plausible for the paper.
   Invalid -> retry once with the validation error in the prompt; still invalid -> unsure list.
6. contamination check: for bottom-of-page or partial questions, ask "Does this question belong to
   <subject>?" If no -> drop and log as bleed-through.
7. unit match: embed old-syllabus unit descriptions and questions; take the nearest unit.
   Similarity below threshold -> the model chooses from the unit list or "none"; "none" -> off_syllabus.
8. topics: within each unit, the model groups questions into 3-8 short topic names, e.g. "Damped oscillation".
9. repeats: compare questions across different exams. Cosine >= 0.85 -> repeat;
   0.70-0.85 -> model judges exact / near / same-topic / different. Store repeat_of links with type.
10. scoring per topic: exams_count; is_repeat (in an MST AND the End Sem); blind_spot
    (unit has zero MST questions but at least one End Sem question); total_marks.
11. quizzes (P1): pre-generate 3 MCQs per topic that has questions. Validate: 4 options, 1 correct,
    short explanation. Store them in the pack so the demo never depends on a live API.
12. output: packs/<college>/<course>-<sem>.json plus runs/<timestamp>/report.md
    (pages, questions, drops, unsure items, retries, AI-vs-manifest disagreements, model calls).

Eval (pipeline/eval.py), our proof the harness works.
The expected repeats below come from a manual check of the papers. Store them in
pipeline/eval/expected_repeats.json as {subject, mst_exam, key phrase} entries. A hit = the pack has
a repeat_of link between an MST question and an End Sem question on that topic. Match by text, not
question numbers.
 1. Physics, MST-2: damped oscillation (over-, under-, critically-damped motion)
 2. Physics, MST-1: E = K + m0c^2, explain and derive
 3. Physics, MST-1: Lorentz transformation and invariance of the wave equation
 4. Physics, MST-1: Michelson-Morley experiment
 5. Statistics, MST-2: find Q1 and Q3 (same marks table)
 6. Statistics, MST-1: sub-divided bar diagram (same Arts/Science/Commerce data)
 7. Statistics, MST-1: what is Statistics, two authors' statements, applications, kinds of data
 8. Mathematics, MST-1: absolute convergence of 1 - 1/2^2 + 1/3^2 - 1/4^2 + ...
 9. Mathematics, MST-2: the curve y^2(2a - x) = x^3 (same curve, different task: same-topic)
10. Intro to CS, MST-2: process vs thread
11. Intro to CS, MST-2: DDL and DML
12. Intro to CS, MST-2: three-level DBMS architecture and data independence
13. Electronics, MST-2: Zener diode vs PN junction diode
14. Electronics, MST-1: intrinsic vs extrinsic semiconductors
15. Electronics, MST-1: depletion region in a PN junction diode
16. Programming, MST-2: binary search
17. Programming, MST-2: swap two numbers using pointers
18. Programming, MST-1: algorithm and flowchart
19. Environmental Science, MST-2: biodiversity hotspots of India
Print "Repeat detection: found X of 19 expected" and list misses. Put the real number in the README.

## 7. College pack schema (packs/*.json)
{
  "schema_version": "1.0",
  "college": {"id":"davv-sdsf","name":"School of Data Science & Forecasting, DAVV","city":"Indore","lat":<real>,"lng":<real>},
  "course": {"id":"mtech-aids-dual","name":"M.Tech (Dual Degree) AI & DS","semester":1},
  "sources": {"exams":[{"id":"mst1","name":"MST-1","date":"2025-10"},{"id":"mst2","name":"MST-2","date":"2025-12"},{"id":"end","name":"End Sem","date":"2026-01"}],
              "syllabus":{"batch":"2024-29","note":"old syllabus, used as a hint only"}},
  "subjects": [{
    "id":"physics-1","name":"Physics-I","aliases":["Physics","Applied physics"],"codes_seen":["DS6A-103"],
    "units": [{"id":"phy-u2","name":"Oscillations and Waves","from_syllabus":true,
      "blind_spot":false,
      "topics": [{"id":"phy-damped","name":"Damped oscillation","exams_count":2,"is_repeat":true,"total_marks":25,
        "questions":[{"id":"phy-end-q4","exam":"end","text":"...","marks":10,"has_table":false,
                      "page_ref":"End_sem_pyq_sem1.pdf#p5","repeat_of":[{"id":"phy-mst2-q1","type":"exact"}],
                      "confidence":0.93}],
        "quiz":[{"q":"...","options":["..","..","..",".."],"answer":1,"why":"..."}]}],
      "fog_topics":["Q-factor","Impedance matching"]}],
    "off_syllabus":[ ...questions that matched no unit... ]
  }],
  "unsure":[ ...items the harness could not verify... ],
  "stats":{"papers":21,"questions":<n>,"repeats":<n>,"dropped_bleed_through":<n>}
}

## 8. Agent Skill: skills/pyq-atlas/
- Read the spec at https://agentskills.io/specification BEFORE writing anything. Follow it exactly.
- skills/pyq-atlas/SKILL.md: YAML frontmatter with name "pyq-atlas" (must match the folder name)
  and a description saying WHAT it does and WHEN to use it, e.g. "Turns past exam papers (scanned
  PDFs or photos) and an optional syllabus into a Campus Atlas college pack using an open-weight
  vision model: extracts questions, maps them to syllabus units, finds repeated questions across
  exams and flags blind spots. Use when someone wants to analyse previous-year question papers
  for a college course." Add "license: Apache-2.0".
- Body: when to use, inputs, step-by-step commands, outputs, common problems
  (rotated pages, bleed-through, old syllabus).
- scripts/run_pipeline.py (thin wrapper around pipeline/) and references/pack-schema.md.
- Validate with the official checker (skills-ref validate ./skills/pyq-atlas). Must pass.
- Demo line: "Any skills-compatible agent can add a new college by running this skill."

## 9. Website (web/)
Stack: Next.js (App Router) + TypeScript + Tailwind + Framer Motion, globe.gl (three.js),
d3-geo-voronoi, KaTeX. Deploy on Vercel as a static export (vercel.json at the repo root).
Bundle textures and fonts locally. Dark "space" theme. Readable on a projector.

Screens:
1. Earth view: dark glowing globe centred on India with the DAVV SDSF pin (Indore), plus a
   ghost "+ Add your college" pin that opens the contribute guide. NO fake colleges.
   Search or click -> smooth camera fly-to.
2. Picker: course + semester (only what packs contain).
3. Knowledge planet (second globe): subjects = continents, units = countries (Voronoi cells
   seeded per subject cluster), topics = glowing city points.
   - Red pulsing = repeat (MST -> End Sem). Orange = asked in 2+ exams. Yellow = asked once.
   - Purple outline = blind-spot unit (End Sem only).
   - Grey haze = fog topics, labelled "from old syllabus".
   - Separate small island = off_syllabus questions ("not in old syllabus").
   - Labels on hover; clicking a country zooms in.
4. Topic panel (slides in): every question grouped by exam, marks, LaTeX rendering,
   "Repeated in End Sem" badges, "AI-extracted, view original page" link (page_ref), "Quiz me".
5. Fog of war: everything starts dimmed. Clicking "Mark as studied" on a topic clears its fog with
   an animation (if quizzes exist, passing 2 of 3 also clears it). Progress "X% of Semester 1
   explored" saved in localStorage.
6. "Exam tomorrow": glowing arcs connect unexplored topics in priority order:
   repeats first, then blind spots, then by total_marks.
7. Footer honesty badge: "Based on 21 papers from 3 exams (2025-26). Syllabus: 2024-29 (old)."
Performance: create each globe once, update its layers with data, never re-mount on every render.

## 10. Repo layout
campus-atlas/
  CLAUDE.md  README.md  LICENSE (Apache-2.0)  CONTRIBUTING.md  .env.example
  data/raw/davv-sdsf/mtech-aids-dual/sem1/  (PDFs, syllabus, manifest.yaml)
  packs/davv-sdsf/mtech-aids-dual-sem1.json
  pipeline/  (providers.py render.py extract.py validate.py match.py repeats.py quiz.py build_pack.py eval.py)
  pipeline/eval/expected_repeats.json
  runs/      (reports; gitignored except one sample)
  skills/pyq-atlas/  (SKILL.md scripts/ references/)
  web/

## 11. README must show the challenge fit
- Top: one-line pitch, screenshot or GIF, live link.
- "Open-source AI inside": Gemma 4 (open-weight, Apache-2.0) reads the papers, matches topics,
  writes quizzes; open embedding model finds repeats; runs fully on Ollama with no proprietary API.
- "The PYQ Trust Harness": the 12 steps in one diagram plus the eval result (found X of 19 repeats).
- "Agent Skill": how to run pyq-atlas in a skills-compatible agent; note it passes skills-ref validate.
- "Why open matters here": free for every student; colleges can run it on their own servers;
  student papers never need to go to a closed AI company; anyone adds their college by pull request.
- "Add your college" (CONTRIBUTING.md): drop PDFs -> run the skill -> open a PR with the pack.
- Honest limits: one year of papers, old syllabus, AI extraction can be wrong (every question links to its original page).
- If the event asks for a DEV post, reuse this README.

## 12. Build plan (solo, starting now)
Priorities: P0 must ship, P1 should ship, P2 only if time is left.
- P0: pack for all 7 subjects (extract, validate, contamination check, unit match, repeats, scoring);
  Earth view -> fly-in -> planet -> topic panel; heat colours and repeat badges; honesty badge;
  public repo with Apache-2.0 license; deployed.
- P1: eval numbers in README; Agent Skill passing skills-ref validate; blind-spot outlines;
  off-syllabus island; "Mark as studied" fog of war; quizzes; exam-tomorrow arcs.
- P2: live "Add your college" upload; running one page live on Ollama.

Phases (do them in order; each ends with a commit):
- Phase 0 (about 15 min) Setup: repo, LICENSE, .env.example, folders, manifest.yaml, and a small
  MOCK pack JSON (2 subjects) so UI work never waits on the pipeline. Push to a public GitHub repo.
- Phase 1 (about 1 hour) Pipeline on ONE subject (Physics) end to end: render, orient, header,
  extract, validate, contamination check. Check the output by eye against the paper.
  Then start the run for all 7 subjects in a separate terminal.
- Phase 2 (about 1 hour) Website while the pipeline runs: Earth view, fly-to, knowledge planet with
  Voronoi countries, using the mock pack.
- Phase 3 (about 45 min) Back to the pipeline: unit match, repeats, scoring, build the real pack,
  run the eval. Swap the mock pack for the real one.
- Phase 4 (about 45 min) Topic panel (questions by exam, LaTeX, repeat badges, original-page link),
  heat colours, honesty badge. P0 is now complete: commit and deploy to Vercel, even if rough.
- Phase 5 (as long as time allows) P1 in this order: Agent Skill + validation, README with eval
  numbers, blind spots, "Mark as studied" fog, quizzes, exam-tomorrow arcs. Then P2 if time is left.
- Final hour before judging: NO new features. Fix bugs, redeploy, rehearse the demo twice,
  record a backup video, submit.

Solo rules:
- If any phase runs more than 20 minutes over, cut the lowest-priority item instead of pushing on.
- Model calls are slow: keep a pipeline run going in the background while building the UI.
- Commit after every working step.
- Keep each Claude Code request focused on one task; long open-ended sessions burn through usage limits.

## 13. Demo (3 minutes) and demo safety
1. "Every university teaches the same subjects. No two ask the same questions."
2. Earth view -> fly into DAVV -> the planet forms.
3. Point at a red pulsing topic: "Asked in MST-2, then again in the End Sem, word for word." Open the panel and show both.
4. Point at a purple blind spot: "The MSTs never tested optics. Four of seven End Sem Physics questions did."
5. Click "Mark as studied" on a topic -> fog clears. Press "Exam tomorrow" -> the route lights up.
6. "Built on Gemma 4, an open model, with our Trust Harness. It found X of 19 known repeats.
   Any agent can add a college with our open Agent Skill. Open source, Apache-2.0."
Safety: the website runs entirely from the pack JSON. No live AI calls during the demo. Test on the demo laptop and projector.

## 14. Rules for Claude Code
- Never hardcode findings or invent data, colleges, numbers or quiz answers. Everything comes from the pipeline.
- Never claim the syllabus is current. Keep the "old syllabus" labels.
- Every AI output is JSON validated by pydantic. Failures go to the unsure list, never silently dropped.
- Commit small and often with clear messages (judges look at history).
- Keep secrets in .env. Before submitting, check that no key is in git history.
- Prefer simple working code over clever code. When unsure, ask me before building.
