"use client";

import { useMemo, useState } from "react";

import { MarkdownTable, MathText } from "../QuestionText";
import { SectionHead, subjectOf, type StudyCtx } from "./common";
import { useLocal } from "@/lib/progress";

const NONE: string[] = [];
const REPEAT_LABEL: Record<string, string> = { exact: "word for word", near: "nearly the same", "same-topic": "same topic" };
const PAGE = 30;

/** Sub-parts not already spelled out in the question text (same rule as the topic panel). */
function extraParts(text: string, parts: string[] = []): string[] {
  const squash = (s: string) => s.toLowerCase().replace(/^\s*(\(?[a-z0-9ivx]+[).]\s*)/i, "").replace(/[^a-z0-9]/g, "");
  const all = squash(text);
  return parts.filter((p) => !all.includes(squash(p)));
}

/** Every question in the dataset, searchable, with the original page one click away. */
export default function Archive({ ctx, n }: { ctx: StudyCtx; n: string }) {
  const { ds } = ctx;
  const [saved, setSaved] = useLocal(`atlas:saved:${ds.key}`, NONE);
  const [q, setQ] = useState("");
  const [sub, setSub] = useState("ALL");
  const [unit, setUnit] = useState("ALL");
  const [exam, setExam] = useState("ALL");
  const [savedOnly, setSavedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reveal, setReveal] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState("");

  const qById = useMemo(() => new Map(ds.questions.map((x) => [x.id, x])), [ds]);
  // Reverse repeat links: which later question asked this one again?
  const cameBack = useMemo(() => {
    const m = new Map<string, { exam: string; type: string }>();
    for (const x of ds.questions) for (const r of x.repeatOf) m.set(r.id, { exam: x.examName, type: r.type });
    return m;
  }, [ds]);
  const units = useMemo(
    () => (sub === "ALL" ? [] : [...new Set(ds.topics.filter((t) => t.subjectId === sub).map((t) => t.unitName))]),
    [ds, sub],
  );

  const needle = q.trim().toLowerCase();
  const rows = ds.questions.filter((x) => {
    const t = ds.byId.get(x.topicId)!;
    return (
      (sub === "ALL" || t.subjectId === sub) &&
      (unit === "ALL" || t.unitName === unit) &&
      (exam === "ALL" || x.exam === exam) &&
      (!savedOnly || saved.includes(x.id)) &&
      `${t.name} ${x.text}`.toLowerCase().includes(needle)
    );
  });
  const toggle = (s: Set<string>, id: string, f: (s: Set<string>) => void) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    f(next);
  };

  async function copySaved() {
    const text = saved
      .map((id) => qById.get(id))
      .filter((x) => x)
      .map((x) => `${ds.byId.get(x!.topicId)!.name} (${x!.examName}): ${x!.text}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text || "No saved questions");
      setCopied("Copied ✓");
    } catch {
      setCopied("Copy failed");
    }
  }

  return (
    <section className="sec iv" id="archive">
      <SectionHead n={n} kicker="archive_k" title="archive_h" ctx={ctx} cyan={false} />
      <div className="search" style={{ maxWidth: 760, margin: "8px 0 12px" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions or topics" aria-label="Search questions" />
        <button type="button" onClick={() => setQ("")}>
          Clear
        </button>
      </div>
      <div className="filters iv-filters" style={{ paddingTop: 0 }}>
        <select
          value={sub}
          onChange={(e) => {
            setSub(e.target.value);
            setUnit("ALL");
          }}
          aria-label="Subject"
        >
          <option value="ALL">All subjects</option>
          {ds.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit" disabled={sub === "ALL"}>
          <option value="ALL">{sub === "ALL" ? "Pick a subject for units" : "All units"}</option>
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        {ds.exams.length > 0 && (
          <select value={exam} onChange={(e) => setExam(e.target.value)} aria-label="Exam">
            <option value="ALL">All exams</option>
            {ds.exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
        <button aria-pressed={savedOnly} onClick={() => setSavedOnly((v) => !v)}>
          Saved only
        </button>
        <button onClick={copySaved}>{copied || "Copy saved"}</button>
      </div>
      <div className="mono">
        {rows.length} of {ds.questions.length} {ds.real ? "questions" : "sample questions"} · {saved.length} saved
      </div>

      <div>
        {rows.slice(0, limit).map((x) => {
          const t = ds.byId.get(x.topicId)!;
          const back = cameBack.get(x.id);
          const isSaved = saved.includes(x.id);
          return (
            <div key={x.id} className="qr">
              <div style={{ maxWidth: "70ch", flex: 1, minWidth: 260 }}>
                {(x.repeatOf.length > 0 || back) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                    {x.repeatOf.map((r) => (
                      <span key={r.id} className="badge repeat iv-badge">
                        Repeated from {qById.get(r.id)?.examName ?? "an earlier exam"} · {REPEAT_LABEL[r.type] ?? r.type}
                      </span>
                    ))}
                    {back && (
                      <span className="badge repeat iv-badge">
                        Came back in {back.exam} · {REPEAT_LABEL[back.type] ?? back.type}
                      </span>
                    )}
                  </div>
                )}
                <b style={{ fontSize: 18 }}>
                  <MathText text={x.text} />
                </b>
                {extraParts(x.text, x.subParts).length > 0 && (
                  <ul className="parts">
                    {extraParts(x.text, x.subParts).map((p, i) => (
                      <li key={i}>
                        <MathText text={p} />
                      </li>
                    ))}
                  </ul>
                )}
                {x.tableMd && (
                  <div className="q iv-table">
                    <MarkdownTable md={x.tableMd} />
                  </div>
                )}
                <div className="mono" style={{ marginTop: 6 }}>
                  {t.name} · {subjectOf(ds, t).name} / {t.unitName} · {x.examName}
                  {x.marks != null ? ` · ${x.marks} marks` : ""}
                  {ds.real ? " · AI-extracted" : " · demo sample · year n/a · marks n/a"}
                  {x.pageUrl && (
                    <>
                      {" · "}
                      <a href={x.pageUrl} target="_blank" rel="noreferrer" style={{ color: "#3a2fb0", whiteSpace: "nowrap" }}>
                        view original page ↗
                      </a>
                    </>
                  )}
                </div>
                {x.options && open.has(x.id) && (
                  <div>
                    {x.options.map((o, j) => (
                      <div key={j} className={`opt ${reveal.has(x.id) && j === x.answer ? "ok" : ""}`} style={{ borderColor: "var(--taupe)" }}>
                        {o}
                      </div>
                    ))}
                    <button style={{ marginTop: 8 }} onClick={() => toggle(reveal, x.id, setReveal)}>
                      {reveal.has(x.id) ? "Hide answer" : "Reveal answer"}
                    </button>
                  </div>
                )}
              </div>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                {x.options && <button onClick={() => toggle(open, x.id, setOpen)}>{open.has(x.id) ? "Hide" : "Options"}</button>}
                <button aria-pressed={isSaved} onClick={() => setSaved(isSaved ? saved.filter((s) => s !== x.id) : [...saved, x.id])}>
                  {isSaved ? "Saved ✓" : "Save"}
                </button>
                {t.quiz.length > 0 && <button onClick={() => ctx.practice([t.id])}>Practice</button>}
                {t.quiz.length > 0 && (
                  <button onClick={() => ctx.addToQuiz(t.id)}>{ctx.inQuiz.has(t.id) ? "In quiz ✓" : "Add to quiz"}</button>
                )}
                {ctx.openInAtlas && <button onClick={() => ctx.openInAtlas?.(t.id)}>Open in Atlas</button>}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="qr">
            <b>No questions match. Try clearing a filter.</b>
          </div>
        )}
        {rows.length > limit && (
          <button className="pill" style={{ marginTop: 16, background: "var(--ink)", color: "#fff" }} onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, rows.length - limit)} more
          </button>
        )}
      </div>
      <p className="note">
        {ds.real
          ? "Questions were read from phone photos by an open-weight model and checked by the Trust Harness. Extraction can be wrong: every question links to its original page."
          : "These are sample questions written for the demo, not real past-paper records."}
      </p>
    </section>
  );
}
