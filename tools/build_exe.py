"""Build Darts S.A.M into one program that needs no Python:

  Windows   dist/DartsSAM.exe, one file to double-click (its window needs
            Microsoft's WebView2, which Windows 11 has and Windows 10 nearly always has)
  Mac       dist/DartsSAM.app, and dist/DartsSAM-<chip>.dmg to give to people:
            they open it and drag the app to Applications
  Linux     dist/DartsSAM, and dist/DartsSAM-linux-x86_64.tar.gz to give to
            people: they unpack it and run install.sh (tools/linux/install.sh),
            which puts it in their app menu

  pip install -r requirements.txt -r requirements-windows.txt pyinstaller   (Windows)
  pip install -r requirements.txt -r requirements-mac.txt pyinstaller   (Mac)
  pip install -r requirements.txt pyinstaller   (Linux)
  python tools/build_exe.py

PyInstaller builds only for the system it runs on, and on a Mac only for that
Mac's chip (Apple silicon or Intel). .github/workflows builds each on GitHub's
machines.

Signing the Mac app. Unsigned (the default), a Mac that downloaded the app
refuses to open it until its owner allows it in System Settings. With an Apple
Developer ID certificate in the keychain, name it and the app and the .dmg are
signed with it, ready to be notarised:

  MAC_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" python tools/build_exe.py
  xcrun notarytool submit dist/DartsSAM-arm64.dmg --keychain-profile NAME --wait
  xcrun stapler staple dist/DartsSAM-arm64.dmg
"""
import json
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
MAC = sys.platform == "darwin"
IDENTITY = os.environ.get("MAC_SIGN_IDENTITY")  # none: signed "ad hoc", which only lets it run
ENTITLEMENTS = ROOT / "tools" / "mac-entitlements.plist"


def run(*cmd):
    subprocess.run([str(c) for c in cmd], check=True)


def mac_icon() -> Path:
    """web/icon-512.png as the .icns file a Mac app wants."""
    work = ROOT / "build" / "DartsSAM.iconset"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    for size in (16, 32, 128, 256, 512):
        run("sips", "-z", size, size, ROOT / "web" / "icon-512.png", "--out", work / f"icon_{size}x{size}.png")
        if size > 16:
            shutil.copy(work / f"icon_{size}x{size}.png", work / f"icon_{size // 2}x{size // 2}@2x.png")
    icns = ROOT / "build" / "DartsSAM.icns"
    run("iconutil", "-c", "icns", work, "-o", icns)
    return icns


def mac_finish(dist: Path):
    """What PyInstaller's options can't say about the app, then the .dmg."""
    app = dist / "DartsSAM.app"
    plist = app / "Contents" / "Info.plist"
    info = plistlib.loads(plist.read_bytes())
    info.update({
        "CFBundleDisplayName": "Darts S.A.M",
        # Its window shows the server's page, which is plain http on this Mac.
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
        # Without these macOS stops the app instead of asking.
        "NSCameraUsageDescription": "Darts S.A.M watches the dartboard through your cameras to score each dart.",
        "NSLocalNetworkUsageDescription": "Darts S.A.M uses cameras on your network, such as a phone, if you add one.",
    })
    plist.write_bytes(plistlib.dumps(info))
    # Changing the file broke the app's seal: sign it again.
    sign = ["codesign", "--force", "--entitlements", ENTITLEMENTS, "--sign", IDENTITY or "-"]
    if IDENTITY:
        sign += ["--options", "runtime", "--timestamp"]
    run(*sign, app)

    stage = ROOT / "build" / "dmg"
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    run("ditto", app, stage / "DartsSAM.app")
    os.symlink("/Applications", stage / "Applications")
    dmg = dist / f"DartsSAM-{platform.machine()}.dmg"
    # On GitHub's Macs hdiutil now and then fails with "Resource busy" (something
    # else briefly holds the image); it works when tried again.
    for attempt in range(5):
        try:
            run("hdiutil", "create", "-volname", "Darts S.A.M", "-srcfolder", stage, "-ov", "-format", "UDZO", dmg)
            break
        except subprocess.CalledProcessError:
            if attempt == 4:
                raise
            print(f"hdiutil failed, trying again ({attempt + 2} of 5)")
            time.sleep(5 * (attempt + 1))
    if IDENTITY:
        run("codesign", "--force", "--timestamp", "--sign", IDENTITY, dmg)
    print(f"\nBuilt {app}\n  and {dmg}")


def linux_finish(dist: Path):
    """The program, its icon and install.sh in one .tar.gz, in a folder of their own."""
    tgz = dist / f"DartsSAM-linux-{platform.machine()}.tar.gz"
    files = {"DartsSAM": dist / "DartsSAM", "install.sh": ROOT / "tools" / "linux" / "install.sh",
             "dartssam.png": ROOT / "web" / "icon-512.png"}

    def mode(name):
        def set_mode(info):
            info.mode = 0o755 if name != "dartssam.png" else 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            return info
        return set_mode

    with tarfile.open(tgz, "w:gz") as t:
        for name, src in files.items():
            t.add(src, arcname=f"DartsSAM/{name}", filter=mode(name))
    print(f"\nBuilt {dist / 'DartsSAM'}\n  and {tgz}")


# Which build this is (server/build.py): a built app has no git to ask.
sys.path.insert(0, str(ROOT))
from server.build import from_git  # noqa: E402
(ROOT / "build").mkdir(exist_ok=True)
(ROOT / "build" / "build.json").write_text(json.dumps(from_git(ROOT)))
print("build:", (ROOT / "build" / "build.json").read_text())

options = [
    str(ROOT / "tools" / "exe_entry.py"),
    "--name", "DartsSAM",
    "--noconfirm", "--clean",
    "--paths", str(ROOT),
    "--add-data", f"{ROOT / 'web'}{os.pathsep}web",
    "--add-data", f"{ROOT / 'release.json'}{os.pathsep}.",  # which version this is (server/release.py)
    "--add-data", f"{ROOT / 'build' / 'build.json'}{os.pathsep}.",  # and which build (server/build.py)
    # uvicorn picks its event loop, protocols and logging by name at run time
    "--collect-submodules", "uvicorn",
    "--collect-submodules", "websockets",
]
if (ROOT / "release-key.pub").is_file():  # what updates are checked with (server/release.py)
    options += ["--add-data", f"{ROOT / 'release-key.pub'}{os.pathsep}."]
else:
    print("No release-key.pub: this build will not offer updates (tools/sign_release.py new-key makes one).")
if MAC:
    options += [
        "--windowed", "--onedir",  # an .app; one file would unpack itself at every start
        "--icon", str(mac_icon()),
        "--osx-bundle-identifier", "uk.co.dartssam.desktop",
        "--osx-entitlements-file", str(ENTITLEMENTS),
    ]
    if IDENTITY:
        options += ["--codesign-identity", IDENTITY]
elif sys.platform == "win32":
    options += [
        "--onefile",
        "--windowed",  # its own window, and no terminal behind it
        "--icon", str(ROOT / "web" / "icon-512.png"),  # PyInstaller makes the .ico (it needs Pillow)
    ]
else:
    options += [
        "--onefile",
        "--console",  # the window says it is running, and closing it stops it
    ]
options += sys.argv[1:]  # any more PyInstaller options, such as --distpath

PyInstaller.__main__.run(options)

dist = (Path(sys.argv[sys.argv.index("--distpath") + 1]) if "--distpath" in sys.argv else ROOT / "dist").resolve()
# Kept with the app GitHub builds: tools/fetch_apps.py reads the notes from it.
shutil.copy(ROOT / "release.json", dist / "release.json")
if MAC:
    mac_finish(dist)
elif sys.platform.startswith("linux"):
    linux_finish(dist)
