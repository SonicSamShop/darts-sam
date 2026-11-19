# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Make the pictures in docs/calibration.md again, after a change to server/autocalib.py.

  python tools/calib_figures.py

The step-by-step pictures are of a simulated board (the one the tests draw,
seen from where a camera on the light ring sits, through a lens that bends the
picture), so anyone can make exactly these again. real.jpg is a real camera's
picture, kept as it came from a 720p webcam on a light ring; real-found.jpg and
real-unrolled.jpg are made from it. Everything drawn on any of them is what the
real code found: autocalib.detect() and autocalib.explain(). Written to
docs/img/calibration/.
"""
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server import autocalib, board, calib  # noqa: E402
from tests.test_calib import camera, render  # noqa: E402
from tests.test_vision import bend, bend_point, project  # noqa: E402

OUT = ROOT / "docs" / "img" / "calibration"
CAMERA = dict(angle=205, radius=215, height=215, aim=(0, -18), roll=-14)  # on the ring, lower left, a little askew
LENS = 0.5              # about what cheap wide webcams measure
TWENTY = (590, 204)     # the "tap": a pixel in the 20 (docs/calibration.md gives it to try the command with)
REAL_TWENTY = (530, 183)  # ...and the same for the real picture, real.jpg


def save(name: str, img) -> None:
    calib.write_picture(OUT / name, img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(f"  {(OUT / name).relative_to(ROOT)}  {img.shape[1]}x{img.shape[0]}")


def double_ring(img, found, words: str):
    """The double ring from explain()'s unrolled picture, three times as tall, with what it shows written above."""
    flat = autocalib.explain(img, found)["unrolled"]
    mm = lambda r: 26 + int((autocalib.UNROLL_MM - r) * autocalib.UNROLL_PX_PER_MM)  # 26: the row of numbers
    strip = flat[mm(182):mm(150)]
    strip = cv2.resize(strip, (strip.shape[1], strip.shape[0] * 3), interpolation=cv2.INTER_LINEAR)
    head = np.zeros((30, strip.shape[1], 3), np.uint8)
    cv2.putText(head, words, (8, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return np.vstack([head, strip])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    P = camera(**CAMERA)
    img = bend(render(P, np.random.default_rng(3)), LENS)
    # The 20 must be where the docs say it is, or their command would turn the board round.
    assert np.linalg.norm(bend_point(project(P, np.array([*board.polar(3, 130), 0.0])), LENS) - TWENTY) < 5

    save("sample.jpg", img)
    img = calib.read_picture(OUT / "sample.jpg")  # as anyone trying the command gets it
    found = autocalib.detect(img, TWENTY)
    print(f"  found: {found.joins}/40 joins, {found.rms_px:.2f} px, lens {found.lens:+.2f}")
    seen = autocalib.explain(img, found)
    save("found.jpg", seen["overlay"])
    save("colours.jpg", seen["colours"])
    save("joins.jpg", seen["joins"])
    save("unrolled.jpg", seen["unrolled"])

    # The same picture fitted as if the lens were perfect: the best a homography alone can do.
    flat = autocalib._flat(img, TWENTY)
    flat.size = found.size
    save("lens.jpg", np.vstack([
        double_ring(img, flat, "The double ring, fitted as if the lens were perfect: it wanders off its lines"),
        double_ring(img, found, f"With the lens's bend found ({found.lens:+.1f}) and taken out: it stays between them"),
    ]))

    # The real camera's picture. Thicker lines here: this one is shown small on the front page.
    real = calib.read_picture(OUT / "real.jpg")
    found = autocalib.detect(real, REAL_TWENTY)
    print(f"  real: {found.joins}/40 joins, {found.rms_px:.2f} px, lens {found.lens:+.2f}")
    save("real-found.jpg", calib.draw_board(real.copy(), found.view(), thickness=2, numbers=True))
    save("real-unrolled.jpg", autocalib.explain(real, found)["unrolled"])


if __name__ == "__main__":
    main()
