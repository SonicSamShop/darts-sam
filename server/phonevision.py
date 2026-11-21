# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The vision calls a phone makes when it scores with its own camera.

A phone's browser runs this file, and the rest of the vision code, in Python
inside the page (Pyodide, see web/vision-worker.js). Pictures come as the RGBA
bytes a canvas gives; answers go back as plain dicts and lists, ready to post
to the page. Nothing here touches a camera, a file or the network, so it is
tested on drawn pictures like the rest (python -m tests.test_phonevision).

One phone is one camera, called "phone".
"""
import cv2
import numpy as np

from . import autocalib, calib, tracker

CAMERA = "phone"
MOVED_PX = 3.0   # rings' edges further than this from where the calibration puts them: the phone moved
MIN_EDGES = 40   # of up to 320 ring edges; fewer found and the board isn't where it was

_tracker: tracker.Tracker | None = None


def _picture(rgba, w: int, h: int) -> np.ndarray:
    if hasattr(rgba, "to_py"):  # a JavaScript array, as Pyodide hands it over
        rgba = rgba.to_py()
    return cv2.cvtColor(np.frombuffer(rgba, np.uint8).reshape(h, w, 4), cv2.COLOR_RGBA2BGR)


def calibrate(rgba, w: int, h: int, twenty=None) -> dict:
    """Find the board in a picture of it, empty. `twenty` is any pixel in the
    20. Answers {"ok": True, "calibration": ...} with the calibration as
    config.json keeps a camera's, or {"ok": False, "reason": ...} for the player."""
    try:
        found = autocalib.detect(_picture(rgba, w, h), None if twenty is None else tuple(twenty))
    except autocalib.Failed as e:
        return {"ok": False, "reason": str(e)}
    return {"ok": True, "calibration": found.saved()}


def start(calibration: dict) -> None:
    """Start watching with this calibration. The next picture is taken as the
    empty board."""
    global _tracker
    _tracker = tracker.Tracker({CAMERA: calib.view(calibration)})


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
    if _tracker is None:
        return []
    events = _tracker.update({CAMERA: _picture(rgba, w, h)})
    if not events and _tracker.stable >= tracker.STABLE_FRAMES:
        # Nothing to say, but the picture has settled: the page counts on
        # hearing this, to tell a picture that never settles (autofocus
        # hunting, a flickering light) from a quiet board.
        return [{"type": "still"}]
    return events


def still_matches(rgba, w: int, h: int, calibration: dict) -> bool:
    """Is the board still where the calibration says? The coloured rings'
    edges are looked for near where they should be; a knocked phone finds
    them somewhere else, or not at all."""
    view = calib.view(calibration)
    img = _picture(rgba, w, h)
    if view.lens:
        img = cv2.remap(img, *calib.straighten_maps(view.lens, (w, h)), cv2.INTER_LINEAR)
    px, mm = autocalib._band_edges(autocalib._lab_a(img), view.H)
    if len(px) < MIN_EDGES:
        return False
    expected = autocalib._apply(np.linalg.inv(view.H), mm)
    return float(np.sqrt(np.mean(np.sum((expected - px) ** 2, axis=1)))) < MOVED_PX
