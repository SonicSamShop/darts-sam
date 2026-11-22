# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Boards (server/db.py): several boards, one on the wall, each game on one.

  python -m tests.test_boards
"""
import json
import sqlite3
import tempfile
from pathlib import Path

from server import db


def throw(player, rnd, seg, mult, src="tap"):
    return {"player": player, "round": rnd, "seg": seg, "mult": mult, "x": None, "y": None,
            "src": src, "bust": False, "ts": 1000 * rnd}


def match(seq, players, throws, started=1, board=None, game="x01", winner=None, darts=None):
    m = {"seq": seq, "game_id": game, "game_name": game.upper(), "opts": {"start": 501}, "log": [],
         "started": started, "players": players, "winner": winner, "duration": None, "throws": throws}
    if board is not None:
        m["board"] = board
    if darts is not None:
        m["darts"] = darts
    return m


def expect(exc, fn, *args):
    try:
        fn(*args)
    except exc:
        return
    raise AssertionError(f"{fn.__name__} should have raised {exc.__name__}")


def board_of(match_id):
    with db.connect() as c:
        return c.execute("SELECT board FROM matches WHERE id = ?", (match_id,)).fetchone()[0]


def old_database(path: Path, settings: dict | None):
    """A database as it was before boards: a match or two, and maybe settings.board."""
    db.prepare(path)
    with db.at(path):
        sam = db.add_player("Sam")
        db.save_match("old1", match(1, [sam["id"]], [throw(0, 1, 20, 1)], started=5000))
        db.save_match("old2", match(1, [sam["id"]], [throw(0, 1, 20, 1)], started=9000))
        if settings is not None:
            db.set_setting("settings", settings)
    with sqlite3.connect(path) as c:  # back to before boards
        c.execute("DROP TABLE boards")
        c.execute("ALTER TABLE matches DROP COLUMN board")


def test_first_board_from_settings(tmp):
    path = tmp / "a.db"
    old_database(path, {"voice": True, "board": {"brand": "Winmau", "model": "Blade 6", "bought": 2024}})
    db.prepare(path)
    with db.at(path):
        boards = db.list_boards()
        assert len(boards) == 1, boards
        b = boards[0]
        assert (b["brand"], b["model"], b["bought"], b["down"]) == ("Winmau", "Blade 6", 2024, None)
        assert b["up"] == 5000  # since the first game
        assert board_of("old1") == board_of("old2") == b["id"]
        assert db.get_settings()["settings"] == {"voice": True}
    db.prepare(path)  # again: nothing more made
    with db.at(path):
        assert len(db.list_boards()) == 1


def test_first_board_without_settings(tmp):
    path = tmp / "b.db"
    old_database(path, None)
    db.prepare(path)
    with db.at(path):
        [b] = db.list_boards()
        assert b["brand"] is None and b["down"] is None
        assert board_of("old1") == b["id"]
    fresh = tmp / "c.db"
    db.prepare(fresh)
    with db.at(fresh):
        [b] = db.list_boards()
        assert b["down"] is None


def test_one_board_on_the_wall(tmp):
    with db.at(tmp / "d.db"):
        db.prepare(db.file())
        [first] = db.list_boards()
        db.save_board("new", {"brand": "Unicorn", "up": 50_000, "down": None, "created": 40_000})
        by = {b["id"]: b for b in db.list_boards()}
        assert by["new"]["down"] is None
        assert by[first["id"]]["down"] == 50_000
        # changing a board that is down leaves the wall alone
        db.save_board(first["id"], {**by[first["id"]], "notes": "turned twice"})
        assert {b["id"] for b in db.list_boards() if b["down"] is None} == {"new"}


def test_board_checked(tmp):
    with db.at(tmp / "e.db"):
        db.prepare(db.file())
        expect(db.Invalid, db.save_board, "x", {"brand": "w" * 41})
        expect(db.Invalid, db.save_board, "x", {"bought": 1800})
        expect(db.Invalid, db.save_board, "x", {"colour": "red"})
        expect(db.Invalid, db.save_board, "bad id!", {})
        assert db.save_board("x", {"brand": "  Target  ", "notes": "", "down": 1, "up": 0})["brand"] == "Target"
        assert db.clean_board({"model": "", "notes": None}) is None


def test_delete_board_refused_when_used_or_on_wall(tmp):
    with db.at(tmp / "f.db"):
        db.prepare(db.file())
        [wall] = db.list_boards()
        expect(db.Invalid, db.delete_board, wall["id"])  # on the wall
        sam = db.add_player("Sam")
        db.save_board("used", {"up": 1, "down": 2})
        db.save_match("m", match(1, [sam["id"]], [], board="used"))
        expect(db.Invalid, db.delete_board, "used")
        db.save_board("spare", {"up": 1, "down": 2})
        db.delete_board("spare")
        assert "spare" not in [b["id"] for b in db.list_boards()]
        expect(db.NotFound, db.delete_board, "spare")


def test_match_gets_wall_board_and_keeps_it(tmp):
    with db.at(tmp / "g.db"):
        db.prepare(db.file())
        [wall] = db.list_boards()
        sam = db.add_player("Sam")
        db.save_match("a", match(1, [sam["id"]], []))  # an older app: no board said
        assert board_of("a") == wall["id"]
        db.save_match("b", match(1, [sam["id"]], [], board="nonesuch"))
        assert board_of("b") == wall["id"]
        db.save_board("other", {"up": 1, "down": 2})
        db.save_match("c", match(1, [sam["id"]], [], board="other"))
        assert board_of("c") == "other"
        # moved, then saved again by a device that still has the old board: stays moved
        db.move_games(wall["id"], None, None, ["other"])
        db.save_match("c", match(2, [sam["id"]], [], board="other"))
        assert board_of("c") == wall["id"]
        assert db.export_match("c")["board"] == wall["id"]


def test_move_games_since_and_before(tmp):
    with db.at(tmp / "h.db"):
        db.prepare(db.file())
        [old] = db.list_boards()
        sam = db.add_player("Sam")
        db.save_board("third", {"up": 1, "down": 2})
        db.save_match("m1", match(1, [sam["id"]], [], started=100))
        db.save_match("m2", match(1, [sam["id"]], [], started=200))
        db.save_match("m3", match(1, [sam["id"]], [], started=300, board="third"))
        db.save_board("new", {"up": 150, "down": None})
        # since 150, only games on the old board or none
        assert db.move_games("new", 150, None, [old["id"], None]) == 1
        assert [board_of(i) for i in ("m1", "m2", "m3")] == [old["id"], "new", "third"]
        # before 250, from any board
        assert db.move_games("third", None, 250, None) == 2
        assert [board_of(i) for i in ("m1", "m2", "m3")] == ["third", "third", "third"]
        expect(db.NotFound, db.move_games, "nonesuch", None, None, None)


def main():
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        for name, fn in list(globals().items()):
            if name.startswith("test_"):
                fn(tmp)
    print("OK")


if __name__ == "__main__":
    main()
