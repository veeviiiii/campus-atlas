import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanViewUrl, counted } from "../src/lib/analytics";

const SITE = "https://campus-atlas.vercel.app";

test("a page view keeps its path and query, without the part after #", () => {
  assert.equal(cleanViewUrl(`${SITE}/c/davv-sdsf/mtech-aids-dual-sem1/physics-1/#topic-lasers`), `${SITE}/c/davv-sdsf/mtech-aids-dual-sem1/physics-1/`);
  assert.equal(cleanViewUrl(`${SITE}/search/?q=lorentz`), `${SITE}/search/?q=lorentz`);
  assert.equal(cleanViewUrl(`${SITE}/?field=engineering#browse`), `${SITE}/?field=engineering`);
});

test("the maintainer's own look at /admin/ is not counted", () => {
  assert.equal(counted(`${SITE}/admin/`), false);
  assert.equal(counted(`${SITE}/c/davv-sdsf/mtech-aids-dual-sem1/`), true);
});

test("the upload page never sends its sign-in code", () => {
  assert.equal(cleanViewUrl(`${SITE}/upload/?code=secret-one-time-code`), `${SITE}/upload/`);
  assert.equal(cleanViewUrl(`${SITE}/upload/#access_token=secret&refresh_token=secret`), `${SITE}/upload/`);
});
