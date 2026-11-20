// Before each build: the last 30 days of Vercel Web Analytics, for /admin/ and the visits number on the
// home page. Written to web/.analytics.json (gitignored); the build reads it, the browser never sees the
// token. Without VERCEL_ANALYTICS_TOKEN (CI, a laptop) it writes nothing. A failed fetch is written
// down with its reason and never fails the build.
//
// Env (Vercel project settings; never NEXT_PUBLIC_, so nothing reaches the browser):
//   VERCEL_ANALYTICS_TOKEN  a Vercel access token (Account settings -> Tokens)
//   VERCEL_PROJECT_ID       set by Vercel on every build; on a laptop, the project's id
//   VERCEL_ANALYTICS_TEAM   the team's slug (the name in vercel.com/<slug>/campus-atlas); empty for a personal account
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(".analytics.json");
const API = "https://api.vercel.com/v1/query/web-analytics/visits/aggregate";
const DAYS = 30; // Hobby keeps one month

const token = process.env.VERCEL_ANALYTICS_TOKEN;
const project = process.env.VERCEL_PROJECT_ID;
const team = process.env.VERCEL_ANALYTICS_TEAM;

const day = (d) => d.toISOString().slice(0, 10);

async function query(by, since, until, limit) {
  const params = new URLSearchParams({ projectId: project, since, until, by });
  if (team) params.set(team.startsWith("team_") ? "teamId" : "slug", team);
  if (limit) params.set("limit", String(limit));
  const res = await fetch(`${API}?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${by}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return (body.data ?? []).map((row) => ({
    key: String(row[by] ?? row.timestamp ?? ""),
    pageviews: Number(row.pageviews) || 0,
    visitors: Number(row.visitors) || 0,
  }));
}

async function main() {
  fs.rmSync(OUT, { force: true }); // never a stale file from an earlier build
  if (!token) return console.log("analytics: no VERCEL_ANALYTICS_TOKEN, skipped");
  const until = new Date();
  const since = new Date(until.getTime() - (DAYS - 1) * 86400000);
  const range = [day(since), day(until)];
  let data;
  try {
    if (!project) throw new Error("VERCEL_PROJECT_ID is not set");
    const [daily, paths, countries, devices, referrers] = await Promise.all([
      query("day", ...range),
      query("requestPath", ...range, 500),
      query("country", ...range, 10),
      query("deviceType", ...range, 5),
      query("referrerHostname", ...range, 10),
    ]);
    data = { fetchedAt: new Date().toISOString(), since: range[0], until: range[1], daily, paths, countries, devices, referrers };
    console.log(`analytics: ${daily.length} days, ${paths.length} pages`);
  } catch (e) {
    data = { fetchedAt: new Date().toISOString(), since: range[0], until: range[1], error: String(e?.message ?? e).slice(0, 300) };
    console.log(`analytics: not fetched (${data.error})`);
  }
  fs.writeFileSync(OUT, JSON.stringify(data));
}

await main();
