"""Sharing without an account: the desktop server's side (share.py and app.py's
/api/share) against a real running host. Run: python -m tests.test_share"""
import io
import json
import tempfile
import time
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from server import app as home, db, report, reportsync, share
from tests.test_link import free_port, start_host


def until(fn, seconds=8):
    end = time.monotonic() + seconds
    while not fn():
        assert time.monotonic() < end, "waited too long"
        time.sleep(0.05)


def game(seq, players, winner=None, darts=3):
    return {"seq": seq, "game_id": "x01", "game_name": "501", "opts": {"start": 501}, "log": [{"t": "dart"}] * darts,
            "started": 1_700_000_000_000, "players": players, "winner": winner, "duration": 9000 if winner is not None else None,
            "throws": [{"player": i % len(players), "round": 0, "seg": 20, "mult": 3, "x": 1.5, "y": 100.0,
                        "src": "cam" if i else "tap", "bust": False, "ts": 1_700_000_000_000 + i} for i in range(darts)]}


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        port = free_port()
        site = f"http://127.0.0.1:{port}"
        host_app, stop = start_host(tmp / "host", port)
        store = host_app.state.store
        try:
            # ---------- the site's side, asked directly ----------
            assert share.call(site + "/api/install/hello", "nope", "POST", {})[0] == 401
            assert share.call(site + "/api/install/events", None, "POST", {"events": []})[0] == 401
            assert share.call(site + "/api/install", "nope", "DELETE")[0] == 401
            status, answer = share.call(site + "/api/install", None, "POST", {"platform": "win32", "cameras": 2, "calibrated": 1})
            assert status == 200
            tok = answer["token"]
            acc = store.install_account(tok)
            assert store.helper_account(tok) is None and store.session_account(tok) is None  # no way in but as an install
            assert store.helper_account("install:" + acc) is None
            assert store.accounts()[0]["nickname"] == f"Desktop app {acc[:4]}"
            assert store.helper(acc)["cameras"] == 2 and store.helper(acc)["platform"] == "win32"
            assert share.call(site + "/api/install/hello", tok, "POST", {"cameras": {"x": 1}, "calibrated": 3})[0] == 422
            assert share.call(site + "/api/install/hello", tok, "POST", {"cameras": 3, "calibrated": 3})[0] == 200
            assert store.helper(acc)["calibrated"] == 3
            assert share.call(site + "/api/install/events", tok, "POST", {"events": [
                {"kind": "correction", "ts": 5, "detail": {}}, {"kind": "signup", "ts": 5}]})[1] == {"kept": 1}
            assert share.call(site + "/api/install/feedback", tok, "POST", {"text": "  "})[0] == 400
            assert share.call(site + "/api/install/feedback", tok, "POST", {"text": "Works a treat"})[0] == 200
            assert store.feedback()[0]["text"] == "Works a treat"
            # a game: the app's player numbers become "Player n", the same ones each time
            assert share.call(site + "/api/install/matches/m1", tok, "PUT", game(1, [7, 3]))[1] == {"ok": True, "saved": True}
            assert share.call(site + "/api/install/matches/m2", tok, "PUT", game(1, [3], winner=0))[1]["saved"] is True
            assert share.call(site + "/api/install/matches/m1", tok, "PUT", game(1, [7, 3]))[1]["saved"] is False  # nothing newer
            assert share.call(site + "/api/install/matches/m3", tok, "PUT", game(1, [3, 3]))[0] == 400
            assert share.call(site + "/api/install/matches/m3", tok, "PUT", game(1, list(range(13))))[0] == 413
            with db.at(store.account_db(acc)):
                assert sorted(p["name"] for p in db.list_players()) == ["Player 3", "Player 7"]
                assert db.match("m1")["players"] == ["Player 7", "Player 3"]
            assert share.call(site + "/api/install/matches/m2", tok, "DELETE")[1]["deleted"] is False  # finished: kept
            assert share.call(site + "/api/install/matches/m1", tok, "DELETE")[1]["deleted"] is True
            # reports: an install has less room than an account
            assert store.report_room(acc) == 200 * 2**20
            body = io.BytesIO()
            with zipfile.ZipFile(body, "w") as z:
                z.writestr("report.json", json.dumps({"expected": "T20", "looks": []}))
                z.writestr("frame-01.png", b"PNG" * 100)
            assert reportsync._post(site + "/api/helper/reports/r1", tok, body.getvalue()) == 200
            assert reportsync._post(site + "/api/helper/reports/r1", "nope", body.getvalue()) == 401
            assert store.reports(acc)[0]["expected"] == "T20"
            folder = store.report_folder(acc, "r1")
            assert (folder / "frame-01.png").exists()
            # all of it goes, and the token with it
            assert share.call(site + "/api/install", tok, "DELETE")[0] == 200
            assert store.accounts() == [] and store.feedback() == [] and not folder.exists()
            assert share.call(site + "/api/install/hello", tok, "POST", {})[0] == 401

            # ---------- the desktop server ----------
            db.init(str(tmp / "home.db"))
            home.CONFIG_PATH, home.SHARED_PATH, report.DIR = tmp / "config.json", tmp / "shared.json", tmp / "reports"
            home.config.update(home.DEFAULTS)
            home.host_override = site
            share.EVERY = 0.2
            ann, bob = db.add_player("Ann")["id"], db.add_player("Bob")["id"]
            db.save_match("g1", game(1, [ann, bob], winner=1))
            db.save_match("g2", game(1, [bob]))
            old = report.DIR / "before"   # a report made before anyone said yes: never sent
            old.mkdir(parents=True)
            (old / "report.json").write_text("{}")
            c = TestClient(home.app)

            # not asked yet: nothing is sent
            assert c.get("/api/share").json() == {"asked": False, "on": False, "paired": False, "site": site}
            assert c.post("/api/share/events", json={"events": []}).status_code == 409
            assert c.post("/api/share/feedback", json={"text": "hi"}).status_code == 409
            home.send_report("before")
            assert not (old / reportsync.MARKER).exists()
            time.sleep(0.5)
            assert store.accounts() == []

            # no: asked, and still nothing
            assert c.put("/api/share", json={"on": False}).json()["asked"] is True
            assert json.loads(home.CONFIG_PATH.read_text())["share"] == {"on": False}
            time.sleep(0.5)
            assert store.accounts() == [] and home.sharer is None and home.uploader is None

            # yes: it registers, and the games already here go up
            assert c.put("/api/share", json={"on": True}).json()["on"] is True
            until(lambda: home.config["share"].get("token") and len(share._read(home.SHARED_PATH)) == 2)
            acc = store.install_account(home.config["share"]["token"])
            assert json.loads(home.CONFIG_PATH.read_text())["share"]["token"] == home.config["share"]["token"]
            assert store.helper(acc)["cameras"] == 0
            with db.at(store.account_db(acc)):
                assert db.match("g1")["players"] == [f"Player {ann}", f"Player {bob}"] and db.match("g1")["winner"] == 1
                assert db.total_darts() == 6
                assert b"Ann" not in store.account_db(acc).read_bytes()  # names stay at home
            # a game changes, another is thrown away
            db.save_match("g2", game(2, [bob], darts=5))
            db.save_match("g3", game(1, [ann]))
            until(lambda: share._read(home.SHARED_PATH) == {"g1": 1, "g2": 2, "g3": 1})
            db.delete_match("g3")
            until(lambda: "g3" not in share._read(home.SHARED_PATH))
            with db.at(store.account_db(acc)):
                assert db.total_darts() == 8 and set(db.match_seqs()) == {"g1", "g2"}
            # what the app passes on
            assert c.post("/api/share/events", json={"events": [{"kind": "correction", "ts": 1, "detail": {}}]}).json() == {"kept": 1}
            assert store.count_events(acc, "correction") == 1
            assert c.post("/api/share/feedback", json={"text": ""}).status_code == 400
            assert c.post("/api/share/feedback", json={"text": "More games please", "app": {"version": "v"}}).json() == {"ok": True}
            assert store.feedback()[0]["text"] == "More games please"
            # a report made now goes up
            new = report.DIR / "after"
            new.mkdir()
            (new / "report.json").write_text(json.dumps({"expected": "D16", "looks": []}))
            (new / "frame-01.png").write_bytes(b"PNG" * 50)
            home.send_report("after")
            home.send_report("after", noted=True)  # they said what it should have been: no two-minute wait
            assert home.uploader is not None
            home.uploader.once()
            assert [r["id"] for r in store.reports(acc)] == ["after"] and store.reports(acc)[0]["expected"] == "D16"

            # switched off: nothing more goes, what was sent stays, the same install when switched on again
            assert c.put("/api/share", json={"on": False}).json()["on"] is False
            assert home.sharer is None and home.uploader is None
            db.save_match("g4", game(1, [ann]))
            time.sleep(0.6)
            assert "g4" not in share._read(home.SHARED_PATH) and len(store.accounts()) == 1
            assert c.put("/api/share", json={"on": True}).json()["on"] is True
            until(lambda: "g4" in share._read(home.SHARED_PATH))
            assert store.install_account(home.config["share"]["token"]) == acc

            # the site forgets the install (its data was removed there): the server starts again as a new one
            store.delete_account(acc)
            db.save_match("g4", game(2, [ann]))
            until(lambda: len(store.accounts()) == 1 and len(share._read(home.SHARED_PATH)) == 3)
            acc2 = store.install_account(home.config["share"]["token"])
            assert acc2 and acc2 != acc

            # delete what was sent: gone from the site, sharing off, the games at home untouched
            assert c.delete("/api/share").json() == {"asked": True, "on": False, "paired": False, "site": site}
            assert store.accounts() == [] and home.config["share"] == {"on": False} and not home.SHARED_PATH.exists()
            assert set(db.match_seqs()) == {"g1", "g2", "g4"}
            time.sleep(0.5)
            assert store.accounts() == []
            # the site can't be reached: nothing is deleted, and it says so
            assert c.put("/api/share", json={"on": True}).json()["on"] is True
            until(lambda: home.config["share"].get("token"))
            home.host_override = "http://127.0.0.1:1"
            assert c.delete("/api/share").status_code == 502
            assert home.config["share"]["on"] is True and home.config["share"]["token"]
            assert c.post("/api/share/feedback", json={"text": "hello"}).status_code == 502
            home.host_override = site
            assert c.delete("/api/share").json()["on"] is False
        finally:
            if home.sharer:
                home.sharer.stop()
            home.stop_uploader()
            stop()
    print("OK")


if __name__ == "__main__":
    main()
