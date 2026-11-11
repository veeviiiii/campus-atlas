// What the home page shows from the packs, worked out at build time: the hero planet's squares, the
// totals in "How it works" and the repeat check. The page gets these few numbers and names, never a
// whole pack (every question of every course would otherwise ride along in its HTML).

import { topicHref } from "./paths";
import { buildPlanet, type City, type LatLng } from "./planet";
import type { PackEntry } from "./types";

/** One square on the hero planet: what the canvas draws and where a click goes. */
export interface HeroCity extends LatLng {
  name: string;
  heat: City["heat"];
  weight: number; // exams it was asked in, plus one if it came back
  href: string;
}

export interface HomeSummary {
  hero: { cities: HeroCity[]; course: string; semester: number } | null;
  totals: { papers: number; questions: number; repeats: number; dropped: number };
  /** How repeat finding did against the repeats found by hand, on the one course that has them. */
  checked: { course: string; expected: number; found: number } | null;
}

const round = (x: number) => Math.round(x * 100) / 100; // a hundredth of a degree is far below a pixel

export function homeSummary(entries: PackEntry[]): HomeSummary {
  const first = entries[0];
  const total = (k: "papers" | "questions" | "repeats" | "dropped_bleed_through") => entries.reduce((n, e) => n + e.pack.stats[k], 0);
  const evalPack = entries.find((e) => e.pack.harness?.eval)?.pack;
  const result = evalPack?.harness?.eval;
  return {
    hero: first
      ? {
          cities: buildPlanet(first.pack).cities.map((c) => ({
            lat: round(c.lat),
            lng: round(c.lng),
            name: c.topic.name,
            heat: c.heat,
            weight: c.topic.exams_count + (c.topic.is_repeat ? 1 : 0),
            href: topicHref(first.key, c.subject.id, c.topic.id),
          })),
          course: first.pack.course.name,
          semester: first.pack.course.semester,
        }
      : null,
    totals: { papers: total("papers"), questions: total("questions"), repeats: total("repeats"), dropped: total("dropped_bleed_through") },
    checked: evalPack && result ? { course: evalPack.course.name, expected: result.expected, found: result.found } : null,
  };
}
