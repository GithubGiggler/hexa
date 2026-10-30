# Hexa from the tarball

A plain folder you unpack anywhere. Nothing is installed system-wide, and there's no app menu entry
unless you add one. x86_64 only.

## Install

1. Download `Hexa-<version>-x64.tar.gz` from <https://github.com/OWNER/hexa/releases>.
2. Unpack it, and give the folder a name without the version, so its path stays the same when you
   update:

   ```sh
   mkdir -p ~/.local/opt
   tar -xzf ~/Downloads/Hexa-*-x64.tar.gz -C ~/.local/opt
   mv ~/.local/opt/Hexa-*-x64 ~/.local/opt/Hexa
   ```

The tarball doesn't bring its own system libraries. A desktop with GTK 3 has nearly all of them.
If Hexa won't start and names a missing `.so` file, install these from your distro: GTK 3, NSS,
ALSA, libgbm, libnotify, libXtst and xdg-utils.

To update, quit Hexa, delete `~/.local/opt/Hexa`, and unpack the new version the same way.

## First start

```sh
~/.local/opt/Hexa/hexa
```

She appears on your screen and introduces herself. Her menu is on her tray icon. Right-clicking her
opens it too.

**If it stops with an error about `chrome-sandbox`:** your system restricts user namespaces
(Ubuntu 24.04 and newer do), and Chromium's sandbox needs either those or a setuid helper. Make the
helper setuid:

```sh
sudo chown root:root ~/.local/opt/Hexa/chrome-sandbox
sudo chmod 4755 ~/.local/opt/Hexa/chrome-sandbox
```

Or start her with `--no-sandbox`, which turns the sandbox off. On Ubuntu, the `.deb` handles this
for you ([ubuntu-debian.md](ubuntu-debian.md)).

**App menu entry (optional).** Save this as `~/.local/share/applications/hexa.desktop`, with your
own home folder in `Exec`:

```ini
[Desktop Entry]
Type=Application
Name=Hexa
Comment=Desktop companion that narrates what Claude Code is doing
Exec=/home/you/.local/opt/Hexa/hexa
Icon=hexa
Terminal=false
Categories=Utility;
```

The tarball has no icon files. For her icon, save `assets/icons/hexa-256.png` from the repo
(<https://github.com/OWNER/hexa>) as `~/.local/share/icons/hicolor/256x256/apps/hexa.png`.

## Claude Code hooks

In her menu, choose "Install Claude Code hooks". Then start a new Claude Code session: sessions
that are already open don't load new hooks. From a source checkout, `npm run hooks:install` does
the same.

If `node` is on your PATH, the hook runs on it. If not, it runs on `~/.local/opt/Hexa/hexa`. If you
move the folder, remove and reinstall the hooks from her menu.

## Start at login

Tick "Start at login" in her menu. The entry it writes starts `~/.local/opt/Hexa/hexa`. If you move
the folder, untick and tick it again.

## Desktop notes

- **KDE Plasma on X11** works best.
- **KDE Plasma 6 on Wayland**: she runs through XWayland, and a small KWin script reports where
  your windows are.
- **GNOME** needs the AppIndicator extension for her tray icon (Ubuntu has it on already). On GNOME
  Wayland she only sees apps that run through XWayland, so window tracking is limited.

See [README.md](README.md#desktops) for more.

## Uninstall

1. In her menu, choose "Remove Claude Code hooks" (or run `npm run hooks:uninstall` from a source
   checkout).
2. Untick "Start at login", then choose "Quit".
3. Delete the folder, and the menu entry and icon if you added them:

   ```sh
   rm -rf ~/.local/opt/Hexa
   rm -f ~/.local/share/applications/hexa.desktop ~/.local/share/icons/hicolor/256x256/apps/hexa.png
   ```

4. Remove her folders:

   ```sh
   rm -rf ~/.config/hexa ~/.local/share/hexa ~/.local/state/hexa ~/.cache/hexa
   rm -f ~/.config/autostart/hexa.desktop
   ```
