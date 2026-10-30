# Hexa from source

For working on Hexa, or for running her where no package fits.

## Install

You need git, and Node.js 22.12 or newer with npm (Electron 44 asks for that Node version).

```sh
git clone https://github.com/OWNER/hexa.git
cd hexa
npm ci
```

`npm ci` installs the exact versions in `package-lock.json`. Electron itself (about 100 MB) is
downloaded the first time it's needed.

To update:

```sh
git pull
npm ci
```

## First start

```sh
npm start
```

She appears on your screen and introduces herself. Her menu is on her tray icon. Right-clicking her
opens it too.

`npm run dev` starts her in dev mode: her page's warnings and errors also go to her log, and she
answers debug requests on her socket.

`npm test` runs the tests. The ones that need an X server skip themselves.

## Claude Code hooks

```sh
npm run hooks:install
```

Or choose "Install Claude Code hooks" in her menu. Either way, start a new Claude Code session
afterwards: sessions that are already open don't load new hooks. `node scripts/hooks.js status`
shows whether they're installed.

The hook script is copied to `~/.local/share/hexa/hooks/`, so the hooks don't depend on where your
checkout is.

## Start at login

Tick "Start at login" in her menu. From source, the entry it writes starts Electron from this
checkout, so keep the checkout and its `node_modules` where they are. If you move it, untick and
tick it again.

## Build the packages yourself

```sh
npm run dist            # every Linux package
npm run dist:appimage   # or one: dist:deb, dist:rpm, dist:pacman, dist:tar, dist:dir
```

They land in `dist/`. AppImage and tar.gz need nothing extra: electron-builder downloads what it
uses. The others need a few system tools:

| Package | Needs | Fedora | Ubuntu, Debian |
|---|---|---|---|
| deb, rpm, pacman | `libcrypt.so.1`, for the Ruby that runs fpm | `libxcrypt-compat` | already there |
| rpm | `rpmbuild` | `rpm-build` | `rpm` |
| pacman | `bsdtar`, `zstd` | `bsdtar`, `zstd` | `libarchive-tools`, `zstd` |

The Release workflow (`.github/workflows/release.yml`) builds all of them on every `v*` tag.

## Desktop notes

- **KDE Plasma on X11** works best.
- **KDE Plasma 6 on Wayland**: she runs through XWayland, and a small KWin script reports where
  your windows are. KWin loads it from `src/main/platform/linux/kwin-script/` in your checkout.
- **GNOME** needs the AppIndicator extension for her tray icon (Ubuntu has it on already). On GNOME
  Wayland she only sees apps that run through XWayland, so window tracking is limited.

See [README.md](README.md#desktops) for more.

## Uninstall

1. Remove her hooks: `npm run hooks:uninstall`, or "Remove Claude Code hooks" in her menu.
2. Untick "Start at login", then choose "Quit".
3. Delete the checkout.
4. Remove her folders:

   ```sh
   rm -rf ~/.config/hexa ~/.local/share/hexa ~/.local/state/hexa ~/.cache/hexa
   rm -f ~/.config/autostart/hexa.desktop
   ```
