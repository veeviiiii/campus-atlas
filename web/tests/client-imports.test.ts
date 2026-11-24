import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

// A server file (no "use client") that imports a plain value from a "use client" file gets a stand-in
// function instead of the value: /send/ and /privacy/ once linked to "function(){throw Error(...)}"
// instead of the GitHub address. From a client file, a server file may take components only.

const SRC = resolve(import.meta.dirname, "../src");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const isClient = (code: string) => /^\s*(\/\/[^\n]*\n\s*)*["']use client["']/.test(code);
// "@/components/Chrome" -> src/components/Chrome; relative paths from the importing file.
const target = (from: string, spec: string) =>
  spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(from, "..", spec) : null;

test("server files take only components from client files", () => {
  const all = files(SRC);
  const client = new Set(all.filter((f) => isClient(readFileSync(f, "utf8"))).map((f) => f.replace(/\.tsx?$/, "")));
  const wrong: string[] = [];
  for (const file of all) {
    const code = readFileSync(file, "utf8");
    if (isClient(code)) continue;
    for (const [, names, spec] of code.matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from\s+["']([^"']+)["']/gm)) {
      const from = target(file, spec);
      if (!from || !client.has(from)) continue;
      for (const part of names.split(",")) {
        const name = part.trim().replace(/^type\s+/, "");
        if (!name || part.trim().startsWith("type ")) continue;
        const imported = name.split(/\s+as\s+/)[0];
        if (!/^[A-Z][a-z]/.test(imported)) wrong.push(`${relative(SRC, file)}: ${imported} from ${spec}`);
      }
    }
  }
  assert.deepEqual(wrong, [], "move these values out of the client file (lib/site.ts holds the site's links)");
});
