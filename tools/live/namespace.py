"""Sets up the hidden desktop's namespaces, then runs a command in them as you.

Started by hidden-desktop.sh as root of a fresh user namespace that also has its own mount, PID
and network namespaces. It makes /tmp private (a tmpfs: KWin's Xwayland puts its sockets and lock
files there, and must never touch your X server's /tmp/.X11-unix/X0), keeps the results folder
reachable through a bind mount, then steps into a nested user namespace with your own user id
(Electron refuses to run as root) and runs the command. The private network namespace hides your
X server's abstract socket as well, so nothing inside can reach your display.

  namespace.py LIVE_DIR MOUNT_POINT UID GID COMMAND...
"""

import ctypes
import os
import sys

MS_BIND, MS_REC = 4096, 16384
libc = ctypes.CDLL(None, use_errno=True)


def mount(src, dst, fstype, flags, data=None):
    if libc.mount(src.encode(), dst.encode(), fstype.encode() if fstype else None, flags,
                  data.encode() if data else None) != 0:
        sys.exit(f"hidden desktop: mount {dst}: {os.strerror(ctypes.get_errno())}")


live, mount_point, uid, gid = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
mount(live, mount_point, None, MS_BIND | MS_REC)
mount("tmpfs", "/tmp", "tmpfs", 0, "mode=1777")
os.mkdir("/tmp/.X11-unix")
os.chmod("/tmp/.X11-unix", 0o1777)

os.unshare(os.CLONE_NEWUSER)
with open("/proc/self/setgroups", "w") as f:
    f.write("deny")
with open("/proc/self/uid_map", "w") as f:
    f.write(f"{uid} 0 1")
with open("/proc/self/gid_map", "w") as f:
    f.write(f"{gid} 0 1")
os.execvp(sys.argv[5], sys.argv[5:])
