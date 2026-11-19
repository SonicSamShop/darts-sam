# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Problem reports: what the cameras saw when a dart was scored wrongly.

The app's Report button (in a game) asks for one. It is a folder,
data/reports/<date_time>/, holding:

  report.json     what was decided and why, camera by camera, plus what the
                  app showed and what the player says really happened
  frame-NN.png    the cameras' pictures, untouched, so detection can be run
                  on them again (python -m server.replay)
  *-mask.png      what had changed between the before and after pictures
  *-seen.jpg      the after picture marked up: changes in red, the board as
                  the calibration has it in green, the dart's line in yellow,
                  that camera's tip in cyan and the scored position in magenta

It covers the tracker's last few "looks" (each time something on the board
had changed and gone still, see tracker.py) and the board as it is now.
"""
import json
import re
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from . import board, calib, detect, paths, tracker as tracking

DIR = paths.HOME / "data" / "reports"
SAFE_ID = re.compile(r"^[\w-]+$")
SAFE_FILE = re.compile(r"^[\w-]+\.(png|jpg|json)$")

OUTCOMES = {
    "takeout": "darts pulled out",
    "removed": "one dart gone (fell out or pulled)",
    "one camera only": "ignored, only one camera saw a dart",
    "no position": "ignored, the cameras' lines gave no position",
    "nothing new": "ignored, the pictures changed but nothing was added to the board",
    "tips disagree": "ignored, the cameras' lines crossed far from where any of them saw a tip",
    "too much changed": "ignored, too much of the picture changed (a hand, a body or the lights)",
    "nothing dart-shaped": "something changed but no camera saw a dart in it",
}


def label(d) -> str:
    if not d["mult"]:
        return "Miss"
    if d["seg"] == 25:
        return "Bull" if d["mult"] == 2 else "25"
    return ("", "D", "T")[d["mult"] - 1] + str(d["seg"])


def _nums(v, places=1) -> list:
    return [round(float(x), places) for x in np.asarray(v).ravel()]


def annotate(after, mask, sighting, H, event=None):
    """The after picture with what detection made of it drawn on."""
    img = after.copy()
    changed = mask > 0
    img[changed] = (0.45 * img[changed] + 0.55 * np.array([0, 0, 255])).astype(np.uint8)
    view = calib.view(H)
    calib.draw_board(img, view)
    if sighting is not None and sighting.ends_px is not None:
        a, b = (tuple(int(v) for v in p) for p in sighting.ends_px)
        cv2.line(img, a, b, (0, 255, 255), 2, cv2.LINE_AA)
        cv2.circle(img, tuple(int(v) for v in sighting.tip_px), 8, (255, 255, 0), 2, cv2.LINE_AA)
    if event:
        x, y = view.to_picture([[event["x"], event["y"]]])[0]
        if 0 <= x < img.shape[1] and 0 <= y < img.shape[0]:
            cv2.drawMarker(img, (int(x), int(y)), (255, 0, 255), cv2.MARKER_CROSS, 26, 2, cv2.LINE_AA)
            cv2.putText(img, label(event), (int(x) + 14, int(y) - 12),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 255), 2, cv2.LINE_AA)
    return img


def snapshot(tracker, frames: dict) -> dict:
    """Everything a report needs, taken while the vision loop is held (the
    caller has the lock). Quick: nothing is copied or written here."""
    return {"looks": list(tracker.history), "ref": tracker.ref, "empty": tracker.empty,
            "now": dict(frames), "H": dict(tracker.H),
            "state": {"darts": tracker.darts, "still_frames": tracker.stable,
                      "area_vs_empty": tracker.area_vs_empty}}


def _sighting(s, event) -> dict:
    out = {"area_px": s.area, "tip_mm": _nums(s.tip), "tip_scores": label(board.score(*s.tip)),
           "line_point_mm": _nums(s.point), "line_direction": _nums(s.direction, 4),
           "ends_px": [_nums(p) for p in s.ends_px], "tip_px": _nums(s.tip_px)}
    if event:
        # How far this camera's own idea is from what was scored.
        at = np.array([event["x"], event["y"]])
        out["tip_from_scored_mm"] = round(float(np.linalg.norm(s.tip - at)), 1)
        off = at - s.point
        out["line_from_scored_mm"] = round(float(abs(s.direction[0] * off[1] - s.direction[1] * off[0])), 1)
    return out


def _camera(folder, tag, cam, before, after, mask, sighting, H, event, frame_file) -> tuple[dict, str]:
    """Write one camera's pictures; return its report entry and a line for the summary."""
    calib.write_picture(folder / f"{tag}-mask.png", mask)
    calib.write_picture(folder / f"{tag}-seen.jpg", annotate(after, mask, sighting, H, event),
                        [cv2.IMWRITE_JPEG_QUALITY, 85])
    px = int(cv2.countNonZero(mask))
    entry = {"before": frame_file(before), "after": frame_file(after),
             "mask": f"{tag}-mask.png", "seen": f"{tag}-seen.jpg",
             "changed_px": px, "changed_fraction": round(detect.changed_fraction(mask), 5),
             "sighting": _sighting(sighting, event) if sighting is not None else None}
    if sighting is None:
        line = f"Camera {cam + 1}: no dart seen ({px} px changed)"
    else:
        s = entry["sighting"]
        line = f"Camera {cam + 1}: dart seen, its tip in {s['tip_scores']} ({s['area_px']} px)"
        if event and s["tip_from_scored_mm"] > 15:
            line += f", {s['tip_from_scored_mm']:.0f} mm from what was scored"
    return entry, line


def _ago(seconds: float) -> str:
    return f"{seconds:.0f} s ago" if seconds < 90 else f"{seconds / 60:.0f} min ago"


def save(snap: dict, calibration: dict, app=None, root: Path | None = None) -> dict:
    """Write a report folder from a snapshot() and return the report."""
    root = root or DIR
    now = datetime.now()
    rid = now.strftime("%Y-%m-%d_%H-%M-%S")
    n = 1
    while (root / rid).exists():
        n += 1
        rid = f"{now:%Y-%m-%d_%H-%M-%S}-{n}"
    folder = root / rid
    folder.mkdir(parents=True)

    # The same picture turns up more than once (one look's "after" is the
    # next one's "before"): each is written once.
    names = {}

    def frame_file(img):
        if id(img) not in names:
            names[id(img)] = f"frame-{len(names) + 1:02d}.png"
            calib.write_picture(folder / names[id(img)], img, [cv2.IMWRITE_PNG_COMPRESSION, 1])
        return names[id(img)]

    H = snap["H"]
    looks = []
    for i, look in enumerate(snap["looks"], 1):
        event = look["event"]
        if look["outcome"] == "dart":
            what = (f"scored {label(event)} at ({event['x']}, {event['y']}) mm from "
                    f"{event['cameras']} camera{'s' if event['cameras'] != 1 else ''}, "
                    f"confidence {event['confidence']}")
        else:
            what = OUTCOMES.get(look["outcome"], look["outcome"] or "undecided")
        cams, lines = {}, []
        for cam, mask in sorted(look["masks"].items()):
            if cam not in H:
                continue
            cams[str(cam)], line = _camera(
                folder, f"look{i}-cam{cam}", cam, look["before"][cam], look["after"][cam], mask,
                look["sightings"].get(cam), H[cam], event, frame_file)
            lines.append(line)
        looks.append({
            "n": i, "time": datetime.fromtimestamp(look["ts"]).isoformat(timespec="milliseconds"),
            "seconds_ago": round(now.timestamp() - look["ts"], 1), "outcome": look["outcome"],
            "event": event, "darts_on_board_before": look["darts"],
            "area_vs_empty": look.get("area"), "area_vs_empty_before": look.get("prev_area"),
            "summary": f"{_ago(now.timestamp() - look['ts']).capitalize()}: {what}.",
            "lines": lines, "cameras": cams,
        })

    # The board as it is now, against the picture detection is comparing with.
    cams, lines = {}, []
    for cam, frame in sorted(snap["now"].items()):
        if cam not in H or not snap["ref"] or cam not in snap["ref"]:
            continue
        mask = detect.diff_mask(snap["ref"][cam], frame)
        cams[str(cam)], line = _camera(
            folder, f"now-cam{cam}", cam, snap["ref"][cam], frame, mask,
            detect.find_dart(mask, H[cam]), H[cam], None, frame_file)
        cams[str(cam)]["empty"] = frame_file(snap["empty"][cam])
        lines.append(line)
    darts = snap["state"]["darts"]
    report = {
        "id": rid, "time": now.isoformat(timespec="seconds"),
        "expected": "", "note": "",   # filled in by the player afterwards
        "app": app,
        "tracker": snap["state"],
        "thresholds": {f"{m.__name__.split('.')[-1]}.{k}": v for m in (detect, tracking)
                       for k, v in vars(m).items() if k.isupper() and isinstance(v, (int, float))},
        "calibration": {str(c): calibration.get(str(c)) for c in H},
        "looks": looks,
        "now": {"summary": f"Now: {darts} dart{'s' if darts != 1 else ''} counted on the board. "
                           "Changes since the last look:",
                "lines": lines, "cameras": cams},
    }
    (folder / "report.json").write_text(json.dumps(report, indent=2))
    return report


def count(root: Path | None = None) -> int:
    """How many reports have been saved."""
    root = root or DIR
    return sum(1 for f in root.glob("*/report.json")) if root.is_dir() else 0


def path(rid: str, name: str = "report.json", root: Path | None = None) -> Path | None:
    """A report's file, or None if there is no such thing."""
    if not SAFE_ID.match(rid) or not SAFE_FILE.match(name):
        return None
    p = (root or DIR) / rid / name
    return p if p.is_file() else None


def annotate_report(rid: str, expected: str, note: str, root: Path | None = None) -> bool:
    """Add what the player says really happened."""
    p = path(rid, root=root)
    if p is None:
        return False
    report = json.loads(p.read_text())
    report.update(expected=expected.strip()[:200], note=note.strip()[:2000])
    p.write_text(json.dumps(report, indent=2))
    return True
