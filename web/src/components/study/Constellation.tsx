"use client";

import { useMemo, useState } from "react";

import { HEAT } from "../HeroPlanet";
import { subjectOf, type StudyCtx } from "./common";
import { buildRoute, clusterLayout, countText, dependents, prerequisites, type Dataset } from "@/lib/dataset";
import { useT } from "@/lib/i18n";

const STRENGTH: Record<string, number> = { exact: 3, near: 2, "same-topic": 1 };
const LINK_COLOR: Record<string, string> = { exact: HEAT.repeat, near: HEAT.multi, "same-topic": "#c4b5fd" };
const LINK_LABEL: Record<string, string> = { exact: "word for word", near: "nearly the same", "same-topic": "same topic" };
const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Node {
  key: string;
  topicId: string;
  exam: string;
  x: number;
  y: number;
  marks: number;
}
interface Edge {
  a: string;
  b: string;
  type: string;
}

/** Real packs: one column per exam; a line joins an MST question to the End Sem question that repeats it. */
function examColumns(ds: Dataset, subjectId: string) {
  const topics = ds.topics.filter((t) => t.subjectId === subjectId).sort((a, b) => a.unitNo - b.unitNo || a.name.localeCompare(b.name));
  const cols = ds.exams.map((e) => topics.filter((t) => t.questions.some((q) => q.exam === e.id)));
  const rowH = 7;
  const top = 16;
  const rows = Math.max(1, ...cols.map((c) => c.length));
  const xs = ds.exams.map((_, i) => (ds.exams.length === 1 ? 8 : 8 + (i * 136) / (ds.exams.length - 1)));
  const nodes = new Map<string, Node>();
  cols.forEach((c, ci) =>
    c.forEach((t, ri) => {
      const exam = ds.exams[ci].id;
      const marks = t.questions.filter((q) => q.exam === exam).reduce((s, q) => s + (q.marks ?? 0), 0);
      const key = `${t.id}@${exam}`;
      nodes.set(key, { key, topicId: t.id, exam, x: xs[ci], y: top + ((rows - c.length) * rowH) / 2 + ri * rowH + rowH / 2, marks });
    }),
  );
  const qById = new Map(ds.questions.map((q) => [q.id, q]));
  const edges = new Map<string, Edge>();
  for (const t of topics)
    for (const q of t.questions)
      for (const r of q.repeatOf) {
        const src = qById.get(r.id);
        if (!src) continue;
        const a = `${src.topicId}@${src.exam}`;
        const b = `${t.id}@${q.exam}`;
        if (!nodes.has(a) || !nodes.has(b)) continue;
        const prev = edges.get(`${a}|${b}`);
        if (!prev || (STRENGTH[r.type] ?? 0) > (STRENGTH[prev.type] ?? 0)) edges.set(`${a}|${b}`, { a, b, type: r.type });
      }
  return { nodes, edges: [...edges.values()], xs, height: top + rows * rowH + 6 };
}

export default function Constellation({ ctx, sel, onSel }: { ctx: StudyCtx; sel: string | null; onSel: (id: string) => void }) {
  const { ds, studied } = ctx;
  const t = useT();
  const [subject, setSubject] = useState(() => (sel && ds.byId.get(sel)?.subjectId) || ds.subjects[0].id);
  const [routeOn, setRouteOn] = useState(false);

  const inScope = (id: string) => !ds.real || ds.byId.get(id)?.subjectId === subject;
  const selId = sel && ds.byId.has(sel) && inScope(sel) ? sel : ds.rank.find(inScope)!;
  const x = ds.byId.get(selId)!;
  const route = routeOn ? buildRoute(ds, studied, [], ds.real ? subject : "ALL").slice(0, 5) : [];

  const cols = useMemo(() => (ds.real ? examColumns(ds, subject) : null), [ds, subject]);
  const layout = useMemo(() => clusterLayout(ds), [ds]);
  const examName = new Map(ds.exams.map((e) => [e.id, e.name]));

  const links = cols ? cols.edges.filter((e) => e.a.startsWith(`${x.id}@`) || e.b.startsWith(`${x.id}@`)) : [];
  const reasons = ds.real
    ? [
        countText(ds, x),
        `${x.marks ?? 0} marks across ${x.questions.length} question${x.questions.length === 1 ? "" : "s"}`,
        ...links.map((e) => {
          const [, ea] = e.a.split("@");
          const [, eb] = e.b.split("@");
          return `${examName.get(ea)} → ${examName.get(eb)} · ${LINK_LABEL[e.type] ?? e.type}`;
        }),
        x.blindSpot ? "Blind-spot unit: never in the MSTs, asked in the End Sem" : null,
        studied.has(x.id) ? "Studied ✓" : "Not yet studied",
      ]
    : [
        `Appeared in ${x.count} of ${ds.countOf} sample papers`,
        dependents(ds, x.id)
          ? `Prerequisite for ${dependents(ds, x.id)} connected concept${dependents(ds, x.id) > 1 ? "s" : ""}`
          : "No dependents in the sample graph",
        studied.has(x.id) ? "Studied ✓" : "Not yet studied",
      ];
  const pre = prerequisites(ds, x.id);
  const chips = ds.real ? ds.topics.filter((y) => y.subjectId === subject) : ds.topics;

  return (
    <>
      {ds.real && (
        <div className="filters" style={{ paddingTop: 0 }} role="group" aria-label="Subject">
          {ds.subjects.map((s) => (
            <button key={s.id} aria-pressed={subject === s.id} onClick={() => setSubject(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="g2">
        <div>
          {cols ? (
            <svg viewBox={`0 0 210 ${cols.height}`} className="cs" role="img" aria-label="Repeat links between exams. Use the topic list for keyboard access.">
              {ds.exams.map((e, i) => (
                <text key={e.id} x={cols.xs[i]} y={9} fontSize="3.6" fill="#a09fb0" fontFamily="var(--font-plex-mono)">
                  {e.name.toUpperCase()}
                </text>
              ))}
              {cols.edges.map((e) => {
                const a = cols.nodes.get(e.a)!;
                const b = cols.nodes.get(e.b)!;
                const on = a.topicId === x.id || b.topicId === x.id;
                const mid = (a.x + b.x) / 2;
                return (
                  <path
                    key={`${e.a}|${e.b}`}
                    d={`M${a.x} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`}
                    fill="none"
                    stroke={LINK_COLOR[e.type] ?? "#c4b5fd"}
                    strokeWidth={on ? 0.9 : 0.5}
                    strokeOpacity={on ? 0.95 : 0.45}
                    strokeDasharray={e.type === "same-topic" ? "1.5 1" : undefined}
                  />
                );
              })}
              {[...cols.nodes.values()].map((nd) => {
                const tp = ds.byId.get(nd.topicId)!;
                const r = 1.6 + Math.min(2.4, nd.marks * 0.12);
                const n = route.indexOf(tp.id);
                const last = ds.exams.map((e) => `${tp.id}@${e.id}`).filter((k) => cols.nodes.has(k)).pop() === nd.key;
                return (
                  <g key={nd.key} onClick={() => onSel(tp.id)}>
                    <title>{`${tp.name} · ${examName.get(nd.exam)} · ${nd.marks} marks`}</title>
                    <circle
                      cx={nd.x}
                      cy={nd.y}
                      r={r}
                      fill={tp.color}
                      opacity={studied.has(tp.id) ? 1 : 0.75}
                      stroke={tp.blindSpot ? "#c4b5fd" : studied.has(tp.id) ? "#D7FF52" : "none"}
                      strokeWidth=".6"
                    />
                    {tp.id === x.id && <circle cx={nd.x} cy={nd.y} r={r + 1.6} fill="none" stroke="#54E4FF" strokeWidth=".5" />}
                    <text
                      x={nd.x + r + 1.8}
                      y={nd.y + 1.2}
                      fontSize="3.8"
                      fill={tp.id === x.id ? "#fff" : "#d8d4ee"}
                      stroke="#0d0c1c"
                      strokeWidth=".8"
                      paintOrder="stroke"
                    >
                      {short(tp.name)}
                    </text>
                    {n >= 0 && last && (
                      <>
                        <circle cx={nd.x - r - 3} cy={nd.y} r="2.4" fill="#D7FF52" />
                        <text x={nd.x - r - 3} y={nd.y + 1.1} fontSize="3" textAnchor="middle" fill="#09090B" fontWeight="700">
                          {n + 1}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          ) : (
            <svg viewBox="0 0 100 100" className="cs" role="img" aria-label="Concept constellation, demo prerequisite links. Use the topic list for keyboard access.">
              {ds.prereqs.map(([a, b]) => {
                const [x1, y1] = layout.get(a)!;
                const [x2, y2] = layout.get(b)!;
                return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#C4B5FD" strokeOpacity=".35" strokeWidth=".4" />;
              })}
              {route.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#D7FF52"
                  strokeWidth=".7"
                  strokeDasharray="1.5 1"
                  points={route.map((id) => layout.get(id)!.join(",")).join(" ")}
                />
              )}
              {ds.topics.map((tp) => {
                const [px, py] = layout.get(tp.id)!;
                const r = 2 + tp.count * 0.6;
                const on = studied.has(tp.id);
                return (
                  <g key={tp.id} onClick={() => onSel(tp.id)}>
                    <circle cx={px} cy={py} r={r} fill={subjectOf(ds, tp).color} opacity={on ? 1 : 0.5} stroke={on ? "#D7FF52" : "none"} strokeWidth=".7" />
                    {tp.id === x.id && <circle cx={px} cy={py} r={r + 1.6} fill="none" stroke="#54E4FF" strokeWidth=".5" />}
                    <text x={px} y={py + r + 3} fontSize="2.4" fill="#fff" textAnchor="middle">
                      {tp.name}
                    </text>
                    {route.includes(tp.id) && (
                      <text x={px} y={py + 0.9} fontSize="2.6" fill="#09090B" textAnchor="middle" fontWeight="700">
                        {route.indexOf(tp.id) + 1}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
          {ds.real && (
            <div className="legend mono">
              {Object.entries(LINK_LABEL).map(([k, label]) => (
                <span key={k}>
                  <i style={{ background: LINK_COLOR[k] }} />
                  {label}
                </span>
              ))}
              <span>
                <i style={{ background: "transparent", border: "2px solid var(--lav)", borderRadius: 9 }} />
                blind-spot unit
              </span>
            </div>
          )}
        </div>

        <div className="bx">
          <div className="mono" style={{ color: subjectOf(ds, x).color }}>
            {subjectOf(ds, x).name} / {x.unitName}
          </div>
          <h3 style={{ fontSize: 34 }}>{x.name}</h3>
          <div className="mono">{t("why")}</div>
          <ul className="why">
            {reasons.filter(Boolean).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {pre.length > 0 && <div className="note">Prerequisites: {pre.map((p) => ds.byId.get(p)!.name).join(", ")}</div>}
          <div className="note">
            {ds.real
              ? "Lines are the pipeline's repeat links between real questions: red word for word, orange nearly the same, dashed same topic. Evidence of past patterns, not a prediction."
              : "Demo prerequisite links and sample papers. Historical patterns are evidence, not a prediction."}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ctx.openInAtlas && (
              <button className="pill sm lime" onClick={() => ctx.openInAtlas?.(x.id)}>
                Open in Atlas ↗
              </button>
            )}
            {x.quiz.length > 0 && (
              <button className="pill sm" onClick={() => ctx.addToQuiz(x.id)}>
                {ctx.inQuiz.has(x.id) ? "In quiz ✓" : `+ ${t("mh")}`}
              </button>
            )}
            <button className="pill sm" aria-pressed={routeOn} onClick={() => setRouteOn((v) => !v)}>
              {routeOn ? "Hide route" : t("route")}
            </button>
          </div>
          {route.length > 0 && (
            <ol className="route-ol">
              {route.map((id) => {
                const r = ds.byId.get(id)!;
                return (
                  <li key={id}>
                    {r.name} <span className="note">· {countText(ds, r)}</span>
                  </li>
                );
              })}
            </ol>
          )}
          {routeOn && route.length === 0 && <div className="note">Everything here is studied.</div>}
        </div>
      </div>
      <div className="filters" style={{ paddingTop: 14 }} aria-label="Topic list">
        {chips.map((y) => (
          <button key={y.id} aria-pressed={y.id === x.id} onClick={() => onSel(y.id)}>
            {y.name}
          </button>
        ))}
      </div>
    </>
  );
}
