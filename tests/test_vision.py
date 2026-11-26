# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""End-to-end test of the vision pipeline using a simulated 3-camera rig.

Renders what three cameras on a light ring would see (board + darts), feeds
the frames to the Tracker, and checks the reported positions.

  python -m tests.test_vision
"""
import json
import math
import random
import tempfile
from pathlib import Path

import cv2
import numpy as np

from server import board, calib, detect, replay, report
from server.calib import homography
from server.tracker import Tracker, STABLE_FRAMES

W, H = 1280, 720
F = 640 / math.tan(math.radians(50))  # ~100 degree lens
K = np.array([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1.0]])


def make_camera(angle_deg, radius=330.0, height=120.0, aim=(0.0, 0.0)):
    """Camera on the ring at a clock angle, looking at the bull (or at `aim`,
    in board mm). Returns 3x4 P."""
    cx, cy = board.polar(angle_deg, radius)
    C = np.array([cx, cy, height])
    fwd = np.array([*aim, 0.0]) - C
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 0, 1.0]); right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    R = np.vstack([right, down, fwd])
    return K @ np.hstack([R, (-R @ C).reshape(3, 1)])


def project(P, xyz):
    p = P @ np.append(xyz, 1.0)
    return p[:2] / p[2]


def board_texture(scale=2.0, size=460):
    """Top-down board picture, `scale` px per mm."""
    n = int(size * scale)
    img = np.full((n, n, 3), 40, np.uint8)
    c = n // 2
    yy, xx = np.mgrid[0:n, 0:n]
    x, y = (xx - c) / scale, (c - yy) / scale
    r = np.hypot(x, y)
    seg_i = (((np.degrees(np.arctan2(x, y)) % 360) + 9) % 360 // 18).astype(int)
    dark = seg_i % 2 == 0
    ring = ((r >= 99) & (r <= 107)) | ((r >= 162) & (r <= 170))
    img[(r <= 170) & dark & ~ring] = (30, 30, 30)
    img[(r <= 170) & ~dark & ~ring] = (190, 215, 225)
    img[ring & dark] = (40, 40, 200)
    img[ring & ~dark] = (60, 150, 60)
    img[r <= 15.9] = (60, 150, 60)
    img[r <= 6.35] = (40, 40, 200)
    return img, scale, c


TEX, TEX_SCALE, TEX_C = board_texture()


def render(P, darts, rng):
    # plane (mm) -> image homography is P with the z column dropped
    Hp = P[:, [0, 1, 3]]
    tex_to_mm = np.array([[1 / TEX_SCALE, 0, -TEX_C / TEX_SCALE],
                          [0, -1 / TEX_SCALE, TEX_C / TEX_SCALE], [0, 0, 1]])
    img = cv2.warpPerspective(TEX, Hp @ tex_to_mm, (W, H), borderValue=(25, 25, 25))
    for tip, tail in darts:
        a, b = project(P, tip), project(P, tail)
        mid = a + (b - a) * 0.55
        cv2.line(img, tuple(map(int, a)), tuple(map(int, mid)), (150, 150, 160), 5, cv2.LINE_AA)
        cv2.line(img, tuple(map(int, mid)), tuple(map(int, b)), (60, 90, 240), 9, cv2.LINE_AA)
    noise = rng.normal(0, 2.0, img.shape)
    return np.clip(img + noise, 0, 255).astype(np.uint8)


def bend(img, k):
    """What a camera whose lens bends the picture sees, given what a perfect
    lens would: a point at distance r from the middle (in units of the
    picture's longer side) moves out to r * (1 + k r^2). Worked out here,
    separately from server/calib.py, so the tests don't just check the server
    against itself."""
    h, w = img.shape[:2]
    f = max(w, h)
    xs, ys = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    xd, yd = (xs - w / 2) / f, (ys - h / 2) / f
    xu, yu = xd.copy(), yd.copy()
    for _ in range(20):  # each bent pixel shows the straight pixel that bends onto it
        s = 1 + k * (xu * xu + yu * yu)
        xu, yu = xd / s, yd / s
    return cv2.remap(img, (xu * f + w / 2).astype(np.float32), (yu * f + h / 2).astype(np.float32),
                     cv2.INTER_LINEAR, borderValue=(25, 25, 25))


def bend_point(p, k, size=(W, H)):
    w, h = size
    f = max(w, h)
    x, y = (p[0] - w / 2) / f, (p[1] - h / 2) / f
    s = 1 + k * (x * x + y * y)
    return np.array([x * s * f + w / 2, y * s * f + h / 2])


def random_dart(py):
    r = 175 * math.sqrt(py.random())
    x, y = board.polar(py.uniform(0, 360), r)
    tip = np.array([x, y, 0.0])
    # darts hang slightly down and lean a little at random
    tail = tip + np.array([py.uniform(-25, 25), py.uniform(-10, 35), 150.0])
    return tip, tail


def test_dart_in_pieces():
    """A real dart shows up as a big flight plus small separate bits of barrel
    and point. The tip must be the point, not the near end of the flight."""
    P = make_camera(0)
    Hm = homography([project(P, np.array([*p["xy"], 0.0])) for p in board.CALIBRATION_POINTS])
    tip, tail = np.array([40.0, -30.0, 0.0]), np.array([50.0, -15.0, 150.0])
    at = lambda f: tuple(map(int, project(P, tip + (tail - tip) * f)))
    mask = np.zeros((H, W), np.uint8)
    cv2.line(mask, at(0.0), at(0.12), 255, 2)    # point
    cv2.line(mask, at(0.2), at(0.42), 255, 5)    # barrel, after a gap
    cv2.circle(mask, at(0.85), 30, 255, -1)      # flight: most of the pixels
    cv2.circle(mask, (at(0.5)[0] + 60, at(0.5)[1]), 9, 255, -1)  # a bit of shadow off to one side
    d = detect.find_dart(mask, Hm)
    assert d is not None
    miss = np.linalg.norm(d.tip - tip[:2])
    assert miss < 5, f"tip found {miss:.0f} mm from the point"
    # and the line along the dart must pass close to the point too
    off = abs(d.direction[0] * (tip[1] - d.point[1]) - d.direction[1] * (tip[0] - d.point[0]))
    assert off < 3, f"dart line misses the point by {off:.1f} mm"


def test_shake_is_not_a_dart():
    """After a dart lands, one camera's picture shifting slightly (the ring
    shakes) must not be scored as another dart, and the next real dart must
    still be found."""
    rng = np.random.default_rng(1)
    cams = {i: make_camera(a) for i, a in enumerate((0, 120, 240))}
    Hs = {i: homography([project(P, np.array([*p["xy"], 0.0])) for p in board.CALIBRATION_POINTS])
          for i, P in cams.items()}
    tracker = Tracker(Hs)

    def settle(darts, shake=False):
        events = []
        for _ in range(STABLE_FRAMES + 2):
            frames = {i: render(P, darts, rng) for i, P in cams.items()}
            if shake:  # camera 0 has moved a few pixels and stays there
                frames[0] = np.roll(frames[0], 4, axis=1)
            events += tracker.update(frames)
        return events

    settle([])
    first = (np.array([30.0, 40.0, 0.0]), np.array([35.0, 60.0, 150.0]))
    assert [e["type"] for e in settle([first])] == ["dart"]
    assert settle([first], shake=True) == [], "a shake in one camera was scored as a dart"
    second = (np.array([-60.0, -20.0, 0.0]), np.array([-50.0, 0.0, 150.0]))
    evs = settle([first, second], shake=True)
    assert [e["type"] for e in evs] == ["dart"] and math.hypot(evs[0]["x"] + 60, evs[0]["y"] + 20) < 6


class Rig:
    """Three simulated cameras and a tracker watching them."""

    def __init__(self, seed, angles=(0, 120, 240)):
        self.rng = np.random.default_rng(seed)
        self.cams = {i: make_camera(a) for i, a in enumerate(angles)}
        self.events = []  # what the last settle() said, in full
        self.tracker = Tracker({
            i: homography([project(P, np.array([*p["xy"], 0.0])) for p in board.CALIBRATION_POINTS])
            for i, P in self.cams.items()})

    def settle(self, darts, only=None, paint=None):
        """Show the board with `darts` in it until it has been still long
        enough to be looked at. `only` maps a camera to darts that it alone
        sees; `paint(cam, frame)` draws extra things on a camera's picture."""
        events = []
        for _ in range(STABLE_FRAMES + 2):
            frames = {i: render(P, darts + (only or {}).get(i, []), self.rng)
                      for i, P in self.cams.items()}
            if paint:
                for i, f in frames.items():
                    paint(i, f)
            events += self.tracker.update(frames)
        self.events = events
        return [e["type"] for e in events]


def dart_at(x, y, lean=(8.0, 20.0)):
    return np.array([x, y, 0.0]), np.array([x + lean[0], y + lean[1], 150.0])


def test_single_camera_odds():
    """With one camera the dart comes with how likely each bed is, and its
    confidence is the likeliest bed's."""
    rig = Rig(5, angles=(30,))
    rig.settle([])
    assert rig.settle([dart_at(0, 60)]) == ["dart"]
    ev = rig.events[0]
    assert "odds" in ev, ev
    assert ev["confidence"] == ev["odds"][0]["p"], ev
    assert (ev["odds"][0]["seg"], ev["odds"][0]["mult"]) == (ev["seg"], ev["mult"]), ev
    three = Rig(5)
    three.settle([])
    assert three.settle([dart_at(0, 60)]) == ["dart"]
    assert "odds" not in three.events[0], three.events[0]


def test_empty_picture_heals():
    """If the "empty board" picture was taken with a dart in the board, pulling
    the darts never looks empty. The board coming back to exactly how it was
    after the last pull-out is the empty board: from then on takeouts work."""
    rig = Rig(3)
    stuck = dart_at(-90, 60)
    rig.settle([stuck])  # the tracker starts up with a dart already in
    assert rig.settle([stuck, dart_at(30, 40)]) == ["dart"]
    assert rig.settle([stuck, dart_at(30, 40), dart_at(-20, -80)]) == ["dart"]
    rig.settle([])  # pulled, the stuck one too: not yet known to be empty
    assert rig.settle([dart_at(60, -30)]) == ["dart"]
    assert rig.settle([dart_at(60, -30), dart_at(-40, 100)]) == ["dart"]
    assert rig.settle([]) == ["takeout"], "the board looked as it did after the last pull-out"
    assert rig.tracker.darts == 0
    assert rig.settle([dart_at(10, 10)]) == ["dart"]
    assert rig.settle([]) == ["takeout"], "the empty picture was not replaced"


def test_ignored_dart_is_not_the_empty_board():
    """Something seen by one camera only is ignored, but the board with it in
    view must not become the "empty board" picture, or the next takeout is
    never seen."""
    rig = Rig(4)
    rig.settle([])
    ghost = {0: [dart_at(-70, 50)]}
    assert rig.settle([], only=ghost) == []
    rig.settle([], only=ghost)  # and it stays there a while
    assert rig.settle([dart_at(40, -60)], only=ghost) == ["dart"]
    assert rig.settle([]) == ["takeout"]


def test_drooping_dart_is_not_another_dart():
    """A dart that sags in the board after landing changes every camera's
    picture, but nothing new is on the board."""
    rig = Rig(5)
    rig.settle([])
    assert rig.settle([dart_at(30, 40)]) == ["dart"]
    assert rig.settle([dart_at(30, 40, lean=(8.0, -5.0))]) == []
    assert rig.tracker.darts == 1
    assert rig.settle([dart_at(30, 40, lean=(8.0, -5.0)), dart_at(-60, -20)]) == ["dart"]


def test_glints_are_not_a_dart():
    """Specks in two cameras (glints on the number ring) make two "dart" lines
    that cross somewhere neither camera saw anything. That is not a dart."""
    rig = Rig(6)
    rig.settle([])
    specks = {0: [(300, 500), (360, 520), (420, 540)], 2: [(900, 150), (910, 215), (920, 280)]}

    def paint(cam, frame):
        for p in specks.get(cam, []):
            cv2.circle(frame, p, 6, (255, 255, 255), -1)

    assert rig.settle([], paint=paint) == []
    assert rig.tracker.darts == 0


def test_report():
    """A problem report holds the last looks, each camera's pictures and what
    was decided, and the saved pictures give the same dart when run again."""
    rng = np.random.default_rng(2)
    cams = {i: make_camera(a) for i, a in enumerate((0, 120, 240))}
    taps = {i: [project(P, np.array([*p["xy"], 0.0])).tolist() for p in board.CALIBRATION_POINTS]
            for i, P in cams.items()}
    tracker = Tracker({i: homography(t) for i, t in taps.items()})

    def settle(darts, shake=False):
        events, frames = [], None
        for _ in range(STABLE_FRAMES + 2):
            frames = {i: render(P, darts, rng) for i, P in cams.items()}
            if shake:
                frames[0] = np.roll(frames[0], 4, axis=1)
            events += tracker.update(frames)
        return events, frames

    settle([])
    dart = (np.array([0.0, 103.0, 0.0]), np.array([5.0, 120.0, 150.0]))  # treble 20
    (ev,), _ = settle([dart])
    _, frames = settle([dart], shake=True)
    assert [l["outcome"] for l in tracker.history] == ["dart", "one camera only"]

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        rep = report.save(report.snapshot(tracker, frames), {str(i): t for i, t in taps.items()},
                          {"visit": [{"label": "T20"}]}, root)
        folder = root / rep["id"]
        saved = json.loads((folder / "report.json").read_text())
        assert saved["app"] == {"visit": [{"label": "T20"}]} and saved["tracker"]["darts"] == 1
        first, second = saved["looks"]
        assert first["event"] == ev and "scored T20" in first["summary"]
        # each camera's own guess at the tip is near what the three scored together
        assert all(c["sighting"]["tip_from_scored_mm"] < 10 for c in first["cameras"].values())
        assert "only one camera" in second["summary"] and second["cameras"]["1"]["sighting"] is None
        # one look's "after" is the next one's "before", and is written once
        assert first["cameras"]["0"]["after"] == second["cameras"]["0"]["before"]
        for part in (*saved["looks"], saved["now"]):
            assert len(part["cameras"]) == len(part["lines"]) == 3
            for c in part["cameras"].values():
                assert all((folder / c[k]).is_file() for k in ("before", "after", "mask", "seen"))
        assert report.annotate_report(rep["id"], " T19 ", "wire", root)
        assert json.loads((folder / "report.json").read_text())["expected"] == "T19"
        assert report.path("../" + rep["id"], root=root) is None and report.path(rep["id"], "x.py", root) is None
        replay.replay(folder)  # the saved pictures can be run again


def test_bent_lens():
    """Wide webcams bend the picture, most near its edges, and a plain
    homography can't follow that: darts just inside the double or treble wires
    came out a few mm the wrong side of them. With the lens's bend known, darts
    hard against those wires must score what they hit."""
    k = 0.5  # about what the reported webcams measured
    rng = np.random.default_rng(5)
    # Close in and aimed past the bull, so the far side of the board is near the
    # edge of the picture where the bend is worst, as on the reported boards.
    cams = {i: make_camera(a, 250, 80, board.polar(a + 180, 110)) for i, a in enumerate((0, 120, 240))}
    views = {i: calib.View(homography([project(P, np.array([*p["xy"], 0.0])) for p in board.CALIBRATION_POINTS]),
                           lens=k, size=(W, H)) for i, P in cams.items()}
    tracker = Tracker(views)

    def settle(darts):
        events = []
        for _ in range(STABLE_FRAMES + 2):
            events += tracker.update({i: bend(render(P, darts, rng), k) for i, P in cams.items()})
        return events

    settle([])
    wrong = []
    # just inside the outer double wire, the inner double wire and both treble wires
    for n, (angle, r) in enumerate([(0, 168), (90, 168.5), (200, 164), (270, 101), (140, 105), (320, 168)]):
        tip = np.array([*board.polar(angle, r), 0.0])
        darts = [(tip, tip + np.array([6.0, 18.0, 150.0]))]
        evs = [e for e in settle(darts) if e["type"] == "dart"]
        truth = board.score(*tip[:2])
        if len(evs) != 1 or (evs[0]["seg"], evs[0]["mult"]) != (truth["seg"], truth["mult"]):
            wrong.append((angle, r, [(e["seg"], e["mult"], round(math.hypot(e["x"], e["y"]), 1)) for e in evs]))
        settle([])
    assert not wrong, f"darts by the wires scored wrongly through a bent lens: {wrong}"
    # the picture-side numbers in a sighting are where the dart is in the bent picture
    d = tracker.history[-2]["sightings"][0] if tracker.history[-2]["sightings"] else None
    if d is not None:
        assert 0 <= d.tip_px[0] < W and 0 <= d.tip_px[1] < H


def _line(x, y, dx=0.0, dy=1.0, area=900):
    return detect.DartLine(point=np.array([x, y]), direction=np.array([dx, dy]), tip=np.array([x, y]), area=area)


def test_odds_middle_of_bed():
    odds = detect.bed_odds(_line(0, 60.0), np.eye(3))
    assert (odds[0]["seg"], odds[0]["mult"]) == (20, 1) and odds[0]["p"] >= 0.97, odds


def test_odds_on_treble_wire():
    odds = detect.bed_odds(_line(0, 99.0), np.eye(3))
    assert {(o["seg"], o["mult"]) for o in odds[:2]} == {(20, 1), (20, 3)}, odds
    assert all(o["p"] > 0.25 for o in odds[:2]) and sum(o["p"] for o in odds) <= 1.0, odds


def test_odds_spread_is_along_the_line():
    # 3 mm inside the treble: a line across the ring spreads over its wires,
    # a line running round the ring stays inside it.
    radial = detect.bed_odds(_line(0, 102.0), np.eye(3))
    round_ = detect.bed_odds(_line(0, 102.0, 1.0, 0.0), np.eye(3))
    assert radial[0]["p"] < round_[0]["p"], (radial, round_)


def test_odds_are_plain_numbers():
    odds = detect.bed_odds(_line(0, 99.0), np.eye(3))
    json.dumps(odds)  # sent to the app as JSON
    assert all(type(o["p"]) is float and type(o["seg"]) is int for o in odds), odds


def test_odds_are_repeatable():
    ln = _line(10, 100.0, 0.1, 0.995)
    assert detect.bed_odds(ln, np.eye(3)) == detect.bed_odds(ln, np.eye(3))


def test_odds_wider_for_a_small_dart():
    big, small = detect.bed_odds(_line(0, 95.0), np.eye(3)), detect.bed_odds(_line(0, 95.0, area=200), np.eye(3))
    assert small[0]["p"] < big[0]["p"], (big, small)


def _tipped(x, y, dx, dy, tip, area=900):
    ln = _line(x, y, dx, dy, area)
    ln.tip = np.array(tip, float)
    return ln


def test_wire_dart_goes_with_the_cameras_tips():
    # Lines that cross 0.8 mm outside the treble (r 107.8), with two cameras'
    # own tips in the treble: scored T20, and the point moved just inside it.
    lines = [_tipped(0, 107.8, 1.0, 0.0, (3.0, 104.0)), _tipped(0, 107.8, 0.0, 1.0, (0.0, 105.5)),
             _tipped(0, 107.8, 0.6, 0.8, (0.5, 112.0))]
    (x, y), conf = detect.locate(lines)
    assert board.score(x, y) == {"seg": 20, "mult": 3}, (x, y)
    assert 106.0 < math.hypot(x, y) <= 107.0 and conf == 0.95


def test_wire_vote_needs_two_tips():
    # one tip in the treble is not enough: the crossing stands
    lines = [_tipped(0, 107.8, 1.0, 0.0, (3.0, 104.0)), _tipped(0, 107.8, 0.0, 1.0, (0.0, 110.0)),
             _tipped(0, 107.8, 0.6, 0.8, (0.5, 112.0))]
    (x, y), _ = detect.locate(lines)
    assert (x, y) == (0.0, 107.8) or np.allclose((x, y), (0.0, 107.8)), (x, y)


def test_wire_vote_ignores_far_tips():
    # tips more than 10 mm from the crossing (a camera that sees the dart end-on) don't count
    lines = [_tipped(0, 107.8, 1.0, 0.0, (12.0, 102.0)), _tipped(0, 107.8, 0.0, 1.0, (0.0, 96.0)),
             _tipped(0, 107.8, 0.6, 0.8, (0.5, 112.0))]
    (x, y), _ = detect.locate(lines)
    assert board.score(x, y) == {"seg": 20, "mult": 1}, (x, y)


def test_wire_vote_leaves_a_clear_dart_alone():
    # 4 mm from any wire: tips elsewhere don't move it
    lines = [_tipped(0, 120.0, 1.0, 0.0, (0.0, 104.0)), _tipped(0, 120.0, 0.0, 1.0, (0.0, 105.0))]
    (x, y), _ = detect.locate(lines)
    assert np.allclose((x, y), (0.0, 120.0)), (x, y)


def main(trials=120, seed=7):
    test_single_camera_odds()
    test_wire_dart_goes_with_the_cameras_tips()
    test_wire_vote_needs_two_tips()
    test_wire_vote_ignores_far_tips()
    test_wire_vote_leaves_a_clear_dart_alone()
    test_odds_middle_of_bed()
    test_odds_on_treble_wire()
    test_odds_spread_is_along_the_line()
    test_odds_are_plain_numbers()
    test_odds_are_repeatable()
    test_odds_wider_for_a_small_dart()
    test_bent_lens()
    test_dart_in_pieces()
    test_shake_is_not_a_dart()
    test_empty_picture_heals()
    test_ignored_dart_is_not_the_empty_board()
    test_drooping_dart_is_not_another_dart()
    test_glints_are_not_a_dart()
    test_report()
    py = random.Random(seed)
    rng = np.random.default_rng(seed)
    cams = {i: make_camera(a) for i, a in enumerate((0, 120, 240))}
    # Calibrate exactly as the user would: "tap" the four known wire crossings.
    Hs = {}
    for i, P in cams.items():
        taps = [project(P, np.array([*p["xy"], 0.0])) for p in board.CALIBRATION_POINTS]
        Hs[i] = homography(taps)

    def settle(tracker, darts):
        events = []
        for _ in range(STABLE_FRAMES + 2):
            events += tracker.update({i: render(P, darts, rng) for i, P in cams.items()})
        return events

    errors, wrong, missed, takeouts_ok = [], 0, 0, 0
    tracker = Tracker(Hs)
    settle(tracker, [])
    rounds = trials // 3
    for _ in range(rounds):
        darts = []
        for _ in range(3):
            d = random_dart(py)
            darts.append(d)
            evs = [e for e in settle(tracker, darts) if e["type"] == "dart"]
            if len(evs) != 1:
                missed += 1
                continue
            e = evs[0]
            errors.append(math.hypot(e["x"] - d[0][0], e["y"] - d[0][1]))
            truth = board.score(d[0][0], d[0][1])
            if (e["seg"], e["mult"]) != (truth["seg"], truth["mult"]):
                wrong += 1
        evs = settle(tracker, [])
        takeouts_ok += [e["type"] for e in evs] == ["takeout"]

    n = rounds * 3
    print(f"darts thrown:      {n}")
    print(f"not detected:      {missed}")
    print(f"wrong segment:     {wrong}")
    print(f"mean error (mm):   {np.mean(errors):.2f}")
    print(f"95th pct (mm):     {np.percentile(errors, 95):.2f}")
    print(f"takeouts detected: {takeouts_ok}/{rounds}")
    assert missed <= n * 0.03, "too many missed darts"
    assert np.mean(errors) < 2.0, "position error too high"
    assert takeouts_ok == rounds, "takeout detection failed"
    print("OK")


if __name__ == "__main__":
    main()
