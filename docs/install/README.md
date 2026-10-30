# Installing Hexa

Hexa runs on Linux, x86_64. Packages are on the releases page:
<https://github.com/GithubGiggler/hexa/releases>

Pick the guide for your system:

| System | Package | Guide |
|---|---|---|
| Fedora | `.rpm` | [fedora.md](fedora.md) |
| Ubuntu, Debian, Linux Mint, Pop!_OS | `.deb` | [ubuntu-debian.md](ubuntu-debian.md) |
| Arch Linux, EndeavourOS, Manjaro | AUR `hexa-bin`, or `.pacman` | [arch.md](arch.md) |
| openSUSE Tumbleweed and Leap | `.rpm` | [opensuse.md](opensuse.md) |
| Any distro, no install | `.AppImage` | [appimage.md](appimage.md) |
| Any distro, plain folder | `.tar.gz` | [tarball.md](tarball.md) |
| You want to change her | source | [from-source.md](from-source.md) |

## What she needs

| Need | Why | Notes |
|---|---|---|
| An X11 session, or KDE Plasma 6 on Wayland | Her overlay is an X11 window with a click-through input shape. | On Wayland she runs through XWayland (she sets this up herself). On Plasma Wayland a small KWin script tells her where your windows are. |
| A compositing window manager | Her overlay is transparent. Without a compositor her background is black. | KWin, Mutter (GNOME), picom, or Xfwm with compositing on. In KWin, Alt+Shift+F12 turns compositing on and off. |
| A StatusNotifierItem tray | Her tray icon and its menu. | KDE Plasma has one. GNOME needs the AppIndicator extension. Without a tray, right-click her for the same menu. |
| Claude Code | She narrates what it does, through its hooks. | Optional. Without it she just keeps you company. |
| `node` on your PATH | Runs the Claude Code hook. | Optional. Without it, the hook runs on Hexa's own binary. |

## Desktops

- **KDE Plasma on X11** works best. She sees every window and can follow and sit on them.
- **KDE Plasma 6 on Wayland** works. She runs through XWayland. Window tracking goes through a KWin
  script she loads over D-Bus. It reports window geometry, state, process id and window class only,
  never titles or contents.
- **GNOME** needs the "AppIndicator and KStatusNotifierItem Support" extension for her tray icon.
  Ubuntu ships it turned on. On GNOME Wayland she only sees apps that run through XWayland. Most
  GNOME apps are native Wayland apps, so she can't follow or sit on them.
- **Other X11 desktops** (Xfce, Cinnamon, MATE) should work with a compositor and a
  StatusNotifierItem tray. They are not tested regularly.

## The same on every system

**Claude Code hooks.** Open her menu and choose "Install Claude Code hooks". This adds her hooks to
`~/.claude/settings.json`. A backup of that file is written first, and your other settings and hooks
are kept. Claude Code sessions that are already open don't see the hooks: start a new session. From a
source checkout, `npm run hooks:install` does the same.

**Start at login.** Tick "Start at login" in her menu. This writes `~/.config/autostart/hexa.desktop`.
Untick it to remove that file.

**Her menu** is on her tray icon. Right-clicking her opens it too.

**Where she keeps things:**

| What | Where |
|---|---|
| Settings | `~/.config/hexa/` |
| Data (custom sounds, packs, the hook script) | `~/.local/share/hexa/` |
| Log | `~/.local/state/hexa/hexa.log` |
| Cache | `~/.cache/hexa/` |
| Start at login entry | `~/.config/autostart/hexa.desktop` |

If you set `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` or `XDG_CACHE_HOME`, she uses those
instead.

**Uninstall, in this order:**

1. In her menu, choose "Remove Claude Code hooks". From a source checkout, `npm run hooks:uninstall`
   does the same. Do this first: hooks left behind point at a script that won't be there.
2. Untick "Start at login".
3. Choose "Quit".
4. Remove the package (each guide says how).
5. Remove her folders:

   ```sh
   rm -rf ~/.config/hexa ~/.local/share/hexa ~/.local/state/hexa ~/.cache/hexa
   rm -f ~/.config/autostart/hexa.desktop
   ```

6. Optional: delete the backups she made of your Claude Code settings,
   `~/.claude/settings.json.hexa-backup-*`.

If Hexa is already gone and her hooks are still there, open `~/.claude/settings.json` and delete the
hook entries whose command mentions `hexa-hook.js`. Or clone the repo and run
`node scripts/hooks.js uninstall`. It needs only Node.js, no `npm ci`.

## If something goes wrong

Her log is `~/.local/state/hexa/hexa.log`. It says which window tracking she uses, whether she
found a compositor, and where she listens for Claude Code's hooks.
