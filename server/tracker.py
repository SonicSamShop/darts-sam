# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Turns a stream of camera frames into 'dart' and 'takeout' events.

Pure logic, no camera or network code, so it can be tested with synthetic
frames (see tests/test_vision.py).
"""
import time
from collections import deque

import cv2
import numpy as np

from . import board, calib, detect

MOTION_FRACTION = 0.0015  # frame-to-frame change above this = something moving
STABLE_FRAMES = 3         # still frames required before we look for a dart
STUCK_FRAMES = 90         # big static change for this long = re-baseline
HISTORY = 4               # looks kept for a problem report (see report.py)
MAX_TIP_GAP = 40.0        # mm; a position further than this from every camera's own tip is no dart
HEAL_AFTER = 2            # darts scored since the last pull-out before trusting a matching one

# A phone on a stand doesn't keep still: each dart's thump leaves the picture a
# few px from where it was, and then every wire and number looks changed. With
# `steady`, each still picture is first laid over the one the board was found
# in (see Tracker.line_up, small_grey) and only the board itself is compared.
STEADY_SCALE = 4          # the pictures are lined up at this fraction of their size (1/4)
STEADY_REACH_MM = 260.0   # from the bull: what is compared. Beyond the numbers; short of a surround's lights,
                          # which stand in front of the board and so never line up with it
STEADY_MOST = 0.03        # of the picture's longer side: moved further than this, it was knocked, not shaken
STEADY_MATCH = 0.75       # how alike the lined-up pictures must be (ECC's 0..1); another view of the room is less
STEADY_AGAIN = 16         # still frames between lining up again, for a stand that creeps


def small_grey(frame):
    """A picture as pictures are lined up with it: small and grey."""
    h, w = frame.shape[:2]
    return cv2.cvtColor(cv2.resize(frame, (w // STEADY_SCALE, h // STEADY_SCALE), interpolation=cv2.INTER_AREA),
                        cv2.COLOR_BGR2GRAY)


def _small(frame):
    return cv2.GaussianBlur(
        cv2.cvtColor(cv2.resize(frame, (320, 180)), cv2.COLOR_BGR2GRAY), (5, 5), 0)


class Tracker:
    def __init__(self, homographies: dict, steady: bool = False, anchors: dict | None = None):
        self.H = homographies  # cam id -> calib.View (or a bare 3x3 image->board matrix)
        self.steady = steady   # line pictures up before comparing them (a phone's camera)
        # cam id -> the picture its calibration was made from (small_grey): what
        # pictures are lined up with, so they are where the calibration says the
        # board is. Without one, the first still picture stands in.
        self.given = dict(anchors or {})
        self.regions = {}      # cam id -> the part of its picture that is compared, when steady
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
        self.warps = {}      # cam id -> how this still spell's pictures lie over the anchor (None: they don't)
        self.anchors = dict(self.given)

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

    def _region(self, c, shape):
        """The board in camera c's picture, as a mask, clear of the picture's
        edges (where a lined-up picture has nothing of its own to show)."""
        if c not in self.regions:
            h, w = shape[:2]
            region = np.zeros((h, w), np.uint8)
            view = calib.view(self.H[c])
            ring = [board.polar(a, STEADY_REACH_MM) for a in range(0, 360, 3)]
            cv2.fillPoly(region, [np.round(view.to_picture(ring)).astype(np.int32)], 255)
            m = int(np.ceil(STEADY_MOST * max(h, w)))
            region[:m] = region[-m:] = 0
            region[:, :m] = region[:, -m:] = 0
            self.regions[c] = region
        return self.regions[c]

    def _warp(self, c, frame):
        """How `frame` lies over camera c's anchor: a 2x3 matrix taking the
        anchor's px to this picture's, or None if it can't be told or the
        camera has moved too far for it to be a shake."""
        a, b = self.anchors[c], small_grey(frame)
        if a.shape != b.shape:
            return None
        h, w = frame.shape[:2]
        region = cv2.resize(self._region(c, frame.shape), (a.shape[1], a.shape[0]), interpolation=cv2.INTER_NEAREST)
        if not cv2.countNonZero(region):
            return None
        (dx, dy), _ = cv2.phaseCorrelate(np.float32(a), np.float32(b))  # roughly, to start from
        W = np.float32([[1, 0, dx], [0, 1, dy]])
        try:
            match, W = cv2.findTransformECC(a, b, W, cv2.MOTION_AFFINE,
                                            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-6), region, 5)
        except cv2.error:  # it found nothing to line up
            return None
        W[:, 2] *= STEADY_SCALE
        corners = np.float32([[0, 0], [w, 0], [0, h], [w, h]])
        moved = np.abs(corners @ W[:, :2].T + W[:, 2] - corners).max()
        if match < STEADY_MATCH or moved > STEADY_MOST * max(h, w):
            return None
        return W

    def line_up(self, frames: dict) -> dict:
        """The pictures as they would be had the cameras not moved since their
        anchors were taken. One that can't be lined up is given back as it is."""
        if not self.steady:
            return frames
        out = {}
        for c, f in frames.items():
            if c not in self.anchors or c not in self.H:
                out[c] = f
                continue
            if c not in self.warps:
                self.warps[c] = self._warp(c, f)
            W = self.warps[c]
            out[c] = f if W is None else cv2.warpAffine(
                f, W, (f.shape[1], f.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
        return out

    def lined_up(self, c) -> bool:
        """Did this still spell's picture from camera c lie over its anchor?"""
        return self.warps.get(c) is not None

    def _diff(self, c, before, after):
        mask = detect.diff_mask(before, after)
        if self.steady and c in self.H and self.warps.get(c) is not None:
            mask = cv2.bitwise_and(mask, self._region(c, mask.shape))
        return mask

    def _area(self, base, frames) -> int:
        """How much of the pictures differs from `base`, in px over all cameras."""
        return sum(cv2.countNonZero(self._diff(c, base[c], f))
                   for c, f in frames.items() if c in base)

    def _looks_empty(self, frames) -> bool:
        """No camera sees anything dart-shaped against the empty board."""
        return not any(detect.find_dart(self._diff(c, self.empty[c], f), self.H[c]) is not None
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
        if self.ref is None and not self.steady:
            self.ref = self.empty = dict(frames)
            self._moving(frames)
            return []
        if self._moving(frames):
            self.stable = 0
            self.noted = False
            self.warps = {}
            return []
        self.stable += 1
        if self.stable < STABLE_FRAMES:
            return []
        if self.steady:
            if self.stable % STEADY_AGAIN == 0:
                self.warps = {}
            frames = self.line_up(frames)
        if self.ref is None:
            # Steady: the empty board's picture is taken once the camera is
            # still, not as a finger leaves the phone.
            self.ref = self.empty = dict(frames)
            for c, f in frames.items():
                self.anchors.setdefault(c, small_grey(f))
            return []

        masks = {c: self._diff(c, self.ref[c], f)
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
        if len(lines) == 1:
            # One camera can't cross lines: say how sure it is of each bed, so
            # the app can ask the player when it isn't.
            cam = next(c for c, s in sightings.items() if s is not None)
            odds = detect.bed_odds(lines[0], self.H[cam])
            look["event"].update(odds=odds, confidence=odds[0]["p"])
        return [look["event"]]
