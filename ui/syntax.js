/**
 * syntax.js — a forgiving tokenizer and a language sniffer for cocode.
 *
 * The human may type Python, a language that does not exist, or prose with
 * indentation. So the tokenizer is generic: comments, strings, numbers, a
 * union of keywords from many languages (plus the control words people use in
 * pseudo-code), calls, ALL_CAPS constants, punctuation, and `??` question
 * lines. It never throws and never needs to know the language, though the
 * language picks the comment markers. `detect()` sniffs the language from
 * signature patterns and answers `pseudo` when nothing scores.
 *
 * Plain ES module; no dependencies.
 */

/** Languages the sniffer knows (the chip shows any of these, or what the human typed). */
export const LANGS = ['python', 'javascript', 'typescript', 'go', 'rust', 'bash', 'sql', 'c', 'cpp', 'java', 'ruby', 'html', 'css', 'json', 'pseudo'];

const KEYWORDS = new Set((
  'if else elif then end endif for each in of while do loop repeat until unless return break continue pass ' +
  'def function fn func proc class struct interface trait impl enum type let const var val mut static ' +
  'import from export as module require include use package namespace ' +
  'try except catch finally raise throw throws with lambda yield async await new delete this self super ' +
  'print echo puts log true false null none nil undefined and or not is xor ' +
  'switch case default match when otherwise go pub where select insert update values set create table drop ' +
  'begin commit rollback alter join on group order by having limit into ' +
  'map chan range defer void int string bool float double char long short public private protected ' +
  'extends implements abstract final override virtual ' +
  'every all any some first last next prev after before send get put post read write call ask show hide wait ' +
  'start stop open close save load run step done todo fixme note'
).split(/\s+/));

const PY_HEAD = /^\s*(def|if|elif|else|for|while|with|try|except|finally|class|lambda)\b/;

/**
 * Comment markers for a language: [line marker, block open, block close].
 * Unknown and pseudo languages accept `#`, `//` and `--` as line comments.
 * @param {string} lang
 */
export function commentStyle(lang) {
  switch (String(lang || '').toLowerCase()) {
    case 'python': case 'bash': case 'ruby': case 'sh': case 'zsh': case 'perl': case 'yaml': case 'toml': case 'r':
      return { line: ['#'], block: null, marker: '#' };
    case 'sql': case 'lua': case 'haskell':
      return { line: ['--'], block: ['/*', '*/'], marker: '--' };
    case 'html': case 'xml': case 'svg':
      return { line: [], block: ['<!--', '-->'], marker: '<!--' };
    case 'css': case 'scss':
      return { line: ['//'], block: ['/*', '*/'], marker: '/*' };
    case 'javascript': case 'js': case 'typescript': case 'ts': case 'go': case 'rust': case 'c': case 'cpp': case 'c++': case 'java':
    case 'kotlin': case 'swift': case 'csharp': case 'c#': case 'php': case 'dart': case 'scala': case 'zig':
      return { line: ['//'], block: ['/*', '*/'], marker: '//' };
    default:
      return { line: ['#', '//', '--'], block: ['/*', '*/'], marker: '#' };
  }
}

/** The marker to put in front of a line for Ctrl+; */
export function commentMarker(lang) { return commentStyle(lang).marker; }

/**
 * @typedef {{t:'ws'|'cm'|'str'|'num'|'kw'|'fn'|'const'|'id'|'pun'|'ask'|'tx', s:string}} Token
 * @typedef {{block: string|null}} State   what carries over to the next line (an open block comment / triple string)
 */

/**
 * Tokenize one line. Returns the tokens and the state for the next line.
 * @param {string} line
 * @param {State} state
 * @param {string} lang
 * @returns {{tokens: Token[], state: State}}
 */
export function tokenizeLine(line, state = { block: null }, lang = 'pseudo') {
  const tokens = [];
  const cs = commentStyle(lang);
  let i = 0;
  const n = line.length;
  let block = state.block;

  const push = (t, s) => { if (s) tokens.push({ t, s }); };

  // continuing a block comment or a triple-quoted string
  if (block) {
    const end = line.indexOf(block);
    if (end < 0) { push(block === '*/' || block === '-->' ? 'cm' : 'str', line); return { tokens, state: { block } }; }
    push(block === '*/' || block === '-->' ? 'cm' : 'str', line.slice(0, end + block.length));
    i = end + block.length;
    block = null;
  }

  // a question to Claude: the whole line
  if (i === 0 && /^\s*\?\?/.test(line)) { push('ask', line); return { tokens, state: { block: null } }; }

  while (i < n) {
    const ch = line[i];
    // whitespace
    if (ch === ' ' || ch === '\t') { let j = i; while (j < n && (line[j] === ' ' || line[j] === '\t')) j++; push('ws', line.slice(i, j)); i = j; continue; }
    // line comments
    let lc = null;
    for (const m of cs.line) if (line.startsWith(m, i)) { lc = m; break; }
    // `--` only counts as a comment when followed by a space or at line end (so `x--` stays code)
    if (lc && (lc !== '--' || i + 2 >= n || line[i + 2] === ' ')) { push('cm', line.slice(i)); break; }
    // block comment / triple string open
    if (cs.block && line.startsWith(cs.block[0], i)) {
      const close = cs.block[1];
      const end = line.indexOf(close, i + cs.block[0].length);
      if (end < 0) { push('cm', line.slice(i)); block = close; break; }
      push('cm', line.slice(i, end + close.length)); i = end + close.length; continue;
    }
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      const q = line.slice(i, i + 3);
      const end = line.indexOf(q, i + 3);
      if (end < 0) { push('str', line.slice(i)); block = q; break; }
      push('str', line.slice(i, end + 3)); i = end + 3; continue;
    }
    // strings
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
      push('str', line.slice(i, Math.min(n, j + 1))); i = Math.min(n, j + 1); continue;
    }
    // numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] || ''))) {
      let j = i + 1; while (j < n && /[0-9a-zA-Z_.]/.test(line[j])) j++;
      push('num', line.slice(i, j)); i = j; continue;
    }
    // words
    if (/[A-Za-z_$]/.test(ch) || ch.charCodeAt(0) > 127) {
      let j = i + 1; while (j < n && (/[\w$-]/.test(line[j]) || line.charCodeAt(j) > 127)) j++;
      // a trailing `-` belongs to the word only when followed by a word char (my-lang); `x-1` keeps the minus
      while (j > i + 1 && line[j - 1] === '-') j--;
      const w = line.slice(i, j);
      let k = j; while (k < n && line[k] === ' ') k++;
      if (KEYWORDS.has(w.toLowerCase()) && !(w.length <= 2 && /[A-Z]/.test(w))) push('kw', w);
      else if (line[k] === '(' ) push('fn', w);
      else if (w.length >= 2 && /^[A-Z][A-Z0-9_]+$/.test(w)) push('const', w);
      else push('id', w);
      i = j; continue;
    }
    // punctuation (one char at a time keeps it simple and correct)
    push('pun', ch); i++;
  }
  return { tokens, state: { block } };
}

/**
 * Tokenize a whole text. `prev` (from an earlier call) lets a caller reuse
 * lines whose text and incoming state did not change.
 * @param {string[]} lines
 * @param {string} lang
 * @returns {{tokens: Token[], stateIn: string}[]}
 */
export function tokenizeAll(lines, lang) {
  const out = new Array(lines.length);
  let state = { block: null };
  for (let i = 0; i < lines.length; i++) {
    const stateIn = state.block || '';
    const r = tokenizeLine(lines[i], state, lang);
    out[i] = { tokens: r.tokens, stateIn };
    state = r.state;
  }
  return out;
}

const SIG = {
  python: [/^\s*def \w+\s*\(.*\)\s*(->\s*[\w\[\], ]+)?:/m, /^\s*(if|elif|for|while|with|try)\b.*:\s*$/m, /\bprint\(/, /^\s*(import \w+|from \w+ import)/m, /\bself\b/, /\b(None|True|False)\b/, /^\s*(except|elif)\b/m, /^\s*class \w+(\(.*\))?:/m],
  javascript: [/\b(const|let|var)\s+\w+\s*=/, /=>/, /\bfunction\b/, /console\.\w+\(/, /;\s*$/m, /\b(require\(|module\.exports)/, /===|!==/, /\bdocument\.|\bwindow\./],
  typescript: [/:\s*(string|number|boolean|any|void|unknown)\b/, /\binterface \w+/, /\btype \w+\s*=/, /<[A-Z]\w*>\(/, /\bas (const|string|number)\b/, /\b(readonly|implements)\b/],
  go: [/^\s*func (\(\w+ \*?\w+\) )?\w+\(/m, /:=/, /^\s*package \w+/m, /\bfmt\.\w+/, /^\s*import \(/m, /\bnil\b/, /\berr != nil\b/],
  rust: [/^\s*(pub )?fn \w+(<.*>)?\(/m, /\blet mut\b/, /\w::\w/, /println!|format!|vec!/, /^\s*(impl|struct|enum|trait)\b/m, /&str|&mut |-> /],
  bash: [/^#!.*\b(ba|z|da)?sh\b/m, /^\s*echo\b/m, /\$\{?\w+\}?/, /^\s*(fi|done|esac)\s*$/m, /\|\s*(grep|awk|sed|sort)\b/, /^\s*(if|while) \[/m, /^\s*(cd|ls|mkdir|rm|cp|mv|cat|curl|git) /m],
  sql: [/\bSELECT\b[\s\S]*\bFROM\b/i, /\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE TABLE)\b/i, /\bWHERE\b/i, /\b(LEFT |INNER )?JOIN\b/i, /\bGROUP BY\b|\bORDER BY\b/i],
  c: [/#include\s*<\w+\.h>/, /\bint main\s*\(/, /\bprintf\(/, /\b(int|char|void|float|double|size_t)\s+\*?\w+\s*[(=;,]/, /\bmalloc\(|\bfree\(/],
  cpp: [/#include\s*<\w+>/, /\bstd::/, /\bcout\b|\bcin\b/, /\bclass \w+/, /\btemplate\s*</, /\bnullptr\b/],
  java: [/\bpublic (static )?(class|void|int|String|final)\b/, /System\.out\.print/, /\bnew \w+<?\w*>?\(/, /^\s*import java\./m, /\bString\[\] args\b/],
  ruby: [/^\s*def \w+[?!]?\s*(\(.*\))?\s*$/m, /^\s*end\s*$/m, /\bputs\b/, /\bdo \|\w+\|/, /^\s*require ['"]/m, /\.each\b/, /^\s*(attr_accessor|module) /m],
  html: [/<!doctype html>/i, /<\/?(div|span|html|body|head|p|a|ul|li|section|main|h[1-6])\b/i, /<\w+[^>]*>[\s\S]*<\/\w+>/],
  css: [/^\s*[.#]?[\w-]+(\s*[,>]\s*[.#]?[\w-]+)*\s*\{\s*$/m, /^\s*[\w-]+\s*:\s*[^;{]+;\s*$/m, /@media\b|@keyframes\b/, /\b(px|rem|em|vh|vw)\b/],
  json: [/^\s*\{[\s\S]*\}\s*$/, /"[\w-]+"\s*:/, /^\s*\[\s*\{/, /^\s*"[\w-]+"\s*:\s*(".*"|\d+|true|false|null|\{|\[),?\s*$/m],
};

/**
 * Sniff the language. Confidence is the share of signature patterns that
 * matched; under two hits the answer is `pseudo`.
 * @param {string} text
 * @returns {{lang: string, confidence: number}}
 */
export function detect(text) {
  const t = String(text || '').slice(0, 20000);
  if (!t.trim()) return { lang: 'pseudo', confidence: 0 };
  let best = 'pseudo';
  let bestScore = 0;
  let bestConf = 0;
  for (const [lang, pats] of Object.entries(SIG)) {
    let score = 0;
    for (const re of pats) if (re.test(t)) score++;
    if (lang === 'typescript' && score) score += SIG.javascript.filter((re) => re.test(t)).length * 0.5;
    if (lang === 'cpp' && score) score += SIG.c.filter((re) => re.test(t)).length * 0.5;
    if (score > bestScore) { best = lang; bestScore = score; bestConf = Math.min(1, score / pats.length); }
  }
  if (bestScore < 2) return { lang: 'pseudo', confidence: bestScore ? 0.2 : 0 };
  return { lang: best, confidence: bestConf };
}

/** True for a line head that a python-ish language ends with a colon. */
export function pythonHead(line) { return PY_HEAD.test(line); }

/** Normalise a language name the human typed: lowercase, 1–24 chars of [a-z0-9+#.-_]; '' when unusable. */
export function cleanLang(s) {
  const t = String(s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9+#._-]/g, '').slice(0, 24);
  return t.length >= 1 ? t : '';
}
