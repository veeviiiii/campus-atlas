import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackBar, BottomBar, SiteNav } from "@/components/Chrome";
import SubjectView from "@/components/SubjectView";
import { findEntry, loadPacks } from "@/lib/packs";
import type { Subject } from "@/lib/types";
import { examsSummary } from "@/lib/papers";
import { courseHref, subjectHref } from "@/lib/paths";

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

function questionCount(subject: Subject): number {
  return subject.units.reduce((n, u) => n + u.topics.reduce((m, t) => m + t.questions.length, 0), 0);
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const found = find(await params);
  if (!found) return { title: "Campus Atlas" };
  const { entry, subject } = found;
  const p = entry.pack;
  return {
    title: `${subject.name} past papers · ${p.course.name} · Campus Atlas`,
    description: `${subject.name} past papers of ${p.course.name}, Semester ${p.course.semester}, ${p.college.name}, Indore: ${questionCount(subject)} questions (${examsSummary(p.sources.exams)}), the topics asked most and the marks by unit.`,
    alternates: { canonical: subjectHref(entry.key, subject.id) },
  };
}

export default async function SubjectPage({ params }: { params: Promise<Params> }) {
  const found = find(await params);
  if (!found) notFound();
  const { entry, subject } = found;
  const p = entry.pack;
  const questions = questionCount(subject);
  const aka = subject.aliases.filter((a) => a !== subject.name);

  return (
    <>
      <SiteNav />
      <main className="page">
        <BackBar href={courseHref(entry.key)} label="All subjects" where={`${p.course.name} · Semester ${p.course.semester}`} />
        <h1 className="page-title">{subject.name}</h1>
        <div className="mono" style={{ color: "var(--muted)" }}>
          {p.college.name} · {questions} questions
          {aka.length > 0 && ` · also printed as ${aka.join(", ")}`}
        </div>
        {/* Reloading on #likely, #topic-… or #marks: the static HTML has the Papers tab open. Hide it before
            the first paint (CSS: html[data-deep-tab]) until React opens the other tab, so it never flashes. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `var t=/^#(likely|topic-)/.test(location.hash)?"likely":location.hash==="#marks"?"marks":"";if(t)document.documentElement.setAttribute("data-deep-tab",t)`,
          }}
        />
        <SubjectView collegeId={p.college.id} exams={p.sources.exams} subject={subject} />
        <p className="print-only">
          From Campus Atlas, campus-atlas.vercel.app · {p.course.name}, Semester {p.course.semester}. The questions were read from
          photos of the papers by an AI model and checked by our pipeline; if something looks off, open the original page on the site.
        </p>
      </main>
      <BottomBar />
    </>
  );
}
