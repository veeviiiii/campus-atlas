import type { Metadata } from "next";

import { BackBar, SiteFooter, SiteNav } from "@/components/Chrome";
import SearchView from "@/components/SearchView";

export const metadata: Metadata = {
  title: "Search past paper questions · Campus Atlas",
  description: "Search every question from DAVV, Indore past papers on Campus Atlas: by word, topic or subject, with the exam and a photo of the page.",
};

/** Search every question on the site (the matching runs in the browser, on a static index). */
export default function SearchPage() {
  return (
    <>
      <SiteNav />
      <main className="page">
        <BackBar href="/" label="Home" where="Search" />
        <h1 className="page-title">
          Search <em>questions</em>
        </h1>
        <SearchView />
      </main>
      <SiteFooter />
    </>
  );
}
