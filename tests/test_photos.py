# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Pictures kept with a game (server/photos.py) and their addresses. Run: python -m tests.test_photos"""
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from server import data_api, db, photos

JPEG = b"\xff\xd8\xff\xe0" + b"x" * 200


def main():
    with tempfile.TemporaryDirectory() as tmp:
        files = {"a": Path(tmp) / "a.db", "b": Path(tmp) / "b.db"}
        for f in files.values():
            db.prepare(f)

        def db_file(request):
            who = request.headers.get("x-who")
            if who not in files:
                raise HTTPException(401, "Sign in first.")
            return files[who]

        app = FastAPI()
        app.include_router(data_api.make_router(db_file))
        c = TestClient(app)
        A, B = {"x-who": "a"}, {"x-who": "b"}
        ann = c.post("/api/players", json={"name": "Ann"}, headers=A).json()
        m = {"seq": 1, "game_id": "x01", "game_name": "X01", "opts": {}, "log": [], "started": 1,
             "players": [ann["id"]], "winner": None, "duration": None, "throws": []}
        assert c.put("/api/matches/m1", json=m, headers=A).status_code == 200
        url = "/api/matches/m1/photos/"

        # kept, and given back as it was
        assert c.get(url + "3", headers=A).status_code == 404
        assert c.put(url + "3", content=JPEG, headers=A).status_code == 200
        got = c.get(url + "3", headers=A)
        assert got.status_code == 200 and got.content == JPEG and got.headers["content-type"] == "image/jpeg"
        assert (Path(tmp) / "a.photos" / "m1" / "3.jpg").read_bytes() == JPEG
        # a second one for the same visit takes its place
        assert c.put(url + "3", content=JPEG + b"y", headers=A).status_code == 200
        assert c.get(url + "3", headers=A).content == JPEG + b"y"
        assert len(list((Path(tmp) / "a.photos" / "m1").iterdir())) == 1

        # nobody signed in, and somebody else's game
        assert c.put(url + "3", content=JPEG).status_code == 401
        assert c.get(url + "3", headers=B).status_code == 404
        assert c.put(url + "3", content=JPEG, headers=B).status_code == 404  # B has no such game
        assert not (Path(tmp) / "b.photos").exists()
        # only beside a game that is there
        assert c.put("/api/matches/nope/photos/1", content=JPEG, headers=A).status_code == 404

        # only a small JPEG, at a plain address
        assert c.put(url + "4", content=b"<html>", headers=A).status_code == 400
        assert c.put(url + "4", content=JPEG + b"x" * photos.MOST, headers=A).status_code == 400
        for bad in ("x", "1.jpg", "-1", "123456", "max:10"):
            assert c.put(url + bad, content=JPEG, headers=A).status_code in (400, 404), bad
        assert c.get("/api/matches/..%2f..%2fa/photos/1", headers=A).status_code in (400, 404)
        for bad in ("../x", "a/b", "", "x" * 65, "a b"):
            try:
                photos.save(files["a"], bad, "1", JPEG)
                raise AssertionError(bad)
            except photos.Refused:
                pass
        assert not (Path(tmp) / "x").exists()
        assert c.get(url + "4", headers=A).status_code == 404

        # no more once there are a great many
        most, photos.MOST_KEPT = photos.MOST_KEPT, 1
        assert c.put(url + "5", content=JPEG, headers=A).status_code == 400
        assert c.put(url + "3", content=JPEG, headers=A).status_code == 200  # one already kept can still be replaced
        photos.MOST_KEPT = most

        # undone: that picture goes
        assert c.put(url + "5", content=JPEG, headers=A).status_code == 200
        assert c.delete(url + "5", headers=A).json() == {"ok": True, "deleted": True}
        assert c.delete(url + "5", headers=A).json() == {"ok": True, "deleted": False}
        assert c.get(url + "5", headers=A).status_code == 404
        assert c.delete(url + "3", headers=B).json()["deleted"] is False
        assert c.get(url + "3", headers=A).status_code == 200

        # the game thrown away: its pictures go with it
        assert c.delete("/api/matches/m1", headers=A).json()["deleted"] is True
        assert not (Path(tmp) / "a.photos" / "m1").exists()
        assert c.get(url + "3", headers=A).status_code == 404
    print("OK")


if __name__ == "__main__":
    main()
