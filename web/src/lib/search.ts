// Search across every question on the site. The index is one static JSON file built from the packs at
// build time (app/search-index.json/route.ts); the search page fetches it and matches in the browser.
// About 0.5 KB per question (20 KB gzipped per semester of papers): split it per pack once it passes a few MB.
// Pure helpers: safe on the server and the client.

import { cameBackMap, examLabels, inOrder, placedQuestions } from "./papers";
import type { PackEntry, Question } from "./types";

export interface SearchPack {
  key: string; // pack key, "davv-sdsf/mtech-aids-dual-sem1"
  collegeId: string;
  course: string;
  semester: number;
  exams: { id: string; label: string; date: string }[]; // oldest first; label "MST-1", or "MST-1 2024-25" with several years
  subjects: { id: string; name: string; aliases: string[] }[];
}

export interface SearchDoc {
  pack: number; // index into SearchIndex.packs
  subject: string;
  topic: { id: string; name: string; unit: string };
  q: Question;
  cameBack?: { exam: string; type: string }; // a later exam asked it again
}

export interface SearchIndex {
  packs: SearchPack[];
  docs: SearchDoc[];
}

export function buildSearchIndex(entries: PackEntry[]): SearchIndex {
  const packs = entries.map(({ key, pack }) => {
    const label = examLabels(pack.sources.exams);
    return {
      key,
      collegeId: pack.college.id,
      course: pack.course.name,
      semester: pack.course.semester,
      exams: inOrder(pack.sources.exams).map((e) => ({ id: e.id, label: label[e.id], date: e.date })),
      subjects: pack.subjects.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases })),
    };
  });
  const docs = entries.flatMap(({ pack }, i) =>
    pack.subjects.flatMap((s) => {
      const back = cameBackMap(pack.sources.exams, s);
      return placedQuestions(s).map(({ q, topic, unit }) => ({
        pack: i,
        subject: s.id,
        topic: { id: topic.id, name: topic.name, unit: unit.name },
        q: { ...q, confidence: undefined }, // not shown; undefined keys are left out of the JSON
        ...(back.has(q.id) ? { cameBack: back.get(q.id) } : {}),
      }));
    }),
  );
  return { packs, docs };
}

/** Lowercase words without LaTeX markup or accents: "\frac{dy}{dx} in C++" -> "frac dy dx in c++". */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\\([a-z]+)/g, " $1 ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

/** The words of a query, each matched against the start of a word ("transist" finds "transistors"). */
export function queryTokens(query: string): string[] {
  return [...new Set(normalize(query).split(" ").filter(Boolean))];
}

/** One question, ready to match: its own words, its topic's, and where it sits. */
export interface Prepared {
  doc: SearchDoc;
  order: number; // the exam's place in its pack, oldest first (newer exams win a tie)
  text: string;
  topic: string;
  where: string;
}

export function prepare(index: SearchIndex): Prepared[] {
  return index.docs.map((doc) => {
    const p = index.packs[doc.pack];
    const s = p.subjects.find((x) => x.id === doc.subject);
    const { q } = doc;
    return {
      doc,
      order: p.exams.findIndex((e) => e.id === q.exam),
      text: ` ${normalize([q.text, ...(q.sub_parts ?? []), q.table_markdown ?? ""].join(" "))}`,
      topic: ` ${normalize(`${doc.topic.name} ${doc.topic.unit}`)}`,
      where: ` ${normalize(`${s?.name ?? ""} ${s?.aliases.join(" ") ?? ""} ${p.course}`)}`,
    };
  });
}

/**
 * Every question that has all the query's words somewhere (its text, its topic or unit, its subject
 * or course), best first: words in the question itself count most, the whole phrase in order more.
 */
export function search(items: Prepared[], query: string): Prepared[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const phrase = ` ${tokens.join(" ")}`;
  return items
    .map((it) => {
      let score = 0;
      for (const t of tokens) {
        const w = ` ${t}`;
        const hit = it.text.includes(w) ? 3 : it.topic.includes(w) ? 2 : it.where.includes(w) ? 1 : 0;
        if (!hit) return null;
        score += hit;
      }
      if (tokens.length > 1 && it.text.includes(phrase)) score += 3;
      return { it, score };
    })
    .filter((x): x is { it: Prepared; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || b.it.order - a.it.order)
    .map((x) => x.it);
}

/** Whole words that start with one of the query's words, for <mark>ing in plain text (never inside maths). */
export function highlighter(query: string): RegExp | undefined {
  const tokens = queryTokens(query);
  if (!tokens.length) return undefined;
  const alts = tokens.sort((a, b) => b.length - a.length).map((t) => t.replace(/[+#]/g, "\\$&"));
  return new RegExp(`\\b((?:${alts.join("|")})[a-z0-9]*)`, "gi");
}
