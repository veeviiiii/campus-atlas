"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import QuestionCard from "./QuestionCard";
import { rankTopics, scoreRule } from "@/lib/likely";
import { cameBackMap, examDate, examLabels, inOrder, papersOf, placedQuestions, sessionOf, sessionsOf, type Exam } from "@/lib/papers";
import { pageImageUrl, pageLabel } from "@/lib/paths";
import type { Subject } from "@/lib/types";

type Tab = "papers" | "likely";

interface Props {
  collegeId: string;
  exams: Exam[];
  subject: Subject;
}

/** A subject's page: every paper in order (newest first, filter by year), and its topics ranked by how often they were asked. */
export default function SubjectView({ collegeId, exams, subject }: Props) {
  const [tab, setTab] = useState<Tab>("papers");
  const [year, setYear] = useState<string | null>(null); // null = all years
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const scrollTo = useRef<string | null>(null); // topic to bring into view once the Likely tab has rendered

  const papers = useMemo(() => papersOf(exams, subject), [exams, subject]);
  const paperYears = useMemo(() => sessionsOf(papers.map((p) => p.exam)), [papers]);
  const shown = year ? papers.filter((p) => sessionOf(p.exam) === year) : papers;
  const likely = useMemo(() => rankTopics(exams, subject), [exams, subject]);
  const examName = useMemo(() => examLabels(exams), [exams]);
  const examOf = useMemo(() => new Map(placedQuestions(subject).map(({ q }) => [q.id, q.exam])), [subject]);
  const cameBack = useMemo(() => cameBackMap(exams, subject), [exams, subject]);
  const sessions = sessionsOf(exams);

  function show(next: Tab, topicId: string | null = null) {
    setTab(next);
    setOpenTopic(topicId);
    history.replaceState(null, "", topicId ? `#topic-${topicId}` : next === "likely" ? "#likely" : location.pathname);
    scrollTo.current = topicId;
  }

  // Deep links: #likely, or #topic-<id> from the home page planet or the course map.
  useEffect(() => {
    const h = location.hash.slice(1);
    const topicId = h.startsWith("topic-") ? h.slice("topic-".length) : null;
    if (!topicId && h !== "likely") return;
    /* eslint-disable react-hooks/set-state-in-effect -- the hash only exists in the browser, after hydration */
    setTab("likely");
    setOpenTopic(topicId);
    /* eslint-enable react-hooks/set-state-in-effect */
    scrollTo.current = topicId;
  }, []);

  useEffect(() => {
    if (tab !== "likely" || !scrollTo.current) return;
    document.getElementById(`topic-${scrollTo.current}`)?.scrollIntoView({ block: "start", behavior: "instant" });
    scrollTo.current = null;
  }, [tab, openTopic]);

  return (
    <>
      <div className="tabs" role="tablist" aria-label="View">
        <button role="tab" aria-selected={tab === "papers"} onClick={() => show("papers")}>
          Papers <span>{papers.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "likely"} onClick={() => show("likely")}>
          Likely topics <span>{likely.length}</span>
        </button>
      </div>

      {tab === "papers" ? (
        <div key="papers" className="stack fade-in">
          <p className="note">
            Questions are read from photos of the papers by an AI model and checked by our pipeline. If something looks off, open the
            original page.
          </p>
          {paperYears.length > 1 && (
            <div className="year-chips" role="group" aria-label="Year">
              {[null, ...paperYears].map((y) => (
                <button key={y ?? "all"} type="button" className="chip" aria-pressed={year === y} onClick={() => setYear(y)}>
                  {y ?? "All years"}
                </button>
              ))}
            </div>
          )}
          {shown.map((p, i) => (
            <details key={p.exam.id} className="paper" open={i === 0}>
              <summary>
                <span className="paper-title">
                  {p.exam.name} <em>{examDate(p.exam.date)}</em>
                </span>
                <span className="mono">{p.questions.length} questions</span>
              </summary>
              <div className="mono paper-pages">
                Original paper:{" "}
                {p.pages.map((ref) => (
                  <a key={ref} href={pageImageUrl(collegeId, ref)} target="_blank" rel="noreferrer">
                    {pageLabel(ref)} ↗
                  </a>
                ))}
              </div>
              <div className="stack">
                {p.questions.map(({ q, topic }, n) => (
                  <QuestionCard
                    key={q.id}
                    q={q}
                    number={n + 1}
                    collegeId={collegeId}
                    examName={examName}
                    examOf={examOf}
                    cameBack={cameBack.get(q.id)}
                    topic={{ name: topic.name, onOpen: () => show("likely", topic.id) }}
                  />
                ))}
              </div>
            </details>
          ))}
          <p className="note">
            Have this subject&apos;s paper from another year? <Link href="/send/">Send it in →</Link>
          </p>
        </div>
      ) : (
        <div key="likely" className="stack fade-in">
          <p className="note">
            {sessions.length > 1
              ? `Ranked by how often and how heavily each topic was asked in ${exams.length} exams from ${sessions[sessions.length - 1]} to ${sessions[0]}. It is a frequency score from ${sessions.length} years of papers, not a guarantee.`
              : `Ranked by how often and how heavily each topic was asked in ${inOrder(exams)
                  .map((e) => e.name)
                  .join(", ")} (${sessions[0]}). It is a frequency score from one year of papers, not a guarantee.`}{" "}
            {scoreRule(exams)}
          </p>
          <ol className="ranked">
            {likely.map(({ topic, unit, score, reasons }) => (
              <li key={topic.id}>
                <details
                  id={`topic-${topic.id}`}
                  open={openTopic === topic.id}
                  onToggle={(e) => {
                    const open = (e.currentTarget as HTMLDetailsElement).open;
                    if (open !== (openTopic === topic.id)) setOpenTopic(open ? topic.id : null);
                  }}
                >
                  <summary>
                    <span className="ranked-head">
                      <b>{topic.name}</b>
                      <span className="mono">{unit.name}</span>
                    </span>
                    <span className="score" title={scoreRule(exams)}>
                      <span className="score-label">Likely score</span>
                      <span className="track">
                        <i style={{ width: `${score}%` }} />
                      </span>
                      <span className="score-num">
                        {score}
                        <small>/100</small>
                      </span>
                    </span>
                    <span className="reasons">
                      {reasons.map((r) => (
                        <span key={r} className={`chip ${r.startsWith("Came back") ? "hot" : ""}`}>
                          {r}
                        </span>
                      ))}
                    </span>
                  </summary>
                  <div className="stack" style={{ marginTop: 12 }}>
                    {inOrder(exams).map((ex) => {
                      const qs = topic.questions.filter((q) => q.exam === ex.id);
                      if (!qs.length) return null;
                      return (
                        <section key={ex.id} className="stack">
                          <div className="mono" style={{ color: "var(--lav)" }}>
                            {examName[ex.id]} · {examDate(ex.date)}
                          </div>
                          {qs.map((q) => (
                            <QuestionCard
                              key={q.id}
                              q={q}
                              collegeId={collegeId}
                              examName={examName}
                              examOf={examOf}
                              cameBack={cameBack.get(q.id)}
                            />
                          ))}
                        </section>
                      );
                    })}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
