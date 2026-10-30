# Hexa as an AppImage

One file that runs on most x86_64 distros, with nothing to install.

## Install

1. Download `Hexa-<version>-x86_64.AppImage` from <https://github.com/GithubGiggler/hexa/releases>.
2. Move it where it will stay, for example `~/Applications`, and make it executable:

   ```sh
   mkdir -p ~/Applications
   mv ~/Downloads/Hexa-*-x86_64.AppImage ~/Applications/
   chmod +x ~/Applications/Hexa-*-x86_64.AppImage
   ```

"Start at login" remembers where the file is, and so do her hooks when `node` isn't installed. If
you move it later, see [Moving or updating](#moving-or-updating).

AppImages need FUSE 2 (`libfuse.so.2`). Most desktops have it. If the AppImage won't open and
mentions FUSE, install it:

| Distro | Package |
|---|---|
| Ubuntu 24.04 and newer | `libfuse2t64` |
| Ubuntu 22.04, Debian | `libfuse2` |
| Fedora | `fuse-libs` |
| Arch | `fuse2` |
| openSUSE | `libfuse2` |

Or run it without FUSE: `./Hexa-*-x86_64.AppImage --appimage-extract-and-run`.

## First start

Double-click the file, or run it:

```sh
~/Applications/Hexa-*-x86_64.AppImage
```

She appears on your screen and introduces herself. Her menu is on her tray icon. Right-clicking her
opens it too.

The AppImage doesn't add itself to your app menu. Tools like Gear Lever or AppImageLauncher can do
that. Or write `~/.local/share/applications/hexa.desktop` yourself, with your own path in `Exec`:

```ini
[Desktop Entry]
Type=Application
Name=Hexa
Comment=Desktop companion that narrates what Claude Code is doing
Exec=/home/you/Applications/Hexa-0.1.0-x86_64.AppImage
Icon=hexa
Terminal=false
Categories=Utility;
```

`Icon=hexa` finds her icon only if one is installed under that name, which the integration tools
do. Otherwise you get a generic icon.

On systems that restrict user namespaces (Ubuntu 24.04 and newer), the AppImage starts with
Chromium's sandbox turned off, because that sandbox needs them. The `.deb` keeps the sandbox on
there: see [ubuntu-debian.md](ubuntu-debian.md).

## Claude Code hooks

In her menu, choose "Install Claude Code hooks". Then start a new Claude Code session: sessions
that are already open don't load new hooks. From a source checkout, `npm run hooks:install` does
the same.

If `node` is on your PATH, the hook runs on it. If not, the hook runs on the AppImage itself, by
its path.

## Start at login

Tick "Start at login" in her menu. The entry it writes starts this AppImage file, by its path.

## Moving or updating

Her login entry and, without `node`, her hooks point at the AppImage's path. After you move or
rename it, or replace it with a newer version under a new name:

1. Start the AppImage from its new place.
2. In her menu, untick and tick "Start at login".
3. Choose "Remove Claude Code hooks", then "Install Claude Code hooks".

## Desktop notes

- **KDE Plasma on X11** works best.
- **KDE Plasma 6 on Wayland**: she runs through XWayland, and a small KWin script reports where
  your windows are. KWin loads that script straight from the mounted AppImage.
- **GNOME** needs the AppIndicator extension for her tray icon (Ubuntu has it on already). On GNOME
  Wayland she only sees apps that run through XWayland, so window tracking is limited.

See [README.md](README.md#desktops) for more.

## Uninstall

1. In her menu, choose "Remove Claude Code hooks" (or run `npm run hooks:uninstall` from a source
   checkout).
2. Untick "Start at login", then choose "Quit".
3. Delete the AppImage, and `~/.local/share/applications/hexa.desktop` if you made one.
4. Remove her folders:

   ```sh
   rm -rf ~/.config/hexa ~/.local/share/hexa ~/.local/state/hexa ~/.cache/hexa
   rm -f ~/.config/autostart/hexa.desktop
   ```
