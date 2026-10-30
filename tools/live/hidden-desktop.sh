#!/bin/bash
# Runs a command on a desktop nobody sees: a headless KWin (virtual framebuffer) with Xwayland,
# its own config, data, cache and state folders, and a private session bus that starts no
# services. Hexa and the live scenarios run there without touching your real desktop.
#
#   tools/live/hidden-desktop.sh node tools/live/m2.js
#
# HEXA_LIVE_DIR keeps the hidden desktop's folders (her log is in $HEXA_LIVE_DIR/state/hexa/);
# by default a fresh temporary folder. Needs kwin_wayland (Plasma 6), dbus-run-session, unshare
# (util-linux) and python3.
#
# It's walled off by namespaces (namespace.py): a private /tmp, so KWin's Xwayland can't touch
# your X server's socket (an earlier version without it left /tmp/.X11-unix/X0 deleted); a
# private network, so your X server's abstract socket can't be reached either; and its own PIDs,
# so when it ends the kernel ends everything in it. Nothing is ever signalled by PID: an earlier
# version did `kill $PPID` from a program KWin started detached, hit your session's systemd and
# logged you out.

set -u
here=$(cd "$(dirname "$0")" && pwd)
live=${HEXA_LIVE_DIR:-$(mktemp -d)}
mkdir -p "$live"
live=$(cd "$live" && pwd)
rm -f "$live/status" "$live/result"
export HEXA_LIVE_CMD=$(printf '%q ' "$@") # each argument kept whole

# where the results folder shows up inside (outside /tmp, which is private in there)
inner=$(mktemp -d -p "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" hexa-live.XXXXXX)

echo "hidden desktop: $live" >&2
timeout --kill-after=5 "$(( ${HEXA_LIVE_TIMEOUT:-180} + 20 ))" \
  unshare --user --map-root-user --mount --pid --fork --mount-proc --net --kill-child \
  python3 -I "$here/namespace.py" "$live" "$inner" "$(id -u)" "$(id -g)" \
  bash "$here/in-namespace.sh" "$inner" &
runner=$!
# stopped from outside (Ctrl+C, a timeout around this script): take the hidden desktop down too
# (its runner is our own child; --kill-child ends everything inside when it goes)
trap 'kill -TERM "$runner" 2>/dev/null; wait "$runner" 2>/dev/null; rmdir "$inner" 2>/dev/null; exit 130' INT TERM
wait "$runner"
rmdir "$inner" 2>/dev/null

cat "$live/result" 2>/dev/null
[ -s "$live/status" ] && exit "$(cat "$live/status")"
echo "hidden desktop: the command did not finish in time (see $live/kwin.log)" >&2
exit 124
