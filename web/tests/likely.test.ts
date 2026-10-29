import assert from "node:assert/strict";
import { test } from "node:test";

import { EXAMS, physics } from "./fixture";
import { rankTopics, scoreRule } from "../src/lib/likely";

test("topics ranked by the published rule: 60 for exams asked, 20 for coming back, up to 20 for marks", () => {
  const ranked = rankTopics(EXAMS, physics());
  assert.deepEqual(
    ranked.map((t) => [t.topic.id, t.score]),
    [
      ["lorentz", 77], // 2 of 3 exams (40) + came back (20) + 17 marks
      ["damped", 45], // 2 of 3 exams (40) + 5 marks (the End Sem question has none printed)
      ["lasers", 30], // 1 of 3 exams (20) + 10 marks
    ],
  );
});

test("every topic says why it is ranked where it is", () => {
  const [lorentz, , lasers] = rankTopics(EXAMS, physics());
  assert.deepEqual(lorentz.reasons, ["Asked in MST-1 and End Sem", "Came back from MST-1 in the End Sem, word for word", "17 marks in total"]);
  assert.ok(lasers.reasons.includes("Its unit was never tested in the mid-sems"));
});

test("with several years the reasons count exams and years", () => {
  const subject = physics();
  subject.units[2].topics[0].questions.push({ ...subject.units[2].topics[0].questions[0], id: "physics-end-2024-25-q3", exam: "end-2024-25" });
  const exams = [...EXAMS, { id: "end-2024-25", name: "End Sem", date: "2025-01", session: "2024-25" }];
  const lasers = rankTopics(exams, subject).find((t) => t.topic.id === "lasers");
  assert.equal(lasers?.reasons[0], "Asked in 2 of 4 exams (2 of 2 years)");
});

test("the score is described as what it is, never as AI or machine learning", () => {
  const words = [scoreRule(EXAMS), ...rankTopics(EXAMS, physics()).flatMap((t) => t.reasons)].join(" ");
  assert.doesNotMatch(words, /machine learning|\bAI\b|\bML\b|predict/i);
});
