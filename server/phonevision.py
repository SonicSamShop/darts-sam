# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The vision calls a phone makes when it scores with its own camera.

A phone's browser runs this file, and the rest of the vision code, in Python
inside the page (Pyodide, see web/vision-worker.js). Pictures come as the RGBA
bytes a canvas gives; answers go back as plain dicts and lists, ready to post
to the page. Nothing here touches a camera, a file or the network, so it is
tested on drawn pictures like the rest (python -m tests.test_phonevision).

One phone is one camera.
"""
import base64

import cv2
import numpy as np

from . import autocalib, board, calib, tracker

CAMERA = 0  # its number, as the cameras' computer numbers them: reports say "Camera 1" (report.py)
MOVED_PX = 3.0   # rings' edges further than this from where the calibration puts them: the phone moved
MIN_EDGES = 40   # of up to 320 ring edges; fewer found and the board isn't where it was

REPORTS = "/tmp/reports"  # in the browser's own file system; packed and sent, then gone

_tracker: tracker.Tracker | None = None
_calibration: dict | None = None
_last: np.ndarray | None = None  # the newest picture, for a report's "now"


def _picture(rgba, w: int, h: int) -> np.ndarray:
    if hasattr(rgba, "to_py"):  # a JavaScript array, as Pyodide hands it over
        rgba = rgba.to_py()
    return cv2.cvtColor(np.frombuffer(rgba, np.uint8).reshape(h, w, 4), cv2.COLOR_RGBA2BGR)


def calibrate(rgba, w: int, h: int, twenty=None) -> dict:
    """Find the board in a picture of it, empty. `twenty` is any pixel in the
    20. Answers {"ok": True, "calibration": ...} with the calibration as
    config.json keeps a camera's, or {"ok": False, "reason": ...} for the player."""
    img = _picture(rgba, w, h)
    try:
        found = autocalib.detect(img, None if twenty is None else tuple(twenty))
    except autocalib.Failed as e:
        return {"ok": False, "reason": str(e)}
    # The picture goes with it (small, grey): later pictures are lined up
    # with this one, so a phone a few px from where it was still scores right.
    ok, jpg = cv2.imencode(".jpg", tracker.small_grey(img), [cv2.IMWRITE_JPEG_QUALITY, 80])
    return {"ok": True, "calibration": {**found.saved(), **({"anchor": base64.b64encode(jpg.tobytes()).decode()} if ok else {})}}


def _anchor(calibration: dict):
    """The picture a calibration was made from, as calibrate() packed it; None
    for one saved before pictures were kept, or that can't be read."""
    try:
        return cv2.imdecode(np.frombuffer(base64.b64decode(calibration["anchor"]), np.uint8), cv2.IMREAD_GRAYSCALE)
    except (KeyError, TypeError, ValueError, cv2.error):
        return None


def start(calibration: dict) -> None:
    """Start watching with this calibration. The next picture is taken as the
    empty board."""
    global _tracker, _calibration
    anchor = _anchor(calibration)
    _tracker = tracker.Tracker({CAMERA: calib.view(calibration)}, steady=True,
                               anchors={} if anchor is None else {CAMERA: anchor})
    _calibration = {k: v for k, v in calibration.items() if k != "anchor"}  # as reports carry it


def stop() -> None:
    global _tracker
    _tracker = None


def restart() -> None:
    """Forget what the board looked like (the page was hidden and the camera
    stopped): the next picture is the empty board again."""
    if _tracker is not None:
        _tracker.reset()


def feed(rgba, w: int, h: int) -> list[dict]:
    """One picture from the camera: what happened, as /ws would say it."""
    global _last
    if _tracker is None:
        return []
    _last = _picture(rgba, w, h)
    events = _tracker.update({CAMERA: _last})
    if not events and _tracker.stable >= tracker.STABLE_FRAMES:
        # Nothing to say, but the picture has settled: the page counts on
        # hearing this, to tell a picture that never settles (autofocus
        # hunting, a flickering light) from a quiet board.
        return [{"type": "still"}]
    return events


def darts_in() -> int:
    """How many darts the tracker thinks are in the board. The page goes by
    this rather than counting events: the tracker can start again by itself
    (someone stood in front of it for a while) without saying so."""
    return _tracker.darts if _tracker is not None else 0


def still_matches(rgba, w: int, h: int, calibration: dict) -> bool:
    """Is the board still where the calibration says? The coloured rings'
    edges are looked for near where they should be; a knocked phone finds
    them somewhere else, or not at all. While watching with the calibration's
    own picture, the question is whether this one can be laid over it: a
    stand shaken a few px by the darts has not moved."""
    view = calib.view(calibration)
    img = _picture(rgba, w, h)
    if _tracker is not None and CAMERA in _tracker.given:
        return _tracker._warp(CAMERA, img) is not None
    if view.lens:
        img = cv2.remap(img, *calib.straighten_maps(view.lens, (w, h)), cv2.INTER_LINEAR)
    px, mm = autocalib._band_edges(autocalib._lab_a(img), view.H)
    if len(px) < MIN_EDGES:
        return False
    expected = autocalib._apply(np.linalg.inv(view.H), mm)
    return float(np.sqrt(np.mean(np.sum((expected - px) ** 2, axis=1)))) < MOVED_PX


def outline(calibration: dict) -> list[list[list[float]]]:
    """Where the board's rings and wires are in the picture (px), to draw over
    it so the player can see the board was found right: six rings (bull out to
    the outer double wire), then the twenty wires between the numbers."""
    view = calib.view(calibration)
    rings = [[board.polar(a, r) for a in range(0, 361, 3)]
             for r in (board.R_BULL, board.R_OUTER_BULL, board.R_TRIPLE_IN, board.R_TRIPLE_OUT,
                       board.R_DOUBLE_IN, board.R_DOUBLE_OUT)]
    wires = [[board.polar(9 + 18 * i, r) for r in np.linspace(board.R_OUTER_BULL, board.R_DOUBLE_OUT, 12)]
             for i in range(20)]
    return [np.round(view.to_picture(line), 1).tolist() for line in rings + wires]


def report(app: dict, expected: str = "", note: str = "") -> dict:
    """A problem report of what the camera saw (report.py's folder), packed as
    the site takes them (reportsync.py): {"id", "zip"}. Made only when the
    player taps Report; the page sends it to their account."""
    from pathlib import Path
    from . import report as reports, reportsync
    if _tracker is None or _last is None:
        raise ValueError("The phone camera isn't watching the board.")
    root = Path(REPORTS)
    made = reports.save(reports.snapshot(_tracker, _tracker.line_up({CAMERA: _last})), {str(CAMERA): _calibration},
                        app=app, root=root)
    if expected or note:
        reports.annotate_report(made["id"], expected, note, root=root)
    folder = root / made["id"]
    packed = reportsync.pack(folder, "all")
    for p in folder.iterdir():
        p.unlink()
    folder.rmdir()
    return {"id": made["id"], "zip": packed}
