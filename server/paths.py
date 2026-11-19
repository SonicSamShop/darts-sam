# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Where the server's files are.

Run from the code (`python -m server.app`), everything is in the code's own
folder, as it always was. Built into one program (tools/build_exe.py), the
app's files are unpacked somewhere temporary each time it starts, so what must
be kept (config.json, data/) goes in the user's own folder instead:
%LOCALAPPDATA%\\DartsSAM on Windows.
"""
import os
import sys
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)  # set by PyInstaller


def _kept() -> Path:
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "DartsSAM"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "DartsSAM"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "dartssam"


CODE = Path(__file__).resolve().parent.parent
BUNDLE = Path(getattr(sys, "_MEIPASS", CODE))  # holds web/
HOME = _kept() if FROZEN else CODE             # holds config.json and data/
if FROZEN:
    HOME.mkdir(parents=True, exist_ok=True)
