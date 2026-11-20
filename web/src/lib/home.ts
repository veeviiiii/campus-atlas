// What the home page shows from the packs, worked out at build time: the hero planet's squares, the
// counter under the hero, the totals in "How it works" and the repeat check. The page gets these few numbers and names, never a
// whole pack (every question of every course would otherwise ride along in its HTML).

import { topicHref } from "./paths";
import { heatOf, type City, type LatLng } from "./planet";
import type { PackEntry, Topic } from "./types";

/** One topic on the hero planet: what the canvas draws and where a click goes. */
export interface HeroCity extends LatLng {
  name: string;
  heat: City["heat"];
  weight: number; // exams it was asked in, plus one if it came back
  rank: number; // its place among its subject's topics on the planet, 0 = the most asked
  href: string;
}

export interface HomeSummary {
  /** Topics from every course and semester on the site, so the caption names none of them. */
  hero: { cities: HeroCity[] } | null;
  totals: { papers: number; questions: number; subjects: number; repeats: number; dropped: number };
  /** How repeat finding did against the repeats found by hand, on the one course that has them. */
  checked: { course: string; expected: number; found: number } | null;
  /** A second reader's check of the questions against their page photos. Said only when every pack
   *  has been checked and none of its proposed fixes still waits for a person. */
  audited: { questions: number; fixed: number } | null;
}

const round = (x: number) => Math.round(x * 100) / 100; // a hundredth of a degree is far below a pixel

/** Topics shown per subject: its most asked, so 26 subjects stay about as busy as one semester was. */
export const HERO_TOPICS_PER_SUBJECT = 6;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DEG = 180 / Math.PI;
const weightOf = (t: Topic) => t.exams_count + (t.is_repeat ? 1 : 0);

/**
 * The hero planet's squares: every subject of every pack is one cluster, placed by a golden spiral
 * between 50° north and south (so each turns past the front), holding its most asked topics.
 * Deterministic: the same packs always give the same planet.
 */
export function heroCities(entries: PackEntry[]): HeroCity[] {
  const subjects = entries.flatMap((e) => e.pack.subjects.map((s) => ({ key: e.key, subject: s })));
  const n = subjects.length;
  return subjects.flatMap(({ key, subject }, i) => {
    const lat0 = Math.asin(0.77 * (1 - (2 * (i + 0.5)) / n)) * DEG;
    const lng0 = ((i * GOLDEN * DEG) % 360) - 180;
    const topics = subject.units
      .flatMap((u) => u.topics)
      .slice()
      .sort((a, b) => weightOf(b) - weightOf(a) || b.total_marks - a.total_marks || a.name.localeCompare(b.name))
      .slice(0, HERO_TOPICS_PER_SUBJECT);
    return topics.map((t, k) => {
      const r = topics.length === 1 ? 0 : 2.5 + 8 * Math.sqrt((k + 0.5) / topics.length);
      const a = k * GOLDEN + i;
      const lat = lat0 + r * Math.cos(a);
      return {
        lat: round(lat),
        lng: round(((((lng0 + (r * Math.sin(a)) / Math.cos(lat / DEG) + 180) % 360) + 360) % 360) - 180),
        name: t.name,
        heat: heatOf(t),
        weight: weightOf(t),
        rank: k,
        href: topicHref(key, subject.id, t.id),
      };
    });
  });
}

export function homeSummary(entries: PackEntry[]): HomeSummary {
  const total = (k: "papers" | "questions" | "repeats" | "dropped_bleed_through") => entries.reduce((n, e) => n + e.pack.stats[k], 0);
  const evalPack = entries.find((e) => e.pack.harness?.eval)?.pack;
  const result = evalPack?.harness?.eval;
  const audits = entries.map((e) => e.pack.harness?.reading_audit);
  return {
    audited:
      audits.length > 0 && audits.every((a) => a && a.proposed === 0)
        ? {
            questions: audits.reduce((n, a) => n + (a?.questions_checked ?? 0), 0),
            fixed: audits.reduce((n, a) => n + (a?.corrected ?? 0) + (a?.dropped ?? 0), 0),
          }
        : null,
    hero: entries.length ? { cities: heroCities(entries) } : null,
    totals: {
      papers: total("papers"),
      questions: total("questions"),
      subjects: entries.reduce((n, e) => n + e.pack.subjects.length, 0),
      repeats: total("repeats"),
      dropped: total("dropped_bleed_through"),
    },
    checked: evalPack && result ? { course: evalPack.course.name, expected: result.expected, found: result.found } : null,
  };
}
