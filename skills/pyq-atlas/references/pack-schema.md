# College pack schema (`packs/<college>/<course>-sem<N>.json`)

One pack holds every year of one course-semester.

```jsonc
{
  "schema_version": "1.1",
  "college": {"id": "davv-sdsf", "name": "...", "city": "Indore", "lat": 22.69, "lng": 75.87},
  "course": {"id": "mtech-aids-dual", "name": "...", "semester": 1},
  "sources": {
    "exams": [                     // every exam of every year
      {"id": "mst1", "name": "MST-1", "date": "2025-10", "session": "2025-26"},
      {"id": "end-2024-25", "name": "End Sem", "date": "2025-01", "session": "2024-25"}, ...],
    "syllabus": {"batch": "2024-29", "note": "old syllabus, used as a hint only"},  // or null
    "units_from": "..."            // how units were formed when there is no syllabus
  },
  "subjects": [{
    "id": "physics-1", "name": "Physics-I", "aliases": ["Physics"], "codes_seen": ["DS6A-103"],
    "units": [{
      "id": "physics-1-u1", "name": "Oscillations and Waves",
      "from_syllabus": false,       // true when the unit name came from the syllabus
      "blind_spot": false,          // asked in an End Sem, never in a mid-sem (any year)
      "topics": [{
        "id": "physics-1-u1-t1", "name": "Damped oscillation",
        "exams_count": 2,           // distinct exams that asked this topic, all years
        "is_repeat": true,          // an End Sem asked it after an earlier paper (that year's mid-sems or any earlier year)
        "total_marks": 25,          // each printed question counted once
        "questions": [{
          "id": "physics-1-end-q8", "exam": "end",
          "text": "... LaTeX inside $...$ ...", "marks": 10,
          "has_table": false, "table_markdown": null, "sub_parts": [], "is_or_choice": false,
          "page_ref": "End_sem_pyq_sem1.pdf#p5",
          "repeat_of": [{"id": "physics-1-mst2-q1", "type": "exact", "similarity": 0.998}],
          "confidence": 0.9
        }],
        "quiz": [{"q": "...", "options": ["a", "b", "c", "d"], "answer": 1, "why": "..."}]
      }],
      "fog_topics": ["..."]         // syllabus topics never asked (only with a syllabus)
    }],
    "off_syllabus": []              // questions that fit no syllabus unit
  }],
  "unsure": [{"subject": "...", "page_ref": "...", "step": "...", "error": "...", "raw": "..."}],
  "stats": {"papers": 21, "questions": 0, "repeats": 0, "dropped_bleed_through": 0},
  "harness": {"model": "...", "fallback_model": "...", "embedding_model": "...",
              "dropped_bleed_through": [...], "manifest_disagreements": [...], "repeat_judgements": [...]}
}
```

- Exam ids: `mst1` / `mst2` / `end` for the first year added, `<kind>-<session>` (e.g. `mst1-2024-25`)
  for every other year, so question ids (`<subject>-<exam>-q<N>`) never change when a year is added.
  `session` is the academic session (July to June). Packs from before 1.1 have no `session`; derive it from `date`.
- `repeat_of` always points back in time (a later question links to an earlier one, possibly from an earlier year).
- `repeat_of.type`: `exact` | `near` | `same-topic`.
- `confidence`: 0.9 for a validated extraction, minus 0.1 if it sat at the page edge and needed the
  visual check, minus 0.1 if the first extraction failed validation.
- The website reads only this file (plus `pages/*.jpg`); it never calls a model.
