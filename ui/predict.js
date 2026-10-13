/**
 * predict.js — the local predictor (CONTRACT §7).
 *
 * A handful of syntactic rules that give a weak ghost at once, offline, while
 * Claude's real suggestion is on its way (or while Claude is away). First
 * rule that hits wins; a local ghost never exceeds two lines. Synchronous and
 * cheap: it only looks at the lines around the caret.
 *
 *   predict(text, {line, col}, lang) → {text, reason} | null
 *
 * `text` is what goes after the caret (the caret line's own prefix is never
 * repeated). Plain ES module; no dependencies.
 */

import { pythonHead } from './syntax.js';

const PY_LIKE = new Set(['python', 'pseudo', 'ruby', 'bash', 'yaml', '']);
const OPEN = { '(': ')', '[': ']', '{': '}' };

/** Leading whitespace of a line. */
const indentOf = (s) => (s.match(/^[ \t]*/) || [''])[0];

/** Is the language brace-shaped (JS, C, Go…) rather than indentation-shaped? */
function braceLike(lang, lines) {
  const l = String(lang || '').toLowerCase();
  if (PY_LIKE.has(l)) {
    // pseudo-code: decide from what the human wrote so far
    if (l === 'pseudo' || l === '') { let b = 0, c = 0; for (const s of lines) { if (/\{\s*$/.test(s)) b++; if (/:\s*$/.test(s)) c++; } return b > c; }
    return false;
  }
  return true;
}

/**
 * @param {string} text
 * @param {{line:number, col:number}} cursor  1-based line, 0-based column
 * @param {string} lang
 * @returns {{text:string, reason:string}|null}
 */
export function predict(text, cursor, lang) {
  const lines = String(text || '').split('\n');
  const li = Math.min(Math.max(1, cursor?.line || 1), lines.length) - 1;
  const cur = lines[li] || '';
  const col = Math.min(Math.max(0, cursor?.col || 0), cur.length);
  const before = cur.slice(0, col);
  const after = cur.slice(col);
  if (after.trim()) return null;                       // only at the end of a line's content
  const braces = braceLike(lang, lines);

  return closers(before, braces)
    || pairs(lines, li, before, braces)
    || sequence(lines, li, before)
    || echo(lines, li, before)
    || shape(lines, li, before);
}

/** 1. Unbalanced openers on the caret line → the closers (+ ':' for a python-ish head). */
function closers(before, braces) {
  if (!before.trim()) return null;
  const stack = [];
  let q = null;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '#' && !braces) break;
    if (ch === '/' && before[i + 1] === '/') break;
    if (OPEN[ch]) stack.push(OPEN[ch]);
    else if (ch === ')' || ch === ']' || ch === '}') { if (stack[stack.length - 1] === ch) stack.pop(); }
  }
  if (q) return null;
  let out = stack.reverse().join('');
  const head = pythonHead(before) && !braces && !/:\s*$/.test(before);
  if (head) {
    // `def foo(` → `):`; `if x` → `:`; a bare `else` → `:`
    if (!out && /^\s*(else|try|finally)\s*$/.test(before)) out = ':';
    else if (out || /^\s*(if|elif|for|while|with|def|class|lambda|except)\b\s+\S/.test(before)) out += ':';
  }
  return out ? { text: out, reason: 'closers' } : null;
}

/** 2. A fresh line at the indent of an `if`/`try` block that has a body → else / except. */
function pairs(lines, li, before, braces) {
  if (before.trim()) return null;
  const indent = before;
  let sawDeeper = false;
  for (let i = li - 1; i >= 0; i--) {
    const s = lines[i];
    if (!s.trim()) continue;
    const ind = indentOf(s);
    if (ind.length > indent.length) { sawDeeper = true; continue; }
    if (ind.length < indent.length) return null;
    // same indent: the block head, if there was a body
    if (!sawDeeper) {
      if (braces && /^\s*\}\s*$/.test(s)) {
        // find the opener of that closing brace
        let depth = 0;
        for (let j = i; j >= 0; j--) {
          const t = lines[j];
          depth += (t.match(/\}/g) || []).length - (t.match(/\{/g) || []).length;
          if (depth <= 0 && /\{\s*$/.test(t)) {
            if (/^\s*(\}\s*)?(if|else if)\b/.test(t)) return { text: 'else {', reason: 'pair' };
            if (/^\s*try\b/.test(t)) return { text: 'catch (e) {', reason: 'pair' };
            return null;
          }
        }
      }
      return null;
    }
    if (!braces) {
      if (/^\s*(if|elif)\b.*:\s*$/.test(s)) return { text: 'else:', reason: 'pair' };
      if (/^\s*try\s*:\s*$/.test(s)) return { text: 'except Exception as e:', reason: 'pair' };
    }
    return null;
  }
  return null;
}

/** 3. Two previous lines that differ only in a number or a letter → the next one. */
function sequence(lines, li, before) {
  if (before.trim()) return null;
  const prev = [];
  for (let i = li - 1; i >= 0 && prev.length < 2; i--) if (lines[i].trim()) prev.unshift(lines[i]);
  if (prev.length < 2) return null;
  const [a, b] = prev;
  if (indentOf(a) !== indentOf(b)) return null;
  const re = /\d+|\b[a-zA-Z]\b/g;
  const ta = a.split(re), tb = b.split(re);
  if (ta.length !== tb.length || ta.length < 2 || ta.some((x, i) => x !== tb[i])) return null;
  const na = a.match(re) || [], nb = b.match(re) || [];
  if (na.length !== nb.length) return null;
  let diff = -1;
  for (let i = 0; i < na.length; i++) if (na[i] !== nb[i]) { if (diff >= 0) return null; diff = i; }
  if (diff < 0) return null;
  let next;
  if (/^\d+$/.test(na[diff]) && /^\d+$/.test(nb[diff])) {
    const x = Number(na[diff]), y = Number(nb[diff]);
    if (y - x !== 1 && y - x !== -1) return null;
    next = String(y + (y - x));
    if (Number(next) < 0) return null;
  } else {
    const x = na[diff].charCodeAt(0), y = nb[diff].charCodeAt(0);
    if (y - x !== 1 || !/[a-yA-Y]/.test(nb[diff])) return null;
    next = String.fromCharCode(y + 1);
  }
  const parts = [...nb];
  parts[diff] = next;
  let out = '';
  for (let i = 0; i < tb.length; i++) out += tb[i] + (i < parts.length ? parts[i] : '');
  if (!out.startsWith(before)) return null;
  const rest = out.slice(before.length);
  return rest.trim() ? { text: rest, reason: 'sequence' } : null;
}

/** 4. The caret line is the start of an earlier, longer line → the rest of that line. */
function echo(lines, li, before) {
  const head = before.trim();
  if (head.length < 3) return null;
  const lead = indentOf(before);
  if (before !== lead + head) return null;
  let best = null;
  for (let d = 1; d < lines.length; d++) {
    for (const i of [li - d, li + d]) {
      if (i < 0 || i >= lines.length || i === li) continue;
      const t = lines[i].trim();
      if (t.length > head.length && t.startsWith(head)) { best = t; break; }
    }
    if (best) break;
  }
  if (!best) return null;
  return { text: best.slice(head.length), reason: 'echo' };
}

/** 5. Two previous lines start with the same bullet or key marker → that marker again. */
function shape(lines, li, before) {
  if (before.trim()) return null;
  const prev = [];
  for (let i = li - 1; i >= 0 && prev.length < 2; i--) { if (!lines[i].trim()) break; prev.unshift(lines[i]); }
  if (prev.length < 2) return null;
  const [a, b] = prev;
  if (indentOf(a) !== indentOf(b) || indentOf(b) !== before) return null;
  const ma = a.trim().match(/^([-*•>]|\d+[.)]|[\w-]+:)\s/);
  const mb = b.trim().match(/^([-*•>]|\d+[.)]|[\w-]+:)\s/);
  if (!ma || !mb) return null;
  if (ma[1] === mb[1] && /^[-*•>]$/.test(mb[1])) return { text: `${mb[1]} `, reason: 'shape' };
  if (/^\d+[.)]$/.test(ma[1]) && /^\d+[.)]$/.test(mb[1])) {
    const n = parseInt(mb[1], 10);
    if (parseInt(ma[1], 10) === n - 1) return { text: `${n + 1}${mb[1].slice(-1)} `, reason: 'shape' };
  }
  return null;
}
