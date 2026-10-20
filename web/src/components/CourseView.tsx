"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { HEAT_COLORS, SUBJECT_COLORS } from "./PlanetGlobe";
import { rankTopics } from "@/lib/likely";
import { examDate, papersOf } from "@/lib/papers";
import { subjectHref, topicHref } from "@/lib/paths";
import { buildPlanet } from "@/lib/planet";
import type { PackEntry } from "@/lib/types";

// three.js only loads if someone opens the Map tab
const PlanetGlobe = dynamic(() => import("./PlanetGlobe"), { ssr: false });

/** A course-semester: its subjects (the main way in) and, optionally, the semester as a planet. */
export default function CourseView({ entry }: { entry: PackEntry }) {
  const { key, pack } = entry;
  const exams = pack.sources.exams;
  const [tab, setTab] = useState<"subjects" | "map">("subjects");
  const router = useRouter();
  const planet = useMemo(() => (tab === "map" ? buildPlanet(pack) : null), [tab, pack]);

  const subjects = useMemo(
    () =>
      pack.subjects.map((s) => {
        const topics = s.units.flatMap((u) => u.topics);
        return {
          s,
          papers: papersOf(exams, s).length,
          questions: topics.reduce((n, t) => n + t.questions.length, 0),
          repeats: topics.filter((t) => t.is_repeat).length,
          top: rankTopics(exams, s)[0]?.topic.name,
        };
      }),
    [pack, exams],
  );

  return (
    <>
      <div className="tabs" role="tablist" aria-label="View">
        <button role="tab" aria-selected={tab === "subjects"} onClick={() => setTab("subjects")}>
          Subjects <span>{pack.subjects.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}>
          Map
        </button>
      </div>

      {tab === "subjects" ? (
        <div className="subject-grid">
          {subjects.map(({ s, papers, questions, repeats, top }, i) => (
            <Link key={s.id} href={subjectHref(key, s.id)} className="subj-card">
              <i className="subj-dot" style={{ background: SUBJECT_COLORS[i % SUBJECT_COLORS.length] }} />
              <h3>{s.name}</h3>
              <span className="mono">
                {papers} papers · {questions} questions
              </span>
              {repeats > 0 && (
                <span className="mono" style={{ color: HEAT_COLORS.repeat }}>
                  {repeats} {repeats === 1 ? "topic" : "topics"} came back in the End Sem
                </span>
              )}
              {top && (
                <span className="subj-top">
                  Most asked: <b>{top}</b>
                </span>
              )}
              <span className="subj-go">Open papers →</span>
            </Link>
          ))}
        </div>
      ) : (
        <>
          <div className="vp">{planet && <PlanetGlobe planet={planet} onPick={(c) => router.push(topicHref(key, c.subject.id, c.topic.id))} />}</div>
          <div className="legend mono">
            <span>
              <i style={{ background: HEAT_COLORS.repeat }} />
              Came back: mid-sem → End Sem
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
              Unit never tested in the mid-sems
            </span>
          </div>
          <p className="note">
            Continents are subjects, countries are units, squares are topics. Drag to turn it, click a country to zoom, click a square to
            open its questions.
          </p>
        </>
      )}

      <p className="note">
        Based on {pack.stats.papers} papers: {exams.map((e) => `${e.name} (${examDate(e.date)})`).join(", ")}.{" "}
        {pack.sources.syllabus
          ? `Units named with help from the ${pack.sources.syllabus.batch} syllabus (old).`
          : "No syllabus was used: units and topics are grouped from the questions themselves."}
      </p>
    </>
  );
}
