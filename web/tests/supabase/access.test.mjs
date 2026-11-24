// Access rules of supabase/migrations/ (0001_uploads.sql, 0002_keep_alive.sql), tried against a real
// (test) Supabase project: every forbidden thing a signed-out visitor, another student or a banned
// account might try must fail.
//
// Run from web/ after the migrations have been run on the TEST project (never the live one: this
// creates and deletes accounts and uploads):
//   npm run test:access
// with these in web/.env.test.local (not committed) or in the shell:
//   SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, SUPABASE_TEST_SERVICE_KEY
// The test project keeps the Email provider ON (Authentication > Providers), so the test accounts
// can sign in with a password; the live project uses Google only.
// Without those variables every test is skipped, so `npm test` and CI never need a database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY;
const skip = !URL || !ANON || !SERVICE ? "set SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY and SUPABASE_TEST_SERVICE_KEY to run" : false;

const BUCKET = "paper-uploads";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const FORM = { course_id: "bca", semester: 1, subject: "Access test paper", exam_kind: "mst1", session: "2025-26", page_count: 1 };
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9])], { type: "image/jpeg" });

describe("paper uploads: who may do what", { skip }, () => {
  /** @type {import("@supabase/supabase-js").SupabaseClient} */
  let admin; // service key: skips every rule, as the maintainer's laptop does
  let visitor; // not signed in
  const people = {}; // a, b: students · banned: a banned account. Each { id, db }
  let upload; // a's first upload

  async function signUp(name) {
    const email = `access-test-${name}-${randomUUID()}@example.com`;
    const password = randomUUID();
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(made.error, null, `create ${name}: ${made.error?.message}`);
    const db = createClient(URL, ANON, options);
    const signedIn = await db.auth.signInWithPassword({ email, password });
    assert.equal(signedIn.error, null, `sign in ${name}: ${signedIn.error?.message} (is the Email provider on in the TEST project?)`);
    people[name] = { id: made.data.user.id, db };
  }

  const add = (db, row = FORM) => db.from("paper_uploads").insert(row).select().single();
  const asAdmin = (id) => admin.from("paper_uploads").select("*").eq("id", id).single();
  const put = (db, path, body = jpeg(), opts = {}) => db.storage.from(BUCKET).upload(path, body, { contentType: body.type, ...opts });

  before(async () => {
    admin = createClient(URL, SERVICE, options);
    visitor = createClient(URL, ANON, options);
    await Promise.all(["a", "b", "banned"].map(signUp));
    const ban = await admin.from("banned_users").insert({ user_id: people.banned.id, reason: "access test" });
    assert.equal(ban.error, null, ban.error?.message);
    const made = await add(people.a.db);
    assert.equal(made.error, null, `a student could not add an upload: ${made.error?.message}`);
    upload = made.data;
  });

  after(async () => {
    if (!admin) return;
    for (const { id } of Object.values(people)) {
      const folders = (await admin.storage.from(BUCKET).list(id)).data ?? [];
      for (const f of folders) {
        const files = (await admin.storage.from(BUCKET).list(`${id}/${f.name}`)).data ?? [];
        if (files.length) await admin.storage.from(BUCKET).remove(files.map((x) => `${id}/${f.name}/${x.name}`));
      }
      await admin.auth.admin.deleteUser(id); // their uploads and ban go with them (on delete cascade)
    }
  });

  test("a new upload is the student's own, waiting, with nothing from the maintainer on it", () => {
    assert.equal(upload.uploader, people.a.id);
    assert.deepEqual([upload.status, upload.message, upload.answer, upload.pack_key], ["pending", null, null, null]);
  });

  test("a signed-out visitor can neither read nor add uploads", async () => {
    const read = await visitor.from("paper_uploads").select("id");
    assert.ok(read.error || read.data.length === 0, "a visitor read uploads");
    assert.ok((await add(visitor)).error, "a visitor added an upload");
    assert.ok((await visitor.from("banned_users").select("user_id")).error, "a visitor read the ban list");
  });

  test("a student cannot set what only the maintainer sets", async () => {
    for (const extra of [{ status: "published" }, { message: "looks fine" }, { pack_key: "davv-sdsf/x-sem1" }, { answer: "2024" }, { uploader: people.b.id }, { id: randomUUID() }]) {
      const res = await add(people.a.db, { ...FORM, ...extra });
      assert.ok(res.error, `an insert with ${Object.keys(extra)[0]} was accepted`);
    }
  });

  test("the form's own checks hold", async () => {
    for (const bad of [{ semester: 11 }, { exam_kind: "final" }, { session: "2025" }, { course_id: "BCA; drop" }, { page_count: 13 }, { subject: "x" }, { note: "n".repeat(501) }]) {
      const res = await add(people.a.db, { ...FORM, ...bad });
      assert.ok(res.error, `accepted ${JSON.stringify(bad).slice(0, 40)}`);
    }
  });

  test("another student cannot see, change or delete the upload", async () => {
    const { db } = people.b;
    assert.deepEqual((await db.from("paper_uploads").select("id").eq("id", upload.id)).data ?? [], []);
    await db.from("paper_uploads").delete().eq("id", upload.id);
    await db.from("paper_uploads").update({ subject: "changed" }).eq("id", upload.id);
    assert.ok((await db.rpc("answer_upload", { upload_id: upload.id, answer_text: "2024-25" })).error);
    const now = (await asAdmin(upload.id)).data;
    assert.deepEqual([now?.subject, now?.answer], [FORM.subject, null]);
    assert.equal((await db.from("banned_users").select("user_id")).data?.length ?? 0, 0, "a student read the ban list");
  });

  test("nor can the uploader change it directly", async () => {
    await people.a.db.from("paper_uploads").update({ status: "published", subject: "changed" }).eq("id", upload.id);
    const now = (await asAdmin(upload.id)).data;
    assert.deepEqual([now.status, now.subject], ["pending", FORM.subject]);
  });

  test("pages go only into your own waiting upload, as photos or PDFs", async () => {
    const mine = `${people.a.id}/${upload.id}`;
    assert.equal((await put(people.a.db, `${mine}/01.jpg`)).error, null);
    assert.ok((await put(people.b.db, `${mine}/02.jpg`)).error, "another student put a page into the upload");
    assert.ok((await put(people.b.db, `${people.b.id}/${upload.id}/01.jpg`)).error, "a page was stored under someone else's upload id");
    assert.ok((await put(people.a.db, `${people.a.id}/${randomUUID()}/01.jpg`)).error, "a page was stored for an upload that does not exist");
    assert.ok((await put(people.a.db, `${mine}/extra/02.jpg`)).error, "a page was stored in a sub-folder");
    assert.ok((await put(people.a.db, `${mine}/page two.jpg`)).error, "a file not named NN.ext was stored");
    assert.ok((await put(people.a.db, `${mine}/02.jpg`, new Blob(["<script>"], { type: "text/html" }))).error, "an HTML file was stored");
    assert.ok((await put(people.a.db, `${mine}/01.jpg`, jpeg(), { upsert: true })).error, "a stored page was replaced");
    assert.ok((await put(visitor, `${mine}/03.jpg`)).error, "a visitor stored a page");
  });

  test("a file over 10 MB is refused", async () => {
    const big = new Blob([new Uint8Array(10 * 1024 * 1024 + 1024)], { type: "image/jpeg" });
    assert.ok((await put(people.a.db, `${people.a.id}/${upload.id}/09.jpg`, big)).error);
  });

  test("nobody else can list or download the pages", async () => {
    const mine = `${people.a.id}/${upload.id}`;
    assert.equal((await people.a.db.storage.from(BUCKET).download(`${mine}/01.jpg`)).error, null);
    for (const db of [people.b.db, visitor]) {
      assert.ok((await db.storage.from(BUCKET).download(`${mine}/01.jpg`)).error, "a page was downloaded by someone else");
      assert.deepEqual((await db.storage.from(BUCKET).list(mine)).data ?? [], []);
      await db.storage.from(BUCKET).remove([`${mine}/01.jpg`]);
    }
    assert.equal((await people.a.db.storage.from(BUCKET).download(`${mine}/01.jpg`)).error, null, "someone else deleted the page");
    const open = await fetch(`${URL}/storage/v1/object/public/${BUCKET}/${mine}/01.jpg`);
    assert.notEqual(open.status, 200, "the page has a public address");
  });

  test("an upload holds at most 12 pages", async () => {
    const mine = `${people.a.id}/${upload.id}`;
    for (let n = 2; n <= 12; n++) assert.equal((await put(people.a.db, `${mine}/${String(n).padStart(2, "0")}.jpg`)).error, null, `page ${n}`);
    assert.ok((await put(people.a.db, `${mine}/13.jpg`)).error, "a 13th page was stored");
  });

  test("a held upload can be answered by its uploader, and only then", async () => {
    const { db } = people.a;
    assert.ok((await db.rpc("answer_upload", { upload_id: upload.id, answer_text: "2024-25" })).error, "answered an upload nobody asked about");
    await admin.from("paper_uploads").update({ status: "held", message: "Which year was this?" }).eq("id", upload.id);
    assert.equal((await db.from("paper_uploads").select("message").eq("id", upload.id).single()).data.message, "Which year was this?");
    assert.ok((await db.rpc("answer_upload", { upload_id: upload.id, answer_text: "  " })).error, "an empty answer was accepted");
    assert.equal((await db.rpc("answer_upload", { upload_id: upload.id, answer_text: " 2024-25 " })).error, null);
    const now = (await asAdmin(upload.id)).data;
    assert.deepEqual([now.status, now.answer], ["held", "2024-25"]);
  });

  test("once it is no longer waiting, the uploader cannot delete it or add pages", async () => {
    // (still held from the test before)
    await people.a.db.from("paper_uploads").delete().eq("id", upload.id);
    assert.ok((await asAdmin(upload.id)).data, "a held upload was deleted by its uploader");
    const mine = `${people.a.id}/${upload.id}`;
    await people.a.db.storage.from(BUCKET).remove([`${mine}/12.jpg`]);
    assert.equal((await admin.storage.from(BUCKET).list(mine)).data.length, 12, "a page of a held upload was deleted");
    await admin.from("paper_uploads").update({ status: "published", pack_key: "davv-sdsf/x-sem1" }).eq("id", upload.id);
    await admin.storage.from(BUCKET).remove([`${mine}/12.jpg`]);
    assert.ok((await put(people.a.db, `${mine}/12.jpg`)).error, "a page was added to a published upload");
  });

  test("a waiting upload can be withdrawn by its uploader", async () => {
    const made = (await add(people.b.db)).data;
    const mine = `${people.b.id}/${made.id}`;
    assert.equal((await put(people.b.db, `${mine}/01.jpg`)).error, null);
    assert.equal((await people.b.db.storage.from(BUCKET).remove([`${mine}/01.jpg`])).error, null);
    await people.b.db.from("paper_uploads").delete().eq("id", made.id);
    assert.equal((await asAdmin(made.id)).data, null);
    assert.deepEqual((await admin.storage.from(BUCKET).list(mine)).data ?? [], []);
  });

  test("a banned account cannot upload", async () => {
    assert.ok((await add(people.banned.db)).error);
  });

  test("five uploads may wait at once, not six", async () => {
    const { db } = people.b; // has none waiting
    for (let n = 1; n <= 5; n++) assert.equal((await add(db)).error, null, `upload ${n}`);
    const sixth = await add(db);
    assert.match(sixth.error?.message ?? "", /5 uploads waiting/);
  });
});

describe("keep-alive: the daily ping and nothing more", { skip }, () => {
  let admin;
  let visitor;
  const beat = async () => (await admin.from("heartbeat").select("pinged_at").eq("id", 1).maybeSingle()).data?.pinged_at ?? null;

  before(() => {
    admin = createClient(URL, SERVICE, options);
    visitor = createClient(URL, ANON, options);
  });

  test("a signed-out caller can ping, and the ping is a write to the database", async () => {
    const res = await visitor.rpc("keep_alive");
    assert.equal(res.error, null, `keep_alive failed: ${res.error?.message} (was 0002_keep_alive.sql run?)`);
    const at = await beat();
    assert.ok(at && Date.now() - Date.parse(at) < 5 * 60 * 1000, `the heartbeat was not written now: ${at}`);
  });

  test("the heartbeat itself cannot be read or changed directly", async () => {
    const was = await beat();
    const read = await visitor.from("heartbeat").select("pinged_at");
    assert.ok(read.error || read.data.length === 0, "a visitor read the heartbeat");
    await visitor.from("heartbeat").update({ pinged_at: "2000-01-01T00:00:00Z" }).eq("id", 1);
    await visitor.from("heartbeat").insert({ id: 2 });
    await visitor.from("heartbeat").delete().eq("id", 1);
    assert.equal(await beat(), was, "a visitor changed the heartbeat");
    assert.equal((await admin.from("heartbeat").select("id")).data?.length, 1, "the heartbeat is no longer one row");
  });
});
