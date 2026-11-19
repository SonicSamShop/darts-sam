"""Test automatic calibration against simulated cameras.

Renders the board (with wires, blur, uneven light and noise) as cameras in
different positions would see it, auto-calibrates from the picture plus one
rough "tap" in the 20, and checks the result against the true geometry.

  python -m tests.test_calib
"""
import math

import cv2
import numpy as np

from server import autocalib, board, calib
from server.calib import homography
from tests.test_vision import H, K, W, bend, bend_point, board_texture, project

SCALE = 3.0


def wired_texture():
    """The test_vision board plus what a real one has: wires, a pale number
    ring outside the doubles, and a red surround."""
    tex, scale, c = board_texture(scale=SCALE, size=520)
    def px(xy):
        return (int(round(c + xy[0] * scale)), int(round(c - xy[1] * scale)))
    wire = (150, 150, 150)
    cv2.circle(tex, (c, c), int(200 * scale), (200, 200, 200), 2, cv2.LINE_AA)  # number ring
    yy, xx = np.mgrid[0:tex.shape[0], 0:tex.shape[1]]
    tex[np.hypot(xx - c, yy - c) > 226 * scale] = (45, 60, 215)  # a red surround, bigger than the board
    for r in (board.R_BULL, board.R_OUTER_BULL, board.R_TRIPLE_IN, board.R_TRIPLE_OUT,
              board.R_DOUBLE_IN, board.R_DOUBLE_OUT):
        cv2.circle(tex, (c, c), int(round(r * scale)), wire, 3, cv2.LINE_AA)
    for i in range(20):
        cv2.line(tex, px(board.polar(9 + 18 * i, board.R_OUTER_BULL)),
                 px(board.polar(9 + 18 * i, board.R_DOUBLE_OUT)), wire, 3, cv2.LINE_AA)
    return tex, scale, c


TEX, TEX_SCALE, TEX_C = wired_texture()


def camera(angle, radius, height, aim=(0.0, 0.0), roll=0.0):
    """Like test_vision.make_camera but can aim off the bull and be tilted."""
    cx, cy = board.polar(angle, radius)
    C = np.array([cx, cy, height])
    fwd = np.array([aim[0], aim[1], 0.0]) - C
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 0, 1.0]); right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    a = math.radians(roll)
    right, down = (math.cos(a) * right + math.sin(a) * down,
                   -math.sin(a) * right + math.cos(a) * down)
    R = np.vstack([right, down, fwd])
    return K @ np.hstack([R, (-R @ C).reshape(3, 1)])


def render(P, rng):
    Hp = P[:, [0, 1, 3]]
    tex_to_mm = np.array([[1 / TEX_SCALE, 0, -TEX_C / TEX_SCALE],
                          [0, -1 / TEX_SCALE, TEX_C / TEX_SCALE], [0, 0, 1]])
    img = cv2.warpPerspective(TEX, Hp @ tex_to_mm, (W, H), flags=cv2.INTER_AREA,
                              borderValue=(25, 25, 25)).astype(np.float32)
    img = cv2.GaussianBlur(img, (0, 0), 1.2)              # a lens that isn't perfectly sharp
    img *= np.linspace(0.75, 1.1, W, dtype=np.float32)[None, :, None]  # uneven light
    return np.clip(img + rng.normal(0, 3.0, img.shape), 0, 255).astype(np.uint8)


CAMERAS = {
    "ring 0":        dict(angle=0, radius=330, height=120),
    "ring 120":      dict(angle=120, radius=330, height=120),
    "ring 240":      dict(angle=240, radius=330, height=120),
    "low and close": dict(angle=75, radius=300, height=95, aim=(10, -15), roll=6),
    "off aim":       dict(angle=200, radius=340, height=140, aim=(-25, 20), roll=-9),
    "upside down":   dict(angle=310, radius=330, height=120, roll=180),
    "head on":       dict(angle=180, radius=60, height=420, roll=30),
}
CHECK = [board.polar(a, r) for a in range(0, 360, 15) for r in (0, 50, 103, 140, 166)]


def bent_lens(rng):
    """A wide webcam bends the picture. Calibration must find how much, and
    with that the double and treble wires must come out where they are."""
    for name, kw in (("bent ring 0", CAMERAS["ring 0"]), ("bent low", CAMERAS["low and close"]),
                     ("bent off aim", CAMERAS["off aim"])):
        P = camera(**kw)
        k = 0.5
        img = bend(render(P, rng), k)
        tap = bend_point(project(P, np.array([*board.polar(5, 60), 0.0])), k)
        res = autocalib.detect(img, tap)
        view = calib.view(res.saved())  # what the server rebuilds from config.json
        true_px = np.array([bend_point(project(P, np.array([x, y, 0.0])), k) for x, y in CHECK])
        err = np.linalg.norm(view.to_board(true_px) - np.array(CHECK), axis=1)
        flat = np.linalg.norm(autocalib._apply(homography(res.points), true_px) - np.array(CHECK), axis=1)
        print(f"{name:14s} lens {res.lens:+.2f} (true {k})  joins {res.joins}/40  error mean {err.mean():.2f} "
              f"max {err.max():.2f} mm   (ignoring the bend: max {flat.max():.1f})")
        assert abs(res.lens - k) < 0.15, f"{name}: lens found as {res.lens:.2f}, really {k}"
        assert err.max() < 1.0, f"{name}: calibration through a bent lens is {err.max():.1f} mm out"
        # back the other way: board to picture
        back = view.to_picture(np.array(CHECK))
        assert np.abs(back - true_px).max() < 1.0


def main(seed=3):
    rng = np.random.default_rng(seed)
    auto, tapped = [], []
    for name, kw in CAMERAS.items():
        P = camera(**kw)
        img = render(P, rng)
        # a careless tap: somewhere in the 20, not in the middle of it
        tap = project(P, np.array([*board.polar(5, 60), 0.0]))
        res = autocalib.detect(img, tap)
        view = calib.view(res.saved())  # what the server rebuilds from config.json
        true_px = np.array([project(P, np.array([x, y, 0.0])) for x, y in CHECK])
        err = np.linalg.norm(view.to_board(true_px) - np.array(CHECK), axis=1)
        assert abs(res.lens) < 0.15, f"{name}: a straight lens was found to bend ({res.lens:.2f})"
        # For comparison: four taps that are each a couple of pixels out.
        taps = [project(P, np.array([*p["xy"], 0.0])) + rng.normal(0, 2.0, 2) for p in board.CALIBRATION_POINTS]
        tap_err = np.linalg.norm(autocalib._apply(homography(taps), true_px) - np.array(CHECK), axis=1)
        tapped.append(tap_err.mean())
        auto.append(err.mean())
        print(f"{name:14s} joins {res.joins}/40  fit {res.rms_px:.2f} px  "
              f"error mean {err.mean():.2f} max {err.max():.2f} mm   (4 taps: mean {tap_err.mean():.2f} max {tap_err.max():.2f})")
    assert max(auto) < 0.6, "auto-calibration is too far out"
    bent_lens(rng)

    # A picture with no board in it must be refused, not guessed at.
    try:
        autocalib.detect(np.full((H, W, 3), 60, np.uint8), (W / 2, H / 2))
    except autocalib.Failed:
        pass
    else:
        raise AssertionError("calibrated from a blank picture")
    print("OK")


if __name__ == "__main__":
    main()
