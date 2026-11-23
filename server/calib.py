# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Camera calibration: where the board is in a camera's picture.

A calibration is saved in config.json in one of two shapes:

  [[x, y], ...]                     four tapped image points (board.CALIBRATION_POINTS order)
  {"points": [[x, y], ...],         four points, as above, but in the picture
   "lens": k, "size": [w, h]}       with the lens's bend taken out (autocalib.py)

Wide webcams bend the picture: a point at distance r from the middle (r in
units of the picture's longer side) shows up at r * (1 + k r^2). A homography
alone can't follow that, so near the edges of the picture the board came out a
few mm wrong, which is just where the doubles are. A View takes the bend out
before the homography, and puts it back when going from the board to the picture.
"""
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import board


def read_picture(path):
    """cv2.imread for any file name; None if there is no picture there.

    On Windows OpenCV opens files by the computer's own code page, so it can't
    find one under C:\\Users\\Jörg. Python can: it reads the file, OpenCV only
    decodes it."""
    try:
        data = np.fromfile(str(path), np.uint8)
    except OSError:
        return None
    return cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None


def write_picture(path, img, params=()) -> bool:
    """cv2.imwrite for any file name (see read_picture). False if it couldn't
    be saved: a kind of file OpenCV can't write, or somewhere that can't be written to."""
    try:
        ok, data = cv2.imencode(Path(path).suffix, img, list(params))
        if ok:
            data.tofile(str(path))
        return bool(ok)
    except (cv2.error, OSError):
        return False


def homography(points) -> np.ndarray:
    src = np.array(points, dtype=np.float32)
    dst = np.array([p["xy"] for p in board.CALIBRATION_POINTS], dtype=np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def _scale(size):
    w, h = size
    return np.array([w / 2, h / 2]), float(max(w, h))


def straighten(px, k: float, size) -> np.ndarray:
    """Where pixels of a bent picture would be through a perfect lens."""
    px = np.asarray(px, np.float64).reshape(-1, 2)
    if not k:
        return px
    mid, f = _scale(size)
    d = (px - mid) / f
    u = d.copy()
    for _ in range(20):  # u (1 + k|u|^2) = d; converges quickly for the bends webcams have
        u = d / (1 + k * (u * u).sum(1, keepdims=True))
    return u * f + mid


def bend(px, k: float, size) -> np.ndarray:
    """Where pixels of a perfect picture show up in the bent one."""
    px = np.asarray(px, np.float64).reshape(-1, 2)
    if not k:
        return px
    mid, f = _scale(size)
    u = (px - mid) / f
    return u * (1 + k * (u * u).sum(1, keepdims=True)) * f + mid


def straighten_maps(k: float, size):
    """cv2.remap tables that straighten a whole picture of this size."""
    w, h = size
    xs, ys = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    src = bend(np.column_stack([xs.ravel(), ys.ravel()]), k, size)
    return src[:, 0].reshape(h, w).astype(np.float32), src[:, 1].reshape(h, w).astype(np.float32)


@dataclass
class View:
    """One camera's calibration: picture px <-> board mm."""
    H: np.ndarray          # straightened picture px -> board mm
    lens: float = 0.0      # k, see above; 0 for a perfect lens (or a tapped calibration)
    size: tuple = (1, 1)   # the picture's width and height, which k is measured against

    def straighten(self, px) -> np.ndarray:
        return straighten(px, self.lens, self.size)

    def bend(self, px) -> np.ndarray:
        return bend(px, self.lens, self.size)

    def to_board(self, px) -> np.ndarray:
        p = self.straighten(px).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(p, self.H).reshape(-1, 2)

    def to_picture(self, mm) -> np.ndarray:
        p = np.asarray(mm, np.float64).reshape(-1, 1, 2)
        return self.bend(cv2.perspectiveTransform(p, np.linalg.inv(self.H)).reshape(-1, 2))


def view(saved) -> View:
    """A View from a calibration as saved in config.json (either shape) or a
    bare homography matrix."""
    if isinstance(saved, View):
        return saved
    if isinstance(saved, np.ndarray):
        return View(saved)
    if isinstance(saved, dict):
        return View(homography(saved["points"]), float(saved.get("lens") or 0.0),
                    tuple(saved.get("size") or (1, 1)))
    return View(homography(saved))


def rescale(saved, old, new):
    """A calibration as saved, moved from pictures `old` [w, h] in size to
    `new`. A tapped one has no size of its own: it was made at `old`."""
    sx, sy = new[0] / old[0], new[1] / old[1]
    if isinstance(saved, dict):
        was = saved.get("size") or old
        sx, sy = new[0] / was[0], new[1] / was[1]
        return {**saved, "points": [[x * sx, y * sy] for x, y in saved["points"]], "size": list(new)}
    return [[x * sx, y * sy] for x, y in saved]


def draw_board(img, saved, colour=(0, 255, 0), thickness=1, numbers=False):
    """Draw the board's wires on a camera's picture where this calibration
    (anything view() takes) says they are. If the lines sit on the real wires,
    the calibration is good. The 20 is marked, so a calibration that is turned
    round can be spotted; `numbers` marks every segment."""
    v = view(saved)

    def project(xy):
        return np.round(v.to_picture(xy)).reshape(-1, 1, 2).astype(np.int32)
    ang = np.radians(np.arange(0, 361, 3))
    for r in (board.R_BULL, board.R_OUTER_BULL, board.R_TRIPLE_IN, board.R_TRIPLE_OUT,
              board.R_DOUBLE_IN, board.R_DOUBLE_OUT):
        ring = np.column_stack([r * np.sin(ang), r * np.cos(ang)])
        cv2.polylines(img, [project(ring)], False, colour, thickness, cv2.LINE_AA)
    for i in range(20):
        a, b = board.polar(9 + 18 * i, board.R_OUTER_BULL), board.polar(9 + 18 * i, board.R_DOUBLE_OUT)
        cv2.polylines(img, [project([a, b])], False, colour, thickness, cv2.LINE_AA)
    for i, seg in enumerate(board.SEGMENTS if numbers else board.SEGMENTS[:1]):
        text, bold = str(seg), 2 if i == 0 else 1
        (w, h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, bold)
        x, y = project([board.polar(18 * i, 135)])[0][0]
        cv2.putText(img, text, (int(x) - w // 2, int(y) + h // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, colour, bold, cv2.LINE_AA)
    return img
