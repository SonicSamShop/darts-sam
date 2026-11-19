# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Sending problem reports from a paired server at home up to the hosted site.

A report is a folder of pictures and one report.json (see report.py). When the
server is paired with an account (link.py) each new report is sent to the site
so whoever runs the trial can see what the cameras saw.

A small marker file in the report's folder says what is still to be sent:
  wait     a new report: send everything, but give the person two minutes to
           type what really happened first, so one upload carries it all
  now      they have typed it: send everything now
  note     everything was sent before the note was saved: send report.json again
  refused  the site said it is too big: never try again
No marker: nothing to send (already sent, or made while not paired).

This file needs no OpenCV: the site uses unpack() and meta() too.
"""
import io
import json
import re
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

MARKER = "upload"
WAIT = 120  # seconds a new report waits for its note
SAFE_FILE = re.compile(r"^[\w-]+\.(png|jpg|json)$")  # as report.py: the only files a report has
MOST = 60 * 2**20  # bytes in one report


def mark(folder: Path, how: str):
    (folder / MARKER).write_text(how)


def clear(folder: Path):
    (folder / MARKER).unlink(missing_ok=True)


def noted(folder: Path):
    """The person saved what really happened."""
    marker = folder / MARKER
    if marker.exists():
        if marker.read_text() != "refused":
            mark(folder, "now")
    else:
        mark(folder, "note")


def due(root: Path, now: float) -> list[tuple[str, str]]:
    """Reports to send now: (id, "all" or "note"), oldest first."""
    out = []
    for marker in sorted(root.glob(f"*/{MARKER}")) if root.is_dir() else []:
        how = marker.read_text()
        if how == "now" or (how == "wait" and now - marker.stat().st_mtime > WAIT):
            out.append((marker.parent.name, "all"))
        elif how == "note":
            out.append((marker.parent.name, "note"))
    return out


def pack(folder: Path, what: str) -> bytes:
    """The report as a zip: all of it, or (what == "note") just report.json."""
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_STORED) as z:  # pictures don't squash further
        for p in sorted(folder.iterdir()):
            if p.is_file() and SAFE_FILE.match(p.name) and (what == "all" or p.name == "report.json"):
                z.write(p, p.name)
    return data.getvalue()


def unpack(data: bytes, dest: Path, most: int = MOST) -> int:
    """Write a packed report into dest, over what is there. Only a report's own
    kinds of file, by plain name, are written; anything else in the zip is
    skipped. Returns the bytes written. ValueError: not a zip, or more than `most`."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("not a report")
    wanted = [i for i in z.infolist() if SAFE_FILE.match(i.filename)]  # a name with a folder in it does not match
    if sum(i.file_size for i in wanted) > most:
        raise ValueError("too big")
    dest.mkdir(parents=True, exist_ok=True)
    written = 0
    for info in wanted:
        with z.open(info) as src:
            content = src.read(most - written + 1)
        written += len(content)
        if written > most:
            raise ValueError("too big")  # the sizes it declared were not true
        (dest / info.filename).write_bytes(content)
    return written


def folder_size(folder: Path) -> int:
    return sum(p.stat().st_size for p in folder.iterdir() if p.is_file() and SAFE_FILE.match(p.name))


def meta(folder: Path) -> dict:
    """What the index shows of a report: what the person said, and its latest line."""
    try:
        r = json.loads((folder / "report.json").read_text())
        looks = r.get("looks") or []
        summary = (looks[-1] if looks else r.get("now") or {}).get("summary", "")
        return {"expected": str(r.get("expected") or ""), "note": str(r.get("note") or ""), "summary": str(summary)}
    except (OSError, ValueError, AttributeError, TypeError):
        return {"expected": "", "note": "", "summary": ""}


def _post(url: str, token: str, body: bytes) -> int:
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/zip"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


class Uploader:
    """Sends due reports from `root` to the site, now and then, in the background."""

    def __init__(self, root: Path, host: str, token: str, post=_post):
        self.root, self.host, self.token, self.post = root, host.rstrip("/"), token, post
        self._stop = threading.Event()

    def once(self):
        for rid, what in due(self.root, time.time()):
            folder = self.root / rid
            try:
                status = self.post(f"{self.host}/api/helper/reports/{rid}", self.token, pack(folder, what))
            except OSError:
                continue  # offline: next time
            if status == 200:
                clear(folder)
            elif status == 413:
                mark(folder, "refused")  # too big, or the account's room is full

    def start(self):
        def run():
            while not self._stop.wait(15):
                try:
                    self.once()
                except Exception as e:  # never let one bad folder end the uploads
                    print("report upload:", e)
        threading.Thread(target=run, daemon=True).start()

    def stop(self):
        self._stop.set()
