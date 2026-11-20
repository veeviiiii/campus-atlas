import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReport, pageOf, type Directory, type RawAnalytics } from "../src/lib/analytics-report";
import { seal } from "../src/lib/seal";
import { deviceKey, unseal, unsealWith } from "../src/lib/unseal";

const DIR: Directory = {
  packs: { "davv-sdsf/mtech-aids-dual-sem1": { course: "mtech-aids-dual", semester: 1 }, "davv-sdsf/mtech-aids-dual-sem4": { course: "mtech-aids-dual", semester: 4 } },
  subjects: { "davv-sdsf/mtech-aids-dual-sem1/physics-1": "Physics-I", "davv-sdsf/mtech-aids-dual-sem4/operating-systems": "Operating Systems" },
  courses: { "mtech-aids-dual": "M.Tech AI & DS", "mtech-it-dual": "M.Tech IT" },
};

const row = (key: string, pageviews: number, visitors = pageviews) => ({ key, pageviews, visitors });

test("an address says which page it is", () => {
  assert.deepEqual(pageOf("/"), { kind: "home" });
  assert.deepEqual(pageOf("/course/mtech-it-dual/"), { kind: "course", course: "mtech-it-dual" });
  assert.deepEqual(pageOf("/c/davv-sdsf/mtech-aids-dual-sem1/"), { kind: "semester", pack: "davv-sdsf/mtech-aids-dual-sem1" });
  assert.deepEqual(pageOf("/c/davv-sdsf/mtech-aids-dual-sem1/physics-1"), { kind: "subject", pack: "davv-sdsf/mtech-aids-dual-sem1", subject: "physics-1" });
  assert.deepEqual(pageOf("/search/?q=lorentz"), { kind: "search" });
  assert.deepEqual(pageOf("/upload/"), { kind: "send" });
});

test("page views add up to courses, semesters and subjects", () => {
  const raw: RawAnalytics = {
    fetchedAt: "2026-11-20T10:00:00Z",
    since: "2026-11-18",
    until: "2026-11-20",
    daily: [row("2026-11-18T00:00:00.000Z", 10, 4), row("2026-11-20T00:00:00.000Z", 6, 3)],
    paths: [
      row("/", 5),
      row("/course/mtech-aids-dual/", 2),
      row("/course/mtech-it-dual/", 1),
      row("/c/davv-sdsf/mtech-aids-dual-sem1/", 3),
      row("/c/davv-sdsf/mtech-aids-dual-sem1/physics-1/", 4),
      row("/c/davv-sdsf/mtech-aids-dual-sem4/operating-systems/", 7),
      row("/search/", 2),
    ],
    countries: [row("IN", 15), row("", 1)],
    devices: [row("mobile", 12)],
    referrers: [row("", 9), row("whatsapp.com", 3)],
  };
  const r = buildReport(raw, DIR);

  assert.deepEqual(r.totals, { visits: 7, views: 16, subjectViews: 11, searchViews: 2 }); // visits: 4 + 0 + 3, day by day
  assert.deepEqual(r.daily.map((d) => [d.date, d.visits]), [["2026-11-18", 4], ["2026-11-19", 0], ["2026-11-20", 3]]); // a day nobody came is a 0
  assert.deepEqual(r.courses, [
    { name: "M.Tech AI & DS", detail: undefined, views: 16 }, // its course page, a semester page and two subject pages
    { name: "M.Tech IT", detail: undefined, views: 1 },
  ]);
  assert.deepEqual(r.semesters, [
    { name: "Semester 4", detail: "M.Tech AI & DS", views: 7 },
    { name: "Semester 1", detail: "M.Tech AI & DS", views: 7 },
  ].sort((a, b) => b.views - a.views || a.name.localeCompare(b.name)));
  assert.deepEqual(r.subjects.map((s) => [s.name, s.detail, s.views]), [
    ["Operating Systems", "M.Tech AI & DS · Sem 4", 7],
    ["Physics-I", "M.Tech AI & DS · Sem 1", 4],
  ]);
  assert.equal(r.countries[0].name, "India");
  assert.equal(r.devices[0].name, "Mobile");
  assert.equal(r.referrers[0].name, "No referrer (typed or shared link)");
});

test("a fetch that failed is reported, with nothing counted", () => {
  const r = buildReport({ fetchedAt: "2026-11-20T10:00:00Z", since: "2026-10-22", until: "2026-11-20", error: "day: HTTP 403" }, DIR);
  assert.equal(r.error, "day: HTTP 403");
  assert.deepEqual(r.totals, { visits: 0, views: 0, subjectViews: 0, searchViews: 0 });
  assert.deepEqual(r.daily, []);
});

test("the admin data opens with the right password only", async () => {
  const sealed = seal('{"visits":7}', "a long admin password", 1000); // few iterations: a test, not a lock
  assert.ok(!sealed.data.includes("visits"));
  assert.equal(await unseal(sealed, "a long admin password"), '{"visits":7}');
  assert.equal(await unseal(sealed, "a wrong password"), null);
});

test("the key a device keeps opens later builds too, and only with the same password", async () => {
  const today = seal('{"day":1}', "a long admin password", 1000);
  const tomorrow = seal('{"day":2}', "a long admin password", 1000); // the daily rebuild: a new salt and iv
  assert.notEqual(today.salt, tomorrow.salt);
  const kept = await deviceKey("a long admin password", 1000);
  assert.equal(await unsealWith(today, kept), '{"day":1}');
  assert.equal(await unsealWith(tomorrow, kept), '{"day":2}');
  const changed = seal('{"day":3}', "a new admin password", 1000); // the maintainer changed ADMIN_PASSWORD
  assert.equal(await unsealWith(changed, kept), null);
});
