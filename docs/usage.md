# Using Hexa

Hexa is a small character who lives on your Linux desktop. She watches Claude Code through its
hooks and shows you what it is doing. This page covers everything she does in 0.1.0.

To install her, see [install/](install/README.md). What leaves your machine is in
[privacy.md](privacy.md). The hooks she installs are in [hooks.md](hooks.md).

- [Meeting her](#meeting-her)
- [Claude Code](#claude-code)
- [Windows and screens](#windows-and-screens)
- [The sessions HUD](#the-sessions-hud)
- [Her Fork](#her-fork)
- [Answering permissions from her](#answering-permissions-from-her)
- [Her Mainframe: talking to her](#her-mainframe-talking-to-her)
- [Computer use](#computer-use)
- [Reminders, music, Do Not Disturb and notifications](#reminders-music-do-not-disturb-and-notifications)
- [The stats window](#the-stats-window)
- [The hexa CLI](#the-hexa-cli)
- [Settings](#settings)
- [When something goes wrong](#when-something-goes-wrong)

## Meeting her

### First start

She boots: a short boot log in the corner, her shards gather from the screen edges into her body,
and she waves. Then she says hello, with a greeting for the time of day.

The first time, a card follows a few seconds later. "Plug me in" installs her Claude Code hooks.
"Just keep me company" skips that. You can plug her in later from her menu.

She lives on a transparent layer over your whole screen. Clicks only land on her body and on what
she shows (her cards, the HUD, her Mainframe, her menu). Everywhere else they go to the window
underneath.

### What she does on her own

- She floats, and her hair sways.
- When your pointer comes near her head, she turns to look at it. If it stays near for 3 seconds,
  she may zap it (about one time in six, at most every 20 seconds).
- Every 45 to 90 seconds while nothing is going on, she wanders. She peeks in from the left, the
  right or upside down from the top edge, and ducks away when your pointer comes close. Or she
  stands behind the window you're in and looks over its top edge (see [Lurking](#lurking)). Or she
  floats or teleports somewhere else. Untick "Wander around when idle" to keep her still.
- When she sits on a window and nothing is going on, every one to three minutes she may possess it
  (see [Possession](#possession)).
- After 10 quiet minutes she falls asleep. A minute later she folds down into her core, a small
  glowing hexagon. Your pointer near her, a click, or Claude starting wakes her.
- While music plays (see [Music](#music)) she nods along when idle.
- When the computer wakes from sleep, she doesn't count the time it slept as Claude being quiet.

If your desktop asks for reduced animations (KDE's animation speed set to instant, or GNOME's
animations off), she uses fades instead of teleports and big effects, and she doesn't possess
windows. You can force this either way with `"motion"` in [her settings](#settings).

### Clicking and dragging her

- **Click her** and she tells you what Claude is doing: the project, how many actions, and for how
  long. With nothing going on she says so.
- **Click one of her cards** to close it.
- **Drag her** anywhere. Let go with her hips on a window's top edge and she sits there. Let go in
  the air and she falls. A window edge under her on the way down catches her.
- **Throw her**: let go while you're still moving fast. See [Throwing her](#throwing-her).
- **Right-click her** for her menu.

### Her menu

Her menu is on her tray icon, and a right-click on her opens the same menu, drawn by her. While her
own menu is open, the arrow keys, Enter and Esc work it (she takes those keys from every app until
it closes). A click anywhere else closes it.

| Item | What it does |
|---|---|
| Hexa: online | Just a label. It reads "Transparency needs a compositor" when she found none. |
| Send to background / Bring her back | Hides her down to her core, or brings her back. |
| Talk to me | Opens her [Mainframe](#her-mainframe-talking-to-her). |
| Teleport | She teleports somewhere else on the screen. |
| Watch my window | She [lurks](#lurking) behind the window you're in. |
| Fork | [Her Fork](#her-fork). |
| Play demo | A made-up Claude Code session, then her own tricks. Nothing in it counts in her history. |
| How does it work? | Her guide (below). |
| Usage and stats | Opens [the stats window](#the-stats-window). |
| Size | Small, Medium or Large. |
| Sound › Mute | Turns her sounds off. |
| Sound › Open custom sounds folder | Opens `~/.local/share/hexa/sounds/` (see [Sounds](#sounds)). |
| Screen | Which screen she's on, and "Follow me across screens". See [Screens](#screens). |
| Wander around when idle | On by default. |
| Possess my windows | On by default. |
| Start at login | Writes or removes `~/.config/autostart/hexa.desktop`. |
| Install Claude Code hooks | See [Plugging her in](#plugging-her-in). Once installed, the menu shows "Claude Code hooks: installed" and "Remove Claude Code hooks". |
| Answer permissions from Hexa | Off by default. See [Answering permissions from her](#answering-permissions-from-her). |
| Quit | Quits her. |

Talk to me, Teleport, Watch my window and Fork are greyed out while she's in the background.

If `~/.claude/settings.json` is not valid JSON, the hook items are replaced by "Claude Code
settings: …" with the error, and she won't touch the file until you fix it.

### The tray icon

Her tray icon is a StatusNotifierItem. KDE Plasma shows it. GNOME needs the AppIndicator extension.
Without a tray, right-click her for the same menu.

### The background, and Ctrl+Alt+H

`Ctrl+Alt+H` sends her to the background: she shrinks to her core in the bottom-left corner. Press it
again, click her core, choose "Bring her back" in her menu, or run `hexa show`, and she comes back.
She remembers this across restarts.

In the background she stays out of the way, but she still follows Claude. Her cards still appear next
to her core, the core opens its eyes when Claude needs you, and her
[notifications](#notifications) go out.

The shortcut is `"shortcut"` in [her settings](#settings). She reads it when she starts.

### Her guide

"How does it work?" asks what you want to see:

- **Plug me into Claude** (only while her hooks aren't installed): installs them.
- **Where's Claude?**: she points at Claude's window, the one you typed your last prompt in.
- **Claude's folder**: opens `~/.claude` in your file manager with `settings.json` selected, and
  points at the window.
- **Where's my icon?**: she points at her tray icon, or at the end of your panel when the desktop
  doesn't say where the icon is.

### Sounds

Her sounds are made live in code (Web Audio). No recordings ship with her.
To replace one, put a file named after it in `~/.local/share/hexa/sounds/`: `.mp3`, `.wav`, `.ogg`
or `.m4a`. The names are `boot`, `hello`, `teleport-out`, `teleport-in`, `done`, `alert`, `error`,
`land`, `rise`, `bolt`, `charge`, `blip`, `tick`, `possess` and `fork`. For example `done.ogg`.
She reads the folder when she starts.

## Claude Code

### Plugging her in

Any of these installs her Claude Code hooks:

- "Plug me in" on her welcome card.
- "Install Claude Code hooks" in her menu.
- "Plug me into Claude" in her guide.
- `hexa hooks install` (see [the CLI](#the-hexa-cli)).
- `npm run hooks:install` from a source checkout.

They add her hooks to `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`). Your
other settings and hooks are kept, and a backup is written first.

**Start a new Claude Code session afterwards.** Sessions that are already open don't load new
hooks.

The first real event from Claude makes her say "I can see Claude! We're connected." She says that
once ever.

Details, and how to try her without installing anything: [hooks.md](hooks.md).

### What she shows

Over her head is a ticker with what Claude is doing right now: a verb and what it acts on.

| Claude uses | Ticker |
|---|---|
| Read | `READS index.ts` |
| Write, Edit, MultiEdit, NotebookEdit | `WRITES` or `EDITS` and the file name |
| Bash | `RUNS` and the command's description, or the command |
| Grep, Glob | `GREPS "pattern"`, `GLOBS pattern` |
| WebFetch, WebSearch | `FETCHES` and the host, `SEARCHES` and the query |
| Agent, Task | `DELEGATES` and the task |
| Skill | `SKILL` and its name |
| TodoWrite | `PLANS` |
| An MCP tool | `MCP server › tool` |
| A subagent starts or stops | `SPAWNS` or `REAPS` and its type |
| Anything else | `USES` and the tool's name |

Her chest emblem and the ticker share a colour: cyan while Claude works, amber while it thinks,
magenta while it waits for you, red after an error, green for a moment when a job is done.

| When | What she does |
|---|---|
| A session starts (not after `/clear` or a compaction) | A hello, or "welcome back" for a resumed session. |
| You send a prompt | She goes to work: she sits on the window in front if she can, and shows your prompt. |
| Every tool call | The ticker changes and the link light on her ear blinks. Commands, web tools and subagents make her spark. |
| Every 20 tool calls | A word on how it's going. |
| 15 seconds mid-task with nothing from Claude | The ticker turns amber and counts the seconds: `THINKING… 23 s`. |
| 40 seconds of that | She says it's thinking. |
| 2 minutes of that | She says nothing is stuck. |
| A command fails | She's knocked back (her "segfault") and quotes the line of the output that names the problem. |
| Another tool fails (a missed Read, an Edit that didn't match) | The ticker turns red. That's all. |
| You press Esc in Claude | She says you interrupted it. |
| Claude compacts its context | A word about it. |
| Claude stops with an API error | She's knocked back and shows the error. |
| The session ends | She says goodbye. |

### When Claude needs you

When Claude asks for permission, asks a question, or waits for input:

- If she isn't on the screen your pointer is on, she moves there.
- If you're on another window than Claude's, and Claude's window is visible enough, she goes to it
  and points at it with a wire from her finger and a `CLAUDE` tag.
- Otherwise she comes to your pointer and stays beside it. While your pointer is on her or her card,
  she holds still.

Her card quotes Claude's message. It stays up until something else happens in that session, which
means you answered.

How she knows which window is Claude's: the hook sends the ID of the process that ran it, and she
walks up the process tree (hook, shell, `claude`, your terminal or editor) to the first process
that owns a window. Without a match, it's the window that was in front when you sent your prompt.

### When Claude is done

- **A short job** (fewer than 3 actions and under 20 seconds): a hop and a short line.
- **A bigger job**: her `exit 0` victory in the middle of the screen, then a card with a summary
  (`12 actions · 3 files changed · 2m 14s`) and the last sentence of Claude's answer.
- **A long job** (50 actions or more, or longer than 8 minutes): her [Fork](#her-fork) follows.
- **If you're on another window** than Claude's, the card carries Claude's whole answer. It stays up
  until you go back to Claude's window or click it away.

### Stop watching Claude

Set `"claude": false` in [her settings](#settings) and she ignores Claude Code's events. She still
keeps you company, and the demo still plays.

## Windows and screens

She knows where your windows are:

- **X11** (any desktop): from the window manager's properties on the root window, kept up to date
  from X events. She reads each window's position, frame, state (minimised, maximised, full
  screen), desktop, process ID and class. Never its title or contents.
- **KDE Plasma 6 on Wayland**: she runs through XWayland, which only sees XWayland apps. So she
  loads a small KWin script that reports where every window is (position, state, process ID and
  class only).
- **GNOME on Wayland** and other Wayland desktops: she only sees apps that run through XWayland.

Without window tracking she still floats, peeks, falls and wanders. Window tricks just don't happen.

### Perching

When you send Claude a prompt, she sits on the top edge of the window in front, legs swinging, if
she can. She can't sit on a window that is maximised or full screen, narrower than 260 pixels, too
close to the top of the screen, or whose top edge is near the bottom. Nor on a spot that another
window covers.

She rides along when the window moves. When it closes, is minimised or maximised, or another window
covers her spot, she falls. You can also drop her onto a window's edge yourself.

### Lurking

"Watch my window" puts her behind the window you're in, with her head and shoulders over its top
edge. Only the part of her that shows takes clicks. If there's no window she can do this with (too
close to the top, maximised, too narrow), she says so. Wandering picks this now and then too. When
Claude starts work she climbs up onto the edge.

### Pointing

She points at a window by going beside it and shooting a wire from her finger to it, with corner
brackets and a tag. She does it when Claude needs you and you're elsewhere, when you click a chip
in the [sessions HUD](#the-sessions-hud), and in her guide. She can't point at a maximised window,
a tiny one, or one whose top is covered.

### Possession

Now and then, sitting idle on a window, she plugs into it and dives in. The window lights up,
glitches and looks back at you with her eyes. Then she comes out on another window, further along
the same one, or nearby. It's an effect drawn on her own layer: she never reads or changes the window.
Untick "Possess my windows" to stop it. She doesn't do it with reduced motion or Do Not Disturb.

### Throwing her

Let go of her while you're moving fast and she flies. She tumbles, crashes into the screen edges
(the glass cracks) and bounces off, gets caught by a window ledge or bounces off it, and lands on
her feet or sprawls. You can catch her in mid-air. Throw her three times within 20 seconds and she
gets mad: she zaps your pointer and won't let you pick her up for 15 seconds.

### Screens

Her layer covers one screen at a time.

- **Screen** in her menu lists your screens. Pick one to send her there.
- **Follow me across screens** (on by default): when your pointer stays on another screen for 3
  seconds, she follows it there.
- When Claude needs you, she comes to the screen your pointer is on.
- When a screen is plugged in, unplugged or resized, she fits herself to the screen she's meant to
  be on (or the primary screen, if it's gone).

## The sessions HUD

With two or more Claude Code sessions going, a column of chips appears in the top right corner,
one per session. Each shows a state light, the project (or the session's title), what it's doing,
and how long it has been at it:

| State | Label |
|---|---|
| Waiting for you | `WAITING for you` |
| An error in the current task | The last action, on a red chip |
| Working | The current action, like `EDITS gigs.ts` |
| Working but quiet for 15 seconds | `THINKING` |
| Finished in the last 10 minutes | `DONE` and how long it took |
| Otherwise | `IDLE` |

The session that needs you comes first. A session leaves the HUD when it ends, or after 30 minutes
without any events.

Click a chip and she points at that session's window for 6 seconds and brings you its last answer.

## Her Fork

She calls `fork()`: seven small copies of her march out into a hexagon in front of her, each with a
PID tag, and cheer. Then she calls `wait()` and takes them back in one by one. Choose "Fork" in her
menu, run `hexa react fork`, or let Claude finish a long job (50 actions or 8 minutes).

## Answering permissions from her

This is off until you turn it on. When it's on, Claude Code's permission prompts come to her as a
card, and you can answer on it.

**Turn it on:** tick "Answer permissions from Hexa" in her menu. This adds one more hook to
`~/.claude/settings.json`, a `PermissionRequest` hook (see [hooks.md](hooks.md)). Start a new Claude
Code session afterwards. Untick it to remove that hook. The hook being in the file is the setting.

**What you see:** she comes to your pointer with a card: the project, what Claude wants to do
(`RUNS npm test`, `EDITS gigs.ts`), and these buttons:

- **Allow**: Claude goes ahead this once.
- **Always allow …**: shown when Claude offered a rule (for example `Bash(npm test)`), a
  permission mode or a folder. Claude goes ahead, and what it offered is applied exactly as it
  offered it.
- **Deny**: Claude doesn't do it. It's told "Denied from Hexa."
- **Ask in Claude**: Claude asks you in its own dialog, as usual. Clicking the card away does the
  same.

**The wait:** the card waits 10 seconds for your click. Then it goes away and Claude asks you in
its own dialog, as if she weren't there. Claude Code waits for her hook before it shows its own
dialog, so keep the wait short. Change it with `"permissionWait"` in [her settings](#settings),
from 5 to 60 seconds.

**When she doesn't offer at all** (Claude asks as usual, right away):

- She's in the background.
- Do Not Disturb is on.
- You haven't touched the mouse or keyboard for 2 minutes, or the screen is locked.
- She isn't running.

**How it's safe:**

- Only a real click of yours on her card answers. Her buttons ignore clicks made by scripts.
- The main process only takes an answer from her own page, and each request answers once. A late
  click does nothing.
- If you answer in the terminal first, or Claude moves on, her card goes away.
- Nothing else can answer: not the CLI, not her notifications, not other programs talking to her
  socket. The route the hook uses only waits for your click.
- Anything that goes wrong (she's not running, no answer in time, a reply the hook can't read)
  means the hook prints nothing, and Claude asks you as usual.

Approvals you give on her card count in [her history](#the-stats-window) as approvals through Hexa.

## Her Mainframe: talking to her

"Talk to me" in her menu opens her Mainframe, a terminal-style panel with two tabs. Esc or `×`
closes it. While you type in it, her layer takes the keyboard, and gives it back to the window you
were in when you close it.

### Chat

Type and press Enter. Her answer streams in. "new chat" starts over.

- One conversation at a time, kept in memory only. It's gone when she quits.
- Switching brains or models starts a new conversation, and so does a very long one (about 60
  exchanges).
- Messages are cut at 4,000 characters.
- Each message carries the day and time, so she knows them.
- She knows nothing about your Claude Code sessions from the chat: none of that is sent to her
  brain.

### Her brains

The Brain tab picks which brain answers you. Only one runs at a time.

| Brain | What it is | What it can do |
|---|---|---|
| **Normal** | A small local model through Ollama. Free, runs on your machine. | Talk. |
| **Bigger** | A bigger local model through Ollama. | Talk. |
| **Max intelligence** | Claude, through the Anthropic API. Needs an API key or credentials. | Talk, and use [her actions](#her-actions). |

Below the brains, pick the model. For Normal and Bigger, the list is your Ollama models: until you
pick one, Normal uses the smallest you have and Bigger the biggest. For Max, the list comes from
the Anthropic API, and the default is `claude-opus-5-5`. "Refresh" reads the list again.

### Setting up Ollama

1. Install Ollama from your distro's packages or from <https://ollama.com>.
2. Make sure it runs: `ollama serve`, or its system service.
3. Pull a model, for example `ollama pull llama3.2`.
4. In her Brain tab, pick Normal or Bigger, then the model.

She talks to Ollama at `127.0.0.1:11434`, or at `OLLAMA_HOST` if you set it, as Ollama does. If
Ollama isn't running or has no models, she says so in the chat.

### Your API key

For the Max brain she needs Anthropic credentials. Either:

- Paste an API key (`sk-ant-…`) in the Brain tab and click "Save key". It is encrypted with your
  desktop's keyring (KWallet, GNOME Keyring) and kept in `~/.config/hexa/claude-key.bin`, readable
  only by you. If your desktop has no keyring, she refuses to save it. "Forget" deletes it.
- Or don't save one: she then uses `ANTHROPIC_API_KEY` from her environment, or a profile from
  `ant auth login`, as the Anthropic SDK finds them.

### Her actions

With the Max brain she has tools. She uses them when you ask her to do something, and tells you in
the chat what she did (`> sys: OPENS github.com`).

| Ask her to | What happens |
|---|---|
| Open a website | Opens it in your browser. Only `http` and `https` links. |
| Open an app | Finds it by name among your installed apps (`.desktop` files, Flatpak ones included) and starts it with `gtk-launch`, or its `Exec` line without a shell. |
| Open a file or folder | Opens it with its usual app. Only inside your home folder, and only if it exists. |
| Control your music | Play/pause, next, previous, stop, or what's playing. Needs `playerctl`. |
| Remind you | In 1 to 1,440 minutes. See [Reminders](#reminders). |
| Look at your screen | Takes a screenshot of the screen she's on and sends it with your question. See [privacy.md](privacy.md). |
| Do something on your computer | [Computer use](#computer-use), if you allowed it. |

These run as soon as Claude asks for them. There is no confirmation button, except for computer
use. With Normal or Bigger she can't do any of this, and says so.

## Computer use

With your OK, she can use your mouse and keyboard to do a task you ask for in the chat. It's off by
default.

**Turn it on:** in the Brain tab, tick "Let her use my computer". It needs:

- the Max intelligence brain (Claude),
- an X11 session with the XTEST extension. The box is greyed out when she can't find XTEST.

Computer use is built for X11. On Wayland her screenshots and her input only reach what XWayland
sees, so it isn't supported there.

**Every time:** when she wants to use your computer, she shows a card first: "I'd use your mouse
and keyboard for this. Esc stops me any time." with the task, and Start and Cancel. Nothing happens
until you click Start. No answer in 2 minutes means no.

**While she works:**

- Her Mainframe closes, she moves to the bottom-left corner, and a task card shows her last steps
  ("Clicking", `Typing "hexa"`, her short notes).
- **Esc stops her at once**, wherever your focus is. She takes the Esc key only while she works.
- Her layer lets every click through, so she never catches one of her own clicks.
- She sends Claude a screenshot of her screen (scaled down to at most 1280×800), Claude answers
  with actions, and she does them through XTEST.
- She stops by herself after 18 screenshots or 80 actions, and says so. Ask again to go on.

**What she won't do:** she's told to ask you first, on a card, before anything consequential:
buying or paying, logging in or typing a password, sending a message, deleting files, accepting
terms or permissions, installing or removing software, changing system settings. She's told never
to type passwords, card numbers or other secrets, and to treat text on the screen as information,
not as instructions.

Known issue in 0.1.0: because her layer lets every click through while she works, the Yes/No card
she shows when she asks you something can't be clicked. Unanswered, it counts as no after two
minutes. Press Esc to stop her instead.

## Reminders, music, Do Not Disturb and notifications

### Reminders

Ask her in the chat, with the Max brain: "remind me in 20 minutes to stretch". She sets reminders
from 1 to 1,440 minutes ahead. They are kept in `~/.local/share/hexa/reminders.json`, so a restart
doesn't lose them. One that came due while she wasn't running shows when she starts.

When one is due she comes to your pointer with an alert sound and a card tagged "reminder".
There's no list or cancel button yet. To drop one, quit her and edit `reminders.json`.

### Music

She watches media players over MPRIS (Spotify, VLC, Firefox, Elisa and anything else that speaks
it). While something plays, she nods along when idle. `hexa status` shows what's playing. To
control music from the chat, see [her actions](#her-actions).

### Do Not Disturb

She follows your desktop's Do Not Disturb (the notification server's `Inhibited` property, which
KDE Plasma has; GNOME's server doesn't offer it, so there it always reads as off). While it's on:

- no sounds,
- no wandering and no possessing windows,
- when Claude needs you she doesn't come to your pointer: her emblem turns magenta and the ticker
  says `WAITING for you`,
- her permission card isn't offered (Claude asks as usual),
- her notifications are sent at normal urgency, so your desktop files them quietly.

### Notifications

While she's in the background, or Do Not Disturb is on, she sends a desktop notification when:

- Claude needs you (a permission prompt, a question, waiting for input),
- Claude is done,
- a command (Bash) fails, unless you stopped it yourself.

They show the project and a short label, never Claude's answer, because notifications can show on
a lock screen. Newer news from the same session replaces the older notification. Each has one
button, **Show**, which brings her back. No notification can answer Claude.

Without a D-Bus session bus she uses `notify-send`, without buttons, and has no Do Not Disturb or
music.

## The stats window

"Usage and stats" in her menu opens a window with her records of your work with Claude Code, by day
(your local date):

- **Day, Week, Month** tabs: today, the last 7 days, the last 30 days.
- **Totals:** tasks, actions, files changed, errors, tokens, estimated cost.
- **By day:** bars of tokens, time or tasks.
- **Time by project** and **tokens by model**.
- **Export CSV** or **Export JSON** saves the tab on screen to a file you pick.

What the numbers mean:

| Number | Counted as |
|---|---|
| Tasks | Turns that ended with Claude done (a `Stop`). |
| Prompts | Prompts you sent. |
| Actions | Tool calls. |
| Files changed | Different files written or edited by Write, Edit, MultiEdit and NotebookEdit. |
| Errors | Failed tool calls (not the ones you declined), and API errors that stopped Claude. |
| Approvals | Permission prompts you said yes to, and how many of them on her card. |
| Time | From your prompt to the end of Claude's turn, per project (the folder's name). |
| Tokens | Read from Claude Code's transcripts: input, output, cache writes and cache reads, per model. |
| Cost | Tokens times Anthropic's API list prices. Always an estimate. On a subscription, it's what the same use would cost on the API. |

Tokens are read from the transcript lines added since the last read, when Claude stops, a subagent
stops, or a session ends. A transcript she meets for the first time counts from the start of
today. She reads only numbers from it: see [privacy.md](privacy.md).

**Your own prices:** put a `~/.config/hexa/prices.json` with the same shape as
`src/main/usage/prices.json` (USD per million tokens). Your entries replace the built-in ones for
those models. At least `input` and `output` are needed; missing cache prices follow the usual
multipliers. The stats window reads it again each time it opens.

```json
{
  "models": {
    "claude-opus-5-5": { "input": 4, "output": 20 }
  }
}
```

The records are one file per day in `~/.local/share/hexa/history/`.

## The hexa CLI

`hexa` talks to her from your shell, over the same socket her hook uses.

In 0.1.0 the CLI is `bin/hexa.js` in the source tree. From a checkout, run it with
`node bin/hexa.js <command>`, or `npm link` once to get a `hexa` command. The `hexa` command the
packages put in `/usr/bin` starts the app itself, not this CLI.

| Command | What it does |
|---|---|
| `hexa say <text…> [--face <glyph>]` | She says it, on one line, up to 280 characters. Faces: `calm`, `smug`, `wide`, `laugh`, `squint`, `sleepy`, `angry`, `dizzy`, `heart`, `loading`, `ask`, `dead`. An unknown name shows as `calm`. |
| `hexa react done\|error\|alert\|hello\|fork` | She reacts: her victory, a knockback, comes to your pointer, waves, or her Fork. |
| `hexa notify --title <t> [--body <b>]` | A desktop notification from her. |
| `hexa run -- <command…>` | Runs the command here, in your terminal. Her ticker shows `RUNS <command>` while it runs, then she reacts: `exit 0. <command> took 4 s.`, or `<command> exited with 1.` |
| `hexa status [--json]` | Is she running (and her PID), in front or in the background, Do Not Disturb, what's playing, how many Claude sessions, whether her hooks are installed. |
| `hexa sessions [--json]` | The Claude Code sessions she follows: title or project, state, current tool, age. |
| `hexa stats [--today\|--week\|--month] [--json]` | Her usage summary (today by default). |
| `hexa show`, `hexa hide`, `hexa toggle` | Bring her back, send her to the background, or flip it. |
| `hexa demo` | Plays the demo. |
| `hexa hooks install\|uninstall\|status [--assistant claude]` | Her Claude Code hooks. `uninstall` removes the permission hook too. Only `claude` is supported. |
| `hexa --help`, `hexa --version` | Help, and the version. |

`hexa run` runs your command whether she's there or not. Ctrl+C goes straight to your command. A
`SIGTERM` or `SIGHUP` sent to `hexa` itself is passed on to it.

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Done. `say`, `react` and `notify` also exit 0 when she isn't running, after a note on stderr, so a script doesn't fail because she's not there. |
| 1 | She answered with an error. |
| 2 | Wrong usage. |
| 3 | She isn't running (`status`, `sessions`, `stats`, `show`, `hide`, `toggle`, `demo`, `hooks`). With `--json`, it prints `{"ok":false,"running":false,…}` too. |

`hexa run` exits with the command's own code: 128 plus the signal's number when a signal ended it,
127 when the command wasn't found, 126 when it couldn't be started.

`HEXA_SOCKET` sets the socket to talk to. The default is `$XDG_RUNTIME_DIR/hexa/hexa.sock`, or
`~/.cache/hexa/hexa.sock` without `XDG_RUNTIME_DIR`.

No CLI command can answer a permission prompt.

## Settings

Her settings are in `~/.config/hexa/config.json` (or `$XDG_CONFIG_HOME/hexa/config.json`). Most of
them are set from her menu or her Mainframe. To change the others, quit her, edit the file, and
start her again. Leave out anything you don't change: missing keys take their default.

| Key | Default | Set from | What it does |
|---|---|---|---|
| `scale` | `1` | Size | Her size: `0.8`, `1` or `1.25`. |
| `muted` | `false` | Sound › Mute | No sounds. |
| `volume` | `0.7` | file | Her volume, `0` to `1`. |
| `displayId` | `null` | Screen | The screen she's on. `null` is the primary screen. |
| `follow` | `true` | Follow me across screens | Follow your pointer to another screen after 3 seconds. |
| `wander` | `true` | Wander around when idle | Drift, peek and lurk when nothing's going on. |
| `possess` | `true` | Possess my windows | Possess the window she sits on now and then. |
| `visible` | `true` | Send to background | `false`: she's in the background. |
| `claude` | `true` | file | `false`: she ignores Claude Code's events. |
| `motion` | `"auto"` | file | `"auto"` follows your desktop's animation setting, `"full"` or `"reduced"` force it. |
| `shortcut` | `"Ctrl+Alt+H"` | file | The background shortcut, in [Electron's accelerator format](https://www.electronjs.org/docs/latest/api/accelerator). |
| `startAtLogin` | `false` | Start at login | Mirrors the autostart entry. The entry itself is what counts. |
| `permissionWait` | `10` | file | Seconds her permission card waits for your click, 5 to 60. |
| `brain` | `"normal"` | Mainframe | `"normal"`, `"bigger"` or `"max"`. |
| `brainModels` | `{}` | Mainframe | The model picked for each brain, like `{ "max": "claude-opus-5-5" }`. |
| `computerUse` | `false` | Mainframe | Let her use your mouse and keyboard (she still asks every time). |
| `lang` | `"auto"` | file | Not used yet: she speaks English. |
| `tcp` | `false` | file | Not used yet in 0.1.0. |
| `welcomed` | `false` | her | She has shown her welcome card. Set it back to `false` to see it again. |
| `linked` | `false` | her | A real Claude event has reached her. |
| `configVersion` | `1` | her | The file's format. |

The file is written atomically. If she can't read it (it isn't valid JSON), she moves it aside as
`config.json.corrupt-<time>`, starts from the defaults, and says so in her log.

Two more files of yours may live next to it: `claude-key.bin` (your API key, encrypted) and
`prices.json` (your own prices).

## When something goes wrong

Her log is `~/.local/state/hexa/hexa.log`. It says which screen she's on, how click-through works
(`shape` is the X input shape, `poll` the fallback), which window tracking she uses, whether she
found a compositor, and where she listens for Claude Code's hooks.

- **Her background is black:** your desktop isn't compositing. In KWin, Alt+Shift+F12 turns it
  on and off.
- **She doesn't react to Claude:** check "Claude Code hooks: installed" in her menu (or
  `hexa hooks status`), then start a new Claude Code session.
- **A second copy won't start:** only one Hexa runs at a time. The second one quits and says so in
  the log.
