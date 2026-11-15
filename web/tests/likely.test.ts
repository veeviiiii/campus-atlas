import assert from "node:assert/strict";
import { test } from "node:test";

import { EXAMS, physics, question, topic, unit } from "./fixture";
import { canRank, MIN_PAPERS, rankTopics, scoreRule } from "../src/lib/likely";
import { subjectExams } from "../src/lib/papers";
import type { Subject } from "../src/lib/types";

test("topics ranked by the published rule: 60 for papers that asked it, 20 for coming back, up to 20 for its share of marks", () => {
  const ranked = rankTopics(EXAMS, physics());
  assert.deepEqual(
    ranked.map((t) => [t.topic.id, t.score]),
    [
      ["lorentz", 80], // 2 of 3 papers (40) + came back (20) + the heaviest topic, 17 marks (20)
      ["damped", 46], // 2 of 3 papers (40) + 5 of 17 marks (5.9; the End Sem question has none printed)
      ["lasers", 32], // 1 of 3 papers (20) + 10 of 17 marks (11.8)
    ],
  );
});

test("every topic says why it is ranked where it is", () => {
  const [lorentz, , lasers] = rankTopics(EXAMS, physics());
  assert.deepEqual(lorentz.reasons, ["Asked in MST-1 and End Sem", "Came back from MST-1 in the End Sem, word for word", "17 marks in total"]);
  assert.ok(lasers.reasons.includes("Its unit was never tested in the mid-sems"));
});

test("with several years the reasons count papers, years and kinds of exam", () => {
  const subject = physics();
  subject.units[2].topics[0].questions.push({ ...subject.units[2].topics[0].questions[0], id: "physics-end-2024-25-q3", exam: "end-2024-25" });
  const exams = [...EXAMS, { id: "end-2024-25", name: "End Sem", date: "2025-01", session: "2024-25" }];
  const lasers = rankTopics(exams, subject).find((t) => t.topic.id === "lasers");
  assert.equal(lasers?.reasons[0], "Asked in 2 of 4 papers (2 of 2 years): 2 End Sems");
});

test("only the subject's own papers count: the pack's other exams change nothing", () => {
  // The semester's pack has two more exams (another subject's papers); Physics has no paper in them.
  const exams = [
    ...EXAMS,
    { id: "mst3", name: "MST-3", date: "2025-12", session: "2025-26" },
    { id: "end-2024-25", name: "End Sem", date: "2025-01", session: "2024-25" },
  ];
  assert.deepEqual(
    subjectExams(exams, physics()).map((e) => e.id),
    ["mst1", "mst2", "end"],
  );
  assert.deepEqual(rankTopics(exams, physics()), rankTopics(EXAMS, physics()));
  // ...and the reasons don't speak of years the subject has no paper from
  assert.equal(rankTopics(exams, physics())[0].reasons[0], "Asked in MST-1 and End Sem");
  assert.match(scoreRule(subjectExams(exams, physics())), /this subject's 3 papers/);
});

test(`fewer than ${MIN_PAPERS} papers: topics are listed in unit order with their reasons, without a score`, () => {
  const thin: Subject = {
    ...physics(),
    units: [
      unit("physics-u1", "Relativity", [topic("lorentz", "Lorentz Transformation", [question("physics-mst1-q1", "mst1", 5, "Derive the Lorentz transformation equations.")])]),
      unit("physics-u2", "Optics", [
        topic("lasers", "Lasers", [
          question("physics-mst1-q2", "mst1", 10, "Explain the working of a He-Ne laser."),
          question("physics-end-q1", "end", 10, "Explain the working of a He-Ne laser.", [{ id: "physics-mst1-q2", type: "exact" }]),
        ], true),
      ]),
    ],
  };
  assert.equal(canRank(EXAMS, thin), false);
  assert.equal(canRank(EXAMS, physics()), true);
  const listed = rankTopics(EXAMS, thin);
  assert.deepEqual(
    listed.map((t) => [t.topic.id, t.score]),
    [
      ["lorentz", null], // the pack's order, although Lasers was asked twice and came back
      ["lasers", null],
    ],
  );
  assert.deepEqual(listed[1].reasons, ["Asked in MST-1 and End Sem", "Came back from MST-1 in the End Sem, word for word", "20 marks in total"]);
});

test("the score is described as what it is, never as AI or machine learning", () => {
  const words = [scoreRule(EXAMS), ...rankTopics(EXAMS, physics()).flatMap((t) => t.reasons)].join(" ");
  assert.doesNotMatch(words, /machine learning|\bAI\b|\bML\b|predict/i);
});
