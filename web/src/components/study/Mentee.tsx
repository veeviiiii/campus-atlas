"use client";

import { useState } from "react";

import { MathText } from "../QuestionText";
import type { StudyCtx } from "./common";
import { useT } from "@/lib/i18n";
import { setStudied } from "@/lib/progress";

type Phase = "build" | "preview" | "run" | "done";
export interface QuizRequest {
  ids: string[];
  title: string;
}

/** Quiz builder: pick topics, take their pre-generated quiz questions; passing a topic clears its fog. */
export default function Mentee({
  ctx,
  pick,
  setPick,
  start,
}: {
  ctx: StudyCtx;
  pick: Set<string>;
  setPick: (s: Set<string>) => void;
  start: QuizRequest | null;
}) {
  const { ds } = ctx;
  const t = useT();
  const [phase, setPhase] = useState<Phase>(start ? "run" : "build");
  const [title, setTitle] = useState(start?.title ?? "My quiz");
  const [ids, setIds] = useState<string[]>(start?.ids ?? []);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [sub, setSub] = useState(ds.subjects[0]?.id ?? "");

  const items = ids.flatMap((id) => ds.byId.get(id)!.quiz.map((q) => ({ ...q, topicId: id })));
  const withQuiz = ds.topics.filter((x) => x.quiz.length > 0);
  const noQuiz = ds.topics.length - withQuiz.length;

  // A topic passes with 2 of its 3 questions right (the planet's rule), or 1 of 1 for the demo.
  function results(ans: boolean[]) {
    return ids.map((id) => {
      const idx = items.map((q, k) => (q.topicId === id ? k : -1)).filter((k) => k >= 0);
      const right = idx.filter((k) => ans[k]).length;
      return { id, right, of: idx.length, passed: right >= Math.min(2, idx.length) };
    });
  }

  if (phase === "build") {
    const shown = withQuiz.filter((x) => x.subjectId === sub);
    const toggle = (id: string) => {
      const next = new Set(pick);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPick(next);
    };
    return (
      <>
        <h2>{t("mh")}</h2>
        <div className="bx">
          <input aria-label="Quiz title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="filters" style={{ padding: 0 }} role="group" aria-label="Subject">
            {ds.subjects.map((s) => (
              <button key={s.id} aria-pressed={sub === s.id} onClick={() => setSub(s.id)}>
                {s.name} ({withQuiz.filter((x) => x.subjectId === s.id && pick.has(x.id)).length})
              </button>
            ))}
          </div>
          <div className="tg">
            {shown.map((x) => (
              <button key={x.id} aria-pressed={pick.has(x.id)} onClick={() => toggle(x.id)}>
                <b>{x.name}</b>
                <div className="mono" style={{ color: "var(--muted)" }}>
                  {x.quiz.length} question{x.quiz.length > 1 ? "s" : ""}
                  {ctx.studied.has(x.id) ? " · studied ✓" : ""}
                </div>
              </button>
            ))}
          </div>
          <div className="note">
            {ds.real
              ? `Questions come from the pack: multiple-choice quizzes written by the open model from the real questions and validated by the harness (no live AI).${noQuiz ? ` ${noQuiz} topics have no quiz yet: generation failed and they sit on the unsure list.` : ""}`
              : "One sample question per topic, written for the demo."}{" "}
            {t("loc")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="pill lime"
              disabled={pick.size === 0}
              style={pick.size === 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
              onClick={() => {
                setIds(withQuiz.filter((x) => pick.has(x.id)).map((x) => x.id));
                setPhase("preview");
              }}
            >
              {t("make")} ({pick.size})
            </button>
            {pick.size > 0 && (
              <button className="pill" onClick={() => setPick(new Set())}>
                Clear selection
              </button>
            )}
            <button className="pill" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
              Share link / join code (needs backend)
            </button>
          </div>
        </div>
      </>
    );
  }

  if (phase === "preview") {
    return (
      <>
        <h2>{title || "My quiz"}</h2>
        <div className="bx">
          <div className="mono">
            {items.length} questions · {ids.length} topics
          </div>
          {items.map((q, k) => (
            <div key={k} className="q">
              <b>
                <MathText text={q.q} />
              </b>
              <div className="mono" style={{ color: "var(--muted)" }}>
                {ds.byId.get(q.topicId)!.name} · {ds.real ? "quiz from the pack" : "demo sample · not a past-paper question"}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="pill lime"
              onClick={() => {
                setI(0);
                setAnswers([]);
                setPicked(null);
                setPhase("run");
              }}
            >
              {t("take")}
            </button>
            <button className="pill" onClick={() => setPhase("build")}>
              {t("back")}
            </button>
          </div>
        </div>
      </>
    );
  }

  if (phase === "run" && items.length > 0) {
    const q = items[i];
    return (
      <div className="bx" style={{ maxWidth: 720 }}>
        <div className="mono">
          {title} · {i + 1} / {items.length} · {ds.byId.get(q.topicId)!.name}
        </div>
        <h3 style={{ fontSize: 26, lineHeight: 1.15 }}>
          <MathText text={q.q} />
        </h3>
        {q.options.map((o, k) => (
          <button
            key={k}
            disabled={picked !== null}
            className={`opt ${picked === null ? "" : k === q.answer ? "ok" : k === picked ? "no" : ""}`}
            onClick={() => setPicked(k)}
          >
            <MathText text={o} />
          </button>
        ))}
        {picked !== null && (
          <>
            <div className="mono" style={{ color: picked === q.answer ? "var(--accent)" : "var(--warning)" }}>
              {picked === q.answer ? "Correct." : `Not quite. Answer: ${q.options[q.answer]}`}
            </div>
            {q.why && (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
                <MathText text={q.why} />
              </p>
            )}
            <button
              className="pill sm lime"
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                const ans = [...answers, picked === q.answer];
                setAnswers(ans);
                setPicked(null);
                if (i + 1 < items.length) setI(i + 1);
                else {
                  for (const r of results(ans)) if (r.passed) setStudied(ds.key, r.id, true);
                  setPhase("done");
                }
              }}
            >
              {i + 1 < items.length ? "Next" : "See result"}
            </button>
          </>
        )}
      </div>
    );
  }

  const res = results(answers);
  const right = answers.filter(Boolean).length;
  return (
    <>
      <h2>
        {right} / {items.length}
      </h2>
      <div className="bx">
        {res.map((r) => (
          <div key={r.id} className="lr">
            <span>{ds.byId.get(r.id)!.name}</span>
            <span className="mono" style={{ color: r.passed ? "var(--accent)" : "var(--warning)" }}>
              {r.right} of {r.of} · {r.passed ? "passed · fog cleared" : "revise this topic"}
            </span>
          </div>
        ))}
        <div className="note">Progress updated on this device from your answers, here and on the planet. {t("loc")}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="pill lime"
            onClick={() => {
              setI(0);
              setAnswers([]);
              setPicked(null);
              setPhase("run");
            }}
          >
            Retry
          </button>
          <button className="pill" onClick={() => setPhase("build")}>
            {t("make")}
          </button>
        </div>
      </div>
    </>
  );
}
