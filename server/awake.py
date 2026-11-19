"""Keep the computer the cameras are plugged into awake while it watches them.

Left alone, a computer turns its screen off after a few minutes and soon after
goes to sleep, and the cameras stop counting darts. A Mac also slows down
("App Nap") an app whose window can't be seen, which a screen that is off
counts as. So while the cameras are on, ask the system not to sleep. The
screen may still turn off: only the computer itself is kept awake.

keep_awake() asks, and returns what to call to stop asking. The request also
ends with this program. Where the system can't be asked it does nothing.
"""
import os
import shutil
import subprocess
import sys

WHY = "Darts S.A.M is watching the cameras for darts"


def keep_awake(platform: str = sys.platform):
    try:
        if platform == "win32":
            return _windows()
        if platform == "darwin":
            return _mac()
        if platform.startswith("linux"):
            return _linux()
    except Exception as e:  # never stop the server over this
        print(f"Could not keep the computer awake: {e}")
    return lambda: None


def _windows():
    # Held by this thread until it ends or it is cleared: the server's thread here.
    import ctypes
    ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
    set_state = ctypes.windll.kernel32.SetThreadExecutionState
    set_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    return lambda: set_state(ES_CONTINUOUS)


def _mac():
    try:
        # The built app: tell macOS the work is the user's, which keeps the
        # computer awake and stops App Nap slowing it down. The screen may sleep.
        from Foundation import NSProcessInfo
        NSActivityUserInitiated = 0x00FFFFFF | (1 << 20)
        info = NSProcessInfo.processInfo()
        token = info.beginActivityWithOptions_reason_(NSActivityUserInitiated, WHY)
        return lambda: info.endActivity_(token)
    except ImportError:
        # Run from a terminal, which App Nap leaves alone: only sleep to stop.
        return _until_we_stop(["caffeinate", "-i", "-w", str(os.getpid())])


def _linux():
    if not shutil.which("systemd-inhibit"):
        return lambda: None
    # A service on a Pi may not be allowed to ask; a Pi doesn't sleep anyway.
    return _until_we_stop(["systemd-inhibit", "--what=idle:sleep", "--who=Darts S.A.M", f"--why={WHY}",
                           "--mode=block", "tail", f"--pid={os.getpid()}", "-f", "/dev/null"])


def _until_we_stop(command):
    """Run a helper that holds the computer awake until this program ends."""
    helper = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return helper.terminate
