#!/bin/bash
# Runs a command on a desktop nobody sees: a headless KWin (virtual framebuffer) with Xwayland,
# its own runtime, config, data, cache and state folders, and a private session bus that starts
# no services. Hexa and the live scenarios run there without touching your real desktop.
#
#   tools/live/hidden-desktop.sh node tools/live/m2.js
#
# HEXA_LIVE_DIR keeps the hidden desktop's folders (her log is in $HEXA_LIVE_DIR/state/hexa/);
# by default a fresh temporary folder. Needs kwin_wayland (Plasma 6), dbus-run-session and setsid.
#
# Ending it: everything the hidden desktop runs is in one process group of its own (setsid), and
# only that group is signalled, once its leader is checked to be the one started here. Nothing is
# ever signalled by parent PID: KWin starts its programs detached, so their parent is your
# session's systemd, and a signal to it logs you out.

set -u
here=$(cd "$(dirname "$0")" && pwd)
live=${HEXA_LIVE_DIR:-$(mktemp -d)}
mkdir -p "$live/config" "$live/data" "$live/cache" "$live/state"
rm -f "$live/status" "$live/result"
# Wayland and Hexa's sockets live in the runtime folder, and a socket path must stay under 108
# bytes: a short folder next to your own runtime folder
run=$(mktemp -d -p "${XDG_RUNTIME_DIR:-/tmp}" hexa-live.XXXXXX)
chmod 700 "$run"

export XDG_RUNTIME_DIR=$run XDG_CONFIG_HOME=$live/config XDG_DATA_HOME=$live/data
export XDG_CACHE_HOME=$live/cache XDG_STATE_HOME=$live/state
unset DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS SESSION_MANAGER
export KWIN_COMPOSE=Q # software compositing: no GPU needed
export HEXA_LIVE_CMD="$*"

echo "hidden desktop: $live" >&2
setsid dbus-run-session --config-file="$here/bus.conf" -- \
  kwin_wayland --virtual --xwayland --width 2560 --height 1440 --socket hexa-live --no-lockscreen \
  -- "$here/inside.sh" > "$live/kwin.log" 2>&1 &
leader=$!

# the command is done when it writes its status, or gives up at the time limit
deadline=$((SECONDS + ${HEXA_LIVE_TIMEOUT:-180}))
while [ ! -s "$live/status" ] && kill -0 "$leader" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do
  sleep 0.5
done

# End the hidden desktop: its own process group, and nothing else
group=$(ps -o pgid= -p "$leader" 2>/dev/null | tr -d ' ')
if [ "$leader" -gt 1 ] && [ "$group" = "$leader" ] && [ "$group" != "$(ps -o pgid= -p $$ | tr -d ' ')" ]; then
  kill -TERM -- "-$group" 2>/dev/null
  for _ in 1 2 3 4 5 6; do kill -0 -- "-$group" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$group" 2>/dev/null
elif kill -0 "$leader" 2>/dev/null; then
  echo "hidden desktop: its process group is not its own; ending only $leader" >&2
  kill -TERM "$leader" 2>/dev/null
fi
wait "$leader" 2>/dev/null
rm -rf "$run"

cat "$live/result" 2>/dev/null
[ -s "$live/status" ] && exit "$(cat "$live/status")"
echo "hidden desktop: the command did not finish in time" >&2
exit 124
