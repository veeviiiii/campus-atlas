import type { MetadataRoute } from "next";

import { courseCards } from "@/lib/catalog";
import { loadPacks } from "@/lib/packs";
import { courseHref, programmeHref, subjectHref } from "@/lib/paths";
import { SITE_URL } from "@/lib/site";

// /sitemap.xml, written at build time: every page of the static site, so search engines find each
// course, semester and subject (students search for "<subject> DAVV previous year papers").
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const entries = loadPacks().filter((e) => !e.pack.mock);
  const paths = [
    "/",
    "/search/",
    "/send/",
    ...courseCards(entries).map((c) => programmeHref(c.id)),
    ...entries.flatMap((e) => [courseHref(e.key), ...e.pack.subjects.map((s) => subjectHref(e.key, s.id))]),
  ];
  return paths.map((p) => ({ url: `${SITE_URL}${p}` }));
}
