# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The trial's numbers for one account. Run: python -m tests.test_insight"""
import tempfile
from pathlib import Path

from server import db, insight

DAY = 24 * 3600 * 1000


def throw(rnd, seg, mult, src):
    return {"player": 0, "round": rnd, "seg": seg, "mult": mult, "x": None, "y": None, "src": src, "bust": False, "ts": 1000 * rnd}


def match(started, throws, winner=None, game="x01"):
    return {"seq": 1, "game_id": game, "game_name": game.upper(), "opts": {"start": 101}, "log": [],
            "started": started, "players": [1], "winner": winner, "duration": None, "throws": throws}


def main():
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "a" / "darts.db"
        db.prepare(f)
        n = insight.numbers(f, corrected=0)
        assert n == {"games": 0, "finished": 0, "darts": 0, "kept": 0, "corrected": 0, "missed": 0, "accuracy": None,
                     "days_played": 0, "last_played": None, "by_game": {}}

        with db.at(f):
            pid = db.add_player("Ann")["id"]
            m = lambda *a, **k: {**match(*a, **k), "players": [pid]}  # noqa: E731
            # day 1: a game scored by hand only (no cameras that day): its taps are not misses
            db.save_match("hand", m(10 * DAY, [throw(1, 20, 1, "tap"), throw(1, 5, 1, "tap"), throw(1, 0, 0, "miss")]))
            # day 1 again: cameras scoring. 6 camera darts kept, 2 entered by hand, 1 Miss button
            db.save_match("cam1", m(10 * DAY + 5000, [throw(1, 20, 3, "cam"), throw(1, 20, 1, "cam"), throw(1, 1, 1, "tap"),
                                                      throw(2, 19, 3, "cam"), throw(2, 19, 1, "cam"), throw(2, 0, 0, "miss"),
                                                      throw(3, 18, 1, "cam"), throw(3, 18, 1, "cam"), throw(3, 7, 1, "tap")],
                                    winner=0, game="cricket"))
            # day 3: all camera
            db.save_match("cam2", m(12 * DAY, [throw(1, 20, 1, "cam"), throw(1, 20, 1, "cam")]))

        # one of the three hand-entered darts replaced a camera dart that was wrong (a correction);
        # the other two were darts the cameras never saw
        n = insight.numbers(f, corrected=1)
        assert n["games"] == 3 and n["finished"] == 1 and n["darts"] == 14
        assert n["kept"] == 8 and n["corrected"] == 1 and n["missed"] == 2
        assert n["accuracy"] == 8 / 11
        assert n["days_played"] == 2 and n["last_played"] == 12 * DAY
        assert n["by_game"] == {"x01": 2, "cricket": 1}

        # more corrections recorded than hand-entered darts left (a correction later undone): never negative
        n = insight.numbers(f, corrected=5)
        assert n["missed"] == 0 and n["accuracy"] == 8 / 13

    acc = {"id": "a"}
    none = {"kept": 0, "days_played": 0}
    assert insight.steps(acc, None, none, 0) == [True, False, False, False, False]
    assert insight.steps(acc, {"calibrated": 0}, none, 0) == [True, True, False, False, False]
    assert insight.steps(acc, {"calibrated": 2}, none, 0) == [True, True, True, False, False]
    assert insight.steps(acc, {"calibrated": None}, none, 1) == [True, True, True, False, False]
    assert insight.steps(acc, {"calibrated": 2}, {"kept": 4, "days_played": 1}, 0) == [True, True, True, True, False]
    assert insight.steps(acc, {"calibrated": 2}, {"kept": 4, "days_played": 2}, 0) == [True, True, True, True, True]
    assert insight.STEPS == ["Signed up", "Paired", "Calibrated", "First camera dart", "Played 2+ days"]
    print("OK")


if __name__ == "__main__":
    main()
