import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackBar, SiteFooter, SiteNav } from "@/components/Chrome";
import { courseCards, loadCatalog } from "@/lib/catalog";
import { FIELD_COLORS } from "@/lib/colors";
import { courseHref } from "@/lib/paths";

type Params = { course: string };

// Static export: one page per course in the catalogue (and per pack outside it), nothing at request time.
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return courseCards().map((c) => ({ course: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { course } = await params;
  const c = courseCards().find((x) => x.id === course);
  return {
    title: c ? `${c.name} past papers · Campus Atlas` : "Campus Atlas",
    description: c ? `Past exam papers of ${c.name}, ${c.school}, DAVV Indore, by semester.` : undefined,
  };
}

/** A course: pick the year and semester. Semesters without papers yet are dimmed and ask for them. */
export default async function CoursePage({ params }: { params: Promise<Params> }) {
  const { course } = await params;
  const c = courseCards().find((x) => x.id === course);
  if (!c) notFound();
  const { fields, source } = loadCatalog();
  const field = fields.find((f) => f.id === c.field);
  const years = c.years ?? Math.ceil(Math.max(...c.semesters.map((s) => s.semester)) / 2);

  return (
    <>
      <SiteNav />
      <main className="page">
        <BackBar href="/#browse" label="All courses" where={c.schoolShort ? `${c.school} (${c.schoolShort})` : c.school} />
        <h1 className="page-title">{c.name}</h1>
        <div className="exam-chips">
          {field && (
            <span className="chip">
              <i className="dot" style={{ background: FIELD_COLORS[c.field]?.[0] }} />
              {field.name}
            </span>
          )}
          {c.years && (
            <span className="chip">
              {c.years} years · {c.years * 2} semesters
            </span>
          )}
        </div>

        <div className="years">
          {Array.from({ length: years }, (_, y) => {
            const honours = c.honoursYear && y === years - 1;
            const sems = c.years ? c.semesters.slice(y * 2, y * 2 + 2) : c.semesters.filter((s) => Math.ceil(s.semester / 2) === y + 1);
            if (!sems.length) return null;
            return (
              <section key={y} className="year-row">
                <h2>
                  Year {y + 1}
                  {honours && <span className="mono">Honours / Research (optional)</span>}
                </h2>
                <div className="sem-tiles">
                  {sems.map((s) =>
                    s.key ? (
                      <Link key={s.semester} className="sem-tile ready" href={courseHref(s.key)}>
                        <b>Semester {s.semester}</b>
                        <span className="mono">{s.mock ? "Mock data · dev only" : `${s.papers} papers →`}</span>
                      </Link>
                    ) : (
                      <div key={s.semester} className="sem-tile">
                        <b>Semester {s.semester}</b>
                        <span className="mono">
                          No papers yet · <Link href="/send/">send yours</Link>
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <p className="note">
          Have papers for a semester that isn&apos;t here yet? <Link href="/send/">Send them in →</Link>
        </p>
        {c.years && <p className="note mono">Course list and durations: {source}.</p>}
      </main>
      <SiteFooter />
    </>
  );
}
