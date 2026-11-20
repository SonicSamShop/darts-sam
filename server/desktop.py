# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Darts S.A.M as a program you double-click: what the Windows .exe and the Mac
app run (built by tools/build_exe.py).

The same server as `python -m server.app`, with the same options, plus what
someone with no terminal needs: its page opens in the browser by itself, a
second double-click opens that page again instead of failing, and an error
stays on screen instead of vanishing with the window.

  --no-browser    don't open the page
  --updated       started by the version before it, which is closing (release.py):
                  wait for it to let go of the port

The built program is a window of its own, with its icon in the Dock or on the
taskbar: the page is shown in it rather than in the browser, and closing the
window stops Darts S.A.M. What a terminal window would have said is written to
DartsSAM.log in its data folder. With --no-browser there is no window, only
the server. Run from the code it is as it was: a terminal and the browser.
"""
import json
import os
import sys
import threading
import time
import urllib.request
import webbrowser


def _port(argv) -> int:
    """The port the server is about to use (app.py reads the options properly)."""
    for i, a in enumerate(argv):
        if a == "--port" and i + 1 < len(argv):
            return int(argv[i + 1])
        if a.startswith("--port="):
            return int(a.split("=", 1)[1])
    return 8000


def _running(address: str) -> bool:
    """Is a Darts S.A.M server already answering here?"""
    try:
        with urllib.request.urlopen(address + "/version.json", timeout=1) as r:
            return "version" in json.loads(r.read())
    except Exception:
        return False


def _open_when_up(address: str):
    for _ in range(120):  # the first start unpacks the program, which can take a while
        if _running(address):
            webbrowser.open(address + "/#/start")
            return
        time.sleep(0.5)


def _pause():
    if sys.stdin and sys.stdin.isatty():
        input("\nPress Enter to close this window.")


# (the colours are those of the app's usual look, so the window does not change colour as the app arrives)
_PAGE = """<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#2b1b11;color:#efeadb;font:17px -apple-system,sans-serif;text-align:center">
<div style="max-width:30em;padding:2em">%s</div>"""


def _to_front() -> bool:
    """Windows: bring the window of the Darts S.A.M already running to the front."""
    import ctypes
    user32 = ctypes.windll.user32
    window = user32.FindWindowW(None, "Darts S.A.M")
    if not window:
        return False
    if user32.IsIconic(window):
        user32.ShowWindow(window, 9)  # SW_RESTORE: it was minimised
    user32.SetForegroundWindow(window)
    return True


def _window_app(address: str, browser: bool):
    """The built Mac or Windows app: the server on a thread, its window on the main one."""
    import html
    import subprocess
    import traceback
    from . import paths

    sys.stdout = sys.stderr = open(paths.HOME / "DartsSAM.log", "w", buffering=1)
    print(f"Darts S.A.M is starting. Its page is {address}\n")
    stopped = threading.Event()   # the server has given up
    may_start = threading.Event()  # macOS has had its answer about the cameras

    def serve():
        may_start.wait()
        try:
            from . import app
            app.main()
        except BaseException:  # SystemExit too: the port is taken, or an option is wrong
            traceback.print_exc()
        stopped.set()

    # On a Mac OpenCV can only ask for the cameras from the main thread, which
    # the window needs, so ask here and tell it not to. The server waits for the answer.
    os.environ["OPENCV_AVFOUNDATION_SKIP_AUTH"] = "1"
    if sys.platform != "darwin" or "--no-cameras" in sys.argv:
        may_start.set()
    else:
        try:
            import AVFoundation
            AVFoundation.AVCaptureDevice.requestAccessForMediaType_completionHandler_(
                AVFoundation.AVMediaTypeVideo, lambda allowed: may_start.set())
        except Exception:
            traceback.print_exc()
            may_start.set()
    threading.Thread(target=serve, daemon=True).start()
    if not browser:
        stopped.wait()
        return

    import webview
    from webview.menu import Menu, MenuAction

    window = webview.create_window(
        "Darts S.A.M", html=_PAGE % "Darts S.A.M is starting…",
        width=1200, height=820, min_size=(360, 520), background_color="#2b1b11", text_select=True)

    def show():
        """The page once the server answers, or why there is none."""
        while not stopped.is_set():
            if _running(address):
                return window.load_url(address + "/#/start")
            time.sleep(0.3)
        window.load_html(_PAGE % (
            "<h2>Darts S.A.M could not start</h2>"
            f"<p>Is something else using port {_port(sys.argv)}? Close this window and try again.</p>"
            f"<p style='color:#8d9aa8'>The details are in DartsSAM.log in<br>{html.escape(str(paths.HOME))}</p>"))

    # Closing the window ends the program, and the server with it. The page
    # keeps its settings in the window's own storage, so that must be kept too.
    def data_folder():
        if sys.platform == "win32":
            os.startfile(paths.HOME)
        else:
            subprocess.run(["open", str(paths.HOME)])

    # A Mac keeps the window's storage by the app's name; Windows has to be told where.
    storage = {"storage_path": str(paths.HOME / "window")} if sys.platform == "win32" else {}
    webview.start(show, private_mode=False, **storage,
                  menu=[Menu("Data", [MenuAction("Show Data Folder", data_folder)])])


def main():
    browser = "--no-browser" not in sys.argv
    updated = "--updated" in sys.argv
    sys.argv = [a for a in sys.argv if a not in ("--no-browser", "--updated")]
    # Started with --cert the server answers at https only: its page is then opened by hand.
    address = f"http://127.0.0.1:{_port(sys.argv)}"
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.kernel32.SetConsoleTitleW("Darts S.A.M")

    from . import paths
    if paths.FROZEN:
        # The built program's own https looks for the trusted certificate list
        # where the machine that built it kept one, which no one else's computer
        # has: without this it cannot reach the hosted site. So it carries a list.
        import certifi
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        if sys.platform.startswith("linux"):
            # The built program points LD_LIBRARY_PATH at its own libraries, which
            # breaks the browser it opens: give that the user's own setting back.
            if "LD_LIBRARY_PATH_ORIG" in os.environ:
                os.environ["LD_LIBRARY_PATH"] = os.environ["LD_LIBRARY_PATH_ORIG"]
            else:
                os.environ.pop("LD_LIBRARY_PATH", None)
    windowed = paths.FROZEN and sys.platform in ("darwin", "win32")
    if updated:
        for _ in range(40):  # the old version quits a moment after starting this one
            if not _running(address):
                break
            time.sleep(0.5)
    if _running(address):
        print("Darts S.A.M is already running.")
        # A Mac brings a running app's window forward by itself.
        if browser and not (windowed and sys.platform == "win32" and _to_front()):
            webbrowser.open(address + "/#/start")
        return

    if windowed:
        return _window_app(address, browser)

    print("Darts S.A.M is starting. Leave this window open while you play; close it to stop.")
    print(f"Its page is {address}  (Cameras, to line them up and to connect to your account)\n")
    if browser:
        threading.Thread(target=_open_when_up, args=(address,), daemon=True).start()
    try:
        from . import app
        app.main()
    except SystemExit as e:  # the server gave up, for example the port is taken
        if e.code:
            print(f"\nDarts S.A.M could not start (see above). Is something else using port {_port(sys.argv)}?")
            _pause()
        raise
    except Exception:
        import traceback
        traceback.print_exc()
        print("\nDarts S.A.M stopped because of the error above.")
        _pause()
        sys.exit(1)


if __name__ == "__main__":
    main()
