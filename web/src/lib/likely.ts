// "Likely topics": a transparent frequency score, NOT machine learning (see CLAUDE.md).
// With a year or two of papers, how often and how heavily a topic was asked is all the evidence
// there is, so the score says exactly that and every topic lists its reasons.
//
// Everything is counted over the subject's own papers (the exams that have at least one question in
// this subject), never over every exam in the pack: a semester's pack often has exams this subject
// has no paper for. With fewer than MIN_PAPERS papers there is no score at all, only the list.

import { examKind, examLabels, inOrder, isUndated, placedQuestions, sessionOf, sessionsOf, subjectExams, type Exam } from "./papers";
import type { Subject, Topic, Unit } from "./types";

/** Fewer papers than this in a subject: its topics are listed, not scored or ranked. */
export const MIN_PAPERS = 3;

export interface LikelyTopic {
  topic: Topic;
  unit: Unit;
  score: number | null; // 0-100; null when the subject has too few papers to rank
  reasons: string[];
}

const STRENGTH: Record<string, number> = { exact: 3, near: 2, "same-topic": 1 };
const LABEL: Record<string, string> = { exact: "word for word", near: "nearly the same", "same-topic": "same topic" };

/** Enough papers of this subject to rank its topics? A paper with no year printed is still a paper. */
export function canRank(exams: Exam[], subject: Subject): boolean {
  return subjectExams(exams, subject).length >= MIN_PAPERS;
}

/** How the score is built, shown on the page next to the list. `papers`: the subject's own papers. */
export function scoreRule(papers: Exam[]): string {
  const back = papers.some(isUndated)
    ? "came back in an End Sem"
    : sessionsOf(papers).length > 1
      ? "came back in an End Sem from an earlier paper"
      : "came back from a mid-sem in the End Sem";
  return `Score out of 100: up to 60 for how many of this subject's ${papers.length} papers asked it, 20 if it ${back}, up to 20 for its marks next to the subject's heaviest topic.`;
}

/** What the ranking is based on, said plainly above the list. `papers`: the subject's own papers. */
export function basedOn(papers: Exam[]): string {
  const sessions = sessionsOf(papers); // newest first
  const dated = papers.filter((e) => !isUndated(e));
  const undated = papers.length - dated.length;
  const plus = undated ? ` and ${undated} with no year printed` : "";
  const what =
    sessions.length > 1
      ? `this subject's ${dated.length} papers from ${sessions[sessions.length - 1]} to ${sessions[0]}${plus}`
      : sessions.length === 1
        ? `${inOrder(dated)
            .map((e) => e.name)
            .join(", ")} (${sessions[0]})${plus}`
        : `${undated} paper${undated === 1 ? "" : "s"} with no year printed`;
  const from = sessions.length > 1 ? `${sessions.length} years of papers` : sessions.length === 1 ? "one year of papers" : "papers with no year printed";
  return `Ranked by how often and how heavily each topic was asked in ${what}. It is a frequency score from ${from}, not a guarantee.`;
}

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

/** "2 mid-sems, 1 End Sem" */
function kinds(asked: Exam[]): string {
  const ends = asked.filter((e) => examKind(e.id) === "end").length;
  const mids = asked.length - ends;
  return [mids && `${mids} mid-sem${mids === 1 ? "" : "s"}`, ends && `${ends} End Sem${ends === 1 ? "" : "s"}`].filter(Boolean).join(", ");
}

/**
 * A subject's topics with their reasons. With MIN_PAPERS papers or more: scored and sorted, best
 * first. With fewer: no score, in the pack's unit order.
 */
export function rankTopics(exams: Exam[], subject: Subject): LikelyTopic[] {
  const papers = subjectExams(exams, subject);
  const ranked = papers.length >= MIN_PAPERS;
  const rank = new Map(papers.map((e, i) => [e.id, i]));
  const years = sessionsOf(papers).length;
  const undated = new Set(papers.filter(isUndated).map((e) => e.id));
  const label = examLabels(papers);
  const examOf = new Map(placedQuestions(subject).map(({ q }) => [q.id, q.exam]));
  const heaviest = Math.max(1, ...subject.units.flatMap((u) => u.topics.map((t) => t.total_marks)));

  const topics = subject.units.flatMap((unit) =>
    unit.topics.map((topic) => {
      const asked = papers.filter((e) => topic.questions.some((q) => q.exam === e.id));
      // The closest End Sem repeat of an earlier question (links always point back in time); later End Sem wins a tie.
      const back = topic.questions
        .filter((q) => examKind(q.exam) === "end")
        .flatMap((q) => q.repeat_of.map((r) => ({ end: q.exam, from: examOf.get(r.id), type: r.type })))
        .sort((a, b) => (STRENGTH[b.type] ?? 0) - (STRENGTH[a.type] ?? 0) || (rank.get(b.end) ?? 0) - (rank.get(a.end) ?? 0))[0];
      const score = ranked
        ? Math.round((60 * asked.length) / papers.length + (topic.is_repeat ? 20 : 0) + (20 * topic.total_marks) / heaviest)
        : null;

      const askedYears = new Set(asked.map(sessionOf).filter(Boolean));
      const askedNoYear = asked.filter((e) => undated.has(e.id)).length;
      const when = [askedYears.size > 1 ? `${askedYears.size} of ${years} years` : [...askedYears][0], askedNoYear ? `${askedNoYear} with no year` : ""]
        .filter(Boolean)
        .join(", ");
      const reasons = [
        years > 1 || undated.size ? `Asked in ${asked.length} of ${papers.length} papers (${when}): ${kinds(asked)}` : `Asked in ${list(asked.map((e) => e.name))}`,
      ];
      if (topic.is_repeat) {
        const ends = asked.filter((e) => examKind(e.id) === "end");
        const end = back?.end ?? ends.slice(-1)[0]?.id ?? "";
        const how = back ? `, ${LABEL[back.type] ?? back.type}` : "";
        // A paper with no year has no place in time: say where it was asked, never which came first.
        if (back?.from && (undated.has(back.from) || undated.has(end))) reasons.push(`Came back: asked in ${label[back.from]} and ${label[end]}${how}`);
        else if (!back && ends.some((e) => undated.has(e.id))) reasons.push(`Came back: asked in ${list(ends.map((e) => label[e.id]))}`);
        else reasons.push(`Came back${back?.from ? ` from ${label[back.from]}` : ""} in ${years > 1 ? label[end] : "the End Sem"}${how}`);
      }
      reasons.push(`${topic.total_marks} marks in total`);
      if (unit.blind_spot) reasons.push("Its unit was never tested in the mid-sems");
      return { topic, unit, score, reasons };
    }),
  );
  return ranked ? topics.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.topic.total_marks - a.topic.total_marks) : topics;
}
