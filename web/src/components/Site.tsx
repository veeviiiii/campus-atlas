"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { SiteFooter, SiteNav } from "./Chrome";
import HeroPlanet from "./HeroPlanet";
import { examsSummary } from "@/lib/papers";
import { courseHref, topicHref } from "@/lib/paths";
import { buildPlanet } from "@/lib/planet";
import type { PackEntry } from "@/lib/types";

const ORBS = [
  ["#7657ff", "#54e4ff"],
  ["#ff786d", "#ffc24a"],
  ["#4268ff", "#d7ff52"],
  ["#f08bf0", "#7657ff"],
];

/** Home: what this is in one line, then straight to the list of courses. */
export default function Site({ entries }: { entries: PackEntry[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const first = entries[0];
  const heroPlanet = useMemo(() => (first ? buildPlanet(first.pack) : null), [first]);
  const p = first?.pack;
  const evalResult = p?.harness?.eval;
  const papers = entries.reduce((n, e) => n + e.pack.stats.papers, 0);

  const cards = entries.filter((e) =>
    `${e.pack.college.name} ${e.pack.college.city} ${e.pack.course.name} semester ${e.pack.course.semester} ${e.pack.subjects.map((s) => s.name).join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

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
        <h2 style={{ marginTop: 20 }}>Pick your course and semester.</h2>
        <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Course, subject or department" aria-label="Search courses" />
          <button type="button" onClick={() => setQuery("")}>
            Clear
          </button>
        </form>
        <div className="cards">
          {cards.map((e, i) => (
            <Link key={e.key} className="card" href={courseHref(e.key)}>
              <div className="orb" style={{ background: `linear-gradient(135deg,${ORBS[i % ORBS.length][0]},${ORBS[i % ORBS.length][1]})` }} />
              <h3>
                {e.pack.course.name} · Semester {e.pack.course.semester}
              </h3>
              <span className="mono">{e.pack.college.name}</span>
              <span>{examsSummary(e.pack.sources.exams)}</span>
              <span className="mono">
                {e.pack.subjects.length} subjects · {e.pack.stats.papers} papers · {e.pack.stats.questions} questions
              </span>
              <span className="mono" style={{ color: e.pack.mock ? "#a05a00" : "#3b7a00" }}>
                {e.pack.mock ? "Mock data · dev only" : "Open →"}
              </span>
            </Link>
          ))}
          <Link className="card add" href="/send/">
            <h3>{cards.length ? "Your course isn't here yet?" : "No match yet."}</h3>
            <span>Send us photos of your past papers and we&apos;ll add them →</span>
          </Link>
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
              <div className="big">{p.stats.questions} questions</div>
              <h3>An open AI model reads them.</h3>
              <p style={{ color: "var(--muted)", margin: 0 }}>
                Gemma 4, an open-weight model, reads every question, maths and tables included. Our pipeline checks each answer and drops
                bits of other papers caught in the photo ({p.stats.dropped_bleed_through} here).
              </p>
            </div>
            <div className="how-card">
              <div className="mono" style={{ color: "var(--lav)" }}>
                3 · Rank
              </div>
              <div className="big">{p.stats.repeats} repeats</div>
              <h3>Topics that keep coming back go first.</h3>
              <p style={{ color: "var(--muted)", margin: 0 }}>
                Questions are grouped into topics and ranked by how often and how heavily they were asked.
                {evalResult &&
                  ` Repeat finding was checked against ${evalResult.expected} repeats we found by hand: it caught ${evalResult.found}.`}
              </p>
            </div>
          </div>
        </section>
      )}

      <SiteFooter />
    </>
  );
}
