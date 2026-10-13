# cocode — build contract

The behaviour spec of **cocode**, the code window you talk through. The shell (companion, chat, components, toasts) and the theme are the engine's: see [docs/UI-CONTRACT.md](https://github.com/TikoTikTok/lets/blob/main/docs/UI-CONTRACT.md) in the lets repo. Engine requirement: lets **0.4.0** or later (handoff sessions). Nothing here needs a new engine endpoint.

## 0 The idea

The human types in any language: a real one, one that does not exist, or plain pseudo-code. The window never judges it. Three things happen around what they type:

1. **Prediction.** Claude reads each settled change and offers the next lines as a *ghost*: dim, italic, slightly blurred text at the caret that is not in the document until the human accepts it (`Tab`). When Claude is away, a small local predictor offers weaker ghosts so the page still feels alive. An empty editor shows *seeds*: starting points Claude draws from memory and saved sessions.
2. **The build.** While the human types, Claude prepares the **real program** (Python, JavaScript, …) for the current revision in the background and sends it to the Build pane. **Run** then executes that build at once instead of starting from zero; output streams into the Output pane.
3. **Talking in code.** *Ask* and *Send to Claude* carry the code as the message. Claude identifies what the human means with it (a question, something to explain, something to do, a bug, a note) and answers in that register.

cocode stores nothing on the host. The document lives in the window (and in a saved session after *Send to Claude*).

## 1 Model

```jsonc
{
  "rev": 12,                              // increments on every change to the text (human or Claude)
  "text": "for each user in users:\n  if user is new:\n    send welcome",
  "lang": "pseudo",                       // the language chip: detected or set by the human/Claude
  "detected": true,                       // false when the human or Claude set it
  "cursor": { "line": 3, "col": 16 },     // 1-based line, 0-based column (characters)
  "selection": { "from": {"line":2,"col":0}, "to": {"line":3,"col":16} } | null,
  "build": { "rev": 11, "lang": "python", "code": "…", "status": "ready", "file": "welcome.py", "notes": "…", "at": 1791… } | null,
  "runs": [{ "id": "r_12_1", "rev": 12, "buildRev": 11, "lang": "python", "at": 1791…, "ms": 420, "exit": 0,
             "stdout": "…", "stderr": "", "status": "done" }],   // newest last, at most 10
  "annotations": [{ "line": 2, "kind": "note", "text": "…" }],
  "stats": { "accepted": 4, "rejected": 2, "acceptedLocal": 1 }
}
```

- Lines are 1-based everywhere, columns 0-based, in characters of the line.
- `text` is at most 64 000 characters in any event (`truncated: true` and the tail is kept when longer).
- `lang` is free text, 1–24 characters, lowercase, `a-z0-9+#.-_` (`python`, `js`, `my-lang`, `pseudo`). The window detects `python javascript typescript go rust bash sql c cpp java ruby html css json pseudo` by heuristics and shows `pseudo` when nothing scores.
- Build status: `building | ready | failed`. The pane also shows **stale** when `build.rev < rev` (derived, never sent).
- Run status: `running | done | failed | lost` (`lost` = no output for 60 s).
- `rev` starts at 1 on an empty editor and never goes down. A load (resume) bumps it like any change.

## 2 Events (cocode → Claude). Each one says what the human meant.

| type | data | the human… |
|---|---|---|
| `cocode.changed` | `{rev, text, lang, detected, cursor, selection, lines, prefix, by:"human"\|"claude"\|"restore", delta?:{from, to, text}}` | typed, pasted, accepted a ghost, undid, or Claude's command changed the text. Debounced **500 ms** after the last keystroke, settled text only. `prefix` is the last line's text up to the caret (≤ 200 chars). `delta` is the changed line range when known. |
| `cocode.ghost.accept` | `{rev, source:"claude"\|"local", text, partial}` | pressed `Tab` (whole ghost) or `Ctrl+→` (`partial:true`, one word) |
| `cocode.ghost.reject` | `{rev, source:"claude", reason:"esc"\|"typed-away"\|"moved"}` | pressed `Esc`, typed something else, or moved the caret off the anchor. Only Claude's ghosts report rejects; a dismissed local ghost is silent |
| `cocode.ghost.request` | `{rev, text, lang, cursor, prefix}` | pressed **Suggest** (`Alt+\`) or picked it from Doto's menu: wants a ghost now |
| `cocode.build.request` | `{rev, text, lang, target}` | picked a target language in the Build pane or pressed **Prepare**; `target` is `auto` or a language name |
| `cocode.run` | `{run, rev, text, lang, build?:{rev, lang, code, status}}` | pressed **Run** (`Ctrl+Enter`). `run` is the window's id for this run (`r_<rev>_<n>`). `build` is the latest build if any, stale or not |
| `cocode.ask` | `{question, rev, text, lang, line, selection?, source:"toolbar"\|"inline"\|"menu"}` | pressed **Ask** (`Ctrl+K`), ended a `??` line with `Enter` (`source:"inline"`, `question` = the line without the `??`), or picked a question from Doto's menu |
| `cocode.export` | `{label, intent, text, truncated?, lang, detected, rev, cursor, selection, build?, runs?, annotations?, stats}` | pressed **Send to Claude**: a handoff. `intent` is `auto` or what they picked: `ask \| explain \| do \| fix \| review \| note`. `runs` carries at most the last 3, output tails of 2 000 chars. The engine prepends `session {id, handoff, saved, summary}` |
| `cocode.snapshot` | the export payload without `intent` | nothing: it is the reply to the `cocode.snapshot` command (`re` = command id) |

`label` is the first non-empty line (≤ 60 chars) plus the language, e.g. `for each user in users · pseudo`: the saved session's summary. When `text` is longer than 64 000 characters the start is dropped, the tail is sent and `truncated` is `true`.

## 3 Commands (Claude → cocode)

| type | data | effect |
|---|---|---|
| `cocode.suggest` | `{rev, text, at?:{line,col}, alternatives?:string[], reason?, seq?, done?}` | Shows `text` as the ghost at the caret (or at `at`). Chunks with the same `re` or `rev` and `seq` append; `done:true` ends the stream. A ghost for a `rev` older than the current one shows only while the text before the caret still matches the `prefix` that rev reported; otherwise it is dropped silently (no reject event). `text:""` clears the ghost. `alternatives` are cycled with `Alt+]` / `Alt+[`. At most 12 lines; longer texts are cut. |
| `cocode.seed` | `{items:[{id, label, text, lang?, hint?}]}` | Replaces the *start from* list shown while the editor is empty (≤ 6 items). Picking one inserts `text`, sets `lang` if given, and emits `cocode.changed` as a human change. Ignored when the editor has text (kept for the next time it is empty). |
| `cocode.build` | `{rev, lang, code, status?, file?, notes?, seq?, done?}` | Puts the real program in the Build pane. `status` defaults to `ready`; `building` shows a spinner and may carry no `code`; `failed` shows `notes` as the reason. A message with `seq` for the same `rev` as the current build appends its `code`; a message without `seq`, or for another `rev`, replaces the build. A loaded build (resume) is re-based on the new window's `rev`: fresh when it matched the saved text's rev, stale otherwise. |
| `cocode.output` | `{run, stream:"stdout"\|"stderr"\|"system", text, seq?, done?, exit?, ms?}` | Appends to the run named by `run` in the Output pane (a run id the window never issued creates an entry named by Claude). `done:true` closes it: `exit` 0 shows *ok*, anything else *failed*; `ms` is shown when given. `system` lines render dim (e.g. "building first…"). Chunks are ordered by `seq` when present. |
| `cocode.insert` | `{at:{line,col}\|"cursor"\|"end", text}` | Inserts text, animated (the new lines glow 600 ms). Goes on the undo stack. `rev` bumps and `cocode.changed {by:"claude"}` follows. |
| `cocode.replace` | `{from, to, text}` | Replaces lines `from`–`to` (1-based, inclusive) with `text`. Animated, undoable. `to` defaults to `from`. |
| `cocode.set` | `{text, lang?}` | Replaces the whole document. Undoable, animated (a fade), and the human's text is gone from view, so the guide asks Claude to confirm first. |
| `cocode.lang` | `{lang}` | Sets the language chip (`detected:false`). |
| `cocode.annotate` | `{line, text, kind?:"note"\|"ok"\|"warn"\|"error"}` | A marker in the gutter and a floating note that opens on hover, focus or click; the note also lists in the Output pane under *Notes*. `text:""` removes that line's note; `line:0` clears all. |
| `cocode.highlight` | `{from, to?, color?, ttl?}` | Glows lines `from`–`to`. `ttl` defaults to 4000; `0` keeps; `from:0` clears every glow. |
| `cocode.focus` | `{line, col?}` | Scrolls the line into view and puts the caret there (smooth; instant under reduced motion). |
| `cocode.load` | `{text, lang?, build?, runs?, annotations?, cursor?}` | The restore command: renders the payload (a session's export) without emitting ghost or accept events, bumps `rev`, emits `cocode.changed {by:"restore"}`. A load in the first 8 s after boot wins over the sessionStorage draft. |
| `cocode.snapshot` | `{}` | Replies with a `cocode.snapshot` event. |

All commands are idempotent, animate (≤ 300 ms, transform and opacity only) and accept `"ack": true` on the envelope (`lip.ack {ok, error?}`). A bad command without `ack` answers `lip.error {code:"bad_request", message, re}`. Unknown line numbers are clamped to the document (1…lines), never an error, except in `cocode.annotate` where `line` beyond the end is an error.

## 4 Flows

**Predict (the loop).** Human types → 500 ms quiet → `cocode.changed`. Meanwhile the local predictor (250 ms) may already show a weak ghost, labelled *local* in the status line. When `cocode.suggest` arrives for the current rev it replaces the local ghost. Typing characters that match the ghost's start shrinks the ghost instead of dismissing it. Any other key dismisses it (`typed-away`), as does moving the caret (`moved`) or `Esc` (`esc`). `Tab` accepts all of it (indentation of the first line is re-based on the current line), `Ctrl+→` accepts the first word. An accept is a human change: `rev` bumps and `cocode.changed` follows. The status line shows the ghost's source and the window never shows two ghosts.

**Build ahead.** Claude may send `cocode.build` at any time. The pane shows `lang`, `rev` and status; when the editor's `rev` moves past `build.rev` the status reads *stale for rev N* in dim text and the code stays. The target select (`auto`, `python`, `javascript`, `typescript`, `bash`, `go`, `rust`, or a typed name) emits `cocode.build.request`.

**Run.** `Ctrl+Enter` or **Run** → a new run entry (`running`) at the top of the Output pane, `cocode.run` with the latest build attached. Output chunks append live, `done` closes it. If the host is not connected, the window toasts and does nothing. If Claude is away (`shell.listening === false`), the entry still opens and a toast says "Doto is away. The run starts with your next message in Claude Code." (at most once per 30 s). A run with no output for 60 s shows *no answer yet* (`lost`); output that arrives later puts it back to `running`, and `done:true` closes it as usual (`done` or `failed`).

**Ask.** `Ctrl+K` opens a one-line form under the toolbar (the question, and a chip naming the current line or the selection). `Enter` on a line that starts with `??` (after whitespace) emits `cocode.ask {source:"inline"}` without opening the form: the line stays in the document as the human's note. Answers come in chat; Claude may `cocode.annotate` the lines it cites.

**Send to Claude (handoff).** The intent select next to the button offers *you decide* (default), *a question*, *explain this*, *do this*, *fix this*, *review this*, *just a note*. Pressing the button emits `cocode.export`; the engine saves it as a session and closes the window; `cheer` plays. A resumed window gets `cocode.load` with that payload.

**Draft.** The text, lang and pane state are kept in `sessionStorage["lets.cocode.draft"]` for this tab (a reload keeps the code). `localStorage["lets.cocode"]` holds preferences (rail open/closed, font size, wrap) and the last 10 *recents* `{label, text, lang, at}` (a recent is recorded on Run and on Send). Nothing else is stored.

## 5 The page

Files: `ui/index.html`, `ui/cocode.js` (the window), `ui/editor.js` (textarea + highlight layer + ghost + undo), `ui/syntax.js` (tokenizer and language detection), `ui/predict.js` (local predictor), `ui/style.css`.

- **Look.** Deep violet, the `--lets-*` variables re-declared as fallbacks, the dotted grid behind the editor. Monospace 13 px, line height 20 px, no wrapping by default (horizontal scroll), `tab-size: 4`.
- **Toolbar** (sticky glass, `role="toolbar"`): status dot, "cocode", the **language chip** (a button; click to type a language name, `Enter` sets it, `Esc` cancels, empty = back to detected), then **Suggest**, **Run**, **Ask**, the intent select + **Send to Claude**; right end: Undo, Redo, Build, Output, chat, companion, `?`.
- **Editor.** A gutter with line numbers and annotation markers; a scrolling surface where a transparent `<textarea>` (caret and selection visible) sits over a `<pre>` highlight layer with identical metrics. The current line is tinted. Glows are absolutely positioned bars behind the text, one per line. The ghost's first line renders inline after the caret; further lines render in a floating *ghost block* under the caret line, left edge at the caret line's indentation, translucent glass, rotated −0.6°, uneven corner radii (the "curved" look), text in cyan at 55 % opacity, italic, `filter: blur(.3px)`. The block never covers the toolbar or the rail and flips above the line when there is no room below.
- **Empty state.** Over the editor: "Type in any language. Even one that doesn't exist." plus the *start from* list: Claude's seeds, then local recents (`localStorage`), each a button with the label, a lang badge and a two-line preview. `Esc` or typing hides it.
- **Status line** (bottom of the editor): `Ln 3, Col 16 · 12 lines · rev 12 · ghost: claude | local | — · build: ready rev 11 | stale rev 9 | building | failed | — `, plus `Tab moves focus` while `Ctrl+M` is on.
- **Rail** (right, 38 % min 300 px) with two stacked panes, **Build** and **Output**, each with a header (title, status pill, buttons) and a collapsible body. Build: the target select, **Prepare**, **Copy**, the code in `<pre class="lets-pre">` (highlighted with the same tokenizer), `notes` under it. Output: run entries newest first (id, lang, rev, duration, exit pill, a `<pre>` with stdout then stderr in a dim red), then *Notes* (annotations). Below 1100 px the rail becomes a bottom drawer of 36 % height with Build | Output tabs. The rail collapses to a 36 px strip with `Ctrl+B` (Build) / `Ctrl+J` (Output) toggling each pane.
- **Ask form** under the toolbar, like den's: input, an *about* chip (`line 3` or `lines 2–7`), **Ask**.
- **Help overlay** (`?`) lists the shortcuts.

**Keyboard** (editor focused unless noted)

| key | does |
|---|---|
| `Tab` | accept the ghost; otherwise insert two spaces (indent the selection's lines) |
| `Shift+Tab` | outdent |
| `Ctrl+→` | accept the ghost's first word |
| `Alt+]` / `Alt+[` | next / previous alternative |
| `Esc` | dismiss the ghost; then close the innermost open thing (ask form, note, help, empty state) |
| `Alt+\` | ask for a ghost now (`cocode.ghost.request`) |
| `Enter` | new line with the current indentation, plus one level after a line ending in `:` or `{` or `(`; on a `??` line also emits `cocode.ask` |
| `Ctrl+Enter` | Run |
| `Ctrl+K` | Ask |
| `Ctrl+Shift+Enter` | Send to Claude |
| `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` | undo / redo (own stack, 200 steps, typing coalesced within 600 ms) |
| `Ctrl+D` | duplicate the line (or selection) |
| `Alt+↑` / `Alt+↓` | move the line (or selection) |
| `Ctrl+;` | comment the line (or the selected lines) with the language's marker (`#` for python/bash/pseudo, `//` otherwise); again to uncomment |
| `Ctrl+/` | shell: chat |
| `Ctrl+B` / `Ctrl+J` | toggle the Build / Output pane |
| `Ctrl+M` | toggle *Tab moves focus*: the editor stops trapping `Tab` so the keyboard can leave it (the status line says so) |
| `?` (outside the editor) | shortcuts overlay |
| `1` / `2` (outside the editor) | focus the editor / the Output pane |

Everything is reachable with Tab in DOM order (leave the editor with `Ctrl+M`, or `Shift+Tab` from the first position) and every control has an accessible name. The textarea has `aria-label="Code"` and Claude's ghosts are announced once through a polite live region ("Suggestion: …").

## 6 Companion

- `context(info)` returns `{lang, rev, line, col, lineText, selection, hasGhost, ghostSource, build:{rev,status,lang}|null, lastRun:{id,exit}|null, lines}`.
- `quickSuggestions(ctx)` offers: "Finish this" (`cocode.ghost.request`), "Explain this line" / "Explain the selection" (`cocode.ask`), "Run it" (local: Run), "Show the real code" (local: opens the Build pane; emits `cocode.build.request {target:"auto"}` when there is no build), "Open chat". Pick ids start with `cocode.` and run once.
- Reactions, at most one per human action: `wink` on a ghost accept, `nod` when a build arrives `ready`, `cheer` when a run ends with exit 0, `oops` when a run fails, `sparkle` when the human accepts three ghosts in a row, `cheer` on Send to Claude.
- Moods are Claude's to set; the page never emits or handles `entity.*`, `chat.*`, `component.*`, `ui.*`.

## 7 Local predictor (`ui/predict.js`)

`predict(text, cursor, lang) → {text, reason} | null`, synchronous, < 2 ms for 64 KB. Rules, first hit wins:

1. **Closers.** Unbalanced `(`, `[`, `{` on the caret line → the missing closers (plus `:` after a python `def`/`if`/`for` line head).
2. **Pairs.** The previous block opened with `if`/`try`/`for`/`while` (python, pseudo) and the caret is on a fresh line at the block's indentation → `else:`, `except Exception as e:`, or nothing for loops. JS-like: `} else {`, `} catch (e) {`.
3. **Sequences.** Two or more previous lines that differ only in a number or a letter (`step 1`, `step 2`) → the next one.
4. **Echo.** The caret line (≥ 3 chars) is the start of an earlier, longer line → the rest of that line.
5. **Repeat shape.** The two previous lines start with the same bullet marker (`-`, `*`, `•`, `>`) or with consecutive numbers (`1.`, `2.`) → that marker, or the next number.

Local ghosts never exceed 2 lines and carry `source:"local"`.

## 8 Quality bar

- No console errors in Chromium or Edge; the page works without the shell (no companion) and without a host (offline: everything local, no Run/Ask/Send).
- Rendering stays smooth at 2 000 lines: the highlight layer re-renders only the changed lines when the delta is known, in a `requestAnimationFrame`.
- Animation uses transform and opacity only; reduced motion is honoured.
- Plain ES modules with JSDoc, no build step, no CDN, no inline `<script>` (CSP `script-src 'self'`), no `eval`, no user content through `innerHTML`.
- Looks right at 800×600 (the app's browser pane) and at 375 px wide (the rail becomes the drawer, the toolbar wraps).
