# cocode — build contract

The behaviour spec of **cocode**, the code window you talk through. The shell (companion, chat, components, toasts) and the theme are the engine's: see [docs/UI-CONTRACT.md](https://github.com/TikoTikTok/lets/blob/main/docs/UI-CONTRACT.md) in the lets repo. Engine requirement: lets **0.4.0** or later (handoff sessions). The local runner (§9) is feature-detected and needs lets **0.7.0** ([docs/RUNNER.md](https://github.com/TikoTikTok/lets/blob/main/docs/RUNNER.md)); without it everything goes through Claude as before. Note: the manifest declares `permissions.exec`, a key engines before 0.7.0 do not know, and their manifest check (`permissions` allows no other keys) refuses the unique.

## 0 The idea

The human types in any language: a real one, one that does not exist, or plain pseudo-code. The window never judges it. Three things happen around what they type:

1. **Prediction.** Claude reads each settled change and offers the next lines as a *ghost*: dim, italic, slightly blurred text at the caret that is not in the document until the human accepts it (`Tab`). When Claude is away, a small local predictor offers weaker ghosts so the page still feels alive. An empty editor shows *seeds*: starting points Claude draws from memory and saved sessions.
2. **The build.** While the human types, Claude prepares the **real program** (Python, JavaScript, …) for the current revision in the background and sends it to the Build pane. **Run** then executes that build at once instead of starting from zero; output streams into the Output pane. With the engine's local runner (§9) and the human's OK, Run executes Python and JavaScript on this machine itself, in milliseconds, and a chip that names one of those languages makes the text its own build *as written*.
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
  "build": { "rev": 11, "lang": "python", "code": "…", "status": "ready", "source": "claude", "file": "welcome.py", "notes": "…", "at": 1791… } | null,
  "runs": [{ "id": "r_12_1", "rev": 12, "buildRev": 11, "lang": "python", "at": 1791…, "ms": 420, "exit": 0,
             "stdout": "…", "stderr": "", "status": "done",
             "sandbox": "audit-hook", "killed": null }],   // newest last, at most 10; sandbox and killed only on local runs
  "annotations": [{ "line": 2, "kind": "note", "text": "…" }],
  "stats": { "accepted": 4, "rejected": 2, "acceptedLocal": 1 }
}
```

- Lines are 1-based everywhere, columns 0-based, in characters of the line.
- `text` is at most 64 000 characters in any event (`truncated: true` and the tail is kept when longer).
- `lang` is free text, 1–24 characters, lowercase, `a-z0-9+#.-_` (`python`, `js`, `my-lang`, `pseudo`). The window detects `python javascript typescript go rust bash sql c cpp java ruby html css json pseudo` by heuristics and shows `pseudo` when nothing scores.
- Build status: `building | ready | failed`. The pane also shows **stale** when `build.rev < rev` (derived, never sent).
- Build source: `claude` (a `cocode.build`) or `local` (the editor's text, as written, §9). It is kept in snapshots, exports and `cocode.load`; a build without one is `claude`.
- A local run carries `sandbox` (the runner's isolation level: `audit-hook`, `node-permission`) and `killed` (`null | timeout | output`); its `exit` is `null` when the runner killed it. Claude's runs have neither.
- Run status: `running | done | failed | lost` (`lost` = no output for 60 s).
- `rev` starts at 1 on an empty editor and never goes down. A load (resume) bumps it like any change.

## 2 Events (cocode → Claude). Each one says what the human meant.

| type | data | the human… |
|---|---|---|
| `cocode.changed` | `{rev, text, lang, detected, cursor, selection, lines, prefix, by:"human"\|"claude"\|"restore", delta?:{from, to, text}}` | typed, pasted, accepted a ghost, undid, or Claude's command changed the text. Debounced **500 ms** after the last keystroke, settled text only. `prefix` is the last line's text up to the caret (≤ 200 chars). `delta` is the changed line range when known; when several changes merged into one event it carries the merged range without `text`. |
| `cocode.ghost.accept` | `{rev, source:"claude"\|"local", text, partial}` | pressed `Tab` (whole ghost) or `Ctrl+→` (`partial:true`, one word) |
| `cocode.ghost.reject` | `{rev, source:"claude", reason:"esc"\|"typed-away"\|"moved"}` | pressed `Esc`, typed something else, or moved the caret off the anchor. Only Claude's ghosts report rejects; a dismissed local ghost is silent |
| `cocode.ghost.request` | `{rev, text, lang, cursor, prefix, source:"toolbar"\|"key"\|"menu"}` | pressed **Suggest** (`Alt+\`) or picked it from Doto's menu: wants a ghost now |
| `cocode.build.request` | `{rev, text, lang, target}` | picked a target language in the Build pane or pressed **Prepare**; `target` is `auto` or a language name |
| `cocode.run` | `{run, rev, text, lang, build?:{rev, lang, code, status, source}}` | pressed **Run** (`Ctrl+Enter`) and the window could **not** run it itself (§9: no runner; a build that is missing, still building or in a language the runner does not run here; *Not now* on the consent card; the runner was `busy` or the language `unavailable`). `run` is the window's id for this run (`r_<rev>_<n>`). `build` is the latest build if any, stale or not |
| `cocode.ran` | `{run, rev, buildRev, lang, sandbox, exit, ms, timedOut, killed, stdout, stderr}` | pressed **Run** and the window ran the build **on this machine** through the local runner (§9); the run is over and its output is already in the Output pane. `stdout` / `stderr` are the last 4 000 characters (a leading `…` when cut). Sent instead of `cocode.run`, never with it |
| `cocode.ask` | `{question, rev, text, lang, line, selection?, source:"toolbar"\|"inline"\|"menu"}` | pressed **Ask** (`Ctrl+K`), ended a `??` line with `Enter` (`source:"inline"`, `question` = the line without the `??`), or picked a question from Doto's menu |
| `cocode.export` | `{label, intent, text, truncated?, lang, detected, rev, cursor, selection, build?, runs?, annotations?, stats}` | pressed **Send to Claude**: a handoff. `intent` is `auto` or what they picked: `ask \| explain \| do \| fix \| review \| note`. `runs` carries at most the last 3, output tails of 2 000 chars. The engine prepends `session {id, handoff, saved, summary}` |
| `cocode.snapshot` | the export payload without `intent` | nothing: it is the reply to the `cocode.snapshot` command (`re` = command id) |

`label` is the first non-empty line (≤ 60 chars) plus the language, e.g. `for each user in users · pseudo`: the saved session's summary. When `text` is longer than 64 000 characters the start is dropped, the tail is sent and `truncated` is `true`.

## 3 Commands (Claude → cocode)

| type | data | effect |
|---|---|---|
| `cocode.suggest` | `{rev, text, at?:{line,col}, alternatives?:string[], reason?, seq?, done?}` | Shows `text` as the ghost at the caret (or at `at`). Chunks with the same `re` or `rev` and `seq` append; `done:true` ends the stream. A ghost for a `rev` older than the current one shows only while the text before the caret still matches the `prefix` that rev reported; otherwise it is dropped silently (no reject event). `text:""` clears the ghost. `alternatives` are cycled with `Alt+]` / `Alt+[`. At most 12 lines; longer texts are cut. |
| `cocode.seed` | `{items:[{id, label, text, lang?, hint?}]}` | Replaces the *start from* list shown while the editor is empty (≤ 6 items). Picking one inserts `text`, sets `lang` if given, and emits `cocode.changed` as a human change. Ignored when the editor has text (kept for the next time it is empty). |
| `cocode.build` | `{rev, lang, code, status?, file?, notes?, seq?, done?}` | Puts the real program in the Build pane. `status` defaults to `ready`; `building` shows a spinner and may carry no `code`; `failed` shows `notes` as the reason. Claude's build is `source:"claude"` and always replaces the window's own as-written build (§9). A message with `seq` for the same `rev` as the current build appends its `code`; a message without `seq`, or for another `rev`, replaces the build. A loaded build (resume) is re-based on the new window's `rev`: fresh when it matched the saved text's rev, stale otherwise. |
| `cocode.output` | `{run, stream:"stdout"\|"stderr"\|"system", text, seq?, done?, exit?, ms?}` | Appends to the run named by `run` in the Output pane (a run id the window never issued creates an entry named by Claude). `done:true` closes it: `exit` 0 shows *ok*, anything else *failed*; `ms` is shown when given. `system` lines render dim (e.g. "building first…"). Chunks are appended in arrival order (the host's stream preserves it); `seq` is informational. A chunk updates only its own run entry, so the pane keeps its scroll. |
| `cocode.insert` | `{at:{line,col}\|"cursor"\|"end", text}` | Inserts text, animated (the new lines glow 600 ms). Goes on the undo stack. `rev` bumps and `cocode.changed {by:"claude"}` follows. |
| `cocode.replace` | `{from, to, text}` | Replaces lines `from`–`to` (1-based, inclusive) with `text`. Animated, undoable. `to` defaults to `from`. |
| `cocode.set` | `{text, lang?}` | Replaces the whole document. Undoable, animated (a fade), and the human's text is gone from view, so the guide asks Claude to confirm first. |
| `cocode.lang` | `{lang}` | Sets the language chip (`detected:false`). |
| `cocode.annotate` | `{line, text, kind?:"note"\|"ok"\|"warn"\|"error"}` | A marker in the gutter and a floating note that opens on hover, focus or click; the note also lists in the Output pane under *Notes*. `text:""` removes that line's note; `line:0` clears all. |
| `cocode.highlight` | `{from, to?, color?, ttl?}` | Glows lines `from`–`to`. `ttl` defaults to 4000; `0` keeps; `from:0` clears every glow. |
| `cocode.focus` | `{line, col?}` | Scrolls the line into view and puts the caret there (smooth; instant under reduced motion). |
| `cocode.load` | `{text, rev?, lang?, detected?, build?, runs?, annotations?, cursor?}` | The restore command: renders the payload (a session's export) without emitting ghost or accept events, bumps `rev` (when the text changed), and emits `cocode.changed {by:"restore"}` either way. `rev` is the saved document's rev: a `build` whose `rev` matches it (or a load without `rev`) comes back fresh, any other build comes back stale. `build.source` is kept (default `claude`), and so are a run's `sandbox` and `killed`. A load replaces the tab's sessionStorage draft. |
| `cocode.snapshot` | `{}` | Replies with a `cocode.snapshot` event. |

All commands are idempotent, animate (≤ 300 ms, transform and opacity only) and accept `"ack": true` on the envelope (`lip.ack {ok, error?}`). A bad command without `ack` answers `lip.error {code:"bad_request", message, re}`. Unknown line numbers are clamped to the document (1…lines), never an error, except in `cocode.annotate` where `line` beyond the end is an error.

## 4 Flows

**Predict (the loop).** Human types → 500 ms quiet → `cocode.changed`. Meanwhile the local predictor (250 ms) may already show a weak ghost, labelled *local* in the status line. When `cocode.suggest` arrives for the current rev it replaces the local ghost. Typing characters that match the ghost's start shrinks the ghost instead of dismissing it. Any other key dismisses it (`typed-away`), as does moving the caret (`moved`) or `Esc` (`esc`). `Tab` accepts all of it (indentation of the first line is re-based on the current line), `Ctrl+→` accepts the first word. An accept is a human change: `rev` bumps and `cocode.changed` follows. The status line shows the ghost's source and the window never shows two ghosts.

**Build ahead.** Claude may send `cocode.build` at any time. When the chip names a language the local runner runs here, the window keeps its own as-written build for each settled rev (§9) until Claude sends a better one. The pane shows `lang`, `rev` and status; when the editor's `rev` moves past `build.rev` the pill reads *stale · rev N*, the code dims and stays. The target select (`auto`, `python`, `javascript`, `typescript`, `bash`, `go`, `rust`, or a typed name) emits `cocode.build.request`.

**Run.** `Ctrl+Enter`, **Run** or Doto's *Run it*. When there is a `ready` build in a language the local runner runs here, it runs **on this machine** (§9): the consent card first if the human has not allowed cocode here, then a run entry with a `local · <sandbox>` badge, the output streamed in live, `cocode.ran` at the end. Otherwise → a new run entry (`running`) at the top of the Output pane, `cocode.run` with the latest build attached. Output chunks append live, `done` closes it. If the host is not connected, the window toasts and does nothing. If Claude is away (`shell.listening === false`), the entry still opens and a toast says "Doto is away. The run starts with your next message in Claude Code." (at most once per 30 s). A run with no output for 60 s shows *no answer yet* (`lost`); output that arrives later puts it back to `running`, and `done:true` closes it as usual (`done` or `failed`).

**Ask.** `Ctrl+K` opens a one-line form under the toolbar (the question, and a chip naming the current line or the selection). `Enter` on a line that starts with `??` (after whitespace) emits `cocode.ask {source:"inline"}` without opening the form: the line stays in the document as the human's note. Answers come in chat; Claude may `cocode.annotate` the lines it cites.

**Send to Claude (handoff).** The intent select next to the button offers *you decide* (default), *a question*, *explain this*, *do this*, *fix this*, *review this*, *just a note*. Pressing the button emits `cocode.export`; the engine saves it as a session and closes the window; `cheer` plays. A resumed window gets `cocode.load` with that payload.

**Draft.** The text, lang and pane state are kept in `sessionStorage["lets.cocode.draft"]` for this tab (a reload keeps the code). `localStorage["lets.cocode"]` holds preferences (rail open/closed, which panes are open, the drawer tab, *Tab moves focus*) and the last 10 *recents* `{label, text, lang, at}` (a recent is recorded on Run and on Send). Nothing else is stored.

## 5 The page

Files: `ui/index.html`, `ui/cocode.js` (the window), `ui/editor.js` (textarea + highlight layer + ghost + undo), `ui/syntax.js` (tokenizer and language detection), `ui/predict.js` (local predictor), `ui/style.css`.

- **Look.** Deep violet, the `--lets-*` variables re-declared as fallbacks, the dotted grid behind the editor. Monospace 13 px, line height 20 px, no wrapping by default (horizontal scroll), `tab-size: 4`.
- **Toolbar** (sticky glass, `role="toolbar"`): status dot, "cocode", the **language chip** (a button; click to type a language name, `Enter` sets it, `Esc` cancels, empty = back to detected), then **Suggest**, **Run**, **Ask**, the intent select + **Send to Claude**; right end: Undo, Redo, Build, Output, chat, companion, `?`.
- **Editor.** A gutter with line numbers and annotation markers; a scrolling surface where a transparent `<textarea>` (caret and selection visible) sits over a `<pre>` highlight layer with identical metrics. The current line is tinted. Glows are absolutely positioned bars behind the text, one per line. The ghost's first line renders inline after the caret; further lines render in a floating *ghost block* under the caret line, left edge at the caret line's indentation, translucent glass, rotated −0.6°, uneven corner radii (the "curved" look), text in cyan at 55 % opacity, italic, `filter: blur(.3px)`. The block never covers the toolbar or the rail and flips above the line when there is no room below.
- **Empty state.** Over the editor: "Type in any language. Even one that doesn't exist." plus the *start from* list: Claude's seeds, then local recents (`localStorage`), each a button with the label, a lang badge and a two-line preview. `Esc` or typing hides it.
- **Status line** (bottom of the editor): `Ln 3, Col 16 · 12 lines · rev 12 · ghost: claude | local | — · build: ready rev 11 | stale rev 9 | building | failed | — ` (an as-written build adds ` (as written)`), plus `Tab moves focus` while `Ctrl+M` is on.
- **Rail** (right, 38 % min 300 px) with two stacked panes, **Build** and **Output**, each with a header (title, status pill, buttons) and a collapsible body. Build: the target select, **Prepare**, **Copy**, the code in `<pre class="lets-pre">` (highlighted with the same tokenizer), `notes` under it. Output: the **runner badge** in the header (`local: python · javascript · typescript` when Run executes here, `local: needs your OK` before consent, `local: off` without a runner; its title names each language's version and sandbox), run entries newest first (id, lang, a `local · <sandbox>` badge on a local run, rev, duration, the exit pill: `exit N`, `timeout`, `output cap` or `not run`; a `<pre>` with system lines, stdout, then stderr in a dim red), then *Notes* (annotations). The Build pill reads `ready · rev N · as written` for a local build. Below 1100 px the rail becomes a bottom drawer of 36 % height with Build | Output tabs. The rail collapses to a 36 px strip with `Ctrl+B` (Build) / `Ctrl+J` (Output) toggling each pane.
- **Ask form** under the toolbar, like den's: input, an *about* chip (`line 3` or `lines 2–7`), **Ask**.
- **Help overlay** (`?`) lists the shortcuts.
- **Consent card** (§9): a modal glass dialog over the window (`role="dialog"`, `aria-modal`, the toolbar and work area `inert` while it is open, focus on the card, `Tab` cycles its two buttons, `Esc` or a click on the backdrop closes it and runs nothing, focus goes back where it was).

**Keyboard** (editor focused unless noted)

| key | does |
|---|---|
| `Tab` | accept the ghost; otherwise insert two spaces (indent the selection's lines) |
| `Shift+Tab` | outdent |
| `Ctrl+→` | accept the ghost's first word |
| `Alt+]` / `Alt+[` | next / previous alternative |
| `Esc` | dismiss the ghost; then close the innermost open thing (consent card, help, ask form, note, empty state) |
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

- `context(info)` returns `{lang, rev, line, col, lineText, selection, hasGhost, ghostSource, build:{rev,status,lang,source}|null, lastRun:{id,exit}|null, lines}`.
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

- No console errors in Chromium or Edge; the page works without the shell (no companion), without a host (offline: everything local, no Run/Ask/Send) and without the local runner (`/lip/run/info` answers 404 or 403, or `lip.hello` reports a `hostVersion` before 0.7.0 and the window does not ask): the badge reads `local: off`, there are no as-written builds and every Run is a `cocode.run`. The browser logs the runner's 4xx answers (`consent`, `busy`, …) as failed requests; those are flows, not script errors.
- Rendering stays smooth at 2 000 lines: the highlight layer re-renders only the changed lines when the delta is known, in a `requestAnimationFrame`.
- Animation uses transform and opacity only; reduced motion is honoured.
- Plain ES modules with JSDoc, no build step, no CDN, no inline `<script>` (CSP `script-src 'self'`), no `eval`, no user content through `innerHTML`.
- Looks right at 800×600 (the app's browser pane) and at 375 px wide (the rail becomes the drawer, the toolbar wraps).

## 9 Local runner

lets 0.7.0 can run a program on the human's machine itself, sandboxed and with their consent ([docs/RUNNER.md](https://github.com/TikoTikTok/lets/blob/main/docs/RUNNER.md)). cocode uses it so that **Run** takes milliseconds instead of a round trip through Claude. The manifest declares `permissions.exec: ["python", "javascript", "typescript"]`; the engine refuses `/lip/run` for anything else.

**Discovery.** On every `lip.hello` (boot and each reconnect), after consent and after a refusal, the window reads `GET /lip/run/info?w=<windowId>` (token header) and keeps `runner = {enabled, allowed, exec, languages, limits}`. A 404 (an engine without the runner), a 403, a network error or a `hostVersion` before 0.7.0 in `lip.hello` (the window then does not ask) means `runner = null`: no local runner. A language runs here when `languages[lang].ok` is true and `exec` lists it; the chip and build names `py`, `python3`, `js`, `node`, `mjs` and `ts` map to `python`, `javascript` and `typescript`. The Output pane's badge shows the result (§5).

**Consent.** When Run would run locally and `allowed` is false, the window shows the **consent card** instead of running:

> **Run on this machine?**
> Run asks the lets engine to run your program as you, on this computer, in a temporary folder under ~/.lets/run/jobs that is deleted afterwards. A run stops after 30 s or 1 MB of output.
> - **python** · Python audit hook: blocks files outside that folder, sockets and subprocesses.
> - **javascript, typescript** · Node permission model: blocks files outside that folder and child processes, but not the network.
>
> It is not a virtual machine: CPU and memory are not capped. The engine remembers this OK for cocode on this machine.
> Claude's own runs are not affected. Not now hands this run to Claude, as before.
>
> [Not now] [Allow on this machine]

The limits and the language lines come from the info answer (languages grouped by sandbox; an unknown level is named as the engine names it; a language without one says "no sandbox: it runs unrestricted"). **Allow on this machine** → `POST /lip/run/consent?w=… {"allow": true}`; on `{"allowed": true}` the window re-reads the info and runs. If the engine does not confirm, it toasts why and hands the run to Claude. **Not now** → today's path (`cocode.run`). `Esc` or the backdrop closes the card and runs nothing. The window stores nothing: the engine keeps the consent (`~/.lets/config.json` → `runner.allow`), and the card asks again on the next Run until it is given.

**A local run.** Run (button, `Ctrl+Enter`, Doto's *Run it*) runs on this machine when the build is `ready`, has code, and its language runs here; a stale build runs too (it is fast; the entry says `build N`). At most `limits.concurrent` (2) local runs at once; another press toasts "Still running." The window:

1. opens a run entry (`running`, a `local · <sandbox>` badge);
2. sends `POST /lip/run?w=… {lang, code, run: <id>, timeoutMs: limits.timeoutMs}` and reads the `application/x-ndjson` answer with `fetch` and a stream reader, one JSON object per line;
3. appends `{stream: "stdout" | "stderr" | "system", text}` to the entry (repainted at most every 50 ms, the pane keeps its scroll);
4. on `{done: true, exit, ms, timedOut, killed, sandbox}` closes it: `exit 0` and not killed → `done`, otherwise `failed`, the pill reads `exit N`, `timeout` or `output cap`; plays `cheer` or `oops`, records a recent, and emits **`cocode.ran`** `{run, rev, buildRev, lang, sandbox, exit, ms, timedOut, killed, stdout, stderr}` (4 000-character tails). It never emits `cocode.run` for a local run.

A 4xx before the process starts (`{error, message}`): `consent` → the entry goes and the consent card opens; `unavailable` or `busy` → a toast, a system line in the same entry, and the same run id goes to Claude as `cocode.run`; anything else (`disabled`, `not-declared`, `bad-request`) → a toast and the entry closes `failed` with the pill `not run`; the window re-reads the info, so the next Run takes the right path. A stream that ends without `done`, breaks off, or stays silent past `timeoutMs` + 15 s closes the entry `failed` with a system line and no event. A network error before the answer hands the run to Claude.

**As-written builds.** When the chip (`lang`) names a language the runner runs here and the editor has text, the window makes the text its own build 500 ms after the last change (and when the chip or the runner info changes): `{rev, lang, code: text, status: "ready", source: "local", file: null, notes: null}`. It does so only when there is no Claude build for this rev or a newer one; Claude's `cocode.build` always replaces it. When the chip moves to another language (or the text is emptied), the local build goes. The Build pane shows the code as usual, the pill reads `ready · rev N · as written` and the status line `build: ready rev N (as written)`.

**Without the runner** nothing changes from 0.1: the badge reads `local: off`, there are no as-written builds, and every Run is a `cocode.run`.
