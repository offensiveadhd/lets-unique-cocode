/**
 * reach.js — the lines that reach outside the sandbox.
 *
 * A *reach* is a call the sandbox cannot perform: the network (`ping`, `dns`,
 * `fetch`), Claude's browser (`claude.browser(url)`), a web search, a research
 * or sub-agent task, Hermes, the shell, or Claude himself (`say`, `ask`). The
 * window marks those lines in the gutter and sends the run through Claude,
 * who performs each one for real with his own tools and streams what happened
 * (CONTRACT.md §10, GUIDE.md "Reach"). Nothing here runs anything.
 *
 * The spellings, in any language, real, invented or prose-like:
 *   claude.<verb>(…)  /  claude_<verb>(…)     the explicit namespace: any verb counts
 *   <verb>(…)                                  a bare verb from the vocabulary (VERBS)
 *   <verb> <argument>                           pseudo-code: `ping google.com`, `ping: google.com`,
 *                                               `(ping "google.com")`, `PING -> google.com`
 *   natural phrases                             `go to https://…`, `open google.com`, `search the web for …`,
 *                                               `find out who maintains lodash`, `claude, ping google.com`,
 *                                               `ask claude to research …`, `spawn an agent to …`, `shell: ls`
 *   $ cmd  /  ! cmd                             a shell line
 * plus the real libraries a language's sandbox would block (`requests`, `socket`,
 * `subprocess`, `child_process`, `webbrowser`, …). A verb the document defines
 * itself (`def ping(host):`) is the human's own function, not a reach, and a
 * verb the language's sandbox performs itself (`fetch` in javascript) is not
 * one either. Line heuristics only, no parser; never throws. This scan is a
 * hint for the window and for Claude: an invented language can phrase a reach
 * in words no regex knows, and the guide tells Claude to read for those too.
 *
 * Plain ES module; no dependencies. Also runs in Node (the unit test).
 */

/** What each kind means, in the words the gutter note and the Output pane use. */
export const REACH_KINDS = {
  net: 'the network',
  browser: "Claude's browser",
  search: 'a web search',
  research: 'a research agent',
  agent: 'a sub-agent',
  hermes: 'Hermes',
  shell: 'the shell',
  say: 'the chat',
  ask: 'a question for Claude',
  claude: 'Claude',
};

/** At most this many reaches per document (the first ones, by line). */
export const REACH_MAX = 50;

/** Bare verbs that mean a reach when called as `verb(`; the dotted ones match literally (`http.get(`). */
const VERBS = new Map(Object.entries({
  ping: 'net', traceroute: 'net', tracert: 'net', dns: 'net', nslookup: 'net', dig: 'net', whois: 'net', port_open: 'net',
  fetch: 'net', http_get: 'net', http_post: 'net', 'http.get': 'net', 'http.post': 'net', curl: 'net', wget: 'net', download: 'net',
  browser: 'browser', claude_browser: 'browser', browse: 'browser', visit: 'browser', open_url: 'browser', screenshot: 'browser',
  search: 'search', web_search: 'search', google: 'search',
  research: 'research', deep_research: 'research', investigate: 'research',
  agent: 'agent', subagent: 'agent', delegate: 'agent', spawn_agent: 'agent',
  hermes: 'hermes', glm: 'hermes', kimi: 'hermes',
  shell: 'shell', sh: 'shell', bash: 'shell', cmd: 'shell', powershell: 'shell', exec: 'shell', system: 'shell',
  say: 'say', notify: 'say',
  ask: 'ask', ask_claude: 'ask',
}));
/** Verbs a language's own sandbox performs: not a reach there (Node's permission model allows the network). */
const NATIVE = { javascript: new Set(['fetch', 'http.get', 'http.post']), typescript: new Set(['fetch', 'http.get', 'http.post']) };
/** The language families the library patterns apply to. */
const FAMILY = { python: 'python', py: 'python', python3: 'python', javascript: 'javascript', js: 'javascript', node: 'javascript', mjs: 'javascript', typescript: 'javascript', ts: 'javascript' };
/** Real libraries the sandbox blocks: [pattern, kind, name?]; the name defaults to the first capture. */
const LIBS = {
  python: [
    [/\b(requests|httpx|aiohttp)\.\w+\(/, 'net'],
    [/\b(urllib)\.request\.\w+\(|\b(urlopen)\(/, 'net', 'urllib'],
    [/\b(socket)\.(?:socket|create_connection|gethostbyname|getaddrinfo)\(/, 'net'],
    [/\b(http\.client)\.\w+\(/, 'net'],
    [/\b(smtplib|ftplib|paramiko|telnetlib|imaplib|poplib)\.\w+\(/, 'net'],
    [/\b(subprocess)\.(?:run|call|check_output|check_call|Popen)\(/, 'shell'],
    [/\b(os\.system|os\.popen)\(/, 'shell'],
    [/\b(webbrowser)\.open\w*\(/, 'browser'],
    [/\b(playwright|selenium|pyppeteer)\b/, 'browser'],
  ],
  javascript: [
    [/\b(child_process)\b|\b(execSync|spawnSync|execFile|execFileSync)\(/, 'shell', 'child_process'],
    [/\b(net|tls)\.(?:connect|createConnection)\(|\b(dgram)\.createSocket\(/, 'net', 'net'],
    [/\b(puppeteer|playwright)\b/, 'browser'],
  ],
};

const VERB_RE = new RegExp(`(?<![\\w.$])(${[...VERBS.keys()].map((v) => v.replace('.', '\\.')).join('|')})\\s*\\(`, 'g');
const NS_RE = /\bclaude[._]([A-Za-z_][\w.]*?)\s*\(/g;
const SHELL_RE = /^\s*[$!] +(\S.*)$/;
const SKIP_RE = /^\s*(?:#|\/\/|--|;|\/\*|\*|<!--|\?\?)/;
const DEF_RES = [
  /^\s*(?:async\s+|pub\s+|export\s+|static\s+)*(?:def|function|fn|func|sub|proc|procedure|method)\s+([A-Za-z_]\w*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_]\w*\s*=>)/,
  /^\s*([A-Za-z_]\w*)\s*=\s*lambda\b/,
];

/*
 * Natural forms: the line starts (after indentation, a bullet or a number, an optional opening
 * bracket) with a verb or a phrase and an argument. The separator between them may be a space,
 * `:`, `=`, `!`, `->`, `=>` or `<-`, so `ping: google.com`, `(ping "google.com")` and
 * `PING -> google.com` all read as `ping google.com`. Case does not matter. Each entry:
 * [pattern, kind, name|null]; a null name takes the matched verb (lower-cased).
 */
const LEAD = String.raw`^\s*(?:[-•>]\s+|\d+[.)]\s+)?[(\[{]?\s*`;
const SEP = String.raw`\s*(?:->|=>|<-|[:=!])?\s*(?!->|=>|<-|[:=!>])`;   // the two-character arrows first; the argument never starts with a separator
const URL = String.raw`(?:https?://\S+|www\.\S+|[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|edu|gov|co|uk|de|il|info|app|ai|me|xyz|fr|es|it|nl|ch|us|ca|au|jp|cn|ru)\b\S*)`;
const nat = (s) => new RegExp(`${LEAD}${s}\\s*$`, 'i');
const NATURAL = [
  [nat(`(ping|traceroute|tracert|nslookup|dig|whois|curl|wget)${SEP}(\\S.*)`), 'net', null],
  [nat(`(?:fetch|download|get|request|call|hit|post|read|load)\\s+(?:the\\s+)?(?:page\\s+|url\\s+|from\\s+|at\\s+)?(${URL}.*)`), 'net', 'fetch'],
  [nat(`(?:browse|visit|navigate(?:\\s+to)?|go\\s*to|goto|open|show(?:\\s+me)?)\\s+(?:the\\s+)?(?:page\\s+|site\\s+|url\\s+|at\\s+)?(${URL}.*)`), 'browser', 'browser'],
  [nat(`(?:open|launch|start)\\s+(?:the\\s+|a\\s+|claude'?s\\s+)?browser\\b${SEP}(.*)`), 'browser', 'browser'],
  [nat(`screenshot\\s+(?:of\\s+)?(\\S.*)`), 'browser', 'screenshot'],
  [nat(`(?:search\\s+(?:the\\s+)?(?:web|internet|online|google)(?:\\s+for)?|google|web\\s*search)${SEP}(\\S.*)`), 'search', 'search'],
  [nat(`(?:research|investigate|find\\s+out\\s+(?:about\\s+)?(?=(?:who|what|why|how|where|when|which|whether|if|the|an?)\\b)|deep[\\s-]?dive(?:\\s+(?:into|on))?)${SEP}(\\S.*)`), 'research', 'research'],   // the question word stays in the topic: "who maintains lodash"
  [nat(`(?:delegate|spawn\\s+(?:an?\\s+)?(?:sub)?agent(?:\\s+to)?|(?:ask|have|use)\\s+(?:an?\\s+)?(?:sub)?agent(?:\\s+to)?|(?:sub)?agent)${SEP}(\\S.*)`), 'agent', 'agent'],
  [nat(`(?:(?:ask|use|tell)\\s+)?(hermes|glm|kimi)(?:\\s+to)?${SEP}(\\S.*)`), 'hermes', null],
  [nat(`(?:run|execute|exec)\\s+(?:the\\s+)?(?:command|cmd|shell)${SEP}(\\S.*)`), 'shell', 'shell'],
  [nat(`(?:shell|sh|bash|cmd|powershell|terminal)\\s*:\\s*(\\S.*)`), 'shell', 'shell'],
  [nat('(?:run|exec(?:ute)?)\\s+`([^`]+)`.*'), 'shell', 'shell'],
  [nat(`(?:notify|alert)\\s+me${SEP}(.*)`), 'say', 'say'],
];
/** `claude, ping google.com` · `ask claude to research …` · `claude: open https://…` · `tell claude hello`: the verb is the next word. */
const CLAUDE_RE = nat(`(?:ask|tell|let|have|make|get)?\\s*claude\\b\\s*(?:->|=>|<-|[,:._!=])?\\s*(?:to\\s+|please\\s+)?(\\S.*)`);

/**
 * @typedef {{line:number, kind:string, name:string, args:string[], raw:string}} Reach
 * line 1-based; kind one of REACH_KINDS; name the verb as written (`ping`, `claude.browser`, `requests`);
 * args the call's arguments as written, quotes stripped (≤ 8, each ≤ 200 chars); raw the line (≤ 200 chars).
 */

/**
 * Scans the document for reaches. Pure, linear, never throws.
 * @param {string} text
 * @param {string} [lang]
 * @returns {Reach[]} sorted by line, at most REACH_MAX
 */
export function scanReach(text, lang = 'pseudo') {
  const lines = String(text ?? '').split('\n');
  const family = FAMILY[String(lang || '').toLowerCase()] || null;
  const native = NATIVE[String(lang || '').toLowerCase()] || null;
  const defined = definedNames(lines);
  const out = [];
  for (let i = 0; i < lines.length && out.length < REACH_MAX; i++) {
    const line = lines[i];
    if (!line.trim() || SKIP_RE.test(line)) continue;
    const found = [];
    for (const m of line.matchAll(NS_RE)) found.push({ index: m.index, end: m.index + m[0].length, name: `claude.${m[1]}`, kind: VERBS.get(m[1]) || 'claude' });
    for (const m of line.matchAll(VERB_RE)) {
      const verb = m[1];
      if (defined.has(verb) || (native && native.has(verb))) continue;
      if (found.some((f) => m.index >= f.index && m.index < f.end)) continue;
      found.push({ index: m.index, end: m.index + m[0].length, name: verb, kind: VERBS.get(verb) });
    }
    if (family) for (const [re, kind, fixed] of LIBS[family]) {
      const m = re.exec(line);
      if (!m) continue;
      if (found.some((f) => m.index >= f.index && m.index < f.end)) continue;
      const name = fixed || m.slice(1).find((g) => g) || m[0];
      found.push({ index: m.index, end: m.index + m[0].length, name, kind, lib: true });
    }
    if (!found.length) {
      const n = natural(line, defined);
      if (n) out.push(reach(i + 1, n.kind, n.name, [n.arg], line));
      continue;
    }
    found.sort((a, b) => a.index - b.index);
    for (const f of found) {
      if (out.length >= REACH_MAX) break;
      out.push(reach(i + 1, f.kind, f.name, f.lib ? [] : argsAt(line, f.end), line));
    }
  }
  return out;
}

/** One line of a reach for a title or a system line: `ping google.com`, `claude.browser https://…`. */
export function describeReach(r) {
  const args = (r.args || []).join(', ');
  return clip(`${r.name}${args ? ` ${args}` : ''}`, 120);
}

/** `ping google.com — reaches the network. Claude does it for real when you Run.` */
export function explainReach(r) {
  const what = REACH_KINDS[r.kind] || REACH_KINDS.claude;
  return `${describeReach(r)} — reaches ${what}. Claude does it for real when you Run.`;
}

/** A line in words (no call syntax): a natural form, a shell line, or Claude addressed by name. */
function natural(line, defined) {
  const sh = SHELL_RE.exec(line);
  if (sh) return { kind: 'shell', name: '$', arg: sh[1].trim() };
  const c = CLAUDE_RE.exec(line);
  if (c) {
    const rest = tidy(c[1]);
    const first = (rest.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z_.]/g, '');
    const inner = first ? naturalPhrase(rest, defined) : null;
    const kind = VERBS.get(first) || inner?.kind || 'claude';
    const arg = VERBS.has(first) ? tidy(rest.slice(first.length)) : inner ? inner.arg : rest;
    return { kind, name: `claude.${first || 'do'}`, arg };
  }
  return naturalPhrase(line, defined);
}
function naturalPhrase(line, defined) {
  for (const [re, kind, fixed] of NATURAL) {
    const m = re.exec(line);
    if (!m) continue;
    const verb = fixed || (m[1] || '').toLowerCase();
    if (!fixed && defined.has(verb)) continue;
    const arg = tidy(fixed ? m[1] : m[2]);
    if (!arg && kind !== 'browser') continue;
    return { kind, name: verb, arg };
  }
  return null;
}
/** Trims an argument written in words: trailing closers and punctuation, outer quotes. */
function tidy(s) { return unquote(String(s ?? '').trim().replace(/[)\]}.;,]+$/, '').trim()); }

function reach(line, kind, name, args, raw) {
  return { line, kind, name: clip(name, 60), args: args.filter((a) => a).slice(0, 8).map((a) => clip(a, 200)), raw: clip(raw.trim(), 200) };
}
function clip(s, n) { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; }

/** Names the document defines itself (`def ping(`, `function ping(`, `const ping = (`), lower-cased too for the bare form. */
function definedNames(lines) {
  const set = new Set();
  for (const line of lines) for (const re of DEF_RES) { const m = re.exec(line); if (m) { set.add(m[1]); set.add(m[1].toLowerCase()); break; } }
  return set;
}

/** The arguments of the call whose `(` ends at `start`: top-level commas split, quotes stripped, up to the matching `)` or the line's end. */
function argsAt(line, start) {
  let depth = 0;
  let quote = '';
  let cur = '';
  const args = [];
  const push = () => { const a = cur.trim(); if (a) args.push(unquote(a)); cur = ''; };
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (quote) { cur += c; if (c === '\\' && i + 1 < line.length) { cur += line[++i]; } else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { push(); continue; }
    cur += c;
  }
  push();
  return args;
}
function unquote(s) {
  const q = s[0];
  return (q === '"' || q === "'" || q === '`') && s.length >= 2 && s[s.length - 1] === q ? s.slice(1, -1) : s;
}
