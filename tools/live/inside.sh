#!/bin/bash
# Started by KWin inside the hidden desktop (see hidden-desktop.sh): runs the command on its X
# display and keeps what it printed. It signals nothing: KWin starts it detached, so its parent is
# your session's systemd, and ending the hidden desktop is hidden-desktop.sh's job alone.

unset WAYLAND_DISPLAY # Hexa is an X11 client here, as on a Plasma X11 session
export XDG_SESSION_TYPE=x11
live=$(dirname "$XDG_STATE_HOME")
cd "$(dirname "$0")/../.." || exit 1
bash -c "$HEXA_LIVE_CMD" > "$live/result" 2>&1
echo $? > "$live/status"
