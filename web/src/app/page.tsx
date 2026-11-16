import type { Metadata } from "next";

import Site from "@/components/Site";
import { courseCards, loadCatalog } from "@/lib/catalog";
import { homeSummary } from "@/lib/home";
import { loadPacks } from "@/lib/packs";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  // Read at build time; the site never calls an AI model. The page gets a summary, not the packs.
  const entries = loadPacks();
  return <Site summary={homeSummary(entries)} courses={courseCards(entries)} fields={loadCatalog().fields} />;
}
