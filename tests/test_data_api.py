# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The saved-data routes, served from a chosen file. Run: python -m tests.test_data_api"""
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from server import data_api, db


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
        app.include_router(data_api.make_router(db_file, reports=lambda: 7))
        c = TestClient(app)
        A, B = {"x-who": "a"}, {"x-who": "b"}

        assert c.get("/api/players").status_code == 401
        ann = c.post("/api/players", json={"name": "Ann"}, headers=A).json()
        assert [p["name"] for p in c.get("/api/players", headers=A).json()] == ["Ann"]
        assert c.get("/api/players", headers=B).json() == []
        assert c.post("/api/players", json={"name": "ann"}, headers=A).status_code == 400
        assert c.put("/api/settings/setup", json={"value": {"x": 1}}, headers=A).status_code == 200
        assert c.get("/api/settings", headers=A).json()["setup"] == {"x": 1}
        assert "setup" not in c.get("/api/settings", headers=B).json()
        m = {"seq": 1, "game_id": "x01", "game_name": "X01", "opts": {}, "log": [], "started": 1,
             "players": [ann["id"]], "winner": None, "duration": None, "throws": []}
        assert c.put("/api/matches/m1", json=m, headers=A).json()["saved"] is True
        assert c.get("/api/matches/m1", headers=A).status_code == 200
        assert c.get("/api/matches/m1", headers=B).status_code == 404
        assert len(c.get("/api/matches", headers=A).json()) + len(c.get("/api/matches", headers=B).json()) <= 1
        assert c.get(f"/api/players/{ann['id']}/stats", headers=A).status_code == 200
        assert c.get("/api/totals", headers=A).json() == {"darts": 0, "reports": 7}
        # a set's details go in and come back; an app that leaves them out (older than details) keeps them
        put = lambda body: c.put("/api/darts/red", json={"player": ann["id"], "name": "Red", **body}, headers=A)  # noqa: E731
        assert put({"details": {"brand": "Winmau", "grip": "light"}}).json()["details"] == {"brand": "Winmau", "grip": "light"}
        assert put({"grams": 22}).json()["details"] == {"brand": "Winmau", "grip": "light"}
        assert put({"details": {"grip": "sticky"}}).status_code == 400
        assert put({"details": None}).json()["details"] is None
        assert c.get("/api/darts", headers=B).json() == []
        # boards: one is made for every place; a new one goes up, games are moved to it, a used one stays
        [first] = c.get("/api/boards", headers=A).json()
        assert c.put("/api/boards/new", json={"brand": "Unicorn", "up": 1, "down": None}, headers=A).json()["brand"] == "Unicorn"
        assert c.put("/api/boards/bad", json={"bought": 1800}, headers=A).status_code == 400
        assert c.post("/api/boards/new/games", json={"start": None, "end": None, "only": [first["id"], None]}, headers=A).json() == {"moved": 1}
        assert c.get("/api/matches/m1", headers=A).status_code == 200
        assert c.delete("/api/boards/new", headers=A).status_code == 400
        assert c.delete(f"/api/boards/{first['id']}", headers=A).status_code == 204
        assert c.post("/api/boards/nonesuch/games", json={}, headers=A).status_code == 404
        assert len(c.get("/api/boards", headers=B).json()) == 1
        assert c.delete("/api/matches/m1", headers=B).json()["deleted"] is False
        assert c.delete("/api/matches/m1", headers=A).json()["deleted"] is True
    print("OK")


if __name__ == "__main__":
    main()
