"use client";

import { useMemo } from "react";

import { SectionHead, subjectOf, type StudyCtx } from "./common";
import { buildRoute, clusterLayout, countText, prerequisites } from "@/lib/dataset";
import { useLocal } from "@/lib/progress";

interface Plan {
  u: string; // hours until the exam
  h: string; // hours you can study
  m: string; // minutes per topic (assumed)
  sub: string;
  list: string[];
  fin: string[];
  skip: string[];
}
const EMPTY: Plan = { u: "12", h: "3", m: "30", sub: "ALL", list: [], fin: [], skip: [] };
const clamp = (v: string, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.round(+v) || d));

/** "Exam tomorrow" with a time budget: an ordered route through the most important unstudied topics. */
export default function ExamRoute({ ctx, n }: { ctx: StudyCtx; n: string }) {
  const { ds, studied } = ctx;
  const [plan, setPlan] = useLocal<Plan>(`atlas:plan:${ds.key}`, EMPTY);
  const layout = useMemo(() => clusterLayout(ds), [ds]);
  const L = plan.list.filter((id) => ds.byId.has(id));
  const fin = L.filter((id) => plan.fin.includes(id)).length;
  const minutes = clamp(plan.m, 10, 90, 30);
  const rem = buildRoute(ds, studied, plan.skip, plan.sub).filter((id) => !L.includes(id)).length;
  const set = (p: Partial<Plan>) => setPlan({ ...plan, ...p });

  function build() {
    const u = clamp(plan.u, 1, 72, 12);
    const h = clamp(plan.h, 1, 12, 3);
    const m = clamp(plan.m, 10, 90, 30);
    const stops = Math.max(1, Math.floor((Math.min(h, u) * 60) / m));
    setPlan({ ...plan, u: String(u), h: String(h), m: String(m), skip: [], fin: [], list: buildRoute(ds, studied, [], plan.sub).slice(0, stops) });
  }
  function move(k: number, d: number) {
    const j = k + d;
    if (j < 0 || j >= L.length) return;
    const list = [...L];
    [list[k], list[j]] = [list[j], list[k]];
    set({ list });
  }
  function skip(id: string) {
    const skipped = [...plan.skip, id];
    const list = L.filter((x) => x !== id);
    const next = buildRoute(ds, studied, skipped, plan.sub).find((x) => !list.includes(x));
    set({ skip: skipped, list: next ? [...list, next] : list });
  }

  return (
    <section className="sec md" id="exam">
      <SectionHead n={n} kicker="exam_k" title="exam_h" ctx={ctx} />
      <div className="g2">
        <div className="bx">
          <label>
            Hours until the exam
            <input type="number" min={1} max={72} value={plan.u} onChange={(e) => set({ u: e.target.value })} />
          </label>
          <label>
            Hours you can study
            <input type="number" min={1} max={12} value={plan.h} onChange={(e) => set({ h: e.target.value })} />
          </label>
          <label>
            Minutes per topic (assumed, adjustable)
            <input type="number" min={10} max={90} value={plan.m} onChange={(e) => set({ m: e.target.value })} />
          </label>
          <label>
            Subject focus
            <select value={plan.sub} onChange={(e) => set({ sub: e.target.value })}>
              <option value="ALL">All subjects</option>
              {ds.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button className="pill lime" onClick={build}>
            Build my study route ↗
          </button>
          <div className="note">Study time is capped by the time left. {ds.priorityNote} Not a prediction of the real paper.</div>
        </div>
        <div>
          <svg viewBox="0 0 100 100" className="cs" role="img" aria-label={`Study route map, ${L.length} stops`}>
            {ds.topics.map((t) => {
              const [x, y] = layout.get(t.id)!;
              return <circle key={t.id} cx={x} cy={y} r={ds.topics.length > 30 ? 1 : 1.6} fill={subjectOf(ds, t).color} opacity=".4" />;
            })}
            {L.length > 1 && (
              <polyline
                key={L.join()}
                className="dr"
                pathLength={1}
                fill="none"
                stroke="#D7FF52"
                strokeWidth=".7"
                points={L.map((id) => layout.get(id)!.join(",")).join(" ")}
              />
            )}
            {L.map((id, k) => {
              const [x, y] = layout.get(id)!;
              return (
                <g key={id}>
                  <title>{ds.byId.get(id)!.name}</title>
                  <circle cx={x} cy={y} r="3" fill={plan.fin.includes(id) ? "#54E4FF" : "#D7FF52"} />
                  <text x={x} y={y + 1} fontSize="3" textAnchor="middle" fill="#09090B" fontWeight="700">
                    {k + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {L.length ? (
        <>
          <div className="mono" style={{ margin: "16px 0 8px" }}>
            {L.length} stops · {L.length * minutes} min · {fin} done · {rem} topics remaining outside this route
          </div>
          <div className="bar">
            <b style={{ width: `${(fin / L.length) * 100}%`, background: "var(--accent)" }} />
          </div>
          <ol className="rl" style={{ marginTop: 12 }}>
            {L.map((id, k) => {
              const t = ds.byId.get(id)!;
              const pre = prerequisites(ds, id);
              return (
                <li key={id} className={plan.fin.includes(id) ? "fin" : ""}>
                  <b className="mono">{String(k + 1).padStart(2, "0")}</b>
                  <div>
                    <b>{t.name}</b>
                    <div className="note">
                      {subjectOf(ds, t).name} · {countText(ds, t)}
                      {t.marks != null ? ` · ${t.marks} marks` : ""}
                      {t.blindSpot ? " · blind-spot unit" : ""}
                      {pre.length ? ` · after ${pre.map((p) => ds.byId.get(p)!.name).join(", ")}` : ""} · {minutes} min
                    </div>
                  </div>
                  <span>
                    <button onClick={() => move(k, -1)} aria-label={`Move ${t.name} up`}>
                      ↑
                    </button>
                    <button onClick={() => move(k, 1)} aria-label={`Move ${t.name} down`}>
                      ↓
                    </button>
                    <button onClick={() => set({ fin: plan.fin.includes(id) ? plan.fin.filter((x) => x !== id) : [...plan.fin, id] })}>
                      Done
                    </button>
                    <button onClick={() => skip(id)}>Skip</button>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="note">
          No route yet. Set your time and build one. If you built one and nothing shows, every topic in this selection is studied or
          skipped.
        </p>
      )}
    </section>
  );
}
