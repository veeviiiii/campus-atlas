# manifest.yaml

Human ground truth for which page is which subject and exam. Put it next to the PDFs.
The model reads each page header too; this file wins, and the run report lists every disagreement.

```yaml
schema_version: "1.0"
college: {id: my-college, name: "My College, My University", city: Pune, lat: 18.52, lng: 73.86}
course: {id: btech-cse, name: "B.Tech CSE", semester: 3}
exams:                          # in the order they were held
  - {id: mst1, name: MST-1, date: "2025-09"}
  - {id: mst2, name: MST-2, date: "2025-11"}
  - {id: end, name: End Sem, date: "2025-12"}
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
- Exam ids must be `mst1`, `mst2` and `end` (the harness compares mid-sems with the end-sem).
- Every page of every PDF appears once. `page` starts at 1.
- `rotation` (0/90/180/270, clockwise) is optional; the model detects rotation on its own.
- `notes` are for people and the eval; the pipeline never reads them.
- Use real coordinates for the college (e.g. from OpenStreetMap).
