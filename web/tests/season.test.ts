import assert from "node:assert/strict";
import { test } from "node:test";

import { isWinter, SEASON_SCRIPT } from "../src/lib/season";

/** Runs the inline script as if today were `day`, and says whether it marked the page. */
function scriptMarks(day: Date): boolean {
  let marked = false;
  const FakeDate = function () {
    return day;
  };
  const document = { documentElement: { setAttribute: (name: string, value: string) => (marked = name === "data-season" && value === "winter") } };
  new Function("Date", "document", SEASON_SCRIPT)(FakeDate, document);
  return marked;
}

test("the winter look runs from 20 November to 6 January", () => {
  const on = (m: number, d: number) => isWinter(new Date(2026, m - 1, d));
  assert.equal(on(11, 19), false);
  assert.equal(on(11, 20), true);
  assert.equal(on(12, 25), true);
  assert.equal(on(1, 6), true);
  assert.equal(on(1, 7), false);
  assert.equal(on(6, 15), false);
});

test("the inline script follows the same rule on every day of a year", () => {
  for (let t = new Date(2027, 0, 1); t.getFullYear() === 2027; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    assert.equal(scriptMarks(t), isWinter(t), t.toDateString());
  }
});
