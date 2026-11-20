import assert from "node:assert/strict";
import { test } from "node:test";

import { homeSummary } from "../src/lib/home";
import { entry } from "./fixture";

test("the home page gets a summary of the packs, not the packs", () => {
  const one = entry();
  const two = { key: "test-college/test-course-sem2", pack: { ...entry().pack, stats: { papers: 2, questions: 4, repeats: 0, dropped_bleed_through: 3 } } };
  two.pack.harness = { eval: { found: 18, expected: 19, misses: [7], source: "expected_repeats.json" } };
  const s = homeSummary([one, two]);

  const subjects = one.pack.subjects.length + two.pack.subjects.length;
  assert.deepEqual(s.totals, { papers: 5, questions: 9, subjects, repeats: 1, dropped: 3 }); // every course on the site
  assert.deepEqual(s.checked, { course: "Test Course", expected: 19, found: 18 });
  assert.equal(s.hero?.course, "Test Course");
  assert.equal(s.hero?.semester, 1);

  // the planet is the first pack's topics: a name, a heat, a weight and a link each, and nothing more
  const lasers = s.hero?.cities.find((c) => c.name === "Lasers");
  assert.deepEqual(Object.keys(lasers ?? {}).sort(), ["heat", "href", "lat", "lng", "name", "weight"]);
  assert.equal(lasers?.href, "/c/test-college/test-course-sem1/physics/#topic-lasers");
  assert.equal(lasers?.heat, "once");
  assert.equal(s.hero?.cities.length, one.pack.subjects.flatMap((x) => x.units.flatMap((u) => u.topics)).length);
  assert.ok(!JSON.stringify(s).includes("He-Ne"), "no question text");

  assert.deepEqual(homeSummary([]), { hero: null, totals: { papers: 0, questions: 0, subjects: 0, repeats: 0, dropped: 0 }, checked: null, audited: null });
});

test("the second reader's check is said only once every pack is checked and no proposed fix is waiting", () => {
  const audit = (proposed: number, corrected: number) => ({ reader: "a second reader", pages: 2, questions_checked: 5, corrected, dropped: 1, missed: 0, proposed });
  const withAudit = (proposed: number, corrected: number) => {
    const e = entry();
    e.pack.harness = { ...e.pack.harness, reading_audit: audit(proposed, corrected) };
    return e;
  };
  assert.equal(homeSummary([withAudit(0, 2), entry()]).audited, null); // one pack was never checked
  assert.equal(homeSummary([withAudit(0, 2), withAudit(3, 0)]).audited, null); // three fixes still wait for a person
  assert.deepEqual(homeSummary([withAudit(0, 2), withAudit(0, 0)]).audited, { questions: 10, fixed: 4 });
});
