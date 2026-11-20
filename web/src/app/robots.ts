import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

// /robots.txt, written at build time.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/search-index.json", "/admin/"] }, // the search page's data; the maintainer's page
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
