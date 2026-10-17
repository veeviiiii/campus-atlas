"use client";

import { useT, type TKey } from "@/lib/i18n";
import type { Dataset, DTopic } from "@/lib/dataset";

/** Everything a study section needs: the chosen dataset, progress, and links to the other tools. */
export interface StudyCtx {
  ds: Dataset;
  datasets: Dataset[];
  setDataset: (key: string) => void;
  studied: Set<string>;
  /** Opens the topic on the 3D planet (real packs only). */
  openInAtlas: ((topicId: string) => void) | null;
  practice: (topicIds: string[], title?: string) => void;
  addToQuiz: (topicId: string) => void;
  inQuiz: Set<string>;
  viewInConstellation: (topicId: string) => void;
}

export function SectionHead({ n, kicker, title, ctx, cyan = true }: { n: string; kicker: TKey; title: TKey; ctx: StudyCtx; cyan?: boolean }) {
  const t = useT();
  return (
    <>
      <div className="ch" aria-hidden="true">
        {n}
      </div>
      <div className="mono" style={cyan ? { color: "var(--cyan)" } : undefined}>
        {n} / {t(kicker)}
      </div>
      <h2>{t(title)}</h2>
      <DataSwitch ctx={ctx} />
    </>
  );
}

export function DataSwitch({ ctx }: { ctx: StudyCtx }) {
  const t = useT();
  return (
    <div className="ds">
      <div role="group" aria-label="Dataset" className="ds-row">
        <span className="mono">{t("data")}:</span>
        {ctx.datasets.map((d) => (
          <button key={d.key} aria-pressed={d.key === ctx.ds.key} onClick={() => ctx.setDataset(d.key)} title={d.context}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="mono ds-ctx">{ctx.ds.context}</div>
    </div>
  );
}

export function TopicBadges({ topic }: { topic: DTopic }) {
  if (!topic.isRepeat && !topic.blindSpot) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {topic.isRepeat && <span className="badge repeat">Repeat · MST → End Sem</span>}
      {topic.blindSpot && <span className="badge blind">Blind spot unit · never in the MSTs</span>}
    </div>
  );
}

export const subjectOf = (ds: Dataset, t: DTopic) => ds.subjects[t.subjectIndex];

/** The bar metric: marks for real packs (more spread than 1-3 exams), paper count for the demo. */
export function metric(ds: Dataset, t: DTopic): number {
  return ds.real ? (t.marks ?? 0) : t.count;
}

export function metricMax(ds: Dataset): number {
  return ds.real ? Math.max(1, ...ds.topics.map((t) => t.marks ?? 0)) : ds.countOf;
}

export function metricText(ds: Dataset, t: DTopic): string {
  return ds.real ? `${t.marks ?? 0} marks` : `${t.count}/${ds.countOf}`;
}
