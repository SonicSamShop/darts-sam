# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Fetch the newest Mac, Windows and Linux apps that GitHub built into the folder the
site gives them out from (docs/hosting.md, "The apps to download").

  python tools/fetch_apps.py [--to downloads] [--token-file /etc/dartssam/github-token]

Run on the server every few minutes. Each run asks GitHub for the newest build
of each app from the main branch, and fetches the ones whose version is newer
than what the folder has. GitHub builds only when the version goes up, which
is a release (release.json, server/release.py), or when a build is started by
hand: that one has an old version, so it never reaches anyone. The version is in each build's name
(DartsSAM-windows-1.2), so a build that is not new costs no download. Each
fetched app's version and notes go in releases.json in the folder, which the
site reads to tell the desktop apps about a newer one. Needs nothing but Python.

GitHub only hands out what its Actions built to someone with a token, even for
a public repository: a fine-grained one that may only read this repository's
Actions is enough. It is read from the token file, or
from GITHUB_TOKEN when trying this on a laptop.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "SonicSamShop/darts-sam"
# what .github/workflows calls each build (followed by -<version>), and the file inside it (server/host.py's DOWNLOADS)
APPS = {"DartsSAM-mac-arm64": "DartsSAM-arm64.dmg", "DartsSAM-mac-x86_64": "DartsSAM-x86_64.dmg",
        "DartsSAM-windows": "DartsSAM.exe", "DartsSAM-linux": "DartsSAM-linux-x86_64.tar.gz"}
SEEN = ".fetched.json"  # in the folder: which build of each app is there
RELEASES = "releases.json"  # in the folder: each file's version and notes (server/host.py's /api/release)
VERSION = re.compile(r"^\d+(\.\d+)*$")


def key(version) -> tuple:
    return tuple(int(p) for p in version.split(".")) if VERSION.match(str(version or "")) else ()


class _Stay(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # GitHub answers a download with "it is over there": followed by hand, below


def _ask(url, token):
    return urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "fetch-apps"})


def latest(token, repo=REPO, branch="main"):
    """The newest build of each app from the branch that GitHub still keeps, with its
    version: {name: artifact}. Every push builds every app, so the newest of each is
    on the first page."""
    with urllib.request.urlopen(_ask(f"https://api.github.com/repos/{repo}/actions/artifacts?per_page=100",
                                     token), timeout=30) as r:
        found = json.load(r)["artifacts"]
    newest = {}
    for a in found:
        # pull requests build the apps too: only what was built from the branch is given out
        if a["expired"] or (a.get("workflow_run") or {}).get("head_branch") != branch:
            continue
        for name in APPS:
            version = a["name"][len(name) + 1:] if a["name"].startswith(name + "-") else ""
            if VERSION.match(version) and (name not in newest or a["created_at"] > newest[name]["created_at"]):
                newest[name] = {**a, "version": version}
    return newest


def download(artifact, token, to: Path):
    """The build's .zip, written to `to`."""
    try:
        r = urllib.request.build_opener(_Stay).open(_ask(artifact["archive_download_url"], token), timeout=30)
    except urllib.error.HTTPError as e:
        if e.code not in (301, 302, 303, 307) or not e.headers.get("Location"):
            raise
        # the file is kept somewhere else, which refuses a request that carries GitHub's token
        r = urllib.request.urlopen(e.headers["Location"], timeout=60)
    with r, open(to, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)


def _read(path: Path) -> dict:
    try:
        found = json.loads(path.read_text())
        return found if isinstance(found, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path: Path, value: dict):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, indent=1))
    os.replace(tmp, path)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def fetch(folder: Path, token, latest=latest, download=download):
    """Bring the folder up to date. Returns (what was done, what went wrong), as lines to print."""
    folder.mkdir(parents=True, exist_ok=True)
    seen = _read(folder / SEEN)          # {build name: {"id", "version"}}
    releases = _read(folder / RELEASES)  # {file: {"version", "notes"}}
    did, wrong = [], []
    try:
        builds = latest(token)
    except (OSError, ValueError, KeyError) as e:
        return did, [f"couldn't ask GitHub for the builds: {e}"]
    for name, file in APPS.items():
        tmp = None
        try:
            a = builds.get(name)
            if a is None:
                wrong.append(f"{file}: GitHub has no build of {name} with a version from main (it keeps them 14 days)")
                continue
            had = seen.get(name) if isinstance(seen.get(name), dict) else {}
            if (folder / file).is_file() and key(had.get("version")) >= key(a["version"]):
                continue  # not a new release: the builds in between are not given out
            # next to where it is going, so that the last step is a rename: someone
            # downloading meanwhile gets the whole old file or the whole new one
            tmp = Path(tempfile.mkdtemp(prefix=".fetch-", dir=folder))
            download(a, token, tmp / "build.zip")
            with zipfile.ZipFile(tmp / "build.zip") as z:
                def inside(want):
                    return next((m for m in z.namelist() if m.rsplit("/", 1)[-1] == want), None)
                if not inside(file):
                    raise ValueError(f"no {file} in the build, only {z.namelist()}")
                if not inside("release.json"):
                    raise ValueError("no release.json in the build")
                notes = json.loads(z.read(inside("release.json"))).get("notes") or {}
                with z.open(inside(file)) as src, open(tmp / file, "wb") as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
                # its signature (tools/sign_release.py), passed on for the apps to check
                signed = {}
                if inside(file + ".sig"):
                    sig = json.loads(z.read(inside(file + ".sig")))
                    if sig.get("version") != a["version"] or sig.get("sha256") != _sha256(tmp / file):
                        raise ValueError(f"{file}.sig is not for this build")
                    signed = {"sha256": sig["sha256"], "signature": sig["signature"]}
            built = datetime.fromisoformat(a["created_at"].replace("Z", "+00:00")).timestamp()
            os.utime(tmp / file, (built, built))  # the page shows this date: when it was built, not fetched
            os.chmod(tmp / file, 0o644)
            os.replace(tmp / file, folder / file)
            seen[name] = {"id": a["id"], "version": a["version"]}
            _write(folder / SEEN, seen)
            releases[file] = {"version": a["version"], "notes": notes, **signed}
            _write(folder / RELEASES, releases)
            did.append(f"{file}: fetched version {a['version']}, built {a['created_at']} "
                       f"({(folder / file).stat().st_size // 1_000_000} MB)")
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as e:  # one app failing does not stop the others
            wrong.append(f"{file}: {e}")
        finally:
            if tmp:
                shutil.rmtree(tmp, ignore_errors=True)
    return did, wrong


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--to", default=str(ROOT / "downloads"), help="the folder the site gives the apps out from")
    ap.add_argument("--token-file", default="/etc/dartssam/github-token", help="a file holding the GitHub token")
    args = ap.parse_args()
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        try:
            token = Path(args.token_file).read_text().strip()
        except OSError as e:
            sys.exit(f"Can't read the GitHub token from {args.token_file}: {e}")
    if not token:
        sys.exit(f"{args.token_file} is empty: paste the GitHub token into it.")
    did, wrong = fetch(Path(args.to), token)
    for line in did:
        print(line)
    for line in wrong:
        print(line, file=sys.stderr)
    sys.exit(1 if wrong else 0)


if __name__ == "__main__":
    main()
