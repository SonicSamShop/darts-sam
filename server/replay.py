# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Run today's detection over saved problem reports (see report.py).

  python -m server.replay                       # every report in data/reports
  python -m server.replay data/reports/2026-11-15_20-40-12

For each look in a report it finds the dart again from the saved before and
after pictures and prints what was scored then, what the code scores now and
what the player said it should have been. Change detect.py, run this, and see
whether the reported darts come out right without breaking the others.

It redoes finding and placing a dart. Deciding between a new dart and darts
being pulled out depends on what went before, and is not replayed.
"""
import json
import sys
from pathlib import Path

import cv2

from . import board, detect, report
from . import calib


def replay(folder: Path) -> None:
    rep = json.loads((folder / "report.json").read_text())
    H = {c: calib.view(p) for c, p in rep["calibration"].items() if p}
    print(f"\n{rep['id']}   should have been: {rep['expected'] or '?'}   {rep['note']}")
    for look in rep["looks"]:
        lines, seen = [], []
        for cam, c in look["cameras"].items():
            before, after = (cv2.imread(str(folder / c[k])) for k in ("before", "after"))
            s = detect.find_dart(detect.diff_mask(before, after), H[cam])
            if s is not None:
                lines.append(s)
                seen.append(f"cam {int(cam) + 1} {report.label(board.score(*s.tip))}")
        if len(look["cameras"]) >= 2 and len(lines) < 2:
            now = "one camera only" if lines else "no dart"
        else:
            found = detect.locate(lines)
            now = "no position" if found is None else \
                f"{report.label(board.score(*found[0]))} ({found[0][0]:.1f}, {found[0][1]:.1f}) conf {found[1]}"
        then = look["outcome"] or "undecided"
        if look["event"]:
            e = look["event"]
            then = f"{report.label(e)} ({e['x']}, {e['y']}) conf {e['confidence']}"
        print(f"  look {look['n']}: then {then:34} now {now:34} [{', '.join(seen) or 'no camera saw a dart'}]")


def main():
    folders = [Path(a) for a in sys.argv[1:]] or sorted(p.parent for p in report.DIR.glob("*/report.json"))
    if not folders:
        print("No reports yet. Tap Report in a game when a dart is scored wrongly.")
    for f in folders:
        replay(f)


if __name__ == "__main__":
    main()
