#!/bin/bash
# PID 1 of the hidden desktop's namespaces (see hidden-desktop.sh): starts KWin with the command,
# waits until the command has written its status (or the time limit), and exits. When it exits,
# the kernel ends every process in the namespace: nothing is ever signalled by PID.

here=$(cd "$(dirname "$0")" && pwd)
live=$1
mkdir -p "$live/config" "$live/data" "$live/cache" "$live/state"
mkdir -m 700 /tmp/run
export XDG_RUNTIME_DIR=/tmp/run XDG_CONFIG_HOME=$live/config XDG_DATA_HOME=$live/data
export XDG_CACHE_HOME=$live/cache XDG_STATE_HOME=$live/state
unset DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS SESSION_MANAGER
export KWIN_COMPOSE=Q # software compositing: no GPU needed

dbus-run-session --config-file="$here/bus.conf" -- \
  kwin_wayland --virtual --xwayland --width 2560 --height 1440 --socket hexa-live --no-lockscreen \
  -- "$here/inside.sh" > "$live/kwin.log" 2>&1 &

deadline=$((SECONDS + ${HEXA_LIVE_TIMEOUT:-180}))
while [ ! -s "$live/status" ] && [ "$SECONDS" -lt "$deadline" ]; do
  sleep 0.5
done
