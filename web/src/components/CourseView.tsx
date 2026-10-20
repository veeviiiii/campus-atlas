"use client";

import Link from "next/link";
import { useMemo } from "react";

import MiniPlanet from "./MiniPlanet";
import { HEAT, SUBJECT_COLORS } from "@/lib/colors";
import { rankTopics } from "@/lib/likely";
import { examDate, papersOf } from "@/lib/papers";
import { subjectHref } from "@/lib/paths";
import { heatOf } from "@/lib/planet";
import type { PackEntry } from "@/lib/types";

/** A course-semester: one card per subject, each with a small planet of its topics. The card is the way in. */
export default function CourseView({ entry }: { entry: PackEntry }) {
  const { key, pack } = entry;
  const exams = pack.sources.exams;

  const subjects = useMemo(
    () =>
      pack.subjects.map((s) => {
        const topics = s.units.flatMap((u) => u.topics);
        return {
          s,
          planet: topics.map((t) => ({ heat: heatOf(t), weight: t.exams_count + (t.is_repeat ? 1 : 0) })),
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
      <div className="legend mono" aria-label="Colour key">
        <span>Each square is a topic:</span>
        <span>
          <i style={{ background: HEAT.repeat }} />
          came back in the End Sem
        </span>
        <span>
          <i style={{ background: HEAT.multi }} />
          asked in 2+ exams
        </span>
        <span>
          <i style={{ background: HEAT.once }} />
          asked once
        </span>
      </div>

      <div className="subject-grid">
        {subjects.map(({ s, planet, papers, questions, repeats, top }, i) => (
          <Link key={s.id} href={subjectHref(key, s.id)} className="subj-card">
            <MiniPlanet topics={planet} tint={SUBJECT_COLORS[i % SUBJECT_COLORS.length]} />
            <h3>{s.name}</h3>
            <span className="mono">
              {papers} papers · {questions} questions
            </span>
            {repeats > 0 && (
              <span className="mono" style={{ color: HEAT.repeat }}>
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

      <p className="note">
        Based on {pack.stats.papers} papers: {exams.map((e) => `${e.name} (${examDate(e.date)})`).join(", ")}.{" "}
        {pack.sources.syllabus
          ? `Units named with help from the ${pack.sources.syllabus.batch} syllabus (old).`
          : "No syllabus was used: units and topics are grouped from the questions themselves."}
      </p>
    </>
  );
}
