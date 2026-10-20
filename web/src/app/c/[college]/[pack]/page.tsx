import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter, SiteNav } from "@/components/Chrome";
import CourseView from "@/components/CourseView";
import { findEntry, loadPacks } from "@/lib/packs";
import { examDate } from "@/lib/papers";

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

  return (
    <>
      <SiteNav />
      <main className="page">
        <div className="crumbs mono">
          <Link href="/#browse">Past papers</Link> / {p.college.name}
        </div>
        <h1 className="page-title">
          {p.course.name} <em>Semester {p.course.semester}</em>
        </h1>
        <div className="exam-chips">
          {p.sources.exams.map((e) => (
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
