// One shape for every study tool (pattern, fog, exam route, archive, constellation, quiz builder),
// built either from a real college pack or from the labelled demo dataset in ./demo.ts.

import { HEAT } from "@/components/HeroPlanet";
import { honestyLine } from "@/components/AtlasSection";
import { SUBJECT_COLORS } from "@/components/PlanetGlobe";
import { pageImageUrl } from "@/components/TopicPanel";
import { heatOf } from "./planet";
import type { PackEntry, Quiz } from "./types";

export interface DQuestion {
  id: string;
  topicId: string;
  text: string;
  exam: string;
  examName: string;
  marks: number | null;
  pageUrl?: string;
  repeatOf: { id: string; type: string }[];
  subParts?: string[];
  tableMd?: string | null;
  /** Demo only: the sample question is multiple choice. */
  options?: string[];
  answer?: number;
}

export interface DTopic {
  id: string;
  name: string;
  subjectId: string;
  subjectIndex: number;
  unitName: string;
  unitNo: number;
  blindSpot: boolean;
  isRepeat: boolean;
  /** How many exams (real) or sample papers (demo) asked it. */
  count: number;
  marks: number | null;
  color: string;
  questions: DQuestion[];
  quiz: Quiz[];
}

export interface DSubject {
  id: string;
  name: string;
  color: string;
}

export interface Dataset {
  key: string; // progress key; for a real pack it is the pack key, shared with the planet explorer
  real: boolean;
  label: string;
  context: string;
  honesty: string;
  exams: { id: string; name: string }[];
  countNoun: string; // "exams" | "sample papers"
  countOf: number;
  subjects: DSubject[];
  topics: DTopic[];
  byId: Map<string, DTopic>;
  questions: DQuestion[];
  /** Topic ids, most important first. */
  rank: string[];
  /** [before, after]: study `before` first (demo prerequisite links only; real packs have none). */
  prereqs: [string, string][];
  priorityNote: string;
  legend: { color: string; label: string }[];
}

export function fromPack(entry: PackEntry): Dataset {
  const pack = entry.pack;
  const examName = new Map(pack.sources.exams.map((e) => [e.id, e.name]));
  const subjects: DSubject[] = pack.subjects.map((s, i) => ({ id: s.id, name: s.name, color: SUBJECT_COLORS[i % SUBJECT_COLORS.length] }));
  const topics: DTopic[] = [];
  const questions: DQuestion[] = [];
  pack.subjects.forEach((s, si) =>
    s.units.forEach((u, ui) =>
      u.topics.forEach((t) => {
        const qs: DQuestion[] = t.questions.map((q) => ({
          id: q.id,
          topicId: t.id,
          text: q.text,
          exam: q.exam,
          examName: examName.get(q.exam) ?? q.exam,
          marks: q.marks,
          pageUrl: pageImageUrl(pack, q.page_ref),
          repeatOf: q.repeat_of,
          subParts: q.sub_parts ?? [],
          tableMd: q.has_table ? q.table_markdown : null,
        }));
        questions.push(...qs);
        topics.push({
          id: t.id,
          name: t.name,
          subjectId: s.id,
          subjectIndex: si,
          unitName: u.name,
          unitNo: ui + 1,
          blindSpot: u.blind_spot,
          isRepeat: t.is_repeat,
          count: t.exams_count,
          marks: t.total_marks,
          color: HEAT[heatOf(t)],
          questions: qs,
          quiz: t.quiz,
        });
      }),
    ),
  );
  // Same order as the explorer's "Exam tomorrow": repeats, then blind spots, then marks.
  const rank = [...topics]
    .sort(
      (a, b) =>
        Number(b.isRepeat) - Number(a.isRepeat) ||
        Number(b.blindSpot) - Number(a.blindSpot) ||
        (b.marks ?? 0) - (a.marks ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .map((t) => t.id);
  return {
    key: entry.key,
    real: true,
    label: `${pack.college.name} · real papers`,
    context: `${pack.college.name} / ${pack.course.name} / Semester ${pack.course.semester} · ${pack.stats.papers} real papers`,
    honesty: `${honestyLine(pack)} Past patterns are not a prediction of future exams.`,
    exams: pack.sources.exams.map((e) => ({ id: e.id, name: e.name })),
    countNoun: "exams",
    countOf: pack.sources.exams.length,
    subjects,
    topics,
    byId: new Map(topics.map((t) => [t.id, t])),
    questions,
    rank,
    prereqs: [],
    priorityNote: "Priority: topics that came back from an MST in the End Sem first, then blind-spot units, then by marks. Studied topics are skipped.",
    legend: [
      { color: HEAT.repeat, label: "Repeat: MST → End Sem" },
      { color: HEAT.multi, label: "Asked in 2+ exams" },
      { color: HEAT.once, label: "Asked once" },
    ],
  };
}

/** Study order: walk the ranking, putting prerequisites first and skipping studied / skipped topics. */
export function buildRoute(ds: Dataset, studied: Set<string>, skip: string[], subject: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    const t = ds.byId.get(id);
    if (!t || seen.has(id) || studied.has(id) || skip.includes(id) || (subject !== "ALL" && t.subjectId !== subject)) return;
    seen.add(id);
    ds.prereqs.filter(([, after]) => after === id).forEach(([before]) => add(before));
    out.push(id);
  };
  ds.rank.forEach(add);
  return out;
}

export const dependents = (ds: Dataset, id: string) => ds.prereqs.filter(([before]) => before === id).length;
export const prerequisites = (ds: Dataset, id: string) => ds.prereqs.filter(([, after]) => after === id).map(([before]) => before);

/** Topic positions in a 100 x 100 box: subjects on a ring, topics packed around their subject. */
export function clusterLayout(ds: Dataset): Map<string, [number, number]> {
  const n = ds.subjects.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pos = new Map<string, [number, number]>();
  ds.subjects.forEach((s, si) => {
    const a = (2 * Math.PI * si) / n - Math.PI / 2;
    const cx = n === 1 ? 50 : 50 + 30 * Math.cos(a);
    const cy = n === 1 ? 50 : 50 + 30 * Math.sin(a);
    const group = ds.topics.filter((t) => t.subjectId === s.id);
    const r = Math.min(13, 4 + 2.2 * Math.sqrt(group.length));
    group.forEach((t, k) => {
      const rr = group.length === 1 ? 0 : r * Math.sqrt((k + 0.5) / group.length);
      // Rounded so the server render and the browser agree (trig can differ in the last digit).
      const round = (v: number) => Math.round(v * 100) / 100;
      pos.set(t.id, [round(cx + rr * Math.cos(k * golden)), round(cy + rr * Math.sin(k * golden))]);
    });
  });
  return pos;
}

export function countText(ds: Dataset, t: DTopic): string {
  if (!ds.real) return `${t.count} of ${ds.countOf} sample papers`;
  if (t.isRepeat) return `Repeat: MST → End Sem · ${t.count} of ${ds.countOf} exams`;
  return t.count >= 2 ? `Asked in ${t.count} of ${ds.countOf} exams` : "Asked once";
}
