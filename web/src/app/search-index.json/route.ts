import { loadPacks } from "@/lib/packs";
import { buildSearchIndex } from "@/lib/search";

// Every question on the site as one static file (/search-index.json), written at build time. The
// search page fetches it only when someone opens it, so no other page gets heavier as papers are added.
export const dynamic = "force-static";

export function GET() {
  return Response.json(buildSearchIndex(loadPacks()));
}
