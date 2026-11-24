# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Tournaments (server/db.py and the /api/tournaments routes).

  python -m tests.test_tournaments
"""
import tempfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from server import data_api, db


def tournament(seq, name="Christmas cup", created=1, **more):
    t = {"seq": seq, "name": name, "data": {"opts": {"start": 501}, "rounds": [{"legs": 1}], "slots": []},
         "created": created, "finished": None, "abandoned": False, "winner": None}
    t.update(more)
    return t


def expect(exc, fn, *args):
    try:
        fn(*args)
    except exc:
        return
    raise AssertionError(f"{fn.__name__} should have raised {exc.__name__}")


def test_saved_and_listed(tmp):
    with db.at(tmp / "a.db"):
        db.prepare(tmp / "a.db")
        assert db.save_tournament("t1", tournament(1, created=1)) is True
        assert db.save_tournament("t2", tournament(1, created=2)) is True
        assert [t["id"] for t in db.list_tournaments()] == ["t2", "t1"]
        got = db.get_tournament("t1")
        assert got["data"] == tournament(1)["data"]
        assert (got["id"], got["name"], got["abandoned"], got["winner"]) == ("t1", "Christmas cup", False, None)


def test_older_copy_ignored(tmp):
    with db.at(tmp / "b.db"):
        db.prepare(tmp / "b.db")
        assert db.save_tournament("t1", tournament(2, name="Two")) is True
        assert db.save_tournament("t1", tournament(1, name="One")) is False
        assert db.get_tournament("t1")["name"] == "Two"


def test_name_checked(tmp):
    with db.at(tmp / "c.db"):
        db.prepare(tmp / "c.db")
        expect(db.Invalid, db.save_tournament, "t1", tournament(1, name=""))
        expect(db.Invalid, db.save_tournament, "t1", tournament(1, name="x" * 41))


def test_winner_must_be_a_player(tmp):
    with db.at(tmp / "d.db"):
        db.prepare(tmp / "d.db")
        expect(db.Invalid, db.save_tournament, "t1", tournament(1, winner=999))
        sam = db.add_player("Sam")
        assert db.save_tournament("t1", tournament(2, winner=sam["id"], finished=5, abandoned=True)) is True
        got = db.get_tournament("t1")
        assert (got["winner"], got["finished"], got["abandoned"]) == (sam["id"], 5, True)


def test_missing(tmp):
    with db.at(tmp / "e.db"):
        db.prepare(tmp / "e.db")
        expect(db.NotFound, db.get_tournament, "nope")


def test_api_round_trip(tmp):
    path = tmp / "f.db"
    db.prepare(path)
    app = FastAPI()
    app.include_router(data_api.make_router(lambda request: path))
    c = TestClient(app)
    assert c.put("/api/tournaments/t1", json=tournament(1)).json() == {"ok": True, "saved": True}
    assert c.put("/api/tournaments/t1", json=tournament(1)).json() == {"ok": True, "saved": False}
    assert [t["id"] for t in c.get("/api/tournaments").json()] == ["t1"]
    assert c.get("/api/tournaments/t1").json()["name"] == "Christmas cup"
    assert c.get("/api/tournaments/nope").status_code == 404
    assert c.put("/api/tournaments/t2", json=tournament(1, name="")).status_code == 400


def main():
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        for name, fn in list(globals().items()):
            if name.startswith("test_"):
                fn(tmp)
    print("OK")


if __name__ == "__main__":
    main()
