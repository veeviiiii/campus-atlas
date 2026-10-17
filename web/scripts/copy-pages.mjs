// Copy page photos exported by the pipeline (packs/<college>/pages/*.jpg) into public/pages/<college>/
// so "view original page" works on the static site.
import fs from "node:fs";
import path from "node:path";

const packs = path.resolve("..", "packs");
const out = path.resolve("public", "pages");
fs.rmSync(out, { recursive: true, force: true });

for (const college of fs.existsSync(packs) ? fs.readdirSync(packs) : []) {
  const src = path.join(packs, college, "pages");
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.join(out, college), { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(out, college, f));
  console.log(`copied pages for ${college}`);
}
