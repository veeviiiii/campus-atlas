"use client";

import { useMemo, useState } from "react";

import { MathText } from "../QuestionText";
import { metric, metricMax, metricText, SectionHead, subjectOf, TopicBadges, type StudyCtx } from "./common";
import { countText, type DTopic } from "@/lib/dataset";

type Sort = "m" | "f" | "u" | "n";

/** Heatmap: which topics leave the biggest footprint in the papers. */
export default function Pattern({ ctx, n }: { ctx: StudyCtx; n: string }) {
  const { ds, studied } = ctx;
  const [sub, setSub] = useState("ALL");
  const [sort, setSort] = useState<Sort>(ds.real ? "m" : "f");
  const [sel, setSel] = useState(ds.rank[0]);
  const [all, setAll] = useState(false);

  const ids = useMemo(() => {
    const cmp: Record<Sort, (a: DTopic, b: DTopic) => number> = {
      m: (a, b) => (b.marks ?? 0) - (a.marks ?? 0) || b.count - a.count,
      f: (a, b) => b.count - a.count || (b.marks ?? 0) - (a.marks ?? 0),
      u: (a, b) => a.subjectIndex - b.subjectIndex || a.unitNo - b.unitNo,
      n: (a, b) => a.name.localeCompare(b.name),
    };
    return ds.topics
      .filter((t) => sub === "ALL" || t.subjectId === sub)
      .sort((a, b) => cmp[sort](a, b) || a.name.localeCompare(b.name))
      .map((t) => t.id);
  }, [ds, sub, sort]);

  const selId = ids.includes(sel) ? sel : ids[0];
  const x = ds.byId.get(selId)!;
  const max = metricMax(ds);
  const lower = ds.topics.filter((y) => metric(ds, y) < metric(ds, x)).length;
  const shown = all ? ids : ids.slice(0, 12);
  const sample = x.questions.find((q) => q.exam === "end") ?? x.questions[0];
  const repeats = ds.topics.filter((t) => t.isRepeat).length;

  return (
    <section className="sec" id="pattern">
      <SectionHead n={n} kicker="pattern_k" title="pattern_h" ctx={ctx} />
      <div className="mono" style={{ color: "var(--lav)", marginBottom: 18 }}>
        {ds.topics.length} topics · {ds.subjects.length} subjects ·{" "}
        {ds.real ? `${ds.questions.length} real questions · ${repeats} repeat topics` : `${ds.countOf} sample papers · demo data`}
      </div>
      <div className="g2">
        <div>
          <div className="filters" style={{ paddingTop: 0 }}>
            <select className="sel" value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Subject">
              <option value="ALL">All subjects</option>
              {ds.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className="sel" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              {ds.real && <option value="m">Most marks</option>}
              <option value="f">{ds.real ? "Most exams" : "Most frequent"}</option>
              <option value="u">By unit</option>
              <option value="n">A–Z</option>
            </select>
          </div>
          {shown.map((id) => {
            const t = ds.byId.get(id)!;
            return (
              <button key={id} className="hb" aria-pressed={id === selId} onClick={() => setSel(id)}>
                <span>
                  {t.name}
                  {studied.has(id) ? " ✓" : ""}
                </span>
                <span className="tr">
                  <i style={{ width: `${(metric(ds, t) / max) * 100}%`, background: t.color }} />
                </span>
                <b className="mono">{metricText(ds, t)}</b>
              </button>
            );
          })}
          {ids.length > 12 && (
            <button className="pill sm" style={{ marginTop: 12 }} onClick={() => setAll((v) => !v)}>
              {all ? "Show top 12" : `Show all ${ids.length}`}
            </button>
          )}
        </div>

        <div className="bx" aria-live="polite">
          <div className="mono" style={{ color: subjectOf(ds, x).color }}>
            {subjectOf(ds, x).name} / {x.unitName}
          </div>
          <h3 style={{ fontSize: 34 }}>{x.name}</h3>
          <div className="mono">
            {countText(ds, x)}
            {x.marks != null ? ` · ${x.marks} marks` : ""}
          </div>
          <div className="bar">
            <b style={{ width: `${(metric(ds, x) / max) * 100}%`, background: x.color }} />
          </div>
          <TopicBadges topic={x} />
          <div className="note">
            {ds.real ? "Carries more marks than" : "Mentioned more often than"} {lower} of {ds.topics.length - 1} other topics.{" "}
            {studied.has(x.id) ? "You have studied it." : "Not yet studied."}
          </div>
          {sample && (
            <div className="q">
              <div className="mono" style={{ color: "var(--muted)" }}>
                {ds.real ? `${sample.examName}${sample.marks != null ? ` · ${sample.marks} marks` : ""} · ${x.questions.length} question(s) in this topic` : "Sample question · demo"}
              </div>
              <p style={{ margin: "6px 0 0" }}>
                <MathText text={sample.text} />
              </p>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ctx.openInAtlas && (
              <button className="pill sm lime" onClick={() => ctx.openInAtlas?.(x.id)}>
                Open in Atlas ↗
              </button>
            )}
            <button className="pill sm" onClick={() => ctx.viewInConstellation(x.id)}>
              View in Constellation
            </button>
            {x.quiz.length > 0 && (
              <button className="pill sm" onClick={() => ctx.practice([x.id])}>
                Practice
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bx" style={{ marginTop: 18 }}>
        <div className="mono">Average {ds.countNoun} per topic, by subject</div>
        {ds.subjects.map((s) => {
          const g = ds.topics.filter((t) => t.subjectId === s.id);
          const avg = g.reduce((a, t) => a + t.count, 0) / Math.max(1, g.length);
          return (
            <div key={s.id} className="hb" style={{ cursor: "default" }}>
              <span>{s.name}</span>
              <span className="tr">
                <i style={{ width: `${(avg / ds.countOf) * 100}%`, background: s.color }} />
              </span>
              <b className="mono">
                {avg.toFixed(1)} / {ds.countOf}
              </b>
            </div>
          );
        })}
      </div>
      <div className="legend mono" style={{ marginTop: 14 }}>
        {ds.legend.map((l) => (
          <span key={l.label}>
            <i style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <p className="note">{ds.honesty}</p>
    </section>
  );
}
