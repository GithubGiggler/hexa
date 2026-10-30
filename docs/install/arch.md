# Hexa on Arch Linux

For Arch Linux and distros built on it (EndeavourOS, Manjaro). x86_64 only.

## Install

There are two ways. Use one, not both: the packages conflict.

**From the AUR**, once `hexa-bin` is published there. With an AUR helper:

```sh
yay -S hexa-bin
```

Or by hand:

```sh
git clone https://aur.archlinux.org/hexa-bin.git
cd hexa-bin
makepkg -si
```

**From the release.** Download `Hexa-<version>-x64.pacman` from
<https://github.com/OWNER/hexa/releases>, then:

```sh
sudo pacman -U ./Hexa-*-x64.pacman
```

Either way, Hexa goes to `/opt/Hexa`, with a `hexa` command in `/usr/bin` and an entry in your app
menu.

To update: the AUR helper updates `hexa-bin` with the rest of your AUR packages. For the release
package, download the newer file and run the same `pacman -U` command.

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

- **KDE Plasma on X11** works best.
- **KDE Plasma 6 on Wayland**: she runs through XWayland, and a small KWin script reports where
  your windows are. Nothing to set up.
- **GNOME** needs the AppIndicator extension for her tray icon:

  ```sh
  sudo pacman -S gnome-shell-extension-appindicator
  ```

  Turn it on in the Extensions app, then log out and back in. On GNOME Wayland she only sees apps
  that run through XWayland, so window tracking is limited.
- **Window managers without a compositor** (i3, Openbox, bspwm): run one, such as picom, or her
  background is black. You also need a StatusNotifierItem tray for her icon. Without one,
  right-click her for her menu.

See [README.md](README.md#desktops) for more.

## Uninstall

1. In her menu, choose "Remove Claude Code hooks" (or run `npm run hooks:uninstall` from a source
   checkout).
2. Untick "Start at login", then choose "Quit".
3. Remove the package, `hexa-bin` from the AUR or `hexa` from the release:

   ```sh
   sudo pacman -R hexa-bin
   # or
   sudo pacman -R hexa
   ```

4. Remove her folders:

   ```sh
   rm -rf ~/.config/hexa ~/.local/share/hexa ~/.local/state/hexa ~/.cache/hexa
   rm -f ~/.config/autostart/hexa.desktop
   ```
