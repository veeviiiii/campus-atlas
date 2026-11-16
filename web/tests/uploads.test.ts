import assert from "node:assert/strict";
import { test } from "node:test";

import { formProblems, pagePath, recentSessions, statusText, type UploadForm } from "../src/lib/uploads";

const FORM: UploadForm = { course_id: "bca", semester: 3, subject: "Data Structures", exam_kind: "mst1", session: "2025-26", note: null, page_count: 2 };
const photo = { type: "image/jpeg", size: 400_000 };

test("the year picker offers academic years, newest first, starting in July", () => {
  assert.deepEqual(recentSessions(new Date(2026, 10, 16), 3), ["2026-27", "2025-26", "2024-25"]); // November 2026
  assert.deepEqual(recentSessions(new Date(2026, 5, 30), 2), ["2025-26", "2024-25"]); // June 2026
  assert.equal(recentSessions(new Date(2099, 11, 1), 1)[0], "2099-00");
});

test("a page is stored in the uploader's own folder under its upload, numbered in order", () => {
  assert.equal(pagePath("user-1", "upload-9", 3, "image/jpeg"), "user-1/upload-9/03.jpg");
  assert.equal(pagePath("user-1", "upload-9", 12, "application/pdf"), "user-1/upload-9/12.pdf");
  assert.equal(pagePath("user-1", "upload-9", 1, "text/html"), undefined);
  // the shape the database's storage rule accepts: two folders, then NN.ext
  assert.match(pagePath("a", "b", 1, "image/webp") ?? "", /^[^/]+\/[^/]+\/[0-9]{2}\.(jpg|jpeg|png|webp|pdf)$/);
});

test("a complete form with its pages has nothing wrong", () => {
  assert.deepEqual(formProblems(FORM, [photo, photo]), []);
  assert.deepEqual(formProblems({ ...FORM, session: null, exam_kind: "unknown" }, [photo]), []); // "not sure" is an answer
});

test("each thing missing or over the limit is said in words", () => {
  const all = formProblems({ ...FORM, course_id: "", semester: 0, subject: " x ", note: "n".repeat(501) }, []);
  assert.equal(all.length, 5);
  assert.match(formProblems(FORM, Array(13).fill(photo))[0], /at most 12 pages/);
  assert.match(formProblems(FORM, [{ type: "image/heic", size: 1 }])[0], /JPG, PNG, WebP/);
  assert.match(formProblems(FORM, [{ type: "application/pdf", size: 11 * 1024 * 1024 }])[0], /10 MB/);
});

test("a status reads as what it means to the student", () => {
  assert.equal(statusText({ status: "pending", answer: null }), "Waiting to be checked");
  assert.equal(statusText({ status: "held", answer: null }), "We have a question for you");
  assert.equal(statusText({ status: "held", answer: "2024-25" }), "Answered: waiting to be checked again");
  assert.equal(statusText({ status: "published", answer: null }), "On the site");
  assert.equal(statusText({ status: "rejected", answer: null }), "Not used");
});
