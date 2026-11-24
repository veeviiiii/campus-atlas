"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import { courseHref } from "@/lib/paths";
import { BUCKET, supabase } from "@/lib/supabase";
import {
  EXAMS,
  MAX_NOTE,
  MAX_PAGES,
  formProblems,
  pagePath,
  recentSessions,
  statusText,
  type ExamKind,
  type UploadCourse,
  type UploadForm,
  type UploadRow,
} from "@/lib/uploads";

const COLUMNS = "id,course_id,semester,subject,exam_kind,session,note,page_count,status,message,answer,pack_key,created_at";
const MAX_SIDE = 2000; // the pipeline reads pages at 2048 px at most, so nothing it could use is lost

/**
 * A photo, redrawn at 2,000 px on its longer side and saved as JPEG: a small upload, and nothing the
 * phone wrote into the file (where and when it was taken) comes along. PDFs go as they are.
 */
async function prepare(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`"${file.name}" could not be opened as a photo. Save it as a JPG and add it again.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`"${file.name}" could not be made smaller.`))), "image/jpeg", 0.85),
  );
}

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Props {
  courses: UploadCourse[];
  formUrl: string; // the Google Form, for when uploads on the site are not set up
}

/** Sign in with Google, send a paper's pages, and see what became of the papers you sent. */
export default function UploadView({ courses, formUrl }: Props) {
  const db = supabase();
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined: not known yet
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [courseId, setCourseId] = useState("");
  const [semester, setSemester] = useState(0);
  const [subject, setSubject] = useState("");
  const [exam, setExam] = useState<ExamKind>("mst1");
  const [year, setYear] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0); // goes up to read "My uploads" again

  const userId = session?.user.id;
  const course = courses.find((c) => c.id === courseId);
  const years = useMemo(() => recentSessions(new Date()), []);

  useEffect(() => {
    if (!db) return;
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = db.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [db]);

  // "My uploads": read when the student signs in, and again after anything they do (reload()).
  useEffect(() => {
    if (!db || !userId) return;
    let current = true;
    db.from("paper_uploads")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .then((res) => {
        if (!current) return;
        if (res.error) setError(`Your uploads could not be loaded: ${res.error.message}`);
        else setRows(res.data as UploadRow[]);
      });
    return () => {
      current = false;
    };
  }, [db, userId, version]);
  const reload = () => setVersion((v) => v + 1);

  if (!db)
    return (
      <div className="send-cta">
        {formUrl ? (
          <>
            <a className="pill lime" href={formUrl} target="_blank" rel="noreferrer">
              Upload photos ↗
            </a>
            <span className="note">Uploading on the site is not open yet. For now this opens our Google Form.</span>
          </>
        ) : (
          <span className="note">Uploading opens soon.</span>
        )}
      </div>
    );

  if (session === undefined) return <p className="note">Checking whether you are signed in…</p>;

  if (!session)
    return (
      <div className="stack">
        <div className="send-cta">
          <button
            type="button"
            className="pill lime"
            onClick={() => db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/upload/` } })}
          >
            Sign in with Google
          </button>
          <span className="note">
            Signing in tells us your Google account&apos;s email address, so you can see what became of your papers and we can ask you about
            them. We never publish it. Your photos stay private until we have checked them and blacked out any names.{" "}
            <Link href="/privacy/">Privacy</Link>
          </span>
        </div>
        {formUrl && (
          <p className="note">
            Rather not sign in here?{" "}
            <a href={formUrl} target="_blank" rel="noreferrer">
              Use the Google Form ↗
            </a>
          </p>
        )}
      </div>
    );

  /** Take an upload back: its pages first (they can only be removed while it waits), then the upload. */
  async function withdraw(id: string) {
    if (!db || !userId) return;
    const folder = `${userId}/${id}`;
    const listed = await db.storage.from(BUCKET).list(folder);
    if (listed.data?.length) await db.storage.from(BUCKET).remove(listed.data.map((f) => `${folder}/${f.name}`));
    const gone = await db.from("paper_uploads").delete().eq("id", id);
    if (gone.error) throw new Error(gone.error.message);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!db || !userId) return;
    setError(null);
    setSent(false);
    const form: UploadForm = {
      course_id: courseId,
      semester,
      subject: subject.trim(),
      exam_kind: exam,
      session: year || null,
      note: note.trim() || null,
      page_count: files.length,
    };
    const problems = formProblems(
      form,
      files.map((f) => ({ type: f.type, size: f.type.startsWith("image/") ? 0 : f.size })), // photos are made smaller below
    );
    if (problems.length) return setError(problems.join(" "));
    try {
      setBusy("Getting the pages ready…");
      const pages: Blob[] = [];
      for (const f of files) pages.push(await prepare(f));
      const tooBig = formProblems(form, pages);
      if (tooBig.length) throw new Error(tooBig.join(" "));

      setBusy("Saving…");
      const made = await db.from("paper_uploads").insert(form).select("id").single();
      if (made.error) throw new Error(made.error.message);
      const id = made.data.id as string;
      try {
        for (const [i, page] of pages.entries()) {
          setBusy(`Sending page ${i + 1} of ${pages.length}…`);
          const up = await db.storage.from(BUCKET).upload(pagePath(userId, id, i + 1, page.type) ?? "", page, { contentType: page.type });
          if (up.error) throw new Error(`Page ${i + 1} did not go through: ${up.error.message}`);
        }
      } catch (err) {
        await withdraw(id).catch(() => {}); // nothing half-sent is left waiting
        throw err;
      }
      setFiles([]);
      setSubject("");
      setNote("");
      setSent(true);
      reload();
    } catch (err) {
      setError(said(err));
    } finally {
      setBusy(null);
    }
  }

  async function act(what: string, run: () => Promise<void>) {
    setError(null);
    setBusy(what);
    try {
      await run();
      reload();
    } catch (err) {
      setError(said(err));
    } finally {
      setBusy(null);
    }
  }

  const move = (i: number, by: number) =>
    setFiles((list) => {
      const next = [...list];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  return (
    <div className="stack upload">
      <p className="note">
        Signed in as {session.user.email}.{" "}
        <button type="button" className="linkish" onClick={() => db.auth.signOut()}>
          Sign out
        </button>
      </p>

      <form className="q upload-form" onSubmit={send}>
        <h2>One paper</h2>
        <label className="field wide">
          <span>Course</span>
          <select
            value={courseId}
            required
            onChange={(e) => {
              setCourseId(e.target.value);
              setSemester(0);
            }}
          >
            <option value="">Choose your course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.school}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Semester</span>
          <select value={semester || ""} required onChange={(e) => setSemester(Number(e.target.value))}>
            <option value="">Choose</option>
            {Array.from({ length: course?.semesters ?? 10 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Semester {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Exam</span>
          <select value={exam} onChange={(e) => setExam(e.target.value as ExamKind)}>
            {EXAMS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Subject, as the paper prints it</span>
          <input value={subject} required minLength={2} maxLength={120} list="upload-subjects" onChange={(e) => setSubject(e.target.value)} />
          <datalist id="upload-subjects">
            {(course?.subjects[semester] ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Academic year of the exam</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Not sure</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <div className="field wide">
          <span>Pages, in order (photos or one PDF, {MAX_PAGES} at most)</span>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            aria-label="Add pages"
            onChange={(e) => {
              setFiles((list) => [...list, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          {files.length > 0 && (
            <ol className="file-list">
              {files.map((f, i) => (
                <li key={`${f.name}-${f.lastModified}-${i}`}>
                  <span>
                    Page {i + 1}: {f.name} <small>{size(f.size)}</small>
                  </span>
                  <span>
                    <button type="button" className="linkish" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move page ${i + 1} up`}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="linkish"
                      disabled={i === files.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Move page ${i + 1} down`}
                    >
                      ↓
                    </button>
                    <button type="button" className="linkish" onClick={() => setFiles((list) => list.filter((_, k) => k !== i))}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <label className="field wide">
          <span>Anything we should know (optional)</span>
          <textarea value={note} maxLength={MAX_NOTE} rows={2} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="send-cta wide">
          <button type="submit" className="pill lime" disabled={busy !== null}>
            {busy ?? "Send this paper"}
          </button>
          <span className="note">Question papers only. Cover or crop out names, roll numbers and signatures first.</span>
        </div>
        {error && (
          <p className="upload-error wide" role="alert">
            {error}
          </p>
        )}
        {sent && (
          <p className="note wide" role="status">
            Sent. We check every paper by hand, so it can take a few days; it will show as &quot;On the site&quot; below when it is live.
          </p>
        )}
      </form>

      <h2>My uploads</h2>
      {rows.length === 0 ? (
        <p className="note">Nothing sent yet.</p>
      ) : (
        <ul className="upload-list">
          {rows.map((r) => (
            <li key={r.id} className="q">
              <div className="upload-head">
                <b>{r.subject}</b>
                <span className={`chip ${r.status === "held" && !r.answer ? "hot" : ""}`}>{statusText(r)}</span>
              </div>
              <div className="mono qmeta">
                <span>{courses.find((c) => c.id === r.course_id)?.name ?? r.course_id}</span>
                <span>Semester {r.semester}</span>
                <span>
                  {EXAMS.find((x) => x.id === r.exam_kind)?.name} {r.session ?? ""}
                </span>
                <span>
                  {r.page_count} page{r.page_count === 1 ? "" : "s"}
                </span>
              </div>
              {r.message && (
                <p className="upload-message">
                  <span className="mono">{r.status === "rejected" ? "Why" : "We asked"}</span> {r.message}
                </p>
              )}
              {r.answer && (
                <p className="upload-message">
                  <span className="mono">You answered</span> {r.answer}
                </p>
              )}
              {r.status === "held" && !r.answer && (
                <form
                  className="upload-answer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("Sending your answer…", async () => {
                      const res = await db.rpc("answer_upload", { upload_id: r.id, answer_text: answers[r.id] ?? "" });
                      if (res.error) throw new Error(res.error.message);
                    });
                  }}
                >
                  <input
                    value={answers[r.id] ?? ""}
                    required
                    maxLength={500}
                    aria-label="Your answer"
                    placeholder="Your answer"
                    onChange={(e) => setAnswers((a) => ({ ...a, [r.id]: e.target.value }))}
                  />
                  <button type="submit" className="pill sm" disabled={busy !== null}>
                    Answer
                  </button>
                </form>
              )}
              {r.status === "published" && r.pack_key && (
                <p className="note">
                  <Link href={courseHref(r.pack_key)}>See it on the site →</Link>
                </p>
              )}
              {r.status === "pending" && (
                <button type="button" className="linkish" disabled={busy !== null} onClick={() => void act("Taking it back…", () => withdraw(r.id))}>
                  Take it back
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
