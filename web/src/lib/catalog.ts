import "server-only";

import fs from "node:fs";
import path from "node:path";

import { loadPacks } from "./packs";
import type { Catalog, CourseCard, PackEntry } from "./types";

// The course list lives at the repo root (../catalog from web/), next to the packs. Read at build time.
const CATALOG_FILE = path.join(process.cwd(), "..", "catalog", "davv.json");

export function loadCatalog(): Catalog {
  return JSON.parse(fs.readFileSync(CATALOG_FILE, "utf-8")) as Catalog;
}

/**
 * Every course in the catalogue, each with all its semesters and the packs (papers) that exist
 * for them, plus any pack whose course the catalogue doesn't list (field "other").
 */
export function courseCards(entries: PackEntry[] = loadPacks()): CourseCard[] {
  const catalog = loadCatalog();
  const used = new Set<string>();
  const slot = (e: PackEntry) => ({ semester: e.pack.course.semester, key: e.key, papers: e.pack.stats.papers, mock: e.pack.mock });

  const cards: CourseCard[] = catalog.courses.map((c) => {
    const mine = entries.filter((e) => e.pack.college.id === c.college && e.pack.course.id === c.id);
    mine.forEach((e) => used.add(e.key));
    return {
      id: c.id,
      name: c.name,
      school: c.school,
      schoolShort: c.school_short,
      field: c.field,
      years: c.years,
      honoursYear: Boolean(c.honours_year),
      semesters: Array.from({ length: c.years * 2 }, (_, i) => {
        const e = mine.find((x) => x.pack.course.semester === i + 1);
        return e ? slot(e) : { semester: i + 1 };
      }),
      subjects: mine.flatMap((e) => e.pack.subjects.map((s) => s.name)),
    };
  });

  // Papers for a course the brochure doesn't list (e.g. a postgraduate programme) still get a card.
  const others = new Map<string, PackEntry[]>();
  for (const e of entries.filter((x) => !used.has(x.key))) {
    const id = `${e.pack.college.id}--${e.pack.course.id}`;
    others.set(id, [...(others.get(id) ?? []), e]);
  }
  for (const [id, es] of others) {
    const p = es[0].pack;
    cards.push({
      id,
      name: p.course.name,
      school: p.college.name,
      field: "other",
      years: null,
      honoursYear: false,
      semesters: es.map(slot).sort((a, b) => a.semester - b.semester),
      subjects: es.flatMap((e) => e.pack.subjects.map((s) => s.name)),
    });
  }
  return cards;
}

/** The course card a pack belongs to, for the pack page's back link. */
export function courseOf(entry: PackEntry): CourseCard | undefined {
  return courseCards().find((c) => c.semesters.some((s) => s.key === entry.key));
}
