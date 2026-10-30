# How Hexa is built

Hexa is an Electron app. A main process holds the Linux backends, her settings and a small HTTP
server on a Unix socket. A sandboxed page draws her on one transparent window that covers a
screen. Claude Code's hooks and the `hexa` CLI are separate Node processes that talk to that
socket.

```
Claude Code ── hexa-hook.js ─────────────┐
            └─ hexa-permission-hook.js ──┤  HTTP over the Unix socket
hexa CLI (bin/hexa.js) ──────────────────┘
                                          ▼
  main process   bridge.js ─▶ main.js ─▶ history · notices · cli · permissions · brain hub
                                          │  IPC, through preload.js (window.host)
                                          ▼
  overlay page   app.js ─▶ brain.js (events) ─▶ hexa.js (her) · panel · hud · menu · mainframe

X server ─▶ x11.js (input shape, XTEST, focus) · windows-x11.js (your windows) ─┐
KWin ─▶ kwin-script ─D-Bus─▶ kwin.js (your windows, on Plasma Wayland) ─────────┴▶ windows:update
D-Bus session bus ─▶ notifications.js · dnd.js · mpris.js
Ollama (HTTP) · the Anthropic API (SDK) ◀─ brain/providers.js, only when you chat
```

## Processes and files

| Process | Code | Started by |
|---|---|---|
| Main process | `src/main/` | You (the app menu, `hexa`, `npm start`, autostart) |
| The overlay page | `src/renderer/index.html`, `src/renderer/js/` | The main process |
| The stats window page | `src/renderer/stats.html`, `js/stats-app.js`, `js/stats.js` | "Usage and stats" |
| The event hook | `hooks/hexa-hook.js` (a copy in `~/.local/share/hexa/hooks/`) | Claude Code, per event |
| The permission hook | `hooks/hexa-permission-hook.js` (copied the same way) | Claude Code, per permission request |
| The CLI | `bin/hexa.js` | You |
| The KWin script | `src/main/platform/linux/kwin-script/` | KWin, loaded by the main process on Plasma Wayland |

The hooks and the CLI use only Node's built-in modules, so they stand alone. Each repeats the
socket path rule from `src/main/paths.js` for that reason.

### The main process, `src/main/`

| File | What it does |
|---|---|
| `main.js` | Startup, the IPC handlers, the tray actions, and the wiring between everything below. |
| `paths.js` | XDG folders and the socket path. |
| `config.js` | `~/.config/hexa/config.json`: defaults, atomic saves, a corrupt file moved aside. |
| `bridge.js` | The HTTP server on the Unix socket. |
| `overlay.js` | The overlay window: one per screen at a time, always on top, click-through. |
| `geometry.js` | Rectangles (DIP to physical, merging) and which display to use. |
| `tray.js`, `labels.js` | Her menu as a pure template, the same menu as data for the one she draws, and its words. |
| `protocol.js` | The `hexa://` protocol. |
| `permissions.js` | Pending permission requests, their IDs, the wait. |
| `cli.js` | What `/cli/<command>` does, and the session list `hexa status` reports. |
| `notices.js` | Which Claude events become desktop notifications while she's away. |
| `text.js` | Makes outside text safe to show: no control or bidi characters, a length cap. |
| `secrets.js` | Your API key, through Electron's `safeStorage`. |
| `demo.js` | The demo session. |
| `hooks/claude.js` | Installs and removes her hooks in Claude Code's `settings.json`. |
| `brain/hub.js` | Her brain, put together: the brains, the chat, her actions, computer use, reminders. |
| `brain/providers.js` | Ollama over HTTP, and Claude through `@anthropic-ai/sdk`, behind one interface. |
| `brain/chat.js` | One conversation, append-only, with tool rounds. |
| `brain/actions.js` | Her chat tools, each with its input checked. |
| `brain/computer.js` | The computer use loop. |
| `brain/persona.js` | Her system prompts. |
| `usage/history.js` | Her daily records. |
| `usage/transcript.js` | Token counts from new transcript lines. |
| `usage/prices.js`, `prices.json` | The price table, with yours on top. |
| `usage/report.js` | Views, CSV and JSON for the stats window and `hexa stats`. |
| `usage/stats-window.js` | The stats window and its two IPC handlers. |
| `platform/linux/x11.js` | Her X connection: the input shape, XTEST, keyboard focus, the compositor check. |
| `platform/linux/input.js` | Her hands for computer use: synthetic pointer and keys through XTEST. |
| `platform/linux/windows-x11.js` | The X11 window tracker. |
| `platform/linux/window-model.js` | Window rules as pure functions: frames, which windows count, snapshots. |
| `platform/linux/kwin.js`, `kwin-script/` | The Plasma Wayland window tracker. |
| `platform/linux/proc.js` | Walks `/proc` up the process tree to find Claude's window. |
| `platform/linux/capture.js` | Screenshots for her brain, scaled to fit, and their coordinates mapped back. |
| `platform/linux/session-bus.js` | The D-Bus session bus, or none. |
| `platform/linux/notifications.js` | `org.freedesktop.Notifications`, or `notify-send`. |
| `platform/linux/dnd.js` | Do Not Disturb, from the notification server's `Inhibited` property. |
| `platform/linux/mpris.js` | What's playing. |
| `platform/linux/autostart.js` | `~/.config/autostart/hexa.desktop`. |

`src/preload.js` gives the overlay page `window.host`, and `src/stats-preload.js` gives the stats
page `window.stats`. Nothing else crosses from a page to the main process.

### Startup

Before Electron is ready, `main.js`:

1. On Wayland, switches Electron to X11 (`--ozone-platform=x11`), so she runs through XWayland,
   where her input shape works.
2. Registers `hexa://` as a privileged scheme.
3. Points Electron's data folder at `~/.local/share/hexa` and Chromium's caches at
   `~/.cache/hexa/session`.
4. Copies everything the process logs to `~/.local/state/hexa/hexa.log`.
5. Takes the single-instance lock. A second copy logs that, and quits.

When Electron is ready:

1. Serves `hexa://`, loads the settings, connects to the X server (and to its SHAPE and XTEST
   extensions, when it has them), and asks the desktop whether to reduce motion (`kreadconfig6`,
   then `gsettings`).
2. Registers the IPC handlers and builds her brain hub.
3. Creates the overlay, which loads `hexa://app/src/renderer/index.html`.
4. Starts window tracking: the KWin script when `WAYLAND_DISPLAY` is set and the desktop is KDE,
   the X11 tracker otherwise.
5. Starts the bridge on the socket.
6. Starts Do Not Disturb and MPRIS on the session bus, without waiting for them.
7. Checks for a compositor, creates the tray icon, registers `Ctrl+Alt+H`, and starts a half-second
   timer that moves her to the screen your pointer has been on for 3 seconds.

On quit it writes the last history counts, closes the bridge (which removes the socket), stops the
tracker, and closes the X and D-Bus connections.

## The overlay and click-through

The overlay is one transparent, frameless window as big as the screen she's on. It's always on
top (the `screen-saver` level), on every virtual desktop, out of the taskbar, of type `toolbar`, and
never focusable, so it never takes the keyboard from you.

Clicks are routed by the X server, not by polling:

1. About 30 times a second at most, the page reports what may take clicks, as rectangles: her
   body (from her parts' boxes, see [character-packs.md](character-packs.md#parts)), her card, the
   HUD, the Mainframe and her menu. It only sends them when they change.
2. The main process joins overlapping rectangles (16 at most), converts them to physical pixels,
   and sets them as the window's **input shape** (the SHAPE extension, `ShapeInput`).
3. The X server delivers a click inside the shape to her, and any other click to the window
   underneath. The window's visible shape doesn't change, so her effects draw anywhere.

Until the page reports, the input shape is empty: nothing of hers is clickable. While she uses your
computer, it stays empty. While her own menu is open, the menu's layer covers the whole screen, so
a click anywhere else closes the menu, and the main process takes Esc, the arrow keys and Enter as
global shortcuts for it.

Without the SHAPE extension or an X connection, the overlay falls back to Electron's
`setIgnoreMouseEvents`, toggled by checking the pointer against the rectangles 30 times a second.
Her log says which (`click-through by shape` or `by poll`).

The pointer's position goes to the page 10 times a second, for her to look at it.

**Typing to her.** When you click into her Mainframe, the main process makes the window focusable
and gives it the X keyboard focus (`SetInputFocus`), remembering who had it. Closing the Mainframe
gives the focus back.

**Screens.** When a screen is added, removed or resized, the overlay fits the screen it's meant to
be on. Moving her to another screen moves the overlay, and she appears there.

## The bridge

`bridge.js` is an HTTP/1.1 server on a Unix socket: `$XDG_RUNTIME_DIR/hexa/hexa.sock`, or
`~/.cache/hexa/hexa.sock` without `XDG_RUNTIME_DIR`, or `HEXA_SOCKET`.

- The folder is `0700` and the socket `0600`: only your user can connect.
- Any request with an `Origin` header gets a 403. Browsers always send one on cross-site requests;
  hooks and the CLI never do.
- Bodies over 512 KB get a 413, and JSON it can't parse a 400.
- At start, a socket nobody answers on is removed. One that answers means another Hexa is running:
  the bridge doesn't start.

| Route | From | What it does |
|---|---|---|
| `GET /health` | anyone on the socket | `{ ok, name: "hexa", pid }` |
| `POST /event` | the event hook, `npm run demo` | A hook event. It must have `hook_event_name`. |
| `POST /permission` | the permission hook | Held open until your click on her card, her wait running out, or the hook hanging up. Answers `{ behavior: "allow" \| "deny" \| null, always? }`. |
| `GET` or `POST /cli/<command>` | the CLI | See `cli.js`. GET takes the query string, POST a JSON object. |
| `/debug/state`, `/debug/capture` | the live checks | Only when started with `--dev`. |

`bridge.js` can also listen on `127.0.0.1` with a token, for tools that can't use a socket, and
never serves `/permission` there. `main.js` doesn't start it in 0.1.0, so the `tcp` setting does
nothing yet.

### Events

An event posted to `/event` goes through `main.js` in this order:

1. `history.record()` counts it. It never throws.
2. If Claude needs you (`Notification` with `permission_prompt`, `elicitation_dialog`,
   `elicitation_url_dialog` or `agent_needs_input`), the overlay moves to the screen your pointer
   is on.
3. If it has the hook's parent PID, `proc.js` walks up the process tree, and the first process that
   owns a tracked window gives `window_id`: Claude's window.
4. The CLI's session list sees it, and so do the notices, which send a notification only while
   she's away.
5. It goes to the page on `hexa:event`, where `app.js` hands it to `brain.js`.

The CLI's commands become events built from scratch, with `assistant: "cli"`, so a request body
can't pass itself off as Claude's: `HexaSay`, `HexaReact`, `HexaRun` (`phase: "start"` and `"end"`).
Her brain adds `HexaReminder`, and the demo ends with `HexaShowcase`. The demo from her menu goes
straight to the page, with `demo: true` on every event, and isn't counted.

### IPC

| Channel | Direction | What |
|---|---|---|
| `hexa:event` | main → page | Hook and CLI events. |
| `hexa:command` | main → page | `background`, `teleport`, `lurk`, `mainframe`, `fork`, `guide`, `arrive`, `resume`. |
| `hexa:config`, `overlay:area`, `pointer`, `windows:update`, `linux:state` | main → page | Settings, the work area, the pointer, your windows, Do Not Disturb and music. |
| `menu:show`, `menu:key` | main → page | Her menu as data, and the keys main grabbed for it. |
| `permission:ask`, `permission:gone` | main → page | Her permission card, and its end. |
| `chat:event`, `brain:ask`, `brain:gone`, `computer:start`, `computer:step`, `computer:end` | main → page | The chat stream, consent and question cards, the task card. |
| `config:get`, `config:set` | page → main | `config:set` only takes `welcomed`, `linked` and `visible`. |
| `hits:set` | page → main | The rectangles that take clicks. |
| `menu:open`, `menu:pick`, `menu:closed` | page → main | Her drawn menu. `menu:pick` runs the same action as the tray's item. |
| `permission:answer` | page → main | Your click on her card. |
| `brain:status`, `brain:models`, `brain:set`, `brain:key`, `chat:send`, `chat:stop`, `chat:reset`, `brain:answer`, `computer:stop` | page → main | Her Mainframe. |
| `focus:take`, `focus:give` | page → main | The keyboard, while you type to her. |
| `sounds:list`, `hooks:status`, `hooks:install`, `guide:claudeFolder`, `guide:tray` | page → main | Her sounds, her guide. |
| `stats:get`, `stats:export` | stats page → main | Numbers, and a save dialog. |

## Window tracking

Both trackers produce the same snapshot, front window first, in DIP relative to her screen, and
only windows on that screen:

```js
{ fg, wins: [{ id, x, y, w, h, max, pid, cls }] }
```

IDs are X window IDs on X11 and KWin's window IDs on Plasma Wayland. `fg` is the active window. `max` is true for a window maximised both ways or full screen. The page
uses snapshots to sit, lurk, point and possess; the main process keeps the last one to find
Claude's window.

### X11 (EWMH)

`windows-x11.js` reads the window manager's EWMH properties, through Hexa's own X connection
(the `x11` package, pure JavaScript):

- On the root window: `_NET_CLIENT_LIST_STACKING` (every client window, bottom to top),
  `_NET_ACTIVE_WINDOW` and `_NET_CURRENT_DESKTOP`.
- On each window: `_NET_WM_WINDOW_TYPE`, `_NET_WM_STATE`, `_NET_WM_DESKTOP`,
  `_NET_FRAME_EXTENTS`, `_GTK_FRAME_EXTENTS`, `_NET_WM_PID`, `WM_CLASS`, and its geometry. Never
  its title.

It listens for `PropertyNotify` on the root and for structure and property changes on each
window, so nothing is polled. Snapshots go out at most every 33 ms, however fast windows move.

`window-model.js` holds the rules: a window's visible rectangle is its client area grown by the
window manager's frame, or shrunk by a GTK client-side shadow. Her own window, docks, desktops,
menus, tooltips, notifications, splash screens, minimised windows and windows on other virtual
desktops don't count.

### Plasma Wayland (the KWin script)

On Plasma Wayland her window runs through XWayland, which only sees XWayland's own windows. So
`kwin.js`:

1. Exports a D-Bus object on the session bus: name `io.github.hexa`, path
   `/io/github/hexa/Windows`, interface `io.github.hexa.Windows`, with one method, `update(s)`.
2. Loads `kwin-script/contents/code/main.js` into KWin through `org.kde.KWin /Scripting`
   (`loadScript`, plugin name `hexa-windows`; a copy left from an earlier run is unloaded first),
   and starts it.

The script runs inside KWin. Whenever a window is added, removed, activated, moved, resized,
minimised or made full screen, or the stacking order or desktop changes, it calls `update` with
JSON: for each normal window and dialog, its ID, frame geometry, process ID, resource class,
whether it's minimised, full screen or maximised, and its desktops. Never its title or contents.
`kwin.js` turns that into the snapshot (KWin's coordinates are already logical). On quit the
script is unloaded.

In the packaged app the script folder is unpacked from the asar archive, so KWin can read it.

## The page

`src/renderer/js/`, as ES modules:

| File | What it does |
|---|---|
| `app.js` | Loads her pack, builds everything, turns mouse input into click, drag and menu, and runs the frame loop: update, draw, report click rectangles. Once a second it ticks her brain and the HUD. |
| `brain.js` | Claude Code events into what she says and does; her record of each session; the thinking timer. It has no timers of its own. |
| `hexa.js` | Her: modes (idle, work, alert, sleep, suspend, background, teleport, drag, fall, thrown, peek, point, boot), windows (sitting, lurking, pointing, possessing), her Fork. It runs on its own clock, so it can be tested without timers. |
| `motion.js` | Pure movement: rest spot, peek spots, falling, drifting, flying when thrown. |
| `character/` | `pack.js` (check and load a pack), `rig.js` (pose to bone transforms, click rectangles), `draw.js` (parts, chains, visor, core), `physics.js` (hair and cable), `acting.js` (the animation sheets, 12 drawings a second), `glyphs.js`. |
| `fx.js` | Her effects: shards, sparks, bolts, rings, the orb, glitches, possession, the pointing wire. |
| `panel.js` | Her cards and the ticker. |
| `markdown.js` | A small markdown subset (paragraphs, lists, code, bold, italics, link text) into DOM nodes, for Claude's answers. |
| `hud.js`, `menu.js`, `mainframe.js`, `guide.js` | The sessions HUD, her drawn menu, her Mainframe and task card, her guide. |
| `voice.js` | Her sounds, made with Web Audio, and your own files. |
| `labels.js`, `lines/` | Ticker verbs, and everything she says. |
| `stats.js`, `stats-app.js` | The stats page. |

`src/renderer/dev/` has a contact sheet of her (`rig.html`) and a stats page with sample numbers,
for looking at them without the app.

## The security model

### The pages

- Both pages run with `contextIsolation`, `sandbox` and no `nodeIntegration`. Their only way to
  the main process is the object their preload exposes, with named channels and arguments turned
  into strings.
- Both have a strict Content Security Policy: `default-src 'none'`, and scripts, styles, fonts,
  connections and (on the overlay) media from `hexa:` only, images also from `data:`. No inline
  scripts, no remote origins.
- The stats window refuses navigation and new windows.
- Text from outside (Claude's answers, your prompt, error output, CLI text, chat replies, media
  titles) only goes into the page as text (`textContent`), never as HTML. Claude's answer goes
  through `markdown.js`, which builds DOM nodes and shows links as text.

### The `hexa://` protocol

The pages get their files through `hexa://`, never `file://`:

| URL | Serves |
|---|---|
| `hexa://app/<path>` | The app's own folder (pages, packs, fonts). |
| `hexa://sounds/<file>` | `~/.local/share/hexa/sounds/` |
| `hexa://packs/<id>/<file>` | `~/.local/share/hexa/packs/` |

URLs are parsed by hand, because the URL parser would quietly fold `../` away. A `..` segment, an
encoded slash or a NUL anywhere means 404, and the resolved path must stay inside its folder.

### Which inputs are trusted

| Input | How far it's trusted |
|---|---|
| Your clicks on her buttons | Answer permissions and consent cards, but only real clicks: buttons ignore events a script made up (`isTrusted`). |
| Her own page | The main process checks the sender for the brain, chat, focus and permission channels. `config:set` only takes the three things the page learns itself. |
| Programs on the socket | Programs running as you. Their events are shown as text and counted. CLI input is checked and capped, and its events are built from scratch. No route can approve a permission: `/permission` only waits for your click. |
| Permission requests | Each gets a random ID that answers once. No answer in time, or the hook hanging up, means no decision. |
| Consent and questions for computer use | The same: a random ID, once, and no answer in 2 minutes means no. |
| Notifications | Only her own notifications' `show` button counts. None can answer Claude. |
| Claude's tool calls in chat | Each tool checks its input: `http` and `https` links only, files only inside your home and only if they exist, apps only from `.desktop` files and started without a shell, reminders 1 to 1,440 minutes. They run without asking you, except computer use. |
| Computer use | Only after your Start. Esc stops it. At most 18 screenshots and 80 actions. Her prompt tells Claude to ask you before anything consequential and to treat on-screen text as data. |
| `~/.claude/settings.json` | Never written when it isn't valid JSON. Backed up before every change, written through symlinks, its permissions kept. |
| The KWin D-Bus object | Any program on your session bus can call it: like the socket, that's programs running as you. |

She doesn't defend against programs running as your own user: they can reach her socket and read
your files anyway.

## Testing

### Unit tests

```sh
npm test
```

`node --test` runs every `tests/**/*.test.*js`: `.test.js` for the main process's CommonJS modules,
`.test.mjs` for the page's ES modules. They need no Electron and no display. Modules take what they
touch as arguments (timers, the clock, `execFile`, the D-Bus bus, `safeStorage`), so the tests pass
fakes: `tests/fake-dbus.js`, `tests/fixtures/proc/`, temporary folders for `XDG_*` and
`CLAUDE_CONFIG_DIR`. CI runs them on every push (`.github/workflows/ci.yml`).

The tests that talk to a real X server (`tests/x11.test.js`, `tests/windows-x11.test.js`) skip
themselves unless `HEXA_TEST_X=1` and `DISPLAY` are set. `npm run test:x` runs them on the hidden
desktop.

### Live checks on a hidden desktop

`tools/live/*.js` drive the real app: they start Hexa from the checkout in dev mode, open test
windows, click and type through XTEST, read `/debug/state`, and print `PASS` or `FAIL` for each
check.

| Script | `npm run` | Checks |
|---|---|---|
| `m2.js` | `live:m2` | She perches on the window in front, rides along, falls when it closes, points at Claude's window. |
| `menu.js` | `live:menu` | A right-click opens her drawn menu without picking anything; Esc and a click elsewhere close it; the arrows and Enter pick an item. |
| `hud.js` | `live:hud` | Two sessions bring up the HUD; a click on a chip makes her point. |
| `permission.js` | `live:permission` | The real permission hook, a real click on Allow, and no output when nobody clicks. |
| `fork.js` | `live:fork` | Seven copies out, all reaped back. |
| `brain.js` | `live:brain` | Typing reaches her chat; the consent card takes a real click; her clicks and keys land where the screenshot said. Uses a scripted Claude (`fake-claude.js`, through `HEXA_FAKE_CLAUDE`, dev mode only). |
| `cli.js` | `live:cli` | `say`, `react fork`, `run` with a passing and a failing command, `status`, and exit 3 once she's gone. |

`npm run live:all` runs them one after the other and stops at the first failure.

They always run through `tools/live/hidden-desktop.sh`, which builds a desktop nobody sees:

- `kwin_wayland --virtual --xwayland`, 2560×1440, with software compositing, its own KWin config,
  and its own config, data, cache and state folders.
- A private D-Bus session bus that starts no services (`bus.conf`).

It runs inside fresh namespaces (`unshare --user --map-root-user --mount --pid --fork --mount-proc
--net --kill-child`, then `namespace.py`), because the live checks have hurt a real session before:

- **A private `/tmp`.** KWin's Xwayland puts its sockets and lock files in `/tmp/.X11-unix`. An
  earlier version without this deleted your X server's `/tmp/.X11-unix/X0`.
- **A private network.** Your X server's abstract socket can't be reached from inside, so nothing
  in there can draw on, or click on, your real screen.
- **Its own PIDs.** When the namespace's first process exits, the kernel ends everything in it.
  Nothing is ever stopped by PID. An earlier version ran `kill $PPID` from a program KWin had
  started detached: its parent was your session's systemd, and it logged you out.
- **Your own user ID inside**, through a nested user namespace, because Electron refuses to run as
  root.

`HEXA_LIVE_DIR` keeps the hidden desktop's folders (her log is in `$HEXA_LIVE_DIR/state/hexa/`,
KWin's in `kwin.log`). `HEXA_LIVE_TIMEOUT` sets the time limit, 180 seconds by default. It needs
`kwin_wayland` (Plasma 6), `dbus-run-session`, `unshare` (util-linux), `python3`, and unprivileged
user namespaces.

How to run them safely is in [CONTRIBUTING.md](../CONTRIBUTING.md#live-checks).
