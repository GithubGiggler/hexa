# Changelog

All notable changes to Hexa. Versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0 (unreleased)

The first version: Hexa on Linux, watching Claude Code.

### Her

- An original character, drawn in code from a character pack (`packs/hexa/pack.json`, checked
  against `packs/pack.schema.json`): a rigged skeleton, vector parts, hair and cable physics, a
  visor of LED-matrix eyes with 12 expressions.
- An animation engine of exposure sheets at 12 drawings a second, with a little line boil.
- Effects: hexagon shards, sparks, bolts, glyphs, impact frames, glitches.
- Sounds made live with Web Audio, and your own files in `~/.local/share/hexa/sounds/` in their
  place.
- Her boot, and a greeting for the time of day.
- On her own: floating, looking at your pointer, zapping it, drifting, peeking from the screen
  edges, falling asleep after 10 quiet minutes and folding down into her core.
- Dragging and dropping her; falling and landing; teleporting as an orb that lands in rings;
  throwing her, with crashes, ledges, catching her in mid-air, and getting mad after three throws.
- `Ctrl+Alt+H` sends her to the background, as her core, and back. Nothing she was doing can undo it.
- Reduced motion when your desktop asks for it: fades instead of teleports.
- Her Fork: seven copies with PID tags in a hex lattice, reaped back with `wait()`.

### Claude Code

- Her hook on 13 Claude Code events, asynchronous, so it never slows Claude down. It keeps only the
  fields she uses, cut short, and posts them to a private Unix socket. Transcript paths pass whole.
- The installer for `~/.claude/settings.json`: keeps your settings and hooks, backs the file up
  first, never touches a file that isn't valid JSON, writes through a symlink and keeps the file's
  permissions. `--print-settings` for trying her with `claude --settings`.
- Her ticker of what Claude is doing, her cards, and a safe markdown renderer for Claude's answers.
- Reactions: a hello, your prompt, progress every 20 actions, a thinking counter after 15 seconds,
  coming to your pointer when Claude needs you, a knockback and the telling error line when a
  command fails, her `exit 0` victory and a summary when it's done.
- Turns that end without a `Stop` (Esc, a dismissed prompt) end; the time the computer slept isn't
  counted as Claude thinking.
- Her first contact: "I can see Claude! We're connected.", once.
- Answering permission prompts from her card, opt-in: Allow, Always allow, Deny, Ask in Claude.
  Only your click answers, each request once, within a short wait. Not offered in the background,
  with Do Not Disturb on, or when you're away.

### Windows and screens

- Window tracking on X11 from the window manager's properties and X events; on Plasma 6 Wayland
  through a KWin script. Never window titles or contents.
- Claude's window, found by walking up the hook's process tree.
- Sitting on window edges and riding along; falling when the window goes; lurking behind the window
  you're in; possessing the window she sits on.
- Pointing at Claude's window when it needs you and you're on another one.
- Claude's whole answer brought to you when you're away from its window.
- More than one screen: a Screen menu, following your pointer across screens, coming to your screen
  when Claude needs you.

### Her menu and her guide

- Her menu on the tray icon, and the same menu drawn by her when you right-click her, with the
  arrow keys, Enter and Esc.
- Her guide: plug me into Claude, where's Claude, Claude's folder, where's my icon.
- A demo session, then her own tricks.
- Start at login through XDG autostart.

### The sessions HUD

- With two or more Claude sessions, a chip for each: state, project, action, time. A click makes
  her point at that session's window and bring its last answer.

### Usage and history

- Token counts from Claude Code's transcripts, reading only new lines and counting each message
  once. Only numbers are kept.
- An API price table, with model families and your own `~/.config/hexa/prices.json` on top. Costs
  are always estimates.
- Daily records in `~/.local/share/hexa/history/`: tasks, prompts, actions, files changed (as
  hashes), errors, approvals (and how many on her card), time per project, tokens per model.
- The stats window: day, week and month; bars by day, time by project, tokens by model; CSV and
  JSON export.

### Linux

- Desktop notifications through D-Bus while she's in the background or Do Not Disturb is on: Claude
  needs you, a job is done, a command failed. One button, Show. `notify-send` without a bus.
- Do Not Disturb from the notification server: no sounds, no wandering or possessing, no permission
  card, and a magenta emblem instead of coming to your pointer when Claude needs you.
- MPRIS: she knows what's playing and nods along.
- The `hexa` CLI: `say`, `react`, `notify`, `run`, `status`, `sessions`, `stats`, `show`, `hide`,
  `toggle`, `demo`, `hooks`, with documented exit codes.

### Her brain

- Her Mainframe: a chat with her, and her brain settings.
- Three brains: Normal and Bigger, local models through Ollama; Max intelligence, Claude through the
  Anthropic API. Your API key is kept encrypted in your keyring.
- With Claude, her actions: open a website, an app, a file or folder; control your music; set a
  reminder; look at your screen.
- Computer use, off by default: her consent card every time, Esc to stop, a task card of her steps,
  limits on screenshots and actions.

### Packaging

- AppImage, `.deb`, `.rpm`, pacman and `.tar.gz` packages through electron-builder, and an AUR
  `hexa-bin` PKGBUILD.
- CI runs the tests on every push. A `v*` tag builds and releases every package.
- Install guides for Fedora, Ubuntu and Debian, Arch, openSUSE, the AppImage, the tarball and from
  source.

### Development

- Unit tests with `node:test`, no display needed.
- Live checks against the real app on a hidden desktop, in its own namespaces, so they can't touch
  your session.
- Documentation: usage, privacy, hooks, character packs, architecture, and how to contribute.

### Known issues

- There's no setting to pick another character pack yet.
- The German, French, Spanish and Japanese tables still want a native speaker's read.
