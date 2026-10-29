// "Marks by unit": how many marks each unit's questions carried in each exam. Plain sums from the
// pack, no weighting. Safe on the server and the client.

import { examKind, inOrder, type Exam } from "./papers";
import type { Subject, Unit } from "./types";

export interface UnitRow {
  unit: Unit;
  marks: number[]; // one per exam in MarksTable.exams
  total: number;
}

export interface MarksTable {
  exams: Exam[]; // oldest first: the exams with at least one question in this subject
  rows: UnitRow[]; // in the pack's unit order
  totals: number[]; // per exam, every unit
  unknown: number; // questions printed without marks (not counted)
}

export function marksByUnit(exams: Exam[], subject: Subject): MarksTable {
  const questions = (u: Unit) => u.topics.flatMap((t) => t.questions);
  const asked = inOrder(exams).filter((e) => subject.units.some((u) => questions(u).some((q) => q.exam === e.id)));
  const rows = subject.units.map((unit) => {
    const marks = asked.map((e) =>
      questions(unit)
        .filter((q) => q.exam === e.id)
        .reduce((n, q) => n + (q.marks ?? 0), 0),
    );
    return { unit, marks, total: marks.reduce((a, b) => a + b, 0) };
  });
  return {
    exams: asked,
    rows,
    totals: asked.map((_, i) => rows.reduce((n, r) => n + r.marks[i], 0)),
    unknown: subject.units.reduce((n, u) => n + questions(u).filter((q) => q.marks == null).length, 0),
  };
}

/** 12 -> "12", 2.5 -> "2.5". */
export function fmtMarks(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

/**
 * What the table says, in a sentence or two, from the End Sem columns: the unit with the most marks,
 * and the units the mid-sems never asked about (blind spots) with their share.
 */
export function marksSummary(t: MarksTable): string[] {
  const ends = t.exams.map((e, i) => (examKind(e.id) === "end" ? i : -1)).filter((i) => i >= 0);
  if (!ends.length) return [];
  const endSem = ends.length > 1 ? `the ${ends.length} End Sems` : "the End Sem";
  const endMarks = (r: UnitRow) => ends.reduce((n, i) => n + r.marks[i], 0);
  const all = ends.reduce((n, i) => n + t.totals[i], 0);
  if (!all) return [];
  const out: string[] = [];
  const top = [...t.rows].sort((a, b) => endMarks(b) - endMarks(a))[0];
  out.push(`${top.unit.name} carried the most marks in ${endSem}: ${fmtMarks(endMarks(top))} of ${fmtMarks(all)}.`);
  const blind = t.rows.filter((r) => r.unit.blind_spot && endMarks(r) > 0);
  if (blind.length) {
    const m = blind.reduce((n, r) => n + endMarks(r), 0);
    out.push(
      `${list(blind.map((r) => r.unit.name))} ${blind.length > 1 ? "were" : "was"} never asked in the mid-sems, but carried ${fmtMarks(m)} of ${fmtMarks(all)} marks in ${endSem}.`,
    );
  }
  return out;
}
