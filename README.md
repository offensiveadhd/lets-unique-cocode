<p align="center"><img src="icon.svg" width="72" alt=""></p>
<h1 align="center">cocode</h1>
<p align="center"><b>Talk in code.</b><br>A <a href="https://github.com/TikoTikTok/lets">lets</a> unique: an editor for any language, even one that doesn't exist. Claude predicts your next lines as a ghost you accept with Tab, prepares the real program in the background so Run is instant, and reads what you send as a question, a task or a note. With your OK, Run executes Python and JavaScript on your machine in milliseconds.</p>

---

## Install

cocode is installed from the store. It is not a default.

```
/lets store cocode      # inspect → confirm
/lets:lets cocode       # or /lets cocode with the alias
```

Manual: clone this repo into `~/.lets/uniques/cocode`, or set `LETS_UNIQUES_DIRS=<parent folder>` while developing. cocode needs lets 0.4.0 or later (handoff sessions), and 0.7.0 for running on your machine. It asks for no files and no network: the manifest declares `fs.write: []`, `net: []` and `exec: ["python", "javascript", "typescript"]`, the languages it may ask the engine to run for you once you allow it. Engines before 0.7.0 do not know `exec` and reject the manifest.

## What you can do

| part | what it does |
|---|---|
| **Editor** | Type in any language: a real one, one you made up, or plain pseudo-code. The window never judges it. It detects the language (`python`, `javascript`, `typescript`, `go`, `rust`, `bash`, `sql`, `c`, `cpp`, `java`, `ruby`, `html`, `css`, `json`) and shows `pseudo` when nothing fits. Click the language chip to name your own. Line numbers, highlighting, auto-indent, an own undo stack. |
| **Ghost** | Claude reads each settled change and offers the next lines as dim, italic text at the caret. `Tab` accepts all of it, `Ctrl+→` one word, `Alt+]` / `Alt+[` cycle the alternatives, `Esc` dismisses. Typing the ghost's first letters shrinks it instead of killing it. When Claude is away, a small local predictor offers weaker ghosts (closers, `else:`, `step 3` after `step 2`), marked *local* in the status line. |
| **Build pane** | While you type, Claude prepares the real program (Python, JavaScript, …) for the current revision. The pane shows the code, its language, the revision and a status. It reads *stale · rev N* when you typed on. A target select (`auto`, `python`, `javascript`, …) and **Prepare** ask for a build now. |
| **Output pane** | **Run** (`Ctrl+Enter`) executes the build at once: on your machine when the engine can (a badge in the header says so: `local: python · javascript`), otherwise through Claude. Output streams in, newest run first, with an exit pill (ok, failed, timeout, output cap) and the time it took. A run with no output for 60 s says *no answer yet*. Claude's notes on your lines list here too. |
| **Reach** | A line that asks for what no sandbox can do (`ping('google.com')`, `claude.browser('https://…')`, `research('…')`, `search('…')`, `agent('…')`, `$ ls`, or the real `requests` / `subprocess` calls) gets a cyan diamond in the gutter, and **Run** goes through Claude, who does it for real with his own tools (the real ping, the browser pane, a web search, a research agent, the shell) and streams what happened. Never a function that prints what a ping *would* say. |
| **Ask** | `Ctrl+K` opens a one-line question about the current line or selection. Or write a line that starts with `??` and press `Enter`: the line stays in your code, and Claude answers in chat and annotates the lines it cites. |
| **Send to Claude** | Hands the code over as a message. Pick what you mean (*you decide*, *a question*, *explain this*, *do this*, *fix this*, *review this*, *just a note*) or leave it on auto. The window closes and Claude answers in Claude Code. Say *continue* to bring it back with your code, build, runs and notes. |
| **Answer in code** | Next to it (`Ctrl+Shift+O`, also in Doto's menu): the same handoff, but Claude's whole answer comes back written as code in the chip's language, nothing else. Without a window: `/lets cocode output [lang] <question>`. |
| **Seeds** | An empty editor shows starting points: Claude's (from memory and saved sessions), then your last ten recents. Pick one, or just start typing. |
| **Keyboard** | Everything is reachable with Tab, every control has a name, and `?` lists the shortcuts. `Ctrl+Z` / `Ctrl+Y` undo and redo, `Ctrl+D` duplicates a line, `Alt+↑` / `Alt+↓` move it, `Ctrl+;` comments it, `Ctrl+B` / `Ctrl+J` toggle the Build and Output panes, `Ctrl+Shift+Enter` sends. |

## Run on your machine

With lets 0.7.0, Run does not wait for Claude when the program is Python, JavaScript or TypeScript: the engine runs it on your computer and the output arrives in milliseconds. The first time, the window asks **Run on this machine?** and says what that means; nothing runs until you press **Allow on this machine**, and the engine (not the window) remembers that for cocode. **Not now** sends that run to Claude, as before.

What is sandboxed: each run gets a fresh temporary folder under `~/.lets/run/jobs` (deleted afterwards), a scrubbed environment, 30 s and 1 MB of output. Python runs under an audit hook that blocks files outside that folder, sockets and subprocesses. JavaScript and TypeScript run under Node's permission model, which blocks files outside that folder and child processes. What is not: it runs as you and is not a VM, CPU and memory are not capped, and **Node does not block the network**. When you type Python or JavaScript yourself, the window runs your text *as written*; Claude only sends a build when it improves on it (sample data, a fix). Claude's own runs are not affected: they still go through Claude Code's permission prompt. Switch it off with `"runner": {"enabled": false}` in `~/.lets/config.json`.

## Reach: what leaves the sandbox

A sandbox can print and compute. It cannot ping a host, open your browser, search the web, start a research agent or run a shell command, and before 0.3.0 a line like `ping('google.com')` quietly became a `ping` function that printed what a ping would have said. Now such a line is a **reach**, and Claude does it for real.

Write it any way you like, in any language:

```
ping('google.com')                  # a bare verb: ping, dns, fetch, curl, browser, search, research, agent, hermes, shell, say, ask
claude.browser('https://example.com')   # the claude namespace: any verb, claude.whatever(...) included
ping: google.com                    # pseudo-code, no parentheses, any separator or bracket: (ping "google.com"), PING -> google.com
go to https://example.com           # natural phrases: open google.com, search the web for …, find out who maintains lodash,
spawn an agent to review the repo   #   investigate …, agent: …, hermes …, shell: ls, run the command dir, notify me when done
claude, research the history of morse code   # Claude by name: the next word is the verb (ask claude to …, claude: open https://…)
$ dir                                # a shell line
r = requests.get(url)                # the real library the sandbox would block (python: requests, socket, subprocess, os.system, webbrowser…)
```

The window's scan is a hint. Your language may phrase a reach in words no regex knows (`pingen google`), so Claude also reads the program for reaches himself and treats one he finds exactly like a listed one. And the build goes on as before: Claude still works out what the real program looks like in the Build pane, whatever your dialect, writing each reach as `claude.<verb>(…)` so you can see what he will do.

The window marks each reach with a small cyan diamond in the gutter (hover it: *`ping google.com` — reaches the network. Claude does it for real when you Run.*), the status line counts them, and **Run** skips the local runner whatever the language: the run entry gets a `reach · N` badge, Claude performs each reach in the program's order with the matching tool (the real `ping`, the app's browser pane with the tab left open for you, a web search, a sub-agent, the local Hermes agent, Bash, the chat), names each one in cyan as he goes (`→ ping google.com`), and streams the real output. The pure parts of the program still run in the sandbox. A reach that would change the world (send, post, delete, pay) waits for your yes in chat; probing someone else's security is refused. Claude Code's own permission prompts stand for every tool he calls.

Not a reach: a comment, a `??` line, a function you defined yourself (`def ping(host):` makes `ping(…)` yours), a method of the same name (`re.exec`, `list.search`), and what the language's sandbox does itself (`fetch` in JavaScript runs locally, since Node's permission model allows the network). The scanner is a heuristic: a reach it misses in Python ends with `RuntimeError: blocked by the lets sandbox`, and Claude reads that as a reach and performs the program for real.

A few rules of the road:

- A ghost is an offer. It is not in your document until you accept it, and `Ctrl+Z` takes an accepted one back.
- Your language wins. Claude does not rewrite your pseudo-code into a real language in the editor. The real program lives in the Build pane.
- cocode stores nothing on the host. The code lives in the window, in a saved session after *Send to Claude*, and in `sessionStorage` for this tab so a reload keeps it. Preferences and your last ten recents sit in `localStorage`.
- If the host is not connected, the editor still works. Run, Ask and Send need a host.
- If Claude is not listening, a run on your machine still happens at once. A run that goes through Claude still opens its entry, and the window says Doto is away. It starts with your next message in Claude Code.

## How Claude drives it

Events (up): `cocode.changed`, `cocode.ghost.accept|reject|request`, `cocode.build.request`, `cocode.run` (Claude runs it; with `reach`, he performs each reach for real), `cocode.ran` (the window ran it on your machine), `cocode.ask`, `cocode.export`, `cocode.snapshot`.
Commands (down): `cocode.suggest`, `cocode.seed`, `cocode.build`, `cocode.output`, `cocode.insert`, `cocode.replace`, `cocode.set`, `cocode.lang`, `cocode.annotate`, `cocode.highlight`, `cocode.focus`, `cocode.load`, `cocode.snapshot`.

The manifest's `session` block (`export: cocode.export`, `snapshot: cocode.snapshot`, `restore: cocode.load`) lets the engine save a handoff and resume it.

- [GUIDE.md](GUIDE.md) is what Claude reads when it opens cocode: the predict loop, build ahead, how to run a program and stream its output, what to do for each kind of reach, how to read a handoff, the etiquette.
- [CONTRACT.md](CONTRACT.md) is the behaviour spec: the model, every event and command with its data, the flows, the page, the local predictor, the local runner and reach (§10).
- `schemas/` holds JSON Schemas for the main messages: `changed`, `run`, `ran`, `ask`, `export`, `suggest`, `build`, `output` and `load`.

## Layout

```
unique.json    LIP manifest (name, entry, domains, events, commands, session, permissions incl. exec)
GUIDE.md       instructions for Claude
CONTRACT.md    behaviour spec
icon.svg
schemas/       changed, run, ran, ask, export, suggest, build, output, load; unique.schema.json (vendored)
ui/            index.html, cocode.js (the window), editor.js (textarea, highlight layer, ghost, undo),
               syntax.js (tokenizer, language detection), predict.js (local predictor),
               reach.js (the lines that reach outside the sandbox), style.css
scripts/       validate.mjs: manifest + schema check (zero dependencies)
test/          reach.test.mjs: node --test (zero dependencies)
```

The UI imports the engine's SDK at runtime (`/sdk/lets-client.js`, `/sdk/lets-shell.js`). It has no build step and no dependencies, and it never runs your code in the page: the engine's local runner does (after your OK), or Claude does, and the output streams back.

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
