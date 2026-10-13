/**
 * cocode.js — the code window you talk through (the `cocode` unique for lets).
 *
 * The human types in any language; Claude predicts the next lines as a ghost
 * (`cocode.suggest`), prepares the real program in the background
 * (`cocode.build`) so Run is instant, runs it (`cocode.run` → `cocode.output`),
 * and reads what they send as a message written in code (`cocode.ask`,
 * `cocode.export`). Contract: CONTRACT.md. Everything non-cocode (companion,
 * chat, components, toasts) is the shell's job (/sdk/lets-shell.js); this file
 * only plugs into it.
 *
 *   1. constants & helpers      6. ghost & local predictor
 *   2. boot                     7. build & output panes
 *   3. state                    8. outgoing events (changed, run, ask, send)
 *   4. language chip            9. incoming commands
 *   5. seeds & empty state     10. companion, chrome, keyboard, start-up
 */

import { Lets } from '/sdk/lets-client.js';
import { createEditor } from './editor.js';
import { detect, cleanLang, commentMarker, tokenizeAll } from './syntax.js';
import { predict } from './predict.js';

// ───────────────────────────── 1. constants & helpers ─────────────────────────────

const VERSION = '0.1.0';
const CAPS = ['entity', 'chat', 'components', 'clipboard'];
const CHANGED_MS = 500;
const LOCAL_MS = 250;
const AWAY_EVERY = 30000;
const TEXT_MAX = 64000;
const RUNS_MAX = 10;
const RECENTS_MAX = 10;
const SEEDS_MAX = 6;
const LOST_MS = 60000;
const RESUME_WINDOW = 8000;
const TAIL = 2000;
const PREFS_KEY = 'lets.cocode';
const DRAFT_KEY = 'lets.cocode.draft';
const TARGETS = ['auto', 'python', 'javascript', 'typescript', 'bash', 'go', 'rust'];
const INTENTS = ['auto', 'ask', 'explain', 'do', 'fix', 'review', 'note'];
const KINDS = ['note', 'ok', 'warn', 'error'];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const NARROW = matchMedia('(max-width: 1100px)');

const $ = (id) => document.getElementById(id);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = null) => (Number.isFinite(+v) ? Math.floor(+v) : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isEditable = (el) => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|file|color|image)$/i.test(el.type)));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const preview = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const tail = (s, n) => { const t = String(s ?? ''); return t.length > n ? `…${t.slice(-n)}` : t; };
const validColor = (c) => typeof c === 'string' && c.length < 64 && CSS.supports('color', c);

/** Creates an element. attrs: class, text, on<event> functions; anything else is an attribute. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false && kid !== '') el.append(kid);
  return el;
}

/** Trailing debounce with `.flush()` and `.cancel()`. */
function debounce(fn, ms) {
  let t = 0;
  const d = () => { clearTimeout(t); t = setTimeout(() => { t = 0; fn(); }, ms); };
  d.flush = () => { if (t) { clearTimeout(t); t = 0; fn(); } };
  d.cancel = () => { clearTimeout(t); t = 0; };
  return d;
}

/** Highlighted code into `pre` (no innerHTML). */
function fillCode(pre, code, lang) {
  pre.textContent = '';
  const lines = String(code ?? '').split('\n');
  const toks = tokenizeAll(lines, lang);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i++) {
    for (const t of toks[i].tokens) { const s = document.createElement('span'); s.className = `t-${t.t}`; s.textContent = t.s; frag.appendChild(s); }
    if (i < lines.length - 1) frag.appendChild(document.createTextNode('\n'));
  }
  pre.appendChild(frag);
}

// ───────────────────────────── 2. boot ─────────────────────────────

let ShellApi = null;
try {
  const mod = await import('/sdk/lets-shell.js');
  ShellApi = mod.Shell || mod.default || null;
} catch (err) {
  console.warn('[cocode] /sdk/lets-shell.js unavailable — running without the shell:', err?.message || err);
}

const lets = Lets.connect({ unique: 'cocode', version: VERSION, caps: CAPS });
const bootAt = performance.now();

const app = $('app');
const statusDot = $('status-dot');
const langChip = $('lang-chip');
const langName = $('lang-name');
const langMode = $('lang-mode');
const langForm = $('lang-form');
const langInput = $('lang-input');
const btnSuggest = $('btn-suggest');
const btnRun = $('btn-run');
const btnAsk = $('btn-ask');
const btnSend = $('btn-send');
const intentSel = $('intent');
const btnUndo = $('btn-undo');
const btnRedo = $('btn-redo');
const btnBuild = $('btn-build');
const btnOutput = $('btn-output');
const btnHelp = $('btn-help');
const askForm = $('ask');
const askInput = $('ask-input');
const askAbout = $('ask-about');
const emptyEl = $('empty');
const seedsEl = $('seeds');
const notePop = $('note-pop');
const helpEl = $('help');
const rail = $('rail');
const tabBuild = $('tab-build');
const tabOutput = $('tab-output');
const paneBuild = $('pane-build');
const paneOutput = $('pane-output');
const buildPill = $('build-pill');
const buildMeta = $('build-meta');
const buildCode = $('build-code');
const buildNotes = $('build-notes');
const buildEmpty = $('build-empty');
const targetSel = $('target');
const btnPrepare = $('btn-prepare');
const btnCopy = $('btn-copy');
const runPill = $('run-pill');
const runsEl = $('runs');
const runsEmpty = $('runs-empty');
const notesEl = $('notes');
const notesList = $('notes-list');
const btnClearRuns = $('btn-clear-runs');
const stPos = $('st-pos');
const stLines = $('st-lines');
const stRev = $('st-rev');
const stGhost = $('st-ghost');
const stBuild = $('st-build');
const srLive = $('sr-live');
const dToast = $('d-toast');

// ───────────────────────────── 3. state ─────────────────────────────

/** @type {{name:string, detected:boolean}} */
const L = { name: 'pseudo', detected: true };
/** @type {null|{rev:number, lang:string, code:string, status:string, file:string|null, notes:string|null, at:number}} */
let build = null;
/** @type {Array<{id:string, rev:number, buildRev:number|null, lang:string, at:number, status:string, stdout:string, stderr:string, system:string, exit:number|null, ms:number|null, lost:number}>} */
const runs = [];
/** @type {Map<number, {kind:string, text:string}>} */
const annotations = new Map();
const stats = { accepted: 0, rejected: 0, acceptedLocal: 0 };
let seeds = [];
let emptyDismissed = false;
const revPrefix = new Map();
const ghostStreams = new Map();
let buildStream = null;
let runSeq = 0;
let acceptStreak = 0;
let lastAway = 0;
let changedBy = null;
let loadedAt = 0;
let announceGhost = true;

let prefs = { rail: 'open', build: true, output: true, tab: 'build', tabFocus: false };
try { const raw = localStorage.getItem(PREFS_KEY); if (raw) { const p = JSON.parse(raw); if (isObj(p)) prefs = { ...prefs, ...p }; } } catch { /* storage unavailable */ }
let recents = Array.isArray(prefs.recents) ? prefs.recents.filter((r) => isObj(r) && typeof r.text === 'string') : [];
delete prefs.recents;
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, recents })); } catch { /* ignore */ } }
function saveDraft() { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text: ed.text.slice(0, 1000000), lang: L.name, detected: L.detected, at: Date.now() })); } catch { /* ignore */ } }

// ───────────────────────────── 4. language chip ─────────────────────────────

function showLang() {
  langName.textContent = L.name;
  langMode.textContent = L.detected ? 'detected' : 'set';
  langChip.setAttribute('aria-label', `Language: ${L.name}, ${L.detected ? 'detected' : 'set by you'}. Press Enter to set it.`);
  langChip.dataset.detected = String(L.detected);
}
function setLang(name, detected) {
  const clean = cleanLang(name);
  if (!clean) { L.detected = true; redetect(true); return; }
  if (L.name === clean && L.detected === detected) return;
  L.name = clean;
  L.detected = detected;
  showLang();
  ed.render();
  renderBuild();
}
let lastDetect = '';
function redetect(force) {
  if (!L.detected) return;
  const t = ed.text;
  if (!force && t === lastDetect) return;
  lastDetect = t;
  const r = detect(t);
  if (r.lang !== L.name) { L.name = r.lang; showLang(); ed.render(); }
}
function openLangForm() {
  langForm.hidden = false;
  langInput.value = L.detected ? '' : L.name;
  langInput.placeholder = L.detected ? `${L.name} (detected) · type a name` : 'empty = detect';
  langChip.hidden = true;
  langInput.focus();
}
function closeLangForm() {
  if (langForm.hidden) return;
  langForm.hidden = true;
  langChip.hidden = false;
  langChip.focus({ preventScroll: true });
}
langChip.addEventListener('click', openLangForm);
langForm.addEventListener('submit', (e) => { e.preventDefault(); const v = langInput.value.trim(); if (v) setLang(v, false); else { L.detected = true; lastDetect = ''; redetect(true); showLang(); } langForm.hidden = true; langChip.hidden = false; ed.focus(); });
langInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLangForm(); } });
langInput.addEventListener('blur', () => { if (!langForm.hidden) { langForm.hidden = true; langChip.hidden = false; } });

// ───────────────────────────── 5. seeds & empty state ─────────────────────────────

function renderSeeds() {
  const empty = ed.text === '';
  emptyEl.hidden = !empty || emptyDismissed;
  if (emptyEl.hidden) return;
  seedsEl.textContent = '';
  const seen = new Set();
  const items = [];
  for (const s of seeds) if (!seen.has(s.text)) { seen.add(s.text); items.push({ ...s, from: 'claude' }); }
  for (const r of recents) if (!seen.has(r.text)) { seen.add(r.text); items.push({ id: `recent-${r.at}`, label: r.label, text: r.text, lang: r.lang, hint: 'recent', from: 'local' }); }
  if (!items.length) {
    seedsEl.append(h('p', { class: 'seeds-none lets-dim' }, 'Nothing to start from yet. Doto brings starting points from memory once Claude is listening.'));
    return;
  }
  for (const it of items.slice(0, SEEDS_MAX + RECENTS_MAX)) {
    const lines = String(it.text).split('\n').filter((l) => l.trim()).slice(0, 2);
    seedsEl.append(h('button', { type: 'button', class: 'seed', role: 'listitem', 'data-from': it.from, onclick: () => pickSeed(it) },
      h('span', { class: 'seed-head' }, h('span', { class: 'seed-label', text: it.label || preview(it.text, 48) }), it.lang ? h('span', { class: 'badge', text: it.lang }) : null, it.hint ? h('span', { class: 'seed-hint lets-dim', text: it.hint }) : null),
      h('span', { class: 'seed-prev', text: lines.join('\n') || ' ' })));
  }
}
function pickSeed(it) {
  if (it.lang) setLang(it.lang, false);
  ed.setAll(it.text, 'human', { kind: 'seed' });
  ed.setCursor({ line: ed.lines, col: ed.lineText(ed.lines).length });
  ed.focus();
}

// ───────────────────────────── 6. ghost & local predictor ─────────────────────────────

function currentPrefix() {
  const c = ed.getCursor();
  return ed.lineText(c.line).slice(0, c.col).slice(-200);
}

const localGhost = debounce(() => {
  const g = ed.ghost;
  if (g && g.source === 'claude') return;
  if (document.activeElement !== $('code')) return;
  const p = predict(ed.text, ed.getCursor(), L.name);
  if (!p) { if (g && g.source === 'local') ed.clearGhost(null); return; }
  if (g && g.source === 'local' && g.text === p.text) return;
  ed.showGhost({ text: p.text, source: 'local', rev: ed.rev });
}, LOCAL_MS);

function onGhost(evt) {
  if (evt.type === 'show') {
    if (evt.source === 'claude' && announceGhost) srLive.textContent = `Suggestion: ${preview(evt.text, 120)}`;
    announceGhost = true;
  } else if (evt.type === 'accept') {
    stats.accepted++;
    if (evt.source === 'local') stats.acceptedLocal++;
    acceptStreak++;
    lets.emit('cocode.ghost.accept', { rev: evt.rev ?? ed.rev, source: evt.source, text: evt.text, partial: !!evt.partial });
    react(acceptStreak >= 3 ? 'sparkle' : 'wink');
    if (acceptStreak >= 3) acceptStreak = 0;
  } else if (evt.type === 'reject') {
    if (evt.source === 'claude') {
      stats.rejected++;
      acceptStreak = 0;
      lets.emit('cocode.ghost.reject', { rev: evt.rev ?? ed.rev, source: evt.source, reason: evt.reason });
    }
  }
  updateStatus();
}

function requestGhost(source) {
  if (lets.status !== 'open') { toast('Not connected to the lets host.', 'warn'); return; }
  lets.emitNow('cocode.ghost.request', { rev: ed.rev, text: ed.text.slice(0, TEXT_MAX), lang: L.name, cursor: ed.getCursor(), prefix: currentPrefix(), source });
  awayToast('Doto is away. Claude suggests with your next message in Claude Code.');
}

// ───────────────────────────── 7. build & output panes ─────────────────────────────

function buildState() {
  if (!build) return 'none';
  if (build.status === 'building' || build.status === 'failed') return build.status;
  return build.rev < ed.rev ? 'stale' : 'ready';
}
function renderBuild() {
  const st = buildState();
  buildPill.dataset.state = st;
  buildPill.textContent = st === 'none' ? '—' : st === 'ready' ? `ready · rev ${build.rev}` : st === 'stale' ? `stale · rev ${build.rev}` : st === 'building' ? 'building…' : 'failed';
  buildEmpty.hidden = !!build;
  buildMeta.hidden = !build;
  buildCode.hidden = !build || !build.code;
  buildNotes.hidden = !build || !build.notes;
  btnCopy.disabled = !build || !build.code;
  if (!build) return;
  buildMeta.textContent = '';
  buildMeta.append(h('span', { class: 'badge', text: build.lang }), ` · rev ${build.rev}`, build.file ? h('span', null, ' · ', h('code', { text: build.file })) : '', st === 'stale' ? ` · the editor is at rev ${ed.rev}` : '');
  if (build.code) fillCode(buildCode, build.code, build.lang);
  buildCode.classList.toggle('stale', st === 'stale');
  if (build.notes) buildNotes.textContent = build.notes;
  updateStatus();
}

function renderRuns() {
  runsEmpty.hidden = runs.length > 0;
  runsEl.textContent = '';
  const open = runs.filter((r) => r.status === 'running').length;
  const last = runs[runs.length - 1];
  runPill.dataset.state = open ? 'running' : last ? (last.status === 'done' ? 'ok' : last.status === 'lost' ? 'lost' : 'failed') : 'none';
  runPill.textContent = open ? `running · ${open}` : last ? (last.status === 'done' ? `ok · exit 0` : last.status === 'lost' ? 'no answer yet' : last.status === 'failed' ? `failed · exit ${last.exit ?? '?'}` : last.status) : '—';
  for (const r of [...runs].reverse()) runsEl.append(runArticle(r));
  updateStatus();
}
function runOutput(r) {
  const pre = h('pre', { class: 'lets-pre run-out' });
  if (r.system) pre.append(h('span', { class: 'out-sys', text: r.system }));
  if (r.stdout) pre.append(h('span', { class: 'out-std', text: r.stdout }));
  if (r.stderr) pre.append(h('span', { class: 'out-err', text: r.stderr }));
  if (!r.system && !r.stdout && !r.stderr) pre.append(h('span', { class: 'out-sys lets-dim', text: r.status === 'running' ? 'waiting for output…' : r.status === 'lost' ? 'no answer yet' : '(no output)' }));
  return pre;
}
function runArticle(r) {
  return h('article', { class: 'run', 'data-status': r.status, 'data-run': r.id, 'aria-label': `Run ${r.id}` },
    h('header', { class: 'run-head' },
      h('span', { class: 'run-id', text: r.id }),
      h('span', { class: 'badge', text: r.lang }),
      h('span', { class: 'lets-dim', text: `rev ${r.rev}${r.buildRev != null && r.buildRev !== r.rev ? ` · build ${r.buildRev}` : ''}` }),
      h('span', { class: 'pill', 'data-state': r.status === 'done' ? 'ok' : r.status === 'running' ? 'running' : r.status, text: r.status === 'running' ? 'running…' : r.status === 'done' ? `exit ${r.exit ?? 0}` : r.status === 'failed' ? `exit ${r.exit ?? '?'}` : r.status }),
      r.ms != null ? h('span', { class: 'lets-dim', text: `${r.ms} ms` }) : null),
    runOutput(r));
}
/** Update one run in place (a streamed chunk): keeps the pane's scroll and the other entries untouched. */
function renderRun(r) {
  const el = runsEl.querySelector(`[data-run="${CSS.escape(r.id)}"]`);
  if (!el) { renderRuns(); return; }
  el.dataset.status = r.status;
  const pre = el.querySelector('.run-out');
  const stick = pre && pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  const next = runOutput(r);
  if (pre) pre.replaceWith(next); else el.append(next);
  if (stick) next.scrollTop = next.scrollHeight;
  const pill = el.querySelector('.pill');
  if (pill) { pill.dataset.state = r.status === 'done' ? 'ok' : r.status; pill.textContent = r.status === 'running' ? 'running…' : r.status === 'lost' ? 'lost' : pill.textContent; }
  updateStatus();
}
/** (Re)arm the 60 s "no answer yet" timer of a running run. */
function armLost(r) {
  clearTimeout(r.lost);
  r.lost = setTimeout(() => { if (r.status === 'running') { r.status = 'lost'; renderRuns(); } }, LOST_MS);
}

function renderNotes() {
  notesList.textContent = '';
  const list = [...annotations.entries()].sort((a, b) => a[0] - b[0]);
  notesEl.hidden = list.length === 0;
  for (const [line, a] of list) {
    notesList.append(h('li', { 'data-kind': a.kind },
      h('button', { type: 'button', class: 'note-line', onclick: () => ed.scrollToLine(line) }, `line ${line}`),
      h('span', { class: 'badge', text: a.kind }), ' ', h('span', { text: a.text })));
  }
  ed.setMarkers(new Map([...annotations.entries()].map(([k, v]) => [k, v.kind])));
}

function findRun(id) { return runs.find((r) => r.id === id) || null; }
function finishRun(r, status, exit, ms) {
  clearTimeout(r.lost);
  r.status = status;
  if (exit != null) r.exit = exit;
  if (ms != null) r.ms = ms;
}

function layoutIsDrawer() { return NARROW.matches; }
function applyPanes() {
  app.dataset.rail = prefs.rail;
  btnBuild.setAttribute('aria-pressed', String(prefs.rail === 'open' && prefs.build));
  btnOutput.setAttribute('aria-pressed', String(prefs.rail === 'open' && prefs.output));
  for (const [pane, on] of [[paneBuild, prefs.build], [paneOutput, prefs.output]]) {
    pane.querySelector('.pane-toggle').setAttribute('aria-expanded', String(on));
    pane.querySelector('.pane-body').hidden = !on;
    pane.dataset.open = String(on);
  }
  tabBuild.setAttribute('aria-selected', String(prefs.tab === 'build'));
  tabOutput.setAttribute('aria-selected', String(prefs.tab === 'output'));
  rail.dataset.tab = prefs.tab;
  savePrefs();
}
/** Toggle a pane; opens the rail when it was closed, closes it when both panes end up collapsed. */
function togglePane(name, force) {
  const key = name === 'build' ? 'build' : 'output';
  if (prefs.rail === 'closed') { prefs.rail = 'open'; prefs[key] = true; prefs.tab = name; }
  else if (layoutIsDrawer()) {
    if (prefs.tab === name && force !== true) prefs.rail = 'closed'; else { prefs.tab = name; prefs[key] = true; }
  } else {
    prefs[key] = force == null ? !prefs[key] : !!force;
    if (!prefs.build && !prefs.output) prefs.rail = 'closed';
    prefs.tab = name;
  }
  applyPanes();
}
function openPane(name) { if (prefs.rail === 'closed' || (layoutIsDrawer() ? prefs.tab !== name : !prefs[name])) togglePane(name, true); }

btnCopy.addEventListener('click', async () => {
  if (!build?.code) return;
  try { await navigator.clipboard.writeText(build.code); toast('Copied.', 'ok', 1600); } catch { toast('Could not copy. Select the code and copy it by hand.', 'warn'); }
});
btnPrepare.addEventListener('click', () => requestBuild(targetSel.value));
targetSel.addEventListener('change', () => {
  if (targetSel.value === 'other') {
    const v = cleanLang(prompt('Target language', '') || '');
    if (!v || v === 'other') { targetSel.value = 'auto'; return; }          // cancelled or empty: no request
    if (!TARGETS.includes(v)) { if (![...targetSel.options].some((o) => o.value === v)) targetSel.append(h('option', { value: v, text: v })); }
    targetSel.value = v;
  }
  requestBuild(targetSel.value);
});
btnClearRuns.addEventListener('click', () => { for (let i = runs.length - 1; i >= 0; i--) if (runs[i].status !== 'running') runs.splice(i, 1); renderRuns(); });
for (const pane of [paneBuild, paneOutput]) pane.querySelector('.pane-toggle').addEventListener('click', () => togglePane(pane.dataset.pane));
tabBuild.addEventListener('click', () => { prefs.tab = 'build'; prefs.build = true; prefs.rail = 'open'; applyPanes(); });
tabOutput.addEventListener('click', () => { prefs.tab = 'output'; prefs.output = true; prefs.rail = 'open'; applyPanes(); });

function requestBuild(target) {
  if (lets.status !== 'open') { toast('Not connected to the lets host.', 'warn'); return; }
  const t = cleanLang(target) || 'auto';
  lets.emitNow('cocode.build.request', { rev: ed.rev, text: ed.text.slice(0, TEXT_MAX), lang: L.name, target: t });
  openPane('build');
  awayToast('Doto is away. Claude prepares it with your next message in Claude Code.');
}

// ───────────────────────────── 8. outgoing events ─────────────────────────────

const emitChanged = debounce(() => {
  const by = changedBy || 'human';
  changedBy = null;
  const text = ed.text;
  const cursor = ed.getCursor();
  const prefix = currentPrefix();
  revPrefix.set(ed.rev, prefix);
  if (revPrefix.size > 40) revPrefix.delete(revPrefix.keys().next().value);
  const payload = { rev: ed.rev, text: text.length > TEXT_MAX ? text.slice(-TEXT_MAX) : text, lang: L.name, detected: L.detected, cursor, selection: ed.getSelection(), lines: ed.lines, prefix, by };
  if (text.length > TEXT_MAX) payload.truncated = true;
  if (pendingDelta) payload.delta = pendingDelta;
  pendingDelta = null;
  lets.emit('cocode.changed', payload);
}, CHANGED_MS);
let pendingDelta = null;

function onChange({ delta, source }) {
  const by = source === 'claude' ? 'claude' : source === 'restore' ? 'restore' : 'human';
  changedBy = changedBy === 'human' ? 'human' : by;
  // several changes inside one debounce window: keep the merged line range, drop the text (it would describe the wrong span)
  if (delta) pendingDelta = pendingDelta ? { from: Math.min(pendingDelta.from, delta.from), to: Math.max(pendingDelta.to, delta.to) } : delta;
  emitChanged();
  if (by === 'human') localGhost();
  redetect(false);
  renderSeeds();
  renderBuild();
  updateStatus();
  saveDraft();
  btnUndo.disabled = !ed.canUndo;
  btnRedo.disabled = !ed.canRedo;
}
function snapshotPayload(withIntent) {
  const text = ed.text;
  const first = text.split('\n').find((l) => l.trim()) || '';
  const out = {
    label: `${preview(first, 60) || 'empty'} · ${L.name}`,
    ...(withIntent ? { intent: INTENTS.includes(intentSel.value) ? intentSel.value : 'auto' } : {}),
    text: text.length > TEXT_MAX ? text.slice(-TEXT_MAX) : text,
    ...(text.length > TEXT_MAX ? { truncated: true } : {}),
    lang: L.name, detected: L.detected, rev: ed.rev, cursor: ed.getCursor(), selection: ed.getSelection(),
    stats: { ...stats },
  };
  if (build) out.build = { rev: build.rev, lang: build.lang, code: build.code, status: build.status, file: build.file || undefined, notes: build.notes || undefined };
  if (runs.length) out.runs = runs.slice(-3).map((r) => ({ id: r.id, rev: r.rev, buildRev: r.buildRev, lang: r.lang, at: r.at, ms: r.ms, exit: r.exit, status: r.status, stdout: tail(r.stdout, TAIL), stderr: tail(r.stderr, TAIL) }));
  if (annotations.size) out.annotations = [...annotations.entries()].sort((a, b) => a[0] - b[0]).map(([line, a]) => ({ line, kind: a.kind, text: a.text }));
  return out;
}

function doRun() {
  if (lets.status !== 'open') { toast('Not connected to the lets host. Nothing can run.', 'warn', 4000); return; }
  if (!ed.text.trim()) { toast('Nothing to run yet.', 'info', 1800); return; }
  emitChanged.flush();
  const id = `r_${ed.rev}_${++runSeq}`;
  const r = { id, rev: ed.rev, buildRev: build ? build.rev : null, lang: build?.lang || L.name, at: Date.now(), status: 'running', stdout: '', stderr: '', system: '', exit: null, ms: null, lost: 0 };
  armLost(r);
  runs.push(r);
  while (runs.length > RUNS_MAX) { const i = runs.findIndex((x) => x.status !== 'running'); if (i < 0) break; runs.splice(i, 1); }
  renderRuns();
  openPane('output');
  const payload = { run: id, rev: ed.rev, text: ed.text.slice(0, TEXT_MAX), lang: L.name };
  if (build) payload.build = { rev: build.rev, lang: build.lang, code: build.code, status: build.status };
  lets.emitNow('cocode.run', payload);
  recordRecent();
  awayToast('Doto is away. The run starts with your next message in Claude Code.');
}

function aboutText() {
  const sel = ed.getSelection();
  if (sel && sel.from.line !== sel.to.line) return `lines ${sel.from.line}–${sel.to.line}`;
  return `line ${ed.getCursor().line}`;
}
function openAsk() {
  askForm.hidden = false;
  btnAsk.setAttribute('aria-expanded', 'true');
  askAbout.textContent = aboutText();
  askInput.focus();
}
function closeAsk() {
  if (askForm.hidden) return;
  askForm.hidden = true;
  btnAsk.setAttribute('aria-expanded', 'false');
  ed.focus();
}
function sendAsk(question, source) {
  const q = String(question || '').trim().slice(0, 500);
  if (!q) return;
  if (lets.status !== 'open') { toast('Not connected to the lets host.', 'warn'); return; }
  emitChanged.flush();
  const payload = { question: q, rev: ed.rev, text: ed.text.slice(0, TEXT_MAX), lang: L.name, line: ed.getCursor().line, selection: ed.getSelection(), source };
  lets.emitNow('cocode.ask', payload);
  try { shell.chat?.append?.('you', q); shell.chat?.open?.(); } catch { /* optional */ }
  awayToast('Doto is away. Claude answers with your next message in Claude Code.');
}
askForm.addEventListener('submit', (e) => { e.preventDefault(); const q = askInput.value; askInput.value = ''; closeAsk(); sendAsk(q, 'toolbar'); });
askInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAsk(); } });

function sendToClaude() {
  if (!ed.text.trim()) { toast('Nothing to send yet.', 'info', 1800); return; }
  emitChanged.flush();
  lets.emitNow('cocode.export', snapshotPayload(true));
  recordRecent();
  if (lets.status !== 'open') { toast('Not connected to the lets host. The code is kept and sent when the connection is back.', 'warn', 4500); return; }
  toast('Sent to Claude.', 'ok', 2200);
  react('cheer');
  awayToast('Doto is away. Claude reads this with your next message in Claude Code.');
}

function recordRecent() {
  const text = ed.text.slice(0, 8000);
  if (!text.trim()) return;
  const first = text.split('\n').find((l) => l.trim()) || '';
  recents = [{ label: preview(first, 48), text, lang: L.name, at: Date.now() }, ...recents.filter((r) => r.text !== text)].slice(0, RECENTS_MAX);
  savePrefs();
}

// ───────────────────────────── 9. incoming commands ─────────────────────────────

const COMMANDS = {
  'cocode.suggest': (d, msg) => {
    const key = msg?.re || (d.rev != null ? `rev:${d.rev}` : 'one');
    const streaming = d.seq != null || d.done === false;
    let text = typeof d.text === 'string' ? d.text : '';
    if (streaming) {
      const s = ghostStreams.get(key) || { text: '', rev: d.rev ?? null };
      s.text += text;
      ghostStreams.set(key, s);
      text = s.text;
      if (d.done) ghostStreams.delete(key);
    } else ghostStreams.delete(key);                              // a whole ghost ends any partial stream under that key
    announceGhost = !streaming || !!d.done;                       // announce a streamed ghost once, when it is complete
    if (!text) { if (!streaming || d.done) ed.clearGhost(null); return; }
    const rev = int(d.rev);
    if (rev != null && rev !== ed.rev) {
      const old = revPrefix.get(rev);
      if (old == null || old !== currentPrefix()) return;        // stale: silence
    }
    const alternatives = Array.isArray(d.alternatives) ? d.alternatives.filter((x) => typeof x === 'string').slice(0, 5) : [];
    const at = isObj(d.at) && int(d.at.line) != null ? { line: int(d.at.line), col: int(d.at.col, 0) } : null;
    ed.showGhost({ text, source: 'claude', alternatives, rev: rev ?? ed.rev, at });
  },
  'cocode.seed': (d) => {
    if (!Array.isArray(d.items)) throw new Error('expected {items: [...]}');
    seeds = d.items.filter((it) => isObj(it) && typeof it.text === 'string' && it.text.trim()).slice(0, SEEDS_MAX)
      .map((it, i) => ({ id: String(it.id ?? `seed-${i}`), label: typeof it.label === 'string' ? it.label.slice(0, 80) : preview(it.text, 48), text: it.text.slice(0, TEXT_MAX), lang: cleanLang(it.lang) || null, hint: typeof it.hint === 'string' ? it.hint.slice(0, 60) : null }));
    emptyDismissed = false;
    renderSeeds();
  },
  'cocode.build': (d) => {
    const rev = int(d.rev);
    const lang = cleanLang(d.lang);
    if (rev == null || !lang) throw new Error('expected {rev, lang, code, status?}');
    const status = ['building', 'ready', 'failed'].includes(d.status) ? d.status : 'ready';
    let code = typeof d.code === 'string' ? d.code : '';
    if (d.seq != null) {
      // a late chunk after the build for this rev was already closed is ignored, so it cannot replace a finished build
      if (!buildStream && build && build.rev === rev && build.status !== 'building') return;
      if (buildStream && buildStream.rev === rev) buildStream.code += code; else buildStream = { rev, code };
      code = buildStream.code;
      if (d.done) buildStream = null;
    } else buildStream = null;
    const was = build && build.rev === rev ? build.status : null;
    build = { rev, lang, code, status, file: typeof d.file === 'string' ? d.file.slice(0, 120) : null, notes: typeof d.notes === 'string' ? d.notes.slice(0, 2000) : null, at: Date.now() };
    renderBuild();
    if (status === 'ready' && was !== 'ready' && (d.seq == null || d.done)) react('nod');
    if (status === 'failed') openPane('build');
  },
  'cocode.output': (d) => {
    const id = String(d.run || '').slice(0, 60);
    if (!id) throw new Error('expected {run, stream, text}');
    let r = findRun(id);
    let created = false;
    if (!r) {
      // a run Claude named itself: same entry and the same 60 s "no answer yet" timer as a window-made run
      r = { id, rev: ed.rev, buildRev: null, lang: build?.lang || L.name, at: Date.now(), status: 'running', stdout: '', stderr: '', system: '', exit: null, ms: null, lost: 0 };
      armLost(r);
      runs.push(r);
      created = true;
    }
    if (r.status === 'lost') r.status = 'running';
    const stream = ['stdout', 'stderr', 'system'].includes(d.stream) ? d.stream : 'stdout';
    const text = typeof d.text === 'string' ? d.text : '';
    if (text) { r[stream] = (r[stream] + text).slice(-100000); armLost(r); }
    if (d.done) {
      const exit = int(d.exit, r.stderr ? 1 : 0);
      finishRun(r, exit === 0 ? 'done' : 'failed', exit, int(d.ms));
      react(exit === 0 ? 'cheer' : 'oops');
    }
    if (created || d.done) { renderRuns(); openPane('output'); } else renderRun(r);
  },
  'cocode.insert': (d) => {
    if (typeof d.text !== 'string') throw new Error('expected {at, text}');
    let at = d.at;
    if (isObj(at)) at = { line: int(at.line, 1), col: int(at.col, 0) };
    else if (at !== 'end') at = 'cursor';
    ed.insertAt(at, d.text, 'claude');
  },
  'cocode.replace': (d) => {
    const from = int(d.from);
    if (from == null || typeof d.text !== 'string') throw new Error('expected {from, to?, text}');
    ed.replaceLines(from, int(d.to, from), d.text, 'claude');
  },
  'cocode.set': (d) => {
    if (typeof d.text !== 'string') throw new Error('expected {text, lang?}');
    app.classList.add('swap');
    setTimeout(() => app.classList.remove('swap'), REDUCED.matches ? 0 : 320);
    ed.setAll(d.text, 'claude');
    if (d.lang) setLang(d.lang, false);
  },
  'cocode.lang': (d) => { const v = cleanLang(d.lang); if (!v) throw new Error('expected {lang}'); setLang(v, false); },
  'cocode.annotate': (d) => {
    const line = int(d.line);
    if (line == null || line < 0) throw new Error('expected {line, text, kind?}');
    if (line === 0) { annotations.clear(); renderNotes(); hideNote(); return; }
    if (line > ed.lines) throw new Error(`line ${line} is beyond the document (${ed.lines} lines)`);
    const text = typeof d.text === 'string' ? d.text.trim().slice(0, 1000) : '';
    if (!text) { annotations.delete(line); renderNotes(); hideNote(); return; }
    annotations.set(line, { kind: KINDS.includes(d.kind) ? d.kind : 'note', text });
    renderNotes();
    ed.glow(line, line, '', 1200, 'note');
  },
  'cocode.highlight': (d) => {
    const from = int(d.from);
    if (from == null || from < 0) throw new Error('expected {from, to?, color?, ttl?}');
    if (from === 0) { ed.clearGlows(); return; }
    ed.glow(from, int(d.to, from), validColor(d.color) ? d.color : '', d.ttl == null ? 4000 : Math.max(0, int(d.ttl, 4000)));
  },
  'cocode.focus': (d) => {
    const line = int(d.line);
    if (line == null) throw new Error('expected {line, col?}');
    ed.scrollToLine(clamp(line, 1, ed.lines), int(d.col, 0));   // out-of-range lines clamp, like insert and replace
    ed.focus();
  },
  'cocode.load': (d) => {
    if (typeof d.text !== 'string') throw new Error('expected {text, lang?, build?, runs?, annotations?, cursor?}');
    loadedAt = performance.now();
    const same = ed.text === d.text;
    ed.setAll(d.text, 'restore', { cursor: isObj(d.cursor) ? { line: int(d.cursor.line, 1), col: int(d.cursor.col, 0) } : null });
    if (same) { changedBy = 'restore'; emitChanged(); }           // the text did not change, but the restore still happened
    if (d.lang) setLang(d.lang, d.detected === true); else { L.detected = true; lastDetect = ''; redetect(true); showLang(); }
    build = null;
    // the saved build was made for the saved rev: re-base it on this window's rev (fresh if it matched, stale otherwise)
    if (isObj(d.build) && int(d.build.rev) != null && cleanLang(d.build.lang)) build = { rev: int(d.rev) == null || int(d.build.rev) === int(d.rev) ? ed.rev : ed.rev - 1, lang: cleanLang(d.build.lang), code: typeof d.build.code === 'string' ? d.build.code : '', status: ['building', 'ready', 'failed'].includes(d.build.status) ? d.build.status : 'ready', file: typeof d.build.file === 'string' ? d.build.file : null, notes: typeof d.build.notes === 'string' ? d.build.notes : null, at: Date.now() };
    runs.length = 0;
    if (Array.isArray(d.runs)) for (const r of d.runs.slice(-RUNS_MAX)) if (isObj(r) && r.id) runs.push({ id: String(r.id), rev: int(r.rev, 0), buildRev: int(r.buildRev), lang: cleanLang(r.lang) || 'pseudo', at: int(r.at, Date.now()), status: r.status === 'running' ? 'lost' : (['done', 'failed', 'lost'].includes(r.status) ? r.status : 'done'), stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), system: '', exit: int(r.exit), ms: int(r.ms), lost: 0 });
    annotations.clear();
    if (Array.isArray(d.annotations)) for (const a of d.annotations) if (isObj(a) && int(a.line) >= 1 && int(a.line) <= ed.lines && typeof a.text === 'string' && a.text.trim()) annotations.set(int(a.line), { kind: KINDS.includes(a.kind) ? a.kind : 'note', text: a.text.slice(0, 1000) });
    renderBuild();
    renderRuns();
    renderNotes();
    emptyDismissed = false;
    renderSeeds();
  },
  'cocode.snapshot': (_d, msg) => lets.emitNow('cocode.snapshot', snapshotPayload(false), msg?.id ? { re: msg.id } : undefined),
};

function runCommand(type, fn, data, msg) {
  try {
    fn(isObj(data) ? data : {}, msg);
  } catch (err) {
    const message = `${type}: ${err?.message || err}`;
    if (msg?.ack) throw new Error(message);
    lets.emit('lip.error', { code: 'bad_request', message, re: msg?.id });
    console.warn('[cocode]', message);
  }
}

// ───────────────────────────── 10. companion, chrome, keyboard, start-up ─────────────────────────────

let shell = { entity: null, chat: null, toast: null, listening: null };
let hasShell = false;

function react(name) { try { shell.entity?.react?.(name); } catch { /* optional */ } }
function toast(text, level = 'info', ttl = 3500) {
  if (hasShell && typeof shell.toast === 'function') { try { shell.toast(text, level, ttl); return; } catch { /* fall through */ } }
  dToast.textContent = text;
  dToast.dataset.level = level;
  dToast.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => dToast.classList.remove('on'), ttl);
}
function awayToast(text) {
  if (!hasShell || shell.listening !== false) return;
  const now = Date.now();
  if (now - lastAway < AWAY_EVERY) return;
  lastAway = now;
  toast(text, 'info', 4500);
}

function entityContext() {
  const c = ed.getCursor();
  const g = ed.ghost;
  const last = runs[runs.length - 1] || null;
  return {
    lang: L.name, rev: ed.rev, line: c.line, col: c.col, lineText: ed.lineText(c.line).slice(0, 200), selection: ed.getSelection(),
    hasGhost: !!g, ghostSource: g ? g.source : null, build: build ? { rev: build.rev, status: buildState(), lang: build.lang } : null,
    lastRun: last ? { id: last.id, exit: last.exit, status: last.status } : null, lines: ed.lines,
  };
}
const ran = new Map();
function once(id, fn) { const now = performance.now(); if (now - (ran.get(id) || -1e9) < 400) return; ran.set(id, now); fn(); }
function quickSuggestions() {
  const sel = ed.getSelection();
  return [
    { id: 'cocode.finish', label: 'Finish this', hint: 'a ghost at the caret', run: () => once('cocode.finish', () => requestGhost('menu')) },
    { id: 'cocode.explain', label: sel ? 'Explain the selection' : 'Explain this line', run: () => once('cocode.explain', () => sendAsk(sel ? 'Explain the selection' : `Explain line ${ed.getCursor().line}`, 'menu')) },
    { id: 'cocode.run', label: 'Run it', hint: 'Ctrl+Enter', run: () => once('cocode.run', doRun) },
    { id: 'cocode.build', label: 'Show the real code', run: () => once('cocode.build', () => { openPane('build'); if (!build) requestBuild('auto'); }) },
    { id: 'cocode.chat', label: 'Open chat', run: () => once('cocode.chat', () => { try { shell.chat?.open?.(); } catch { /* optional */ } }) },
  ];
}
function runPick(id) {
  const it = quickSuggestions().find((x) => x.id === id);
  if (it) it.run();
}

function updateStatus() {
  const c = ed.getCursor();
  stPos.textContent = `Ln ${c.line}, Col ${c.col}`;
  stLines.textContent = plural(ed.lines, 'line');
  stRev.textContent = String(ed.rev);
  const g = ed.ghost;
  stGhost.textContent = g ? (g.alts > 1 ? `${g.source} ${g.index + 1}/${g.alts}` : g.source) : '—';
  const st = buildState();
  stBuild.textContent = st === 'none' ? '—' : st === 'building' ? 'building' : st === 'failed' ? 'failed' : `${st} rev ${build.rev}`;
  stBuild.dataset.state = st;
  if (prefs.tabFocus) stGhost.parentElement.dataset.tabfocus = '1'; else delete stGhost.parentElement.dataset.tabfocus;
}

function showStatus(s) {
  statusDot.dataset.status = s;
  const text = s === 'open' ? 'Connected to Claude' : s === 'closed' ? 'Offline — everything local' : 'Connecting to Claude…';
  statusDot.setAttribute('aria-label', text);
  statusDot.parentElement.title = `cocode · ${text}`;
}

// note popover (annotations)
let noteTimer = 0;
function showNote(line) {
  const a = annotations.get(line);
  if (!a) return;
  clearTimeout(noteTimer);
  notePop.textContent = '';
  notePop.dataset.kind = a.kind;
  notePop.append(h('span', { class: 'badge', text: `line ${line} · ${a.kind}` }), h('p', { text: a.text }));
  notePop.hidden = false;
  const scroller = $('scroller');
  const y = ed.lineTop(line) - scroller.scrollTop + scroller.offsetTop + ed.metrics.lh + 2;
  notePop.style.top = `${clamp(y, 8, scroller.offsetTop + scroller.clientHeight - notePop.offsetHeight - 8)}px`;
  notePop.style.left = `${$('gutter').offsetWidth + 12}px`;
}
function hideNote() { notePop.hidden = true; }
$('gutter').addEventListener('click', (e) => { const g = e.target.closest('.gn'); if (!g) return; const line = Number(g.dataset.line); if (annotations.has(line)) { if (notePop.hidden) showNote(line); else hideNote(); } ed.setCursor({ line, col: 0 }); ed.focus(); });
$('gutter').addEventListener('mouseover', (e) => { const g = e.target.closest('.gn'); if (g && annotations.has(Number(g.dataset.line))) showNote(Number(g.dataset.line)); });
$('gutter').addEventListener('mouseleave', () => { noteTimer = setTimeout(hideNote, 900); });
notePop.addEventListener('mouseenter', () => clearTimeout(noteTimer));
notePop.addEventListener('mouseleave', () => { noteTimer = setTimeout(hideNote, 400); });

function toggleHelp(force) {
  const on = force == null ? helpEl.hidden : !!force;
  helpEl.hidden = !on;
  btnHelp.setAttribute('aria-expanded', String(on));
  if (on) helpEl.focus?.();
}
/** Esc: closes the innermost open thing. @returns {boolean} */
function closeOverlays() {
  if (!helpEl.hidden) { toggleHelp(false); btnHelp.focus({ preventScroll: true }); return true; }
  if (!askForm.hidden) { closeAsk(); return true; }
  if (!notePop.hidden) { hideNote(); return true; }
  if (!langForm.hidden) { closeLangForm(); return true; }
  if (!emptyEl.hidden) { emptyDismissed = true; renderSeeds(); ed.focus(); return true; }
  return false;
}

function onKeyDown(e) {
  if (e.defaultPrevented || e.isComposing) return;
  const t = e.target instanceof Element ? e.target : null;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { if (closeOverlays()) e.preventDefault(); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) sendToClaude(); else doRun(); return; }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openAsk(); return; }
  if (e.altKey && !mod && e.key === '\\') { e.preventDefault(); requestGhost('key'); return; }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); togglePane('build'); return; }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); togglePane('output'); return; }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'm' && t === $('code')) { e.preventDefault(); prefs.tabFocus = !prefs.tabFocus; ed.setTabFocus(prefs.tabFocus); savePrefs(); toast(prefs.tabFocus ? 'Tab now moves focus. Ctrl+M to put it back.' : 'Tab accepts and indents again.', 'info', 2200); updateStatus(); return; }
  if (isEditable(t) || mod || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); toggleHelp(); return; }
  if (e.key === '1') { e.preventDefault(); ed.focus(); return; }
  if (e.key === '2') { e.preventDefault(); openPane('output'); (runsEl.querySelector('.run') || paneOutput).focus?.(); paneOutput.scrollIntoView?.({ block: 'nearest' }); return; }
}

// ── editor ──

const ed = createEditor({
  textarea: $('code'), layer: $('layer'), gutter: $('gutter'), glows: $('glows'), curline: $('curline'), scroller: $('scroller'), surface: $('surface'), ghostBlock: $('ghost-block'),
  reduced: REDUCED.matches,
  lang: () => L.name,
  commentMarker: () => commentMarker(L.name),
  onChange, onCursor: updateStatus, onGhost,
  onAsk: (line, question) => { ed.setCursor({ line, col: ed.lineText(line).length }); sendAsk(question, 'inline'); },
  onStack: () => { btnUndo.disabled = !ed.canUndo; btnRedo.disabled = !ed.canRedo; },
});
ed.setTabFocus(prefs.tabFocus);

// ── start-up ──

if (ShellApi && typeof ShellApi.mount === 'function') {
  try {
    shell = ShellApi.mount(lets, { root: document.body, entity: { name: 'Doto' }, context: entityContext, quickSuggestions }) || shell;
    hasShell = true;
  } catch (err) {
    console.warn('[cocode] Shell.mount failed — running without the shell:', err?.message || err);
  }
}
if (hasShell) { try { shell.entity?.onPick?.((it) => runPick(it?.id)); } catch (err) { console.warn('[cocode] onPick', err); } }

for (const [type, fn] of Object.entries(COMMANDS)) lets.on(type, (data, msg) => runCommand(type, fn, data, msg));
lets.onStatus(showStatus);
showStatus(lets.status);

$('toolbar').addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
  if (!b || b.disabled) return;
  switch (b.dataset.act) {
    case 'suggest': requestGhost('toolbar'); break;
    case 'run': doRun(); break;
    case 'ask': if (askForm.hidden) openAsk(); else closeAsk(); break;
    case 'send': sendToClaude(); break;
    case 'undo': ed.undo(); ed.focus(); break;
    case 'redo': ed.redo(); ed.focus(); break;
    case 'build': togglePane('build'); break;
    case 'output': togglePane('output'); break;
    case 'chat': try { shell.chat?.toggle?.(true); } catch { /* optional */ } break;
    case 'entity': try { shell.entity?.toggle?.(); } catch { /* optional */ } break;
    case 'help': toggleHelp(); break;
    default: break;
  }
});
document.addEventListener('keydown', onKeyDown);
NARROW.addEventListener('change', applyPanes);
REDUCED.addEventListener('change', () => ed.setReduced(REDUCED.matches));
addEventListener('resize', () => ed.remeasure());

applyPanes();
showLang();

// a reload keeps the draft of this tab; a resume (cocode.load, queued by the engine before the window attaches) replaces it
try {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  const d = raw ? JSON.parse(raw) : null;
  if (d && typeof d.text === 'string' && d.text && !loadedAt) {
    ed.setAll(d.text, 'restore');
    if (d.lang && d.detected === false) setLang(d.lang, false); else { lastDetect = ''; redetect(true); }
  }
} catch { /* ignore */ }

renderSeeds();
renderBuild();
renderRuns();
renderNotes();
updateStatus();
ed.focus();
