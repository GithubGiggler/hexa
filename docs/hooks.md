# Her Claude Code hooks

Hexa learns what Claude Code is doing through Claude Code's hooks: commands Claude Code runs at
certain moments, with the event as JSON on their standard input. She adds two kinds to
`~/.claude/settings.json`:

- **`hexa-hook.js`**, on 13 events. It tells her what happened. Claude Code doesn't wait for it.
- **`hexa-permission-hook.js`**, on `PermissionRequest`, only if you turn on "Answer permissions
  from Hexa". Claude Code waits for its answer.

Only Claude Code is supported in 0.1.0.

## The events

| Event | What she does with it |
|---|---|
| `SessionStart` | Says hello (not after `/clear` or a compaction). |
| `UserPromptSubmit` | Goes to work; starts timing the task. |
| `PreToolUse` | The ticker, the action count, the files changed. |
| `PostToolUse` | A sign of life; counts an approval when a permission prompt came before it. |
| `PostToolUseFailure` | A failed command knocks her back; Esc ends the turn. Counted as an error. |
| `PermissionDenied` | A sign of life. |
| `Notification` | Claude needs you, or is waiting for your next prompt. |
| `Stop` | The job is done: her victory or a short line; tokens are read. |
| `StopFailure` | Claude stopped on an API error. |
| `SubagentStart`, `SubagentStop` | `SPAWNS` and `REAPS` in the ticker; tokens are read on stop. |
| `PreCompact` | A word about the compaction. |
| `SessionEnd` | Goodbye; tokens are read; the session leaves the HUD. |

What she does with each, in full, is in [usage.md](usage.md#claude-code). What the hook keeps from
each event is in [privacy.md](privacy.md#claude-codes-events-stay-local).

## The event hook

`hexa-hook.js` is registered with `"async": true`, so Claude Code runs it in the background and
never waits for it. The hook itself follows one rule: never get in Claude's way.

- It prints nothing and always exits 0.
- It reads the event (at most 8 MB), keeps a few fields, cuts them short, and posts them to her
  socket.
- It gives up after 800 ms if she doesn't answer, and exits within 2 seconds whatever happens.
- If she isn't running, it exits at once.

It uses only Node's built-in modules, so it runs on any Node.

## The permission hook

`hexa-permission-hook.js` is synchronous: Claude Code waits for it, so its answer counts. It's
only installed when you tick "Answer permissions from Hexa".

1. It sends her the request (the tool, its input, and the "always allow" rule Claude offered) and
   waits for your click on her card.
2. If you click **Allow**, it prints:

   ```json
   {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}
   ```

   With **Always allow**, the decision also carries `"updatedPermissions"`: the rule Claude offered,
   exactly as it was sent.
3. If you click **Deny**, it prints:

   ```json
   {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from Hexa."}}}
   ```

4. Anything else prints nothing and exits 0, and Claude asks you in its own dialog as usual: "Ask
   in Claude", no click within her wait (10 seconds by default), she isn't running, she doesn't
   offer the card (background, Do Not Disturb, you're away), or a reply it can't read.

The hook waits at most 62 seconds for her (her wait is 60 seconds at most), and Claude Code's
timeout for it is 65.

How the card works, and why it's safe: [usage.md](usage.md#answering-permissions-from-her).

## What's added to settings.json

Each of the 13 events gets one more entry after yours, all the same:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/home/you/.local/share/hexa/hooks/hexa-hook.js\"",
            "async": true,
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The 13 events are `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `PermissionDenied`, `Notification`, `Stop`, `StopFailure`, `SubagentStart`,
`SubagentStop`, `PreCompact` and `SessionEnd`.

With "Answer permissions from Hexa" on, `PermissionRequest` gets this entry:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/home/you/.local/share/hexa/hooks/hexa-permission-hook.js\"",
            "timeout": 65
          }
        ]
      }
    ]
  }
}
```

**The command.** If `node` runs on your machine when the hooks are installed, the command is
`node "<script>"`. If not, the hook runs on Hexa's own program, as Node:

```
ELECTRON_RUN_AS_NODE=1 "/home/you/Applications/Hexa-0.1.0-x86_64.AppImage" "/home/you/.local/share/hexa/hooks/hexa-hook.js"
```

For an AppImage that's the AppImage file itself, since its mount point changes every run. If you
move or rename it, install the hooks again.

**The scripts** are copied to `~/.local/share/hexa/hooks/` when the hooks are installed, so the
command never depends on where Hexa is (an AppImage mount, a checkout, an update). After you update
Hexa, install the hooks again to refresh the copies: `hexa hooks install`, or "Remove Claude Code
hooks" then "Install Claude Code hooks". For the permission hook, untick and tick "Answer
permissions from Hexa".

## Installing

Any of these installs the event hooks: "Install Claude Code hooks" in her menu, "Plug me in" on her
welcome card or in her guide, `hexa hooks install`, or `npm run hooks:install` (also
`node scripts/hooks.js install`) from a source checkout. The permission hook is only installed from
her menu.

What the installer does:

1. Reads `~/.claude/settings.json`. A missing or empty file counts as `{}`. A file that isn't valid
   JSON is never touched: she says so, and nothing changes until you fix it.
2. Takes out her own earlier entries (those whose command mentions `hexa-hook.js`, or
   `hexa-permission-hook.js` for the permission hook) and adds the new ones after yours. Your other
   settings and hooks stay as they are.
3. If nothing changed, it writes nothing. Installing again is safe.
4. Otherwise it writes a backup first, then the new file:
   - The backup is `settings.json.hexa-backup-<time>`, next to it, with the same permissions.
   - If `settings.json` is a symlink (a dotfiles repo), the real file is written, and the symlink
     stays.
   - The file keeps its permissions (it can hold tokens under `"env"`). A new file is readable only
     by you (`0600`).
   - It's written to a temporary file and renamed into place, so a crash can't leave half a file.

If `CLAUDE_CONFIG_DIR` is set, she uses `$CLAUDE_CONFIG_DIR/settings.json` instead.

**Start a new Claude Code session afterwards.** Sessions that are already open don't load new
hooks.

**Checking:** her menu says "Claude Code hooks: installed". `hexa hooks status` and
`node scripts/hooks.js status` list the events she's on.

## Removing

| How | What it removes |
|---|---|
| "Remove Claude Code hooks" in her menu | Both hooks |
| Untick "Answer permissions from Hexa" | The permission hook |
| `hexa hooks uninstall` | Both hooks (she must be running) |
| `npm run hooks:uninstall`, or `node scripts/hooks.js uninstall` | Both hooks. Needs only Node, not `npm ci`, and works when she's gone. |

Only her entries go. An event left with no entries is removed from the file, and so is an empty
`"hooks"` object. A backup is written first, as for installing.

**By hand:** open `~/.claude/settings.json` and delete each entry whose `command` mentions
`hexa-hook.js` or `hexa-permission-hook.js`. Do this before you uninstall Hexa: hooks left behind
point at a script that may be gone, and Claude Code may show an error for each of them.

## Backups

Every change she makes to `settings.json` writes a backup first. She never deletes them. To go back
to one, copy it over `settings.json`. To tidy up:

```sh
ls ~/.claude/settings.json.hexa-backup-*
rm ~/.claude/settings.json.hexa-backup-*
```

## Trying her without installing

You can run Claude Code with her hooks for one session, without changing `settings.json`. From a
source checkout:

```sh
node scripts/hooks.js --print-settings > ~/hexa-settings.json
claude --settings ~/hexa-settings.json
```

`--print-settings` copies the hook script to `~/.local/share/hexa/hooks/` and prints a settings
file with the 13 event hooks only (no permission hook). Claude Code adds them to your own settings
for that run. Delete the file when you're done.

## The socket

Both hooks find her at `$XDG_RUNTIME_DIR/hexa/hexa.sock`, or at `~/.cache/hexa/hexa.sock` when
`XDG_RUNTIME_DIR` isn't set. `HEXA_SOCKET` overrides it, for the hooks, the CLI and the app alike.
