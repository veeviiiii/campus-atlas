import type { Metadata } from "next";

import Site from "@/components/Site";
import { visitsLast30Days } from "@/lib/analytics-data";
import { courseCards, loadCatalog } from "@/lib/catalog";
import { homeSummary } from "@/lib/home";
import { loadPacks } from "@/lib/packs";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = { alternates: { canonical: "/" } };

// Tells search engines the site's name, so a result says "Campus Atlas" rather than "vercel.app".
const WEBSITE = { "@context": "https://schema.org", "@type": "WebSite", name: "Campus Atlas", url: `${SITE_URL}/` };

export default function Home() {
  // Read at build time; the site never calls an AI model. The page gets a summary, not the packs.
  const entries = loadPacks();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE).replace(/</g, "\\u003c") }} />
      <Site summary={homeSummary(entries)} visits={visitsLast30Days()} courses={courseCards(entries)} fields={loadCatalog().fields} />
    </>
  );
}
