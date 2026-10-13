# Changelog

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
