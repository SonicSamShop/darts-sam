# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Find a newly-landed dart in one camera and locate it across cameras.

Method (the same idea the commercial systems use):
  1. Diff the current frame against the frame from before the dart landed.
  2. The changed blob is the dart. Fit a straight line along its shaft.
  3. Push that line through the camera's calibration onto the board plane
     (taking out the lens's bend first, see calib.py).
     The dart's tip touches the board, so the tip lies on that line.
  4. Two or more cameras give two or more lines; they cross at the tip.
"""
from dataclasses import dataclass

import cv2
import numpy as np

from . import board, calib

MIN_DART_AREA = 150      # px of changed pixels; smaller is noise
MAX_DART_FRACTION = 0.12  # more of the frame than this changing is a hand/body
MIN_PART_AREA = 30        # px; a piece of the dart smaller than this is speckle
MAX_OFF_AXIS = 14         # px; a piece further than this from the dart's line isn't part of it
MAX_DART_LENGTH = 0.25    # of the picture's width; pieces further apart than this aren't one dart


def diff_mask(before: np.ndarray, after: np.ndarray, thresh: int = 28) -> np.ndarray:
    a = cv2.GaussianBlur(cv2.cvtColor(before, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    b = cv2.GaussianBlur(cv2.cvtColor(after, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    mask = cv2.threshold(cv2.absdiff(a, b), thresh, 255, cv2.THRESH_BINARY)[1]
    k = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)


def changed_fraction(mask: np.ndarray) -> float:
    return float(cv2.countNonZero(mask)) / mask.size


@dataclass
class DartLine:
    """A dart seen by one camera, expressed on the board plane (mm)."""
    point: np.ndarray      # a point on the line
    direction: np.ndarray  # unit vector
    tip: np.ndarray        # this camera's own guess at the tip
    area: int
    # Where that was in the camera's picture (px), kept for problem reports.
    ends_px: np.ndarray | None = None  # the two ends of the dart
    tip_px: np.ndarray | None = None


def to_board(H: np.ndarray, pts) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float64).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, H).reshape(-1, 2)


def _axis(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The line along a dart, as (point, unit direction) in pixels.

    A plain line fit is pulled about by the flight, which is most of the
    dart's pixels but a lumpy shape. So after a first rough fit, take the
    middle of the dart's width at each step along it and fit to those: the
    thin barrel and shaft then count as much per pixel of length as the flight.
    """
    vx, vy, x0, y0 = cv2.fitLine(pts, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    d, o = np.array([vx, vy]), np.array([x0, y0])
    rel = pts - o
    t = np.round(rel @ d).astype(int)
    u = rel @ np.array([-d[1], d[0]])
    t -= t.min()
    lo = np.full(t.max() + 1, np.inf)
    hi = np.full(t.max() + 1, -np.inf)
    np.minimum.at(lo, t, u)
    np.maximum.at(hi, t, u)
    steps = np.nonzero(np.isfinite(lo))[0]
    if len(steps) < 8:
        return o, d
    t0 = np.round(rel @ d).min()
    mids = o + np.outer(steps + t0, d) + np.outer((lo[steps] + hi[steps]) / 2, [-d[1], d[0]])
    vx, vy, x0, y0 = cv2.fitLine(mids.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    return np.array([x0, y0]), np.array([vx, vy])


def find_dart(mask: np.ndarray, H) -> DartLine | None:
    """Locate the dart blob in a diff mask. H is the camera's calibration: a
    calib.View, or a bare image px -> board mm homography."""
    view = calib.view(H)
    H = view.H
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n < 2:
        return None
    # A dart rarely shows up in one piece: wires, glare on the barrel and the
    # thin point split it, and the flight is usually far bigger than the rest.
    # Keep every piece that isn't speckle (judging pieces against the biggest
    # one throws the barrel and point away and leaves only the flight), then
    # drop the ones that don't lie along the dart, such as its shadow.
    areas = stats[:, cv2.CC_STAT_AREA]
    biggest = 1 + int(np.argmax(areas[1:]))
    # ... and that is within a dart's length of the biggest piece: when a dart
    # thumps in, the camera can shake, and every sharp edge in the picture
    # (numbers, wires) then shows up as a scatter of small changes.
    reach = MAX_DART_LENGTH * max(mask.shape)
    near_biggest = np.linalg.norm(cents - cents[biggest], axis=1) <= reach
    keep = [i for i in range(1, n) if (areas[i] >= MIN_PART_AREA and near_biggest[i]) or i == biggest]
    for _ in range(3):
        ys, xs = np.nonzero(np.isin(labels, keep))
        # Straight through the lens: a straight dart is a straight line again.
        pts = view.straighten(np.column_stack([xs, ys])).astype(np.float32)
        o, d = _axis(pts)
        off = np.abs((view.straighten(cents[keep]) - o) @ np.array([-d[1], d[0]]))
        on_line = [i for i, far in zip(keep, off) if far <= MAX_OFF_AXIS or i == biggest]
        if len(on_line) == len(keep):
            break
        keep = on_line
    total = int(areas[keep].sum())
    if total < MIN_DART_AREA:
        return None

    t = (pts - o) @ d
    ends = np.array([o + d * t.min(), o + d * t.max()])

    # Which end is the tip? H's third row measures distance from the board's
    # horizon line in the image; the end nearer the camera (the tip, since the
    # flight's "shadow" falls away from the camera) has the larger value.
    w = np.abs(H[2, 0] * ends[:, 0] + H[2, 1] * ends[:, 1] + H[2, 2])
    tip_img = ends[int(np.argmax(w))]
    # Refine: keep the very end of the dart along its length, but centre it
    # across the width of the last few px (the point may sit off the fitted line).
    near = pts[np.linalg.norm(pts - tip_img, axis=1) < 6]
    if len(near):
        across = np.array([-d[1], d[0]])
        tip_img = tip_img + across * float(((near - tip_img) @ across).mean())

    a, b = to_board(H, ends)
    direction = b - a
    norm = np.linalg.norm(direction)
    if norm < 1e-6:
        return None
    # ends_px and tip_px go on the camera's own picture, so they are bent back.
    return DartLine(point=a, direction=direction / norm,
                    tip=to_board(H, [tip_img])[0], area=total, ends_px=view.bend(ends), tip_px=view.bend(tip_img)[0])


def locate(lines: list[DartLine]) -> tuple[np.ndarray, float] | None:
    """Combine per-camera sightings into one board position.

    Returns (xy_mm, confidence 0..1) or None.
    """
    if not lines:
        return None
    if len(lines) == 1:
        return lines[0].tip, 0.3  # single camera: usable but shaky

    def intersect(ls):
        A = np.zeros((2, 2))
        b = np.zeros(2)
        for ln in ls:
            P = np.eye(2) - np.outer(ln.direction, ln.direction)
            A += P
            b += P @ ln.point
        if abs(np.linalg.det(A)) < 1e-6:  # near-parallel lines
            return None
        return np.linalg.solve(A, b)

    def residual(x, ls):
        return max(abs(ln.direction[0] * (x - ln.point)[1] - ln.direction[1] * (x - ln.point)[0])
                   for ln in ls)

    x = intersect(lines)
    if x is None:
        return np.mean([ln.tip for ln in lines], axis=0), 0.3
    res = residual(x, lines)
    if len(lines) >= 3 and res > 4.0:
        # One camera probably saw something odd; try dropping each in turn.
        best = None
        for i in range(len(lines)):
            sub = lines[:i] + lines[i + 1:]
            xs = intersect(sub)
            if xs is not None:
                r = residual(xs, sub)
                # Pairs always intersect exactly, so judge them by how well
                # they agree with the cameras' own tip guesses.
                r += np.mean([np.linalg.norm(xs - ln.tip) for ln in sub])
                if best is None or r < best[1]:
                    best = (xs, r)
        if best is not None:
            return best[0], 0.6
    conf = 0.95 if len(lines) >= 3 else 0.8
    if res > 4.0:
        conf = 0.5
    return x, conf


# One camera's tip is unsure mostly ALONG the dart (where along its line the
# point really is) and much less across it. These are the spreads, in mm, for
# a dart seen clearly at ODDS_REF_MM_PER_PX; tuned from players' corrections.
ODDS_ALONG_MM = 6.0
ODDS_ACROSS_MM = 2.5
ODDS_REF_MM_PER_PX = 0.6
_GRID = np.linspace(-3, 3, 21)
_WEIGHTS = np.exp(-0.5 * (_GRID[:, None] ** 2 + _GRID[None, :] ** 2))


def bed_odds(line: DartLine, view, along: float = ODDS_ALONG_MM, across: float = ODDS_ACROSS_MM) -> list[dict]:
    """How likely each bed is for a dart one camera saw: up to three
    {"seg", "mult", "p"}, likeliest first.

    The tip's position is taken as a spread longer along the dart's line than
    across it, wider when the camera sees that part of the board coarsely or
    saw little of the dart, and the spread is added up inside each bed. A fixed
    grid, not random samples, so the same dart always gets the same odds."""
    view = calib.view(view)
    k = 1.0
    if line.tip_px is not None:
        a, b = view.to_board([line.tip_px, np.asarray(line.tip_px) + (1.0, 0.0)])
        k = max(1.0, float(np.linalg.norm(b - a)) / ODDS_REF_MM_PER_PX)
    if line.area < 2 * MIN_DART_AREA:
        k *= 1.5
    d = line.direction / np.linalg.norm(line.direction)
    n = np.array([-d[1], d[0]])
    totals: dict[tuple[int, int], float] = {}
    for i, u in enumerate(_GRID * along * k):
        for j, v in enumerate(_GRID * across * k):
            x, y = line.tip + u * d + v * n
            s = board.score(x, y)
            key = (s["seg"], s["mult"])
            totals[key] = totals.get(key, 0.0) + _WEIGHTS[i, j]
    whole = float(_WEIGHTS.sum())
    best = sorted(totals.items(), key=lambda kv: -kv[1])[:3]
    return [{"seg": int(seg), "mult": int(mult), "p": round(float(w) / whole, 2)} for (seg, mult), w in best]
