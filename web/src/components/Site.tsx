"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import AtlasSection, { type AtlasHandle } from "./AtlasSection";
import HeroPlanet from "./HeroPlanet";
import Features from "./study/Features";
import { dirOf, LANGS, useLang, useT } from "@/lib/i18n";
import { buildPlanet } from "@/lib/planet";
import type { PackEntry } from "@/lib/types";

const REPO_URL = "https://github.com/veeviiiii/campus-atlas";
const ORBS = [
  ["#7657ff", "#54e4ff"],
  ["#ff786d", "#ffc24a"],
  ["#4268ff", "#d7ff52"],
  ["#f08bf0", "#7657ff"],
];
const HARNESS_STEPS = ["Render", "Orient", "Read header", "Extract", "Validate", "Bleed-through check", "Group units & topics", "Find repeats", "Score", "Quiz", "Pack + report"];

export default function Site({ entries }: { entries: PackEntry[] }) {
  const atlas = useRef<AtlasHandle | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [query, setQuery] = useState("");
  const [lang, setLang] = useLang();
  const t = useT();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const first = entries[0];
  const heroPlanet = useMemo(() => (first ? buildPlanet(first.pack) : null), [first]);
  const p = first?.pack;
  const evalResult = p?.harness?.eval;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  const cards = entries.filter((e) =>
    `${e.pack.college.name} ${e.pack.college.city} ${e.pack.course.name}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <nav className={`top ${scrolled ? "s" : ""}`} id="nav" dir={dirOf(lang)}>
        <a className="logo" href="#">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <circle cx="15" cy="15" r="12" fill="none" stroke="#7657FF" strokeWidth="3" />
            <path d="M3 15h24M15 3c-6 6-6 18 0 24" stroke="#C4B5FD" strokeWidth="2" fill="none" />
            <rect x="21" y="5" width="5" height="5" fill="#D7FF52" />
          </svg>
          campus atlas
        </a>
        <ul>
          <li>
            <a href="#explore">{t("explore")}</a>
          </li>
          <li>
            <a href="#how">{t("how")}</a>
          </li>
          <li>
            <a href="#pattern">{t("tools")}</a>
          </li>
          <li>
            <a href="#camp">{t("camp")}</a>
          </li>
          <li>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {t("oss")} ↗
            </a>
          </li>
        </ul>
        <div className="nr">
          <a className="pill lime" href="#explore">
            {t("enter")} ↗
          </a>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
            {LANGS.map(([code, native, english]) => (
              <option key={code} value={code} title={english}>
                {native}
              </option>
            ))}
          </select>
        </div>
      </nav>

      <header className="hero">
        <div>
          <div className="mono" style={{ color: "var(--cyan)", marginBottom: 18, position: "relative" }}>
            ✦ An atlas of academic patterns
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
            Every university asks things differently. Campus Atlas turns your university&apos;s past exam papers into a living map of what
            your exams actually focus on: what came back from the mid-sems, and what they never tested.
          </p>
          <div className="cta">
            <a className="pill lime" href="#explore">
              Explore {p ? "the real planet" : "the planet"} ↗
            </a>
            <a className="pill" href="#camp">
              Find my university ↓
            </a>
          </div>
        </div>
        {heroPlanet && first && (
          <div style={{ position: "relative" }}>
            <HeroPlanet cities={heroPlanet.cities} onPick={(c) => atlas.current?.openTopic(first.key, c.topic.id)} />
            <div className="mono" style={{ color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
              Live preview · {p?.college.name} · Semester {p?.course.semester} · click a square
            </div>
          </div>
        )}
      </header>

      <div className="mq" aria-hidden="true">
        <div>
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} style={{ color: "inherit", margin: 0 }}>
              <span>✦</span>Past papers<span>◆</span>Patterns<span>✦</span>Topics<span>◆</span>Quizzes<span>✦</span>Exam readiness
            </span>
          ))}
        </div>
      </div>

      <AtlasSection entries={entries} handleRef={atlas} />

      {p && (
        <section className="how" id="how">
          <div className="mono" style={{ color: "var(--cyan)" }}>
            02 / How it works
          </div>
          <h2>Open model. Checked answers. Anyone can add a college.</h2>
          <div className="how-grid">
            <div className="how-card">
              <div className="mono" style={{ color: "var(--lav)" }}>
                Open-weight AI
              </div>
              <div className="big">{p.stats.papers} papers</div>
              <h3>Gemma 4 reads every page.</h3>
              <p style={{ color: "var(--muted)", margin: 0 }}>
                An open-weight model ({p.harness?.model ?? "Gemma 4"}) reads phone photos of the papers: rotation, headers, every question,
                maths as LaTeX, tables. No closed AI company sees the papers.
              </p>
            </div>
            <div className="how-card">
              <div className="mono" style={{ color: "var(--lav)" }}>
                PYQ Trust Harness
              </div>
              <div className="big">{p.stats.dropped_bleed_through} dropped</div>
              <h3>Every answer is checked.</h3>
              <p style={{ color: "var(--muted)", margin: 0 }}>
                Answers are validated and retried; fragments of other papers caught in the photos are dropped and logged; anything it
                cannot verify goes to an unsure list ({p.unsure.length} items here), never onto the map.
              </p>
            </div>
            {evalResult && (
              <div className="how-card">
                <div className="mono" style={{ color: "var(--lav)" }}>
                  Eval
                </div>
                <div className="big">
                  {evalResult.found} of {evalResult.expected}
                </div>
                <h3>Repeats found.</h3>
                <p style={{ color: "var(--muted)", margin: 0 }}>
                  We checked the papers by hand and listed {evalResult.expected} questions that came back from a mid-sem in the End Sem.
                  The pipeline found {evalResult.found} of them.
                </p>
              </div>
            )}
            <div className="how-card">
              <div className="mono" style={{ color: "var(--lav)" }}>
                Agent Skill
              </div>
              <div className="big">pyq-atlas</div>
              <h3>Any agent can add a college.</h3>
              <p style={{ color: "var(--muted)", margin: 0 }}>
                An open-standard Agent Skill wraps the whole pipeline, so any skills-compatible agent can turn a new college&apos;s papers
                into a pack. Apache-2.0.
              </p>
            </div>
          </div>
          <div className="steps mono">
            {HARNESS_STEPS.map((s, i) => (
              <span key={s}>
                {String(i + 1).padStart(2, "0")} {s}
              </span>
            ))}
          </div>
        </section>
      )}

      <Features entries={entries} onOpenTopic={(key, topicId) => atlas.current?.openTopic(key, topicId)} />

      <section className="camp" id="camp">
        <div className="crt" aria-hidden="true">
          <div>:)</div>
        </div>
        <div className="mono">08 / Find your campus</div>
        <div className="pix" style={{ margin: "14px 0 8px" }}>
          find your
          <br />
          campus
        </div>
        <h2 style={{ marginTop: 20 }}>Every campus has a pattern.</h2>
        <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="University, city or course" aria-label="Search colleges" />
          <button type="button" onClick={() => setQuery("")}>
            Clear
          </button>
        </form>
        <div className="cards">
          {cards.map((e, i) => (
            <button key={e.key} className="card" onClick={() => atlas.current?.openCollege(e.pack.college)}>
              <div className="orb" style={{ background: `linear-gradient(135deg,${ORBS[i % ORBS.length][0]},${ORBS[i % ORBS.length][1]})` }} />
              <h3>{e.pack.college.name}</h3>
              <span className="mono">{e.pack.college.city}</span>
              <span>
                {e.pack.course.name} · Semester {e.pack.course.semester}
              </span>
              <span className="mono">
                {e.pack.stats.questions} questions · {e.pack.stats.papers} papers
              </span>
              <span className="mono" style={{ color: e.pack.mock ? "#a05a00" : "#3b7a00" }}>
                {e.pack.mock ? "Mock data · dev only" : "Available · real papers"}
              </span>
            </button>
          ))}
          <a className="card add" href={`${REPO_URL}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">
            <h3>{cards.length ? "Your college isn't here?" : "No match yet."}</h3>
            <span>Contribute a pack with the pyq-atlas skill ↗</span>
          </a>
        </div>
        <p style={{ maxWidth: "60ch", marginTop: 40 }}>
          Only the colleges above are mapped so far. Packs are built by the open pyq-atlas skill from real past papers and reviewed in pull
          requests before they appear.
        </p>
      </section>

      <footer>
        <div className="mono" style={{ color: "var(--muted)" }}>
          {HARNESS_STEPS.join(" → ")}
        </div>
        <div className="mono" style={{ color: "var(--muted)", marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            Apache-2.0
          </a>
          <a href={`${REPO_URL}/tree/main/skills/pyq-atlas`} target="_blank" rel="noreferrer">
            Agent Skill
          </a>
          <a href={`${REPO_URL}/blob/main/runs/sample/report.md`} target="_blank" rel="noreferrer">
            Run report
          </a>
        </div>
      </footer>

      <div className="bn">
        <a className="on" href="#">
          Home
        </a>
        <a href="#explore">Atlas</a>
        <a href="#how">How</a>
        <a href="#pattern">Study</a>
        <a href="#camp">Colleges</a>
      </div>
    </>
  );
}
