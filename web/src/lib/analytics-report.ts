// /admin/'s report: the raw Vercel Web Analytics rows (scripts/fetch-analytics.mjs) turned into what a
// maintainer wants to know: visits by day, and which courses, semesters and subjects are opened most.
// Every page of the site has its own address, so a page view of /c/<college>/<pack>/<subject>/ is one
// look at that subject's papers. Pure: the page passes in the names from the packs and the catalog.

export interface Row {
  key: string;
  pageviews: number;
  visitors: number;
}

export interface RawAnalytics {
  fetchedAt: string;
  since: string;
  until: string;
  error?: string;
  daily?: Row[];
  paths?: Row[];
  countries?: Row[];
  devices?: Row[];
  referrers?: Row[];
}

/** Names for the addresses: pack key ("davv-sdsf/mtech-aids-dual-sem1") -> its course and semester,
 *  "<pack key>/<subject id>" -> the subject's name, course id -> the course's name. */
export interface Directory {
  packs: Record<string, { course: string; semester: number }>;
  subjects: Record<string, string>;
  courses: Record<string, string>;
}

export interface Bar {
  name: string;
  detail?: string;
  views: number;
}

export interface Report {
  fetchedAt: string;
  since: string;
  until: string;
  error?: string;
  /** visits: Vercel's visitors added up day by day (it forgets a visitor after 24 hours). */
  totals: { visits: number; views: number; subjectViews: number; searchViews: number };
  daily: { date: string; visits: number; views: number }[];
  pages: Bar[];
  courses: Bar[];
  semesters: Bar[];
  subjects: Bar[];
  countries: Bar[];
  devices: Bar[];
  referrers: Bar[];
}

type Page =
  | { kind: "home" | "search" | "send" | "other" }
  | { kind: "course"; course: string }
  | { kind: "semester"; pack: string }
  | { kind: "subject"; pack: string; subject: string };

const PAGE_NAMES: Record<Page["kind"], string> = {
  home: "Home",
  course: "Course pages",
  semester: "Semester pages",
  subject: "Subject pages (papers)",
  search: "Search",
  send: "Send / upload papers",
  other: "Other",
};

/** What an address is: "/c/davv-sdsf/mtech-aids-dual-sem1/physics-1/" is the Physics-I page. */
export function pageOf(address: string): Page {
  const parts = address.split(/[?#]/)[0].split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "home" };
  if (parts[0] === "course" && parts.length === 2) return { kind: "course", course: parts[1] };
  if (parts[0] === "c" && parts.length === 3) return { kind: "semester", pack: `${parts[1]}/${parts[2]}` };
  if (parts[0] === "c" && parts.length === 4) return { kind: "subject", pack: `${parts[1]}/${parts[2]}`, subject: parts[3] };
  if (parts[0] === "search") return { kind: "search" };
  if (parts[0] === "send" || parts[0] === "upload") return { kind: "send" };
  return { kind: "other" };
}

const add = (m: Map<string, Bar>, name: string, views: number, detail?: string) => {
  const key = `${name}\u0000${detail ?? ""}`;
  const bar = m.get(key) ?? { name, detail, views: 0 };
  bar.views += views;
  m.set(key, bar);
};
const top = (m: Map<string, Bar>, n: number) => [...m.values()].filter((b) => b.views > 0).sort((a, b) => b.views - a.views || a.name.localeCompare(b.name)).slice(0, n);

function regionName(code: string): string {
  if (!code) return "Unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every day from since to until, with 0 for a day nobody came. */
function days(since: string, until: string, rows: Row[]): Report["daily"] {
  const by = new Map(rows.map((r) => [r.key.slice(0, 10), r]));
  const out: Report["daily"] = [];
  for (let d = new Date(`${since}T00:00:00Z`); d <= new Date(`${until}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) {
    const date = d.toISOString().slice(0, 10);
    const r = by.get(date);
    out.push({ date, visits: r?.visitors ?? 0, views: r?.pageviews ?? 0 });
  }
  return out;
}

export function buildReport(raw: RawAnalytics, dir: Directory): Report {
  const daily = raw.error ? [] : days(raw.since, raw.until, raw.daily ?? []);
  const pages = new Map<string, Bar>();
  const courses = new Map<string, Bar>();
  const semesters = new Map<string, Bar>();
  const subjects = new Map<string, Bar>();
  const courseName = (id: string) => dir.courses[id] ?? id;
  let subjectViews = 0;
  let searchViews = 0;

  for (const row of raw.paths ?? []) {
    const page = pageOf(row.key);
    const views = row.pageviews;
    add(pages, PAGE_NAMES[page.kind], views);
    if (page.kind === "course") add(courses, courseName(page.course), views);
    if (page.kind === "search") searchViews += views;
    if (page.kind === "semester" || page.kind === "subject") {
      const p = dir.packs[page.pack];
      const course = p ? courseName(p.course) : page.pack;
      const semester = p ? `Semester ${p.semester}` : page.pack;
      add(courses, course, views);
      add(semesters, semester, views, course);
      if (page.kind === "subject") {
        subjectViews += views;
        add(subjects, dir.subjects[`${page.pack}/${page.subject}`] ?? page.subject, views, p ? `${course} · Sem ${p.semester}` : page.pack);
      }
    }
  }

  const named = (rows: Row[] | undefined, name: (k: string) => string, n: number) => {
    const m = new Map<string, Bar>();
    for (const r of rows ?? []) add(m, name(r.key), r.pageviews);
    return top(m, n);
  };

  return {
    fetchedAt: raw.fetchedAt,
    since: raw.since,
    until: raw.until,
    ...(raw.error ? { error: raw.error } : {}),
    totals: {
      visits: daily.reduce((n, d) => n + d.visits, 0),
      views: daily.reduce((n, d) => n + d.views, 0),
      subjectViews,
      searchViews,
    },
    daily,
    pages: top(pages, 10),
    courses: top(courses, 10),
    semesters: top(semesters, 10),
    subjects: top(subjects, 12),
    countries: named(raw.countries, regionName, 8),
    devices: named(raw.devices, (k) => (k ? k[0].toUpperCase() + k.slice(1) : "Unknown"), 5),
    referrers: named(raw.referrers, (k) => k || "No referrer (typed or shared link)", 8),
  };
}
