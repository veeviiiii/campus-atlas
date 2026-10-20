// "Likely topics": a transparent frequency score, NOT machine learning (see CLAUDE.md).
// With one year of papers, how often and how heavily a topic was asked is all the evidence there
// is, so the score says exactly that and every topic lists its reasons.

import type { Exam } from "./papers";
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
export const SCORE_RULE =
  "Score out of 100: up to 60 for how many of the exams asked it, 20 if it came back from a mid-sem in the End Sem, up to 20 for its marks.";

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

export function rankTopics(exams: Exam[], subject: Subject): LikelyTopic[] {
  return subject.units
    .flatMap((unit) =>
      unit.topics.map((topic) => {
        const asked = exams.filter((e) => topic.questions.some((q) => q.exam === e.id));
        const link = topic.questions
          .flatMap((q) => q.repeat_of)
          .sort((a, b) => (STRENGTH[b.type] ?? 0) - (STRENGTH[a.type] ?? 0))[0];
        const score = Math.round((60 * asked.length) / exams.length + (topic.is_repeat ? 20 : 0) + Math.min(topic.total_marks, 20));

        const reasons = [`Asked in ${list(asked.map((e) => e.name))}`];
        if (topic.is_repeat) reasons.push(`Came back in the End Sem${link ? `, ${LABEL[link.type] ?? link.type}` : ""}`);
        reasons.push(`${topic.total_marks} marks in total`);
        if (unit.blind_spot) reasons.push("Its unit was never tested in the mid-sems");
        return { topic, unit, score, reasons };
      }),
    )
    .sort((a, b) => b.score - a.score || b.topic.total_marks - a.topic.total_marks);
}
