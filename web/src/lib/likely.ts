// "Likely topics": a transparent frequency score, NOT machine learning (see CLAUDE.md).
// With a year or two of papers, how often and how heavily a topic was asked is all the evidence
// there is, so the score says exactly that and every topic lists its reasons.

import { examKind, examLabels, inOrder, placedQuestions, sessionOf, sessionsOf, type Exam } from "./papers";
import type { Subject, Topic, Unit } from "./types";

export interface LikelyTopic {
  topic: Topic;
  unit: Unit;
  score: number; // 0-100
  reasons: string[];
}

const STRENGTH: Record<string, number> = { exact: 3, near: 2, "same-topic": 1 };
const LABEL: Record<string, string> = { exact: "word for word", near: "nearly the same", "same-topic": "same topic" };

/** How the score is built, shown on the page next to the list. */
export function scoreRule(exams: Exam[]): string {
  const back = sessionsOf(exams).length > 1 ? "came back in an End Sem from an earlier paper" : "came back from a mid-sem in the End Sem";
  return `Score out of 100: up to 60 for how many of the exams asked it, 20 if it ${back}, up to 20 for its marks.`;
}

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

export function rankTopics(exams: Exam[], subject: Subject): LikelyTopic[] {
  const ordered = inOrder(exams);
  const rank = new Map(ordered.map((e, i) => [e.id, i]));
  const years = sessionsOf(exams).length;
  const label = examLabels(exams);
  const examOf = new Map(placedQuestions(subject).map(({ q }) => [q.id, q.exam]));

  return subject.units
    .flatMap((unit) =>
      unit.topics.map((topic) => {
        const asked = ordered.filter((e) => topic.questions.some((q) => q.exam === e.id));
        // The closest End Sem repeat of an earlier question (links always point back in time); later End Sem wins a tie.
        const back = topic.questions
          .filter((q) => examKind(q.exam) === "end")
          .flatMap((q) => q.repeat_of.map((r) => ({ end: q.exam, from: examOf.get(r.id), type: r.type })))
          .sort((a, b) => (STRENGTH[b.type] ?? 0) - (STRENGTH[a.type] ?? 0) || (rank.get(b.end) ?? 0) - (rank.get(a.end) ?? 0))[0];
        const score = Math.round((60 * asked.length) / exams.length + (topic.is_repeat ? 20 : 0) + Math.min(topic.total_marks, 20));

        const askedYears = new Set(asked.map(sessionOf));
        const reasons = [
          years > 1
            ? `Asked in ${asked.length} of ${exams.length} exams (${askedYears.size > 1 ? `${askedYears.size} of ${years} years` : [...askedYears][0]})`
            : `Asked in ${list(asked.map((e) => e.name))}`,
        ];
        if (topic.is_repeat) {
          const end = back?.end ?? asked.filter((e) => examKind(e.id) === "end").slice(-1)[0]?.id ?? "";
          const from = back?.from ? ` from ${label[back.from]}` : "";
          reasons.push(`Came back${from} in ${years > 1 ? label[end] : "the End Sem"}${back ? `, ${LABEL[back.type] ?? back.type}` : ""}`);
        }
        reasons.push(`${topic.total_marks} marks in total`);
        if (unit.blind_spot) reasons.push("Its unit was never tested in the mid-sems");
        return { topic, unit, score, reasons };
      }),
    )
    .sort((a, b) => b.score - a.score || b.topic.total_marks - a.topic.total_marks);
}
