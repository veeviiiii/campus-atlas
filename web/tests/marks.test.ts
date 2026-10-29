import assert from "node:assert/strict";
import { test } from "node:test";

import { EXAMS, physics } from "./fixture";
import { fmtMarks, marksByUnit, marksSummary } from "../src/lib/marks";

test("marks added up by unit and exam, oldest exam first", () => {
  const t = marksByUnit(EXAMS, physics());
  assert.deepEqual(
    t.exams.map((e) => e.id),
    ["mst1", "mst2", "end"],
  );
  assert.deepEqual(
    t.rows.map((r) => [r.unit.name, r.marks, r.total]),
    [
      ["Relativity", [5, 0, 12], 17],
      ["Oscillations", [0, 5, 0], 5],
      ["Optics", [0, 0, 10], 10],
    ],
  );
  assert.deepEqual(t.totals, [5, 5, 22]);
  assert.equal(t.unknown, 1); // printed without marks: counted apart, never guessed
});

test("the summary names the heaviest End Sem unit and the units the mid-sems missed", () => {
  assert.deepEqual(marksSummary(marksByUnit(EXAMS, physics())), [
    "Relativity carried the most marks in the End Sem: 12 of 22.",
    "Optics was never asked in the mid-sems, but carried 10 of 22 marks in the End Sem.",
  ]);
});

test("no End Sem, no summary", () => {
  assert.deepEqual(marksSummary(marksByUnit(EXAMS.filter((e) => e.id !== "end"), physics())), []);
});

test("marks print without needless decimals", () => {
  assert.equal(fmtMarks(12), "12");
  assert.equal(fmtMarks(2.5), "2.5");
});
