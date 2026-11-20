import type { Metadata } from "next";

import AdminView, { type AdminState } from "@/components/AdminView";
import { BackBar, SiteNav } from "@/components/Chrome";
import { loadAnalytics } from "@/lib/analytics-data";
import { buildReport, type Directory } from "@/lib/analytics-report";
import { loadCatalog } from "@/lib/catalog";
import { loadPacks } from "@/lib/packs";
import { seal } from "@/lib/seal";

export const metadata: Metadata = {
  title: "Admin · Campus Atlas",
  robots: { index: false, follow: false },
};

const MIN_PASSWORD = 12;

/**
 * /admin/: the site's visits and which courses, semesters and subjects are opened most, from Vercel Web
 * Analytics. The page is public static HTML, so the report is built here at build time and locked with
 * ADMIN_PASSWORD (lib/seal.ts); the browser opens it only with that password.
 */
export default function AdminPage() {
  const password = process.env.ADMIN_PASSWORD ?? "";
  const raw = loadAnalytics();
  let state: AdminState;
  if (!password) state = { kind: "no-password" };
  else if (password.length < MIN_PASSWORD) state = { kind: "weak-password", min: MIN_PASSWORD };
  else if (!raw) state = { kind: "no-data" };
  else {
    const entries = loadPacks().filter((e) => !e.pack.mock);
    const dir: Directory = {
      packs: Object.fromEntries(entries.map((e) => [e.key, { course: e.pack.course.id, semester: e.pack.course.semester }])),
      subjects: Object.fromEntries(entries.flatMap((e) => e.pack.subjects.map((s) => [`${e.key}/${s.id}`, s.name]))),
      courses: {
        ...Object.fromEntries(entries.map((e) => [e.pack.course.id, e.pack.course.name])),
        ...Object.fromEntries(loadCatalog().courses.map((c) => [c.id, c.name])),
      },
    };
    state = { kind: "locked", sealed: seal(JSON.stringify(buildReport(raw, dir)), password) };
  }

  return (
    <>
      <SiteNav />
      <main className="page admin">
        <BackBar href="/" label="Home" where="Admin" />
        <AdminView state={state} />
      </main>
    </>
  );
}
