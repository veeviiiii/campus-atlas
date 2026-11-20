import assert from "node:assert/strict";
import { test } from "node:test";

import { isWinter, SEASON_SCRIPT, seasonScript, SNOWBALL_STICKS, snowballSticks, winterMode } from "../src/lib/season";

/** Runs the inline script as if today were `day`, and says whether it marked the page. */
function scriptMarks(day: Date, script = SEASON_SCRIPT): boolean {
  let marked = false;
  const FakeDate = function () {
    return day;
  };
  const document = { documentElement: { setAttribute: (name: string, value: string) => (marked = name === "data-season" && value === "winter") } };
  new Function("Date", "document", script)(FakeDate, document);
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

test("the snowball shows only a few sticks: the most asked topic of the subjects asked most", () => {
  const t = (name: string, rank: number, weight: number) => ({ name, rank, weight });
  const cities = [t("a0", 0, 2), t("a1", 1, 5), t("b0", 0, 4), t("c0", 0, 4), t("d0", 0, 1)];
  assert.deepEqual(snowballSticks(cities, 3).map((c) => c.name), ["b0", "c0", "a0"]); // a1 is not its subject's first
  assert.equal(snowballSticks(Array.from({ length: 40 }, (_, i) => t(`s${i}`, 0, 1))).length, SNOWBALL_STICKS);
});

test("one switch: WINTER_LOOK is auto unless it says on or off", () => {
  assert.equal(winterMode(undefined), "auto");
  assert.equal(winterMode(""), "auto");
  assert.equal(winterMode("auto"), "auto");
  assert.equal(winterMode(" ON "), "on");
  assert.equal(winterMode("off"), "off");
  assert.equal(winterMode("yes please"), "auto");
});

test("auto follows the date, on marks every day, off puts no script on the page", () => {
  const summer = new Date(2027, 5, 15);
  const christmas = new Date(2026, 11, 25);
  assert.equal(seasonScript("auto"), SEASON_SCRIPT);
  assert.equal(scriptMarks(summer, seasonScript("on")!), true);
  assert.equal(scriptMarks(christmas, seasonScript("on")!), true);
  assert.equal(seasonScript("off"), null);
});
