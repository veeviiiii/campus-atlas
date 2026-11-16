"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import QuestionCard from "./QuestionCard";
import { examDate } from "@/lib/papers";
import { subjectHref, topicHref } from "@/lib/paths";
import { highlighter, prepare, search, type Prepared, type SearchIndex } from "@/lib/search";

const PAGE = 30; // results shown at first, and per "Show more"

/** "<pack key>/<subject id>": subject ids are only unique within a pack. */
const subjectKey = (index: SearchIndex, it: Prepared) => `${index.packs[it.doc.pack].key}/${it.doc.subject}`;

interface Loaded {
  index: SearchIndex;
  items: Prepared[];
  examName: Record<string, string>[]; // per pack: exam id -> "MST-2" (with the year when a pack has several)
  examOf: Map<string, string>[]; // per pack: question id -> exam id, for "Repeated from ..."
}

/** Search every question on the site. The index (one static JSON file) loads when the page opens. */
export default function SearchView() {
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState<string | null>(null); // "<pack>/<subject id>", null = every subject
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    // ?q= links (e.g. from the home page) only exist in the browser: the page itself is static.
    const q = new URLSearchParams(location.search).get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once, after hydration
    if (q) setQuery(q);
    fetch("/search-index.json")
      .then((r) => (r.ok ? (r.json() as Promise<SearchIndex>) : Promise.reject(new Error(String(r.status)))))
      .then((index) =>
        setData({
          index,
          items: prepare(index),
          examName: index.packs.map((p) => Object.fromEntries(p.exams.map((e) => [e.id, e.label]))),
          examOf: index.packs.map((_, i) => new Map(index.docs.filter((d) => d.pack === i).map((d) => [d.q.id, d.q.exam]))),
        }),
      )
      .catch(() => setFailed(true));
  }, []);

  function ask(next: string) {
    setQuery(next);
    setSubject(null);
    setShown(PAGE);
    const url = next.trim() ? `?q=${encodeURIComponent(next.trim())}` : location.pathname;
    history.replaceState(null, "", url);
  }

  const hits = useMemo(() => (data ? search(data.items, query) : []), [data, query]);
  const mark = useMemo(() => highlighter(query), [query]);

  // Subjects in the results, most hits first, to narrow them down.
  const bySubject = useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    if (!data) return [];
    for (const it of hits) {
      const k = subjectKey(data.index, it);
      const name = data.index.packs[it.doc.pack].subjects.find((s) => s.id === it.doc.subject)?.name ?? it.doc.subject;
      counts.set(k, { name, n: (counts.get(k)?.n ?? 0) + 1 });
    }
    return [...counts].sort((a, b) => b[1].n - a[1].n);
  }, [hits, data]);
  const filtered = subject && data ? hits.filter((it) => subjectKey(data.index, it) === subject) : hits;

  // Before anything is typed: topics that came back in a later exam, as one-tap searches.
  const suggestions = useMemo(() => {
    if (!data) return [];
    const n = new Map<string, number>();
    for (const d of data.index.docs) if (d.q.repeat_of.length) n.set(d.topic.name, (n.get(d.topic.name) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([name]) => name);
  }, [data]);

  const packs = data?.index.packs ?? [];
  const several = packs.length > 1;

  return (
    <>
      <form className="search qsearch" role="search" onSubmit={(e) => e.preventDefault()}>
        <input
          value={query}
          onChange={(e) => ask(e.target.value)}
          placeholder="A word or phrase from a question, a topic or a subject"
          aria-label="Search questions"
          autoFocus
          enterKeyHint="search"
        />
        {query && (
          <button type="button" onClick={() => ask("")}>
            Clear
          </button>
        )}
      </form>

      {failed ? (
        <p className="note">Couldn&apos;t load the questions. Check your connection and reload the page.</p>
      ) : !data ? (
        <p className="note">Loading questions…</p>
      ) : !query.trim() ? (
        <div className="stack">
          <p className="note">
            Searches the text of all {data.index.docs.length} questions on Campus Atlas, from {packs.length} semester
            {packs.length === 1 ? "" : "s"} of past papers, and their topics and subjects.
          </p>
          {suggestions.length > 0 && (
            <>
              <div className="mono" style={{ color: "var(--lav)" }}>
                Topics that came back in a later exam
              </div>
              <div className="year-chips">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="stack">
          <p className="note" aria-live="polite">
            {hits.length === 0
              ? `No question has all of “${query.trim()}”. Try fewer words, or the start of a word.`
              : `${hits.length} question${hits.length === 1 ? "" : "s"} in ${bySubject.length} subject${bySubject.length === 1 ? "" : "s"}.`}
          </p>
          {bySubject.length > 1 && (
            <div className="year-chips" role="group" aria-label="Subject">
              {[null, ...bySubject.map(([k]) => k)].map((k) => (
                <button
                  key={k ?? "all"}
                  type="button"
                  className="chip"
                  aria-pressed={subject === k}
                  onClick={() => {
                    setSubject(k);
                    setShown(PAGE);
                  }}
                >
                  {k ? bySubject.find(([x]) => x === k)?.[1].name : "All"}{" "}
                  <span>{k ? bySubject.find(([x]) => x === k)?.[1].n : hits.length}</span>
                </button>
              ))}
            </div>
          )}
          {filtered.slice(0, shown).map((it) => {
            const { doc } = it;
            const p = packs[doc.pack];
            const s = p.subjects.find((x) => x.id === doc.subject);
            const exam = p.exams.find((e) => e.id === doc.q.exam);
            return (
              <QuestionCard
                key={`${p.key}/${doc.q.id}`}
                q={doc.q}
                collegeId={p.collegeId}
                examName={data.examName[doc.pack]}
                examOf={data.examOf[doc.pack]}
                cameBack={doc.cameBack}
                highlight={mark}
                topic={{ name: doc.topic.name, href: topicHref(p.key, doc.subject, doc.topic.id) }}
                head={
                  <>
                    <Link href={subjectHref(p.key, doc.subject)}>{s?.name ?? doc.subject}</Link>
                    <span>
                      {exam ? (exam.date ? `${exam.label} · ${examDate(exam.date)}` : exam.label) : doc.q.exam}
                      {several && ` · ${p.course}, Sem ${p.semester}`}
                    </span>
                  </>
                }
              />
            );
          })}
          {filtered.length > shown && (
            <button type="button" className="pill sm more" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, filtered.length - shown)} more
            </button>
          )}
        </div>
      )}
    </>
  );
}
