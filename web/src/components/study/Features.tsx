"use client";

import { useMemo, useState } from "react";

import Archive from "./Archive";
import type { StudyCtx } from "./common";
import ExamRoute from "./ExamRoute";
import Fog from "./Fog";
import type { QuizRequest } from "./Mentee";
import Pattern from "./Pattern";
import StudySpace, { type SpaceTab } from "./StudySpace";
import { fromPack } from "@/lib/dataset";
import { demoDataset } from "@/lib/demo";
import { useLocal, useStudied } from "@/lib/progress";
import type { PackEntry } from "@/lib/types";

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** The study tools from the design (sections 03-07), running on the real packs or the labelled demo dataset. */
export default function Features({ entries, onOpenTopic }: { entries: PackEntry[]; onOpenTopic: (entryKey: string, topicId: string) => void }) {
  const datasets = useMemo(() => [...entries.filter((e) => !e.pack.mock).map(fromPack), demoDataset()], [entries]);
  const [dsKey, setDsKey] = useLocal("atlas:dataset", datasets[0].key);
  const ds = datasets.find((d) => d.key === dsKey) ?? datasets[0];
  const studied = useStudied(ds.key);

  const [tab, setTab] = useState<SpaceTab>("c");
  const [constSel, setConstSel] = useState<string | null>(null);
  const [constNonce, setConstNonce] = useState(0);
  const [quizPick, setQuizPick] = useState<Set<string>>(new Set());
  const [quizStart, setQuizStart] = useState<QuizRequest | null>(null);
  const [quizNonce, setQuizNonce] = useState(0);

  const ctx: StudyCtx = {
    ds,
    datasets,
    studied,
    setDataset: (key) => {
      setDsKey(key);
      setConstSel(null);
      setQuizPick(new Set());
      setQuizStart(null);
    },
    openInAtlas: ds.real ? (topicId) => onOpenTopic(ds.key, topicId) : null,
    practice: (ids, title) => {
      setQuizStart({ ids, title: title ?? `${ds.byId.get(ids[0])?.name ?? "Topic"} quiz` });
      setQuizNonce((n) => n + 1);
      setTab("m");
      scrollTo("space");
    },
    addToQuiz: (id) => {
      const next = new Set(quizPick);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setQuizPick(next);
    },
    inQuiz: quizPick,
    viewInConstellation: (id) => {
      setConstSel(id);
      setConstNonce((n) => n + 1);
      setTab("c");
      scrollTo("space");
    },
  };

  return (
    <div key={ds.key}>
      <Pattern ctx={ctx} n="03" />
      <Fog ctx={ctx} n="04" />
      <ExamRoute ctx={ctx} n="05" />
      <Archive ctx={ctx} n="06" />
      <StudySpace
        ctx={ctx}
        n="07"
        tab={tab}
        setTab={(k) => {
          // Opening the quiz builder from the tab bar starts a fresh build, not the last practice run.
          if (k === "m" && tab !== "m") {
            setQuizStart(null);
            setQuizNonce((n) => n + 1);
          }
          setTab(k);
        }}
        constSel={constSel}
        setConstSel={setConstSel}
        constNonce={constNonce}
        quizPick={quizPick}
        setQuizPick={setQuizPick}
        quizStart={quizStart}
        quizNonce={quizNonce}
      />
    </div>
  );
}
