# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Which version and build of the code is running, to show on the app's
Settings page, the admin pages and the server's log.

  version  release.json's "version" (server/release.py), e.g. 1.2
  build    how many commits the code has: it only goes up, so a higher build
           is newer code, even between releases
  commit   the commit's short name, to find exactly that code in git

Run from the code (the hosted site is a git clone), git is asked. A built app
has no git: tools/build_exe.py writes build.json into it when it is built.
Worked out once, when the server starts: the site is restarted after git pull.
"""
import json
import subprocess
from functools import cache
from pathlib import Path

from . import paths, release

BUILD = paths.BUNDLE / "build.json"


def _git(*args: str, cwd: Path = paths.CODE) -> str | None:
    try:
        # safe.directory: on the server the clone belongs to another user than the one serving it
        out = subprocess.run(["git", "-c", "safe.directory=*", *args], cwd=cwd, capture_output=True,
                             text=True, timeout=5)
        return out.stdout.strip() or None if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def from_git(cwd: Path = paths.CODE) -> dict:
    count = _git("rev-list", "--count", "HEAD", cwd=cwd)
    return {"build": int(count) if count and count.isdigit() else None,
            "commit": _git("rev-parse", "--short=7", "HEAD", cwd=cwd)}


def load(path: Path = BUILD, cwd: Path = paths.CODE) -> dict:
    """{"version", "build", "commit"}; build and commit are None when nobody can say."""
    try:
        b = json.loads(path.read_text(encoding="utf-8"))
        found = {"build": b.get("build"), "commit": b.get("commit")}
    except (OSError, ValueError, AttributeError):
        found = from_git(cwd)
    return {"version": release.load()["version"], **found}


@cache
def info() -> dict:
    return load()


def label(i: dict | None = None) -> str:
    """1.2 (build 61, a140399)"""
    i = i or info()
    extra = ", ".join(x for x in (i["build"] is not None and f"build {i['build']}", i["commit"]) if x)
    return f"{i['version']} ({extra})" if extra else i["version"]
