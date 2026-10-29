// A small made-up subject for the tests: three units, one question that came back word for word, one
// unit only the End Sem asked about, one question printed without marks. Never shown on the site.

import type { Exam } from "../src/lib/papers";
import type { Pack, PackEntry, Question, RepeatLink, Subject, Topic, Unit } from "../src/lib/types";

export const EXAMS: Exam[] = [
  { id: "end", name: "End Sem", date: "2026-01", session: "2025-26" },
  { id: "mst1", name: "MST-1", date: "2025-10", session: "2025-26" },
  { id: "mst2", name: "MST-2", date: "2025-12", session: "2025-26" },
];

export function question(id: string, exam: string, marks: number | null, text: string, repeat_of: RepeatLink[] = []): Question {
  return { id, exam, text, marks, has_table: false, page_ref: `paper_${exam}.pdf#p1`, repeat_of };
}

export function topic(id: string, name: string, questions: Question[], is_repeat = false): Topic {
  return {
    id,
    name,
    exams_count: new Set(questions.map((q) => q.exam)).size,
    is_repeat,
    total_marks: questions.reduce((n, q) => n + (q.marks ?? 0), 0),
    questions,
    quiz: [],
  };
}

export function unit(id: string, name: string, topics: Topic[], blind_spot = false): Unit {
  return { id, name, from_syllabus: false, blind_spot, topics, fog_topics: [] };
}

export function physics(): Subject {
  return {
    id: "physics",
    name: "Physics",
    aliases: ["Applied Physics"],
    codes_seen: [],
    off_syllabus: [],
    units: [
      unit(
        "physics-u1",
        "Relativity",
        [
          topic(
            "lorentz",
            "Lorentz Transformation",
            [
              question("physics-mst1-q1", "mst1", 5, "Derive the Lorentz transformation equations."),
              question("physics-end-q1", "end", 12, "Derive the Lorentz transformation equations.", [{ id: "physics-mst1-q1", type: "exact" }]),
            ],
            true,
          ),
        ],
      ),
      unit("physics-u2", "Oscillations", [
        topic("damped", "Damped Oscillations", [
          question("physics-mst2-q2", "mst2", 5, "Explain damped oscillations with an example."),
          question("physics-end-q10", "end", null, "Write a short note on resonance."),
        ]),
      ]),
      unit("physics-u3", "Optics", [topic("lasers", "Lasers", [question("physics-end-q3", "end", 10, "Explain the working of a He-Ne laser.")])], true),
    ],
  };
}

export function pack(subjects: Subject[] = [physics()]): Pack {
  return {
    schema_version: "1.1",
    college: { id: "test-college", name: "Test College", city: "Indore", lat: 0, lng: 0 },
    course: { id: "test-course", name: "Test Course", semester: 1 },
    sources: { exams: EXAMS, syllabus: null },
    subjects,
    unsure: [],
    stats: { papers: 3, questions: 5, repeats: 1, dropped_bleed_through: 0 },
  };
}

export function entry(): PackEntry {
  return { key: "test-college/test-course-sem1", pack: pack() };
}
