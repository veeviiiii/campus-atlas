// Pure helpers that turn a pack's topic tree back into papers (one per exam), in paper order.
// Safe on the server and the client.

import type { Pack, Question, Subject, Topic, Unit } from "./types";

export type Exam = Pack["sources"]["exams"][number];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KINDS = ["mst1", "mst2", "mst3", "end"]; // exam ids are a kind, or "<kind>-<session>" for another year

/** "2025-10" -> "Oct 2025" (falls back to the raw value: "2025" when the paper prints no month; "no year"
 *  when it prints no year at all). */
export function examDate(date: string | null): string {
  if (!date) return "no year";
  const [y, m] = date.split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : date;
}

/** A paper that prints no year anywhere ("end-undated"): it has no date and no session. */
export function isUndated(exam: Exam): boolean {
  return !exam.date;
}

/** "no year", or "no year (2)" for the second paper of an exam kind with no year printed ("end-undated-2"). */
export function noYear(exam: Exam): string {
  const n = Number(/-undated-(\d+)$/.exec(exam.id)?.[1] ?? 1);
  return n > 1 ? `no year (${n})` : "no year";
}

/** When it was held, for a heading: "Oct 2025", "2025", or "no year" / "no year (2)". */
export function examWhen(exam: Exam): string {
  return exam.date ? examDate(exam.date) : noYear(exam);
}

/** "end-2024-25" -> "end". */
export function examKind(examId: string): string {
  return examId.split("-")[0];
}

/** Academic session, "2025-26"; null for a paper with no year printed. Packs before schema 1.1 have
 *  none: work it out from the date (sessions start in July). */
export function sessionOf(exam: Exam): string | null {
  if (exam.session) return exam.session;
  if (!exam.date) return null;
  const [y, m] = exam.date.split("-").map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The pack's sessions, newest first (papers with no year printed have none). */
export function sessionsOf(exams: Exam[]): string[] {
  return [...new Set(exams.map(sessionOf).filter((s): s is string => !!s))].sort().reverse();
}

/** Oldest first: by session, then MST-1, MST-2, MST-3, End Sem (a date may be only the year). Papers with
 *  no year printed come first, but only to have a fixed place: nothing reads that as "older". */
export function inOrder(exams: Exam[]): Exam[] {
  const kind = (e: Exam) => KINDS.indexOf(examKind(e.id));
  return [...exams].sort(
    (a, b) =>
      (sessionOf(a) ?? "").localeCompare(sessionOf(b) ?? "") ||
      kind(a) - kind(b) ||
      (a.date ?? "").localeCompare(b.date ?? "") ||
      noYear(a).localeCompare(noYear(b)),
  );
}

/** Exam id -> "MST-2", or "MST-2 2024-25" when the pack has several years; "End Sem, no year" for a
 *  paper with no year printed. */
export function examLabels(exams: Exam[]): Record<string, string> {
  const several = sessionsOf(exams).length > 1;
  return Object.fromEntries(exams.map((e) => [e.id, isUndated(e) ? `${e.name}, ${noYear(e)}` : several ? `${e.name} ${sessionOf(e)}` : e.name]));
}

/** For a course card: "MST-1 Oct 2025 · MST-2 Dec 2025 · ..." for one year, "2025-26 · 2024-25" for
 *  several, and how many exams have no year printed. */
export function examsSummary(exams: Exam[]): string {
  const sessions = sessionsOf(exams);
  const undated = exams.filter(isUndated).length;
  if (sessions.length > 1) return [...sessions, undated ? `${undated} with no year` : ""].filter(Boolean).join(" · ");
  return inOrder(exams)
    .map((x) => (isUndated(x) ? `${x.name}, ${noYear(x)}` : `${x.name} ${examDate(x.date)}`))
    .join(" · ");
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
  return inOrder(exams)
    .map((exam) => {
      const questions = all.filter((p) => p.q.exam === exam.id).sort((a, b) => questionOrder(a.q) - questionOrder(b.q));
      const pages = [...new Set(questions.map((p) => p.q.page_ref).filter(Boolean))].sort();
      return { exam, questions, pages };
    })
    .filter((p) => p.questions.length > 0)
    .reverse();
}

/** Reverse repeat links: question id -> the latest exam that asked it again, and how closely. */
export function cameBackMap(exams: Exam[], subject: Subject): Map<string, { exam: string; type: string }> {
  const rank = new Map(inOrder(exams).map((e, i) => [e.id, i]));
  const map = new Map<string, { exam: string; type: string }>();
  for (const { q } of placedQuestions(subject))
    for (const r of q.repeat_of) {
      const seen = map.get(r.id);
      if (!seen || (rank.get(q.exam) ?? 0) >= (rank.get(seen.exam) ?? 0)) map.set(r.id, { exam: q.exam, type: r.type });
    }
  return map;
}
