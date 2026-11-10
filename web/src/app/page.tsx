import type { Metadata } from "next";

import Site from "@/components/Site";
import { courseCards, loadCatalog } from "@/lib/catalog";
import { loadPacks } from "@/lib/packs";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  // Read at build time; the site never calls an AI model.
  const entries = loadPacks();
  return <Site entries={entries} courses={courseCards(entries)} fields={loadCatalog().fields} />;
}
