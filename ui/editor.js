/**
 * editor.js — the cocode editor: a transparent <textarea> over a highlighted
 * <pre> layer with identical metrics, a line-number gutter with annotation
 * markers, line glows, the current-line tint, an own undo/redo stack, and the
 * ghost (the suggestion that is not in the document until Tab accepts it).
 *
 *   const ed = createEditor({ textarea, layer, gutter, glows, curline, scroller, surface, ghostBlock, lang, onChange, onCursor, onGhost, onAsk, onStack });
 *   ed.text / ed.rev / ed.lines / ed.getCursor() / ed.getSelection()
 *   ed.insertAt(at, text, source) · ed.replaceLines(from, to, text, source) · ed.setAll(text, source)
 *   ed.showGhost({text, source, alternatives, rev, at?}) · ed.clearGhost(reason) · ed.acceptGhost(partial) · ed.cycleGhost(dir)
 *   ed.glow(from, to, color, ttl) · ed.clearGlows() · ed.setMarkers(map) · ed.scrollToLine(n) · ed.setCursor(pos)
 *   ed.undo() · ed.redo() · ed.canUndo · ed.canRedo
 *
 * Lines are 1-based, columns 0-based (characters). Every text change, human
 * or programmatic, bumps `rev`, goes through the undo stack and calls
 * onChange({text, rev, delta, source}). Plain ES module; no dependencies.
 */

import { tokenizeLine } from './syntax.js';

const INDENT = '  ';
const UNDO_MAX = 200;
const COALESCE_MS = 600;
const GHOST_MAX_LINES = 12;
const MARGIN = 8;

const isMod = (e) => e.ctrlKey || e.metaKey;

/** @param {string} s */
const indentOf = (s) => (s.match(/^[ \t]*/) || [''])[0];

/** Visual column of character index `col` in `line` with tab stops of 4. */
function visualCol(line, col) {
  let v = 0;
  for (let i = 0; i < col && i < line.length; i++) v = line[i] === '\t' ? (Math.floor(v / 4) + 1) * 4 : v + 1;
  return v;
}

export function createEditor(o) {
  const ta = o.textarea;
  const layer = o.layer;
  const gutter = o.gutter;
  const glowsEl = o.glows;
  const curline = o.curline;
  const scroller = o.scroller;
  const surface = o.surface;
  const ghostBlock = o.ghostBlock;
  let reduced = !!o.reduced;
  const langOf = o.lang || (() => 'pseudo');
  const noop = () => {};
  const onChange = o.onChange || noop;
  const onCursor = o.onCursor || noop;
  const onGhost = o.onGhost || noop;
  const onAsk = o.onAsk || noop;
  const onStack = o.onStack || noop;
  const markerOf = o.commentMarker || (() => '#');

  let text = ta.value || '';
  let rev = 1;
  let lineStarts = null;          // offsets of each line start, lazily computed for `text`
  const undoStack = [];
  const redoStack = [];
  /** @type {null|{text:string, lines:string[], source:string, alts:string[], index:number, anchor:{line:number,col:number}, rev:number|null, pinned:boolean}} */
  let ghost = null;
  let markers = new Map();
  let tabFocus = false;           // Ctrl+M: Tab leaves the editor instead of accepting/indenting
  const glowList = [];
  let raf = 0;
  let lineCache = [];             // [{key, el}] per rendered line
  let tokCache = new Map();
  const metrics = { lh: 20, charW: 7.8, padT: 8, padL: 12 };

  // ───────────────────────── positions ─────────────────────────

  function starts() {
    if (lineStarts) return lineStarts;
    const s = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) s.push(i + 1);
    lineStarts = s;
    return s;
  }
  const lineCount = () => starts().length;
  function lineText(n) {
    const s = starts();
    const i = Math.min(Math.max(1, n), s.length) - 1;
    const end = i + 1 < s.length ? s[i + 1] - 1 : text.length;
    return text.slice(s[i], end);
  }
  /** Offset of {line, col}, clamped into the document. */
  function offsetOf(pos) {
    const s = starts();
    const li = Math.min(Math.max(1, Math.floor(pos?.line || 1)), s.length) - 1;
    const len = lineText(li + 1).length;
    const col = Math.min(Math.max(0, Math.floor(pos?.col || 0)), len);
    return s[li] + col;
  }
  function posOf(off) {
    const s = starts();
    const x = Math.min(Math.max(0, off), text.length);
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= x) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: x - s[lo] };
  }
  function caretOffset() { return ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd; }
  function getCursor() { return posOf(caretOffset()); }
  function getSelection() {
    if (ta.selectionStart === ta.selectionEnd) return null;
    return { from: posOf(ta.selectionStart), to: posOf(ta.selectionEnd) };
  }
  function setCursor(pos, end) {
    const a = offsetOf(pos);
    const b = end ? offsetOf(end) : a;
    ta.setSelectionRange(Math.min(a, b), Math.max(a, b));
    cursorMoved(true);
  }

  // ───────────────────────── undo ─────────────────────────

  function snapshot(kind) { return { text, s: ta.selectionStart, e: ta.selectionEnd, kind, at: performance.now() }; }
  function pushUndo(kind) {
    const last = undoStack[undoStack.length - 1];
    if (kind === 'type' && last && last.kind === 'type' && performance.now() - last.at < COALESCE_MS) { last.at = performance.now(); return; }
    undoStack.push(snapshot(kind));
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
    onStack();
  }
  function restore(snap) {
    ta.value = snap.text;
    ta.setSelectionRange(snap.s, snap.e);
  }
  function undo() {
    if (!undoStack.length) return false;
    const snap = undoStack.pop();
    redoStack.push(snapshot('redo'));
    if (ghost) { ghost = null; }
    restore(snap);
    commit('human', 'undo');
    onStack();
    return true;
  }
  function redo() {
    if (!redoStack.length) return false;
    const snap = redoStack.pop();
    undoStack.push(snapshot('undo'));
    if (ghost) { ghost = null; }
    restore(snap);
    commit('human', 'redo');
    onStack();
    return true;
  }

  // ───────────────────────── changes ─────────────────────────

  /** Line range + inserted text of the change from a to b. */
  function delta(a, b) {
    if (a === b) return null;
    let p = 0;
    const n = Math.min(a.length, b.length);
    while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    let sa = a.length, sb = b.length;
    while (sa > p && sb > p && a.charCodeAt(sa - 1) === b.charCodeAt(sb - 1)) { sa--; sb--; }
    const fromLine = posOf(p).line;                                   // posOf uses the new text
    const inserted = b.slice(p, sb);
    const removedLines = (a.slice(p, sa).match(/\n/g) || []).length;
    const insertedLines = (inserted.match(/\n/g) || []).length;
    const toLine = fromLine + Math.max(removedLines, insertedLines);
    return { from: fromLine, to: Math.min(toLine, lineCount()), text: inserted };
  }

  /** Commit whatever is in the textarea as the document. */
  function commit(source, kind) {
    const prev = text;
    const next = ta.value;
    if (prev === next) { scheduleRender(); cursorMoved(false); return null; }
    text = next;
    lineStarts = null;
    rev++;
    const d = delta(prev, next);
    scheduleRender();
    cursorMoved(kind !== 'cmd');
    onChange({ text, rev, delta: d, source, kind });
    return d;
  }

  /** Replace [start, end) with `insert`; returns the line range the insert now covers. */
  function replaceRange(start, end, insert, { source = 'human', kind = 'cmd', select = 'end' } = {}) {
    pushUndo(kind);
    const a = Math.max(0, Math.min(start, end));
    const b = Math.min(text.length, Math.max(start, end));
    ta.setRangeText(insert, a, b, select === 'range' ? 'select' : select === 'keep' ? 'preserve' : 'end');
    commit(source, kind);
    const from = posOf(a).line;
    const to = posOf(a + insert.length).line;
    return { from, to: insert.endsWith('\n') && to > from ? to - 1 : to };
  }

  function insertAt(at, insert, source = 'claude') {
    let a, b;
    if (at === 'end') { a = b = text.length; if (text.length && !text.endsWith('\n') && !insert.startsWith('\n')) insert = '\n' + insert; }
    else if (at === 'cursor' || at == null) { a = ta.selectionStart; b = ta.selectionEnd; }
    else { a = b = offsetOf(at); }
    if (ghost) ghost = null;
    const r = replaceRange(a, b, insert, { source, kind: source === 'claude' ? 'cmd' : 'accept' });
    if (source === 'claude') glow(r.from, r.to, '', 600, 'ins');
    return r;
  }

  function replaceLines(from, to, insert, source = 'claude') {
    const n = lineCount();
    const f = Math.min(Math.max(1, from), n);
    const t = Math.min(Math.max(f, to || f), n);
    const s = starts();
    const a = s[f - 1];
    const b = t < n ? s[t] - 1 : text.length;
    let ins = String(insert ?? '');
    if (ins.endsWith('\n')) ins = ins.slice(0, -1);
    if (ghost) ghost = null;
    const r = replaceRange(a, b, ins, { source, kind: 'cmd', select: 'end' });
    if (source === 'claude') glow(r.from, r.to, '', 600, 'ins');
    return r;
  }

  function setAll(insert, source = 'claude', { kind = 'cmd', cursor = null } = {}) {
    if (ghost) ghost = null;
    const r = replaceRange(0, text.length, String(insert ?? ''), { source, kind, select: 'end' });
    if (cursor) setCursor(cursor); else setCursor({ line: 1, col: 0 });
    return r;
  }

  // ───────────────────────── ghost ─────────────────────────

  function showGhost({ text: t, source = 'claude', alternatives = [], rev: grev = null, at = null }) {
    let s = String(t ?? '').replace(/\r/g, '').replace(/\n+$/, '');
    if (!s) { clearGhost(null); return false; }
    const lines = s.split('\n').slice(0, GHOST_MAX_LINES);
    const cap = (x) => String(x ?? '').replace(/\r/g, '').replace(/\n+$/, '').split('\n').slice(0, GHOST_MAX_LINES).join('\n');
    const alts = [lines.join('\n'), ...alternatives.map(cap).filter((x) => x && x !== lines.join('\n')).slice(0, 5)];
    const anchor = at && Number.isFinite(at.line) ? posOf(offsetOf(at)) : getCursor();
    ghost = { text: alts[0], lines, source, alts, index: 0, anchor, rev: grev, pinned: !!at };
    scheduleRender();
    onGhost({ type: 'show', source, text: ghost.text, rev: grev });
    return true;
  }

  function clearGhost(reason) {
    if (!ghost) return false;
    const g = ghost;
    ghost = null;
    scheduleRender();
    if (reason) onGhost({ type: 'reject', reason, source: g.source, rev: g.rev });
    return true;
  }

  function cycleGhost(dir) {
    if (!ghost || ghost.alts.length < 2) return false;
    ghost.index = (ghost.index + dir + ghost.alts.length) % ghost.alts.length;
    ghost.text = ghost.alts[ghost.index];
    ghost.lines = ghost.text.split('\n');
    scheduleRender();
    onGhost({ type: 'cycle', source: ghost.source, text: ghost.text, rev: ghost.rev, index: ghost.index, count: ghost.alts.length });
    return true;
  }

  function acceptGhost(partial = false) {
    if (!ghost) return false;
    const g = ghost;
    let full = g.text;
    // re-base the first line: when the caret sits after the line's indentation and the ghost repeats it, drop the repeat
    const cur = lineText(g.anchor.line);
    const before = cur.slice(0, g.anchor.col);
    if (before && !before.trim() && full.startsWith(before)) full = full.slice(before.length);
    let ins = full;
    if (partial) {
      const m = full.match(/^[ \t]*[^\s]+[ \t]?/);
      ins = m ? m[0] : full.split('\n')[0];
    }
    ghost = null;
    const a = offsetOf(g.anchor);
    const r = replaceRange(a, a, ins, { source: 'human', kind: 'accept', select: 'end' });
    glow(r.from, r.to, '', 600, 'ins');
    onGhost({ type: 'accept', source: g.source, text: ins, partial, rev: g.rev });
    const rest = full.slice(ins.length);
    if (partial && rest.trim()) {
      ghost = { ...g, text: rest, lines: rest.split('\n'), alts: [rest], index: 0, anchor: getCursor(), pinned: false };
      scheduleRender();
    }
    return true;
  }

  /** The human typed `data`: shrink the ghost when it matches, otherwise drop it. */
  function ghostTyped(data) {
    if (!ghost) return;
    if (ghost.pinned) { clearGhost('typed-away'); return; }
    if (data && ghost.text.startsWith(data)) {
      const rest = ghost.text.slice(data.length);
      if (!rest.trim()) { ghost = null; return; }
      // the alternatives shrink in step; those that stop matching drop out
      const alts = ghost.alts.map((a) => (a.startsWith(data) ? a.slice(data.length) : null)).filter((a) => a && a.trim());
      const index = Math.max(0, alts.indexOf(rest));
      ghost = { ...ghost, text: rest, lines: rest.split('\n'), alts: alts.length ? alts : [rest], index, anchor: null };
      return;
    }
    clearGhost('typed-away');
  }

  // ───────────────────────── rendering ─────────────────────────

  function measure() {
    const cs = getComputedStyle(layer);
    metrics.lh = parseFloat(cs.lineHeight) || 20;
    metrics.padT = parseFloat(cs.paddingTop) || 0;
    metrics.padL = parseFloat(cs.paddingLeft) || 0;
    const probe = document.createElement('span');
    probe.className = 'l-probe';
    probe.textContent = 'x'.repeat(100);
    layer.appendChild(probe);
    metrics.charW = probe.getBoundingClientRect().width / 100 || 7.8;
    probe.remove();
  }

  function tokensFor(line, stateIn, lang, next) {
    const key = `${lang}\u0000${stateIn}\u0000${line}`;
    let hit = tokCache.get(key);
    if (!hit) { const r = tokenizeLine(line, { block: stateIn || null }, lang); hit = { tokens: r.tokens, state: r.state }; }
    next.set(key, hit);
    return hit;
  }

  function spanFor(tok) {
    const s = document.createElement('span');
    s.className = `t-${tok.t}`;
    s.textContent = tok.s;
    return s;
  }

  function buildLine(n, tokens, ghostCol, ghostText) {
    const el = document.createElement('span');
    el.className = 'l';
    el.dataset.l = String(n);
    if (ghostCol == null) { for (const t of tokens) el.appendChild(spanFor(t)); return el; }
    let acc = 0;
    let placed = false;
    for (const t of tokens) {
      const end = acc + t.s.length;
      if (!placed && ghostCol >= acc && ghostCol <= end && !(ghostCol === end && end < lineLen(tokens))) {
        const cut = ghostCol - acc;
        if (cut > 0) el.appendChild(spanFor({ t: t.t, s: t.s.slice(0, cut) }));
        el.appendChild(ghostSpan(ghostText));
        placed = true;
        if (cut < t.s.length) el.appendChild(spanFor({ t: t.t, s: t.s.slice(cut) }));
      } else el.appendChild(spanFor(t));
      acc = end;
    }
    if (!placed) el.appendChild(ghostSpan(ghostText));
    return el;
  }
  const lineLen = (tokens) => tokens.reduce((n, t) => n + t.s.length, 0);
  function ghostSpan(t) {
    const g = document.createElement('span');
    g.className = 'ghost';
    g.textContent = t;
    return g;
  }

  function scheduleRender() { if (!raf) raf = requestAnimationFrame(render); }

  function render() {
    raf = 0;
    const lines = text.split('\n');
    const lang = langOf();
    const next = new Map();
    const ganchor = ghost ? (ghost.anchor || getCursor()) : null;
    if (ghost && !ghost.anchor) ghost.anchor = ganchor;
    const gline = ganchor ? ganchor.line : -1;
    const els = new Array(lines.length);
    let stateIn = '';
    const cache = lineCache;
    for (let i = 0; i < lines.length; i++) {
      const tk = tokensFor(lines[i], stateIn, lang, next);
      const n = i + 1;
      const isGhost = n === gline;
      const key = isGhost ? null : `${lang}\u0000${stateIn}\u0000${lines[i]}`;
      const old = cache[i];
      if (key && old && old.key === key) els[i] = old.el;
      else els[i] = buildLine(n, tk.tokens, isGhost ? ganchor.col : null, isGhost ? ghost.lines[0] : '');
      cache[i] = { key, el: els[i] };
      stateIn = tk.state.block || '';
    }
    cache.length = lines.length;
    tokCache = next;
    // reconcile the layer's children (a Set keeps this linear on big documents)
    const kids = layer.childNodes;
    const keep = new Set(els);
    for (let i = 0; i < els.length; i++) {
      const cur = kids[i];
      if (cur === els[i]) continue;
      if (cur) layer.insertBefore(els[i], cur); else layer.appendChild(els[i]);
      if (cur && cur.parentNode === layer && !keep.has(cur)) cur.remove();
    }
    while (kids.length > els.length) kids[kids.length - 1].remove();
    renderGutter(lines.length);
    renderGhostBlock(ganchor);
    positionCurline();
    for (const g of glowList) positionGlow(g);
    ta.scrollTop = 0; ta.scrollLeft = 0;
  }

  function renderGutter(n) {
    const w = String(n).length;
    gutter.style.setProperty('--gw', `${Math.max(2, w)}ch`);
    while (gutter.children.length > n) gutter.lastElementChild.remove();
    for (let i = gutter.children.length; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'gn';
      d.dataset.line = String(i + 1);
      const num = document.createElement('span');
      num.className = 'gnum';
      num.textContent = String(i + 1);
      const dot = document.createElement('span');
      dot.className = 'gmark';
      d.append(dot, num);
      gutter.appendChild(d);
    }
    // markers: a full pass only when they changed; the current-line class touches two rows
    if (markersDirty) {
      markersDirty = false;
      for (let i = 0; i < n; i++) {
        const d = gutter.children[i];
        const k = markers.get(i + 1);
        if (k) d.dataset.kind = k; else delete d.dataset.kind;
      }
    }
    gutterCur = 0;
    markCurrentRow(getCursor().line);
  }
  let markersDirty = true;
  let gutterCur = 0;
  function markCurrentRow(line) {
    if (line === gutterCur) return;
    const prev = gutter.children[gutterCur - 1];
    if (prev) prev.classList.remove('cur');
    const next = gutter.children[line - 1];
    if (next) next.classList.add('cur');
    gutterCur = line;
  }

  function renderGhostBlock(anchor) {
    if (!ghost || ghost.lines.length < 2 || !anchor) { ghostBlock.hidden = true; ghostBlock.textContent = ''; return; }
    ghostBlock.textContent = '';
    for (const l of ghost.lines.slice(1)) {
      const d = document.createElement('div');
      d.className = 'gl';
      d.textContent = l || ' ';
      ghostBlock.appendChild(d);
    }
    const cur = lineText(anchor.line);
    const x = metrics.padL + visualCol(cur, indentOf(cur).length) * metrics.charW;
    const below = metrics.padT + anchor.line * metrics.lh;
    ghostBlock.hidden = false;
    ghostBlock.style.left = `${Math.max(4, x - 10)}px`;
    const h = ghostBlock.offsetHeight;
    const visibleBottom = scroller.scrollTop + scroller.clientHeight;
    const flip = below + h > visibleBottom && metrics.padT + (anchor.line - 1) * metrics.lh - h > scroller.scrollTop;
    ghostBlock.style.top = `${flip ? metrics.padT + (anchor.line - 1) * metrics.lh - h - 2 : below + 2}px`;
    ghostBlock.classList.toggle('above', flip);
    if (ghost.alts.length > 1) ghostBlock.dataset.alts = `${ghost.index + 1}/${ghost.alts.length} · Alt+]`; else delete ghostBlock.dataset.alts;
  }

  function positionCurline() {
    const c = getCursor();
    curline.style.top = `${metrics.padT + (c.line - 1) * metrics.lh}px`;
    curline.style.height = `${metrics.lh}px`;
  }

  // ───────────────────────── glows ─────────────────────────

  function positionGlow(g) {
    g.el.style.top = `${metrics.padT + (g.from - 1) * metrics.lh}px`;
    g.el.style.height = `${(g.to - g.from + 1) * metrics.lh}px`;
  }
  function glow(from, to, color = '', ttl = 4000, kind = '') {
    const n = lineCount();
    const f = Math.min(Math.max(1, from | 0), n);
    const t = Math.min(Math.max(f, (to | 0) || f), n);
    const el = document.createElement('div');
    el.className = `glow${kind ? ` glow-${kind}` : ''}`;
    if (color) el.style.setProperty('--glow-c', color);
    const g = { el, from: f, to: t, timer: 0 };
    glowsEl.appendChild(el);
    positionGlow(g);
    glowList.push(g);
    if (ttl > 0) g.timer = setTimeout(() => removeGlow(g), ttl);
    return g;
  }
  function removeGlow(g) {
    clearTimeout(g.timer);
    const i = glowList.indexOf(g);
    if (i >= 0) glowList.splice(i, 1);
    g.el.classList.add('out');
    setTimeout(() => g.el.remove(), reduced ? 0 : 320);
  }
  function clearGlows() { for (const g of [...glowList]) removeGlow(g); }

  // ───────────────────────── cursor & scrolling ─────────────────────────

  let lastCaret = -1;
  function cursorMoved(reveal) {
    const off = caretOffset();
    if (ghost && ghost.anchor && !ghost.pinned) {
      const a = offsetOf(ghost.anchor);
      if (off !== a) clearGhost('moved');
    }
    positionCurline();
    if (gutter.children.length) markCurrentRow(getCursor().line);
    if (reveal) revealCaret();
    if (off !== lastCaret) { lastCaret = off; onCursor(); }
  }

  function caretXY() {
    const c = getCursor();
    const line = lineText(c.line);
    return { x: metrics.padL + visualCol(line, c.col) * metrics.charW, y: metrics.padT + (c.line - 1) * metrics.lh };
  }

  function revealCaret() {
    const { x, y } = caretXY();
    const gw = gutter.offsetWidth;
    const top = scroller.scrollTop, left = scroller.scrollLeft;
    const h = scroller.clientHeight, w = scroller.clientWidth;
    let nt = top, nl = left;
    if (y < top + MARGIN) nt = Math.max(0, y - MARGIN);
    else if (y + metrics.lh > top + h - MARGIN - 24) nt = y + metrics.lh - h + MARGIN + 24;
    const ax = gw + x;
    if (ax < left + gw + MARGIN) nl = Math.max(0, ax - gw - MARGIN);
    else if (ax + 2 > left + w - MARGIN) nl = ax - w + MARGIN + 2 * metrics.charW;
    if (nt !== top || nl !== left) scroller.scrollTo({ top: nt, left: nl, behavior: 'instant' });
  }

  function scrollToLine(n, col) {
    const li = Math.min(Math.max(1, n | 0), lineCount());
    const y = metrics.padT + (li - 1) * metrics.lh;
    const target = Math.max(0, y - scroller.clientHeight / 2 + metrics.lh);
    scroller.scrollTo({ top: target, behavior: reduced ? 'instant' : 'smooth' });
    if (col != null) setCursor({ line: li, col }); else setCursor({ line: li, col: 0 });
  }

  // ───────────────────────── editing helpers ─────────────────────────

  function selectedLineRange() {
    const a = posOf(ta.selectionStart).line;
    let b = posOf(ta.selectionEnd).line;
    if (ta.selectionEnd > ta.selectionStart && posOf(ta.selectionEnd).col === 0 && b > a) b--;
    return [a, b];
  }
  function linesBlock(a, b) {
    const s = starts();
    const start = s[a - 1];
    const end = b < lineCount() ? s[b] - 1 : text.length;
    return { start, end, block: text.slice(start, end) };
  }
  function mapLines(fn, kind) {
    const [a, b] = selectedLineRange();
    const { start, end, block } = linesBlock(a, b);
    const out = block.split('\n').map(fn).join('\n');
    if (out === block) return;
    const hadSel = ta.selectionEnd > ta.selectionStart;
    const caretCol = posOf(ta.selectionStart).col;
    replaceRange(start, end, out, { source: 'human', kind, select: 'range' });
    if (!hadSel) { const d = out.length - block.length; const o = Math.max(start, start + caretCol + d); ta.setSelectionRange(o, o); cursorMoved(false); }
  }
  function indent(dir) {
    if (dir > 0) mapLines((l) => (l.length ? INDENT + l : l), 'indent');
    else mapLines((l) => l.replace(/^(\t| {1,2})/, ''), 'indent');
  }
  function toggleComment() {
    const m = markerOf();
    const [a, b] = selectedLineRange();
    const { block } = linesBlock(a, b);
    const ls = block.split('\n').filter((l) => l.trim());
    const all = ls.length > 0 && ls.every((l) => l.trim().startsWith(m));
    const min = ls.reduce((n, l) => Math.min(n, indentOf(l).length), 1e9);
    mapLines((l) => {
      if (!l.trim()) return l;
      if (all) return l.replace(new RegExp(`^(\\s*)${m.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} ?`), '$1');
      return l.slice(0, min) + m + ' ' + l.slice(min);
    }, 'comment');
  }
  function duplicate() {
    const [a, b] = selectedLineRange();
    const { end, block } = linesBlock(a, b);
    const sel = [ta.selectionStart, ta.selectionEnd];
    replaceRange(end, end, '\n' + block, { source: 'human', kind: 'dup', select: 'keep' });
    const shift = block.length + 1;
    ta.setSelectionRange(sel[0] + shift, sel[1] + shift);
    cursorMoved(true);
  }
  function moveLines(dir) {
    const [a, b] = selectedLineRange();
    const n = lineCount();
    if ((dir < 0 && a === 1) || (dir > 0 && b === n)) return;
    const sel = [ta.selectionStart, ta.selectionEnd];
    const s = starts();
    const { block } = linesBlock(a, b);
    if (dir < 0) {
      const other = lineText(a - 1);
      const start = s[a - 2];
      const end = b < n ? s[b] - 1 : text.length;
      replaceRange(start, end, `${block}\n${other}`, { source: 'human', kind: 'move', select: 'keep' });
      ta.setSelectionRange(sel[0] - other.length - 1, sel[1] - other.length - 1);
    } else {
      const other = lineText(b + 1);
      const start = s[a - 1];
      const end = b + 1 < n ? s[b + 1] - 1 : text.length;
      replaceRange(start, end, `${other}\n${block}`, { source: 'human', kind: 'move', select: 'keep' });
      ta.setSelectionRange(sel[0] + other.length + 1, sel[1] + other.length + 1);
    }
    cursorMoved(true);
  }
  function newline() {
    const c = getCursor();
    const cur = lineText(c.line);
    const before = cur.slice(0, c.col);
    const ask = before.match(/^\s*\?\?\s*(.*)$/);
    if (ask && ask[1].trim()) onAsk(c.line, ask[1].trim());
    let ind = indentOf(before);
    if (/[:{(\[]\s*$/.test(before) && !/^\s*(#|\/\/)/.test(before)) ind += INDENT;
    replaceRange(ta.selectionStart, ta.selectionEnd, '\n' + ind, { source: 'human', kind: 'type' });
  }

  // ───────────────────────── events ─────────────────────────

  ta.addEventListener('beforeinput', (e) => {
    const t = e.inputType || '';
    pushUndo(t === 'insertText' || t === 'deleteContentBackward' || t === 'deleteContentForward' || t === 'insertCompositionText' ? 'type' : t || 'edit');
  });
  ta.addEventListener('input', (e) => {
    const t = e.inputType || '';
    if (ghost) {
      if (t === 'insertText') ghostTyped(e.data || '');
      else if (t === 'insertCompositionText') { /* wait for the composition to end */ }
      else clearGhost('typed-away');
    }
    commit('human', 'type');
  });
  ta.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const k = e.key;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (k === 'Tab' && tabFocus) return;                 // Ctrl+M mode: Tab moves focus
    if (k === 'Tab' && plain && !e.shiftKey) { e.preventDefault(); if (ghost) acceptGhost(false); else if (ta.selectionStart !== ta.selectionEnd && text.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) indent(1); else replaceRange(ta.selectionStart, ta.selectionEnd, INDENT, { source: 'human', kind: 'type' }); return; }
    if (k === 'Tab' && e.shiftKey && !isMod(e) && !e.altKey) {
      // outdent only when there is something to outdent; otherwise Shift+Tab leaves the editor (no keyboard trap)
      const multi = ta.selectionStart !== ta.selectionEnd && text.slice(ta.selectionStart, ta.selectionEnd).includes('\n');
      if (multi || /^[ \t]/.test(lineText(getCursor().line))) { e.preventDefault(); indent(-1); }
      return;
    }
    if (k === 'Escape' && ghost) { e.preventDefault(); e.stopPropagation(); clearGhost('esc'); return; }
    if (k === 'ArrowRight' && isMod(e) && !e.shiftKey && !e.altKey && ghost) { e.preventDefault(); acceptGhost(true); return; }
    if ((k === ']' || k === '[') && e.altKey && !isMod(e) && ghost) { e.preventDefault(); cycleGhost(k === ']' ? 1 : -1); return; }
    if (k === 'Enter' && plain && !e.shiftKey) { e.preventDefault(); if (ghost) clearGhost('typed-away'); newline(); return; }
    if (isMod(e) && !e.altKey) {
      const low = k.toLowerCase();
      if (low === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (low === 'y' || (low === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (low === 'd' && !e.shiftKey) { e.preventDefault(); if (ghost) clearGhost('typed-away'); duplicate(); return; }
      if (k === ';' && !e.shiftKey) { e.preventDefault(); if (ghost) clearGhost('typed-away'); toggleComment(); return; }
    }
    if (e.altKey && !isMod(e) && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); if (ghost) clearGhost('typed-away'); moveLines(k === 'ArrowUp' ? -1 : 1); return; }
  });
  ta.addEventListener('keyup', (e) => {
    if (/^(Arrow|Home|End|Page)/.test(e.key) || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') cursorMoved(true);
  });
  ta.addEventListener('compositionend', () => { if (ghost) clearGhost('typed-away'); });
  document.addEventListener('selectionchange', () => { if (document.activeElement === ta) cursorMoved(false); });
  ta.addEventListener('click', () => cursorMoved(false));
  ta.addEventListener('scroll', () => { ta.scrollTop = 0; ta.scrollLeft = 0; });
  scroller.addEventListener('scroll', () => { if (ghost) renderGhostBlock(ghost.anchor || getCursor()); }, { passive: true });

  measure();
  if (document.fonts?.ready) document.fonts.ready.then(() => { measure(); scheduleRender(); }).catch(() => {});
  render();

  return {
    get text() { return text; },
    get rev() { return rev; },
    get lines() { return lineCount(); },
    get ghost() { return ghost ? { text: ghost.text, source: ghost.source, rev: ghost.rev, anchor: ghost.anchor, alts: ghost.alts.length, index: ghost.index } : null; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get metrics() { return { ...metrics }; },
    lineText, getCursor, getSelection, setCursor, posOf, offsetOf,
    insertAt, replaceLines, setAll,
    showGhost, clearGhost, acceptGhost, cycleGhost,
    glow, clearGlows,
    setMarkers(map) { markers = map instanceof Map ? map : new Map(Object.entries(map || {}).map(([k, v]) => [Number(k), v])); markersDirty = true; scheduleRender(); },
    setReduced(on) { reduced = !!on; },
    lineTop(n) { return metrics.padT + (Math.min(Math.max(1, n | 0), lineCount()) - 1) * metrics.lh; },
    scrollToLine, revealCaret, caretXY,
    undo, redo,
    focus() { ta.focus({ preventScroll: true }); },
    setTabFocus(on) { tabFocus = !!on; },
    get tabFocus() { return tabFocus; },
    render: scheduleRender,
    remeasure() { measure(); scheduleRender(); },
  };
}
