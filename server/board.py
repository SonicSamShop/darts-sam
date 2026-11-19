# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Dartboard geometry and scoring.

Board coordinates are millimetres, origin at the bull, +x right, +y up
(as you look at the board). Everything else in the server converts to this.
"""
import math

SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]

R_BULL = 6.35       # inner bull (50)
R_OUTER_BULL = 15.9  # outer bull (25)
R_TRIPLE_IN = 99.0
R_TRIPLE_OUT = 107.0
R_DOUBLE_IN = 162.0
R_DOUBLE_OUT = 170.0


def score(x: float, y: float) -> dict:
    """Return {'seg': 0-20 or 25, 'mult': 0-3} for a point on the board.

    mult 0 means a miss (outside the double ring). Bullseye is seg 25 mult 2.
    """
    r = math.hypot(x, y)
    if r <= R_BULL:
        return {"seg": 25, "mult": 2}
    if r <= R_OUTER_BULL:
        return {"seg": 25, "mult": 1}
    if r > R_DOUBLE_OUT:
        return {"seg": 0, "mult": 0}
    deg = math.degrees(math.atan2(x, y)) % 360  # clockwise from top
    seg = SEGMENTS[int(((deg + 9) % 360) // 18)]
    if R_TRIPLE_IN <= r <= R_TRIPLE_OUT:
        mult = 3
    elif r >= R_DOUBLE_IN:
        mult = 2
    else:
        mult = 1
    return {"seg": seg, "mult": mult}


def polar(deg_clockwise_from_top: float, r: float) -> tuple[float, float]:
    a = math.radians(deg_clockwise_from_top)
    return (r * math.sin(a), r * math.cos(a))


# The four points you tap during calibration: where the OUTER double wire
# meets the wire between two segments. Chosen roughly 90 degrees apart.
CALIBRATION_POINTS = [
    {"label": "20 | 1", "xy": polar(9, R_DOUBLE_OUT)},
    {"label": "6 | 10", "xy": polar(99, R_DOUBLE_OUT)},
    {"label": "3 | 19", "xy": polar(189, R_DOUBLE_OUT)},
    {"label": "11 | 14", "xy": polar(279, R_DOUBLE_OUT)},
]
