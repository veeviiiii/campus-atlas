"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EarthHandle } from "./EarthGlobe";
import { HEAT_COLORS, SUBJECT_COLORS, type PlanetHandle } from "./PlanetGlobe";
import TopicPanel from "./TopicPanel";
import { buildPlanet, type City } from "@/lib/planet";
import { clearStudied, setStudied, useStudied } from "@/lib/progress";
import type { College, Pack, PackEntry, Topic } from "@/lib/types";

const EarthGlobe = dynamic(() => import("./EarthGlobe"), { ssr: false });
const PlanetGlobe = dynamic(() => import("./PlanetGlobe"), { ssr: false });

export interface AtlasHandle {
  openCollege: (college: College) => void;
  openTopic: (entryKey: string, topicId: string) => void;
}

export function honestyLine(pack: Pack): string {
  const years = [...new Set(pack.sources.exams.map((e) => e.date.slice(0, 4)))].sort();
  const span = years.length > 1 ? `${years[0]}-${years[years.length - 1].slice(2)}` : years[0];
  const syllabus = pack.sources.syllabus
    ? `Syllabus: ${pack.sources.syllabus.batch} (old).`
    : "No syllabus used: units are grouped from the questions.";
  return `Based on ${pack.stats.papers} papers from ${pack.sources.exams.length} exams (${span}). ${syllabus}`;
}

export default function AtlasSection({ entries, handleRef }: { entries: PackEntry[]; handleRef: React.RefObject<AtlasHandle | null> }) {
  const colleges = useMemo(() => {
    const seen = new Map<string, College>();
    for (const e of entries) if (!seen.has(e.pack.college.id)) seen.set(e.pack.college.id, e.pack.college);
    return [...seen.values()];
  }, [entries]);
  const isMock = entries.some((e) => e.pack.mock);

  const [view, setView] = useState<"earth" | "planet">("earth");
  const [college, setCollege] = useState<College | null>(null);
  const [entryKey, setEntryKey] = useState<string | null>(null);
  const [topic, setTopic] = useState<{ topic: Topic; city: City } | null>(null);
  // Shared with the study tools below the explorer (same localStorage key as before).
  const studied = useStudied(entryKey);
  const [examTomorrow, setExamTomorrow] = useState(false);
  const [colorBy, setColorBy] = useState<"heat" | "subject">("heat");
  const [fog, setFog] = useState(true);
  const [listOn, setListOn] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [inView, setInView] = useState(false);
  const earth = useRef<EarthHandle | null>(null);
  const planetCtl = useRef<PlanetHandle | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const exploreRef = useRef<HTMLDivElement>(null);

  const entry = entries.find((e) => e.key === entryKey) ?? null;
  const options = college ? entries.filter((e) => e.pack.college.id === college.id) : [];
  const planet = useMemo(() => (entry ? buildPlanet(entry.pack) : null), [entry]);

  // Globes only render while the section is on screen (and only the one that is showing).
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05 });
    if (sectionRef.current) io.observe(sectionRef.current);
    return () => io.disconnect();
  }, []);

  const setTopicStudied = useCallback((topicId: string, value: boolean) => setStudied(entryKey, topicId, value), [entryKey]);

  const totalTopics = planet?.cities.length ?? 0;
  const explored = planet ? planet.cities.filter((c) => studied.has(c.topic.id)).length : 0;
  const ranked = useMemo(
    () =>
      planet
        ? [...planet.cities].sort(
            (a, b) =>
              Number(b.topic.is_repeat) - Number(a.topic.is_repeat) ||
              Number(b.unit.blind_spot) - Number(a.unit.blind_spot) ||
              b.topic.total_marks - a.topic.total_marks,
          )
        : [],
    [planet],
  );
  // "Exam tomorrow": unexplored topics, repeats first, then blind spots, then by marks.
  const route = useMemo(
    () => (examTomorrow ? ranked.filter((c) => !studied.has(c.topic.id)).slice(0, 10) : null),
    [ranked, studied, examTomorrow],
  );

  const pick = useCallback((c: College) => {
    setCollege(c);
    earth.current?.flyTo(c.lat, c.lng, 0.9, 1600);
  }, []);
  const onTopic = useCallback((t: Topic, c: City) => setTopic({ topic: t, city: c }), []);
  // Bring the globe + panel fully on screen (after the planet's filter row has rendered).
  const toStage = () =>
    setTimeout(() => {
      const target = sectionRef.current?.querySelector(".filters") ?? exploreRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);

  function enter(key: string) {
    setEntryKey(key);
    setTopic(null);
    setFilter(null);
    setView("planet");
    toStage();
  }

  function backToEarth() {
    setView("earth");
    setTopic(null);
    setExamTomorrow(false);
    if (college) earth.current?.flyTo(college.lat, college.lng, 2.1, 1400);
  }

  function chooseFilter(subjectId: string | null) {
    setFilter(subjectId);
    if (!planet) return;
    if (subjectId === null) planetCtl.current?.resetView();
    else planetCtl.current?.flyToSubject(planet.continents.findIndex((c) => c.subject.id === subjectId));
  }

  function openFromList(c: City) {
    setTopic({ topic: c.topic, city: c });
    planetCtl.current?.flyToCity(c);
    if (window.innerWidth < 1000) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Let other parts of the page (hero planet, campus cards) drive the explorer.
  useEffect(() => {
    handleRef.current = {
      openCollege: (c) => {
        toStage();
        setView("earth");
        setTopic(null);
        pick(c);
      },
      openTopic: (key, topicId) => {
        toStage();
        const e = entries.find((x) => x.key === key);
        if (!e) return;
        setCollege(e.pack.college);
        if (key !== entryKey) enter(key);
        else setView("planet");
        const p = buildPlanet(e.pack);
        const c = p.cities.find((x) => x.topic.id === topicId);
        if (c) {
          setTopic({ topic: c.topic, city: c });
          setTimeout(() => planetCtl.current?.flyToCity(c), 2000);
        }
      },
    };
  });

  // Dev-only test hook: open a topic by name from the console / automated checks.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !planet) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__atlasOpenTopic = (name: string) => {
      const c = planet.cities.find((x) => x.topic.name.toLowerCase().includes(name.toLowerCase()));
      if (c) setTopic({ topic: c.topic, city: c });
      return c?.topic.name ?? null;
    };
  }, [planet]);

  const pack = entry?.pack;
  const blindUnits = pack ? pack.subjects.flatMap((s) => s.units.filter((u) => u.blind_spot)).length : 0;

  return (
    <section className="atlas" id="atlas" ref={sectionRef}>
      <div className="mono" style={{ color: "var(--cyan)" }}>
        {view === "planet" && pack
          ? `${pack.college.name} · ${pack.course.name} · Semester ${pack.course.semester} · ${pack.stats.papers} real papers`
          : `Real past papers · ${colleges.length} campus${colleges.length === 1 ? "" : "es"} mapped${isMock ? " · mock data" : ""}`}
      </div>
      <h2>{view === "planet" ? "Tap a city. See what was asked." : "Pick a campus. Fly in."}</h2>

      <div className="explore" id="explore" ref={exploreRef}>
        {view === "planet" && pack ? (
          <div className="filters" role="group" aria-label="Subject filter">
            <button aria-pressed={filter === null} onClick={() => chooseFilter(null)}>
              All subjects
            </button>
            {pack.subjects.map((s) => (
              <button key={s.id} aria-pressed={filter === s.id} onClick={() => chooseFilter(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ height: 22 }} />
        )}

        <div className="stage">
          <div className="vp">
            <div className="globe-layer" style={{ opacity: view === "earth" ? 1 : 0, pointerEvents: view === "earth" ? "auto" : "none" }}>
              <EarthGlobe
                colleges={colleges}
                onPick={pick}
                onAddCollege={() => document.getElementById("camp")?.scrollIntoView({ behavior: "smooth" })}
                handleRef={earth}
                active={inView && view === "earth"}
              />
            </div>
            {planet && (
              <div
                className="globe-layer"
                style={{ opacity: view === "planet" ? 1 : 0, pointerEvents: view === "planet" ? "auto" : "none" }}
              >
                <PlanetGlobe
                  planet={planet}
                  studied={studied}
                  route={route}
                  selectedId={topic?.topic.id ?? null}
                  colorBy={colorBy}
                  fog={fog}
                  filter={filter}
                  active={inView && view === "planet"}
                  onTopic={onTopic}
                  handleRef={planetCtl}
                />
              </div>
            )}

            {view === "planet" ? (
              <>
                <button className="tag btn mono" style={{ left: "4%", top: "5%" }} onClick={backToEarth}>
                  ← Earth
                </button>
                <span className="tag mono" style={{ right: "4%", top: "5%" }}>
                  {explored} / {totalTopics} explored
                </span>
                <div className="ctl mono">
                  <button aria-pressed={colorBy === "heat"} onClick={() => setColorBy((c) => (c === "heat" ? "subject" : "heat"))}>
                    Heat
                  </button>
                  <button aria-pressed={fog} onClick={() => setFog((f) => !f)}>
                    Fog
                  </button>
                  <button aria-pressed={listOn} onClick={() => setListOn((v) => !v)}>
                    List view
                  </button>
                  <button aria-pressed={examTomorrow} onClick={() => setExamTomorrow((v) => !v)}>
                    Exam tomorrow
                  </button>
                  <button
                    onClick={() => {
                      setTopic(null);
                      setFilter(null);
                      planetCtl.current?.resetView();
                    }}
                  >
                    Reset
                  </button>
                  {explored > 0 && (
                    <button onClick={() => clearStudied(entryKey)}>
                      Clear progress
                    </button>
                  )}
                </div>
              </>
            ) : (
              <span className="tag mono" style={{ left: "4%", top: "5%" }}>
                Drag to spin · click a pin
              </span>
            )}

            {view === "earth" && college && (
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  right: 14,
                  bottom: 14,
                  zIndex: 6,
                  background: "rgba(19,18,26,.92)",
                  border: "1px solid var(--border)",
                  borderRadius: 24,
                  padding: 18,
                  backdropFilter: "blur(10px)",
                }}
              >
                <div className="mono" style={{ color: "var(--muted)" }}>
                  {college.city}
                </div>
                <h3 style={{ fontSize: 28, margin: "4px 0 12px" }}>{college.name}</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {options.map((e) => (
                    <button key={e.key} className="pill sm lime" onClick={() => enter(e.key)}>
                      {e.pack.course.name} · Semester {e.pack.course.semester} →
                    </button>
                  ))}
                  <button className="pill sm" onClick={() => setCollege(null)}>
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className="panel" aria-live="polite" ref={panelRef}>
            {view === "earth" || !pack || !planet ? (
              <>
                <div className="mono" style={{ color: "var(--lav)" }}>
                  Find your campus
                </div>
                <h3>Pick a pin on the globe.</h3>
                <p style={{ color: "var(--muted)", margin: 0 }}>
                  Each campus is built from its own past exam papers, read by an open-weight model and checked by our Trust Harness. Pick
                  one to fly in and see what it actually asks.
                </p>
                {colleges.map((c) => (
                  <button key={c.id} className="q" style={{ textAlign: "left", border: "1px solid var(--border)" }} onClick={() => pick(c)}>
                    <b>{c.name}</b>
                    <div className="mono" style={{ color: "var(--muted)" }}>
                      {c.city} · {entries.filter((e) => e.pack.college.id === c.id).length} course pack
                    </div>
                  </button>
                ))}
                <a className="mono" href="#camp" style={{ color: "var(--accent)" }}>
                  + Add your college ↓
                </a>
              </>
            ) : topic ? (
              <TopicPanel
                pack={pack}
                topic={topic.topic}
                city={topic.city}
                studied={studied.has(topic.topic.id)}
                onStudied={(v) => setTopicStudied(topic.topic.id, v)}
                onClose={() => setTopic(null)}
              />
            ) : route ? (
              <>
                <div className="mono" style={{ color: "var(--accent)" }}>
                  Exam tomorrow
                </div>
                <h3>Study in this order.</h3>
                <p style={{ color: "var(--muted)", margin: 0 }}>Unexplored topics: repeats first, then blind spots, then by marks.</p>
                {route.length === 0 && <p>Everything is explored.</p>}
                {route.map((c, i) => (
                  <button
                    key={c.topic.id}
                    className="q"
                    style={{ textAlign: "left", border: "1px solid var(--border)" }}
                    onClick={() => openFromList(c)}
                  >
                    <span className="mono" style={{ color: "var(--muted)" }}>
                      {String(i + 1).padStart(2, "0")} · {c.subject.name}
                    </span>
                    <div>
                      <b>{c.topic.name}</b>
                    </div>
                    <span className="mono" style={{ color: HEAT_COLORS[c.heat] }}>
                      {c.topic.is_repeat ? "repeat" : c.unit.blind_spot ? "blind spot" : `${c.topic.exams_count} exam(s)`} ·{" "}
                      {c.topic.total_marks} marks
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <>
                <div className="mono" style={{ color: "var(--lav)" }}>
                  Topic details
                </div>
                <h3>Pick a city on the planet.</h3>
                <p style={{ color: "var(--muted)", margin: 0 }}>
                  Drag to rotate, tap a square, or use List view. Red rings came back from an MST in the End Sem; lavender borders mark
                  blind spots. Studying a topic, or passing its quiz, clears its fog.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    [pack.stats.questions, "questions"],
                    [pack.stats.repeats, "came back word for word or nearly"],
                    [blindUnits, "blind-spot units"],
                    [pack.stats.dropped_bleed_through, "fragments of other papers dropped"],
                  ].map(([n, label]) => (
                    <div key={label as string} className="q">
                      <div style={{ font: "700 34px/1 var(--font-space-grotesk)" }}>{n}</div>
                      <div className="mono" style={{ color: "var(--muted)", marginTop: 6 }}>
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mono" style={{ color: "var(--accent)" }}>
                  Square size = how many exams asked it · colour = heat
                </div>
              </>
            )}
          </aside>
        </div>
      </div>

      {view === "planet" && pack && (
        <>
          <div className="legend mono">
            <span>
              <i style={{ background: HEAT_COLORS.repeat }} />
              Repeat: MST → End Sem
            </span>
            <span>
              <i style={{ background: HEAT_COLORS.multi }} />
              Asked in 2+ exams
            </span>
            <span>
              <i style={{ background: HEAT_COLORS.once }} />
              Asked once
            </span>
            <span>
              <i style={{ background: "transparent", border: "2px solid var(--lav)" }} />
              Blind spot unit (End Sem only)
            </span>
            <span>
              <i style={{ background: "#bb6a89" }} />
              Dimmed (fog): not studied yet
            </span>
          </div>
          <p className="mono" style={{ color: "var(--muted)", position: "relative", zIndex: 1, maxWidth: "80ch" }}>
            {honestyLine(pack)} Past patterns are not a prediction of future exams.
          </p>
          <div className={`list ${listOn ? "on" : ""}`} id="topics">
            {ranked.map((c) => (
              <button key={c.topic.id} onClick={() => openFromList(c)}>
                <b>{c.topic.name}</b>
                <div className="mono" style={{ color: "var(--muted)" }}>
                  <span style={{ color: SUBJECT_COLORS[c.subjectIndex % SUBJECT_COLORS.length] }}>{c.subject.name}</span> / {c.unit.name}
                </div>
                <div className="mono" style={{ color: HEAT_COLORS[c.heat] }}>
                  {c.topic.is_repeat ? "repeat" : `${c.topic.exams_count} exam(s)`} · {c.topic.total_marks} marks
                  {studied.has(c.topic.id) ? " · ✓" : ""}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
