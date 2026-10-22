# manifest.yaml

Human ground truth for which page is which subject and exam. Put it next to the PDFs.
The model reads each page header too; this file wins, and the run report lists every disagreement.
One manifest holds every year of one course-semester; add older (or newer) papers to the same file.

```yaml
schema_version: "1.0"
college: {id: my-college, name: "My College, My University", city: Pune, lat: 18.52, lng: 73.86}
course: {id: btech-cse, name: "B.Tech CSE", semester: 3}
exams:
  - {id: mst1, name: MST-1, date: "2025-09", session: "2025-26"}
  - {id: mst2, name: MST-2, date: "2025-11", session: "2025-26"}
  - {id: end, name: End Sem, date: "2025-12", session: "2025-26"}
  - {id: mst1-2024-25, name: MST-1, date: "2024-09", session: "2024-25"}   # another year
  - {id: end-2024-25, name: End Sem, date: "2024-12", session: "2024-25"}
subjects:                       # matched by normalized name + aliases, never by course code
  - id: data-structures
    name: Data Structures
    aliases: [DS, Data Structure]
files:
  - file: End_sem.pdf
    exam: end
    pages:
      - {page: 1, subject: data-structures}
      - {page: 2, subject: data-structures, continues_previous: true}   # same paper, 2nd page
      - {page: 3, subject: other-subject, rotation: 180, notes: "photo is upside down"}
```

Rules:
- Exam ids: `mst1`, `mst2` and `end` for the first year you add; every other year adds its session,
  e.g. `mst1-2024-25`. Never rename the first year's ids: question ids, cached model answers and
  links depend on them. A year with no MST-2 paper simply leaves it out.
- `session` is the academic session (July to June), e.g. `"2024-25"`. If left out it is worked out from `date`.
- File names must be unique: page photos are named after them in `packs/<college>/pages/`, which all
  courses of the college share. Name new files after the course, year and exam, e.g. `btech-cse-sem3_2024-25_end.pdf`.
- Every page of every PDF appears once. `page` starts at 1.
- `rotation` (0/90/180/270, clockwise) is optional; the model detects rotation on its own.
- `notes` are for people and the eval; the pipeline never reads them.
- Use real coordinates for the college (e.g. from OpenStreetMap).
