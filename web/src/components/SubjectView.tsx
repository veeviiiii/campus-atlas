"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import QuestionCard from "./QuestionCard";
import UnitMarks from "./UnitMarks";
import { basedOn, rankTopics, scoreRule } from "@/lib/likely";
import { marksByUnit } from "@/lib/marks";
import { cameBackMap, examDate, examLabels, examWhen, inOrder, isUndated, papersOf, placedQuestions, sessionOf, sessionsOf, type Exam } from "@/lib/papers";
import { pageImageUrl, pageLabel } from "@/lib/paths";
import { softScrollToElement } from "@/lib/scroll";
import type { Subject } from "@/lib/types";

type Tab = "papers" | "likely" | "marks";
const NO_YEAR = "no-year"; // the year chip for papers that print no year

/** Print one paper on its own: open it, mark it, and let the print styles (globals.css) hide the rest. */
function printPaper(button: HTMLElement) {
  const paper = button.closest("details");
  if (!paper) return;
  paper.open = true;
  paper.setAttribute("data-printing", "");
  document.documentElement.setAttribute("data-print", "paper");
  const done = () => {
    paper.removeAttribute("data-printing");
    document.documentElement.removeAttribute("data-print");
    removeEventListener("afterprint", done);
  };
  addEventListener("afterprint", done);
  print();
}

interface Props {
  collegeId: string;
  exams: Exam[];
  subject: Subject;
}

/** A subject's page: every paper in order (newest first, filter by year), its topics ranked by how often
 *  they were asked, and its marks by unit. */
export default function SubjectView({ collegeId, exams, subject }: Props) {
  const [tab, setTab] = useState<Tab>("papers");
  const [year, setYear] = useState<string | null>(null); // null = all years, NO_YEAR = the papers with none
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  // Topic to bring into view once the Likely tab has rendered: softly after a click, at once for a link.
  const scrollTo = useRef<{ id: string; soft: boolean } | null>(null);

  const papers = useMemo(() => papersOf(exams, subject), [exams, subject]);
  const paperYears = useMemo(
    () => [...sessionsOf(papers.map((p) => p.exam)), ...(papers.some((p) => isUndated(p.exam)) ? [NO_YEAR] : [])],
    [papers],
  );
  const shown = year ? papers.filter((p) => (year === NO_YEAR ? isUndated(p.exam) : sessionOf(p.exam) === year)) : papers;
  const firstUndated = shown.findIndex((p) => isUndated(p.exam)); // papersOf puts them last, under their own heading
  const likely = useMemo(() => rankTopics(exams, subject), [exams, subject]);
  const examName = useMemo(() => examLabels(exams), [exams]);
  const examOf = useMemo(() => new Map(placedQuestions(subject).map(({ q }) => [q.id, q.exam])), [subject]);
  const cameBack = useMemo(() => cameBackMap(exams, subject), [exams, subject]);
  const marks = useMemo(() => marksByUnit(exams, subject), [exams, subject]);

  function show(next: Tab, topicId: string | null = null) {
    setTab(next);
    setOpenTopic(topicId);
    history.replaceState(null, "", topicId ? `#topic-${topicId}` : next === "papers" ? location.pathname : `#${next}`);
    scrollTo.current = topicId ? { id: topicId, soft: true } : null;
  }

  // Deep links: #likely, #marks, or #topic-<id> from the home page planet and search. A layout effect,
  // so the switch happens before the browser paints and the Papers tab never flashes.
  useLayoutEffect(() => {
    const h = location.hash.slice(1);
    const topicId = h.startsWith("topic-") ? h.slice("topic-".length) : null;
    if (!topicId && h !== "likely" && h !== "marks") return;
    /* eslint-disable react-hooks/set-state-in-effect -- the hash only exists in the browser, after hydration */
    setTab(h === "marks" ? "marks" : "likely");
    setOpenTopic(topicId);
    /* eslint-enable react-hooks/set-state-in-effect */
    scrollTo.current = topicId ? { id: topicId, soft: false } : null;
  }, []);

  useLayoutEffect(() => {
    if (tab === "papers") return;
    // On a reload the page's inline script hid the Papers tab until now (see the subject page).
    document.documentElement.removeAttribute("data-deep-tab");
    const target = scrollTo.current;
    scrollTo.current = null;
    const el = target && document.getElementById(`topic-${target.id}`);
    if (!el) return;
    if (target.soft) softScrollToElement(el);
    else el.scrollIntoView({ block: "start", behavior: "instant" });
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
        <button role="tab" aria-selected={tab === "marks"} onClick={() => show("marks")}>
          Marks by unit
        </button>
      </div>

      {tab === "marks" ? (
        <div key="marks" className="stack fade-in" data-panel="marks">
          <UnitMarks table={marks} examName={examName} />
        </div>
      ) : tab === "papers" ? (
        <div key="papers" className="stack fade-in" data-panel="papers">
          <p className="note">
            Questions are read from photos of the papers by an AI model and checked by our pipeline. If something looks off, open the
            original page.
          </p>
          {paperYears.length > 1 && (
            <div className="year-chips" role="group" aria-label="Year">
              {[null, ...paperYears].map((y) => (
                <button key={y ?? "all"} type="button" className="chip" aria-pressed={year === y} onClick={() => setYear(y)}>
                  {y === NO_YEAR ? "No year" : (y ?? "All years")}
                </button>
              ))}
            </div>
          )}
          {shown.map((p, i) => [
            i === firstUndated && (
              <div key="no-year" className="paper-group">
                <h3>Year not printed</h3>
                <p className="note">
                  These papers print no year anywhere, so they are kept apart. Their questions still count in Likely topics, but never
                  as coming before or after another paper.
                </p>
              </div>
            ),
            <details key={p.exam.id} className="paper" open={i === 0}>
              <summary>
                <span className="paper-title">
                  {p.exam.name} <em>{examWhen(p.exam)}</em>
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
                <button type="button" className="linkish" onClick={(e) => printPaper(e.currentTarget)}>
                  Print this paper
                </button>
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
            </details>,
          ])}
          <p className="note">
            Have this subject&apos;s paper from another year? <Link href="/send/">Send it in →</Link>
          </p>
        </div>
      ) : (
        <div key="likely" className="stack fade-in" data-panel="likely">
          <p className="note">
            {basedOn(exams)} {scoreRule(exams)}
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
                            {ex.date ? `${examName[ex.id]} · ${examDate(ex.date)}` : examName[ex.id]}
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
