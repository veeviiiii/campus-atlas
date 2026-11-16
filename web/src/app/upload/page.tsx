import type { Metadata } from "next";

import { BackBar, BottomBar, SiteNav } from "@/components/Chrome";
import UploadView from "@/components/UploadView";
import { courseCards } from "@/lib/catalog";
import { loadPacks } from "@/lib/packs";
import { SEND_PAPERS_FORM } from "@/lib/site";
import type { UploadCourse } from "@/lib/uploads";

export const metadata: Metadata = {
  title: "Upload a paper · Campus Atlas",
  description: "Sign in with Google, upload photos of a past DAVV exam paper, and see when it goes live on Campus Atlas.",
  alternates: { canonical: "/upload/" },
};

/**
 * Upload a paper on the site and follow what becomes of it. The page itself is static like every
 * other; the sign-in, the form and "My uploads" run in the browser (components/UploadView.tsx).
 * Without the two NEXT_PUBLIC_SUPABASE_ variables it points to the Google Form instead.
 */
export default function UploadPage() {
  const entries = loadPacks().filter((e) => !e.pack.mock);
  // The catalogue's courses (uploads for a course that is not listed go through the Google Form).
  const courses: UploadCourse[] = courseCards(entries)
    .filter((c) => c.years !== null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      school: c.schoolShort ?? c.school,
      semesters: c.semesters.length,
      subjects: Object.fromEntries(
        c.semesters.filter((s) => s.key).map((s) => [s.semester, entries.find((e) => e.key === s.key)?.pack.subjects.map((x) => x.name) ?? []]),
      ),
    }));

  return (
    <>
      <SiteNav />
      <main className="page send">
        <BackBar href="/send/" label="Send us your papers" where="Upload a paper" />
        <h1 className="page-title">
          Upload a <em>paper</em>
        </h1>
        <p className="lead">
          One paper at a time: every page, in order. We read it, check it by hand and add it to the site; you can see here when it is live,
          and we may ask you a question about it (which year it was, for instance).
        </p>
        <UploadView courses={courses} formUrl={SEND_PAPERS_FORM} />
      </main>
      <BottomBar />
    </>
  );
}
