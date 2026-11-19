"""Keeping the cameras' computer awake (server/awake.py). Run: python -m tests.test_awake"""
import subprocess
import sys

from server import awake


def main():
    # a system it doesn't know: nothing asked, nothing broken
    awake.keep_awake("plan9")()

    # Linux: a helper holds the computer awake until this program ends, and is stopped when asked
    started = []

    class Helper:
        def __init__(self, command, **_):
            started.append(command)
            self.stopped = False

        def terminate(self):
            self.stopped = True

    real_popen, real_which = subprocess.Popen, awake.shutil.which
    try:
        subprocess.Popen = Helper
        awake.shutil.which = lambda name: "/usr/bin/" + name
        release = awake.keep_awake("linux")
        assert started and started[0][0] == "systemd-inhibit" and "--what=idle:sleep" in started[0]
        release()

        # no systemd-inhibit (some Linux, a Pi's own setup): nothing asked
        started.clear()
        awake.shutil.which = lambda name: None
        awake.keep_awake("linux")()
        assert not started

        # a helper that can't start doesn't stop the server
        awake.shutil.which = lambda name: "/usr/bin/" + name
        subprocess.Popen = lambda *a, **k: (_ for _ in ()).throw(OSError("not allowed"))
        awake.keep_awake("linux")()
    finally:
        subprocess.Popen, awake.shutil.which = real_popen, real_which

    # this computer, for real: asks and lets go without an error
    awake.keep_awake(sys.platform)()
    print("ok")


if __name__ == "__main__":
    main()
