# Contributing to Hexa

Thanks for helping. This page says how to run her, test her, and check her live without hurting
your desktop session, and how the code is written.

How she's built is in [docs/architecture.md](docs/architecture.md).

## Two rules first

**Hexa is an original character.** Hexa was inspired by
[capri-desktop](https://github.com/mochiiwuff/capri-desktop), whose character, Capri, belongs to
other people. Never reproduce Capri: no art, no tracing, no look-alike, no lines, no persona, no
show-specific moments. That goes for character packs, icons, screenshots and text alike. Only
original characters go in this repo. See [NOTICE](NOTICE).

**Ported code comes only from capri-desktop v0.4.3 or earlier**, the last version under the MIT
licence. A file with ported code says so on its first line:

```js
// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.
```

Don't read capri-desktop's code after v0.4.3. Anything from later versions is rebuilt from scratch.

## Set up

You need git and Node.js 22.12 or newer.

```sh
git clone https://github.com/OWNER/hexa.git
cd hexa
npm ci
```

More, including building the packages: [docs/install/from-source.md](docs/install/from-source.md).

## Run her

```sh
npm start        # as you'd use her
npm run dev      # dev mode
```

Dev mode also writes her page's warnings and errors to her log (`~/.local/state/hexa/hexa.log`),
and answers `/debug/state` (where she is and what she's doing) and `/debug/capture` (saves a frame
to `captures/`) on her socket.

She runs on your real desktop and uses your real settings, history and Claude Code hooks. To keep
her away from yours, set `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`,
`XDG_CACHE_HOME`, `CLAUDE_CONFIG_DIR` and `HEXA_SOCKET` to folders of their own first.

Only one Hexa runs at a time. A second one quits.

With her running:

- `npm run demo` plays the demo session to her over the socket, as Claude Code's hooks would
  (`HEXA_DEMO_SPEED=4` plays it four times faster). In 0.1.0 these events also count in her
  history, unlike the demo in her menu.
- `node bin/hexa.js <command>` is the CLI.
- `node tools/check-input-shape.js` (with `npm run dev`) checks that clicks land on her only where
  she is.

`npx electron tools/capture.js <page> <out.png>` renders one of her pages off screen to a PNG, for
example `src/renderer/dev/rig.html`, her contact sheet. `npm run icons` redraws her icons. Both
start Electron.

## Test

```sh
npm test
```

All of it must pass. It needs no display and no Electron. The two test files that talk to a real X
server skip themselves; `npm run test:x` runs them on the hidden desktop (below).

Every change comes with tests in `tests/`, using `node:test` and `node:assert/strict`: `.test.js`
for the main process's CommonJS code, `.test.mjs` for the page's ES modules. Name each test after
what it checks, in a sentence.

## Live checks

The live checks in `tools/live/` start the real app, open windows, click and type. They must never
run on your own desktop. Run them only like this:

```sh
npm run live:m2          # or live:menu, live:hud, live:permission, live:fork, live:brain, live:cli
npm run live:all         # all of them, stopping at the first failure
npm run test:x           # the X server tests
```

Each one goes through `tools/live/hidden-desktop.sh`, which starts a headless KWin nobody sees, in
its own namespaces: a private `/tmp`, a private network and its own PIDs. How and why is in
[docs/architecture.md](docs/architecture.md#live-checks-on-a-hidden-desktop). It needs
`kwin_wayland` (Plasma 6), `dbus-run-session`, `unshare` (util-linux), `python3`, and unprivileged
user namespaces. If `unshare --user` fails, your system doesn't allow them and the live checks
can't run there.

`HEXA_LIVE_DIR=<folder>` keeps the hidden desktop's folders afterwards (her log is in
`<folder>/state/hexa/`, KWin's in `<folder>/kwin.log`). `HEXA_LIVE_TIMEOUT` is the time limit in
seconds, 180 by default.

**These rules exist because a live check once deleted the X server's socket, and another logged
the user out:**

- Never run `tools/live/*.js` directly (`node tools/live/m2.js`). Always through
  `hidden-desktop.sh`, which the `npm run live:*` scripts do for you.
- Never start `kwin_wayland` yourself, outside `hidden-desktop.sh`.
- Never stop a process by `$PPID`, or by any PID you didn't start yourself. Inside the hidden
  desktop nothing is ever signalled by PID: when it ends, the kernel ends everything in it.
- A new live check uses `tools/live/lib.js` (`startHexa`, `display`, `checks`) and prints a `PASS`
  or `FAIL` line for each check. It stops Hexa through the handle `startHexa` gave it.
- Nothing here needs `sudo`.

## How the code is written

Read a few files around the one you change, and match them. In short:

**Layout and modules**

- The main process (`src/main/`) is CommonJS, starting with `'use strict';`, and requires Node's
  modules as `node:fs`, `node:path` and so on.
- The page (`src/renderer/js/`) is plain ES modules, with no bundler and no framework.
- The hooks (`hooks/`) and the CLI (`bin/`) use Node's built-in modules only, so they run anywhere
  Node does.
- Dependencies are few and pinned to exact versions (no `^`). Add one only when it's really needed.

**Formatting**

- Two spaces, single quotes, semicolons, trailing commas in multi-line lists and objects.
- `const` unless it changes. Small helpers as arrow functions.
- No linter config yet: match the code around you.

**Comments and words**

- Every file starts with a comment that says what it's for, in plain words.
- Comments say why, in short sentences. Hexa is "she".
- What she says lives in `src/renderer/js/lines/en.js`, her menu's words in `src/main/labels.js`.
  Short, plain, in her voice: dry, warm, a little Unix humour.
- Log lines start with `[hexa]`.

**Design**

- Keep the rules pure and the I/O at the edges. Modules take their timers, clock, `execFile`, D-Bus
  bus or Electron objects as arguments, so the tests can pass fakes (see `tray.js`'s `buildMenu`,
  `window-model.js`, `motion.js`, `brain.js`).
- Check outside input where it comes in, and cap it: the bridge, `cli.js`, `actions.js`,
  `protocol.js`. Anything unexpected is refused and does nothing.
- Outside text goes into the page with `textContent` only, never as HTML. For notifications and the
  CLI, pass it through `clean()` from `src/main/text.js`.
- Never get in Claude's way: a hook prints nothing, always exits 0 and gives up fast (the permission
  hook prints only an answer you clicked).
- Nothing approves a permission except your click on her card. Don't add another way.
- Files are written atomically (a temporary file, then a rename). A file that can't be read is moved
  aside as `<name>.corrupt-<time>`, never overwritten.
- Code that runs from a timer, or at quit, never throws.

## Commits

- One change per commit, with its tests.
- The subject says, in plain words, what is true now: "She lurks behind the window you're in,
  peeking over its top edge", "Bridge: HTTP over a private Unix socket".
- The body says what changed and why, and which live checks you ran and how many passed.
- When behaviour changes, change `docs/` in the same branch.
- Work on a branch, not on `main`.

## Releases

A `v*` tag builds every Linux package and attaches them to a GitHub release
(`.github/workflows/release.yml`). The tag must match `version` in `package.json`. Add the release's
changes to [CHANGELOG.md](CHANGELOG.md) first.
