"use client";

import { type FormEvent, useState } from "react";

import type { Bar, Report } from "@/lib/analytics-report";
import { type Sealed, unseal } from "@/lib/unseal";

export type AdminState =
  | { kind: "no-password" }
  | { kind: "weak-password"; min: number }
  | { kind: "no-data" }
  | { kind: "locked"; sealed: Sealed };

const num = (n: number) => n.toLocaleString("en-IN");
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** /admin/: locked until the maintainer's password opens the report the build sealed into the page. */
export default function AdminView({ state }: { state: AdminState }) {
  const [report, setReport] = useState<Report | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  if (state.kind !== "locked") return <NotReady state={state} />;
  if (report) return <Dashboard report={report} />;

  async function open(e: FormEvent) {
    e.preventDefault();
    if (state.kind !== "locked" || !password) return;
    setBusy(true);
    setWrong(false);
    const text = await unseal(state.sealed, password);
    setBusy(false);
    if (text) setReport(JSON.parse(text) as Report);
    else setWrong(true);
  }

  return (
    <form className="admin-lock" onSubmit={open}>
      <h1 className="page-title">Admin</h1>
      <p className="lead">Site analytics for the maintainer. The numbers in this page are locked; your password opens them.</p>
      <label>
        <span className="mono">Admin password</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </label>
      <button className="pill lime" type="submit" disabled={busy || !password}>
        {busy ? "Opening…" : "Open"}
      </button>
      {wrong && <p className="admin-wrong">That password does not open this page.</p>}
    </form>
  );
}

function NotReady({ state }: { state: Exclude<AdminState, { kind: "locked" }> }) {
  return (
    <section className="admin-lock">
      <h1 className="page-title">Admin</h1>
      <p className="lead">
        {state.kind === "no-password" && "Not set up yet: this build has no admin password."}
        {state.kind === "weak-password" && `The admin password is shorter than ${state.min} characters, so the page stays shut.`}
        {state.kind === "no-data" && "This build has no analytics: it was made without the analytics token."}
      </p>
      <p className="note">How to set it up is in README.md, under “Site analytics”.</p>
    </section>
  );
}

function Dashboard({ report: r }: { report: Report }) {
  const updated = new Date(r.fetchedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="admin-dash">
      <header className="admin-head">
        <h1 className="page-title">Site analytics</h1>
        <p className="mono">
          Last 30 days · {shortDate(r.since)} – {shortDate(r.until)} · updated {updated}
        </p>
      </header>
      {r.error && <p className="admin-wrong">Vercel did not answer when this build asked: {r.error}</p>}

      <div className="admin-tiles">
        <Tile label="Visits" value={r.totals.visits} />
        <Tile label="Page views" value={r.totals.views} />
        <Tile label="Subject pages opened" value={r.totals.subjectViews} />
        <Tile label="Searches" value={r.totals.searchViews} />
      </div>
      <p className="note">
        From Vercel Web Analytics (no cookies). Vercel recognises a visitor for 24 hours, so a visit is one person on one day: someone who
        comes back on three days counts three times. The site is rebuilt every day, so these numbers are at most a day old.
      </p>

      <Daily days={r.daily} />

      <div className="admin-grid">
        <Ranked title="Courses" bars={r.courses} empty="No course page opened yet." />
        <Ranked title="Semesters" bars={r.semesters} empty="No semester page opened yet." />
        <Ranked title="Subjects" bars={r.subjects} empty="No subject page opened yet." />
      </div>
      <div className="admin-grid small">
        <Ranked title="Pages" bars={r.pages} empty="No page views yet." />
        <Ranked title="Countries" bars={r.countries} empty="None yet." />
        <Ranked title="Devices" bars={r.devices} empty="None yet." />
        <Ranked title="Came from" bars={r.referrers} empty="None yet." />
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-tile">
      <span className="mono">{label}</span>
      <strong>{num(value)}</strong>
    </div>
  );
}

/** A round top for the axis: 1, 2, 5 or 10 times a power of ten, at least the largest value. */
function niceMax(n: number): number {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].map((m) => m * p).find((v) => v >= n) ?? 10 * p);
}

/** Visits per day: one column a day, a tooltip on hover or focus, and the same numbers as a table. */
function Daily({ days }: { days: Report["daily"] }) {
  const [on, setOn] = useState<number | null>(null);
  if (!days.length) return null;
  const max = niceMax(Math.max(...days.map((d) => d.visits)));
  const tip = on === null ? null : days[on];
  const mid = Math.floor(days.length / 2);
  return (
    <section className="admin-card">
      <h2>Visits per day</h2>
      <div className="daily" onMouseLeave={() => setOn(null)}>
        <div className="daily-grid" aria-hidden="true">
          <span style={{ bottom: "100%" }}>{num(max)}</span>
          <span style={{ bottom: "50%" }}>{num(max / 2)}</span>
          <span style={{ bottom: "0%" }}>0</span>
        </div>
        <div className="daily-cols">
          {days.map((d, i) => (
            <button
              type="button"
              key={d.date}
              className={on === i ? "on" : undefined}
              onMouseEnter={() => setOn(i)}
              onFocus={() => setOn(i)}
              onBlur={() => setOn(null)}
              aria-label={`${shortDate(d.date)}: ${num(d.visits)} visits, ${num(d.views)} page views`}
            >
              <i style={{ height: `${(d.visits / max) * 100}%` }} />
            </button>
          ))}
        </div>
        {tip && on !== null && (
          <div className="daily-tip" style={{ left: `${((on + 0.5) / days.length) * 100}%` }} role="status">
            <b>{shortDate(tip.date)}</b>
            <span>
              {num(tip.visits)} visits · {num(tip.views)} page views
            </span>
          </div>
        )}
      </div>
      <div className="daily-x mono" aria-hidden="true">
        <span>{shortDate(days[0].date)}</span>
        <span>{shortDate(days[mid].date)}</span>
        <span>{shortDate(days[days.length - 1].date)}</span>
      </div>
      <details className="admin-table">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Visits</th>
              <th>Page views</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td>{shortDate(d.date)}</td>
                <td>{num(d.visits)}</td>
                <td>{num(d.views)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

/** A ranked list: name, its page views, and a bar as long as its share of the top one. */
function Ranked({ title, bars, empty }: { title: string; bars: Bar[]; empty: string }) {
  const max = Math.max(1, ...bars.map((b) => b.views));
  return (
    <section className="admin-card">
      <h2>{title}</h2>
      {bars.length === 0 ? (
        <p className="note">{empty}</p>
      ) : (
        <ol className="ranked-bars">
          {bars.map((b) => (
            <li key={`${b.name}|${b.detail ?? ""}`}>
              <span className="rb-name">
                {b.name}
                {b.detail && <small>{b.detail}</small>}
              </span>
              <span className="rb-value">{num(b.views)}</span>
              <i style={{ width: `${(b.views / max) * 100}%` }} aria-hidden="true" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
