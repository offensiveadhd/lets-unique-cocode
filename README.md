<p align="center"><img src="icon.svg" width="72" alt=""></p>
<h1 align="center">cocode</h1>
<p align="center"><b>Talk in code.</b><br>A <a href="https://github.com/TikoTikTok/lets">lets</a> unique: an editor for any language, even one that doesn't exist. Claude predicts your next lines as a ghost you accept with Tab, prepares the real program in the background so Run is instant, and reads what you send as a question, a task or a note.</p>

---

## Install

cocode is installed from the store. It is not a default.

```
/lets store cocode      # inspect → confirm
/lets:lets cocode       # or /lets cocode with the alias
```

Manual: clone this repo into `~/.lets/uniques/cocode`, or set `LETS_UNIQUES_DIRS=<parent folder>` while developing. cocode needs lets 0.4.0 or later (handoff sessions). It asks for no files and no network: the manifest declares `fs.write: []` and `net: []`.

## What you can do

| part | what it does |
|---|---|
| **Editor** | Type in any language: a real one, one you made up, or plain pseudo-code. The window never judges it. It detects the language (`python`, `javascript`, `typescript`, `go`, `rust`, `bash`, `sql`, `c`, `cpp`, `java`, `ruby`, `html`, `css`, `json`) and shows `pseudo` when nothing fits. Click the language chip to name your own. Line numbers, highlighting, auto-indent, an own undo stack. |
| **Ghost** | Claude reads each settled change and offers the next lines as dim, italic text at the caret. `Tab` accepts all of it, `Ctrl+→` one word, `Alt+]` / `Alt+[` cycle the alternatives, `Esc` dismisses. Typing the ghost's first letters shrinks it instead of killing it. When Claude is away, a small local predictor offers weaker ghosts (closers, `else:`, `step 3` after `step 2`), marked *local* in the status line. |
| **Build pane** | While you type, Claude prepares the real program (Python, JavaScript, …) for the current revision. The pane shows the code, its language, the revision and a status. It reads *stale for rev N* when you typed on. A target select (`auto`, `python`, `javascript`, …) and **Prepare** ask for a build now. |
| **Output pane** | **Run** (`Ctrl+Enter`) executes the build at once. Output streams in, newest run first, with an exit pill (ok or failed) and the time it took. A run with no output for 60 s says *no answer yet*. Claude's notes on your lines list here too. |
| **Ask** | `Ctrl+K` opens a one-line question about the current line or selection. Or write a line that starts with `??` and press `Enter`: the line stays in your code, and Claude answers in chat and annotates the lines it cites. |
| **Send to Claude** | Hands the code over as a message. Pick what you mean (*you decide*, *a question*, *explain this*, *do this*, *fix this*, *review this*, *just a note*) or leave it on auto. The window closes and Claude answers in Claude Code. Say *continue* to bring it back with your code, build, runs and notes. |
| **Seeds** | An empty editor shows starting points: Claude's (from memory and saved sessions), then your last ten recents. Pick one, or just start typing. |
| **Keyboard** | Everything is reachable with Tab, every control has a name, and `?` lists the shortcuts. `Ctrl+Z` / `Ctrl+Y` undo and redo, `Ctrl+D` duplicates a line, `Alt+↑` / `Alt+↓` move it, `Ctrl+;` comments it, `Ctrl+B` / `Ctrl+J` toggle the Build and Output panes, `Ctrl+Shift+Enter` sends. |

A few rules of the road:

- A ghost is an offer. It is not in your document until you accept it, and `Ctrl+Z` takes an accepted one back.
- Your language wins. Claude does not rewrite your pseudo-code into a real language in the editor. The real program lives in the Build pane.
- cocode stores nothing on the host. The code lives in the window, in a saved session after *Send to Claude*, and in `sessionStorage` for this tab so a reload keeps it. Preferences and your last ten recents sit in `localStorage`.
- If the host is not connected, the editor still works. Run, Ask and Send need a host.
- If Claude is not listening, Run still opens its entry, and the window says Doto is away. It starts with your next message in Claude Code.

## How Claude drives it

Events (up): `cocode.changed`, `cocode.ghost.accept|reject|request`, `cocode.build.request`, `cocode.run`, `cocode.ask`, `cocode.export`, `cocode.snapshot`.
Commands (down): `cocode.suggest`, `cocode.seed`, `cocode.build`, `cocode.output`, `cocode.insert`, `cocode.replace`, `cocode.set`, `cocode.lang`, `cocode.annotate`, `cocode.highlight`, `cocode.focus`, `cocode.load`, `cocode.snapshot`.

The manifest's `session` block (`export: cocode.export`, `snapshot: cocode.snapshot`, `restore: cocode.load`) lets the engine save a handoff and resume it.

- [GUIDE.md](GUIDE.md) is what Claude reads when it opens cocode: the predict loop, build ahead, how to run a program and stream its output, how to read a handoff, the etiquette.
- [CONTRACT.md](CONTRACT.md) is the behaviour spec: the model, every event and command with its data, the flows, the page and the local predictor.
- `schemas/` holds JSON Schemas for the main messages: `changed`, `run`, `ask`, `export`, `suggest`, `build`, `output` and `load`.

## Layout

```
unique.json    LIP manifest (name, entry, domains, events, commands, session, permissions)
GUIDE.md       instructions for Claude
CONTRACT.md    behaviour spec
icon.svg
schemas/       changed, run, ask, export, suggest, build, output, load; unique.schema.json (vendored)
ui/            index.html, cocode.js (the window), editor.js (textarea, highlight layer, ghost, undo),
               syntax.js (tokenizer, language detection), predict.js (local predictor), style.css
scripts/       validate.mjs: manifest + schema check (zero dependencies)
```

The UI imports the engine's SDK at runtime (`/sdk/lets-client.js`, `/sdk/lets-shell.js`). It has no build step and no dependencies, and it never runs your code itself: Claude does that and streams the output back.

## Develop

```bash
# from a lets checkout; the registry looks for <dir>/cocode/unique.json,
# so point it at the PARENT of a folder named "cocode" (symlink or junction this repo there)
LETS_UNIQUES_DIRS=/path/to/parent node engine/bin/lets.mjs serve --open cocode --verbose

node engine/bin/lets.mjs send cocode.suggest '{"rev":1,"text":"print(x)"}'   # drive it from the CLI
node engine/bin/lets.mjs events                                              # drain what cocode emitted
```

Validate with `node scripts/validate.mjs` here, or `node engine/bin/lets.mjs validate <this folder>` from the engine.

## License

MIT © TikoTikTok
