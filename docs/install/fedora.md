# Hexa on Fedora

For Fedora on x86_64. The same `.rpm` also installs on openSUSE ([opensuse.md](opensuse.md)).

## Install

1. Download `Hexa-<version>-x86_64.rpm` from <https://github.com/OWNER/hexa/releases>.
2. Install it with dnf, which also pulls in what it needs:

   ```sh
   sudo dnf install ./Hexa-*-x86_64.rpm
   ```

Hexa goes to `/opt/Hexa`, with a `hexa` command in `/usr/bin` and an entry in your app menu.

To update, download the newer `.rpm` and run the same command.

## First start

Start "Hexa" from your app menu, or run `hexa` in a terminal. She appears on your screen and
introduces herself. Her menu is on her tray icon. Right-clicking her opens it too.

## Claude Code hooks

In her menu, choose "Install Claude Code hooks". Then start a new Claude Code session: sessions
that are already open don't load new hooks. From a source checkout, `npm run hooks:install` does
the same.

## Start at login

Tick "Start at login" in her menu.

## Desktop notes

- **Fedora KDE Plasma** runs Plasma on Wayland. Hexa runs through XWayland there, and a small KWin
  script reports where your windows are. Nothing to set up.
- **Fedora Workstation (GNOME)** needs the AppIndicator extension for her tray icon:

  ```sh
  sudo dnf install gnome-shell-extension-appindicator
  ```

  Turn it on in the Extensions app, then log out and back in. On GNOME Wayland she only sees apps
  that run through XWayland, so window tracking is limited.
- **KDE Plasma on X11**, where you have it, works best.

See [README.md](README.md#desktops) for more.

## Uninstall

1. In her menu, choose "Remove Claude Code hooks" (or run `npm run hooks:uninstall` from a source
   checkout).
2. Untick "Start at login", then choose "Quit".
3. Remove the package:

   ```sh
   sudo dnf remove hexa
   ```

4. Remove her folders:

   ```sh
   rm -rf ~/.config/hexa ~/.local/share/hexa ~/.local/state/hexa ~/.cache/hexa
   rm -f ~/.config/autostart/hexa.desktop
   ```
