// Pure helpers that turn a pack's topic tree back into papers (one per exam), in paper order.
// Safe on the server and the client.

import type { Pack, Question, Subject, Topic, Unit } from "./types";

export type Exam = Pack["sources"]["exams"][number];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-10" -> "Oct 2025" (falls back to the raw value). */
export function examDate(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : date;
}

/** Extraction order on the paper: "physics-1-end-q12" -> 12. Display only, never used for matching. */
export function questionOrder(q: Question): number {
  return Number(/-q(\d+)$/.exec(q.id)?.[1] ?? 0);
}

export interface PlacedQuestion {
  q: Question;
  topic: Topic;
  unit: Unit;
}

export interface Paper {
  exam: Exam;
  questions: PlacedQuestion[];
  pages: string[]; // page_refs, e.g. "End_sem_pyq_sem1.pdf#p5"
}

export function placedQuestions(subject: Subject): PlacedQuestion[] {
  return subject.units.flatMap((unit) => unit.topics.flatMap((topic) => topic.questions.map((q) => ({ q, topic, unit }))));
}

/** One paper per exam that has questions for this subject, newest exam first. */
export function papersOf(exams: Exam[], subject: Subject): Paper[] {
  const all = placedQuestions(subject);
  return exams
    .map((exam) => {
      const questions = all.filter((p) => p.q.exam === exam.id).sort((a, b) => questionOrder(a.q) - questionOrder(b.q));
      const pages = [...new Set(questions.map((p) => p.q.page_ref).filter(Boolean))].sort();
      return { exam, questions, pages };
    })
    .filter((p) => p.questions.length > 0)
    .reverse();
}

/** Reverse repeat links: question id -> the later exam that asked it again, and how closely. */
export function cameBackMap(subject: Subject): Map<string, { exam: string; type: string }> {
  const map = new Map<string, { exam: string; type: string }>();
  for (const { q } of placedQuestions(subject)) for (const r of q.repeat_of) map.set(r.id, { exam: q.exam, type: r.type });
  return map;
}
