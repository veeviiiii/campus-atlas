import assert from "node:assert/strict";
import { test } from "node:test";

import { EXAMS, physics } from "./fixture";
import { cameBackMap, examDate, examKind, examLabels, examsSummary, examWhen, inOrder, isUndated, papersOf, sessionOf, sessionsOf } from "../src/lib/papers";

test("exam dates and kinds", () => {
  assert.equal(examDate("2025-10"), "Oct 2025");
  assert.equal(examDate("someday"), "someday");
  assert.equal(examDate("2025"), "2025"); // the paper printed no month
  assert.equal(examKind("end-2024-25"), "end");
  assert.equal(examKind("mst1"), "mst1");
});

test("a session starts in July; packs before schema 1.1 have none", () => {
  assert.equal(sessionOf({ id: "mst1", name: "MST-1", date: "2025-07" }), "2025-26");
  assert.equal(sessionOf({ id: "end", name: "End Sem", date: "2026-01" }), "2025-26");
  assert.equal(sessionOf({ id: "end", name: "End Sem", date: "2025-06" }), "2024-25");
  assert.equal(sessionOf({ id: "end", name: "End Sem", date: "2026-01", session: "2030-31" }), "2030-31");
});

test("exams in the order they were held", () => {
  assert.deepEqual(
    inOrder(EXAMS).map((e) => e.id),
    ["mst1", "mst2", "end"],
  );
  const sameMonth = [
    { id: "end", name: "End Sem", date: "2025-12" },
    { id: "mst2", name: "MST-2", date: "2025-12" },
  ];
  assert.deepEqual(
    inOrder(sameMonth).map((e) => e.id),
    ["mst2", "end"],
  );
  const yearOnly = [
    { id: "end", name: "End Sem", date: "2025", session: "2024-25" },
    { id: "mst3", name: "MST-3", date: "2025", session: "2024-25" },
    { id: "mst1", name: "MST-1", date: "2025-02", session: "2024-25" },
    { id: "end-2023-24", name: "End Sem", date: "2024-05", session: "2023-24" },
  ];
  assert.deepEqual(
    inOrder(yearOnly).map((e) => e.id),
    ["end-2023-24", "mst1", "mst3", "end"],
  );
});

test("exam labels name the year only when a pack has several", () => {
  assert.deepEqual(examLabels(EXAMS), { end: "End Sem", mst1: "MST-1", mst2: "MST-2" });
  const twoYears = [...EXAMS, { id: "end-2024-25", name: "End Sem", date: "2025-01", session: "2024-25" }];
  assert.equal(examLabels(twoYears)["end-2024-25"], "End Sem 2024-25");
  assert.equal(examLabels(twoYears).mst1, "MST-1 2025-26");
  assert.deepEqual(sessionsOf(twoYears), ["2025-26", "2024-25"]);
  assert.equal(examsSummary(EXAMS), "MST-1 Oct 2025 · MST-2 Dec 2025 · End Sem Jan 2026");
  assert.equal(examsSummary(twoYears), "2025-26 · 2024-25");
});

test("papers with no year printed: no session, a label of their own, listed after every dated paper", () => {
  const noYear = [
    ...EXAMS,
    { id: "end-undated-2", name: "End Sem", date: null, session: null },
    { id: "end-undated", name: "End Sem", date: null, session: null },
  ];
  assert.equal(isUndated(noYear[3]), true);
  assert.equal(sessionOf(noYear[3]), null);
  assert.deepEqual(sessionsOf(noYear), ["2025-26"]);
  assert.equal(examDate(null), "no year");
  assert.equal(examWhen(noYear[3]), "no year (2)");
  assert.deepEqual(
    inOrder(noYear).map((e) => e.id),
    ["end-undated", "end-undated-2", "mst1", "mst2", "end"],
  );
  assert.equal(examLabels(noYear)["end-undated-2"], "End Sem, no year (2)");
  assert.equal(examLabels(noYear).end, "End Sem"); // still one year with a date
  assert.equal(examsSummary(noYear), "End Sem, no year · End Sem, no year (2) · MST-1 Oct 2025 · MST-2 Dec 2025 · End Sem Jan 2026");

  const s = physics();
  s.units[2].topics[0].questions.push({ ...s.units[2].topics[0].questions[0], id: "physics-end-undated-q1", exam: "end-undated" });
  assert.deepEqual(
    papersOf(noYear, s).map((p) => p.exam.id),
    ["end", "mst2", "mst1", "end-undated"], // newest first; the paper with no year goes last
  );
});

test("papers: newest first, questions in the order printed on the paper", () => {
  const papers = papersOf(EXAMS, physics());
  assert.deepEqual(
    papers.map((p) => p.exam.id),
    ["end", "mst2", "mst1"],
  );
  // q10 after q3: by number, not as text
  assert.deepEqual(
    papers[0].questions.map((p) => p.q.id),
    ["physics-end-q1", "physics-end-q3", "physics-end-q10"],
  );
  assert.deepEqual(papers[0].pages, ["paper_end.pdf#p1"]);
});

test("a question that a later exam asked again knows it came back", () => {
  const back = cameBackMap(EXAMS, physics());
  assert.deepEqual(back.get("physics-mst1-q1"), { exam: "end", type: "exact" });
  assert.equal(back.size, 1);
});
