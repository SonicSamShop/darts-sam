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

import cv2
import numpy as np

from . import board


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
