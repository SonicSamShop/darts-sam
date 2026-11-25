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
                     "days_played": 0, "last_played": None, "played_ms": 0, "by_game": {}, "sets": 0, "comparing": 0,
                     "boards": 1, "comparing_boards": 0}

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
        # time played: none of the three was timed, and their darts' times are before their starts: never negative
        assert n["played_ms"] == 0
        with db.at(f):  # a timed game counts its time, an untimed one from its start to its last dart
            db.save_match("timed", {**m(12 * DAY, [throw(1, 20, 1, "tap")], winner=0), "duration": 90000})
            db.save_match("quit", m(0, [throw(1, 20, 1, "tap"), throw(4, 20, 1, "tap")]))
        assert insight.numbers(f, corrected=1)["played_ms"] == 90000 + 4000
        with db.at(f):
            db.delete_match("quit")
            db.save_match("timed", {**m(12 * DAY, [throw(1, 20, 1, "tap")]), "seq": 2})
            assert db.delete_match("timed")

        # more corrections recorded than hand-entered darts left (a correction later undone): never negative
        n = insight.numbers(f, corrected=5)
        assert n["missed"] == 0 and n["accuracy"] == 8 / 13

        # comparing sets: a player counts once two of their sets each have ENOUGH_DARTS single darts
        enough, typed = insight.ENOUGH_DARTS, lambda r: {**throw(r, 60, 1, "visit")}  # noqa: E731
        with db.at(f):
            for s in ("a", "b", "c"):
                db.save_darts(s, {"player": pid, "name": s})
            db.save_match("sa", {**m(13 * DAY, [throw(1, 20, 1, "tap")] * enough), "darts": ["a"]})
            db.save_match("sb", {**m(13 * DAY, [throw(1, 20, 1, "tap")] * (enough - 1) + [typed(2)] * 5), "darts": ["b"]})
        n = insight.numbers(f, corrected=0)
        assert (n["sets"], n["comparing"]) == (3, 0)  # b's typed visits are not single darts
        with db.at(f):
            db.save_match("sb", {**m(13 * DAY, [throw(1, 20, 1, "tap")] * enough), "darts": ["b"], "seq": 2})
        assert insight.numbers(f, corrected=0)["comparing"] == 1
        # comparing boards: the same, for two boards (every game so far is on the first board)
        with db.at(f):
            db.save_board("second", {"up": 14 * DAY, "down": None})
            db.save_match("on2", {**m(14 * DAY, [throw(1, 20, 1, "tap")] * (enough - 1)), "board": "second"})
        n = insight.numbers(f, corrected=0)
        assert (n["boards"], n["comparing_boards"]) == (2, 0)
        with db.at(f):
            db.save_match("on2", {**m(14 * DAY, [throw(1, 20, 1, "tap")] * enough), "board": "second", "seq": 2})
        assert insight.numbers(f, corrected=0)["comparing_boards"] == 1

    acc = {"id": "a"}
    none = {"kept": 0, "days_played": 0}
    assert insight.steps(acc, None, none, 0) == [True, False, False, False, False]
    assert insight.steps(acc, {"calibrated": 0}, none, 0) == [True, True, False, False, False]
    assert insight.steps(acc, {"calibrated": 2}, none, 0) == [True, True, True, False, False]
    assert insight.steps(acc, {"calibrated": None}, none, 1) == [True, True, True, False, False]
    assert insight.steps(acc, {"calibrated": 2}, {"kept": 4, "days_played": 1}, 0) == [True, True, True, True, False]
    assert insight.steps(acc, {"calibrated": 2}, {"kept": 4, "days_played": 2}, 0) == [True, True, True, True, True]
    # the phone's own camera: finding the board is pairing and calibrating in one
    assert insight.steps(acc, None, none, 0, phone_found=1) == [True, True, True, False, False]
    assert insight.steps(acc, None, none, 3, phone_found=0) == [True, False, False, False, False]
    assert insight.STEPS == ["Signed up", "Paired", "Calibrated", "First camera dart", "Played 2+ days"]
    print("OK")


if __name__ == "__main__":
    main()
