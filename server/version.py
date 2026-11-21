# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""A stamp for the app's files that changes whenever any of them does.

The app compares the stamp it was loaded with against the one the Pi has now,
and reloads itself when they differ (web/update.js).
"""
import hashlib
import mimetypes
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

# Python in the browser (web/vision/pyodide/, see web/vision-worker.js): some
# systems know neither type, and a browser won't run them sent as anything else.
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")

# The vision code a phone runs in its own browser to score with its camera.
# Only these, and only from here: nothing else of the server's is sent.
VISION_FILES = ("board", "calib", "autocalib", "detect", "tracker", "phonevision", "report", "reportsync", "paths")
SERVER = Path(__file__).resolve().parent


def vision_files(app) -> None:
    """Serve /vision/py/<name>.py for the phone's camera (both servers)."""
    @app.get("/vision/py/{name}.py")
    def vision_py(name: str):
        p = SERVER / f"{name}.py"
        if name not in VISION_FILES or not p.is_file():  # a built desktop app keeps no .py files
            raise HTTPException(404)
        return PlainTextResponse(p.read_text(encoding="utf-8"),
                                 headers={"Cache-Control": "no-cache"})


def web_version(folder: Path) -> str:
    """Built from each file's name, size and time of last change: quick enough
    to work out afresh every time it is asked for, so copying new files to the
    Pi is noticed without restarting the server."""
    h = hashlib.sha1()
    for p in sorted(folder.rglob("*")):
        if p.is_file() and not p.name.startswith("."):
            st = p.stat()
            h.update(f"{p.relative_to(folder).as_posix()}:{st.st_size}:{st.st_mtime_ns}\n".encode())
    return h.hexdigest()[:12]


class WebFiles(StaticFiles):
    """The app's files, always checked with the server before a saved copy is used.
    Otherwise a browser can run a new app.js against an old board.js after an update.
    head: put at the end of each page's <head> as it is sent (the hosted site's
    visitor counter); the files themselves are not changed."""

    def __init__(self, *args, head: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self.head = head

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if self.head and isinstance(response, FileResponse) and str(response.path).endswith(".html"):
            page = Path(response.path).read_text(encoding="utf-8")
            response = HTMLResponse(page.replace("</head>", self.head + "</head>", 1), status_code=response.status_code)
        response.headers["Cache-Control"] = "no-cache"
        return response
