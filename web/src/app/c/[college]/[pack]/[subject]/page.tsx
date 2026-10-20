import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter, SiteNav } from "@/components/Chrome";
import SubjectView from "@/components/SubjectView";
import { findEntry, loadPacks } from "@/lib/packs";
import { courseHref } from "@/lib/paths";

type Params = { college: string; pack: string; subject: string };

// Static export: one page per subject of every pack, nothing at request time.
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return loadPacks().flatMap((e) => {
    const [college, pack] = e.key.split("/");
    return e.pack.subjects.map((s) => ({ college, pack, subject: s.id }));
  });
}

function find(params: Params) {
  const entry = findEntry(params.college, params.pack);
  const subject = entry?.pack.subjects.find((s) => s.id === params.subject);
  return entry && subject ? { entry, subject } : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const found = find(await params);
  return {
    title: found ? `${found.subject.name} past papers · ${found.entry.pack.course.name} · Campus Atlas` : "Campus Atlas",
  };
}

export default async function SubjectPage({ params }: { params: Promise<Params> }) {
  const found = find(await params);
  if (!found) notFound();
  const { entry, subject } = found;
  const p = entry.pack;
  const questions = subject.units.reduce((n, u) => n + u.topics.reduce((m, t) => m + t.questions.length, 0), 0);
  const aka = subject.aliases.filter((a) => a !== subject.name);

  return (
    <>
      <SiteNav />
      <main className="page">
        <div className="crumbs mono">
          <Link href="/#browse">Past papers</Link> / <Link href={courseHref(entry.key)}>{p.course.name}, Semester {p.course.semester}</Link>
        </div>
        <h1 className="page-title">{subject.name}</h1>
        <div className="mono" style={{ color: "var(--muted)" }}>
          {p.college.name} · {questions} questions
          {aka.length > 0 && ` · also printed as ${aka.join(", ")}`}
        </div>
        <SubjectView collegeId={p.college.id} exams={p.sources.exams} subject={subject} />
      </main>
      <SiteFooter />
    </>
  );
}
