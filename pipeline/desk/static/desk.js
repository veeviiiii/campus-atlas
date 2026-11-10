"use strict";
// The intake desk page. It holds the decisions (S.state) and sends all of them to the server after
// every change; the server writes desk-decisions.json, the PDFs and the manifests.
// Geometry mirrors pipeline/desk/geometry.py: black-out boxes are fractions of the SOURCE page
// (before any turn), turns are clockwise, a split cuts the upright page.

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const MIXED = "\u0000mixed";
const INHERITED = ["status", "reason", "course", "semester", "subject", "kind", "session"];
const PAPER_FIELDS = ["course", "semester", "subject", "kind", "session"];

const S = {
  info: null, // GET /api/folder
  state: null, // the decisions (the server keeps its own record of what it wrote)
  pieces: [], // every part in desk order, `continues` resolved
  byId: {},
  manifests: {}, // "course/sem" -> GET /api/manifest
  sel: [], // selected piece ids "<source>#<page>:<part>"
  anchor: null,
  box: null, // selected black-out box on the open page
  drag: null,
  images: {}, // page key -> Image for the editor (a few, newest last)
  problems: {}, // piece id -> message, from the last plan
  newSubject: false,
  sugs: {}, // page key -> what the model read and the picture matches suggest (GET /api/read); never a decision
  read: null, // the reading job: running, done, total, failed, reading, stopped
  readTimer: null,
  cards: {},
  saveTimer: null,
  dirty: false,
  run: null, // { next, text, last }: the pipeline run started from this page, last = the latest GET /api/run
  written: [], // the manifests the desk wrote for this folder
  writtenFresh: false, // nothing changed since they were written
  keysOpen: false,
  browseFrom: "",
  toastTimer: null,
  ping: null,
  uploading: false,
  filter: "all", // which pages the grid shows: all, or those with a part to do / held back / use / skip
  shown: new Set(), // the page keys the grid shows now
};
const FILTERS = [["all", "All"], ["todo", "To do"], ["held", "Held back"], ["use", "Use"], ["skip", "Skip"]];

async function api(method, path, body) {
  const opts = { method };
  if (method !== "GET") {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ------------------------------------------------------------------ geometry (as geometry.py)

function turnPoint(x, y, deg) {
  if (deg === 90) return [1 - y, x];
  if (deg === 180) return [1 - x, 1 - y];
  if (deg === 270) return [y, 1 - x];
  return [x, y];
}
function turnBox(b, deg) {
  const [ax, ay] = turnPoint(b[0], b[1], deg), [bx, by] = turnPoint(b[2], b[3], deg);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}
const toUpright = (b, rot) => turnBox(b, rot % 360);
const toSource = (b, rot) => turnBox(b, (360 - rot) % 360);
function partRegion(split, at, part) {
  if (split === "h") return part === 0 ? [0, 0, 1, at] : [0, at, 1, 1];
  if (split === "v") return part === 0 ? [0, 0, at, 1] : [at, 0, 1, 1];
  return [0, 0, 1, 1];
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ------------------------------------------------------------------ the decisions

const blankPart = () => ({ status: "todo", reason: "", note: "", continues: false, course: "", semester: null, subject: "", kind: "", session: "", rotation: 0 });
const splitKey = (key) => [key.slice(0, key.lastIndexOf("#")), Number(key.slice(key.lastIndexOf("#") + 1))];
const pieceKey = (id) => id.slice(0, id.lastIndexOf(":"));

function pageKeys() {
  const keys = [];
  for (const s of S.info.sources) for (let n = 1; n <= s.pages; n++) keys.push(`${s.id}#${n}`);
  return keys;
}
function pageOf(key) {
  return S.state.pages[key] || { rotation: 0, split: "", at: 0.5, boxes: [], parts: [blankPart()] };
}
function editPage(key) {
  if (!S.state.pages[key]) S.state.pages[key] = pageOf(key);
  return S.state.pages[key];
}

/** Every part in order; a continuing part takes status, course, subject and exam from the last used or held part (as decisions.pieces). */
function resolve() {
  const out = [];
  let last = null;
  for (const key of pageKeys()) {
    const pg = pageOf(key);
    pg.parts.forEach((raw, i) => {
      let d = raw, follows = null;
      if (raw.continues && last) {
        d = { ...raw };
        for (const k of INHERITED) d[k] = last.d[k];
        follows = last;
      }
      const p = { id: `${key}:${i}`, key, part: i, raw, d, follows, split: pg.split, halves: pg.parts.length };
      out.push(p);
      if (d.status === "use" || d.status === "held") last = p;
    });
  }
  S.pieces = out;
  S.byId = Object.fromEntries(out.map((p) => [p.id, p]));
}

function label(p) {
  const [src, n] = splitKey(p.key);
  const side = { h: ["top half", "bottom half"], v: ["left half", "right half"] }[p.split];
  return `${src} · page ${n}` + (p.halves === 2 ? ` · ${side[p.part]}` : "");
}

const course = (id) => S.info.courses.find((c) => c.id === id);
const kindName = (k) => (S.info.kinds.find((x) => x.id === k) || {}).name || "";
const manifestOf = (c, sem) => (c && sem ? S.manifests[`${c}/${sem}`] : null);
const deskSubjects = (c, sem) => S.state.subjects[`${c}/${sem}`] || [];

function subjectsFor(c, sem) {
  const m = manifestOf(c, sem);
  return [...((m && m.subjects) || []).map((s) => ({ ...s, here: false })), ...deskSubjects(c, sem).map((s) => ({ ...s, here: true }))];
}
function subjectName(c, sem, id) {
  const s = subjectsFor(c, sem).find((x) => x.id === id);
  return s ? s.name : id;
}
function examInManifest(c, sem, session, kind) {
  const m = manifestOf(c, sem);
  return m && m.exams.find((e) => e.session === session && e.id.split("-")[0] === kind);
}
const examKey = (d) => `${d.course}/${d.semester}/${d.session}/${d.kind}`;

function ensureManifest(c, sem) {
  const k = `${c}/${sem}`;
  if (!c || !sem || S.manifests[k]) return;
  S.manifests[k] = { subjects: [], exams: [], papers: [], loading: true };
  api("GET", `/api/manifest?course=${encodeURIComponent(c)}&sem=${sem}`)
    .then((m) => { S.manifests[k] = m; refresh(); })
    .catch((e) => { S.manifests[k] = { subjects: [], exams: [], papers: [], error: e.message }; refresh(); });
}

// ------------------------------------------------------------------ saving

function changed() {
  S.dirty = true;
  S.writtenFresh = false;
  $("#saved").textContent = "Saving…";
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(save, 400);
  refresh();
}

async function save() {
  clearTimeout(S.saveTimer);
  if (!S.dirty) return;
  S.dirty = false;
  try {
    const r = await api("PUT", "/api/state", S.state);
    $("#saved").textContent = `Saved ${r.saved}`;
    $("#saved").className = "mono";
    if (Object.keys(S.sugs).length && !S.readTimer) fetchRead(); // a decided page can change what the next page is suggested
  } catch (e) {
    S.dirty = true;
    $("#saved").textContent = `Not saved: ${e.message}`;
    $("#saved").className = "mono error";
  }
}

window.addEventListener("beforeunload", (e) => {
  if (!S.dirty) return;
  fetch("/api/state", { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(S.state) });
  e.preventDefault();
});

// ------------------------------------------------------------------ the grid

function thumbURL(key, i, w) {
  const pg = pageOf(key), [src, n] = splitKey(key);
  const q = new URLSearchParams({
    src, page: n, rot: pg.rotation, split: pg.split, at: pg.at.toFixed(4), part: i, prot: pg.parts[i].rotation,
    boxes: pg.boxes.map((b) => b.map((x) => x.toFixed(4)).join(",")).join(";"), w,
  });
  return `/api/thumb?${q}`;
}

function chip(p) {
  const d = p.d;
  if (d.status === "todo") return "to do";
  if (d.status === "skip") return "skip" + (d.reason ? `: ${d.reason}` : "");
  const where = [d.semester ? `S${d.semester}` : "", kindName(d.kind), d.session ? d.session.slice(2) : "", d.subject ? subjectName(d.course, d.semester, d.subject) : ""].filter(Boolean).join(" · ");
  if (d.status === "held") return `held: ${d.reason || "?"}` + (where ? ` · ${where}` : "");
  return (p.raw.continues ? "↳ " : "") + (where || "use");
}

/** The suggestion for a part, while its page is undecided: { s, text } or null. */
function suggested(p) {
  const sug = S.sugs[p.key];
  if (!sug || !undecided(p.key)) return null;
  if (S.read && S.read.reading.includes(p.key)) return { s: null, text: "reading…" };
  if (sug.parts.length !== pageOf(p.key).parts.length) return { s: sug.parts[p.part] || null, text: `${sug.parts.length} papers on this page` };
  const s = sug.parts[p.part];
  if (!s || (s.status === "todo" && sug.error)) return { s: null, text: "could not read it" };
  if (s.status === "todo") return null;
  return { s, text: s.continues ? "↳ continues the page before" : chip({ d: s, raw: { continues: false } }) };
}
const undecided = (key) => pageOf(key).parts.every((x) => x.status === "todo");

function tileHTML(key, i) {
  const p = S.byId[`${key}:${i}`];
  const bad = S.problems[p.id];
  const sug = p.d.status === "todo" && !bad ? suggested(p) : null;
  const reading = !!S.read && S.read.reading.includes(key);
  const cls = ["tile", p.d.status, S.sel.includes(p.id) ? "sel" : "", bad ? "bad" : "", sug ? "sug" : "", reading ? "reading" : ""].join(" ");
  const text = reading ? "✦ reading…" : bad ? "⚠ " + chip(p) : sug ? "✦ " + sug.text : chip(p);
  return `<button type="button" class="${cls}" data-id="${esc(p.id)}" title="${esc(bad || label(p))}"><img loading="lazy" alt="" src="${thumbURL(key, i, 240)}"><span class="chip">${esc(text)}</span></button>`;
}

function cardHTML(key) {
  const pg = pageOf(key), [, n] = splitKey(key);
  const marks = [pg.rotation ? `${pg.rotation}°` : "", pg.boxes.length ? `${pg.boxes.length} black-out` : ""].filter(Boolean).join(" · ");
  const cut = `<button type="button" class="cut" data-cut="${esc(key)}" title="${pg.split ? "Make it one paper again" : "Two question papers on this page: split it"}">${pg.split ? "1 paper" : "✂ 2 papers"}</button>`;
  return `<div class="page" data-key="${esc(key)}"><div class="label"><span>p${n}${marks ? ` · ${marks}` : ""}</span>${cut}</div><div class="parts ${pg.split}">${pg.parts.map((_, i) => tileHTML(key, i)).join("")}</div></div>`;
}

const matches = (key) => S.filter === "all" || S.pieces.some((p) => p.key === key && p.d.status === S.filter);

function renderGrid() {
  S.cards = {};
  S.shown = new Set();
  resolve();
  const files = S.info.sources.map((s) => {
    const cards = [];
    for (let n = 1; n <= s.pages; n++) {
      const key = `${s.id}#${n}`;
      if (!matches(key)) continue;
      S.shown.add(key);
      S.cards[key] = cardHTML(key);
      cards.push(S.cards[key]);
    }
    if (!cards.length) return "";
    const of = S.filter === "all" ? `${s.pages} page${s.pages > 1 ? "s" : ""}` : `${cards.length} of ${s.pages} pages`;
    return `<div class="source"><h3>${esc(s.id)} <span class="muted small">${of}</span><button type="button" class="small" data-select-source="${esc(s.id)}">Select ${S.filter === "all" ? "all" : "these"}</button><span data-accept-slot="${esc(s.id)}"></span></h3><div class="pages">${cards.join("")}</div></div>`;
  }).join("");
  const empty = { todo: "Nothing left to do.", held: "No paper is held back.", use: "No page is marked Use yet.", skip: "No page is skipped." }[S.filter];
  const intro = S.filter === "held" && files ? `<p class="muted small held-intro">Real papers kept out because something is not printed on them. Click one, fill in what is missing (year, exam or subject) and it becomes <b>Use</b>. Shift-click several to fill a field for all of them.</p>` : "";
  $("#grid").innerHTML = `<div id="counts" class="filters"></div>${intro}` + (files || `<p class="muted pad">${empty || "No pages."}</p>`)
    + (S.info.broken.length ? `<p class="error">Could not open: ${S.info.broken.map(esc).join(", ")}</p>` : "");
}

function setFilter(f) {
  S.filter = f;
  renderGrid();
  refresh();
  $("#grid").scrollTop = 0;
}

/** Recompute and redraw what changed: only the cards whose HTML differs, the progress, the editor. */
function refresh(editor = true) {
  resolve();
  for (const key of pageKeys()) {
    const html = cardHTML(key);
    if (S.cards[key] !== html) {
      S.cards[key] = html;
      const el = document.querySelector(`.page[data-key="${CSS.escape(key)}"]`);
      if (el) el.outerHTML = html;
    }
  }
  const count = (st) => S.pieces.filter((p) => p.d.status === st).length;
  const todo = count("todo");
  const waiting = waitingPages().length;
  const counts = $("#counts");
  if (counts) counts.innerHTML = FILTERS.map(([f, name]) => `<button type="button" class="small ${S.filter === f ? "on" : ""}" data-filter="${f}" aria-pressed="${S.filter === f}">${name} <span>${f === "all" ? S.pieces.length : count(f)}</span></button>`).join("")
    + (waiting ? `<span class="muted small">${waiting} page${waiting > 1 ? "s" : ""} suggested, waiting for you</span>` : "")
    + ((fill) => (fill ? `<button type="button" class="small primary" data-fill-held title="Held-back papers whose suggestion knows some of what was missing (the year from the file name, say)">Fill ${fill} held back</button>` : ""))(fillablePages().reduce((a, k) => a + fillable(k).length, 0));
  for (const slot of document.querySelectorAll("[data-accept-slot]")) {
    const n = sourceWaiting(slot.dataset.acceptSlot).length;
    const html = n ? `<button type="button" class="small primary" data-accept-source="${esc(slot.dataset.acceptSlot)}" title="Take the suggestion of every page of this file not decided yet">Accept all ${n}</button>` : "";
    if (slot.innerHTML !== html) slot.innerHTML = html;
  }
  updateSteps();
  if (editor) typing() ? updateDerived() : renderEditor();
}

/** True while the maintainer types in a text field of the editor: rebuilding it then would lose the focus and clicks. */
function typing() {
  const a = document.activeElement;
  return !!a && $("#editor").contains(a) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type === "text"));
}

function select(ids, anchor) {
  if (typing()) document.activeElement.blur();
  S.sel = ids.filter((id) => S.byId[id]);
  if (anchor !== undefined) S.anchor = anchor;
  S.box = null;
  S.newSubject = false;
  refresh();
  const first = S.sel[0] && document.querySelector(`.tile[data-id="${CSS.escape(S.sel[0])}"]`);
  if (first) first.scrollIntoView({ block: "nearest" });
}

$("#grid").addEventListener("click", async (e) => {
  const f = e.target.closest("[data-filter]");
  if (f) return setFilter(f.dataset.filter);
  if (e.target.closest("[data-fill-held]")) return fillAllHeld();
  const cut = e.target.closest("[data-cut]");
  if (cut) {
    const key = cut.dataset.cut, pg = pageOf(key);
    if (pg.split && pg.parts[1].status !== "todo" && !(await ask("Make it one paper again?", "What you set for the second half of this page is dropped.", "One paper"))) return;
    setSplit(key, pg.split ? "" : "h");
    return select([`${key}:0`], `${key}:0`);
  }
  const acc = e.target.closest("[data-accept-source]");
  if (acc) return acceptSource(acc.dataset.acceptSource);
  const src = e.target.closest("[data-select-source]");
  if (src) return select(S.pieces.filter((p) => splitKey(p.key)[0] === src.dataset.selectSource && S.shown.has(p.key)).map((p) => p.id), null);
  const tile = e.target.closest(".tile");
  if (!tile) return;
  const id = tile.dataset.id;
  if (e.shiftKey && S.anchor) {
    const ids = S.pieces.map((p) => p.id), a = ids.indexOf(S.anchor), b = ids.indexOf(id);
    return select(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
  }
  if (e.ctrlKey || e.metaKey) return select(S.sel.includes(id) ? S.sel.filter((x) => x !== id) : [...S.sel, id], id);
  select([id], id);
});

function step(delta) {
  const ids = S.pieces.filter((p) => S.shown.has(p.key)).map((p) => p.id);
  const at = S.sel.length ? ids.indexOf(S.sel[S.sel.length - 1]) : -1;
  const next = ids[clamp(at + delta, 0, ids.length - 1)];
  if (next) select([next], next);
}

// ------------------------------------------------------------------ the editor

const selected = () => S.sel.map((id) => S.byId[id]).filter(Boolean);
const common = (vals) => (vals.every((v) => v === vals[0]) ? vals[0] : MIXED);

function renderEditor() {
  const ed = $("#editor");
  const ps = selected();
  if (!ps.length) {
    ed.innerHTML = `<div class="editor"><p class="muted">Click a page. <b>Shift</b>-click selects a range and <b>Ctrl</b>-click adds one, then the fields apply to all of them: set course, semester and exam for a whole file at once, then the subject page by page.</p>${keysHelp()}</div>`;
    return;
  }
  const keys = [...new Set(ps.map((p) => p.key))];
  const one = keys.length === 1 ? keys[0] : null;
  const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.f : null;
  ed.innerHTML = `<div class="editor">${one ? pageToolsHTML(one, ps) : `<div class="title">${ps.length} parts selected</div>`}${suggestionHTML(keys)}${fieldsHTML(ps)}${keysHelp()}</div>`;
  if (one) drawCanvas(one, true);
  if (focus) { const el = ed.querySelector(`[data-f="${focus}"]`); if (el && el.tagName !== "SELECT") { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); } }
}

const keysHelp = () => `<details class="keys" ${S.keysOpen ? "open" : ""}><summary>Keyboard shortcuts</summary><p class="muted small"> <kbd>←</kbd> <kbd>→</kbd> previous / next · <kbd>A</kbd> accept the suggestion and go on · <kbd>U</kbd> use · <kbd>S</kbd> skip · <kbd>H</kbd> held back · <kbd>C</kbd> continues · <kbd>R</kbd> turn right · <kbd>Del</kbd> remove the selected black-out box</p></details>`;

function pageToolsHTML(key, ps) {
  const pg = pageOf(key), [src, n] = splitKey(key);
  const onePart = ps.length === 1 && pg.split ? ps[0] : null;
  const side = { h: ["Top", "Bottom"], v: ["Left", "Right"] }[pg.split];
  return `
    <div class="title">${esc(src)} · page ${n}${onePart ? ` · <span class="ok">${side[onePart.part]} half</span>` : ""}</div>
    <div class="canvas-wrap"><canvas id="cv"></canvas></div>
    <div class="tools">
      <button type="button" data-act="turn" data-deg="270" title="Turn the page left">↺ Turn left</button>
      <button type="button" data-act="turn" data-deg="90" title="Turn the page right (R)">↻ Turn right</button>
      <span class="sep"></span>
      <button type="button" data-act="split" data-split="" class="${pg.split ? "" : "on"}">One paper</button>
      <button type="button" data-act="split" data-split="h" class="${pg.split === "h" ? "on" : ""}" title="Two question papers, one above the other">2 papers: top / bottom</button>
      <button type="button" data-act="split" data-split="v" class="${pg.split === "v" ? "on" : ""}" title="Two question papers side by side">2 papers: left / right</button>
      ${onePart ? `<span class="sep"></span><button type="button" data-act="turn-part">↻ Turn this half${onePart.raw.rotation ? ` (${onePart.raw.rotation}°)` : ""}</button>` : ""}
      <span class="sep"></span>
      <button type="button" data-act="box-del" ${S.box === null ? "disabled" : ""}>Remove box</button>
    </div>
    <p class="muted small">Drag on the page to black out a name or roll number: it is burned into the PDF.${pg.split ? " Drag the dashed line to move the split; click a half to edit it." : ""} The small pictures show exactly what will be written.</p>`;
}

function fieldsHTML(ps) {
  const v = (k) => common(ps.map((p) => p.d[k]));
  const locked = ps.every((p) => p.raw.continues && p.follows);
  const dis = locked ? "disabled" : "";
  const status = v("status"), cont = common(ps.map((p) => p.raw.continues));
  const c = v("course"), sem = v("semester"), subj = v("subject"), kind = v("kind"), session = v("session");
  if (c !== MIXED && sem !== MIXED) ensureManifest(c, sem);
  const problems = ps.map((p) => S.problems[p.id]).filter(Boolean);

  const opt = (val, text, cur) => `<option value="${esc(val)}" ${val === cur ? "selected" : ""}>${esc(text)}</option>`;
  const mixedOpt = (cur) => (cur === MIXED ? `<option value="${MIXED}" selected>— mixed —</option>` : "");
  const schools = [...new Set(S.info.courses.map((x) => x.school))];
  const courseSel = `<select data-f="course" ${dis}>${mixedOpt(c)}${opt("", "— course —", c)}${schools.map((sc) => `<optgroup label="${esc(sc)}">${S.info.courses.filter((x) => x.school === sc).map((x) => opt(x.id, x.name, c)).join("")}</optgroup>`).join("")}</select>`;
  const nSem = c !== MIXED && course(c) ? course(c).semesters : 10;
  const semSel = `<select data-f="semester" ${dis}>${mixedOpt(sem)}${opt("", "—", sem === null ? "" : sem)}${Array.from({ length: nSem }, (_, i) => opt(String(i + 1), `Semester ${i + 1}`, sem === MIXED ? null : String(sem))).join("")}</select>`;

  let subjectRow;
  if (c === MIXED || sem === MIXED || !c || !sem) {
    subjectRow = `<select disabled><option>${c === MIXED || sem === MIXED ? "— mixed courses —" : "pick course and semester first"}</option></select>`;
  } else {
    const subs = subjectsFor(c, sem), m = manifestOf(c, sem);
    subjectRow = `<div class="row"><select data-f="subject" ${dis}>${mixedOpt(subj)}${opt("", m && m.loading ? "loading…" : "— subject —", subj)}${subs.map((s) => opt(s.id, s.name + (s.here ? " (added here)" : ""), subj)).join("")}</select><button type="button" class="small" data-act="new-subject" ${dis} style="flex:0">+ New</button></div>`;
    if (S.newSubject) subjectRow += newSubjectHTML();
  }

  const sessions = [...new Set([...S.pieces.map((p) => p.d.session).filter(Boolean), ...Object.values(S.manifests).flatMap((m) => (m.exams || []).map((e) => e.session))])].sort().reverse();

  const reasons = status === "skip" ? S.info.skip_reasons : status === "held" ? S.info.held_reasons : null;
  const reason = v("reason");
  const followsLabel = locked && ps.length === 1 ? label(ps[0].follows) : "";
  const noPrev = ps.some((p) => p.raw.continues && !p.follows);

  return `
    ${problems.length ? `<p class="error small">⚠ ${problems.map(esc).join("<br>⚠ ")}</p>` : ""}
    ${status === "held" ? `<p class="small warn" id="held-hint">Held back${reason && reason !== MIXED ? `: ${esc(reason)}` : ""}. Fill in what is missing below (the year goes in Session) and it becomes Use.</p>` : ""}
    <div class="status" id="status">${statusHTML(ps)}</div>
    <label class="small"><input type="checkbox" data-f="continues" ${cont === true ? "checked" : ""}> Continues the previous page (the same paper's next page)</label>
    ${locked ? `<p class="muted small">Takes its course, subject and exam from ${esc(followsLabel || "the page before it")}.</p>` : ""}
    ${noPrev ? `<p class="error small">There is no used or held-back page before it to continue.</p>` : ""}
    ${reasons ? `<div class="field" id="reason-field"><label>Reason</label><div class="row">${reasons.map((r) => `<button type="button" class="small ${reason === r ? "on" : ""}" data-act="reason" data-reason="${esc(r)}" ${dis}>${esc(r)}</button>`).join("")}</div>
      <span></span><input type="text" data-f="reason" value="${reason === MIXED || reasons.includes(reason) ? "" : esc(reason)}" placeholder="${reason === MIXED ? "— mixed —" : "or in your own words"}" ${dis}></div>` : ""}
    <div class="field">
      <label>Course</label>${courseSel}
      <label>Semester</label>${semSel}
      <label>Subject</label><div>${subjectRow}</div>
      <label>Exam</label><select data-f="kind" ${dis}>${mixedOpt(kind)}${opt("", "—", kind)}${S.info.kinds.map((k) => opt(k.id, k.name, kind)).join("")}</select>
      <label>Session</label><input type="text" data-f="session" list="sessions" value="${session === MIXED ? "" : esc(session)}" placeholder="${session === MIXED ? "— mixed —" : "2024-25 (academic year, July to June)"}" ${dis}>
      <span class="hint error" id="session-hint">${sessionHint(ps)}</span>
      <label>Date</label><div id="date-cell">${dateCellHTML(ps)}</div>
      <span class="hint" id="date-hint">${dateHint(ps)}</span>
      <label>Note</label><textarea data-f="note" rows="1" placeholder="${v("note") === MIXED ? "— mixed —" : "optional; goes into the manifest as a comment"}">${v("note") === MIXED ? "" : esc(v("note"))}</textarea>
    </div>
    <datalist id="sessions">${sessions.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
    <div class="row">
      <button type="button" class="small" data-act="same-as-previous" ${dis}>Same course, semester and exam as the page before</button>
    </div>`;
}

function statusHTML(ps) {
  const status = common(ps.map((p) => p.d.status)), dis = ps.every((p) => p.raw.continues && p.follows) ? "disabled" : "";
  return [["use", "Use"], ["skip", "Skip"], ["held", "Held back"]].map(([st, text]) => `<button type="button" data-act="status" data-status="${st}" class="${status === st ? "on" : ""}" ${dis}>${text}</button>`).join("");
}

/** The exam the selected parts belong to, when they all belong to one with course, semester, exam and session set. */
function oneExam(ps) {
  const keys = [...new Set(ps.map((p) => examKey(p.d)))];
  const d = ps[0].d;
  if (keys.length > 1) return { several: true };
  if (!d.course || !d.semester || !d.kind || !validSession(d.session)) return null;
  return { key: keys[0], d, inManifest: examInManifest(d.course, d.semester, d.session, d.kind) };
}

// The exam's date belongs to the exam, shared by every page of it.
function dateCellHTML(ps) {
  const x = oneExam(ps);
  if (!x) return `<input type="text" disabled placeholder="pick course, semester, exam and session">`;
  if (x.several) return `<input type="text" disabled placeholder="— several exams selected —">`;
  if (x.inManifest) return `<input type="text" disabled value="${esc(x.inManifest.date)}">`;
  return `<input type="text" data-f="date" value="${esc(S.state.exam_dates[x.key] || "")}" placeholder="2024-12, or 2024 if no paper prints the month">`;
}
function dateHint(ps) {
  const x = oneExam(ps);
  if (!x || x.several) return "";
  if (x.inManifest) return `Already in the manifest as <code>${esc(x.inManifest.id)}</code>; the desk keeps its date.`;
  const d = S.state.exam_dates[x.key] || "";
  return d && !/^\d{4}(-\d{2})?$/.test(d) ? `<span class="error">Looks like "2024-12" or "2024".</span>` : "Shared by every page of this exam.";
}
function sessionHint(ps) {
  const s = common(ps.map((p) => p.d.session));
  return s && s !== MIXED && !validSession(s) ? "Looks like 2024-25." : "";
}

/** While typing: refresh only what depends on the typed value (the field itself keeps its focus). */
function updateDerived() {
  const ps = selected();
  if (!ps.length || !$("#status")) return;
  $("#status").innerHTML = statusHTML(ps);
  const status = common(ps.map((p) => p.d.status));
  for (const [id, show] of [["#held-hint", status === "held"], ["#reason-field", status === "held" || status === "skip"]]) if ($(id)) $(id).hidden = !show;
  $("#session-hint").innerHTML = sessionHint(ps);
  $("#date-hint").innerHTML = dateHint(ps);
  if (document.activeElement.dataset.f !== "date") $("#date-cell").innerHTML = dateCellHTML(ps);
}

function newSubjectHTML() {
  return `<div class="newsub">
    <input type="text" id="ns-name" placeholder="Subject name as printed, e.g. Data Structures">
    <input type="text" id="ns-id" placeholder="id: data-structures (filled in from the name)">
    <input type="text" id="ns-aliases" placeholder="Other names on the papers, comma-separated: DS, Data Structure">
    <div class="row"><button type="button" class="small primary" data-act="add-subject">Add subject</button><button type="button" class="small" data-act="cancel-subject">Cancel</button><span id="ns-error" class="error small"></span></div>
  </div>`;
}

// ------------------------------------------------------------------ suggestions (the model's reading, picture matches)

const TURN_WORDS = { 90: "turn it right", 180: "turn it upside down", 270: "turn it left" };
const SIDE_WORDS = { h: ["top", "bottom"], v: ["left", "right"] };
const acceptable = (key) => !!S.sugs[key] && S.sugs[key].parts.some((s) => s.status !== "todo");
/** Undecided pages with a suggestion that can be accepted. */
const waitingPages = () => (S.info ? pageKeys().filter((k) => undecided(k) && acceptable(k)) : []);

function sugLine(s) {
  if (s.status === "skip") return `Skip: ${esc(s.reason)}`;
  if (s.continues) return "Continues the paper before it";
  if (s.status === "todo") return "Nothing to suggest";
  const bits = [course(s.course) ? course(s.course).name : "", s.semester ? `Semester ${s.semester}` : "", s.subject ? subjectName(s.course, s.semester, s.subject) : "",
    kindName(s.kind), s.session, s.date ? `date ${s.date}` : ""].filter(Boolean).map(esc).join(" · ");
  return s.status === "held" ? `Held back: ${esc(s.reason)}${bits ? ` · ${bits}` : ""}` : `Use · ${bits}`;
}

function suggestionHTML(keys) {
  const canRead = !S.info.reader.problem;
  if (keys.length > 1) {
    const ready = keys.filter((k) => undecided(k) && acceptable(k));
    return ready.length ? `<div class="suggest"><div class="row"><span>✦ ${ready.length} of the selected pages have a suggestion.</span><span class="grow"></span>
      <button type="button" class="small primary" data-act="accept">Accept ${ready.length}</button></div>
      <p class="muted small">Look at each picture first: the model can misread.</p></div>` : "";
  }
  const key = keys[0], sug = S.sugs[key];
  if (S.read && S.read.reading.includes(key)) return `<div class="suggest muted">✦ The model is reading this page…</div>`;
  if (!sug) return canRead ? `<div class="row"><button type="button" class="small" data-act="read-again">✦ Read this page (model)</button></div>` : "";
  const open = undecided(key), pg = pageOf(key);
  const page = [];
  if (sug.rotation !== pg.rotation) page.push(TURN_WORDS[(sug.rotation - pg.rotation + 360) % 360]);
  if (sug.split && sug.split !== pg.split) page.push(`two papers, ${SIDE_WORDS[sug.split].join(" and ")}`);
  const parts = sug.parts.map((s, i) => {
    const side = sug.split ? `<b>${SIDE_WORDS[sug.split][i]}:</b> ` : "";
    const printed = s.printed ? `<div class="small">Printed: <i>${esc(s.printed)}</i></div>` : "";
    const notes = s.notes.length ? `<div class="small muted">${s.notes.map(esc).join(" · ")}</div>` : "";
    const err = s.error && sug.parts.length > 1 ? `<div class="small error">${esc(s.error)}</div>` : "";
    const mine = pg.parts[i] || {}; // decided already: offered while that paper has no subject, in the suggestion's course and semester
    const add = s.new_subject && s.course && s.semester && (open || (sug.parts.length === pg.parts.length && !mine.subject && mine.status !== "skip"
      && mine.course === s.course && mine.semester === s.semester)) ? `<button type="button" class="small" data-act="add-suggested-subject" data-part="${i}">+ Add “${esc(s.new_subject)}” as a subject</button>` : "";
    return `<li>${side}${sugLine(s)}${printed}${notes}${err}${add}</li>`;
  }).join("");
  const other = sug.duplicate && S.byId[`${sug.duplicate.of}:0`] ? `<button type="button" class="small" data-goto-page="${esc(sug.duplicate.of)}">Show the other copy</button>` : "";
  const who = sug.model ? `the model (<code>${esc(sug.model)}</code>)` : "a picture match";
  return `<div class="suggest ${open ? "" : "done"}">
    <div class="row"><b>✦ Suggested by ${who}</b><span class="grow"></span>
      ${open && acceptable(key) ? `<button type="button" class="small primary" data-act="accept">Accept (A)</button>` : ""}
      ${canRead ? `<button type="button" class="small" data-act="read-again">Read again</button>` : ""}</div>
    ${sug.error && !acceptable(key) ? `<p class="error small">Could not read it: ${esc(sug.error)}</p>` : ""}
    ${page.length ? `<div class="small">Page: ${page.map(esc).join(" · ")}</div>` : ""}
    <ul>${parts}</ul>${other}
    ${!open && fillable(key).length ? `<div class="row"><button type="button" class="small primary" data-act="fill">Fill in what is missing</button><span class="muted small">Held back: this suggestion knows some of what is missing.</span></div>` : ""}
    <p class="muted small">${open ? "Only a suggestion: check it against the picture. Nothing counts until you accept it." : "You decided this page already; this is only for comparison."}</p>
  </div>`;
}

/** Undecided pages whose suggestion is sure on every part, in order. A page that continues the paper
 *  before it counts only when that paper's page is decided or sure too (else it would join the wrong paper). */
function surePages() {
  const out = [];
  let paperOk = false; // the paper a continuing page would join is decided or accepted with these
  for (const key of pageKeys()) {
    const pg = pageOf(key), sug = S.sugs[key];
    if (!undecided(key)) {
      for (const p of pg.parts) if (p.status === "use" || p.status === "held") paperOk = true;
      continue;
    }
    const reading = S.read && S.read.reading.includes(key);
    let ok = !!sug && !reading && acceptable(key) && sug.parts.every((s) => s.sure), after = paperOk;
    if (ok) for (const s of sug.parts) {
      if (s.continues && !after) ok = false;
      if (s.status === "use" && !s.continues) after = true;
    }
    if (ok) { out.push(key); paperOk = after; } else paperOk = false;
  }
  return out;
}

async function acceptSure() {
  const keys = surePages();
  if (!keys.length) return toast("No page is sure: check the suggested ones one by one (A accepts and goes on).");
  const left = waitingPages().length - keys.length;
  if (!(await ask(`Accept ${keys.length} sure page${keys.length > 1 ? "s" : ""}?`, `Every field of these matched what is printed on them, or they continue the paper before them, or they are copies of another page.${left ? ` The other ${left} suggested page${left > 1 ? "s stay" : " stays"} for you to check.` : ""}\n\nYou can still change any page afterwards: its small picture shows what was accepted.`, `Accept ${keys.length}`))) return;
  const n = acceptPages(keys);
  toast(`Accepted ${n} page${n === 1 ? "" : "s"}.` + (left ? ` ${left} left to check.` : ""));
  GO.waiting();
}

/** Undecided pages of this file with a suggestion to accept (not the ones the model is reading now). */
const sourceWaiting = (id) => waitingPages().filter((k) => splitKey(k)[0] === id && !(S.read && S.read.reading.includes(k)));

/** Accept every suggestion waiting in one file, sure or not, after saying how many have something to check. */
async function acceptSource(id) {
  const keys = sourceWaiting(id);
  if (!keys.length) return;
  const sure = new Set(surePages()), check = keys.filter((k) => !sure.has(k)).length;
  const parts = keys.flatMap((k) => S.sugs[k].parts), held = parts.filter((s) => s.status === "held").length, skip = parts.filter((s) => s.status === "skip").length;
  const s = (n) => (n === 1 ? "" : "s");
  const what = [held ? `${held} held back` : "", skip ? `${skip} skipped` : ""].filter(Boolean).join(", ");
  if (!(await ask(`Accept all ${keys.length} suggested page${s(keys.length)} of ${id}?`,
    (check ? `${check} of them ${check === 1 ? "is" : "are"} not sure: the model may have misread something, or a field was worked out (its notes say what). ` : "Every one of them is sure. ")
    + (what ? `As suggested, ${what}. ` : "") + "\n\nLook over the small pictures afterwards: you can still change any page.", `Accept ${keys.length}`))) return;
  const n = acceptPages(keys);
  toast(`Accepted ${n} page${s(n)} of ${id}.`);
}

const ROMAN = { i: "1", ii: "2", iii: "3", iv: "4", v: "5" };
const CODE = /\b[a-z]{2,4}\s*[-–—]?\s*\d{3}[a-z]?\b/gi; // a course code printed with the name: IT-201, IC-101A, IT – 203A
const EDGE = /^[\s:;,.\-–—]+|[\s:;,.\-–—]+$/g;
/** A printed subject name without its course code or brackets: "IC-101A: Mathematics I" -> "Mathematics I";
 *  a code with the name in brackets, "IT – 203A (Data & Computer Communications)", is that name. */
function cleanSubject(n) {
  const rest = n.replace(CODE, " "), inner = (rest.match(/\((.*?)\)/) || [])[1] || "";
  const out = rest.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").replace(EDGE, "");
  return /[a-z]/i.test(out) ? out : inner.replace(EDGE, "");
}
/** What stays the same across printed variants of one name: case, "&", I or 1, a plural s, course codes.
 *  "Data Structures" and "Data structure", "Mathematics - 1 (IT-101)" and "Mathematics-I" have the same key. */
const SHORT = { maths: "mathematic", math: "mathematic", mathematics: "mathematic" };
const subjectKey = (n) => cleanSubject(n).toLowerCase().replace(/&/g, " and ").replace(/\+\+/g, " plus plus ").replace(/[^a-z0-9]+/g, " ").trim().split(" ")
  .map((w) => ROMAN[w] || SHORT[w] || (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w).replace(/isation$/, "ization")).join(" ");
/** "DCC" printed for "Data and Computer Communication": an all-capitals short form and the initials of a name. */
const initials = (n) => subjectKey(n).split(" ").filter((w) => !["and", "of", "the", "in", "to", "for"].includes(w)).map((w) => w[0]).join("");
const shortForm = (n) => (/^[A-Z]{2,5}$/.test(cleanSubject(n)) ? cleanSubject(n).toLowerCase() : "");
/** Two printed names of one subject. */
function sameSubject(a, b) {
  if (subjectKey(a) === subjectKey(b)) return true;
  const sa = shortForm(a), sb = shortForm(b);
  return (!!sa && !sb && sa === initials(b)) || (!!sb && !sa && sb === initials(a));
}

/** The subject of a suggested part. A subject printed on the paper that its semester does not have yet is
 *  added to that semester (named as printed, without its course code), so the next papers printing that
 *  name match it; a variant of a name added before joins that subject as another name (alias). */
function suggestedSubject(s) {
  if (s.subject || !s.new_subject || !s.course || !s.semester) return s.subject || "";
  const printed = s.new_subject.trim();
  if (!subjectKey(printed)) return "";
  const subs = subjectsFor(s.course, s.semester);
  const same = (n) => subjectKey(n) === subjectKey(printed);
  const hit = subs.find((x) => [x.name, ...(x.aliases || [])].some(same))
    || ((hits) => (hits.length === 1 ? hits[0] : null))(subs.filter((x) => [x.name, ...(x.aliases || [])].some((n) => sameSubject(n, printed))));
  const mine = (S.state.subjects[`${s.course}/${s.semester}`] ||= []);
  if (hit) {
    const own = mine.find((x) => x.id === hit.id);
    if (own && ![own.name, ...own.aliases].includes(printed)) {
      if (shortForm(own.name) && !shortForm(printed)) [own.name, own.aliases] = [cleanSubject(printed) || printed, [...own.aliases, own.name]];
      else own.aliases.push(printed);
    }
    return hit.id;
  }
  const name = cleanSubject(printed) || printed, id = slug(name);
  if (!id || subjectsFor(s.course, s.semester).some((x) => x.id === id)) return id;
  mine.push({ id, name, aliases: name === printed ? [] : [printed] });
  return id;
}

/** What the suggestion can add to a held-back part: the empty fields it has a value for (often the
 *  year or exam from the file name). */
function gains(part, s) {
  if (!s || s.status === "skip" || s.continues) return [];
  const here = (part.course || s.course) === s.course && (part.semester || s.semester) === s.semester;
  return PAPER_FIELDS.filter((f) => !part[f] && (f === "subject" ? s.subject || (s.new_subject && here) : s[f]) && (f !== "session" || validSession(s[f])));
}
/** The held-back parts of this page that their suggestion can add something to. */
function fillable(key) {
  const pg = pageOf(key), sug = S.sugs[key];
  if (!sug || sug.parts.length !== pg.parts.length) return [];
  return pg.parts.map((p, i) => (p.status === "held" && gains(p, sug.parts[i]).length ? i : -1)).filter((i) => i >= 0);
}
const fillablePages = () => (S.info ? pageKeys().filter((k) => fillable(k).length) : []);
const MISSING = [["session", "no year"], ["kind", "no test number"], ["subject", "no subject"]];

/** Fill the empty fields of those held-back parts from their suggestion; what the maintainer set stays.
 *  A part with nothing missing any more is Use; the others stay held back, their reason saying what is
 *  still missing. Returns [filled, now use]. */
function fillHeld(keys) {
  let filled = 0, use = 0;
  for (const key of keys) for (const i of fillable(key)) {
    const s = S.sugs[key].parts[i], part = editPage(key).parts[i];
    for (const f of gains(part, s)) part[f] = f === "subject" ? suggestedSubject(s) : s[f];
    filled++;
    if (PAPER_FIELDS.every((f) => part[f]) && validSession(part.session)) {
      Object.assign(part, { status: "use", reason: "" });
      use++;
      if (s.date && !S.state.exam_dates[examKey(part)] && !examInManifest(part.course, part.semester, part.session, part.kind)) S.state.exam_dates[examKey(part)] = s.date;
    } else {
      const still = MISSING.filter(([f]) => !part[f]).map(([, why]) => why).join(", ");
      if (still) part.reason = still;
    }
  }
  if (filled) changed();
  return [filled, use];
}

async function fillAllHeld() {
  const keys = fillablePages(), n = keys.reduce((a, k) => a + fillable(k).length, 0);
  if (!(await ask(`Fill ${n} held-back paper${n > 1 ? "s" : ""}?`, "Their suggestion knows some of what was missing, most often the year or the exam from the file name (the notes on each page say where it came from). Only empty fields are filled; what you set stays.\n\nA paper with nothing missing any more becomes Use; the others stay held back with what is still missing as the reason.", `Fill ${n}`))) return;
  const [filled, use] = fillHeld(keys);
  toast(`Filled ${filled} held-back paper${filled === 1 ? "" : "s"}: ${use} ${use === 1 ? "is" : "are"} Use now` + (filled - use ? `, ${filled - use} still miss something (see Held back).` : "."));
}

/** Take the suggestions of these pages as decisions (only pages not decided yet). Returns how many. */
function acceptPages(keys) {
  let n = 0;
  for (const key of keys) {
    const sug = S.sugs[key];
    if (!undecided(key) || !acceptable(key)) continue;
    const pg = editPage(key);
    pg.rotation = sug.rotation;
    if (sug.split !== pg.split) { pg.split = sug.split; pg.at = 0.5; }
    pg.parts = sug.parts.map((s, i) => ({ ...blankPart(), note: (pg.parts[i] || {}).note || "", status: s.status, reason: s.reason, continues: s.continues,
      course: s.course, semester: s.semester, subject: s.continues ? "" : suggestedSubject(s), kind: s.kind, session: s.session, rotation: s.rotation }));
    for (const s of sug.parts) {
      if (s.date && s.course && s.semester && s.kind && validSession(s.session) && !S.state.exam_dates[examKey(s)] && !examInManifest(s.course, s.semester, s.session, s.kind)) {
        S.state.exam_dates[examKey(s)] = s.date;
      }
    }
    n++;
  }
  if (n) changed();
  return n;
}

function acceptAndGoOn() {
  const keys = [...new Set(selected().map((p) => p.key))];
  if (!acceptPages(keys)) return;
  const last = S.pieces.findIndex((p) => p.key === keys[keys.length - 1]);
  const next = S.pieces.slice(last + 1).find((p) => undecided(p.key) && acceptable(p.key)) || S.pieces.slice(last + 1).find((p) => p.d.status === "todo");
  if (next) select([next.id], next.id);
}

async function fetchRead() {
  clearTimeout(S.readTimer);
  S.readTimer = null;
  let r;
  try {
    r = await api("GET", "/api/read");
  } catch (e) {
    $("#read-progress").textContent = `Suggestions: ${e.message}`;
    return;
  }
  S.read = r;
  S.sugs = r.suggestions;
  for (const sug of Object.values(S.sugs)) for (const s of sug.parts) ensureManifest(s.course, s.semester);
  showReadProgress();
  refresh();
  if (r.running || !r.dupes_ready) S.readTimer = setTimeout(fetchRead, 1500);
}

function showReadProgress() {
  const r = S.read, el = $("#read-progress");
  const off = S.info && S.info.reader.problem;
  $("#btn-read b").textContent = r && r.running ? "Stop reading" : "Read pages";
  if (!r) {
    el.textContent = off ? `off: ${off}` : "not read yet";
    return;
  }
  const failed = r.failed ? ` · ${r.failed} not read` : "";
  if (r.running) el.textContent = `reading ${r.done} of ${r.total}…${failed}`;
  else if (r.stopped) el.textContent = r.stopped === "stopped" ? `stopped after ${r.done} pages` : `stopped: ${r.stopped}`;
  else if (r.total) el.textContent = `read ${r.done} pages${failed}`;
  else el.textContent = !r.dupes_ready ? "comparing pages…" : off ? `off: ${off}` : "not read yet";
  el.title = el.textContent;
  updateSteps();
}

async function startReading(pages) {
  try {
    const r = await api("POST", "/api/read", pages ? { pages } : {});
    if (!pages && !r.queued) toast("Every undecided page has been read already. Use “Read again” on a page to read it again.");
  } catch (e) {
    return toast(e.message, true);
  }
  fetchRead();
}

$("#btn-read").addEventListener("click", async () => {
  if (S.read && S.read.running) {
    S.read = await api("POST", "/api/read/stop");
    S.sugs = S.read.suggestions;
    return showReadProgress();
  }
  const r = S.info.reader;
  if (r.problem) return toast(`The desk cannot read pages yet: ${r.problem}. This step is optional: everything else works without it.`, true);
  const n = pageKeys().filter((k) => undecided(k) && !(S.sugs[k] && !S.sugs[k].error)).length;
  if (!n) return toast("Every undecided page has a suggestion already. Use “Read again” on a page to read it again.");
  await save();
  if (!(await ask(`Read ${n} page${n > 1 ? "s" : ""} with the model?`, `${r.model} reads each undecided page and suggests its course, subject and exam. About one model call per page (two for a page that comes in sideways). Answers are cached in data/work/cache, so pages read before cost nothing.\n\nThe pages are sent as they are now: names and roll numbers you have not blacked out yet are sent too.\n\nWhat the model reads is only a suggestion: you accept or change each page.`, `Read ${n} page${n > 1 ? "s" : ""}`))) return;
  startReading(null);
});

function validSession(s) {
  return /^\d{4}-\d{2}$/.test(s) && Number(s.slice(5)) === (Number(s.slice(0, 4)) + 1) % 100;
}
const slug = (s) => s.toLowerCase().replace(/&/g, " and ").replace(/\+\+/g, " plus plus ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Set a field on every selected part that is not continuing another (those take it from the page before). */
function setField(f, value) {
  for (const p of selected()) {
    if (p.raw.continues && p.follows && f !== "continues" && f !== "note") continue;
    const part = editPage(p.key).parts[p.part];
    const missing = PAPER_FIELDS.some((k) => !part[k]) || !validSession(part.session);
    part[f] = value;
    if (f === "course" || f === "semester") part.subject = "";
    if (part.status === "held" && missing && PAPER_FIELDS.every((k) => part[k]) && validSession(part.session)) {
      part.status = "use"; // what was missing is filled in now
      part.reason = "";
    }
    if (f === "course" && part.semester && course(value) && part.semester > course(value).semesters) part.semester = null;
    if (PAPER_FIELDS.includes(f) && part.status === "todo" && value) part.status = "use";
  }
  changed();
}

const isText = (el) => el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type === "text");

// Selects and the checkbox apply on change; text fields on every keystroke (without rebuilding the editor).
$("#editor").addEventListener("change", (e) => {
  const f = e.target.dataset.f;
  if (!f || isText(e.target) || e.target.value === MIXED) return;
  if (f === "continues") return setField("continues", e.target.checked);
  if (f === "semester") return setField("semester", e.target.value ? Number(e.target.value) : null);
  setField(f, e.target.value);
});

$("#editor").addEventListener("input", (e) => {
  const f = e.target.dataset.f;
  if (f && isText(e.target)) {
    if (f === "date") {
      S.state.exam_dates[examKey(selected()[0].d)] = e.target.value.trim();
      return changed();
    }
    return setField(f, f === "note" ? e.target.value : e.target.value.trim());
  }
  if (e.target.id === "ns-name") {
    const idEl = $("#ns-id");
    if (!idEl.dataset.touched) idEl.value = slug(e.target.value);
  }
  if (e.target.id === "ns-id") e.target.dataset.touched = "1";
});

$("#editor").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const act = b.dataset.act, ps = selected();
  const key = ps.length ? ps[0].key : null;
  if (act === "status") {
    for (const p of ps) if (!(p.raw.continues && p.follows)) editPage(p.key).parts[p.part].status = b.dataset.status;
    return changed();
  }
  if (act === "reason") return setField("reason", b.dataset.reason);
  if (act === "turn") return turnPage(key, Number(b.dataset.deg));
  if (act === "turn-part") {
    const part = editPage(key).parts[ps[0].part];
    part.rotation = (part.rotation + 90) % 360;
    return changed();
  }
  if (act === "split") return setSplit(key, b.dataset.split);
  if (act === "box-del") return removeBox();
  if (act === "new-subject") { S.newSubject = true; renderEditor(); return $("#ns-name").focus(); }
  if (act === "cancel-subject") { S.newSubject = false; return renderEditor(); }
  if (act === "add-subject") return addSubject();
  if (act === "same-as-previous") return sameAsPrevious();
  if (act === "accept") return acceptAndGoOn();
  if (act === "fill") return fillHeld([...new Set(ps.map((p) => p.key))]);
  if (act === "read-again") {
    await save();
    return startReading([...new Set(ps.map((p) => p.key))]);
  }
  if (act === "add-suggested-subject") {
    const name = S.sugs[key].parts[Number(b.dataset.part)].new_subject;
    acceptPages([key]);
    select([`${key}:${b.dataset.part}`], `${key}:${b.dataset.part}`);
    S.newSubject = true;
    renderEditor();
    $("#ns-name").value = name;
    $("#ns-id").value = slug(name);
    return $("#ns-aliases").focus();
  }
});

$("#editor").addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto-page]");
  if (go) select([`${go.dataset.gotoPage}:0`], `${go.dataset.gotoPage}:0`);
});

function turnPage(key, deg) {
  const pg = editPage(key);
  pg.rotation = (pg.rotation + deg) % 360;
  changed();
}

function setSplit(key, split) {
  const pg = editPage(key);
  if (pg.split === split) return;
  if (!split) pg.parts = [pg.parts[0]];
  else if (pg.parts.length === 1) {
    const a = pg.parts[0];
    pg.parts.push({ ...blankPart(), course: a.course, semester: a.semester, kind: a.kind, session: a.session });
    pg.at = 0.5;
  }
  pg.split = split;
  S.sel = [`${key}:0`];
  S.anchor = S.sel[0];
  changed();
}

function removeBox() {
  const p = selected()[0];
  if (!p || S.box === null) return;
  editPage(p.key).boxes.splice(S.box, 1);
  S.box = null;
  changed();
}

function addSubject() {
  const p = selected()[0], c = p.d.course, sem = p.d.semester;
  const name = $("#ns-name").value.trim(), id = $("#ns-id").value.trim();
  const aliases = $("#ns-aliases").value.split(",").map((s) => s.trim()).filter(Boolean);
  const err = (m) => { $("#ns-error").textContent = m; };
  if (!name) return err("Give the subject's name.");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return err("The id is lowercase letters, digits and hyphens.");
  if (subjectsFor(c, sem).some((s) => s.id === id)) return err(`There is already a subject ${id}.`);
  (S.state.subjects[`${c}/${sem}`] ||= []).push({ id, name, aliases });
  S.newSubject = false;
  setField("subject", id);
}

function sameAsPrevious() {
  const first = S.pieces.findIndex((p) => S.sel.includes(p.id));
  const prev = S.pieces.slice(0, first).reverse().find((p) => p.d.status === "use" || p.d.status === "held");
  if (!prev) return toast("No used or held-back page before this one.", true);
  for (const p of selected()) {
    if (p.raw.continues && p.follows) continue;
    const part = editPage(p.key).parts[p.part];
    for (const f of ["course", "semester", "kind", "session"]) part[f] = prev.d[f];
    if (part.status === "todo") part.status = "use";
  }
  changed();
}

// ------------------------------------------------------------------ the canvas

function pageImage(key) {
  if (S.images[key]) return S.images[key];
  const [src, n] = splitKey(key);
  const img = new Image();
  img.src = `/api/image?src=${encodeURIComponent(src)}&page=${n}`;
  img.onload = () => { if (selected()[0] && selected()[0].key === key) drawCanvas(key); };
  S.images[key] = img;
  const keys = Object.keys(S.images);
  if (keys.length > 12) delete S.images[keys[0]];
  return img;
}

function drawCanvas(key, attach = false) {
  const cv = $("#cv");
  if (!cv) return;
  const pg = pageOf(key), img = pageImage(key), ctx = cv.getContext("2d");
  const maxW = Math.max(200, $("#editor").clientWidth - 34), maxH = Math.max(260, window.innerHeight * 0.55);
  const dpr = window.devicePixelRatio || 1;
  if (!img.complete || !img.naturalWidth) {
    cv.width = maxW; cv.height = 200; cv.style.width = maxW + "px"; cv.style.height = "200px";
    ctx.fillStyle = "#a09fb0"; ctx.font = "14px system-ui"; ctx.fillText("Loading the page…", 16, 30);
  } else {
    const W = img.naturalWidth, H = img.naturalHeight, turned = pg.rotation % 180 !== 0;
    const uw = turned ? H : W, uh = turned ? W : H, k = Math.min(maxW / uw, maxH / uh);
    const cw = Math.round(uw * k), ch = Math.round(uh * k);
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    cv.style.width = cw + "px"; cv.style.height = ch + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((pg.rotation * Math.PI) / 180);
    ctx.drawImage(img, (-W * k) / 2, (-H * k) / 2, W * k, H * k);
    ctx.restore();
    const rect = (b) => [b[0] * cw, b[1] * ch, (b[2] - b[0]) * cw, (b[3] - b[1]) * ch];
    pg.boxes.forEach((b, i) => {
      const r = rect(toUpright(b, pg.rotation));
      ctx.fillStyle = "#000";
      ctx.fillRect(...r);
      if (i === S.box) { ctx.strokeStyle = "#c4b5fd"; ctx.lineWidth = 3; ctx.strokeRect(...r); }
    });
    if (pg.split) {
      const mine = S.sel.filter((id) => pieceKey(id) === key).map((id) => Number(id.slice(id.lastIndexOf(":") + 1)));
      for (const i of [0, 1]) if (!mine.includes(i)) { ctx.fillStyle = "rgba(9,9,11,0.5)"; ctx.fillRect(...rect(partRegion(pg.split, pg.at, i))); }
      ctx.setLineDash([10, 6]); ctx.strokeStyle = "#d7ff52"; ctx.lineWidth = 3;
      ctx.beginPath();
      if (pg.split === "h") { ctx.moveTo(0, pg.at * ch); ctx.lineTo(cw, pg.at * ch); } else { ctx.moveTo(pg.at * cw, 0); ctx.lineTo(pg.at * cw, ch); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    const d = S.drag;
    if (d && d.kind === "box" && d.moved) {
      const r = rect([Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)]);
      ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(...r);
      ctx.strokeStyle = "#d7ff52"; ctx.lineWidth = 2; ctx.strokeRect(...r);
    }
  }
  if (attach) attachCanvas(cv, key);
}

function attachCanvas(cv, key) {
  const at = (e) => {
    const r = cv.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1), r];
  };
  cv.onpointerdown = (e) => {
    const [x, y, r] = at(e), pg = pageOf(key);
    cv.setPointerCapture(e.pointerId);
    if (pg.split) {
      const along = pg.split === "h" ? y : x, size = pg.split === "h" ? r.height : r.width;
      if (Math.abs(along - pg.at) * size < 10) { S.drag = { kind: "split" }; return; }
    }
    const hit = pg.boxes.map((b) => toUpright(b, pg.rotation)).findLastIndex((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
    S.drag = { kind: "box", x0: x, y0: y, x1: x, y1: y, hit, moved: false, w: r.width, h: r.height };
  };
  cv.onpointermove = (e) => {
    const d = S.drag;
    if (!d) return;
    const [x, y] = at(e);
    if (d.kind === "split") {
      const pg = editPage(key);
      pg.at = clamp(pg.split === "h" ? y : x, 0.05, 0.95);
    } else {
      d.x1 = x; d.y1 = y;
      d.moved = d.moved || Math.abs(x - d.x0) * d.w > 5 || Math.abs(y - d.y0) * d.h > 5;
    }
    drawCanvas(key);
  };
  cv.onpointerup = (e) => {
    const d = S.drag, [x, y] = at(e), pg = pageOf(key);
    S.drag = null;
    if (!d) return;
    if (d.kind === "split") return changed();
    if (!d.moved) {
      if (d.hit >= 0) { S.box = d.hit; return renderEditor(); }
      S.box = null;
      if (pg.split) {
        const part = pg.split === "h" ? (y < pg.at ? 0 : 1) : x < pg.at ? 0 : 1;
        return select([`${key}:${part}`], `${key}:${part}`);
      }
      return renderEditor();
    }
    const up = [Math.min(d.x0, x), Math.min(d.y0, y), Math.max(d.x0, x), Math.max(d.y0, y)];
    const box = toSource(up, pg.rotation).map((v) => clamp(v, 0, 1));
    const p = editPage(key);
    p.boxes.push(box);
    S.box = p.boxes.length - 1;
    changed();
  };
}

window.addEventListener("resize", () => { const p = selected()[0]; if (p) drawCanvas(p.key); });

document.addEventListener("keydown", (e) => {
  if (!S.info || $("#desk").hidden || $("#sheet").open || $("#ask").open) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), ps = selected();
  if (k === "arrowright" || k === "arrowdown" || k === "j") { e.preventDefault(); return step(1); }
  if (k === "arrowleft" || k === "arrowup" || k === "k") { e.preventDefault(); return step(-1); }
  if (!ps.length) return;
  if (k === "a") return acceptAndGoOn();
  if (k === "u" || k === "s" || k === "h") {
    for (const p of ps) if (!(p.raw.continues && p.follows)) editPage(p.key).parts[p.part].status = { u: "use", s: "skip", h: "held" }[k];
    return changed();
  }
  if (k === "c") return setField("continues", !ps.every((p) => p.raw.continues));
  if (k === "r" && new Set(ps.map((p) => p.key)).size === 1) return turnPage(ps[0].key, 90);
  if ((k === "delete" || k === "backspace") && S.box !== null) { e.preventDefault(); return removeBox(); }
});

// ------------------------------------------------------------------ the page around the desk: views, steps, messages

function show(view) {
  $("#not-started").hidden = true;
  $("#closed").hidden = view !== "closed";
  $("#bar").hidden = view === "closed";
  $("#steps").hidden = view !== "desk";
  $("#start").hidden = view !== "start";
  $("#desk").hidden = view !== "desk";
}

function toast(msg, bad = false, stay = false) {
  const el = $("#toast");
  el.className = bad ? "bad" : "";
  $("span", el).textContent = msg;
  el.hidden = false;
  clearTimeout(S.toastTimer);
  if (!stay) S.toastTimer = setTimeout(() => { el.hidden = true; }, 9000);
}
$("#toast-close").addEventListener("click", () => { $("#toast").hidden = true; });

/** A yes/no question in the desk's own dialog. Resolves true for yes. */
function ask(title, body, yes = "OK") {
  const d = $("#ask");
  $("#ask-title").textContent = title;
  $("#ask-body").textContent = body;
  $("#ask-yes").textContent = yes;
  d.returnValue = "";
  d.showModal();
  $("#ask-yes").focus();
  return new Promise((done) => d.addEventListener("close", () => done(d.returnValue === "yes"), { once: true }));
}

/** The step bar: what is done, and the one thing to do next. */
function updateSteps() {
  if (!S.info || !S.state) return;
  const todo = S.pieces.filter((p) => p.d.status === "todo").length, total = S.pieces.length;
  const waiting = waitingPages().length, r = S.read || {}, canRead = !S.info.reader.problem;
  const run = S.run && S.run.last, running = !!S.run && !(run && run.done), ran = !!run && run.done && run.code === 0;
  const unread = pageKeys().filter((k) => undecided(k) && !S.sugs[k]).length;
  const s = (n) => (n === 1 ? "" : "s");
  const sure = waiting ? surePages().length : 0;
  const take = sure ? [`Accept ${sure} sure page${s(sure)}`, "sure"] : waiting ? ["Next suggested page", "waiting"] : null;
  let next;
  if (r.running) next = ["read", `The model is reading page ${Math.min(r.done + 1, r.total)} of ${r.total}.` + (sure ? ` ${sure} read so far are sure.` : " Check the pages it has read meanwhile."), take];
  else if (sure) next = ["check", `${waiting} page${s(waiting)} suggested, ${sure} of them sure. Accept those at once, then check the other ${waiting - sure}.`, take];
  else if (waiting) next = ["check", `${waiting} page${s(waiting)} suggested: check each against its picture, then accept (A) or fix it.`, take];
  else if (todo && canRead && unread && !r.total) next = ["read", `${todo} to sort. Let the model read the pages first, or start yourself.`, ["Read pages", "read"]];
  else if (todo) next = ["check", `${todo} left to decide: use, skip or held back.`, ["Next page to do", "todo"]];
  else if (!S.writtenFresh) next = ["write", "Every page is decided. Write the PDFs and manifests: you see what will be written first.", ["Write…", "write"]];
  else if (running) next = ["run", "The pipeline is running.", ["Show it", "run"]];
  else if (!ran) next = ["run", "Written. Run the pipeline to turn the papers into the pack the site shows.", ["Run…", "run"]];
  else next = ["run", "Done: the pipeline finished. Its report is in step 5.", null];

  const done = { open: true, read: !!r.total && !r.running, check: total > 0 && !todo, write: S.writtenFresh, run: ran };
  const els = { open: "#step-open", read: "#btn-read", check: "#step-check", write: "#btn-write", run: "#btn-run" };
  for (const [k, sel] of Object.entries(els)) $(sel).className = ["step", done[k] ? "done" : "", next[0] === k ? "now" : "", k === "read" && !canRead ? "skip" : "", k === "read" && r.running ? "busy" : ""].join(" ");
  const pages = S.info.sources.reduce((n, x) => n + x.pages, 0);
  $("#sub-open").textContent = `${S.info.sources.length} file${s(S.info.sources.length)} · ${pages} page${s(pages)}`;
  $("#progress").textContent = `${total - todo} of ${total} decided`;
  $("#sub-write").textContent = S.writtenFresh ? `${S.written.length} manifest${s(S.written.length)} written` : S.written.length ? "changed: write again" : "not yet";
  $("#sub-run").textContent = running ? "running…" : run && run.done ? (ran ? "finished" : "stopped with an error") : "not yet";
  $("#next-text").textContent = next[1];
  const go = $("#next-go");
  go.hidden = !next[2];
  if (next[2]) [go.textContent, go.dataset.go] = next[2];
}

function gotoFirst(test) {
  const at = S.sel.length ? S.pieces.findIndex((p) => p.id === S.sel[S.sel.length - 1]) : -1;
  const p = S.pieces.slice(at + 1).find(test) || S.pieces.find(test);
  if (!p) return;
  if (!S.shown.has(p.key)) { S.filter = "all"; renderGrid(); }
  select([p.id], p.id);
}
const GO = {
  waiting: () => gotoFirst((p) => undecided(p.key) && acceptable(p.key)),
  todo: () => gotoFirst((p) => p.d.status === "todo"),
  sure: () => acceptSure(),
  read: () => $("#btn-read").click(),
  write: () => $("#btn-write").click(),
  run: () => showRunSheet(),
};
$("#next-go").addEventListener("click", () => GO[$("#next-go").dataset.go]());
$("#step-check").addEventListener("click", () => (waitingPages().length ? GO.waiting() : GO.todo()));
$("#btn-run").addEventListener("click", () => showRunSheet());

$("#btn-close").addEventListener("click", async () => {
  await save();
  const busy = (S.read && S.read.running) || (S.run && !(S.run.last && S.run.last.done));
  if (busy && !(await ask("Close the desk?", "The page reading or the pipeline is still running: closing the desk stops it. Your decisions are saved.", "Close anyway"))) return;
  try {
    await api("POST", "/api/quit");
  } catch { /* stopped already */ }
  clearTimeout(S.readTimer);
  clearInterval(S.ping);
  $("#toast").hidden = true;
  show("closed");
  document.title = "Intake desk (closed)";
});

/** The page calls every minute while it is open; the desk stops itself half an hour after the last call. */
function ping() {
  fetch("/api/ping").then((r) => { if (!r.ok) throw new Error(r.statusText); })
    .catch(() => toast("The desk has stopped, so changes are not saved now. Double-click intake-desk.cmd to start it again, then reload this page.", true, true));
}

// ------------------------------------------------------------------ the start screen: drop files, carry on, open a folder

async function showStart(st) {
  try {
    st = st || (await api("GET", "/api/start"));
  } catch (e) {
    return toast(e.message, true);
  }
  show("start");
  $("#start").scrollTop = 0;
  $("#btn-back").hidden = !S.info;
  if (S.info) $("#btn-back").textContent = `← Back to ${S.info.name}`;
  $("#recent-wrap").hidden = !st.recent.length;
  $("#recent").innerHTML = st.recent.map(recentHTML).join("");
  if (!$("#open-path").value) $("#open-path").value = st.folder || "";
  S.browseFrom = st.folder || st.home;
  $("#open-error").textContent = "";
  if ($("#local").open) browse(S.browseFrom);
}

function recentHTML(r) {
  const pct = r.parts ? Math.round((100 * r.decided) / r.parts) : 0;
  return `<button type="button" class="card" data-open="${esc(r.path)}">
    <span class="row"><b>${esc(r.name)}</b><span class="grow"></span>${r.inbox ? `<span class="tag">dropped here</span>` : ""}${r.written ? `<span class="tag lime">written</span>` : ""}</span>
    <span class="path">${esc(r.path)}</span>
    <span class="meter"><i style="width:${pct}%"></i></span>
    <span class="row"><span>${r.decided} of ${r.parts} decided</span><span class="grow"></span><span>${r.pages} page${r.pages === 1 ? "" : "s"}${r.file ? " · one file" : ""}</span></span>
  </button>`;
}

async function browse(path) {
  try {
    const r = await api("GET", `/api/browse?path=${encodeURIComponent(path)}`);
    const up = r.parent !== null && r.parent !== undefined ? `<button type="button" data-browse="${esc(r.parent)}">↑ ${esc(r.parent || "Drives")}</button>` : "";
    const here = r.path && r.here ? `<button type="button" data-open="${esc(r.path)}" class="ok">Open the whole folder ${esc(r.path)} (${r.here} PDF${r.here > 1 ? "s" : ""} / photos here)</button>` : "";
    $("#open-browse").innerHTML = `${up}${here}${r.dirs.map((d) => `<button type="button" data-browse="${esc(d.path)}">📁 ${esc(d.name)}</button>`).join("")}`
      + r.files.map((f) => `<button type="button" data-open="${esc(f.path)}">📄 ${esc(f.name)} <span class="muted small">(only this file)</span></button>`).join("");
    if (r.path) $("#open-path").value = r.path;
  } catch (e) {
    $("#open-error").textContent = e.message;
  }
}

/** Open a folder or a file; `msg` shows "Opening…" and any error. */
async function openFolder(folder, msg) {
  msg.textContent = "Opening…";
  try {
    load(await api("POST", "/api/open", { folder }));
    msg.textContent = "";
  } catch (e) {
    msg.innerHTML = `<span class="error">${esc(e.message)}</span>`;
  }
}

/** What was dropped, as [{file, path}]: a dropped folder is walked, and its files keep their path inside it
 *  ("Sem 5/MST 1.pdf"), which the desk reads the semester, exam and year from. */
async function droppedFiles(dt) {
  const entries = [...dt.items].map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean); // before any await: the drop is gone after it
  if (!entries.length) return [...dt.files].map((file) => ({ file, path: file.name }));
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) return out.push({ file: await new Promise((ok, no) => entry.file(ok, no)), path: entry.fullPath.replace(/^\//, "") });
    const reader = entry.createReader();
    for (;;) { // a folder is listed a batch at a time
      const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
      if (!batch.length) break;
      for (const e of batch) await walk(e);
    }
  };
  for (const e of entries) await walk(e);
  // One dropped folder: its own name is left off, so the cards read "Sem 5/MST 1.pdf", not "Papers/Sem 5/MST 1.pdf".
  if (entries.length === 1 && entries[0].isDirectory) for (const f of out) f.path = f.path.slice(f.path.indexOf("/") + 1);
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/** Copy dropped or chosen files ([{file, path}]) into a new folder in data/inbox/, then open it. Each file
 *  goes as its own bytes, straight from the disk; a .zip is unpacked by the desk. */
async function upload(items) {
  if (S.uploading) return;
  const status = $("#upload-status");
  const ok = items.filter((it) => /\.(pdf|jpe?g|png|webp|zip)$/i.test(it.path) && !/(^|\/)\./.test(it.path)), skipped = items.length - ok.length;
  if (!ok.length) {
    status.innerHTML = `<span class="error">${items.length ? "None of those is a PDF, a photo (.jpg, .png, .webp) or a .zip of them." : "Nothing to copy in that."}</span>`;
    return;
  }
  S.uploading = true;
  const size = ok.reduce((n, it) => n + it.file.size, 0) || 1, t0 = performance.now();
  let folder = null, sent = 0, unpacked = 0;
  try {
    for (const [i, it] of ok.entries()) {
      status.innerHTML = `Copying ${i + 1} of ${ok.length}: ${esc(it.path)}<div class="bar-progress"><i style="width:${Math.round((100 * sent) / size)}%"></i></div>`;
      const q = new URLSearchParams({ name: it.path, ...(folder ? { folder } : {}) });
      const res = await fetch(`/api/upload?${q}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: it.file });
      const r = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) throw new Error(r.error || res.statusText);
      folder = r.folder;
      sent += it.file.size;
      unpacked += r.files || 0;
    }
  } catch (e) {
    status.innerHTML = `<span class="error">Could not copy them: ${esc(e.message)}</span>`;
    S.uploading = false;
    return;
  }
  S.uploading = false;
  const n = ok.length - ok.filter((it) => /\.zip$/i.test(it.path)).length + unpacked;
  toast(`Copied ${n} file${n === 1 ? "" : "s"} (${(size / 1e6).toFixed(size < 1e7 ? 1 : 0)} MB) in ${((performance.now() - t0) / 1000).toFixed(1)} s.`
    + (skipped ? ` ${skipped} other file${skipped > 1 ? "s" : ""} stayed out (not a PDF or a photo).` : ""));
  status.textContent = "";
  await openFolder(folder, status);
}

$("#start").addEventListener("click", (e) => {
  const b = e.target.closest("[data-browse],[data-open]");
  if (!b) return;
  if (b.dataset.open) openFolder(b.dataset.open, b.classList.contains("card") ? $(".path", b) : $("#open-error"));
  else browse(b.dataset.browse);
});
$("#open-go").addEventListener("click", () => openFolder($("#open-path").value.trim(), $("#open-error")));
$("#open-path").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); openFolder($("#open-path").value.trim(), $("#open-error")); } });
$("#local").addEventListener("toggle", () => { if ($("#local").open && !$("#open-browse").innerHTML) browse(S.browseFrom); });
$("#editor").addEventListener("toggle", (e) => { if (e.target.classList.contains("keys")) S.keysOpen = e.target.open; }, true);
for (const b of ["#btn-home", "#step-open"]) $(b).addEventListener("click", async () => { await save(); showStart(); });
$("#btn-back").addEventListener("click", () => show("desk"));
$("#pick").addEventListener("click", () => $("#files").click());
$("#files").addEventListener("change", (e) => { upload([...e.target.files].map((file) => ({ file, path: file.name }))); e.target.value = ""; });
for (const ev of ["dragenter", "dragover"]) $("#start").addEventListener(ev, (e) => { e.preventDefault(); $("#drop").classList.add("over"); });
$("#start").addEventListener("dragleave", (e) => { if (!$("#start").contains(e.relatedTarget)) $("#drop").classList.remove("over"); });
$("#start").addEventListener("drop", async (e) => {
  e.preventDefault();
  $("#drop").classList.remove("over");
  try {
    upload(await droppedFiles(e.dataTransfer));
  } catch (err) {
    $("#upload-status").innerHTML = `<span class="error">Could not read what was dropped: ${esc(err.message || String(err))}</span>`;
  }
});
for (const ev of ["dragover", "drop"]) window.addEventListener(ev, (e) => e.preventDefault()); // a file dropped elsewhere must not replace the page

function load(info) {
  S.info = info;
  S.state = info.state;
  S.manifests = {};
  S.problems = {};
  S.images = {};
  S.sel = [];
  S.box = null;
  S.sugs = {};
  S.read = null;
  S.filter = "all";
  S.written = info.written;
  S.writtenFresh = info.written.length > 0;
  if (S.run && S.run.last && S.run.last.done) S.run = null;
  show("desk");
  showReadProgress();
  resolve();
  for (const p of S.pieces) ensureManifest(p.d.course, p.d.semester);
  document.title = `${info.name} · Intake desk`;
  $("#folder-name").textContent = info.folder;
  $("#saved").textContent = "";
  renderGrid();
  const first = S.pieces.find((p) => p.d.status === "todo") || S.pieces[0];
  select(first ? [first.id] : [], first ? first.id : null);
  fetchRead();
}

// ------------------------------------------------------------------ writing and running

const sheetBody = () => $("#sheet-body");
$("#sheet-close").addEventListener("click", () => $("#sheet").close());

$("#btn-write").addEventListener("click", async () => {
  $("#sheet").showModal();
  $("#sheet-title").textContent = "Write PDFs and manifests";
  sheetBody().innerHTML = `<p class="muted">Checking every page…</p>`;
  await save();
  try {
    const plan = await api("POST", "/api/plan");
    showPlan(plan, true);
  } catch (e) {
    sheetBody().innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
});

function problemsHTML(list, cls) {
  return `<ul class="problems ${cls}">${list.map((x) => `<li>${x.piece && S.byId[x.piece] ? `${esc(label(S.byId[x.piece]))}: ` : ""}${esc(x.message)}${x.piece && S.byId[x.piece] ? `<button type="button" class="small" data-goto="${esc(x.piece)}">Show</button>` : ""}</li>`).join("")}</ul>`;
}

function targetHTML(t) {
  const exams = t.exams.map((e) => `<li>${{ add: "+ add", update: "~ update", kept: "= already there:" }[e.state]} <code>${esc(e.id)}</code> ${esc(e.name)}, ${esc(e.date)} (${esc(e.session)})</li>`).join("");
  const subs = t.subjects.map((s) => `<li>+ add subject <code>${esc(s.id)}</code> ${esc(s.name)}${s.aliases.length ? ` (also: ${s.aliases.map(esc).join(", ")})` : ""}</li>`).join("");
  const files = t.files.map((f) => `<li><code>${esc(f.file)}</code> → <code>${esc(f.exam)}</code> (${esc(f.exam_name)}), ${f.pages.length} page${f.pages.length > 1 ? "s" : ""}${f.exists ? " <span class='muted'>(rewrites the desk's earlier copy)</span>" : ""}
      <ul>${f.pages.map((p) => `<li class="small">p${p.page}: ${esc(subjectName(t.course, t.semester, p.subject))}${p.continues ? " (continued)" : ""} <span class="muted">← ${esc(p.label)}</span></li>`).join("")}</ul></li>`).join("");
  const removed = t.remove.map((r) => `<li class="warn">− delete <code>${esc(r)}</code> (the desk wrote it before; no page goes there now)</li>`).join("");
  const held = t.held.map((h) => `<li class="warn small">${esc(h)}</li>`).join("");
  return `<div class="target"><b>${esc(t.course_name)}, Semester ${t.semester}</b> · <code>${esc(t.manifest)}</code> ${t.exists ? "" : `<span class="ok">(new manifest)</span>`}
    ${exams ? `<h3>Exams</h3><ul>${exams}</ul>` : ""}${subs ? `<h3>Subjects</h3><ul>${subs}</ul>` : ""}
    ${files || removed ? `<h3>PDFs</h3><ul>${files}${removed}</ul>` : ""}
    ${held ? `<h3>Held back (noted at the top of the manifest)</h3><ul>${held}</ul>` : ""}</div>`;
}

function showPlan(plan, canWrite) {
  S.problems = Object.fromEntries(plan.errors.filter((x) => x.piece).map((x) => [x.piece, x.message]));
  refresh();
  const nFiles = plan.targets.reduce((n, t) => n + t.files.length, 0);
  sheetBody().innerHTML = `
    ${plan.errors.length ? `<h3 class="error">Fix these first (${plan.errors.length})</h3>${problemsHTML(plan.errors, "error")}` : ""}
    ${plan.warnings.length ? `<h3 class="warn">Check these (${plan.warnings.length})</h3>${problemsHTML(plan.warnings, "warn")}` : ""}
    ${plan.targets.length ? plan.targets.map(targetHTML).join("") : `<p class="muted">Nothing to write yet: mark pages Use or Held back.</p>`}
    ${canWrite ? `<div class="row end"><span class="muted small">PDFs are written in <code>data/raw/…/sem&lt;N&gt;/</code>; existing manifest lines are left as they are.</span>
      <button type="button" class="primary" id="do-write" ${plan.errors.length || !plan.targets.length ? "disabled" : ""}>Write ${nFiles} PDF${nFiles === 1 ? "" : "s"} and ${plan.targets.length} manifest${plan.targets.length === 1 ? "" : "s"}</button></div>` : ""}`;
}

$("#sheet").addEventListener("click", async (e) => {
  const go = e.target.closest("[data-goto]");
  if (go) {
    $("#sheet").close();
    return select([go.dataset.goto], go.dataset.goto);
  }
  if (e.target.id === "do-write") {
    e.target.disabled = true;
    sheetBody().insertAdjacentHTML("beforeend", `<p class="muted" id="writing">Writing… every page is rendered at full size, so a big folder takes a minute.</p>`);
    try {
      const r = await api("POST", "/api/write");
      if (!r.results.length) return showPlan(r.plan, true);
      showResults(r);
      S.written = r.written;
      S.writtenFresh = true;
      updateSteps();
      // Subjects and exams now live in the manifests: reload them.
      S.manifests = {};
      for (const p of S.pieces) ensureManifest(p.d.course, p.d.semester);
    } catch (err) {
      $("#writing").outerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }
  const run = e.target.closest("[data-run]");
  if (run) startRun(run.dataset.run);
});

function showResults(r) {
  $("#sheet-title").textContent = "Written";
  sheetBody().innerHTML = `${r.results.map((x) => `<div class="target">
      <div class="row"><b>${x.ok ? `<span class="ok">✓ ready</span>` : `<span class="error">✗ not ready</span>`}</b> <code>${esc(x.manifest)}</code><span class="grow"></span>
      ${x.ok ? `<button type="button" data-run="${esc(x.manifest)}">Run the pipeline</button>` : ""}</div>
      <pre class="log">${esc(x.check)}</pre></div>`).join("")}
    ${r.plan.warnings.length ? `<h3 class="warn">Notes</h3>${problemsHTML(r.plan.warnings, "warn")}` : ""}
    <div id="run"></div>
    <p class="muted small">"Run the pipeline" calls the model with the key in <code>.env</code> (about 8 calls per page; answers already received are cached in <code>data/work/cache</code>, so running again is cheap).</p>`;
}

async function startRun(manifest) {
  if (!(await ask("Run the pipeline?", `On ${manifest}. It calls the model with the API key in .env: about 8 calls per page. Answers already received are cached, so only new pages cost calls.`, "Run it"))) return;
  try {
    await api("POST", "/api/run", { manifest });
  } catch (e) {
    return toast(e.message, true);
  }
  S.run = { next: 0, text: "", last: null };
  for (const b of document.querySelectorAll("[data-run]")) b.disabled = true;
  updateSteps();
  pollRun();
}

async function pollRun() {
  let r;
  try {
    r = await api("GET", `/api/run?from=${S.run.next}`);
  } catch (e) {
    const box = $("#run");
    if (box) box.insertAdjacentHTML("beforeend", `<p class="error">${esc(e.message)}</p>`);
    return;
  }
  S.run.next = r.next;
  S.run.text += r.lines.map((l) => l + "\n").join("");
  S.run.last = r;
  renderRun();
  if (!r.done) setTimeout(pollRun, 800);
  else refresh(false);
}

/** The run's log and report, in the sheet when it is open. */
function renderRun() {
  const box = $("#run"), r = S.run && S.run.last;
  if (!box || !r) return;
  box.innerHTML = `<h3>Pipeline: <code>${esc(r.manifest)}</code> ${r.done ? (r.code === 0 ? `<span class="ok">finished</span>` : `<span class="error">stopped with an error (exit ${r.code})</span>`) : "running…"}</h3><pre class="log" id="run-log">${esc(S.run.text)}</pre>${r.done ? reportHTML(r.report) : ""}`;
  const log = $("#run-log");
  log.scrollTop = log.scrollHeight;
}

function showRunSheet() {
  if (!$("#sheet").open) $("#sheet").showModal();
  $("#sheet-title").textContent = "Run the pipeline";
  const running = S.run && !(S.run.last && S.run.last.done);
  sheetBody().innerHTML = S.written.length
    ? `<p class="muted">The pipeline reads the PDFs of a manifest and builds the pack the site shows. It calls the model with the API key in <code>.env</code>: about 8 calls per page; answers already received are cached in <code>data/work/cache</code>, so running again is cheap.</p>
      ${S.written.map((m) => `<div class="target row"><code>${esc(m)}</code><span class="grow"></span><button type="button" class="primary small" data-run="${esc(m)}" ${running ? "disabled" : ""}>Run the pipeline</button></div>`).join("")}<div id="run"></div>`
    : `<p class="muted">Nothing is written yet: write the PDFs and manifests first (step 4).</p>`;
  renderRun();
}

function reportHTML(rep) {
  if (!rep) return `<p class="muted">No run report was written (see the log above).</p>`;
  const rows = rep.unsure.map((u) => `<tr><td><code>${esc(u.page_ref)}</code></td><td>${esc(u.step)}</td><td>${esc(u.error)}</td><td>${esc(typeof u.raw === "string" ? u.raw : JSON.stringify(u.raw))}</td></tr>`).join("");
  return `<p>Run report: <code>${esc(rep.path)}</code> · ${rep.papers} papers · ${rep.questions} questions kept · ${rep.dropped} dropped as bleed-through · ${rep.disagreements} disagreements with the manifest</p>
    <h3>Unsure (${rep.unsure.length}): not on the site</h3>
    ${rep.unsure.length ? `<table><tr><th>Page</th><th>Step</th><th>Problem</th><th>Raw</th></tr>${rows}</table>` : `<p class="ok">None.</p>`}`;
}

// ------------------------------------------------------------------ start

(async () => {
  let st;
  try {
    st = await api("GET", "/api/start");
  } catch {
    return; // opened straight from disk, or the desk is not running: the page says what to do
  }
  S.ping = setInterval(ping, 60000);
  if (st.folder) {
    try {
      return load(await api("GET", "/api/folder"));
    } catch (e) {
      toast(e.message, true);
    }
  }
  showStart(st);
})();
