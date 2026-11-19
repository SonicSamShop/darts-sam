"""Turns a stream of camera frames into 'dart' and 'takeout' events.

Pure logic, no camera or network code, so it can be tested with synthetic
frames (see tests/test_vision.py).
"""
import time
from collections import deque

import cv2
import numpy as np

from . import board, detect

MOTION_FRACTION = 0.0015  # frame-to-frame change above this = something moving
STABLE_FRAMES = 3         # still frames required before we look for a dart
STUCK_FRAMES = 90         # big static change for this long = re-baseline
HISTORY = 4               # looks kept for a problem report (see report.py)
MAX_TIP_GAP = 40.0        # mm; a position further than this from every camera's own tip is no dart
HEAL_AFTER = 2            # darts scored since the last pull-out before trusting a matching one


def _small(frame):
    return cv2.GaussianBlur(
        cv2.cvtColor(cv2.resize(frame, (320, 180)), cv2.COLOR_BGR2GRAY), (5, 5), 0)


class Tracker:
    def __init__(self, homographies: dict):
        self.H = homographies  # cam id -> calib.View (or a bare 3x3 image->board matrix)
        # The last few times something on the board had changed and was still:
        # the pictures, what each camera made of them and what was decided.
        self.history = deque(maxlen=HISTORY)
        self.reset()

    def reset(self):
        """Call when the board is empty (startup, or the user says so)."""
        self.ref = None      # frames just before the next dart
        self.empty = None    # frames of the empty board
        self.prev_small = None
        self.stable = 0
        self.darts = 0
        self.area_vs_empty = 0
        self.noted = False   # this still spell's "saw nothing" is already in the history
        self.clean = True    # nothing has been taken into ref since it was the empty board
        self.low = None      # frames after the last time darts came out but the board didn't look empty
        self.since_low = 0   # darts scored since then

    def _look(self, frames, masks, sightings, outcome=None):
        look = {"ts": time.time(), "before": self.ref, "after": dict(frames), "masks": masks,
                "sightings": sightings, "outcome": outcome, "event": None, "darts": self.darts}
        self.history.append(look)
        return look

    def _unseen(self, frames, masks, outcome):
        """A change that was not scored. It is there on every frame until
        something moves, so it is kept once."""
        if not self.noted:
            self.noted = True
            self._look(frames, masks, {}, outcome)

    def _area(self, base, frames) -> int:
        """How much of the pictures differs from `base`, in px over all cameras."""
        return sum(cv2.countNonZero(detect.diff_mask(base[c], f))
                   for c, f in frames.items() if c in base)

    def _looks_empty(self, frames) -> bool:
        """No camera sees anything dart-shaped against the empty board."""
        return not any(detect.find_dart(detect.diff_mask(self.empty[c], f), self.H[c]) is not None
                       for c, f in frames.items() if c in self.empty and c in self.H)

    def _moving(self, frames) -> bool:
        small = {c: _small(f) for c, f in frames.items()}
        moving = False
        if self.prev_small is not None:
            for c, s in small.items():
                p = self.prev_small.get(c)
                if p is None:
                    continue
                changed = cv2.countNonZero(
                    cv2.threshold(cv2.absdiff(p, s), 20, 255, cv2.THRESH_BINARY)[1])
                if changed / s.size > MOTION_FRACTION:
                    moving = True
        self.prev_small = small
        return moving

    def update(self, frames: dict) -> list[dict]:
        """frames: cam id -> BGR image. Returns a list of event dicts."""
        if not frames:
            return []
        if self.ref is None:
            self.ref = self.empty = dict(frames)
            self._moving(frames)
            return []
        if self._moving(frames):
            self.stable = 0
            self.noted = False
            return []
        self.stable += 1
        if self.stable < STABLE_FRAMES:
            return []

        masks = {c: detect.diff_mask(self.ref[c], f)
                 for c, f in frames.items() if c in self.ref}
        if not masks:
            return []
        biggest = max(detect.changed_fraction(m) for m in masks.values())
        if biggest > detect.MAX_DART_FRACTION:
            # Someone is standing still in view, or the lights changed.
            self._unseen(frames, masks, "too much changed")
            if self.stable > STUCK_FRAMES:
                self.reset()
            return []

        sightings = {c: detect.find_dart(m, self.H[c])
                     for c, m in masks.items() if c in self.H}
        lines = [s for s in sightings.values() if s is not None]
        if not lines:
            if any(cv2.countNonZero(m) >= detect.MIN_PART_AREA for m in masks.values()):
                self._unseen(frames, masks, "nothing dart-shaped")
            # Follow slow light drift. But if something was taken into ref
            # without being scored (see below), the board may not be empty:
            # check once per still spell before calling this picture "empty",
            # or a takeout would never be seen again.
            if self.darts == 0 and (self.clean or (self.stable == STABLE_FRAMES and self._looks_empty(frames))):
                self.ref = self.empty = dict(frames)
                self.clean = True
            return []

        # Something changed and is now still. Dart added, or dart(s) removed?
        area = self._area(self.empty, frames)
        prev_area, self.area_vs_empty = self.area_vs_empty, area
        look = self._look(frames, masks, sightings)
        look.update(area=area, prev_area=prev_area)
        self.ref = dict(frames)
        self.stable = 0
        self.clean = False

        if self.darts > 0 and area < 0.85 * prev_area:
            nothing = detect.MIN_DART_AREA * len(frames)
            # The empty picture can be wrong (taken with a dart in the board),
            # and then pulling the darts never looks empty. But the board being
            # exactly as it was after the last pull-out, with darts thrown in
            # between, is the empty board; that picture replaces the wrong one.
            if area < nothing or (self.low is not None and self.since_low >= HEAL_AFTER
                                  and self._area(self.low, frames) < nothing):
                self.darts = 0
                self.area_vs_empty = 0
                self.empty = dict(frames)
                self.clean = True
                self.low = None
                look["outcome"] = "takeout"
                return [{"type": "takeout"}]
            self.low, self.since_low = dict(frames), 0
            self.darts = max(0, self.darts - 1)  # one fell out or was pulled
            look["outcome"] = "removed"
            return [{"type": "removed"}]

        # A dart that is really there is seen by more than one camera. A change
        # in just one is the camera or board still shaking from the last dart,
        # a shadow, or a hand leaving: scoring it would log a miss (the "dart"
        # lands wherever that one camera's scraps point) and use up a throw.
        # The new picture is already the reference, so it is simply absorbed.
        if len(masks) >= 2 and len(lines) < 2:
            look["outcome"] = "one camera only"
            return []
        # A new dart adds to what differs from the empty board. A dart sagging,
        # or wires glinting, changes the pictures without adding anything.
        if area - prev_area < detect.MIN_DART_AREA * len(lines):
            look["outcome"] = "nothing new"
            return []
        found = detect.locate(lines)
        if found is None:
            look["outcome"] = "no position"
            return []
        (x, y), conf = found
        # Lines through scraps cross anywhere. A real dart is scored near where
        # at least one camera saw its point.
        if min(np.linalg.norm(np.array([x, y]) - s.tip) for s in lines) > MAX_TIP_GAP:
            look["outcome"] = "tips disagree"
            return []
        self.darts += 1
        self.since_low += 1
        look["outcome"] = "dart"
        look["event"] = {"type": "dart", "x": round(float(x), 1), "y": round(float(y), 1),
                         "confidence": conf, "cameras": len(lines), **board.score(x, y)}
        return [look["event"]]
