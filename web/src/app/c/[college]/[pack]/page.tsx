import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackBar, SiteFooter, SiteNav } from "@/components/Chrome";
import CourseView from "@/components/CourseView";
import { courseOf } from "@/lib/catalog";
import { findEntry, loadPacks } from "@/lib/packs";
import { programmeHref } from "@/lib/paths";
import { examDate, inOrder, sessionOf, sessionsOf } from "@/lib/papers";

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
  return { title: e ? `${e.pack.course.name}, Semester ${e.pack.course.semester} · Campus Atlas` : "Campus Atlas" };
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
            : exams.map((e) => (
                <span key={e.id} className="chip">
                  {e.name} · {examDate(e.date)}
                </span>
              ))}
          {p.mock && <span className="chip hot">Mock data · dev only</span>}
        </div>
        <CourseView entry={entry} />
      </main>
      <SiteFooter />
    </>
  );
}
