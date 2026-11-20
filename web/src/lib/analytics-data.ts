import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { RawAnalytics } from "./analytics-report";

// What scripts/fetch-analytics.mjs fetched from Vercel before this build, if it ran (it needs the token).
const FILE = path.join(process.cwd(), ".analytics.json");

export function loadAnalytics(): RawAnalytics | null {
  return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf-8")) as RawAnalytics) : null;
}

/** The home page's visits number: Vercel's visitors over the last 30 days, added up day by day. Null
 *  when this build has no analytics or the fetch failed, so the home page shows no number at all. */
export function visitsLast30Days(): number | null {
  const raw = loadAnalytics();
  if (!raw || raw.error || !raw.daily) return null;
  return raw.daily.reduce((n, d) => n + d.visitors, 0);
}
