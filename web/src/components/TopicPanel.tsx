"use client";

import { useMemo, useState } from "react";

import { HEAT_COLORS, SUBJECT_COLORS } from "./PlanetGlobe";
import { MarkdownTable, MathText } from "./QuestionText";
import type { City } from "@/lib/planet";
import type { Pack, Question, Quiz as QuizItem, Topic } from "@/lib/types";

const REPEAT_LABEL: Record<string, string> = { exact: "word for word", near: "nearly the same", "same-topic": "same topic" };

/** "End_sem_pyq_sem1.pdf#p5" -> "/pages/<college>/End_sem_pyq_sem1_p5.jpg" (exported by the pipeline). */
export function pageImageUrl(pack: Pack, pageRef: string): string {
  const [file, page] = pageRef.split("#p");
  return `/pages/${pack.college.id}/${file.replace(/\.pdf$/i, "")}_p${page}.jpg`;
}

/** Sub-parts not already spelled out in the question text (the extractor often lists them in both). */
function extraParts(q: Question): string[] {
  const squash = (s: string) => s.toLowerCase().replace(/^\s*(\(?[a-z0-9ivx]+[).]\s*)/i, "").replace(/[^a-z0-9]/g, "");
  const text = squash(q.text);
  return (q.sub_parts ?? []).filter((p) => !text.includes(squash(p)));
}

interface Props {
  pack: Pack;
  topic: Topic;
  city: City;
  studied: boolean;
  onStudied: (value: boolean) => void;
  onClose: () => void;
}

/** Topic details for the design's side panel: real questions by exam, badges, original pages, quiz. */
export default function TopicPanel({ pack, topic, city, studied, onStudied, onClose }: Props) {
  const examName = useMemo(() => new Map(pack.sources.exams.map((e) => [e.id, e.name])), [pack]);
  const [quizOpen, setQuizOpen] = useState(false);

  // Reverse links: which later question repeats this one?
  const cameBack = useMemo(() => {
    const map = new Map<string, { exam: string; type: string }>();
    for (const u of city.subject.units)
      for (const t of u.topics) for (const q of t.questions) for (const r of q.repeat_of) map.set(r.id, { exam: q.exam, type: r.type });
    return map;
  }, [city.subject]);
  const allQuestions = useMemo(
    () => new Map(city.subject.units.flatMap((u) => u.topics.flatMap((t) => t.questions.map((q) => [q.id, q] as const)))),
    [city.subject],
  );

  const exams = pack.sources.exams.length;
  const heatText = topic.is_repeat
    ? "Asked in an MST, then again in the End Sem"
    : topic.exams_count >= 2
      ? `Asked in ${topic.exams_count} of ${exams} exams`
      : "Asked once";
  const color = HEAT_COLORS[city.heat];

  return (
    <>
      <div className="mono" style={{ color: SUBJECT_COLORS[city.subjectIndex % SUBJECT_COLORS.length] }}>
        {city.subject.name} / {city.unit.name}
      </div>
      <h3>{topic.name}</h3>
      <div className="mono">
        {heatText} · {topic.total_marks} marks
      </div>
      <div className="bar" aria-hidden="true">
        <b style={{ width: `${(topic.exams_count / exams) * 100}%`, background: color }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {topic.is_repeat && <span className="badge repeat">Repeat · MST → End Sem</span>}
        {city.unit.blind_spot && <span className="badge blind">Blind spot unit · never in the MSTs</span>}
      </div>

      {quizOpen && topic.quiz.length > 0 && (
        <Quiz quiz={topic.quiz} onPassed={() => onStudied(true)} onClose={() => setQuizOpen(false)} />
      )}

      {pack.sources.exams.map((ex) => {
        const qs = topic.questions.filter((q) => q.exam === ex.id);
        if (!qs.length) return null;
        return (
          <section key={ex.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="mono" style={{ color: "var(--lav)" }}>
              {ex.name}
            </div>
            {qs.map((q) => (
              <QuestionCard key={q.id} q={q} pack={pack} examName={examName} cameBack={cameBack.get(q.id)} allQuestions={allQuestions} />
            ))}
          </section>
        );
      })}

      <div className="mono" style={{ color: "var(--muted)" }}>
        {studied ? "Status: studied ✓" : "Status: fogged. Mark it as studied, or pass the quiz (2 of 3), to clear it."}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => onStudied(!studied)} className={`pill sm ${studied ? "" : "lime"}`}>
          {studied ? "Studied ✓ (undo)" : "Mark as studied"}
        </button>
        {topic.quiz.length > 0 && !quizOpen && (
          <button onClick={() => setQuizOpen(true)} className="pill sm">
            Quiz me
          </button>
        )}
        <button onClick={onClose} className="pill sm" style={{ marginLeft: "auto" }}>
          Close
        </button>
      </div>
    </>
  );
}

function QuestionCard({
  q,
  pack,
  examName,
  cameBack,
  allQuestions,
}: {
  q: Question;
  pack: Pack;
  examName: Map<string, string>;
  cameBack?: { exam: string; type: string };
  allQuestions: Map<string, Question>;
}) {
  const parts = extraParts(q);
  return (
    <div className="q">
      {(q.repeat_of.length > 0 || cameBack) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {q.repeat_of.map((r) => (
            <span key={r.id} className="badge repeat">
              Repeated from {examName.get(allQuestions.get(r.id)?.exam ?? "") ?? "an earlier exam"} · {REPEAT_LABEL[r.type] ?? r.type}
            </span>
          ))}
          {cameBack && (
            <span className="badge repeat">
              Came back in {examName.get(cameBack.exam)} · {REPEAT_LABEL[cameBack.type] ?? cameBack.type}
            </span>
          )}
        </div>
      )}
      <p style={{ margin: 0 }}>
        <MathText text={q.text} />
      </p>
      {parts.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 20, color: "var(--muted)" }}>
          {parts.map((s, i) => (
            <li key={i}>
              <MathText text={s} />
            </li>
          ))}
        </ul>
      )}
      {q.has_table && q.table_markdown && <MarkdownTable md={q.table_markdown} />}
      <div className="mono" style={{ color: "var(--muted)", marginTop: 10 }}>
        {q.marks != null ? `${q.marks} marks · ` : ""}AI-extracted ·{" "}
        <a href={pageImageUrl(pack, q.page_ref)} target="_blank" rel="noreferrer" style={{ color: "var(--cyan)", whiteSpace: "nowrap" }}>
          view original page ↗
        </a>
      </div>
    </div>
  );
}

/** Pre-generated quiz from the pack (no live AI). Passing 2 of 3 clears the topic's fog. */
function Quiz({ quiz, onPassed, onClose }: { quiz: QuizItem[]; onPassed: () => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const need = Math.min(2, quiz.length);

  if (i >= quiz.length) {
    const passed = score >= need;
    return (
      <div className="q">
        <div className="mono" style={{ color: passed ? "var(--accent)" : "var(--warning)" }}>
          {score} of {quiz.length} correct
        </div>
        <p style={{ margin: "8px 0 0" }}>{passed ? "Passed. The fog over this topic is cleared." : `Get ${need} right to clear the fog.`}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {!passed && (
            <button
              className="pill sm"
              onClick={() => {
                setI(0);
                setScore(0);
                setPicked(null);
              }}
            >
              Retry
            </button>
          )}
          <button className="pill sm" onClick={onClose}>
            Close quiz
          </button>
        </div>
      </div>
    );
  }

  const q = quiz[i];
  return (
    <div className="q">
      <div className="mono" style={{ color: "var(--muted)" }}>
        Mini quiz · question {i + 1} of {quiz.length}
      </div>
      <p style={{ margin: "8px 0 0" }}>
        <b>
          <MathText text={q.q} />
        </b>
      </p>
      {q.options.map((o, k) => (
        <button
          key={k}
          disabled={picked !== null}
          onClick={() => {
            setPicked(k);
            if (k === q.answer) setScore((s) => s + 1);
          }}
          className={`opt ${picked === null ? "" : k === q.answer ? "ok" : k === picked ? "no" : ""}`}
        >
          <MathText text={o} />
        </button>
      ))}
      {picked !== null && (
        <>
          <div className="mono" style={{ marginTop: 10, color: picked === q.answer ? "var(--accent)" : "var(--warning)" }}>
            {picked === q.answer ? "Correct." : "Not quite."}
          </div>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 14 }}>
            <MathText text={q.why} />
          </p>
          <button
            className="pill sm lime"
            style={{ marginTop: 10 }}
            onClick={() => {
              const next = i + 1;
              setPicked(null);
              setI(next);
              if (next >= quiz.length && score >= need) onPassed();
            }}
          >
            {i + 1 < quiz.length ? "Next" : "See result"}
          </button>
        </>
      )}
    </div>
  );
}
