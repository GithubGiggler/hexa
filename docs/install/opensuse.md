# Hexa on openSUSE

For openSUSE Tumbleweed and Leap on x86_64. It's the same `.rpm` as for Fedora.

## Install

1. Download `Hexa-<version>-x86_64.rpm` from <https://github.com/GithubGiggler/hexa/releases>.
2. Install it with zypper, which also pulls in what it needs. The package isn't signed, so tell
   zypper that's expected:

   ```sh
   sudo zypper install --allow-unsigned-rpm ./Hexa-*-x86_64.rpm
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

- **KDE Plasma** is openSUSE's usual desktop. On Plasma 6 Wayland she runs through XWayland and a
  small KWin script reports where your windows are. Plasma on X11 works best.
- **GNOME** needs the "AppIndicator and KStatusNotifierItem Support" extension for her tray icon.
  Install it with zypper if your release packages it (`gnome-shell-extension-appindicator`), or
  from extensions.gnome.org. Turn it on in the Extensions app, then log out and back in. On GNOME
  Wayland she only sees apps that run through XWayland, so window tracking is limited.

See [README.md](README.md#desktops) for more.

## Uninstall

1. In her menu, choose "Remove Claude Code hooks" (or run `npm run hooks:uninstall` from a source
   checkout).
2. Untick "Start at login", then choose "Quit".
3. Remove the package:

   ```sh
   sudo zypper remove hexa
   ```

4. Remove her folders:

   ```sh
   rm -rf ~/.config/hexa ~/.local/share/hexa ~/.local/state/hexa ~/.cache/hexa
   rm -f ~/.config/autostart/hexa.desktop
   ```
