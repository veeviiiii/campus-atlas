import Site from "@/components/Site";
import { loadPacks } from "@/lib/packs";

export default function Home() {
  // Read at build time; the site never calls an AI model.
  const entries = loadPacks();
  return <Site entries={entries} />;
}
