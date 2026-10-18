# Changelog

## 0.4.0 — 2026-10-18

Build & run in one press, with a wheel that says where the job is.

- **One action.** The toolbar's *Run* is now **Build & run** (`F5`, `Ctrl+Enter`, Doto's menu): a ready build in a language this machine runs executes at once; a build Claude is still streaming in such a language is **waited for and run the moment it lands**, without a second round trip (`runWhenBuilt`, dropped after 60 s or on a failed build); anything else goes through Claude, who builds first when the build is not fresh, and the run entry says so (*Claude builds for rev N first, then runs.*). **`Shift+F5`** (or Shift-click) is *rebuild with Claude, then run*: `cocode.run` carries **`rebuild: true`** and Claude builds anew even when the build is current.
- **The wheel.** The button's icon is the job's state: the play triangle when idle, a spinning ring while building or running (teal for building, cyan for running, a slow amber ring while a run waits for Claude because Doto is away), **✓** when the last run of this text ended with exit 0, **✗** when it failed (or the build failed), **?** when it has had no answer for 60 s. An edit (a new rev) puts it back to idle. The tab title carries the same mark (`⟳ Cocode — lets`, `✓ …`, `✗ …`) so a hidden pane still tells. The button's label and tooltip name the state for screen readers; reduced motion shows a dashed ring instead of the spin.
- **Guide:** on a `cocode.run` whose build is not fresh (or with `rebuild`), send `cocode.build {status:"building"}` at once so the wheel shows building, then build and run. `F5` never reloads the page.

## 0.3.1 — 2026-10-15

Reach in any spelling. The 0.3.0 scanner knew `ping(host)` and `ping google.com`; a human writing pseudo-code or an invented language says it in more ways, and some in words no regex knows.

- **Scanner (`ui/reach.js`):** the parenless form takes any separator or bracket and any case (`ping: google.com`, `PING -> google.com`, `(ping "google.com")`, `- curl https://x`, `3. whois x.org`); natural phrases at the start of a line count (`go to https://x`, `open google.com`, `show me www.x.com`, `open the browser on …`, `screenshot …`, `download https://…`, `get https://api/…`, `search the web for …`, `google …`, `find out who maintains lodash`, `investigate …`, `spawn an agent to …`, `agent: …`, `delegate …`, `hermes …`, `ask kimi to …`, `shell: ls`, `run the command dir`, ``run `dir` ``, `notify me when done`); and Claude addressed by name takes the next word as the verb (`claude, ping google.com`, `ask claude to research …`, `claude: open https://x`, `tell claude hello` → `claude.hello`). The local verbs of pseudo-code stay local (`open the file`, `search the list for the max`, `get the user from the db`, `run tests`). 12 unit tests.
- **Guide:** the window's `reach` is a hint, not the whole truth: Claude reads the program for reaches himself, in any language, and treats one he finds like a listed one; the build is made as always, with each reach written as `claude.<verb>(args)`; a `cocode.ran` failure with a `NameError`/`ReferenceError` on a name that means a reach counts as a missed reach too. The guide is ~1 770 words; the validator's cap is now 1 800.

## 0.3.0 — 2026-10-15

Reach. A line that asks for what no sandbox can do is done for real by Claude instead of being stubbed into a print.

- **The problem:** `ping('google.com')` became a build with a `ping` function that printed what a ping *would* say; a program could not open the browser, search the web, start a research agent or run a command, because the guide said "no network" and the sandbox agreed.
- **Reach (`ui/reach.js`):** the window scans the settled text for lines that reach outside: the `claude` namespace with any verb (`claude.browser(url)`, `claude_research(topic)`, `claude.whatever(1)`), bare verbs (`ping`, `traceroute`, `dns`, `whois`, `fetch`, `http.get`, `curl`, `browser`, `browse`, `screenshot`, `search`, `research`, `agent`, `delegate`, `hermes`, `shell`, `bash`, `say`, `ask`, …), the pseudo-code form without parentheses (`ping google.com`, `browse https://…`, `research the history of morse`), shell lines (`$ ls`, `! dir`), and the real libraries a sandbox blocks (python `requests`, `urlopen`, `socket`, `smtplib`, `subprocess`, `os.system`, `webbrowser`, `playwright`; javascript `child_process`, `execSync`, `net.connect`, `puppeteer`). Not a reach: comments, `??` lines, a verb the document defines (`def ping(host):`), a method of the same name (`re.exec`), and what the language's sandbox does itself (`fetch` in javascript). Kinds: `net`, `browser`, `search`, `research`, `agent`, `hermes`, `shell`, `say`, `ask`, `claude`. At most 50 per document; a unit test (`node --test test/reach.test.mjs`) covers the rules.
- **In the window:** a cyan diamond in the gutter on each reach line, with a hover note (*`ping google.com` — reaches the network. Claude does it for real when you Run.*); ` · reach: N` in the status line; the Build pill's and the runner badge's titles say that Run goes through Claude. **Run** with any reach present skips the local runner whatever the language: the entry gets a `reach · N` badge and the system line *N lines reach outside the sandbox: Claude does them for real.*, and `cocode.run` carries **`reach: [{line, kind, name, args, raw}]`**. `cocode.output` has a fourth stream, **`reach`**, in cyan, for the line Claude sends before each reach (`→ ping google.com`). `context().reach` is the count. The help overlay lists the spelling.
- **Guide:** a new *Reach* section makes Claude the interpreter of such a program: each reach is one real tool call, in order (the real `ping`, the built-in browser pane with the tab left open, WebSearch, a research or sub-agent task, the hermes-delegate skill, Bash, `chat.say`), its real result is the output, a reach that changes the world waits for a yes in chat, probing a third party's security is refused, and a build never replaces a reach with a print. On a `cocode.ran` failure that says `blocked by the lets sandbox`, Claude treats the program as a reach run under his own run id. Seeds include one reach. The guide grew to ~1 700 words; the validator's cap is now 1 700.
- **Schemas and manifest:** `run.json` gains `reach`, `output.json` the `reach` stream; the manifest's description and summaries say so. No engine change: a reach run is an ordinary `cocode.run` through Claude Code's own tools and permission prompts. Needs lets 0.7.0 as before.

## 0.2.0 — 2026-10-13

Run on your machine. With the local runner of lets 0.7.0 and your OK, **Run** executes Python, JavaScript and TypeScript in milliseconds instead of waiting for Claude.

- **Answer in code.** A second button next to *Send to Claude* (`Ctrl+Shift+O`, also in Doto's menu) hands the code over with `intent:"output"` and `answer:{lang}`: Claude replies in the transcript with the whole answer written as code in the chip's language, nothing else. The same answer without a window: `/lets cocode output [lang] <question>`.

- **Runner discovery:** the window reads `GET /lip/run/info` on every connect and shows a badge in the Output pane header: `local: python · javascript · typescript`, `local: needs your OK` or `local: off`; its title names each language's version and sandbox. An engine without the runner (404), with it switched off, or older than 0.7.0 changes nothing: every Run goes to Claude as before.
- **Consent card:** the first local Run asks *Run on this machine?* and says what that means: it runs as you, in a temporary folder under `~/.lets/run/jobs` that is deleted afterwards, with 30 s and 1 MB limits; the Python audit hook blocks files outside that folder, sockets and subprocesses; the Node permission model blocks files outside that folder and child processes, but not the network; it is not a VM. **Allow on this machine** records it with the engine (`POST /lip/run/consent`), **Not now** hands that run to Claude, `Esc` runs nothing. The window stores nothing itself.
- **Local runs:** `POST /lip/run` streams NDJSON into the run entry as it arrives, with a `local · <sandbox>` badge; the pill reads `exit N`, `timeout` or `output cap`. At the end the window emits the new **`cocode.ran`** event `{run, rev, buildRev, lang, sandbox, exit, ms, timedOut, killed, stdout, stderr}` so Claude can react, and no `cocode.run`. `busy` and `unavailable` hand the same run to Claude, a revoked consent brings the card back, and at most two local runs go at once.
- **As-written builds:** when the language chip names a language the runner runs, the text itself becomes the build (`source: "local"`, the pill and the status line say *as written*) until Claude sends a better one; Claude's `cocode.build` always replaces it. `build.source` is in snapshots, exports and `cocode.load`, and runs carry `sandbox` and `killed`.
- **Manifest:** `permissions.exec: ["python", "javascript", "typescript"]`, and the `cocode.ran` event with `schemas/ran.json`. The vendored `unique.schema.json` knows `exec`. Engines before 0.7.0 reject a manifest that declares it.
- **Guide:** on `cocode.ran`, one Doto line and, after a failure, the fix as a ghost or an annotation plus a corrected build, never a second run; on `cocode.run`, one call to the engine's `run` tool with `emit: "cocode.output"` instead of files and the shell; build python and javascript only to improve on the text.
- **Fixes:** a resumed run without an exit code, a duration or a build rev no longer comes back as `exit 0`, `0 ms` or `build 0`; the export schema allows the `…` that starts a cut output tail; the window reports its real version.

## 0.1.1 — 2026-10-13

Fixes from an independent review of 0.1.0.

- **Keyboard:** `Shift+Tab` only outdents when the line is indented (or a multi-line selection is made); otherwise it leaves the editor, so the toolbar is reachable without `Ctrl+M`.
- **Resume:** a loaded build is marked fresh when it matched the saved text (also when the payload carries no `rev`), and a resume whose text equals the tab's draft still emits `cocode.changed {by:"restore"}`.
- **Ghost:** typing through a ghost keeps its alternatives (they shrink in step); alternatives are capped at 12 lines like the main text; a whole ghost ends any partial stream under its key; a streamed ghost is announced to screen readers once, when complete.
- **Runs:** a run that Claude names itself gets the same 60 s *no answer yet* timer; a streamed chunk updates only its own entry (the pane keeps its scroll and no longer re-announces every run); the Output pane opens when a run appears or ends, not on every chunk.
- **Build:** a late chunk after a build was closed can no longer replace it.
- **Events:** when several changes merge into one `cocode.changed`, `delta` carries the merged range without `text` instead of the last change's text.
- **Target language:** cancelling *other…* no longer sends a build request; the literal `other` is refused.
- **Large documents:** the highlight layer's reconcile is linear (a Set instead of an array scan) and the gutter touches only the two rows whose current-line state changed.
- **Smaller:** `cocode.focus` clamps out-of-range lines like insert and replace; the draft keeps the whole text (up to 1 MB) instead of its head; the reduced-motion flag follows the OS setting live; the shortcuts overlay takes focus; dead code removed. Contract and schemas updated to match (`cocode.load` documents `rev` and `detected`).

## 0.1.0 — 2026-10-13

First release. cocode is a code window you talk through: type in any language, let Claude predict, build and run, and send the code as a message.

- **The editor:**
  - any language, real or invented, or plain pseudo-code; the window never judges it;
  - language detection for python, javascript, typescript, go, rust, bash, sql, c, cpp, java, ruby, html, css and json, with `pseudo` when nothing scores, and a language chip you can set by hand;
  - syntax highlighting, line numbers, a current-line tint, auto-indent;
  - an own undo stack (200 steps, typing coalesced within 600 ms);
  - keyboard: duplicate and move lines, indent and outdent, comment a line, with a `?` shortcuts overlay.
- **The ghost:**
  - Claude's `cocode.suggest` shows the next lines as dim, italic text at the caret, with alternatives to cycle;
  - when Claude is away, a local predictor offers weaker ghosts (closers, `else`/`except` pairs, number sequences, echoes of earlier lines, repeated shapes), marked *local* in the status line;
  - `Tab` accepts it all, `Ctrl+→` one word, `Alt+]` / `Alt+[` cycle, `Esc` dismisses;
  - accept and reject events tell Claude what worked, and `Alt+\` asks for a ghost now.
- **The Build pane:**
  - Claude prepares the real program ahead of time for the current revision;
  - an older build is marked *stale for rev N* and its code stays;
  - a target select and **Prepare** ask for a build in a chosen language.
- **Run and the Output pane:**
  - **Run** (`Ctrl+Enter`) executes the build at once;
  - output streams in live, with stdout, stderr and dim system lines, and an exit pill with the time;
  - a run with no output for 60 s is marked *lost* until output arrives;
  - Claude's line notes list under *Notes*.
- **Ask:**
  - `Ctrl+K` opens a one-line question about the current line or selection;
  - a line that starts with `??` ends with `Enter` as an inline question and stays in the document;
  - annotations put a gutter marker and a floating note on a line.
- **Send to Claude** is a handoff, with an intent: *you decide*, *a question*, *explain*, *do*, *fix*, *review* or *just a note*. It saves a session (`session: {export: cocode.export, snapshot: cocode.snapshot, restore: cocode.load}`), and a resumed window comes back through `cocode.load` with the code, build, runs and notes.
- **Seeds** fill an empty editor with starting points from Claude and the last ten local recents.
- **Doto's menu** offers "Finish this", "Explain this line" or "Explain the selection", "Run it", "Show the real code" and "Open chat". The page plays a wink on an accepted ghost, a nod when a build lands, a cheer on a clean run or on Send, an oops on a failed run, and a sparkle after three accepts in a row.
- **Events:** `cocode.changed`, `cocode.ghost.accept|reject|request`, `cocode.build.request`, `cocode.run`, `cocode.ask`, `cocode.export`, `cocode.snapshot`.
- **Commands:** `cocode.suggest`, `cocode.seed`, `cocode.build`, `cocode.output`, `cocode.insert`, `cocode.replace`, `cocode.set`, `cocode.lang`, `cocode.annotate`, `cocode.highlight`, `cocode.focus`, `cocode.load`, `cocode.snapshot`.
- **Layout:** checked at 800×600 and at 375 px wide. Needs lets 0.4.0.
