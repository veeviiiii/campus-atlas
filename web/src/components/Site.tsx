"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { SiteFooter, SiteNav } from "./Chrome";
import HeroPlanet from "./HeroPlanet";
import { FIELD_COLORS } from "@/lib/colors";
import { programmeHref, topicHref } from "@/lib/paths";
import { buildPlanet } from "@/lib/planet";
import type { CourseCard, Field, PackEntry } from "@/lib/types";

interface Props {
  entries: PackEntry[];
  courses: CourseCard[];
  fields: Field[];
  source: string;
}

/** "Sem 1 papers" / "Sem 1 and 3 papers" / "No papers yet". */
function paperStatus(c: CourseCard): string {
  const have = c.semesters.filter((s) => s.key).map((s) => s.semester);
  if (!have.length) return "No papers yet";
  return `Sem ${have.length > 1 ? `${have.slice(0, -1).join(", ")} and ${have[have.length - 1]}` : have[0]} papers →`;
}

/** Home: what this is in one line, then straight to the list of courses. */
export default function Site({ entries, courses, fields, source }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [field, setField] = useState<string | null>(null); // null = all fields

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
  const q = query.trim().toLowerCase();
  const matches = courses.filter((c) =>
    `${c.name} ${c.school} ${c.schoolShort ?? ""} ${fieldName[c.field]} ${c.subjects.join(" ")}`.toLowerCase().includes(q),
  );
  // Courses that have papers first; otherwise the catalogue's order (grouped by field).
  const cards = (field ? matches.filter((c) => c.field === field) : matches)
    .map((c, i) => ({ c, i, ready: c.semesters.some((s) => s.key) }))
    .sort((x, y) => Number(y.ready) - Number(x.ready) || x.i - y.i)
    .map(({ c }) => c);

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
        <h2 style={{ marginTop: 20 }}>Pick your course, then your semester.</h2>
        <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Course, school or subject" aria-label="Search courses" />
          <button type="button" onClick={() => setQuery("")}>
            Clear
          </button>
        </form>
        <div className="field-chips" role="group" aria-label="Field">
          {[null, ...allFields.map((f) => f.id)].map((id) => {
            const n = id ? matches.filter((c) => c.field === id).length : matches.length;
            return (
              <button key={id ?? "all"} type="button" aria-pressed={field === id} onClick={() => setField(id)}>
                {id && <i style={{ background: FIELD_COLORS[id]?.[0] }} />}
                {id ? allFields.find((f) => f.id === id)?.short : "All"} <span>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="cards">
          {cards.map((c) => {
            const [a, b] = FIELD_COLORS[c.field] ?? FIELD_COLORS.other;
            const ready = c.semesters.some((s) => s.key);
            const mock = c.semesters.some((s) => s.mock);
            return (
              <Link key={c.id} className={`card course-card ${ready ? "" : "empty"}`} href={programmeHref(c.id)}>
                <div className="orb" style={{ background: `linear-gradient(135deg,${a},${b})` }} />
                <span className="field-tag">
                  <i style={{ background: a }} />
                  {fieldName[c.field]}
                </span>
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
        <p className="mono catalog-source">Course list: {source}.</p>
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

      <SiteFooter />
    </>
  );
}
