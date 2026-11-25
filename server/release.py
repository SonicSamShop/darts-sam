# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Which version of the desktop app this is, and telling its user about a newer one.

The version and what changed in each one are in release.json at the top of the
code. Sam says when there is a new release; the number then goes up there, and
the builds GitHub makes from then on carry it. tools/fetch_apps.py only puts a
build on the site when its number is new, and the site says which version it
has for each kind of computer (GET /api/release on server/host.py).

The built desktop app asks the site once, when it starts (app.py). With a newer
version there, its page offers it (web/screens/release.js): the changes since the one this
is, and Update. Update downloads the file into Downloads and then
  Mac:     opens the .dmg, to drag the app into Applications, and quits this one
  Windows: starts the new .exe and quits this one (both can't have the port)
  Linux:   shows the file, to unpack and run install.sh as the first time

Nothing is sent but the kind of computer. The code run by hand never
ask, unless DARTSSAM_UPDATES=1 is set (to try it out).

A download is only installed if it is genuine: GitHub signs each build when it
makes it (tools/sign_release.py, with a private key kept as a GitHub secret),
and the app checks that signature with the public key built into it
(release-key.pub). A site that was broken into can't hand out anything else.
An app built without the public key (a fork, say) offers no updates.
"""
import base64
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from pathlib import Path

from . import paths

RELEASE = paths.BUNDLE / "release.json"
KEY_FILE = paths.BUNDLE / "release-key.pub"
VERSION = re.compile(r"^\d+(\.\d+)*$")


def load(path: Path = RELEASE) -> dict:
    try:
        r = json.loads(path.read_text(encoding="utf-8"))
        if VERSION.match(str(r.get("version"))):
            return r
    except (OSError, ValueError, AttributeError):
        pass
    return {"version": "0", "notes": {}}


def key(version: str) -> tuple:
    """1.10 comes after 1.9; anything that isn't a version number comes before them all."""
    return tuple(int(p) for p in version.split(".")) if VERSION.match(str(version)) else ()


def app_id(system: str = sys.platform, machine: str = platform.machine()) -> str | None:
    """The name the site gives this kind of computer's download (server/host.py's DOWNLOADS)."""
    if system == "darwin":
        return "mac-arm64" if machine.lower() in ("arm64", "aarch64") else "mac-x86_64"
    if system == "win32":
        return "windows"
    if system.startswith("linux") and machine.lower() in ("x86_64", "amd64"):
        return "linux"
    return None


def since(notes: dict, version: str) -> list[dict]:
    """What changed in each version after `version`, the newest first."""
    later = [v for v in notes if key(v) > key(version)]
    return [{"version": v, "changes": list(notes[v])} for v in sorted(later, key=key, reverse=True)]


def signed_text(app: str, version: str, sha256: str) -> bytes:
    """What a build's signature is of: which app, which version, and its bytes' hash,
    so a genuine file can't be passed off as another app or another version."""
    return f"Darts S.A.M release\n{app}\n{version}\n{sha256}\n".encode()


def public_key(path: Path = KEY_FILE) -> bytes | None:
    """The key builds are checked with (32 bytes), or None if this app has none."""
    try:
        key = base64.b64decode(path.read_text().strip(), validate=True)
        return key if len(key) == 32 else None
    except (OSError, ValueError):
        return None


def genuine(key: bytes, app: str, version: str, sha256: str, signature: str) -> bool:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    try:
        Ed25519PublicKey.from_public_bytes(key).verify(base64.b64decode(signature, validate=True),
                                                       signed_text(app, version, sha256))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def _get(url: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "DartsSAM"}), timeout=15) as r:
        return json.load(r)


def check(site: str, app: str, version: str, get=_get) -> dict | None:
    """What the site has that is newer than `version`, or None."""
    answer = get(f"{site}/api/release?app={urllib.parse.quote(app)}")
    theirs = answer.get("version")
    if not theirs or key(theirs) <= key(version) or not answer.get("url"):
        return None
    if not isinstance(answer.get("sha256"), str) or not isinstance(answer.get("signature"), str):
        return None  # an unsigned build: nothing this app could check, so it isn't offered
    url = urllib.parse.urljoin(site + "/", answer["url"])
    if urllib.parse.urlsplit(url)[:2] != urllib.parse.urlsplit(site)[:2]:
        return None  # only ever downloaded from the site itself
    return {"version": theirs, "changes": since(answer.get("notes") or {}, version), "url": url,
            "file": answer["file"], "size": answer.get("size"), "sha256": answer["sha256"].lower(),
            "signature": answer["signature"]}


def saved_name(file: str, version: str) -> str:
    """DartsSAM.exe -> DartsSAM-1.2.exe: never the name of the program that is running."""
    return file.replace("DartsSAM", f"DartsSAM-{version}", 1)


def downloads_folder() -> Path:
    folder = Path.home() / "Downloads"
    folder.mkdir(exist_ok=True)
    return folder


def _quit_soon():
    """After the page has had its answer."""
    threading.Timer(1.5, lambda: os._exit(0)).start()


def install(path: Path, system: str = sys.platform) -> str:
    """Start installing the downloaded file. Returns what happens next: "quit" or "folder"."""
    if system == "darwin":
        subprocess.Popen(["open", str(path)])
        _quit_soon()
        return "quit"
    if system == "win32":
        os.chmod(path, 0o755)
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        subprocess.Popen([str(path), "--updated"], creationflags=flags, close_fds=True)  # it waits for the port
        _quit_soon()
        return "quit"
    subprocess.Popen(["xdg-open", str(path.parent)])
    return "folder"


class Updater:
    """The state the page asks about (GET /api/update) and the download it starts (POST)."""

    def __init__(self, site, release: dict | None = None, app: str | None = app_id(), get=_get,
                 fetch=urllib.request.urlopen, folder=downloads_folder, install=install, key=None):
        self.site, self.app = site, app
        self.key = key if key is not None else public_key()
        self.release = release or load()
        self.get, self.fetch, self.folder, self.install = get, fetch, folder, install
        self.checked = False
        self.available = None
        self.download = {"state": "idle"}
        self._lock = threading.Lock()

    @property
    def version(self) -> str:
        return self.release["version"]

    def state(self) -> dict:
        site = self.site()
        return {"version": self.version, "checked": self.checked, "available": self.available,
                "download": dict(self.download), "page": site and site + "/download.html"}

    def check(self):
        """Ask the site, once. If it can't be reached, nothing is offered."""
        site = self.site()
        try:
            if site and self.app and self.key:
                self.available = check(site, self.app, self.version, self.get)
        except Exception as e:  # noqa: BLE001  no network, an old site, a strange answer: all the same here
            print("update check:", e)
        self.checked = True

    def start_check(self):
        threading.Thread(target=self.check, daemon=True).start()

    def start_download(self) -> bool:
        with self._lock:
            if not self.available or self.download["state"] in ("downloading", "ready"):
                return False
            self.download = {"state": "downloading", "done": 0, "total": self.available.get("size") or 0}
        threading.Thread(target=self._download, daemon=True).start()
        return True

    def _download(self):
        a = self.available
        part = None
        try:
            to = self.folder() / saved_name(a["file"], a["version"])
            part = to.with_name(to.name + ".part")
            req = urllib.request.Request(a["url"], headers={"User-Agent": "DartsSAM"})
            digest = hashlib.sha256()
            with self.fetch(req, timeout=60) as r, open(part, "wb") as f:
                total = int(r.headers.get("Content-Length") or 0) or self.download["total"]
                self.download["total"] = total
                while chunk := r.read(1 << 18):
                    f.write(chunk)
                    digest.update(chunk)
                    self.download["done"] += len(chunk)
            if total and self.download["done"] != total:
                raise OSError(f"the download stopped part way ({self.download['done']} of {total} bytes)")
            if digest.hexdigest() != a["sha256"] or not genuine(self.key, self.app, a["version"], a["sha256"], a["signature"]):
                raise ValueError("the download could not be checked as genuine, so it was not opened")
            os.replace(part, to)
            self.download = {**self.download, "state": "ready", "path": str(to), "next": self.install(to)}
        except Exception as e:  # noqa: BLE001  said on the page, which offers the download page instead
            print("update download:", e)
            if part:
                part.unlink(missing_ok=True)
            self.download = {"state": "failed", "error": str(e)}
