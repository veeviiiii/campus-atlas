import Site from "@/components/Site";
import { courseCards, loadCatalog } from "@/lib/catalog";
import { loadPacks } from "@/lib/packs";

export default function Home() {
  // Read at build time; the site never calls an AI model.
  const entries = loadPacks();
  const catalog = loadCatalog();
  return <Site entries={entries} courses={courseCards(entries)} fields={catalog.fields} source={catalog.source} />;
}
