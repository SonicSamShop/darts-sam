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
    assert phonevision.darts_in() == 1  # the page goes by this, not its own count
    assert darts[0]["seg"] == 20 and darts[0]["odds"], darts
    json.dumps(events)  # posted from the worker as is


def shifted(rgba: bytes, dx: float, dy: float) -> bytes:
    """The same picture from a phone that has moved a little on its stand."""
    img = np.frombuffer(rgba, np.uint8).reshape(H, W, 4)
    return cv2.warpAffine(img, np.float32([[1, 0, dx], [0, 1, dy]]), (W, H), borderMode=cv2.BORDER_REPLICATE).tobytes()


def test_scores_a_dart_when_the_phone_has_shifted():
    """A dart's thump, or a finger on the screen, leaves the phone a few px
    from where the board was found (reported 2026-11-21: no dart was ever
    counted, as the whole board looked changed). The dart is still scored, and
    where it would have been with the phone unmoved."""
    cal = calibrated()
    assert cal["anchor"], "the picture the board was found in goes with the calibration"
    phonevision.start(cal)
    for _ in range(5):
        phonevision.feed(picture(), W, H)
    want = [e for _ in range(5) for e in phonevision.feed(picture([dart_at(0, 60)]), W, H) if e["type"] == "dart"]
    assert len(want) == 1, want

    phonevision.start(cal)
    events = []
    for _ in range(5):
        events += phonevision.feed(shifted(picture(), 9, -7), W, H)  # moved before the first picture, too
    for _ in range(5):
        events += phonevision.feed(shifted(picture([dart_at(0, 60)]), -6, 5), W, H)
    for _ in range(5):
        events += phonevision.feed(shifted(picture([dart_at(0, 60)]), 4, 8), W, H)  # and again: nothing new
    darts = [e for e in events if e["type"] == "dart"]
    assert len(darts) == 1 and phonevision.darts_in() == 1, events
    assert darts[0]["seg"] == 20, darts
    assert np.hypot(darts[0]["x"] - want[0]["x"], darts[0]["y"] - want[0]["y"]) < 2.0, (darts, want)
    # Shaken is not knocked; pointing somewhere else is.
    assert phonevision.still_matches(shifted(picture(), 9, -7), W, H, cal)
    assert not phonevision.still_matches(shifted(picture(), 90, -70), W, H, cal)


def test_an_old_calibration_still_scores():
    """One saved before pictures were kept: the first still picture stands in."""
    cal = {k: v for k, v in calibrated().items() if k != "anchor"}
    phonevision.start(cal)
    events = []
    for _ in range(5):
        events += phonevision.feed(picture(), W, H)
    for _ in range(5):
        events += phonevision.feed(shifted(picture([dart_at(0, 60)]), -6, 5), W, H)
    assert [e["seg"] for e in events if e["type"] == "dart"] == [20], events


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


def test_report_replays():
    """A problem report from the phone is a report like any other: packed as the
    site takes them, and server.replay finds the same dart in it again."""
    import contextlib, io, tempfile
    from pathlib import Path
    from server import replay, reportsync
    phonevision.start(calibrated())
    for _ in range(5):
        phonevision.feed(picture(), W, H)
    for _ in range(5):
        phonevision.feed(picture([dart_at(0, 60)]), W, H)
    made = phonevision.report({"game": "x01"}, "T20")
    assert made["id"] and isinstance(made["zip"], bytes), made.keys()
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / made["id"]
        reportsync.unpack(made["zip"], folder)
        rep = json.loads((folder / "report.json").read_text())
        assert rep["expected"] == "T20" and rep["app"] == {"game": "x01"}, rep.keys()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            replay.replay(folder)
        assert "now 20 (" in out.getvalue(), out.getvalue()


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
    test_scores_a_dart_when_the_phone_has_shifted()
    test_an_old_calibration_still_scores()
    test_restart_forgets_the_board()
    test_says_when_the_picture_is_still()
    test_outline_sits_on_the_board()
    test_report_replays()
    test_still_matches()
    print("OK")


if __name__ == "__main__":
    main()


# ---------- the setup check after the board is found ----------
GOOD = camera(angle=30, radius=250, height=420)  # 31° round from straight on, the board filling the picture


def found_with(P, dim=1.0):
    img = (render(P, np.random.default_rng(3)) * dim).astype(np.uint8)
    tw = tuple(float(v) for v in project(P, np.array([*board.polar(3, 60), 0.0])))
    found = phonevision.calibrate(cv2.cvtColor(img, cv2.COLOR_BGR2RGBA).tobytes(), W, H, tw)
    assert found["ok"], found
    return [c["kind"] for c in found["checks"]], found


def test_a_good_setup_passes_the_checks():
    kinds, found = found_with(GOOD)
    assert kinds == [], found["checks"]


def test_a_dark_board_is_too_dark():
    """A player's board lit by one lamp off to the side (2026-11-24) read about
    80 of 255 in the middle of its brightness; a well lit one about 195."""
    kinds, found = found_with(GOOD, dim=0.45)
    assert kinds == ["dark"], found["checks"]
    assert "light" in found["checks"][0]["text"]
    json.dumps(found)  # posted from the worker as is


def test_a_phone_far_round_the_side_is_too_steep():
    kinds, _ = found_with(camera(angle=30, radius=520, height=200))  # 69°
    assert "steep" in kinds, kinds


def test_a_far_away_board_is_too_small():
    kinds, _ = found_with(P)  # the drawn phone: 70° round and the board small
    assert "small" in kinds, kinds
