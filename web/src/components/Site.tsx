"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent, useMemo, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

import { BottomBar, SiteNav } from "./Chrome";
import HeroPlanet from "./HeroPlanet";
import { FIELD_COLORS } from "@/lib/colors";
import { programmeHref, topicHref } from "@/lib/paths";
import { buildPlanet } from "@/lib/planet";
import { softScrollToElement } from "@/lib/scroll";
import type { CourseCard, Field, PackEntry } from "@/lib/types";

interface Props {
  entries: PackEntry[];
  courses: CourseCard[];
  fields: Field[];
}

/** "Sem 1 papers" / "Sem 1 and 3 papers" / "No papers yet". */
function paperStatus(c: CourseCard): string {
  const have = c.semesters.filter((s) => s.key).map((s) => s.semester);
  if (!have.length) return "No papers yet";
  return `Sem ${have.length > 1 ? `${have.slice(0, -1).join(", ")} and ${have[have.length - 1]}` : have[0]} papers →`;
}

const hasPapers = (c: CourseCard) => c.semesters.some((s) => s.key);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The field picked on the home page lives in the address (/?field=engineering#browse), so Back from a
// course and a shared link open the same list. The static page has no field: it shows the fields.
const FIELD_EVENT = "atlas:field";
function onFieldChange(update: () => void) {
  addEventListener("popstate", update);
  addEventListener(FIELD_EVENT, update);
  return () => {
    removeEventListener("popstate", update);
    removeEventListener(FIELD_EVENT, update);
  };
}
const fieldInAddress = () => new URLSearchParams(location.search).get("field");

/** A plain click on a field link changes the list in place (Link skips a click whose default is
 *  prevented); ctrl/cmd/middle-click still opens a new tab. */
const plainClick = (e: MouseEvent) => e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);

/** Home: what this is in one line, then the fields; pick one to see its courses. */
export default function Site({ entries, courses, fields }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const picked = useSyncExternalStore(onFieldChange, fieldInAddress, () => null);

  const first = entries[0];
  const heroPlanet = useMemo(() => (first ? buildPlanet(first.pack) : null), [first]);
  const p = first?.pack;
  // "How it works" counts every course on the site; the eval exists only for the course it was made for.
  const total = (k: "papers" | "questions" | "repeats" | "dropped_bleed_through") => entries.reduce((n, e) => n + e.pack.stats[k], 0);
  const evalPack = entries.find((e) => e.pack.harness?.eval)?.pack;
  const evalResult = evalPack?.harness?.eval;
  const papers = total("papers");

  const allFields = courses.some((c) => c.field === "other") ? [...fields, { id: "other", name: "Other courses", short: "Other" }] : fields;
  const fieldName = Object.fromEntries(allFields.map((f) => [f.id, f.name]));
  const field = allFields.find((f) => f.id === picked) ?? null;
  const q = query.trim().toLowerCase();
  // Typing searches every course, whichever field is open; otherwise the open field's courses.
  const shown = q
    ? courses.filter((c) =>
        `${c.name} ${c.school} ${c.schoolShort ?? ""} ${fieldName[c.field]} ${c.subjects.join(" ")}`.toLowerCase().includes(q),
      )
    : field
      ? courses.filter((c) => c.field === field.id)
      : null; // null: show the fields
  // Courses that have papers first; otherwise the catalogue's order (grouped by field).
  const cards = (shown ?? [])
    .map((c, i) => ({ c, i, ready: hasPapers(c) }))
    .sort((x, y) => Number(y.ready) - Number(x.ready) || x.i - y.i)
    .map(({ c }) => c);
  const tiles = allFields
    .map((f) => {
      const mine = courses.filter((c) => c.field === f.id);
      return { f, n: mine.length, ready: mine.filter(hasPapers).length };
    })
    .filter((t) => t.n);

  function pick(e: MouseEvent, id: string | null) {
    if (!plainClick(e)) return;
    e.preventDefault();
    // No #browse here: Next would scroll to it on every switch.
    history.replaceState(null, "", id ? `/?field=${id}` : "/");
    flushSync(() => dispatchEvent(new Event(FIELD_EVENT))); // the new list is on the page before it is measured
    // A field picked low in the grid: bring the search box and the top of the new list into view.
    const list = document.getElementById("course-list");
    const search = document.getElementById("course-search");
    if (list && search && list.getBoundingClientRect().top < 100) softScrollToElement(search);
  }

  return (
    <>
      <SiteNav />

      <header className="hero">
        <div>
          <div className="mono" style={{ color: "var(--cyan)", marginBottom: 18, position: "relative" }}>
            ✦ Past papers of DAVV, Indore
          </div>
          <h1>
            <small>your semester is a</small>
            <span className="word" aria-label="WORLD">
              <i className="w1">W</i>
              <i className="w2">O</i>
              <i className="w3">R</i>
              <i className="w4">L</i>
              <i className="w5">D</i>
            </span>
            <br />
            go explore it.
          </h1>
          <p>
            Every past paper from your course, sorted by subject, exam and year, with the topics that keep coming back ranked at the top.
            Made by students, for freshers and everyone after.
          </p>
          <div className="cta">
            <a className="pill lime" href="#browse">
              Find your course ↓
            </a>
            <a className="pill" href="#how">
              How it works
            </a>
          </div>
        </div>
        {heroPlanet && first && (
          <div style={{ position: "relative" }}>
            <HeroPlanet cities={heroPlanet.cities} onPick={(c) => router.push(topicHref(first.key, c.subject.id, c.topic.id))} />
            <div className="mono" style={{ color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
              Every square is a real topic from {p?.course.name}, Semester {p?.course.semester} · click one
            </div>
          </div>
        )}
      </header>

      <div className="mq" aria-hidden="true">
        <div>
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} style={{ color: "inherit", margin: 0 }}>
              <span>✦</span>Past papers<span>◆</span>By subject<span>✦</span>By exam and year<span>◆</span>Likely topics
            </span>
          ))}
        </div>
      </div>

      <section className="camp" id="browse">
        <div className="crt" aria-hidden="true">
          <div>:)</div>
        </div>
        <div className="mono">01 / Past papers</div>
        <div className="pix" style={{ margin: "14px 0 8px" }}>
          find your
          <br />
          course
        </div>
        <h2 style={{ marginTop: 20 }}>Pick your field, then your course.</h2>
        <form id="course-search" className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Or type a course, school or subject" aria-label="Search courses" />
          <button type="button" onClick={() => setQuery("")}>
            Clear
          </button>
        </form>
        {q && (
          <p className="search-questions">
            <Link href={`/search/?q=${encodeURIComponent(query.trim())}`}>Search the questions for “{query.trim()}” →</Link>
          </p>
        )}

        <div id="course-list">
          {!q && field && (
            <div className="field-head">
              <Link className="field-back" href="/#browse" prefetch={false} onClick={(e) => pick(e, null)}>
                ← All fields
              </Link>
              <h3>
                <i style={{ background: (FIELD_COLORS[field.id] ?? FIELD_COLORS.other)[0] }} />
                {field.name}
              </h3>
              <span className="mono">{plural(cards.length, "course")}</span>
            </div>
          )}
          {q && <p className="mono field-head">{cards.length ? `${plural(cards.length, "course")} match` : "No course matches"}</p>}

          {shown === null ? (
            <div className="cards fields swap" key="fields">
              {tiles.map(({ f, n, ready }) => {
                const [a, b] = FIELD_COLORS[f.id] ?? FIELD_COLORS.other;
                return (
                  <Link
                    key={f.id}
                    className={`card course-card field-card ${ready ? "" : "empty"}`}
                    href={`/?field=${f.id}#browse`}
                    prefetch={false}
                    onClick={(e) => pick(e, f.id)}
                  >
                    <div className="orb" style={{ background: `linear-gradient(135deg,${a},${b})` }} />
                    <h3>{f.name}</h3>
                    <span className="mono">{plural(n, "course")}</span>
                    <span className="mono course-status">{ready ? `Papers for ${plural(ready, "course")} →` : "No papers yet"}</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="cards swap" key={q ? "search" : field?.id}>
              {cards.map((c) => {
                const [a, b] = FIELD_COLORS[c.field] ?? FIELD_COLORS.other;
                const mock = c.semesters.some((s) => s.mock);
                return (
                  <Link key={c.id} className={`card course-card ${hasPapers(c) ? "" : "empty"}`} href={programmeHref(c.id)}>
                    <div className="orb" style={{ background: `linear-gradient(135deg,${a},${b})` }} />
                    {q && (
                      <span className="field-tag">
                        <i style={{ background: a }} />
                        {fieldName[c.field]}
                      </span>
                    )}
                    <h3>{c.name}</h3>
                    <span className="mono">{c.schoolShort ? `${c.school} (${c.schoolShort})` : c.school}</span>
                    {c.years && (
                      <span className="mono">
                        {c.years} years · {c.years * 2} semesters{c.honoursYear ? " · 4th year optional" : ""}
                      </span>
                    )}
                    <span className="mono course-status">{mock ? "Mock data · dev only" : paperStatus(c)}</span>
                  </Link>
                );
              })}
              <Link className="card add" href="/send/">
                <h3>{cards.length ? "Have papers for your course?" : "No match yet."}</h3>
                <span>Send us photos of your past papers and we&apos;ll add them →</span>
              </Link>
            </div>
          )}
        </div>
      </section>

      {p && (
        <section className="how" id="how">
          <div className="mono" style={{ color: "var(--cyan)" }}>
            02 / How it works
          </div>
          <h2>Photos in. Searchable papers out.</h2>
          <div className="how-grid">
            <div className="how-card">
              <div className="mono" style={{ color: "var(--lav)" }}>
                1 · Collect
              </div>
              <div className="big">{papers} papers</div>
              <h3>Students photograph their papers.</h3>
              <p style={{ color: "var(--muted)", margin: 0 }}>
                Mid-sems and End Sems, every subject. Each paper keeps its exam, month and year, and every question links back to the photo
                of its page.
              </p>
            </div>
            <div className="how-card">
              <div className="mono" style={{ color: "var(--lav)" }}>
                2 · Read and check
              </div>
              <div className="big">{total("questions")} questions</div>
              <h3>An open AI model reads them.</h3>
              <p style={{ color: "var(--muted)", margin: 0 }}>
                Gemma 4, an open-weight model, reads every question, maths and tables included. Our pipeline checks each answer and drops
                bits of other papers caught in the photo ({total("dropped_bleed_through")} so far).
              </p>
            </div>
            <div className="how-card">
              <div className="mono" style={{ color: "var(--lav)" }}>
                3 · Rank
              </div>
              <div className="big">{total("repeats")} repeats</div>
              <h3>Topics that keep coming back go first.</h3>
              <p style={{ color: "var(--muted)", margin: 0 }}>
                Questions are grouped into topics and ranked by how often and how heavily they were asked.
                {evalResult &&
                  ` Repeat finding was checked on ${evalPack?.course.name} against ${evalResult.expected} repeats we found by hand: it caught ${evalResult.found}.`}
              </p>
            </div>
          </div>
        </section>
      )}

      <BottomBar />
    </>
  );
}
