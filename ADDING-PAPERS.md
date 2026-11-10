# Adding papers yourself

How the maintainer turns uploads from the **Send us your papers** form into pages on the site.
No AI assistant needed. About 20 to 40 minutes per course and semester, most of it filling in one file.

All commands run in a terminal (PowerShell or Git Bash) opened in the repository folder,
`E:\Vedant\Hack Day SAGE`.

## What you need (already set up on this laptop)

- `.venv` with the pipeline's Python packages, and `.env` with `GEMINI_API_KEY` and `MODEL_ID`.
  On another computer: follow "Run it yourself" in [README.md](README.md) and copy `.env.example` to `.env`.
- Node in `web/` (`npm install` once) to look at the site before publishing.

## The whole flow

| Step | You do | Command |
|---|---|---|
| 1 | Download the uploads and the responses sheet | (Google Forms / Drive) |
| 2 | Remove anything private | (look at every photo) |
| 3 | Make the course folder and manifest | `intake new` |
| 4 | Turn each paper's photos into a PDF | `intake photos` |
| 5 | List the PDFs in the manifest and fill it in | `intake new`, then edit `manifest.yaml` |
| 6 | Check the manifest | `intake check` |
| 7 | Run the pipeline | `pipeline.build_pack` |
| 8 | Read the run report, look at the site locally | `npm run dev` |
| 9 | Publish | `git add`, `git commit`, `git push` |

`intake` never calls the AI model and costs nothing. Only step 7 uses the API (and the desk's
**Read pages**, if you press it).

**Steps 2 to 7 in one page:** the [intake desk](#using-the-desk) does them for a whole folder (mixed
semesters, two papers per photo, sideways pages, names to black out) without editing any file by hand.
The commands in steps 3 to 6 still work for a single paper.

## Using the desk

**Double-click `intake-desk.cmd`** in the repository folder. The desk starts without a console window
and opens http://127.0.0.1:8790 in your browser. For a desktop shortcut, right-click the file and pick
**Send to > Desktop (create shortcut)**. Double-clicking again while it runs opens the same desk.
**Close the desk** (top right) stops it; it also stops by itself half an hour after its page was
closed. It needs the project's `.venv` (see "Run it yourself" in README.md); its messages go to
`data/work/desk/desk.log`. From a terminal it is

```bash
.venv/Scripts/python -m pipeline.desk ["E:/uploads/M.Tech Int AIDS 5 year"]
```

It runs only on this laptop: no sign-in, and nothing leaves it except the pages you ask the model to
read. On the start screen:

- **Drop the PDFs or photos** students sent (or **Choose files**). They are copied into a new folder
  in `data/inbox/` (never committed) and opened. You can also drop a whole **folder** (it keeps its
  subfolders, so "Sem 5/..." still tells the desk the semester) or a **.zip**, such as a Google Drive
  download: the desk unpacks its PDFs and photos and leaves everything else out.
- **Carry on** with a folder you opened before; each card shows how many pages are decided.
- **Open a folder or a PDF already on this laptop.** Every page of every PDF and photo in a folder
  (subfolders too) is a card. A single PDF is worked on alone; its work is saved next to it as
  `<file>.desk-decisions.json`.

The step bar at the top shows what is done and the one thing to do next: **Open**, **Read pages**
(optional), **Check** every page, **Write** the PDFs and manifests, **Run** the pipeline. Click a card, then:

- **Turn** it upright: ↺ / ↻ (or `R`).
- **Split** a photo of two papers: **✂ 2 papers** on its card (top and bottom), or in the editor
  **2 papers: top / bottom** or **2 papers: left / right**, then drag the dashed line. **1 paper** on
  the card undoes it. Each half gets its own fields; **Turn this half** if one half is the other way up.
- **Black out** names, roll numbers and signatures: drag a box on the page. The box is burned into
  the PDF's pixels and the new PDFs keep no hidden text layer from the scanner app, so nothing is left
  under it. The small cards show exactly what will be written.
- **Use**, **Skip** (duplicates, answer sheets, anything that isn't a question paper) or **Held back**
  (a real paper with no year, no test number or no subject). Held-back pages are listed, with their
  reason, at the top of that semester's manifest until you know more. **Held back** above the pages
  shows only those, each with its reason (the other filters: **To do**, **Use**, **Skip**, **All**).
  Fill in what is missing (the year goes in Session) and the paper becomes **Use** by itself;
  shift-click several to fill a field for all of them.
- **Course, semester, subject, exam, session, date.** Shift-click a range (or **Select all** on a file)
  to set course, semester, exam and session for many pages at once, then the subject page by page.
  **+ New** adds a subject with the other names printed on its papers. The date belongs to the exam:
  set it once.
- **Continues the previous page** (`C`) for a paper's second page: it takes that paper's subject and exam.

Keys: `←` `→` move, `A` accept the suggestion and go on, `U` use, `S` skip, `H` held back,
`C` continues, `R` turn, `Del` removes the selected black-out box. Everything is saved as you go to
`desk-decisions.json` in the folder of sources: close the page whenever you like and open the folder
again to carry on.

**Read pages** (model) asks the model to read every page you have not decided yet: which way up it is,
one paper or two, whether it is a question paper at all, and what its header prints (exam, subject,
course, semester, date). The desk turns that into suggested fields with the pipeline's own matching
(subjects by name and the manifest's aliases, never by course code) and marks the card ✦ with a dashed
border. A paper that prints no year is suggested as held back "no year" (likewise "no test number",
"no subject"); a page with no printed header continues the paper before it; a paper that prints no
course takes the course and semester of the page before it.

- **File names count too.** Many papers print no year, but the PDF is called something like
  `M.tech_Sem1_ENDSEMQP_2k24-25.pdf` or `Sem 3 Int1 2k25.pdf`. When the paper does not print the
  semester, the exam or the year, the suggestion takes it from the file name, and its notes say so
  ("year from the file name"). What the paper prints always wins; a file name that disagrees adds a
  note to look at. A file name with only a year (`2k25`) is never sure: check the session it worked out.
- **Fill N held back** (above the pages) is for pages you held back before the desk read file names:
  it fills only the empty fields from each page's suggestion and keeps what you set. A paper with
  nothing missing any more becomes **Use**; the others stay held back with what is still missing as
  the reason (often "no subject": pick it page by page). One page at a time: **Fill in what is
  missing** under its suggestion.

- **Accept all sure pages** (in the bar at the top) takes, in one go, every suggestion with nothing to
  doubt: course, semester, subject, exam and session all matched what is printed (no year-only date,
  no new subject, nothing that disagrees), a page that continues a paper already taken, or a copy
  found by its picture. The rest stay suggested for you to check; look over the small pictures of the
  accepted ones, and change any page afterwards.
- **Accept all N** (next to **Select all** on each file) takes every suggestion waiting in that PDF,
  sure or not; it first says how many are not sure. Handy for a PDF you know well; look over its
  small pictures afterwards.
- **Nothing counts until you accept it.** Look at the picture, then **Accept** (`A` accepts and moves
  on), or set the fields yourself. Shift-click a range and **Accept** to take several at once. A subject
  printed on the paper that the semester does not have yet is added to it when you accept (or **Fill**),
  named as printed without its course code, so the next papers printing that name match it. Printed
  variants of the name join that subject as its other names: case, plural, I or 1, Maths or Mathematics,
  -isation or -ization, a course code ("IT-105A (Fundamentals of Computer)") and an all-capitals short form
  ("DCC" for Data and Computer Communication) do not make a second subject; C++ stays apart from C. Look
  over a semester's subjects in the Subject list: to name one yourself, with its other names, use
  **+ Add "…" as a subject** instead.
- One model call per page (two when a page comes in sideways: it is read again upright), three at a
  time in the background (`DESK_READ_WORKERS` in `.env` sets another number, 1 to 8, when your model's
  rate limit allows it); the page being read pulses. **Stop reading** stops it. Answers are cached in `data/work/cache`, so
  reading again costs nothing. **Read again** on a page reads it as it is now (turned or split as you
  set it). A page the model could not read says why.
- It needs `GEMINI_API_KEY` in `.env` (everything else works without it). It uses `DESK_MODEL_ID` from
  `.env` when set, otherwise `MODEL_ID`. Reading a header is a small job, so a fast model does it well:
  a Gemini Flash id from the AI Studio model list, such as `gemini-3.5-flash` (not open weights; check
  its price and free limits), or `gemma-4-26b-a4b-it`. When it is busy the desk falls back to
  `FALLBACK_MODEL_ID`. The questions on the site are always copied by `MODEL_ID` (Gemma) when the
  pipeline builds the pack.
- Pages are sent as they are: black out names first if you don't want them sent.

**Copies:** when a folder opens, the desk compares a small picture fingerprint of every page (no model,
no cost) and suggests **Skip: duplicate** for a page that is the same scan or photo as an earlier page
of the folder, or as a page already in `data/raw/`, even turned or saved again as JPEG. Two different
photos of one paper don't match by picture; once they have a subject and exam, Write warns that the
manifest already has that subject in that exam.

**Opening a folder again is quick:** the fingerprints and a small picture of every page (what the
cards show) are kept in `data/work/desk/` (never committed), by each file's size and time. A changed
file is looked at again; small pictures not made for a month are removed when the desk starts. The
pictures are of the pages as they came, before any black-out: they stay on this laptop like the
sources themselves.

**Write PDFs and manifests** first lists what it will write and anything to fix (a page with no
subject, a date outside its session, a subject the manifest already has in that exam). Then it:

- writes one PDF per course-semester, session and exam, named `<course>-sem<N>_<session>_<exam>.pdf`,
  in `data/raw/<school>/<course>/sem<N>/`. If a PDF of that name exists and the desk did not make it,
  it uses `_2`, `_3` and leaves the old one alone;
- adds them to that semester's `manifest.yaml` (made from the usual template if missing). Lines already
  in the manifest are never changed or moved: new exams, subjects and files go at the end, each page
  with a comment naming the source page it came from. Exam ids follow the usual rule: `mst1`, `end`
  for the manifest's first year and `end-2024-25` for any other (in a new manifest, the newest year
  is the first);
- runs `intake check` on every manifest it touched and shows the result.

Writing again after a change replaces only what the desk wrote before. Edit pages in the desk, not
the desk's own lines in the manifest (the next write would put them back).

**Run the pipeline** (after writing, or step 5 of the bar, on a manifest the desk wrote) runs step 7,
shows its log as it goes and, at the end, the run report's **Unsure** list. Carry on from step 8.

## 1. Download the uploads

- **Responses:** Google Forms, open the form, **Responses**, then **Link to Sheets** (or **View in
  Sheets**). Each row says the course, semester, exam, month and year, and subjects of one upload,
  with links to its photos.
- **Photos:** in Google Drive, the form's upload folder is named after the form and ends in
  `(File responses)`. Right-click it, **Download**, and unzip it somewhere outside the repository,
  for example `E:\uploads\`.

## 2. Remove anything private

Every page you publish is shown on the site as a photo. Before going on, open each photo and:

- delete answer sheets, mark lists and anything that isn't a question paper;
- crop or cover names, roll numbers and signatures;
- delete duplicates and blurry shots.

(In the desk: **Skip** and the black-out boxes.)

## 3. Make the course folder and manifest

Each course and semester has one folder and one `manifest.yaml`. The manifest is the human ground
truth: which page is which subject and exam. The pipeline reads every page header too, but the
manifest wins.

```bash
.venv/Scripts/python -m pipeline.intake new --course bca --semester 1
```

- `--course` is a course id from [catalog/davv.json](catalog/davv.json): for example `bca`, `bcom`,
  `mba-tourism-dual`, `ballb-hons`, `mtech-aids-dual`. A wrong id prints the full list.
- It creates `data/raw/<school>/<course>/sem<N>/manifest.yaml` with the college and course already
  filled in, and prints the folder.

## 4. Turn photos into PDFs

Put the photos of **one paper** (or one exam's papers) in a folder, in page order. Rename them
`01.jpg`, `02.jpg`, ... if the order is wrong. Then:

```bash
.venv/Scripts/python -m pipeline.intake photos E:/uploads/bca-mst1 data/raw/davv-scsit/bca/sem1/bca-sem1_2025-26_mst1.pdf
```

- It prints which photo became which page, and turns photos upright using the rotation the phone saved.
- **Name every PDF** `<course>-sem<N>_<session>_<exam>.pdf`. All courses of a school share one folder of
  page photos on the site, so two PDFs must never have the same name (`check` warns you).
- Got PDFs already (scanned)? Copy them into the folder and rename them the same way.

## 5. Fill in the manifest

Run `new` again. It adds every PDF in the folder to the manifest, with one line per page:

```bash
.venv/Scripts/python -m pipeline.intake new --course bca --semester 1
```

Then open `manifest.yaml` and replace every `TODO`:

- **exams:** keep one line per exam you have papers for and delete the rest. `date` is the year and
  month it was held (`"2025-10"`), or just the year (`"2025"`) when no paper prints the month;
  `session` the academic year (`"2025-26"`). A third mid-sem is `mst3` (name `MST-3`).
- **subjects:** one entry per subject. `id` is short and lowercase with hyphens (`data-structures`).
  `aliases` are other names printed on the papers for the same subject (`[DS, Data Structure]`).
  Use the subject names from the responses sheet and the paper headers.
- **files:** for each PDF, its `exam` id, and each page's `subject` id.
  - A paper's second page: `{page: 2, subject: data-structures, continues_previous: true}`.
  - An upside-down photo: add `rotation: 180` (the model also detects this itself).

The format, with examples: [skills/pyq-atlas/references/manifest.md](skills/pyq-atlas/references/manifest.md).

## 6. Check the manifest

```bash
.venv/Scripts/python -m pipeline.intake check data/raw/davv-scsit/bca/sem1/manifest.yaml
```

It lists every problem: TODOs left, pages missing or listed twice, a subject or exam id that does not
exist, a PDF name another course already uses. Fix and run it again until it says **ready**. It then
prints the next command.

## 7. Run the pipeline

```bash
.venv/Scripts/python -m pipeline.build_pack --manifest data/raw/davv-scsit/bca/sem1/manifest.yaml --all
```

- It renders every page, reads the header, extracts the questions, drops bits of other papers caught
  in the photo, groups the questions into units and topics, finds repeats and writes:
  - the pack: `packs/<school>/<course>-sem<N>.json`
  - the page photos: `packs/<school>/pages/*.jpg`
  - the run report: `runs/<date-time>/report.md`
- **API use:** about 8 model calls per page (the M.Tech AI&DS semester: 184 calls for 22 pages), on the
  Gemini API key in `.env`. A big batch can hit its rate or daily limits. Just run the same command
  again later: every answer already received is saved in `data/work/cache`, so only the missing ones
  are asked again.
- Re-running after fixing the manifest is cheap for the same reason.

## 8. Check the result

**The run report** (`runs/<newest>/report.md`):

- **AI vs manifest disagreements:** the model read a header differently from your manifest. Usually a
  printed misprint (the manifest is right). If the model is right, fix the manifest and run again.
- **Dropped as bleed-through:** text from another paper under the photo. Glance at it.
- **Unsure:** questions the harness could not verify; they are not on the site. A clearer photo helps.

**The site, locally:**

```bash
cd web
npm run dev
```

Open http://localhost:3000, find the course, open the semester and a few subjects. Compare a few
questions with **Original page**. Stop the server with Ctrl+C.

## 9. Publish

```bash
git add data/raw/davv-scsit/bca/sem1/manifest.yaml packs/davv-scsit
git commit -m "Add BCA semester 1 papers (2025-26)"
git push
```

Vercel rebuilds the site in about a minute. The course card on the home page now says
"Sem 1 papers", and the semester tile links to the subjects.

The PDFs stay on this laptop (`data/raw/**/*.pdf` is gitignored; the page photos in `packs/` are the
public copy). Keep a backup of them, for example in Drive.

## Adding another year to a course that is already on the site

Same folder, same manifest. One pack holds every year:

1. Name the new PDFs with their session (`..._2024-25_end.pdf`) and put them in the folder.
2. Run `intake new` again: it appends the new PDFs and leaves the rest alone.
3. Add their exams with the session in the id. Never rename the first year's ids (`mst1`, `mst2`, `end`):
   ```yaml
   - {id: mst1-2024-25, name: MST-1, date: "2024-10", session: "2024-25"}
   - {id: end-2024-25, name: End Sem, date: "2025-01", session: "2024-25"}
   ```
4. `intake check`, then the same `build_pack` command. Papers already done come from the cache; the
   new ones, and the topic grouping across all years, call the model. Topic names may change a little.

The subject page then shows year chips (All years, 2025-26, 2024-25), and Likely topics counts every year.

## A course that is not on the list

The 30 courses come from DAVV's CUET (UG) brochure. For another programme (for example a
postgraduate course), add it to [catalog/davv.json](catalog/davv.json): `id`, `name`, `school`,
`college` (the school's id, e.g. `davv-iips`), `field`, `years`. Add it to the Google Form's
Course list too. Without a catalogue entry the pack still works and shows under "Other".

## When something goes wrong

| Message | What to do |
|---|---|
| `MODEL_ID is not set` / `GEMINI_API_KEY` | `.env` is missing or empty: copy `.env.example` to `.env` and fill it in. |
| `429`, `RESOURCE_EXHAUSTED`, `503` | API limit or overload. The pipeline retries; if it gives up, run the same command later. |
| `exam id ...: use mst1 / mst2 / mst3 / end ...` | An exam id does not match its session; see step 5. |
| A question's text is wrong on the site | Do not edit the pack by hand (the next run overwrites it). Retake the photo, replace the PDF, run again. |
| A page is upside down on the site | Add `rotation: 180` to that page in the manifest and run again. |
| `ModuleNotFoundError` | The command did not use the project's Python: start it with `.venv/Scripts/python`. |

## Rules

- Publish only question papers. No names, roll numbers or answer sheets.
- Never type questions, topics or numbers into a pack by hand. Everything on the site comes from the pipeline.
- Likely topics is a frequency score, not machine learning. Keep it described that way.
