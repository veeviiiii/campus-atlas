"use client";

import { DataSwitch, type StudyCtx } from "./common";
import Constellation from "./Constellation";
import Mentee, { type QuizRequest } from "./Mentee";
import { dirOf, LANGS, langStatus, useLang, useT, type TKey } from "@/lib/i18n";
import { useLocal } from "@/lib/progress";

export type SpaceTab = "c" | "m" | "p" | "k" | "l";
const TABS: [SpaceTab, TKey][] = [
  ["c", "nc"],
  ["m", "nm"],
  ["p", "np"],
  ["k", "nk"],
  ["l", "nl"],
];
const REPO_URL = "https://github.com/veeviiiii/campus-atlas";

interface Props {
  ctx: StudyCtx;
  n: string;
  tab: SpaceTab;
  setTab: (t: SpaceTab) => void;
  constSel: string | null;
  setConstSel: (id: string) => void;
  constNonce: number;
  quizPick: Set<string>;
  setQuizPick: (s: Set<string>) => void;
  quizStart: QuizRequest | null;
  quizNonce: number;
}

export default function StudySpace(p: Props) {
  const t = useT();
  const [lang] = useLang();
  return (
    <section className="hub" id="space" dir={dirOf(lang)}>
      <div className="mono" style={{ color: "var(--cyan)" }}>
        {p.n} / {t("space_k")}
      </div>
      <h2>{t("space_h")}</h2>
      <DataSwitch ctx={p.ctx} />
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={p.tab === k} onClick={() => p.setTab(k)}>
            {t(label)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {p.tab === "c" && (
          <Constellation key={`${p.ctx.ds.key}-${p.constNonce}`} ctx={p.ctx} sel={p.constSel} onSel={p.setConstSel} />
        )}
        {p.tab === "m" && (
          <Mentee key={`${p.ctx.ds.key}-${p.quizNonce}`} ctx={p.ctx} pick={p.quizPick} setPick={p.setQuizPick} start={p.quizStart} />
        )}
        {p.tab === "p" && <Profile ctx={p.ctx} />}
        {p.tab === "k" && (
          <>
            <h2>{t("nk")}</h2>
            <div className="bx" style={{ maxWidth: 720 }}>
              <p style={{ margin: 0 }}>{t("pkn")}</p>
              <p className="note" style={{ margin: 0 }}>
                What works today: anyone can add their college by opening a pull request with a pack built by the pyq-atlas skill.
              </p>
              <a className="pill lime" style={{ alignSelf: "flex-start" }} href={`${REPO_URL}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">
                Contribute ↗
              </a>
            </div>
          </>
        )}
        {p.tab === "l" && <Languages />}
      </div>
    </section>
  );
}

interface ProfileData {
  n: string;
  gh: string;
  li: string;
  lc: string;
  pg: boolean;
  pl: boolean;
  pn: boolean;
}
const NO_PROFILE: ProfileData = { n: "", gh: "", li: "", lc: "", pg: true, pl: true, pn: true };
const LINKS: [keyof ProfileData, string, string][] = [
  ["gh", "github.com", "GitHub"],
  ["li", "linkedin.com", "LinkedIn"],
  ["lc", "leetcode.com", "LeetCode"],
];
const okUrl = (u: string, host: string) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && (x.hostname === host || x.hostname === `www.${host}`);
  } catch {
    return false;
  }
};

function Profile({ ctx }: { ctx: StudyCtx }) {
  const t = useT();
  const [lang] = useLang();
  const [pf, setPf] = useLocal("atlas:profile", NO_PROFILE);
  const { ds, studied } = ctx;
  const done = ds.topics.filter((x) => studied.has(x.id)).length;
  const set = (patch: Partial<ProfileData>) => setPf({ ...pf, ...patch });
  return (
    <>
      <h2>{t("ph")}</h2>
      <div className="g2">
        <div className="bx">
          <input placeholder="Display name" aria-label="Display name" value={pf.n} onChange={(e) => set({ n: e.target.value })} />
          {LINKS.map(([k, host, label]) => {
            const v = pf[k] as string;
            return (
              <input
                key={k}
                type="url"
                placeholder={`${label} URL (https)`}
                aria-label={`${label} URL`}
                value={v}
                aria-invalid={v !== "" && !okUrl(v, host)}
                onChange={(e) => set({ [k]: e.target.value.trim() })}
              />
            );
          })}
          {(
            [
              ["pg", "Show progress"],
              ["pl", "Show links"],
              ["pn", "Show preferred language"],
            ] as [keyof ProfileData, string][]
          ).map(([k, label]) => (
            <label key={k} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={pf[k] as boolean} onChange={(e) => set({ [k]: e.target.checked })} /> {label}
            </label>
          ))}
          <div className="note">Saved on this device only. Public profile URLs need a backend and are unavailable. No external stats are imported.</div>
        </div>
        <div className="bx" style={{ background: "linear-gradient(140deg,#2b2170,#13121A)", borderColor: "var(--primary)" }}>
          <div className="mono" style={{ color: "var(--lav)" }}>
            Campus Atlas
          </div>
          <h3 style={{ fontSize: 34 }}>{pf.n || "Explorer"}</h3>
          <div className="mono">{ds.context}</div>
          {pf.pg && (
            <>
              <div className="bar">
                <b style={{ width: `${(done / Math.max(1, ds.topics.length)) * 100}%`, background: "var(--accent)" }} />
              </div>
              <div className="mono">
                {done} / {ds.topics.length} topics studied
              </div>
            </>
          )}
          {pf.pn && <div className="mono">{LANGS.find((l) => l[0] === lang)?.[1] ?? "English"}</div>}
          {pf.pl &&
            LINKS.filter(([k, host]) => okUrl(pf[k] as string, host)).map(([k, , label]) => (
              <a key={k} href={pf[k] as string} target="_blank" rel="noopener noreferrer" className="mono" style={{ color: "var(--cyan)" }}>
                {label} ↗
              </a>
            ))}
        </div>
      </div>
    </>
  );
}

function Languages() {
  const t = useT();
  const [lang, setLang] = useLang();
  return (
    <>
      <h2>{t("sh")}</h2>
      <div className="bx">
        <div className="note">
          English is the source language. Hindi is a partial translation written by an AI and not yet reviewed. No trusted pack source is
          configured, so other languages cannot be downloaded yet and show English. Translation packs would contain text only, never code
          or an AI model.
        </div>
        {LANGS.map(([code, native, english]) => (
          <div key={code} className="lr">
            <span>
              <b>{native}</b> <span className="note">{english}</span>
            </span>
            <span className="mono">{langStatus(code)}</span>
            <span>
              <button aria-pressed={lang === code} onClick={() => setLang(code)}>
                {lang === code ? "In use" : "Use"}
              </button>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
