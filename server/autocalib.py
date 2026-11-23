# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Automatic calibration: find the board in a camera picture by its colours.

Tapping four wire crossings gives a homography from exactly four points, so
any slip of the finger goes straight into every score. This finds the joins
between the red and green blocks of the double and treble rings instead (40
of them) and fits the homography to all of them, discarding any that disagree.

Steps:
  1. Mask the saturated red/green pixels. The outline of the biggest blob is
     the outside of the double ring: an ellipse in the picture.
  2. Find the bull inside it (the coloured blob that, taken as the centre,
     puts the treble ring where it should be). A circle's image plus the
     image of its centre fixes the homography up to a rotation about the bull.
  3. "Unroll" the rings (angle across, radius down) and read the red/green
     pattern round the double ring. Its phase fixes the rotation to within one
     red block, i.e. a multiple of 36 degrees.
  4. Refine: measure where every red/green join really is, refit, repeat.
  5. The last ambiguity (which red block is the 20) cannot be seen from the
     colours, so the caller passes one pixel known to be in the 20 segment:
     a single rough tap, or the old calibration's idea of where the 20 is.
     With none, the 20 is taken to be the red block straight up the picture
     from the bull, which is right for a camera the right way up in front of
     the board.
  6. Webcams bend the picture (see calib.py), which a homography can't
     follow: fitted to the joins, it put the real double ring a few mm outside
     the board near the picture's edges. So steps 1-5 are run on the picture
     straightened by a range of bends, and the bend kept is the one with which
     the edges of both coloured rings, all the way round, best fit a flat board.

The board must be empty and fully in view.

It needs only board.py, calib.py, NumPy and OpenCV, so it can be used without
the rest of the server. From Python:

    import cv2
    from server import autocalib, board
    found = autocalib.detect(cv2.imread("docs/img/calibration/sample.jpg"), twenty_px=(590, 204))
    view = found.view()                           # picture px <-> board mm
    board.score(*view.to_board([(700, 300)])[0])  # {"seg": 13, "mult": 1}

and on a picture, a camera number or a stream address, with nothing else running:

    python -m server.autocalib docs/img/calibration/sample.jpg --twenty 590,204 --out found.jpg

docs/calibration.md explains each step, with pictures.
"""
import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import board, calib

MIN_SAT, MIN_VAL = 70, 50  # HSV: what counts as "coloured" for the first rough mask
MIN_CONTRAST = 12.0        # red-vs-green difference needed on the Lab a channel
PAD = 9.0                  # mm searched either side of a ring for its edges
R_STEP = 0.25              # mm per row of the unrolled picture
TH_STEP = 0.1              # degrees per column
THETAS = np.arange(0, 360, TH_STEP)
COARSE = np.arange(0, 360, 0.5)  # angles used for the first rough look
WINDOW = 7.0               # degrees searched either side of where a wire should be
RANSAC_PX = 3.0            # a join further than this from the fit is ignored (wires glint, lenses bend)
MIN_JOINS = 24             # of 40; fewer than this and we don't trust the result
MAX_RMS_PX = 2.0
LENSES = np.round(np.arange(-0.2, 1.21, 0.2), 2)  # bends (calib.py's k) tried first; then either side of the best
LENS_STEP = 0.1
BIGGEST = 2000             # px: the command looks at a bigger picture file in a copy this far across


class Failed(Exception):
    """The board could not be found; the message says why, for the user."""


@dataclass
class Result:
    H: np.ndarray        # straightened image px -> board mm
    points: list         # where board.CALIBRATION_POINTS are in the straightened picture
    joins: int           # red/green joins that agreed with the fit (max 40)
    rms_px: float        # how far those joins are from the fit, on average
    lens: float = 0.0    # the lens's bend, k in calib.py
    size: tuple = (1, 1)  # the picture's width and height

    def saved(self) -> dict:
        """What config.json keeps for this camera (calib.view() reads it back)."""
        return {"points": self.points, "lens": round(float(self.lens), 3), "size": list(self.size)}

    def view(self) -> calib.View:
        """The calibration ready to use: view().to_board(px), view().to_picture(mm)."""
        return calib.View(self.H, float(self.lens), tuple(self.size))


def _rot(deg: float) -> np.ndarray:
    """Board rotation that turns the board's clock angles back by `deg`."""
    a = np.radians(deg)
    return np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1.0]])


def _apply(H, pts) -> np.ndarray:
    pts = np.asarray(pts, np.float64).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, H).reshape(-1, 2)


def _colour_mask(img) -> np.ndarray:
    h, s, v = cv2.split(cv2.cvtColor(img, cv2.COLOR_BGR2HSV))
    red = (h <= 10) | (h >= 165)
    green = (h >= 35) & (h <= 95)
    return ((red | green) & (s >= MIN_SAT) & (v >= MIN_VAL)).astype(np.uint8) * 255


def _green_mask(img) -> np.ndarray:
    h, s, v = cv2.split(cv2.cvtColor(img, cv2.COLOR_BGR2HSV))
    return ((h >= 35) & (h <= 95) & (s >= MIN_SAT) & (v >= MIN_VAL)).astype(np.uint8) * 255


def _lab_a(img) -> np.ndarray:
    """Lab's "a" channel: red is high, green is low, black and cream are near 0."""
    return cv2.cvtColor(cv2.GaussianBlur(img, (3, 3), 0), cv2.COLOR_BGR2LAB)[..., 1].astype(np.float32) - 128


def _outlines(img, mask) -> list:
    """Shapes that might be the outside of the double ring. Usually it is the
    biggest coloured blob, but a red surround can be bigger, so offer several
    and also the outline of everything green (surrounds are rarely green)."""
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    hulls = sorted((cv2.convexHull(c) for c in contours), key=cv2.contourArea, reverse=True)[:5]
    green = cv2.morphologyEx(_green_mask(img), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    if cv2.countNonZero(green) >= 5:
        hulls.append(cv2.convexHull(cv2.findNonZero(green)))
    return [h for h in hulls if len(h) >= 5 and cv2.contourArea(h) >= 0.02 * mask.size]


def _coarse(img, chan) -> np.ndarray:
    """Steps 1 and 2: a first homography, right up to a rotation."""
    mask = _colour_mask(img)
    # The bull is one of the solid coloured blobs inside the ring, but so are
    # the treble blocks, and from a low camera a near treble can look bigger
    # than the bull. So try each blob as the centre and keep the one that
    # makes the treble ring come out as a circle of the right size.
    joined = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, _, stats, cents = cv2.connectedComponentsWithStats(joined, connectivity=8)
    area, bw, bh = stats[1:, cv2.CC_STAT_AREA], stats[1:, cv2.CC_STAT_WIDTH], stats[1:, cv2.CC_STAT_HEIGHT]
    solid = (area >= 20) & (area >= 0.5 * bw * bh)
    blobs = cents[1:][solid][np.argsort(-area[solid])]
    treble = np.arange(board.R_TRIPLE_IN + 1, board.R_TRIPLE_OUT - 1, 1.0)
    best = None
    for hull in _outlines(img, mask):
        (cx, cy), (w, h), ang = cv2.fitEllipse(hull)
        if min(w, h) < 20:
            continue
        # T turns the ellipse into the unit circle.
        a = np.radians(ang)
        T = (np.diag([2 / w, 2 / h, 1.0])
             @ np.array([[np.cos(a), np.sin(a), 0], [-np.sin(a), np.cos(a), 0], [0, 0, 1.0]])
             @ np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1.0]]))
        inside = [c for c in _apply(T, blobs) if np.hypot(*c) < 0.8] if len(blobs) else []
        for c in inside[:40]:
            d = float(np.hypot(*c))
            # Slide the centre to the middle while keeping the circle a circle
            # (the only projective map that does both, give or take a rotation).
            phi = np.arctan2(c[1], c[0])
            turn = np.array([[np.cos(phi), np.sin(phi), 0], [-np.sin(phi), np.cos(phi), 0], [0, 0, 1.0]])
            slide = np.array([[1, 0, -d], [0, np.sqrt(1 - d * d), 0], [-d, 0, 1.0]])
            H = np.diag([board.R_DOUBLE_OUT, board.R_DOUBLE_OUT, 1.0]) @ slide @ turn @ T
            strength = _pattern(chan, H, treble)[0]
            if best is None or strength > best[0]:
                best = (strength, H)
    if best is None or best[0] < MIN_CONTRAST / 4:
        raise Failed("Couldn't find the board's red and green rings. Check the lighting, that the board is empty "
                     "and that the whole double ring is in view.")
    H = best[1]
    # A camera in front of the board sees it the right way round: picture y
    # runs down and board y runs up, so the map must flip handedness.
    p = _apply(np.linalg.inv(H), [[0, 0], [1, 0], [0, 1]])
    (ax, ay), (bx, by) = p[1] - p[0], p[2] - p[0]
    if ax * by - ay * bx > 0:
        H = np.diag([1.0, -1.0, 1.0]) @ H
    return H


def _unroll(chan, H_inv, radii, thetas=THETAS) -> np.ndarray:
    """Sample the picture on a (radius, angle) grid of board positions."""
    a = np.radians(thetas)
    grid = np.stack([np.outer(radii, np.sin(a)), np.outer(radii, np.cos(a))], -1)
    px = _apply(H_inv, grid).reshape(len(radii), len(thetas), 2).astype(np.float32)
    return cv2.remap(chan, px[..., 0], px[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def _pattern(chan, H, radii) -> tuple[float, float]:
    """How strongly the ten-red-ten-green pattern shows round a ring, and the
    clock angle (0-36) of the middle of a red block."""
    s = _unroll(chan, np.linalg.inv(H), radii, COARSE).mean(0)
    c = np.sum((s - s.mean()) * np.exp(-10j * np.radians(COARSE))) * 2 / len(COARSE)
    return float(abs(c)), float(-np.degrees(np.angle(c)) / 10)


def _falling(f, expected) -> float | None:
    """Angle nearest `expected` where f (sampled every TH_STEP) goes + to -."""
    n = len(f)
    j0 = int(round(expected / TH_STEP))
    idx = np.arange(j0 - int(WINDOW / TH_STEP), j0 + int(WINDOW / TH_STEP))
    a, b = f[idx % n], f[(idx + 1) % n]
    hits = idx[(a > 0) & (b <= 0)]
    if not len(hits):
        return None
    j = hits[np.argmin(np.abs(hits - j0))]
    a, b = f[j % n], f[(j + 1) % n]
    return (j + a / (a - b)) * TH_STEP


def _edges(p, radii, r_in, r_out) -> tuple[float, float] | None:
    """Inner and outer edge of a coloured band in a radial profile p (high
    inside the band)."""
    inside = p[(radii > r_in + 2) & (radii < r_out - 2)]
    if not len(inside):
        return None
    top = np.median(inside)
    mid = int(np.argmin(np.abs(radii - (r_in + r_out) / 2)))
    out = []
    for step, far in ((-1, radii < r_in - 4), (1, radii > r_out + 4)):
        level = (top + np.median(p[far])) / 2
        if top - level < MIN_CONTRAST / 4:
            return None
        j = mid
        while 0 <= j + step < len(p) and p[j + step] > level:
            j += step
        k = j + step
        if not 0 <= k < len(p) or p[j] <= level:
            return None
        out.append(radii[j] + (radii[k] - radii[j]) * (p[j] - level) / (p[j] - p[k]))
    return out[0], out[1]


def _joins(chan, H):
    """Step 4: where the joins between red and green blocks are in the picture
    (on the centre line of each ring), paired with where they are on a real board."""
    H_inv = np.linalg.inv(H)
    found, truth = [], []
    for r_in, r_out in ((board.R_TRIPLE_IN, board.R_TRIPLE_OUT), (board.R_DOUBLE_IN, board.R_DOUBLE_OUT)):
        radii = np.arange(r_in - PAD, r_out + PAD + 1e-6, R_STEP)
        u = _unroll(chan, H_inv, radii)
        s = u[(radii > r_in + 2) & (radii < r_out - 2)].mean(0)
        s = np.convolve(np.concatenate([s[-2:], s, s[:2]]), np.ones(5) / 5, "valid")
        hi, lo = np.percentile(s, 85), np.percentile(s, 15)
        if hi - lo < MIN_CONTRAST:
            continue
        mid = (hi + lo) / 2
        for i in range(20):
            wire = 9 + 18 * i
            sign = 1 if i % 2 == 0 else -1  # red on the anticlockwise side of even wires
            theta = _falling(sign * (s - mid), wire)
            if theta is None:
                continue
            # Ring edges just either side of the wire (not on it: wires shine).
            sides = []
            for side, colour in ((-1, sign), (1, -sign)):
                cols = np.round((theta + side * np.arange(1.5, 5.0, TH_STEP)) / TH_STEP).astype(int) % len(THETAS)
                e = _edges(colour * (u[:, cols].mean(1) - mid), radii, r_in, r_out)
                if e:
                    sides.append(e)
            if not sides:
                continue
            # The wires along a ring's edges hide a little of the colour on
            # both sides alike, so the middle of the band is what to trust.
            found.append(board.polar(theta, float(np.mean(sides))))
            truth.append(board.polar(wire, (r_in + r_out) / 2))
    if not found:
        return np.empty((0, 2)), np.empty((0, 2))
    return _apply(H_inv, found), np.array(truth)


def _band_edges(chan, H):
    """Step 6: the inner and outer edges of the treble and double rings, a few
    times in every coloured block (clear of the wires between blocks), as
    (picture px, where that edge is on a real board)."""
    H_inv = np.linalg.inv(H)
    found, truth = [], []
    for r_in, r_out in ((board.R_TRIPLE_IN, board.R_TRIPLE_OUT), (board.R_DOUBLE_IN, board.R_DOUBLE_OUT)):
        radii = np.arange(r_in - PAD, r_out + PAD + 1e-6, R_STEP)
        u = _unroll(chan, H_inv, radii)
        for i in range(20):
            for off in (-5.0, -2.5, 2.5, 5.0):
                theta = 18 * i + off
                cols = np.round((theta + np.arange(-1, 1, TH_STEP)) / TH_STEP).astype(int) % len(THETAS)
                p = u[:, cols].mean(1)
                e = _edges(p, radii, r_in, r_out) or _edges(-p, radii, r_in, r_out)  # red block, or green
                if e:
                    found += [board.polar(theta, e[0]), board.polar(theta, e[1])]
                    truth += [board.polar(theta, r_in), board.polar(theta, r_out)]
    if len(found) < 4:
        return np.empty((0, 2)), np.empty((0, 2))
    return _apply(H_inv, found), np.array(truth)


def _edge_misfit(img, H) -> float:
    """How far (px, root mean square) the coloured rings' edges are from the
    best flat board through them. Low when the lens's bend is taken out."""
    chan = _lab_a(img)
    px, mm = _band_edges(chan, H)
    if len(px) < 40:
        return float("inf")
    H_inv, _ = cv2.findHomography(mm, px, 0)
    if H_inv is None:
        return float("inf")
    return float(np.sqrt(np.mean(np.sum((_apply(H_inv, mm) - px) ** 2, axis=1))))


def detect(img, twenty_px=None, number: int = 20) -> Result:
    """Calibrate from one picture (BGR, as OpenCV reads it) of the empty board.

    `twenty_px` is any pixel (x, y) inside the 20 segment: it says which way up
    the board is. Or inside the segment `number`, for a camera that can't see
    the 20 (a board whose number ring hides the top numbers from below). Left
    out, the 20 is taken to be straight up the picture from the bull. Raises Failed, with a message for the user, rather than return a
    calibration it can't trust."""
    size = (img.shape[1], img.shape[0])
    tried = {}  # bend -> (edge misfit, Result) or the reason it failed

    def attempt(k):
        k = round(float(k), 3)
        if k not in tried:
            straight = img if not k else cv2.remap(img, *calib.straighten_maps(k, size), cv2.INTER_LINEAR,
                                                   borderMode=cv2.BORDER_CONSTANT)
            try:
                res = _flat(straight, None if twenty_px is None else calib.straighten([twenty_px], k, size)[0], number)
                res.lens, res.size = k, size
                tried[k] = (_edge_misfit(straight, res.H), res)
            except Failed as e:
                tried[k] = e
        return tried[k]

    for k in LENSES:
        attempt(k)
    good = {k: t for k, t in tried.items() if not isinstance(t, Failed)}
    if not good:
        raise tried[0.0]
    best = min(good, key=lambda k: good[k][0])
    for k in (best - LENS_STEP, best + LENS_STEP):
        attempt(k)
    good = {k: t for k, t in tried.items() if not isinstance(t, Failed)}
    return good[min(good, key=lambda k: good[k][0])][1]


def _flat(img, twenty_px, number: int = 20) -> Result:
    """Steps 1-5, taking the picture's lens to be perfect."""
    chan = _lab_a(img)
    H = _coarse(img, chan)
    double = np.arange(board.R_DOUBLE_IN + 1, board.R_DOUBLE_OUT - 1, 1.0)
    H = _rot(_pattern(chan, H, double)[1]) @ H

    best = None  # (joins that agree, -error, H): the fit can wobble, keep the best
    for _ in range(6):
        px, mm = _joins(chan, H)
        if len(px) < MIN_JOINS:
            break
        # Fit board -> picture, so the errors being minimised are in pixels:
        # that is what was measured, and it stops the far side of the board
        # (few pixels per mm) from being trusted as much as the near side.
        H_inv, used = cv2.findHomography(mm, px, cv2.RANSAC, RANSAC_PX)
        if H_inv is None:
            break
        H = np.linalg.inv(H_inv)
        used = used.ravel().astype(bool)
        rms = float(np.sqrt(np.mean(np.sum((_apply(H_inv, mm[used]) - px[used]) ** 2, axis=1))))
        if best is None or (int(used.sum()), -rms) > best[:2]:
            best = (int(used.sum()), -rms, H)
    if best is None:
        raise Failed("Found the board but too few of the joins between red and green. Check it is empty, "
                     "evenly lit and fully in view.")
    inliers, rms, H = best[0], -best[1], best[2]
    if inliers < MIN_JOINS or rms > MAX_RMS_PX:
        raise Failed(f"The fit wasn't good enough to trust ({inliers}/40 joins, {rms:.1f} px off). Calibrate by tapping instead.")

    if twenty_px is None:
        # No tap: the 20 is whichever way is straight up the picture from the bull.
        bull = _apply(np.linalg.inv(H), [[0.0, 0.0]])[0]
        x, y = _apply(H, [bull + (0.0, -1.0)])[0]
    else:
        x, y = _apply(H, [twenty_px])[0]
        if np.hypot(x, y) > board.R_DOUBLE_OUT:
            raise Failed(f"That tap wasn't on the board. Tap anywhere inside the {number} segment.")
    # The tap's angle (clockwise from the top, as board.polar), back round to the 20.
    turn = 36 * round((np.degrees(np.arctan2(x, y)) - 18 * board.SEGMENTS.index(number)) / 36)
    H = _rot(turn) @ H
    points = _apply(np.linalg.inv(H), [p["xy"] for p in board.CALIBRATION_POINTS]).tolist()
    return Result(H=H, points=points, joins=inliers, rms_px=rms)


# ---------- looking at what it did, and using it by itself ----------
UNROLL_PX_PER_DEG, UNROLL_PX_PER_MM, UNROLL_MM = 3, 2, 190.0


def explain(img, found: Result | None = None) -> dict:
    """Pictures of what detect() made of `img`, by name: to see how it works,
    and to see why when it fails or gets a board wrong.

      colours   what counted as red or green (the rest is greyed out), and in
                yellow the outlines tried as the outside of the double ring
    and, given the Result:
      joins     the joins between red and green blocks: a cross where the
                result says each one is, a dot where it was measured (green if
                they agree, red if that join was left out of the fit)
      unrolled  the board unrolled through the result, the 20 first: angle
                across, the bull at the bottom. Right, every ring is a straight
                band under its line and every wire stands upright under its own
      overlay   the wires and numbers drawn on the picture
    """
    grey = cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    mask = _colour_mask(img)
    colours = np.where(mask[..., None] > 0, img, grey // 3 + 30)
    for hull in _outlines(img, mask):
        cv2.ellipse(colours, cv2.fitEllipse(hull), (0, 255, 255), 2, cv2.LINE_AA)
    out = {"colours": colours}
    if found is None:
        return out
    view = found.view()

    # The joins are measured in the picture with the lens's bend taken out, as detect() did.
    straight = img if not found.lens else cv2.remap(img, *calib.straighten_maps(found.lens, found.size),
                                                    cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    px, mm = _joins(_lab_a(straight), found.H)
    joins = img.copy()
    if len(px):
        agree = np.linalg.norm(px - _apply(np.linalg.inv(found.H), mm), axis=1) <= RANSAC_PX
        for (ex, ey), (fx, fy), ok in zip(view.to_picture(mm), view.bend(px), agree):
            cv2.drawMarker(joins, (int(round(ex)), int(round(ey))), (255, 255, 255), cv2.MARKER_CROSS, 13, 1, cv2.LINE_AA)
            cv2.circle(joins, (int(round(fx)), int(round(fy))), 3, (0, 255, 0) if ok else (0, 0, 255), -1, cv2.LINE_AA)
    out["joins"] = joins

    thetas = np.arange(-9, 351, 1 / UNROLL_PX_PER_DEG)
    radii = np.arange(UNROLL_MM, 0, -1 / UNROLL_PX_PER_MM)
    a = np.radians(thetas)
    grid = np.stack([np.outer(radii, np.sin(a)), np.outer(radii, np.cos(a))], -1).reshape(-1, 2)
    at = view.to_picture(grid).reshape(len(radii), len(thetas), 2).astype(np.float32)
    flat = cv2.remap(img, at[..., 0], at[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    lines = flat.copy()
    for r in (board.R_OUTER_BULL, board.R_TRIPLE_IN, board.R_TRIPLE_OUT, board.R_DOUBLE_IN, board.R_DOUBLE_OUT):
        y = int(round((UNROLL_MM - r) * UNROLL_PX_PER_MM))
        cv2.line(lines, (0, y), (lines.shape[1], y), (0, 255, 0), 1)
    for i in range(1, 20):
        cv2.line(lines, (i * 18 * UNROLL_PX_PER_DEG, 0), (i * 18 * UNROLL_PX_PER_DEG, lines.shape[0]), (0, 255, 0), 1)
    flat = cv2.addWeighted(flat, 0.5, lines, 0.5, 0)
    head = np.zeros((26, flat.shape[1], 3), np.uint8)
    for i, seg in enumerate(board.SEGMENTS):
        (w, _), _ = cv2.getTextSize(str(seg), cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.putText(head, str(seg), ((i * 18 + 9) * UNROLL_PX_PER_DEG - w // 2, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                    (0, 255, 0), 1, cv2.LINE_AA)
    out["unrolled"] = np.vstack([head, flat])

    out["overlay"] = calib.draw_board(img.copy(), view, numbers=True)
    return out


def _picture(source: str, size: tuple[int, int]) -> np.ndarray:
    """The picture to look at: a file, or one frame from a camera number or a stream address."""
    if Path(source).is_file():
        img = calib.read_picture(source)
        if img is None:
            raise SystemExit(f"{source} isn't a picture OpenCV can read.")
        return img
    if not source.isdigit() and "://" not in source:
        raise SystemExit(f"There is no file called {source}. Give a picture, a camera number or a stream address.")
    from . import cameras  # only needed here: finding a board in a picture needs no camera code
    cam = cameras.Camera(0, int(source) if source.isdigit() else source, *size, 15)
    try:
        deadline = time.time() + 10
        while not cam.ok and time.time() < deadline:
            time.sleep(0.1)
        if not cam.ok:
            raise SystemExit(f"No picture came from {'camera ' + source if source.isdigit() else source}.")
        time.sleep(1.5)  # let it settle on its exposure: the first frames are often dark
        return cam.frame.copy()
    finally:
        cam.stop()
        cam.join()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m server.autocalib",
        description="Find the dartboard in a picture and say where it is. The board must be empty, "
                    "evenly lit and wholly in the picture.")
    ap.add_argument("source", help="a picture file, a camera number (0, 1, ...) or a stream address (http://..., rtsp://...). "
                                   f"A picture file more than {BIGGEST} px across is looked at in a smaller copy; the answer "
                                   "is still in the picture's own pixels")
    ap.add_argument("--twenty", metavar="X,Y", help="a pixel anywhere inside the 20 segment, to say which way up the board "
                                                    "is. Without it the 20 is taken to be at the top of the picture.")
    ap.add_argument("--out", metavar="FILE", help="save the picture with the board's wires and numbers drawn on it")
    ap.add_argument("--debug", metavar="FOLDER", help="save a picture of each step there, no more than the same size across (see explain() in this file)")
    ap.add_argument("--json", action="store_true", help="print the calibration as JSON instead of in words")
    ap.add_argument("--size", metavar="WxH", default="1280x720", help="for a camera: the picture size to ask it for (default %(default)s)")
    args = ap.parse_args(argv)
    try:
        twenty = tuple(float(v) for v in args.twenty.split(",")) if args.twenty is not None else None
        size = tuple(int(v) for v in args.size.lower().split("x"))
        if (twenty is not None and len(twenty) != 2) or len(size) != 2:
            raise ValueError
    except ValueError:
        ap.error("--twenty is two numbers, such as 640,120, and --size is like 1280x720")
    # Found out now, not after the board has been looked for.
    if args.out is not None and (not cv2.haveImageWriter(args.out) or Path(args.out).is_dir()):
        ap.error(f"--out is a picture file to save, such as found.jpg, not {args.out or 'nothing'}")
    if args.debug is not None and (not args.debug or Path(args.debug).is_file()):
        ap.error(f"--debug is a folder to save pictures in, not {args.debug or 'nothing'}")
    img = _picture(args.source, size)

    # A phone's photo is many times a camera's picture: finding the board in it
    # as it is takes gigabytes, and the limits above are in a camera's pixels.
    # So it is found in a smaller copy and the answer put back in the picture's own pixels.
    work, up = img, np.ones(2)
    if Path(args.source).is_file() and max(img.shape[:2]) > BIGGEST:
        s = BIGGEST / max(img.shape[:2])
        work = cv2.resize(img, (round(img.shape[1] * s), round(img.shape[0] * s)), interpolation=cv2.INTER_AREA)
        up = np.array([img.shape[1] / work.shape[1], img.shape[0] / work.shape[0]])

    def save(name, picture, params=()):
        try:
            Path(name).parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass  # the write below fails too, and says so
        if not calib.write_picture(name, picture, params):
            raise SystemExit(f"Couldn't save {name}.")

    def save_steps(pictures):
        for n, (name, picture) in enumerate(pictures.items(), 1):
            save(Path(args.debug) / f"{n}-{name}.jpg", picture, [cv2.IMWRITE_JPEG_QUALITY, 90])

    try:
        small = detect(work, None if twenty is None else tuple(np.array(twenty) / up))
    except Failed as e:
        print(e, file=sys.stderr)
        if args.debug is not None:
            save_steps(explain(work))
            print(f"{Path(args.debug) / '1-colours.jpg'} shows what was taken for the red and green rings.", file=sys.stderr)
        return 1
    found = Result(small.H @ np.diag([1 / up[0], 1 / up[1], 1.0]), (np.array(small.points) * up).tolist(), small.joins,
                   small.rms_px * float(up.max()), small.lens, (img.shape[1], img.shape[0]))

    # The answer first: a picture that can't be saved doesn't lose it.
    turned = ("The 20 was taken to be at the top of the picture. If the numbers come out turned round, "
              "say where it is with --twenty X,Y.")
    if args.json:
        # "points", "lens" and "size" are what config.json keeps under "calibration" for a camera.
        print(json.dumps({**found.saved(), "joins": found.joins, "rms_px": round(found.rms_px, 3),
                          "homography": found.H.tolist()}, indent=2), flush=True)
        if twenty is None:
            print(turned, file=sys.stderr)
    else:
        bull = found.view().to_picture([[0.0, 0.0]])[0]
        print(f"Board found: {found.joins} of 40 joins agree, within {found.rms_px:.2f} px. Lens bend {found.lens:+.2f}.")
        print(f"The bull is at ({bull[0]:.1f}, {bull[1]:.1f}) in the picture.")
        if twenty is None:
            print(turned)
    if args.debug is not None:
        save_steps(explain(work, small))
    if args.out is not None:
        save(args.out, calib.draw_board(img.copy(), found.view(), numbers=True))
    if not args.json:
        for where in (args.out, args.debug):
            if where:
                print(f"Saved {where}")
        if not (args.out or args.debug):
            print("Add --out FILE to see it drawn on the picture, or --json for the numbers.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
