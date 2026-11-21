# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Test the calls a phone's browser makes (server/phonevision.py) on a drawn
phone's picture: find the board, score a dart, notice the phone was knocked.

  python -m tests.test_phonevision
"""
import json

import cv2
import numpy as np

from server import board, phonevision
from tests.test_calib import camera, render
from tests.test_vision import H, W, dart_at, project

P = camera(angle=30, radius=330, height=120)
RNG = np.random.default_rng(11)


def picture(darts=()):
    """What the phone sees, as the RGBA bytes a browser canvas gives."""
    img = render(P, RNG)
    for tip, tail in darts:
        a, b = project(P, tip), project(P, tail)
        mid = a + (b - a) * 0.55
        cv2.line(img, tuple(map(int, a)), tuple(map(int, mid)), (150, 150, 160), 5, cv2.LINE_AA)
        cv2.line(img, tuple(map(int, mid)), tuple(map(int, b)), (60, 90, 240), 9, cv2.LINE_AA)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGBA).tobytes()


def twenty():
    return tuple(float(v) for v in project(P, np.array([*board.polar(3, 60), 0.0])))


def calibrated():
    found = phonevision.calibrate(picture(), W, H, twenty())
    assert found["ok"], found
    return found["calibration"]


def test_calibrate():
    cal = calibrated()
    assert cal["size"] == [W, H], cal
    json.dumps(cal)  # kept in the account's settings


def test_calibrate_fails_with_a_reason():
    blank = np.full((H, W, 4), 90, np.uint8).tobytes()
    found = phonevision.calibrate(blank, W, H, None)
    assert found["ok"] is False and found["reason"], found


def test_takes_a_browser_array():
    """In the browser a picture arrives as a JavaScript array, which Pyodide
    hands over as an object with to_py() (giving a memoryview)."""
    class FromJs:
        def __init__(self, b): self.b = b
        def to_py(self): return memoryview(self.b)
    found = phonevision.calibrate(FromJs(picture()), W, H, twenty())
    assert found["ok"], found


def test_nothing_before_start():
    phonevision.stop()
    assert phonevision.feed(picture(), W, H) == []


def test_scores_a_dart():
    phonevision.start(calibrated())
    events = []
    for _ in range(5):
        events += phonevision.feed(picture(), W, H)
    for _ in range(5):
        events += phonevision.feed(picture([dart_at(0, 60)]), W, H)
    darts = [e for e in events if e["type"] == "dart"]
    assert len(darts) == 1, events
    assert darts[0]["seg"] == 20 and darts[0]["odds"], darts
    json.dumps(events)  # posted from the worker as is


def test_restart_forgets_the_board():
    phonevision.start(calibrated())
    for _ in range(5):
        phonevision.feed(picture([dart_at(0, 60)]), W, H)
    phonevision.restart()
    # After a restart the picture it sees first is the empty board, even with a
    # dart in it: nothing is scored for what was there already.
    events = []
    for _ in range(6):
        events += phonevision.feed(picture([dart_at(0, 60)]), W, H)
    assert not [e for e in events if e["type"] == "dart"], events


def test_says_when_the_picture_is_still():
    """The page needs to know the picture settles at all (autofocus hunting or
    a flickering light never does): a still board says "still"."""
    phonevision.start(calibrated())
    said = [phonevision.feed(picture(), W, H) for _ in range(5)]
    assert said[-1] == [{"type": "still"}], said
    moving = [phonevision.feed(picture([dart_at(0, 60)] if i % 2 else []), W, H) for i in range(6)]
    assert not any({"type": "still"} in s for s in moving[1:]), moving


def test_outline_sits_on_the_board():
    """The lines drawn over the phone's picture to show where it found the
    board: rings and wires, in the picture's pixels, where the board really is."""
    cal = calibrated()
    lines = phonevision.outline(cal)
    json.dumps(lines)
    assert len(lines) == 6 + 20, len(lines)  # six rings, twenty wires
    double_out = lines[5]
    truth = [project(P, np.array([*board.polar(a, board.R_DOUBLE_OUT), 0.0])) for a in (0, 90, 180, 270)]
    for t in truth:
        assert min(np.hypot(x - t[0], y - t[1]) for x, y in double_out) < 6, t


def test_still_matches():
    cal = calibrated()
    assert phonevision.still_matches(picture(), W, H, cal)
    moved = np.roll(np.frombuffer(picture(), np.uint8).reshape(H, W, 4), 40, axis=1).tobytes()
    assert not phonevision.still_matches(moved, W, H, cal)


def main():
    test_calibrate()
    test_calibrate_fails_with_a_reason()
    test_takes_a_browser_array()
    test_nothing_before_start()
    test_scores_a_dart()
    test_restart_forgets_the_board()
    test_says_when_the_picture_is_still()
    test_outline_sits_on_the_board()
    test_still_matches()
    print("OK")


if __name__ == "__main__":
    main()
