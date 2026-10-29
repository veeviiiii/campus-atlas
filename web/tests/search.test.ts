import assert from "node:assert/strict";
import { test } from "node:test";

import { entry } from "./fixture";
import { buildSearchIndex, highlighter, normalize, prepare, queryTokens, search } from "../src/lib/search";

const index = buildSearchIndex([entry()]);
const items = prepare(index);
const ids = (query: string) => search(items, query).map((it) => it.doc.q.id);

test("text is matched as plain lowercase words, LaTeX commands included", () => {
  assert.equal(normalize("\\frac{dy}{dx} in C++"), "frac dy dx in c++");
  assert.equal(normalize("Résumé"), "resume");
  assert.deepEqual(queryTokens("Laser  LASER laser"), ["laser"]);
});

test("the index holds every question, where it is from, and whether it came back", () => {
  assert.equal(index.docs.length, 5);
  assert.deepEqual(
    index.packs[0].exams.map((e) => e.id),
    ["mst1", "mst2", "end"],
  );
  const mst1 = index.docs.find((d) => d.q.id === "physics-mst1-q1");
  assert.deepEqual(mst1?.cameBack, { exam: "end", type: "exact" });
  assert.equal(mst1?.topic.unit, "Relativity");
});

test("a word matches the start of a word", () => {
  assert.deepEqual(ids("lase"), ["physics-end-q3"]);
  assert.deepEqual(ids("aser"), []);
});

test("every word must match; equal matches show the newer exam first", () => {
  assert.deepEqual(ids("lorentz equations"), ["physics-end-q1", "physics-mst1-q1"]);
  assert.deepEqual(ids("lorentz laser"), []);
  assert.deepEqual(ids(""), []);
});

test("words in the question count more than its topic, its topic more than its subject", () => {
  // "oscillations" is in the MST-2 question's text, and only in the End Sem question's topic
  assert.deepEqual(ids("oscillations"), ["physics-mst2-q2", "physics-end-q10"]);
  assert.equal(ids("relativity").length, 2); // unit name
  assert.equal(ids("applied physics").length, 5); // subject alias
});

test("results mark whole words, maths left alone", () => {
  const re = highlighter("lase c++");
  const parts = "He-Ne laser and C++".split(re!);
  assert.deepEqual(
    parts.filter((_, i) => i % 2),
    ["laser", "C++"],
  );
  assert.equal(highlighter("  "), undefined);
});
