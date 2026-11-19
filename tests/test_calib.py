# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Test automatic calibration against simulated cameras.

Renders the board (with wires, blur, uneven light and noise) as cameras in
different positions would see it, auto-calibrates from the picture plus one
rough "tap" in the 20, and checks the result against the true geometry.

  python -m tests.test_calib
"""
import contextlib
import io
import json
import math
import tempfile
from pathlib import Path

import cv2
import numpy as np

from server import autocalib, board, calib
from server.calib import homography
from tests.test_vision import H, K, W, bend, bend_point, board_texture, project

SCALE = 3.0
REAL = Path(__file__).resolve().parent.parent / "docs" / "img" / "calibration" / "real.jpg"


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


def no_tap(rng):
    """With no tap, the 20 is taken to be straight up the picture from the
    bull: right for a camera the right way up in front of the board, tilted a
    little or not. And it always gives an answer, however steep the view."""
    for name, kw in (("in front", dict(angle=180, radius=60, height=420)),
                     ("in front, tilted", dict(angle=180, radius=60, height=420, roll=12)),
                     ("in front, off to one side", dict(angle=120, radius=150, height=420, roll=50))):
        P = camera(**kw)
        res = autocalib.detect(render(P, rng))
        true_px = np.array([project(P, np.array([x, y, 0.0])) for x, y in CHECK])
        err = np.linalg.norm(res.view().to_board(true_px) - np.array(CHECK), axis=1)
        print(f"{name:26s} no tap: joins {res.joins}/40  error max {err.max():.2f} mm")
        assert err.max() < 0.6, f"{name}: with no tap the board came out {err.max():.0f} mm out (turned round?)"
    # From the light ring the board is seen from the side and "up" is not the 20,
    # so the answer may be turned, but only ever by whole red blocks.
    P = camera(**CAMERAS["ring 120"])
    img = render(P, rng)
    turned, tapped = autocalib.detect(img), autocalib.detect(img, project(P, np.array([*board.polar(5, 60), 0.0])))
    mm = turned.view().to_board(tapped.view().to_picture(CHECK))
    turn = np.degrees(np.arctan2(mm[1][0], mm[1][1]) - np.arctan2(CHECK[1][0], CHECK[1][1])) % 36
    assert min(turn, 36 - turn) < 0.5, f"with no tap the board was turned by something other than whole blocks ({turn:.1f})"


def by_itself(rng):
    """The parts for using it without the server: the Result's own view, the
    pictures that explain a result, and the command."""
    P, k = camera(**CAMERAS["low and close"]), 0.5
    img = bend(render(P, rng), k)
    tap = bend_point(project(P, np.array([*board.polar(5, 60), 0.0])), k)
    res = autocalib.detect(img, tap)
    # the Result's view is the one the server rebuilds from what it saves
    px = np.array([bend_point(project(P, np.array([x, y, 0.0])), k) for x, y in CHECK])
    assert np.abs(res.view().to_board(px) - calib.view(res.saved()).to_board(px)).max() < 0.05
    assert np.abs(res.view().to_picture(CHECK) - px).max() < 1.0

    # the board is drawn from a calibration in either shape it is saved in, as the app's Cameras screen does
    for saved in (res.saved(), res.points):
        assert (calib.draw_board(img.copy(), saved) != img).any()

    seen = autocalib.explain(img, res)
    assert list(seen) == ["colours", "joins", "unrolled", "overlay"]
    assert all(seen[n].shape == img.shape for n in ("colours", "joins", "overlay"))
    assert (seen["overlay"] != img).any() and (seen["joins"] != img).any()
    # unrolled through a good calibration, the double ring is a straight band: red or green all the way along
    rows = seen["unrolled"][26:]  # under the numbers
    y = int((autocalib.UNROLL_MM - (board.R_DOUBLE_IN + board.R_DOUBLE_OUT) / 2) * autocalib.UNROLL_PX_PER_MM)
    band = cv2.cvtColor(rows[y:y + 1], cv2.COLOR_BGR2HSV)[0]
    blocks = band[np.arange(len(band)) % (18 * autocalib.UNROLL_PX_PER_DEG) > 6]  # clear of the wires and their lines
    assert (blocks[:, 1] > 60).mean() > 0.9, "the unrolled double ring isn't a straight coloured band"
    assert list(autocalib.explain(np.full((H, W, 3), 60, np.uint8))) == ["colours"]  # nothing found: still a picture

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        cv2.imwrite(str(tmp / "board.png"), img)
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            code = autocalib.main([str(tmp / "board.png"), "--twenty", f"{tap[0]:.0f},{tap[1]:.0f}", "--json",
                                   "--out", str(tmp / "found.jpg"), "--debug", str(tmp / "steps")])
        out = json.loads(said.getvalue())
        assert code == 0 and out["joins"] == res.joins and out["lens"] == res.lens and out["size"] == [W, H]
        assert np.abs(np.array(out["points"]) - np.array(res.points)).max() < 0.05
        # what it printed is a calibration the server can use as it is
        assert np.abs(calib.view(out).to_board(px) - np.array(CHECK)).max() < 1.0
        assert cv2.imread(str(tmp / "found.jpg")).shape == img.shape
        assert sorted(f.name for f in (tmp / "steps").iterdir()) == ["1-colours.jpg", "2-joins.jpg", "3-unrolled.jpg", "4-overlay.jpg"]
        # a picture with no board in it: says why, and the first picture is still saved
        cv2.imwrite(str(tmp / "blank.png"), np.full((H, W, 3), 60, np.uint8))
        with contextlib.redirect_stderr(io.StringIO()) as why:
            assert autocalib.main([str(tmp / "blank.png"), "--debug", str(tmp / "blank")]) == 1
        assert "red and green rings" in why.getvalue() and (tmp / "blank" / "1-colours.jpg").is_file()


def real_picture():
    """A real camera's picture, as it came: a 720p webcam on a light ring,
    looking across a board with a red surround bigger than the board. There is
    no truth to measure against, but the board must be found, its bull must be
    the bull in the picture (looked up by eye: the middle of the red is at
    711, 247), and its numbers must be the ones printed round the real board."""
    img = cv2.imread(str(REAL))
    res = autocalib.detect(img, (530, 183))  # a pixel in the 20
    view = res.view()
    bull = view.to_picture([(0, 0)])[0]
    print(f"real picture   joins {res.joins}/40  fit {res.rms_px:.2f} px  lens {res.lens:+.2f}  "
          f"bull at ({bull[0]:.1f}, {bull[1]:.1f})")
    assert res.joins >= 34, f"only {res.joins} of the real board's 40 joins agreed"
    assert np.hypot(*(bull - (711, 247))) < 4, f"the real board's bull was put at {bull}, outside the bullseye"
    assert 0.4 <= res.lens <= 1.0, f"this camera's lens bends about 0.7, not {res.lens}"
    for px, seg in (((947, 326), 3), ((572, 424), 11), ((805, 128), 6), ((686, 119), 4)):
        assert board.score(*view.to_board([px])[0]) == {"seg": seg, "mult": 1}, f"{px} is in the {seg} on the real board"


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
    no_tap(rng)
    by_itself(rng)
    real_picture()

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
