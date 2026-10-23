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

`intake` never calls the AI model and costs nothing. Only step 7 uses the API.

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
  month it was held (`"2025-10"`), `session` the academic year (`"2025-26"`).
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
| `exam id ...: use mst1 / mst2 / end ...` | An exam id does not match its session; see step 5. |
| A question's text is wrong on the site | Do not edit the pack by hand (the next run overwrites it). Retake the photo, replace the PDF, run again. |
| A page is upside down on the site | Add `rotation: 180` to that page in the manifest and run again. |
| `ModuleNotFoundError` | The command did not use the project's Python: start it with `.venv/Scripts/python`. |

## Rules

- Publish only question papers. No names, roll numbers or answer sheets.
- Never type questions, topics or numbers into a pack by hand. Everything on the site comes from the pipeline.
- Likely topics is a frequency score, not machine learning. Keep it described that way.
