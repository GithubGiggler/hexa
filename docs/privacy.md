# Privacy

Hexa runs on your machine and keeps what she learns there. She has no accounts, no telemetry, no
analytics, no crash reporting and no update checks.

She only talks to the network when you chat with her, and only to the brain you picked. This page
lists what leaves your machine and when, what stays, where it is kept, and how to wipe it all.

## What leaves your machine

| What | Where it goes | When |
|---|---|---|
| Your chat messages, the conversation so far, her persona and the time of day | Ollama: `127.0.0.1:11434`, or `OLLAMA_HOST` if you set it | You chat with her Normal or Bigger brain |
| The same, plus the results of her actions (like "Opened github.com") | The Anthropic API, through the Anthropic SDK | You chat with her Max intelligence brain |
| A request for the list of models | The Anthropic API | You open the Brain tab or refresh the model list with Max picked |
| A screenshot of the screen she's on, with your question | The Anthropic API | Claude uses her "look at my screen" tool (see [Screenshots](#screenshots)) |
| The task, screenshots of the screen she's on (up to 18), and the results of her clicks and keys | The Anthropic API | Computer use, after you click Start |
| A link | Your browser, which opens it | You ask her to open a website |

With Ollama on your own machine (the default), the chat never leaves it. If `OLLAMA_HOST` points at
another machine, the chat goes there.

Where the Anthropic SDK sends requests is the SDK's choice: `api.anthropic.com`, unless you point it
elsewhere (for example with `ANTHROPIC_BASE_URL`).

Nothing about your Claude Code sessions is ever put into the chat. Her history, your transcripts,
your file names and your windows are not sent anywhere.

## Claude Code's events stay local

Her hook ([hooks.md](hooks.md)) runs inside Claude Code for each event. It reads the event, keeps
a few fields, cuts them short, and posts them to her Unix socket. The socket is
`$XDG_RUNTIME_DIR/hexa/hexa.sock`, in a folder only you can open (`0700`), and the socket itself is
`0600`. Nothing goes over the network. If she isn't running, the event is dropped.

**What the hook keeps:**

`hook_event_name`, `session_id`, `cwd`, `session_title`, `permission_mode`, `transcript_path`,
`agent_transcript_path`, `tool_name`, `tool_input`, `tool_use_id`, `duration_ms`, `error`,
`is_interrupt`, `prompt`, `message`, `title`, `notification_type`, `last_assistant_message`,
`agent_id`, `agent_type`, `source`, `reason` and `trigger`.

It adds the ID of the process that ran it (to find Claude's window) and `assistant: "claude"`.

**How it cuts them:**

- Every string is cut at 280 characters. Claude's last answer is cut at 6,000.
- Lists keep their first 8 items, and nesting stops after two levels.
- File contents and edits (`content`, `old_string`, `new_string`, `new_source`, `edits`) are
  replaced by their length.
- Transcript paths are kept whole (up to 4,096 characters), because she reads token counts from
  them.

**What it drops:** everything else. That includes tool output (`tool_response`), so what a command
printed never reaches her, except the short `error` of a failed tool call.

The permission hook (opt-in) sends even less: the session ID, the folder, the tool's name, its
input (cut the same way, with file contents left out entirely), the "always allow" rule Claude
offered, and its process ID.

**What she does with them:**

- **Shows them**: the ticker, a quote of your prompt (110 characters), the line of an error that
  names the problem, Claude's answer when you're away from its window.
- **Remembers them in memory**, per session, until the session ends or she quits: the project
  folder's name, the session title, counts, the last action, and Claude's last answer.
- **Counts them** into her history (below).
- **Notifications** (while she's in the background or Do Not Disturb is on) carry only the project
  name and a short label: never Claude's answer, because notifications can show on a lock screen.
  Your desktop's notification server may keep them in its history.

She doesn't write event contents to disk or to her log.

## Transcripts: token counts only

Claude Code keeps a transcript of each session, a JSONL file. When Claude stops, a subagent stops,
or a session ends, she reads the lines added to it since her last read, to count tokens.

- Lines without a `"usage"` field aren't even parsed.
- From Claude's messages she takes only the numbers in `message.usage` (input, output, cache
  writes, cache reads), the model's ID, and the message's ID, so that each message counts once.
  The message IDs stay in memory only.
- The text in a transcript is never kept, shown, logged or sent.
- She only opens absolute paths that end in `.jsonl`.

To read only new lines next time, she keeps each transcript's path, how far she read, its inode
and when she last read it, in `~/.local/share/hexa/history/offsets.json`. An entry she hasn't read
for 30 days is dropped.

## Her history, on disk

One small file per day, `~/.local/share/hexa/history/YYYY-MM-DD.json`, with:

- counts: tasks, prompts, actions, errors, approvals (and how many on her card),
- the files Claude changed, as short hashes of their paths (the first 16 hex digits of a SHA-256),
  never the paths themselves: enough to count each file once,
- time per project, under the project folder's name (`penguin-api`, not its full path),
- tokens per model, and the estimated cost,
- the longest task: its duration and project folder name.

The stats window and `hexa stats` show these numbers. Export saves them to a file you pick.

## Screenshots

She takes screenshots in two cases only, and only with her Max intelligence brain (Claude):

- **"Look at my screen"**: when you ask about your screen in the chat, Claude can use her
  `look_at_screen` tool. Claude decides when to use it, and is told to do so only when you ask
  about your screen. There is no extra confirmation.
- **Computer use**: only after you click Start on her consent card, every time.

A screenshot is the whole screen she's on, her included, scaled down to at most 1280×800. It goes
to the Anthropic API and is never saved to disk. A "look at my screen" picture stays in the chat
conversation, in memory, until you start a new chat, switch brains or she quits. Computer use's
screenshots are let go when the task ends.

With the Normal and Bigger brains she has no tools, so she never takes screenshots.

## Your API key

If you save an Anthropic API key in her Brain tab:

- It is encrypted with your desktop's keyring (Electron's `safeStorage`: KWallet, GNOME Keyring),
  and the result is written to `~/.config/hexa/claude-key.bin`, readable only by you.
- If your desktop has no keyring, she refuses to save it rather than store it in the clear. Set
  `ANTHROPIC_API_KEY`, or use `ant auth login`, instead.
- It's decrypted in memory to make requests, and only sent to the Anthropic API.
- "Forget" in the Brain tab deletes the file.

## Your windows and processes

- **On X11** she reads each window's position, frame, state, desktop, process ID and class
  (`WM_CLASS`). She never reads window titles or contents.
- **On Plasma Wayland** her KWin script reports position, state, desktops, process ID and resource
  class. Never titles or contents.
- **To find Claude's window** she reads `/proc/<pid>/stat` up the hook's process tree, only for
  each process's parent.

All of this stays in memory.

## Your desktop

- **D-Bus** (your local session bus): she sends notifications, reads the notification server's Do
  Not Disturb setting, and reads what your media players report over MPRIS (playing or paused,
  title, artist). What's playing stays in memory, and `hexa status` shows it.
- **The socket** answers only your user. Requests that carry an `Origin` header (web pages) are
  refused. She opens no network port.
- **Debug routes** exist only when she's started with `--dev`.

## Her log

`~/.local/state/hexa/hexa.log` gets what she prints: which screen and window tracking she uses,
where she listens, the paths of files she writes, errors, the button you clicked on her permission
card (allow, always, deny, ask), and why she quit. Never event contents, chat or transcript text.
It is never rotated: delete it whenever you like.

## Where everything is

| What | Where |
|---|---|
| Settings, your API key (encrypted), your prices | `~/.config/hexa/` |
| History and transcript offsets | `~/.local/share/hexa/history/` |
| Reminders | `~/.local/share/hexa/reminders.json` |
| The hook scripts Claude Code runs | `~/.local/share/hexa/hooks/` |
| Your custom sounds and packs | `~/.local/share/hexa/sounds/`, `~/.local/share/hexa/packs/` |
| Her log | `~/.local/state/hexa/hexa.log` |
| Chromium's own caches | `~/.cache/hexa/session/` |
| Her socket | `$XDG_RUNTIME_DIR/hexa/hexa.sock` (or `~/.cache/hexa/hexa.sock`) |
| Start at login | `~/.config/autostart/hexa.desktop` |
| Her hooks | entries in `~/.claude/settings.json`, and backups `settings.json.hexa-backup-*` next to it |

If you set `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` or `XDG_CACHE_HOME`, she uses those
instead. `CLAUDE_CONFIG_DIR` moves Claude Code's settings, and her hooks with them.

## Wiping everything

1. Remove her hooks: "Remove Claude Code hooks" in her menu, or `hexa hooks uninstall`. If she's
   already gone: `node scripts/hooks.js uninstall` from a checkout, or delete the entries whose
   command mentions `hexa-hook.js` or `hexa-permission-hook.js` (see [hooks.md](hooks.md)).
2. Untick "Start at login", then choose "Quit".
3. Remove her folders:

   ```sh
   rm -rf ~/.config/hexa ~/.local/share/hexa ~/.local/state/hexa ~/.cache/hexa
   rm -f ~/.config/autostart/hexa.desktop
   ```

4. Optional: delete the backups of your Claude Code settings, `~/.claude/settings.json.hexa-backup-*`.
5. Optional: your keyring may hold the key Electron used to encrypt your API key, under a name with
   "Hexa" in it. Without `claude-key.bin` it protects nothing.
6. Exports you saved, and her notifications in your desktop's notification history, are yours to
   delete.

Her socket folder lives in `$XDG_RUNTIME_DIR`, which your system empties when you log out.

To uninstall the app itself, see [install/](install/README.md).
