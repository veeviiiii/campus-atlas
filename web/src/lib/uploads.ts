// Paper uploads on the site: what the form holds and the small rules around it. Pure helpers, safe on
// the server and the client and tested without a database (tests/uploads.test.ts). The database's
// own rules are in supabase/migrations/0001_uploads.sql; these only save a round trip and say why.

export const MAX_PAGES = 12;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_NOTE = 500;

export const EXAMS = [
  { id: "mst1", name: "MST-1" },
  { id: "mst2", name: "MST-2" },
  { id: "mst3", name: "MST-3" },
  { id: "end", name: "End Sem" },
  { id: "unknown", name: "Not sure" },
] as const;

export type ExamKind = (typeof EXAMS)[number]["id"];
export type UploadStatus = "pending" | "held" | "published" | "rejected";

/** What the student fills in. */
export interface UploadForm {
  course_id: string;
  semester: number;
  subject: string;
  exam_kind: ExamKind;
  session: string | null; // academic year "2025-26"; null = not sure
  note: string | null;
  page_count: number;
}

/** A row of paper_uploads, as its uploader may read it. */
export interface UploadRow extends UploadForm {
  id: string;
  status: UploadStatus;
  message: string | null; // from the maintainer: why it was not used, or a question
  answer: string | null; // the uploader's answer to that question
  pack_key: string | null; // where it was published, "davv-sdsf/mtech-aids-dual-sem1"
  created_at: string;
}

/** A course the form offers: from the catalogue, with the subjects its packs already have per semester. */
export interface UploadCourse {
  id: string;
  name: string;
  school: string;
  semesters: number;
  subjects: Record<number, string[]>;
}

/** The last `count` academic years, newest first, for the year picker: "2026-27", "2025-26", ... (a year starts in July). */
export function recentSessions(today: Date, count = 8): string[] {
  const start = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, "0")}`);
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Where page `n` (1-based) of an upload is stored: "<user id>/<upload id>/03.jpg". Undefined for a file type we don't take. */
export function pagePath(userId: string, uploadId: string, n: number, mime: string): string | undefined {
  const ext = EXTENSIONS[mime];
  return ext ? `${userId}/${uploadId}/${String(n).padStart(2, "0")}.${ext}` : undefined;
}

/** What is wrong with the form, in words for the student; empty when it can be sent. */
export function formProblems(form: UploadForm, files: { type: string; size: number }[]): string[] {
  const problems: string[] = [];
  if (!form.course_id) problems.push("Choose your course.");
  if (!(form.semester >= 1 && form.semester <= 10)) problems.push("Choose the semester.");
  const subject = form.subject.trim();
  if (subject.length < 2) problems.push("Write the subject as the paper prints it.");
  else if (subject.length > 120) problems.push("The subject is too long (120 characters at most).");
  if ((form.note ?? "").length > MAX_NOTE) problems.push(`The note is too long (${MAX_NOTE} characters at most).`);
  if (files.length === 0) problems.push("Add a photo of every page of the paper.");
  if (files.length > MAX_PAGES) problems.push(`One paper has at most ${MAX_PAGES} pages here. Send a longer paper as one PDF.`);
  if (files.some((f) => !EXTENSIONS[f.type])) problems.push("Photos (JPG, PNG, WebP) or a PDF only.");
  if (files.some((f) => f.size > MAX_FILE_BYTES)) problems.push("A file is over 10 MB. Photos are made smaller for you; a PDF has to be under 10 MB.");
  return problems;
}

/** What a status means to the student who sent the paper. */
export function statusText(row: Pick<UploadRow, "status" | "answer">): string {
  switch (row.status) {
    case "pending":
      return "Waiting to be checked";
    case "held":
      return row.answer ? "Answered: waiting to be checked again" : "We have a question for you";
    case "published":
      return "Accepted: on the site";
    case "rejected":
      return "Rejected";
  }
}

/** The colour of that status (a .chip class): green once it is on the site, red when it was rejected, amber
 *  while we wait for the student to answer our question. The words say it too, never the colour alone. */
export function statusTone(row: Pick<UploadRow, "status" | "answer">): "good" | "bad" | "ask" | "" {
  if (row.status === "published") return "good";
  if (row.status === "rejected") return "bad";
  if (row.status === "held" && !row.answer) return "ask";
  return "";
}
