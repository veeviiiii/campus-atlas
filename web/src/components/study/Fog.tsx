"use client";

import { useMemo, useState } from "react";

import { SectionHead, type StudyCtx } from "./common";
import { clusterLayout, type Dataset } from "@/lib/dataset";
import { clearStudied, setStudied } from "@/lib/progress";

/** Flat planet: revealed topics are coloured squares, the rest sit in fog. */
export function MiniPlanet({ ds, revealed, id, label }: { ds: Dataset; revealed: Set<string>; id: string; label: string }) {
  const layout = useMemo(() => clusterLayout(ds), [ds]);
  const big = ds.topics.length > 30;
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <radialGradient id={`g-${id}`}>
          <stop offset="0" stopColor="#3a3a9a" />
          <stop offset="1" stopColor="#07071a" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#g-${id})`} stroke="#7657FF" strokeOpacity=".7" />
      {ds.topics.map((t) => {
        const [px, py] = layout.get(t.id)!;
        const x = 50 + (px - 50) * 0.8;
        const y = 50 + (py - 50) * 0.8;
        const s = big ? 2.2 : 3.6;
        return revealed.has(t.id) ? (
          <g key={t.id}>
            <title>{t.name}</title>
            <rect x={x - s / 2} y={y - s / 2} width={s} height={s} fill={ds.subjects[t.subjectIndex].color} />
            {!big && (
              <text x={x} y={y + 5} fontSize="2.5" fill="#fff" textAnchor="middle">
                {t.name}
              </text>
            )}
          </g>
        ) : (
          <g key={t.id}>
            <title>{`${t.name} (fogged)`}</title>
            <circle cx={x} cy={y} r={big ? 3.4 : 7} fill="rgba(196,181,253,.3)" />
            <rect x={x - s * 0.4} y={y - s * 0.4} width={s * 0.8} height={s * 0.8} fill="#8d89b0" />
          </g>
        );
      })}
    </svg>
  );
}

export default function Fog({ ctx, n }: { ctx: StudyCtx; n: string }) {
  const { ds, studied } = ctx;
  const total = ds.topics.length;
  const done = ds.topics.filter((t) => studied.has(t.id)).length;
  const [preview, setPreview] = useState<number | null>(Math.min(5, total));
  const [sub, setSub] = useState(ds.subjects[0]?.id ?? "");

  // Slider previews topics in priority order; "Use my progress" shows what you have actually studied.
  const shownSet = useMemo(() => (preview === null ? studied : new Set(ds.rank.slice(0, preview))), [preview, studied, ds]);
  const shownCount = preview === null ? done : preview;
  const none = useMemo(() => new Set<string>(), []);

  return (
    <section className="sec lv" id="fogs">
      <SectionHead n={n} kicker="fog_k" title="fog_h" ctx={ctx} cyan={false} />
      <div className="g2" style={{ alignItems: "center" }}>
        <div className="pp">
          <div>
            <MiniPlanet ds={ds} revealed={none} id="fog-a" label="Unexplored planet, fully fogged" />
            <div className="mono" style={{ textAlign: "center" }}>
              Unexplored
            </div>
          </div>
          <div>
            <MiniPlanet ds={ds} revealed={shownSet} id="fog-b" label={`Planet with ${shownCount} of ${total} topics revealed`} />
            <div className="mono" style={{ textAlign: "center" }}>
              {preview === null ? `Your progress: ${done} / ${total} studied` : `Preview: ${preview} / ${total} revealed`}
            </div>
          </div>
        </div>
        <div>
          <p style={{ fontSize: 18, maxWidth: "44ch", marginTop: 0 }}>
            Each topic starts hidden in fog. Mark it as studied, or pass its quiz, and the region lights up here and on the planet. Drag
            the slider to preview how your planet fills in, or jump to your real progress.
          </p>
          <input
            type="range"
            min={0}
            max={total}
            value={shownCount}
            onChange={(e) => setPreview(+e.target.value)}
            aria-label="Topics revealed"
            style={{ width: "100%", accentColor: "#7657FF" }}
          />
          <button className="pill" style={{ background: "#1b1420", color: "#fff", marginTop: 12 }} onClick={() => setPreview(null)}>
            Use my progress
          </button>
        </div>
      </div>

      <div className="g2" style={{ marginTop: 28 }}>
        <div className="bx">
          <div className="mono">
            {done} / {total} studied
          </div>
          <div className="bar">
            <b style={{ width: `${(done / Math.max(1, total)) * 100}%`, background: "var(--accent)" }} />
          </div>
          {ds.subjects.map((s) => {
            const g = ds.topics.filter((t) => t.subjectId === s.id);
            const d = g.filter((t) => studied.has(t.id)).length;
            return (
              <div key={s.id}>
                <div className="mono" style={{ color: s.color }}>
                  {s.name} · {d}/{g.length}
                </div>
                <div className="bar">
                  <b style={{ width: `${(d / Math.max(1, g.length)) * 100}%`, background: s.color }} />
                </div>
              </div>
            );
          })}
          <div className="note">Progress is saved on this device for this dataset, and shared with the planet above.</div>
          {done > 0 && (
            <button
              className="pill sm"
              onClick={() => {
                if (confirm("Reset studied topics for this dataset?")) clearStudied(ds.key);
              }}
            >
              Reset progress
            </button>
          )}
        </div>
        <div>
          <div className="filters" style={{ paddingTop: 0 }} role="group" aria-label="Subject">
            {ds.subjects.map((s) => (
              <button key={s.id} aria-pressed={sub === s.id} onClick={() => setSub(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
          <div className="tg">
            {ds.topics
              .filter((t) => t.subjectId === sub)
              .map((t) => {
                const on = studied.has(t.id);
                return (
                  <div key={t.id} className="bx" style={{ padding: 14, borderRadius: 20 }}>
                    <b>{t.name}</b>
                    <div className="mono" style={{ color: on ? "var(--accent)" : "var(--muted)" }}>
                      {on ? "Revealed ✓" : "Fogged"}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {t.quiz.length > 0 && (
                        <button className={`pill sm ${on ? "" : "lime"}`} onClick={() => ctx.practice([t.id])}>
                          {on ? "Retake" : "Take quiz"}
                        </button>
                      )}
                      <button className="pill sm" onClick={() => setStudied(ds.key, t.id, !on)}>
                        {on ? "Undo" : "Mark studied"}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </section>
  );
}
