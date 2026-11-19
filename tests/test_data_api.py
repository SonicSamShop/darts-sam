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
        assert c.delete("/api/matches/m1", headers=B).json()["deleted"] is False
        assert c.delete("/api/matches/m1", headers=A).json()["deleted"] is True
    print("OK")


if __name__ == "__main__":
    main()
