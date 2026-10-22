import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { Pack, PackEntry } from "./types";

// Packs live at the repo root (../packs from web/). Read once at build time.
// PACKS_DIR points a local dev server at another folder of packs (e.g. a test fixture); the deploy never sets it.
const PACKS_DIR = process.env.PACKS_DIR ? path.resolve(process.env.PACKS_DIR) : path.join(process.cwd(), "..", "packs");

function findJson(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? findJson(p) : e.name.endsWith(".json") ? [p] : [];
  });
}

/**
 * Real packs if any exist; otherwise the mock pack (flagged `mock: true`, shown with a banner)
 * so the UI can be built before the pipeline finishes.
 */
export function loadPacks(): PackEntry[] {
  const all = findJson(PACKS_DIR)
    .sort()
    .map((file) => ({
      key: path.relative(PACKS_DIR, file).replace(/\\/g, "/").replace(/\.json$/, ""),
      pack: withoutQuizzes(JSON.parse(fs.readFileSync(file, "utf-8")) as Pack),
    }));
  const real = all.filter((e) => !e.pack.mock && !e.key.startsWith("_"));
  return real.length > 0 ? real : all.filter((e) => e.pack.mock);
}

/** The site no longer shows quizzes; dropping them keeps every page's data small. */
function withoutQuizzes(pack: Pack): Pack {
  for (const s of pack.subjects) for (const u of s.units) for (const t of u.topics) t.quiz = [];
  return pack;
}

/** The pack whose key is "<college>/<pack>", for a /c/<college>/<pack>/ page. */
export function findEntry(college: string, pack: string): PackEntry | undefined {
  return loadPacks().find((e) => e.key === `${college}/${pack}`);
}
