import assert from "node:assert/strict";
import { test } from "node:test";

import { homeSummary } from "../src/lib/home";
import { entry } from "./fixture";

test("the home page gets a summary of the packs, not the packs", () => {
  const one = entry();
  const two = { key: "test-college/test-course-sem2", pack: { ...entry().pack, stats: { papers: 2, questions: 4, repeats: 0, dropped_bleed_through: 3 } } };
  two.pack.harness = { eval: { found: 18, expected: 19, misses: [7], source: "expected_repeats.json" } };
  const s = homeSummary([one, two]);

  assert.deepEqual(s.totals, { papers: 5, questions: 9, repeats: 1, dropped: 3 }); // every course on the site
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

  assert.deepEqual(homeSummary([]), { hero: null, totals: { papers: 0, questions: 0, repeats: 0, dropped: 0 }, checked: null });
});
