# Hexa: design spec

- **Date:** 2026-10-28
- **Status:** written, waiting for review
- **Project:** a Linux-native desktop companion that narrates what your coding AI is doing.
- **Working name:** Hexa (the character, the app and the `hexa` CLI). Renaming later is a search-and-replace.

## 1. Summary

Hexa is a small animated character who lives on a transparent, click-through layer over your Linux desktop and tells
you what Claude Code (and Codex, and Antigravity) is doing. She shows the current action in a ticker above her head,
comes to find you when Claude needs a permission, reacts when a command fails, celebrates when a job is done, sits on
your windows, chats with you through a local or online AI model, keeps reminders, and keeps a history of the work.

It has the same features as [capri-desktop](https://github.com/mochiiwuff/capri-desktop) by mochiiwuff (Windows only),
rebuilt for Linux, with an original character and four new features:

1. Answering Claude Code permission prompts from her panel.
2. A multi-session HUD.
3. Usage (tokens, cost) and history statistics.
4. Deep Linux integration: MPRIS, Do Not Disturb, desktop notifications, a `hexa` CLI.

It is fully open source (MIT), documented, packaged for the major distributions, and published on GitHub.

## 2. Goals and non-goals

### Goals
- Every behaviour capri-desktop has at its latest version (commit `3e6f529`, 2026-10-27), working on Linux with
  real Linux backends, not stubs.
- First-class on the reference machine: Fedora 44, KDE Plasma 6.7, X11 session, NVIDIA RTX 4070, two monitors
  (2560×1440 below a 1920×1080, offset).
- Works on other X11 desktops; works on Plasma Wayland through XWayland plus a KWin script.
- The four new features above.
- MIT licence, a README, a full `docs/` folder with install instructions for each major distribution, packages for
  each, a CI pipeline that builds them, and a public GitHub repository.

### Non-goals
- **Capri herself.** No upstream character art, no redrawing of her, no upstream dialogue lines, persona prompt or
  show-specific sequences (the satellite, the mask, the biochip, "the other minds"). See §3.
- GNOME Wayland, Hyprland and Sway window tracking (Hexa still runs there without window tricks; documented).
- macOS and Windows builds.
- Flatpak or Snap packages: their sandboxes block window tracking, hook installation and process inspection, which
  are the core of the app. Documented in the FAQ.

## 3. Legal basis

- capri-desktop is MIT up to tag `v0.4.3` and PolyForm Noncommercial (not open source) from commit `023d10a` on.
- Hexa may port code **only from `v0.4.3` or earlier**, keeping the upstream MIT copyright notice in `NOTICE` and in
  the headers of files that contain ported code.
- The 17 commits after `v0.4.3` are **not read for code**. Their features (throwing, multi-screen following, reminders,
  attachment and jealousy, looking at the screen, PC sensing, device notices, file finding, desktop files, exact
  YouTube songs, Roblox games, Ollama cloud models) are rebuilt from scratch from their user-facing descriptions.
- Upstream's character art in `assets/capri/` and `docs/` belongs to CD PROJEKT RED / Studio Trigger / Netflix and is
  covered by no licence. Nothing from those folders is used, and Hexa does not resemble that character.
- Fonts: Chakra Petch and JetBrains Mono, SIL Open Font License, through Fontsource.
- Credits in the README: "Inspired by capri-desktop by mochiiwuff; parts ported from its MIT-licensed v0.4.3."

## 4. The character: Hexa

### 4.1 Who she is
A daemon in the Unix sense: a small background process who decided to become visible. Sly, curious, a little smug,
fond of the user, proud of "her" machine. She talks in short lines with a Unix sense of humour (exit codes, `fork`,
`root`, `/dev/null`), never in jargon you need to know to get the joke.

### 4.2 How she looks (original design)
- **Build:** compact, about three heads tall, floating a little above whatever she stands on.
- **Head:** rounded, with a wraparound **amber visor** that shows her eyes as an LED dot matrix. Her expressions are
  visor glyphs (calm, smug, wide, laughing, squint, sleepy, angry, dizzy, heart, loading, `? ?`, `x x`).
- **Hair:** a short bob of **cyan fibre-optic strands**, each tip glowing white. Strands are spring-physics chains:
  they sway, bristle when she's charged, and stream out when she falls or is thrown.
- **Ear nodes:** two small nodes on her head with a **link LED** that blinks on every Claude action, like a network
  card.
- **Body:** a dark navy hooded jacket with cyan circuit traces and a **hexagon emblem** on the chest that glows in her
  state colour (cyan idle, amber thinking, magenta waiting for you, red error, green done).
- **Cable:** a cable trailing from her back, ending in a plug. She plugs it into the window she sits on while Claude
  works.
- **Shards:** she sheds small **hexagon shards** instead of particles; she teleports by breaking into them.
- **Glitch:** a magenta/cyan channel split and shifted horizontal slices.
- **Palette:** navy `#141a2e`, cyan `#3ef2ff`, amber `#ffb43a`, magenta `#ff3ea5`, white `#f4f7ff`.

### 4.3 How she is drawn
- A **rigged vector character** drawn in code (Canvas 2D). No raster art is needed, and she stays sharp at any size.
- **Skeleton:** root, hips, spine, neck, head, two arms (upper, fore, hand), two legs (thigh, shin, foot), the cable,
  and about 9 hair chains. A pose is a set of bone angles plus per-part scale (for squash, stretch and the stretched
  pointing arm).
- **Animation:** upstream's approach, ported from `v0.4.3` `acting.js` as an engine: **exposure sheets**, pose to pose,
  the body redrawn 12 times a second ("on twos"), 24 during teleports, with a slight line boil. Hair and cable physics
  and effects run at 60 fps.
- **Rendering layers:** an FX layer (shards, bolts, lines, glyphs) and the character layer, composited with the
  glitch, afterimages and channel split as post effects.

### 4.4 Her own moments (replacing upstream's show-specific ones)

| Upstream moment | Hexa's version |
|---|---|
| Intro: grabs the screen and hauls herself in | **Boot:** a boot log scrolls in a corner, her hexagon emblem draws itself, her shards assemble from the screen edges into her body, the visor powers on (`[ OK ] Started hexa.service`) and she waves. |
| The satellite (a big sequence for moments that matter) | **Fork:** she calls `fork()`. A crowd of small copies of her marches out, each with a PID tag, forms a hex lattice, cheers, and she `wait()`s and reaps them back one by one. Same triggers: first time of the day, after a long Claude job (8 min or 50 actions), or from the menu. |
| Sleeping down to her mask | **Suspend:** she dozes, then folds down into her **core**: a small glowing hexagon with her visor eyes shut. Now and then the link LED blinks. |
| Put away into her biochip | **Background:** `Ctrl+Alt+H` sends her to the background: just her core, bottom left, eyes shut, opening only when Claude needs you. |
| "The other minds" splitting off her | **Forks** (small copies) peeling away and snapping back. |
| Possessing a window: the window gets her eyes and grin | **Possess:** she plugs her cable into the window and dives in. Its frame lights cyan, a hex grid sweeps it, slices glitch, and the window shows her visor glyph huge across it, laughing, with dot-matrix eyes opening all over it and following your pointer. Never reads the window's contents. |
| Victory: wind-up, smear, arms up, cut-in of her grin | **`exit 0`:** wind-up, smear, arms up, her emblem flares green, hex shockwave, speed lines, a cut-in close-up of her visor laughing, then the summary card. |
| Error knockback | **Segfault:** red impact frame, knocked back, heavy glitch, `SIGSEGV` flashing on her visor, then the error line that matters. |

### 4.5 Character packs
- A character is a **pack**: `packs/<id>/pack.json` plus optional files.
- `pack.json` holds metadata, the palette, the rig (bones, parts as SVG path data attached to bones, draw order),
  visor glyphs, named poses and optional overrides of lines and sounds.
- Packs load from the app's `packs/` folder and from `~/.local/share/hexa/packs/`. A broken pack falls back to Hexa
  with a message in the log and in the menu.
- The format is documented in `docs/character-packs.md` and validated by a JSON schema (`packs/pack.schema.json`).
- Only Hexa ships.

## 5. Architecture

Electron, laid out like upstream: a main process with the platform backends and a local bridge, and a sandboxed
renderer that draws everything on one transparent full-screen overlay window.

### 5.1 Layout

```
bin/hexa                       the CLI (Node)
hooks/
  hexa-hook.js                 Claude Code events (async, never blocks Claude)
  hexa-permission-hook.js      PermissionRequest (synchronous, opt-in, bounded wait)
  hexa-codex-hook.js           Codex events
  hexa-agy-hook.js             Antigravity events
scripts/                       hook installers, demo, release helpers
src/main/
  main.js                      app lifecycle, wiring
  overlay.js                   overlay window, displays, always-on-top, click-through
  tray.js                      tray menu
  bridge.js                    HTTP over a Unix socket (and optional TCP)
  sessions.js                  multi-session state
  permissions.js               pending permission requests and their answers
  usage.js                     token usage from transcripts, price table
  history.js                   daily records and aggregates
  config.js, paths.js          settings, XDG paths
  llm.js, ollama.js, setup.js  chat providers and their setup
  assistants.js                Claude Code / Codex / Antigravity hook management
  actions/                     what she can do from the chat (apps, files, media, web, reminders, roblox)
  platform/linux/
    x11.js                     X connection, window tracker, input shape
    kwin.js, kwin-script/      Plasma Wayland window tracking
    windows.js                 picks a backend, emits window snapshots
    desktop-entries.js         .desktop index and launching
    games.js                   Steam, Heroic, Lutris libraries and game detection
    files.js                   Baloo, plocate, bounded walk
    media.js                   MPRIS, volume
    sensors.js                 CPU, temperature, battery, network, devices
    proc.js                    process tree helpers
    notify.js                  notifications, Do Not Disturb
    screenshot.js              screenshots without her in them
    autostart.js               XDG autostart
    secrets.js                 API keys through safeStorage
src/preload.js
src/renderer/
  index.html, styles/
  js/character/                rig, renderer, acting (exposure sheets), poses, physics
  js/                          app, fx, panel, hud, brain, labels, chat, mission, stats, bond, reminders,
                               pc, look, guide, core, voice, util
  js/lines/                    en, fr, es, pt-BR, ru
packs/hexa/                    the character
packaging/                     desktop entry, icons, AUR PKGBUILD, post-install scripts
docs/                          user and developer documentation
tests/                         node:test suites and fixtures
.github/workflows/             ci.yml, release.yml
```

### 5.2 Data flow

```
Claude Code ──hook──▶ hexa-hook.js ──HTTP over Unix socket──▶ bridge ──▶ sessions ──IPC──▶ renderer (brain → acting, fx, panel, hud)
                                                                 └──▶ history, usage
X11 / KWin ──▶ windows.js ──snapshots──▶ overlay (input shape) and renderer (sit, possess, point)
D-Bus (MPRIS, UPower, NetworkManager, UDisks2, Notifications) ──▶ platform modules ──▶ renderer events
hexa CLI ──Unix socket──▶ bridge ──▶ renderer (say, react, show, hide) and read-only queries (status, stats)
```

### 5.3 The bridge
- HTTP/1.1 over a **Unix socket** at `$XDG_RUNTIME_DIR/hexa/hexa.sock` (directory `0700`, socket `0600`). Only your
  user can connect; no web page can reach it. If `XDG_RUNTIME_DIR` is unset: `~/.cache/hexa/hexa.sock`, same modes.
- Routes: `GET /health`, `POST /event`, `POST /permission` (long-held, see §7.1), `POST /cli/<command>`,
  `GET /cli/status`, `GET /cli/stats`, and `/debug/*` only when started with `--dev`.
- **Optional TCP** on `127.0.0.1:47823`, off by default, for tools that can't use a socket (containers). When on:
  requests with an `Origin` header are refused (as upstream) and a random token from `~/.config/hexa/token`
  (`0600`) is required in a header.
- Body limit 512 KB; malformed JSON gets a 400 and is otherwise ignored.

### 5.4 Renderer
- `contextIsolation`, `sandbox`, no `nodeIntegration`, a strict CSP, assets through a custom `hexa://` protocol.
- Untrusted text (Claude's replies, CLI messages, chat replies, window titles) is never set as HTML. Claude's reply is
  rendered from a small markdown subset into DOM nodes (paragraphs, lists, code, emphasis, links shown as text).

## 6. Linux platform layer

### 6.1 Overlay window
- One transparent, frameless overlay window covering the display Hexa is on; it moves to another display when she
  does (as upstream). Visible on all virtual desktops, skips the taskbar and pager.
- Always on top: `setAlwaysOnTop(true, 'screen-saver')` plus `_NET_WM_STATE_ABOVE`. The `_NET_WM_WINDOW_TYPE` that
  keeps her above normal windows without stealing focus on KWin is chosen by test in M1 (candidates: `toolbar`,
  `notification`, `utility`).
- Requires a compositor for transparency (KWin compositing on X11 is on by default). Without one, she shows a one-time
  notice explaining it.
- On Plasma Wayland, Electron runs under **XWayland** (`--ozone-platform=x11`), which keeps input shapes and
  always-on-top working; window tracking comes from the KWin script.

### 6.2 Click-through
- **Primary (X11 and XWayland):** the overlay's X window gets an **input-only shape** (XShape `ShapeInput`) set to the
  rectangles covering Hexa's body, her panel, the HUD and any buttons, updated as they change (at most 30 times a
  second). The bounding shape is untouched, so effects still draw across the whole screen. The X server routes every
  click exactly; nothing polls the pointer. The renderer computes the rectangles from her bones' bounding boxes.
- **Fallback:** Electron `setIgnoreMouseEvents` toggled by polling the pointer 30 times a second against the
  renderer's hit mask.
- This is the first thing built and verified in M1 (risk R1).

### 6.3 Window tracking
- **X11 backend** (`x11` package, pure JavaScript, no native build):
  - Reads `_NET_CLIENT_LIST_STACKING`, `_NET_ACTIVE_WINDOW`, `_NET_CURRENT_DESKTOP`, and per window
    `_NET_WM_WINDOW_TYPE` (docks, desktops, menus, tooltips and notifications are skipped), `_NET_WM_STATE`
    (hidden, fullscreen, maximised), `_NET_WM_DESKTOP`, `_NET_FRAME_EXTENTS`, `_GTK_FRAME_EXTENTS` (client-side
    shadows subtracted), `_NET_WM_PID` and `WM_CLASS`.
  - Live: `PropertyNotify` on the root window and `ConfigureNotify` on client windows, merged into snapshots at most
    30 times a second.
  - The title is read **only for the window in front**, only to match it against a fixed list of AI names (for her
    jealousy) and is never stored or sent; only the matched key leaves the module.
- **KWin backend** (Plasma Wayland): a KWin script loaded through `org.kde.KWin /Scripting`, reporting
  `workspace.stackingOrder`, the active window, frame geometries, PIDs and resource classes to a D-Bus service the
  app exports (`dbus-next`).
- **Snapshot format** (same idea as upstream): `{ active, windows: [{ id, x, y, w, h, maximized, fullscreen, pid,
  cls, ai?, game? }] }`, front first, in DIP.
- No backend available: Hexa still floats, peeks, falls and wanders; window tricks are hidden from the menu.

### 6.4 Finding Claude's window
- The hook sends its parent PID. The app walks `/proc/<pid>/stat` up the process tree (claude → shell → terminal or
  editor) until it reaches a PID that owns a tracked window. That window is Claude's window for that session.
- Fallback: the window in front when the prompt was submitted (upstream's rule).

### 6.5 Displays and scaling
- Electron `screen` for displays; X11 coordinates are physical pixels and are divided by each display's scale factor.
- Tested on the reference layout: two monitors of different sizes, one above the other with an offset.

### 6.6 Other backends

| Need | Linux backend | Fallback |
|---|---|---|
| Apps | `.desktop` files in `$XDG_DATA_HOME` and `$XDG_DATA_DIRS` (including Flatpak exports), localised names, keywords; launched with `gio launch` | parse `Exec` and spawn detached |
| Games | Steam `libraryfolders.vdf` and `appmanifest_*.acf` (launched as `steam://rungameid/<id>`), Heroic, Lutris; the game in front: its executable under a library folder, or `SteamAppId` in its environment | fullscreen window treated as "something fullscreen" |
| Closing an app | `_NET_CLOSE_WINDOW` (like its own close button); Force quit = SIGTERM, then SIGKILL after 5 s, only on a second click | — |
| Folders | XDG user dirs (`user-dirs.dirs`), file manager, `trash:/` | `xdg-open` |
| Files | KDE Baloo (`baloosearch6`), by name, by kind and by content | `plocate`, then a bounded walk of `$HOME` skipping caches, `node_modules` and `.git` |
| Reveal a file | `org.freedesktop.FileManager1.ShowItems` | open its folder |
| Music | MPRIS (play, pause, next, previous, what's playing), volume and mute with `wpctl` | `pactl` |
| CPU and heat | `/proc/stat`, `/sys/class/hwmon` | — |
| Battery, charger | UPower | `/sys/class/power_supply` |
| Network | NetworkManager | `/sys/class/net/*/operstate` |
| USB sticks | UDisks2 (removable filesystems and their mount points) | — |
| Phones, controllers, headsets | `udevadm monitor` (MTP/PTP, joystick, audio), BlueZ for Bluetooth | — |
| API keys | Electron `safeStorage` (KWallet or libsecret). If the backend is `basic_text`, she says the key would be stored unencrypted and asks before saving it | — |
| Start at login | `~/.config/autostart/hexa.desktop` | — |
| Screenshot without her | hide the overlay, then `spectacle -b -n`, `gnome-screenshot`, or `grim` | Electron `desktopCapturer` |
| Notifications | `org.freedesktop.Notifications` with actions | `notify-send` |
| Do Not Disturb | the `Inhibited` property of the notification server (Plasma) | off |
| Global shortcut | Electron `globalShortcut` (X11) | the GlobalShortcuts portal (Wayland) |
| Roblox | Sober (`org.vinegarhq.Sober`) handles `roblox://` links | the game's web page |

## 7. Features

### 7.1 Answering permissions from her (new)
- **Opt-in** from the menu: *Answer permissions from Hexa*. Turning it on installs `hexa-permission-hook.js` as a
  synchronous `PermissionRequest` hook with a timeout of the wait plus 5 seconds.
- **Flow:**
  1. The hook connects to the socket. App not running, or the socket missing: exit 0 with no output at once, so
     Claude's own prompt is untouched.
  2. The app decides whether to offer the question. It answers "no decision" at once if Hexa is in the background,
     Do Not Disturb is on, the screen is locked, or you have not moved the pointer or typed for 2 minutes.
  3. Otherwise Hexa comes to your pointer with a card: the session's project, the tool, and the command, path or URL
     (the same truncated fields the ticker uses), and three buttons: **Allow**, **Deny**, **Ask in Claude**. When
     Claude sends `permission_suggestions`, an **Always allow** button applies them through `updatedPermissions`.
  4. Your click is sent back as the hook's answer (`hookSpecificOutput.decision.behavior` = `allow` or `deny`;
     *Ask in Claude* and timeouts give no output). No answer within the wait (default 20 s, adjustable 5–60 s): no
     output, Claude asks as usual.
  5. If the hook's connection closes first (you answered in the terminal, or Claude moved on), the card disappears and
     a late click does nothing.
- **Safety:** only a real click on the overlay can answer. The socket, the CLI, the TCP port and the debug routes
  cannot approve anything. Answers are tied to a single request ID, and each ID is used once.
- **Open question checked in M3:** whether Claude Code shows its terminal dialog while the hook is still waiting. If it
  waits for the hook, the default wait drops to 10 s, and the docs say so.

### 7.2 Multi-session HUD (new)
- Each Claude session (by `session_id`, and per assistant) has a record: project (folder name), assistant, state
  (working, thinking, waiting for you, error, done, idle), current action label, start time, counts, Claude's last
  reply, its window, and its usage.
- The **HUD** is a column of small chips near a screen corner (configurable, or hidden), one per live session: a state
  LED, the project name, the action ticker and the elapsed time. Clicking a chip makes Hexa point at that session's
  window and show its last reply.
- The ticker above Hexa follows the **focus session**: waiting for you, then errors, then the most recently active.
- A session leaves the HUD after `SessionEnd`, or after 30 minutes with no events.

### 7.3 Usage and history (new)
- **Tokens:** on `Stop`, `SubagentStop` and `SessionEnd`, the app reads the new lines of the session's transcript
  (from the last byte offset it read) and sums `message.usage` (input, output, cache write, cache read) per model,
  counting each message ID once. Only those numbers are kept; the text in the transcript is never stored, shown or
  sent.
- **Cost:** tokens times a price table (`src/main/prices.json`, per model, editable), always labelled an estimate;
  with a subscription it is the API-equivalent cost.
- **History:** one record per day in `~/.local/share/hexa/history/YYYY-MM-DD.json`: tasks, actions, files changed,
  errors, prompts, approvals (and how many were through Hexa), time per project, tokens per model, cost, the longest
  mission. Writes go to a temporary file and are renamed into place.
- **Stats window:** day, week and month views; bars by day, time by project, tokens by model, totals; export to CSV
  or JSON. The daily mission report card (upstream) stays, including **Copy image**, and its evening delivery.
- `hexa stats [--today|--week|--month] [--json]`.

### 7.4 Deep Linux integration (new)
- **MPRIS** for music commands in her chat, and "what's playing?".
- **Do Not Disturb:** while it is on, no sounds, no chasing the pointer, no possession or idle sequences, no evening
  report; permission requests are not offered (§7.1); a waiting Claude still turns her emblem magenta.
- **Notifications while she's in the background:** Claude needs you, a job is done, a command failed, a reminder is
  due. Each has a **Show** action that brings her back. Approving is never possible from a notification.
- **The `hexa` CLI** (talks to the socket):
  - `hexa say <text> [--face <glyph>]`
  - `hexa react done|error|alert|hello|fork`
  - `hexa notify --title <t> [--body <b>]`
  - `hexa run -- <command…>`: shows `RUNS <command>` in her ticker, then reacts to its exit code. For builds and
    long scripts.
  - `hexa status [--json]`, `hexa sessions [--json]`, `hexa stats …`
  - `hexa show|hide|toggle`, `hexa demo`, `hexa hooks install|uninstall|status [--assistant claude|codex|agy]`
  - Without the app running, `say`/`react`/`run` print a short note and still run the wrapped command.
- **Global shortcut** `Ctrl+Alt+H` (background / bring back), configurable.
- **Start at login** through XDG autostart.

### 7.5 Parity with upstream

Everything below is in upstream (MIT `v0.4.3` unless marked **rebuilt**, which means it came after `v0.4.3` and is
written from scratch). Each item gets Hexa's own animation and lines.

**Watching the AI**
- Ticker of the current action (`EDITS gigs.ts`, `RUNS npm test`, `GREPS "paginate"`…) with data glyphs, and sparks
  when it runs a command or goes on the web; plugged into the window she sits on while Claude works.
- Thinking counter: after 15 s of silence mid-task the ticker turns amber and counts; a line at 40 s, a reassurance
  at 2 min; she keeps herself busy.
- Claude needs you: she comes to your pointer and won't leave it; if you are on another window, she goes to Claude's
  window and points at it (dashed line, corner brackets, a tag). Stops once answered.
- A failing command: segfault knockback (§4.4) and the error line that matters.
- Done: `exit 0` victory, then the summary (`12 actions · 3 files changed · 2m 14s`) and Claude's last sentence.
- Claude answered while you're on another window: its whole answer in a wide, scrolling panel, which goes away when
  you return to Claude's window or click it.
- Claude Code, Codex and Antigravity, each with its own hook and installer (Antigravity's hook as in `v0.4.3`).

**On her own**
- Floating, hair sway, shedding shards, drifting between corners, turning and tilting her head when the pointer comes
  near, zapping the pointer with a sly look, falling asleep after 10 quiet minutes and suspending to her core; the
  pointer near her, or Claude starting, wakes her.
- The **Fork** sequence (§4.4), its triggers and the menu entry.
- Sitting on window top edges, legs swinging, riding along when the window moves, falling off when it is closed,
  minimised or covered; settling on the front window while Claude works.
- Peeking from the screen edges (left, right, upside down from the top), shy of the pointer.
- Falling with stretch, a squash on landing, caught by a window ledge on the way down.
- Drag and drop onto a window edge.
- **Rebuilt:** throwing: held, she swings from the pointer; let go mid-swing and she flies, tumbles, crashes into
  screen edges (stuck a moment, glass cracks) or window ledges (catches, or bounces and the window shakes), lands on
  her feet or slides and sees stars; catchable mid-air; thrown three times in a row she gets mad, zaps the pointer and
  won't be picked up for a while.
- **Rebuilt:** multiple screens: follows the pointer to another screen after a few seconds (jumps through a shared
  edge or teleports), thrown to the screen next door, comes to your screen when Claude needs you or a reminder is due;
  a *Screen* menu and *Follow me across screens*.
- Possessing windows (§4.4), off with *Possess my windows*.
- **Rebuilt:** feeling the PC: CPU at full tilt for a while (overheats, fans herself, heat shimmer), charger in or out,
  low battery (sags, flickers), network lost and back, a USB stick (dives in by the tray, comes back with a verdict on
  what kinds of files it holds, counted by extension, names never shown or kept), a phone, controller or headset
  plugged in, a game in front (comments, goes to the background while you play, asks if you won). Off with *React to
  my PC*.
- Flourishes: a spin with afterimages, a hop, looking around, the head tilt, forks peeling off and snapping back.

**Showing you around (the guide)**
- *How does it work?*: she asks what to show you, goes there and points (the strike: head snap, coil, the arm shoots
  out to twice its length, a reticle slams on, a close-up cut-in; then she holds it with a data wire and explains).
- Where's my icon (the tray), where's Claude (its window), Claude's folder (`~/.claude` opened in the file manager with
  `settings.json` selected, and what her hook is), plug me into Claude (hooks in one click; also her welcome), free with
  Ollama (installs the hooks and opens a terminal on `ollama launch claude`).
- She pulls faces while she talks: one visor glyph per message, glitching from one to the next.

**Mission report:** the daily card, counting up, Copy image, delivered once in the evening after 3+ tasks; the demo
doesn't count.

**Chat**
- In character, knowing what Claude is doing and did today; Enter sends, Esc closes; always labelled as AI.
- Set up with buttons: on this PC with Ollama (install offered with the distro's package manager or the official
  script, run in a visible terminal so you type your own password; then a model downloaded with a progress bar:
  gemma3 or llama3.2; a warning on tiny models), online with no account (Pollinations), or with a key (Groq, Gemini,
  OpenRouter, OpenAI, Mistral, DeepSeek, checked when pasted). Later in the menu: LM Studio, llama.cpp, vLLM, any
  OpenAI-compatible server, or Claude Code itself through `claude -p` in a chosen folder. *Forget our conversations*.
- **Rebuilt:** Ollama cloud models when you're signed in to Ollama, falling back to a local model if they stop
  answering.
- **Rebuilt:** her mood carries into the chat (mad after being thrown, jealous, dizzy, happy) until you apologise or it
  wears off.
- **Rebuilt:** she answers in the language you picked even after chatting in another one.

**What she can do from the chat** (rules from upstream: a name you typed yourself opens directly; something only her
AI came up with gets a button first; anything that would run a program or script, any website, and closing an app
are always behind a button; force quit needs a second click; she never closes system pieces, Claude, Ollama or
herself)
- Open an app or a game; open your folders, the file manager, the trash, or a file on your desktop (**rebuilt**).
- **Rebuilt:** find files by name, by kind (a Blender project is a `.blend`) or by content, with buttons to open or show
  them.
- Search the web; take a screenshot without her in it (saved to `~/Pictures/Screenshots`); she knows the date and time.
- Music: pause, next, louder, mute (MPRIS); **rebuilt:** "play <song>" opens that exact video on YouTube, "play
  whatever you want" lets her pick, "put <artist> on Spotify" opens Spotify on a search.
- **Rebuilt:** start a Roblox game by name.
- A website, behind a button showing where it goes.
- Close an app (polite close, then Force quit if it only hid).
- **Rebuilt:** reminders: time and text read straight from your message (a parser, not the model), a Cancel button,
  asks when if there's no time; when due she comes to your screen (even from the background) with Done and 10 more
  min; missed ones are brought up when she's back; a *Reminders* menu.

**Rebuilt: looking at your screen:** *Look at my screen* (her eyes go to the window in front, a scanline sweeps it,
she says what she makes of it), and *now and then* (every 8–15 min while you're there and have switched windows; off
by default). The first time, she says where the picture goes (to the chat's AI: local stays local, online goes to that
service). The picture is never kept. Needs a vision model; she says so if the model can't see.

**Make her yours:** what she calls you, how she is (in your words), lines of yours with `{name}`, things to remember;
"call me …" and "remember that …" in the chat.

**Rebuilt: attachment:** five stages that grow over weeks of days together, time at the PC, chats, watched work and
kept reminders, with Hexa's own names: **Unknown host**, **Handshake**, **Connected**, **Trusted**, **root**. Each new
stage brings her forks out to look at you. It changes her lines and her chat; once attached she's glad when you come
back and sometimes comes to your pointer on her own. Shown at the top of her menu. **Jealousy:** when the window in
front is another AI (ChatGPT, Gemini, Copilot, Perplexity, DeepSeek, Grok, Le Chat, Character.AI, Meta AI, Codex, or
Claude while she watches Codex) she notices; if you stay, once attached, she sits on it, glares and possesses it with
an angry glyph, then sulks. Off with *Jealous of other AIs*.

**With the mouse:** pixel-accurate click on her body only; click for status (or a *Talk to me* button when nothing's
going on); drag; click the panel to close it; right-click for her menu (also on the tray icon).

**Menu:** where you two stand; teleport, Fork, demo, how it works, mission report, stats, talk to her, look at my
screen, reminders, sessions HUD, size, sound, screen, follow me across screens, AI model, wander, possess my windows,
jealous of other AIs, react to my PC, answer permissions from Hexa, Do Not Disturb behaviour, language, start at
login, hooks (per assistant), quit.

**Languages:** English, French, Spanish, Brazilian Portuguese, Russian; chosen from `LANG` and changeable. All lines
are original.

**Sounds:** all synthesised live with Web Audio (`voice.js` ported as an engine, new sounds designed for her). Custom
sound files (`.mp3`, `.wav`, `.ogg`, `.m4a`) in `~/.local/share/hexa/sounds/`, with upstream's names plus `fork`.

**Demo:** `hexa demo` (and the menu) replays a fake session (reads, a web fetch, a subagent, writes, a failing test, a
permission prompt, the end), then her own tricks, with a test window she can sit on and possess.

**Reduced motion:** if the desktop asks for reduced animations (Plasma's animation speed set to instant, or
`gtk-enable-animations` off), she sticks to fades.

## 8. Hooks

- **Events used:** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
  `PermissionRequest` (opt-in, §7.1), `PermissionDenied`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop`,
  `StopFailure`, `PreCompact`, `SessionEnd`.
- **`hexa-hook.js`:** registered with `"async": true`, so it never slows Claude. Reads the event from stdin, keeps only
  what the display needs (upstream's trimming: strings cut at 280 characters, file contents replaced by their length,
  the last reply cut at 6,000), adds its parent PID and `transcript_path`, posts to the socket, and exits 0 within 2
  seconds whatever happens.
- **Installer:** adds Hexa's entries to `~/.claude/settings.json` after writing a timestamped backup next to it, keeps
  every other hook, is idempotent, and removes only its own entries on uninstall. Same for Codex's and Antigravity's
  configs. Restart note shown after installing.
- **First contact:** the first event from a session after installing makes her say she can see Claude.

## 9. Data and privacy

| What | Where |
|---|---|
| Settings | `~/.config/hexa/config.json` |
| History, chat memory, reminders, custom sounds, user packs | `~/.local/share/hexa/` |
| Logs | `~/.local/state/hexa/` |
| Socket | `$XDG_RUNTIME_DIR/hexa/` |

- Nothing leaves the machine except: chat messages and (when asked) screenshots to the chat provider you chose (local
  providers stay local), YouTube and Roblox searches you ask for, and an Ollama model download you start. The docs list
  each.
- From transcripts, only token counts are read into her records.
- Window titles: only the front window's, only matched against AI names, never stored.
- USB sticks: file extensions are counted, names never shown or kept.

## 10. Error handling
- The hook never fails Claude: any error, timeout or missing app means exit 0, no output.
- Every platform backend can fail on its own: it logs once, the feature it powers is hidden from the menu, and the rest
  works.
- Persistent files are written atomically (temporary file, then rename); a corrupt file is moved aside as
  `*.corrupt-<time>` and replaced with defaults, with a log line.
- The bridge refuses oversize or malformed requests without affecting the app.
- Chat provider errors show in her panel in plain words with what to try (start Ollama, check the key, pick another
  model).

## 11. Testing
- **Unit tests** (`node:test`, run by `npm test`): hook trimming and exit behaviour; bridge (socket modes, routes,
  Origin and token rules, size limits); session reducer; permission broker (timeouts, closed connections, late clicks,
  single-use IDs, refusal from non-overlay sources); usage parser (fixture transcripts, deduplication); history
  aggregation; `.desktop` parser; Steam VDF and ACF parsers; `/proc` and `/sys` parsers; udev event classifier;
  reminder time parser in all five languages; line tables (every key in every language); config migration; hook
  installer (backup, idempotence, keeps foreign hooks).
- **Integration:** X11 tracker against the live display (skipped without `DISPLAY`); KWin script syntax check; D-Bus
  backends against a mock bus.
- **End to end:** the app started with `--dev` exposes `/debug/capture` (save a frame), `/debug/testwin` (open test
  windows), `/debug/mouse` (a stand-in pointer), `/debug/type`; the demo replay is the scripted walk-through; captured
  frames are reviewed at each milestone.
- **CI** (GitHub Actions, Ubuntu): install, lint, unit tests, and a packaging dry run on every push; full packages on
  tags.

## 12. Packaging and distribution
- `electron-builder` Linux targets: **AppImage**, **.deb**, **.rpm**, **pacman**, **.tar.gz**; desktop entry
  (category Utility), icons from 16 to 512 px; the `hexa` command linked into `/usr/bin` by the deb, rpm and pacman
  packages.
- **AUR:** `packaging/aur/PKGBUILD` for `hexa-bin`, built from the release tarball.
- **Release workflow:** on a `v*` tag, build every target and attach them to a GitHub Release with checksums.
- **Pinned versions** (each at least two weeks old on 2026-10-28): Electron `44.7.1`, electron-builder `26.17.0`,
  `x11` `4.3.1`, `dbus-next` `0.10.2`, `@fontsource/chakra-petch` and `@fontsource/jetbrains-mono` `5.3.0`.

## 13. Documentation
- `README.md`: what Hexa is, screenshots and GIFs, quick install per distro, quick start with Claude Code, links.
- `docs/install/`: `fedora.md` (also RHEL, Alma, Rocky, Nobara), `ubuntu-debian.md` (also Mint, Pop!_OS,
  elementary), `arch.md` (also Manjaro, EndeavourOS, CachyOS, AUR), `opensuse.md`, `appimage.md` (any distro),
  `tarball.md`, `from-source.md`, each with uninstall steps.
- `docs/`: `usage.md`, `claude-code.md` (hooks, other assistants), `permissions.md`, `sessions-hud.md`, `stats.md`,
  `cli.md`, `chat.md`, `privacy.md`, `x11-and-wayland.md`, `character-packs.md`, `architecture.md`,
  `troubleshooting.md` (compositor, NVIDIA, Wayland, hooks not firing), `faq.md`.
- `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `LICENSE` (MIT), `NOTICE` (upstream MIT notice and credits).

## 14. Milestones

Each milestone ends with the app running on the reference machine, its tests passing, frames captured and reviewed,
and the Obsidian project note updated.

| # | Scope | Done when |
|---|---|---|
| M1 | Repo skeleton, overlay window, input-shape click-through, Hexa's rig and renderer, acting engine, bridge and hook, Claude Code installer, brain, ticker and panel, idles (float, drift, look, zap, teleport, fall, drag, sleep and suspend, peek), boot intro, tray, config, English lines, sounds, demo | A real Claude Code session drives her ticker, alerts and victory; clicks pass through everywhere except her body; the demo runs end to end |
| M2 | X11 tracker, KWin backend, sitting and riding windows, possession, Claude's window by process tree, the answer panel, the guide and pointing, multiple screens, throwing | She sits on and follows a moved Konsole window on both monitors; points at Claude's window during a permission prompt |
| M3 | Permissions from her, sessions HUD, usage and stats window, history, mission report, notifications, Do Not Disturb, the CLI, MPRIS, Fork | Two simultaneous Claude sessions show in the HUD; a permission is approved from her card; `hexa run -- false` makes her react; stats show today's tokens |
| M4 | Chat and setup, providers, chat actions, reminders, looking at the screen, PC sensing, attachment and jealousy, make her yours, Codex and Antigravity, the four other languages | Each chat action works on Fedora KDE; reminders fire; a USB stick and the charger get reactions |
| M5 | Packages, CI and release workflows, all documentation, screenshots and GIFs, GitHub repository and first release | Every package installs and runs on Fedora; CI is green; the release page has all packages |

## 15. Risks

| # | Risk | Plan |
|---|---|---|
| R1 | Input-shape click-through misbehaves with Electron or KWin | Built first in M1; fallback is pointer polling |
| R2 | Claude Code's terminal dialog waits for the permission hook | Measured in M3; shorter default wait, documented |
| R3 | Transparency on NVIDIA with X11 | Tested on the reference RTX 4070 in M1; troubleshooting doc |
| R4 | KWin scripting API differences across Plasma 6 releases | Target Plasma 6 API only; X11 path unaffected |
| R5 | Mixed-DPI multi-monitor coordinates | Tested on the reference two-monitor layout in M2 |
| R6 | Scope: about 18,000 lines across five milestones | Milestones are independently usable; each is committed and noted |
| R7 | Publishing needs GitHub auth this machine doesn't have yet | the maintainer logs in (`gh auth login` or an SSH key) before M5 |
