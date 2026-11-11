import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackBar, BottomBar, SiteNav } from "@/components/Chrome";
import CourseView from "@/components/CourseView";
import { courseOf } from "@/lib/catalog";
import { findEntry, loadPacks } from "@/lib/packs";
import { courseHref, programmeHref } from "@/lib/paths";
import { examsSummary, examWhen, inOrder, isUndated, noYear, sessionOf, sessionsOf } from "@/lib/papers";

type Params = { college: string; pack: string };

// Static export: one page per pack, nothing at request time.
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return loadPacks().map((e) => {
    const [college, pack] = e.key.split("/");
    return { college, pack };
  });
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { college, pack } = await params;
  const e = findEntry(college, pack);
  if (!e) return { title: "Campus Atlas" };
  const p = e.pack;
  return {
    title: `${p.course.name}, Semester ${p.course.semester} past papers · Campus Atlas`,
    description: `Past papers of ${p.course.name}, Semester ${p.course.semester}, ${p.college.name}, Indore: ${p.stats.papers} paper${p.stats.papers === 1 ? "" : "s"} (${examsSummary(p.sources.exams)}) in ${p.subjects.length} subject${p.subjects.length === 1 ? "" : "s"}, ${p.subjects.map((s) => s.name).join(", ")}.`,
    alternates: { canonical: courseHref(e.key) },
  };
}

export default async function CoursePage({ params }: { params: Promise<Params> }) {
  const { college, pack } = await params;
  const entry = findEntry(college, pack);
  if (!entry) notFound();
  const p = entry.pack;
  const course = courseOf(entry);
  const exams = inOrder(p.sources.exams);
  const sessions = sessionsOf(exams);

  return (
    <>
      <SiteNav />
      <main className="page">
        {course ? (
          <BackBar href={programmeHref(course.id)} label="All semesters" where={p.college.name} />
        ) : (
          <BackBar href="/#browse" label="All courses" where={p.college.name} />
        )}
        <h1 className="page-title">
          {p.course.name} <em>Semester {p.course.semester}</em>
        </h1>
        <div className="exam-chips">
          {sessions.length > 1
            ? sessions.map((s) => (
                <span key={s} className="chip">
                  {s} ·{" "}
                  {exams
                    .filter((e) => sessionOf(e) === s)
                    .map((e) => e.name)
                    .join(", ")}
                </span>
              ))
            : exams
                .filter((e) => !isUndated(e))
                .map((e) => (
                  <span key={e.id} className="chip">
                    {e.name} · {examWhen(e)}
                  </span>
                ))}
          {exams.some(isUndated) && (
            <span className="chip">
              No year printed ·{" "}
              {exams
                .filter(isUndated)
                .map((e) => (noYear(e) === "no year" ? e.name : `${e.name} ${noYear(e).slice("no year ".length)}`))
                .join(", ")}
            </span>
          )}
          {p.mock && <span className="chip hot">Mock data · dev only</span>}
        </div>
        <CourseView entry={entry} />
      </main>
      <BottomBar />
    </>
  );
}
