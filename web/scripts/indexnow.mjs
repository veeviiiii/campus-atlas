// Tells Bing (and the other search engines that use IndexNow) that the site's pages changed, so they read
// them again within hours or days instead of whenever they next pass by. Run it by hand, in web/, after a
// change people should see in search results (new papers, a new title or icon):
//   node scripts/indexnow.mjs
// It sends the public addresses in the live /sitemap.xml and nothing else. The key is public by design:
// public/<key>.txt, served at the site's root, shows that the request comes from whoever runs the site.
import { readdirSync } from "node:fs";

import { SITE_URL } from "../src/lib/site.ts";

const keyFile = readdirSync(new URL("../public/", import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error("No IndexNow key file (32 hex characters, then .txt) in web/public/");
const key = keyFile.slice(0, -4);

const sitemap = await fetch(`${SITE_URL}/sitemap.xml`);
if (!sitemap.ok) throw new Error(`${SITE_URL}/sitemap.xml: HTTP ${sitemap.status}`);
const urlList = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE_URL).host, key, keyLocation: `${SITE_URL}/${key}.txt`, urlList }),
});
// 200: accepted. 202: accepted, the key is still being checked. 403: the key file is not live yet.
// 422: an address is not on this site. 429: too many requests, try later.
console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} pages${res.ok ? "" : `: ${await res.text()}`}`);
if (!res.ok) process.exitCode = 1;
