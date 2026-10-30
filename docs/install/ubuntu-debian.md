# Hexa on Ubuntu and Debian

For Ubuntu 22.04 or newer, Debian 12 or newer, and distros built on them (Linux Mint, Pop!_OS,
Kubuntu, KDE neon). x86_64 only.

## Install

1. Download `Hexa-<version>-amd64.deb` from <https://github.com/GithubGiggler/hexa/releases>.
2. Install it with apt, which also pulls in what it needs:

   ```sh
   sudo apt install ./Hexa-*-amd64.deb
   ```

Hexa goes to `/opt/Hexa`, with a `hexa` command in `/usr/bin` and an entry in your app menu.

On Ubuntu 24.04 and newer, the package also installs an AppArmor profile, `/etc/apparmor.d/hexa`.
Ubuntu limits the user namespaces that Chromium's sandbox uses, and the profile allows them for
Hexa. You don't need to do anything.

To update, download the newer `.deb` and run the same command.

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

- **Ubuntu (GNOME)** has the AppIndicator extension turned on, so her tray icon works. Ubuntu's
  default session is Wayland. There she only sees apps that run through XWayland, so window
  tracking is limited. If your release still offers "Ubuntu on Xorg" at the login screen, she sees
  every window there.
- **Debian with GNOME** needs the extension for her tray icon:

  ```sh
  sudo apt install gnome-shell-extension-appindicator
  ```

  Turn it on in the Extensions app, then log out and back in.
- **Kubuntu, KDE neon, Debian with Plasma**: on Plasma 6 Wayland she runs through XWayland and
  a small KWin script reports where your windows are. Plasma on X11 works best.
- **Linux Mint (Cinnamon, Xfce, MATE)** runs on X11. She needs compositing turned on to be
  transparent. These desktops are not tested regularly.

See [README.md](README.md#desktops) for more.

## Uninstall

1. In her menu, choose "Remove Claude Code hooks" (or run `npm run hooks:uninstall` from a source
   checkout).
2. Untick "Start at login", then choose "Quit".
3. Remove the package:

   ```sh
   sudo apt remove hexa
   ```

4. Remove her folders:

   ```sh
   rm -rf ~/.config/hexa ~/.local/share/hexa ~/.local/state/hexa ~/.cache/hexa
   rm -f ~/.config/autostart/hexa.desktop
   ```
