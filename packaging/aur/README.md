# hexa-bin (AUR)

`PKGBUILD` builds the `hexa-bin` package for Arch Linux from the `.deb` on the GitHub release.
It installs Hexa to `/opt/Hexa`, links `/usr/bin/hexa`, and adds the desktop entry and icons.

Replace `GithubGiggler` in `PKGBUILD` with the GitHub account that hosts the repo before you use it.

## Build it locally

```sh
cd packaging/aur
updpkgsums          # from pacman-contrib: fills in sha256sums
makepkg -si         # builds and installs
namcap PKGBUILD hexa-bin-*.pkg.tar.zst   # optional checks
```

## .SRCINFO

The AUR needs a `.SRCINFO` file next to the `PKGBUILD`. It is not kept in this folder, because it
has to match the `PKGBUILD` exactly and would go stale. Generate it each time the `PKGBUILD`
changes:

```sh
makepkg --printsrcinfo > .SRCINFO
```

## Publish a release to the AUR

1. Tag the release here (`v0.2.0`, say) and wait for the Release workflow to attach the packages.
2. In `PKGBUILD`, set `pkgver` to the new version and `pkgrel=1`.
3. Run `updpkgsums`, then `makepkg --printsrcinfo > .SRCINFO`.
4. Copy `PKGBUILD` and `.SRCINFO` into your clone of `ssh://aur@aur.archlinux.org/hexa-bin.git`,
   commit, and push.
