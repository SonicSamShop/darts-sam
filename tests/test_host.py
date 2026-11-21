# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The host: sign-in, accounts, each account's own games. Run: python -m tests.test_host"""
import base64
import json
import sys
import tempfile
import threading
from pathlib import Path

sys.modules["cv2"] = None    # the host must not need OpenCV…
sys.modules["numpy"] = None  # …or numpy: importing either now fails

from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from server import auth, host, hoststore, mail  # noqa: E402

PEOPLE = {"tok-ann": {"sub": "g-1", "email": "ann@example.com", "name": " Ann "},
          "tok-bob": {"sub": "g-2", "email": "bob@example.com", "name": "Bob"},
          # Apple's tokens never say a name; this one has Ann's Google number, and is still someone else
          "tok-cat": {"sub": "g-1", "email": "", "name": ""}}


def check(credential, client_id):
    assert client_id in ("client-123", "apple-123")
    if credential not in PEOPLE:
        raise auth.Rejected("no")
    return PEOPLE[credential]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        settings = {"google_client_id": "client-123", "admins": ["bob@example.com", "eve@example.com"], "dev": True,
                    "downloads": str(Path(tmp) / "apps")}
        app = host.create(Path(tmp), settings, check_google=check)
        ann, ann2, bob, nobody = (TestClient(app) for _ in range(4))

        # The vision code a phone runs in its browser (web/vision-worker.js),
        # and none of the rest of the server's code.
        r = nobody.get("/vision/py/detect.py")
        assert r.status_code == 200 and "def find_dart" in r.text, r
        assert r.headers["content-type"].startswith("text/plain"), r.headers
        for bad in ("/vision/py/app.py", "/vision/py/host.py", "/vision/py/version.py",
                    "/vision/py/..%2Fhost.py", "/vision/py/detect.pyc"):
            assert nobody.get(bad).status_code == 404, bad
        import mimetypes
        assert mimetypes.guess_type("pyodide.asm.wasm")[0] == "application/wasm"
        assert mimetypes.guess_type("pyodide.mjs")[0] == "text/javascript"

        me = nobody.get("/api/me").json()
        assert me == {"hosted": True, "google_client_id": "client-123", "apple_client_id": None, "email": True,
                      "home": None, "app": None, "account": None, "helper": None}  # "dev": the sign-in email is printed, not sent
        assert nobody.post("/auth/apple", json={"credential": "tok-cat"}).status_code == 404  # not set up here
        assert nobody.get("/api/players").status_code == 401
        assert nobody.patch("/api/me", json={"nickname": "x"}).status_code == 401
        assert nobody.delete("/api/me").status_code == 401
        assert nobody.get("/version.json").status_code == 200
        assert "<html" in nobody.get("/").text.lower()
        # the apps to download: only what has been put in the folder, and only by the names the page knows
        assert nobody.get("/api/downloads").json() == {"downloads": []}
        assert nobody.get("/downloads/DartsSAM.exe").status_code == 404
        (Path(tmp) / "apps").mkdir()
        (Path(tmp) / "apps" / "DartsSAM.exe").write_bytes(b"MZ" * 50)
        (Path(tmp) / "apps" / "secret.txt").write_text("no")
        there = nobody.get("/api/downloads").json()["downloads"]
        assert [(d["id"], d["file"], d["size"]) for d in there] == [("windows", "DartsSAM.exe", 100)] and there[0]["updated"]
        r = nobody.get("/downloads/DartsSAM.exe")
        assert r.content == b"MZ" * 50 and "attachment" in r.headers["content-disposition"]
        assert nobody.get("/downloads/secret.txt").status_code == 404
        assert nobody.get("/downloads/..%2Fhost.db").status_code == 404
        # which version each app is, for the desktop apps to offer a newer one (fetch_apps.py writes releases.json)
        assert nobody.get("/api/release?app=windows").json() == {"version": None}  # no version recorded yet
        assert nobody.get("/api/release?app=amiga").status_code == 404
        notes = {"1.0": ["First"], "1.1": ["Second"]}
        (Path(tmp) / "apps" / "releases.json").write_text(json.dumps({
            "DartsSAM.exe": {"version": "1.1", "notes": notes, "sha256": "ab" * 32, "signature": "c2ln"},
            "DartsSAM-arm64.dmg": {"version": "1.1", "notes": notes}}))  # recorded, but the file isn't there
        assert nobody.get("/api/release?app=windows").json() == {
            "version": "1.1", "notes": notes, "file": "DartsSAM.exe", "size": 100, "url": "/downloads/DartsSAM.exe",
            "sha256": "ab" * 32, "signature": "c2ln"}  # its signature, passed on for the app to check (release.py)
        assert nobody.get("/api/release?app=mac-arm64").json() == {"version": None}
        assert nobody.get("/downloads/releases.json").status_code == 404
        assert "autoscore" in nobody.get("/download.html").text.lower()
        assert "how do i connect" in nobody.get("/faq.html").text.lower()  # the questions, for anyone to read

        with nobody.websocket_connect("/ws") as ws:  # the app's live line: nothing to say yet but hello
            hello = ws.receive_json()
            assert hello["type"] == "hello" and hello["cameras"] == 0 and hello["version"]

        # a token Google would not vouch for
        r = nobody.post("/auth/google", json={"credential": "garbage"})
        assert r.status_code == 401 and "ds_session" not in r.cookies

        # first time: the account is made there and then, called by their first name, with a player of that name
        r = ann.post("/auth/google", json={"credential": "tok-ann", "name": "Not Ann"})  # Google's word, not the page's
        acc = r.json()["account"]
        assert r.json()["new"] is True and r.json()["named"] is True
        assert acc["nickname"] == "Ann" and acc["admin"] is False and "email" not in acc
        cookie = r.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=lax" in cookie and "max-age=7776000" in cookie
        kept = b"".join(p.read_bytes() for p in Path(tmp).glob("host.db*"))
        assert b"ann@example.com" not in kept
        assert [p["name"] for p in ann.get("/api/players").json()] == ["Ann"]

        # the same person on a second device: the same account and games, and no second player
        r = ann2.post("/auth/google", json={"credential": "tok-ann"})
        assert r.json()["account"]["id"] == acc["id"] and r.json()["new"] is False
        assert [p["name"] for p in ann2.get("/api/players").json()] == ["Ann"]
        # someone else sees none of it; an admin by email
        r = bob.post("/auth/google", json={"credential": "tok-bob"})
        assert r.json()["account"]["admin"] is True
        assert [p["name"] for p in bob.get("/api/players").json()] == ["Bob"]

        # the welcome page's totals: everyone's darts and games together, for anyone to ask for
        assert nobody.get("/api/tally").json() == {"darts": 0, "games": 0, "users": 2}
        game = {"seq": 1, "game_id": "x01", "game_name": "X01", "opts": {}, "log": [], "started": 1,
                "players": [ann.get("/api/players").json()[0]["id"]], "winner": None, "duration": None,
                "throws": [{"player": 0, "round": 1, "seg": 20, "mult": 3, "src": "tap"},
                           {"player": 0, "round": 1, "seg": 0, "mult": 0, "src": "miss"},
                           {"player": 0, "round": 2, "seg": 60, "mult": 1, "src": "visit"}]}  # typed in: no darts to count
        assert ann.put("/api/matches/t1", json=game).json()["saved"] is True
        assert nobody.get("/api/tally").json() == {"darts": 0, "games": 0, "users": 2}  # counted at most once a minute
        app.state.tally = None
        assert nobody.get("/api/tally").json() == {"darts": 2, "games": 1, "users": 2}
        assert ann.delete("/api/matches/t1").json()["deleted"] is True
        app.state.tally = None

        # a game too big to keep, even sent in pieces with no size given up front
        padded = json.dumps({**game, "opts": {"pad": "x" * (host.MATCH_MOST + 1)}}).encode()
        pieces = (padded[i:i + 2**16] for i in range(0, len(padded), 2**16))
        assert ann.put("/api/matches/big", content=pieces, headers={"content-type": "application/json"}).status_code == 413
        # and an account whose games fill their room can't add more (but can still read and delete)
        room, host.ACCOUNT_MOST = host.ACCOUNT_MOST, 0
        assert ann.put("/api/matches/t2", json=game).status_code == 507
        assert ann.get("/api/players").status_code == 200
        host.ACCOUNT_MOST = room

        # --- pairing a helper, and reaching it ---
        assert ann.get("/api/me").json()["helper"] is None and nobody.get("/api/me").json()["helper"] is None
        assert ann.get("/api/status").status_code == 503
        assert ann.get("/api/status").json()["detail"] == "Your cameras aren't connected."
        assert nobody.get("/api/status").status_code == 401
        assert ann.post("/api/simulate", json={"x": 0, "y": 0}).status_code in (404, 405)  # never passed to a helper
        assert nobody.post("/api/pair/claim", json={"code": "ABCDEF"}).status_code == 401

        p = nobody.post("/api/pair/start").json()
        assert nobody.post("/api/pair/collect", json={"code": p["code"], "secret": p["secret"]}).json() == {"waiting": True}
        assert ann.post("/api/pair/claim", json={"code": "ZZZZZZ"}).status_code == 404
        assert ann.post("/api/pair/claim", json={"code": f" {p['code'].lower()} "}).json() == {"ok": True}
        token = nobody.post("/api/pair/collect", json={"code": p["code"], "secret": p["secret"]}).json()["token"]
        assert nobody.post("/api/pair/collect", json={"code": p["code"], "secret": p["secret"]}).status_code == 404
        assert ann.get("/api/me").json()["helper"] == {"connected": False, "cameras": None, "platform": None}

        def shown_the_door(tok):
            with nobody.websocket_connect("/helper", headers={"Authorization": f"Bearer {tok}"}) as ws:
                try:
                    ws.receive_text()
                except WebSocketDisconnect as e:
                    return e.code
            return None

        assert shown_the_door("nope") == 4401  # an unknown token

        with nobody.websocket_connect("/helper", headers={"Authorization": f"Bearer {token}"}) as helper, \
                ann.websocket_connect("/ws") as ann_ws, bob.websocket_connect("/ws") as bob_ws:
            assert ann_ws.receive_json()["cameras"] == 0 and bob_ws.receive_json()["cameras"] == 0
            helper.send_json({"t": "hello", "cameras": 2, "calibrated": 2, "platform": "linux", "version": "h1"})
            hello = ann_ws.receive_json()
            assert hello["cameras"] == 2 and hello["helper"] is True and hello["version"]
            assert ann.get("/api/me").json()["helper"] == {"connected": True, "cameras": 2, "platform": "linux"}
            assert bob.get("/api/me").json()["helper"] is None

            dart = {"type": "dart", "seg": 20, "mult": 3, "x": 1.0, "y": 2.0}
            helper.send_json({"t": "event", "event": dart})
            assert ann_ws.receive_json() == dart

            # (The app's questions to its cameras, and their answers, are tested against a real
            # running host in tests/test_link.py: this test client runs each connection on an
            # event loop of its own, which a real server never does.)
            assert bob.get("/api/status").status_code == 503  # Bob has no helper: Ann's is not his

            # "Disconnect cameras" on the site
            assert ann.delete("/api/helper").json() == {"ok": True}
        assert ann.get("/api/me").json()["helper"] is None
        assert ann.get("/api/status").status_code == 503
        assert shown_the_door(token) == 4401  # a forgotten helper is not let back in

        # guessing codes
        for _ in range(5):
            assert bob.post("/api/pair/claim", json={"code": "QQQQQQ"}).status_code == 404
        r = bob.post("/api/pair/claim", json={"code": "QQQQQQ"})
        assert r.status_code == 429 and r.json()["detail"] == "Too many tries. Wait a minute."

        # --- what the trial records ---
        store = app.state.store
        assert store.count_events(acc["id"], "signup") == 1 and store.count_events(acc["id"], "paired") == 1
        assert store.count_events(acc["id"], "signin") == 1  # the second device; signing up was the first
        assert nobody.post("/api/events", json={"events": []}).status_code == 401
        r = ann.post("/api/events", json={"events": [{"kind": "open", "ts": 5, "detail": {"w": 800}},
                                                     {"kind": "correction", "ts": 6, "detail": {"was": {"seg": 20, "mult": 3}}},
                                                     {"kind": "signup", "ts": 7}, {"kind": "signin", "ts": 8}, {"kind": "nonsense"}]})
        assert r.json() == {"kept": 2}
        assert store.count_events(acc["id"], "signup") == 1 and store.count_events(acc["id"], "correction") == 1
        assert store.count_events(acc["id"], "signin") == 1  # an app can't add sign-ins
        assert ann.post("/api/events", json={"events": "rubbish"}).status_code in (200, 422)

        assert nobody.post("/api/feedback", json={"text": "hi"}).status_code == 401
        r = ann.post("/api/feedback", json={"text": "   "})
        assert r.status_code == 400 and r.json()["detail"]
        assert ann.post("/api/feedback", json={"text": " The 20s are <b>great</b> ", "app": {"version": "v9"}}).json() == {"ok": True}
        said = store.feedback()[0]
        assert said["text"] == "The 20s are <b>great</b>" and said["detail"]["app"] == {"version": "v9"}
        assert "helper" in said["detail"]

        # a helper sends a problem report up
        import io, zipfile
        def packed(files):
            data = io.BytesIO()
            with zipfile.ZipFile(data, "w") as z:
                for name, content in files.items():
                    z.writestr(name, content)
            return data.getvalue()
        p = nobody.post("/api/pair/start").json()
        ann.post("/api/pair/claim", json={"code": p["code"]})
        up_token = nobody.post("/api/pair/collect", json={"code": p["code"], "secret": p["secret"]}).json()["token"]
        bearer = {"Authorization": f"Bearer {up_token}"}
        report_json = json.dumps({"expected": "", "note": "", "looks": [{"summary": "2 s ago: scored T20"}], "now": {}})
        body = packed({"report.json": report_json, "frame-01.png": b"PNG" * 100, "../evil.png": b"x", "run.sh": b"x"})
        assert nobody.post("/api/helper/reports/r1", content=body).status_code == 401
        assert nobody.post("/api/helper/reports/r1", content=body, headers={"Authorization": "Bearer nope"}).status_code == 401
        assert nobody.post("/api/helper/reports/..%2Fx", content=body, headers=bearer).status_code in (400, 404, 405)
        assert not (Path(tmp) / "reports" / "x").exists() and not (Path(tmp) / "x").exists()
        assert nobody.post("/api/helper/reports/r1", content=b"not a zip", headers=bearer).status_code == 400
        assert nobody.post("/api/helper/reports/r1", content=body, headers=bearer).json() == {"ok": True}
        folder = Path(tmp) / "reports" / acc["id"] / "r1"
        assert sorted(f.name for f in folder.iterdir()) == ["frame-01.png", "report.json"]
        rep1 = store.report(acc["id"], "r1")
        assert rep1["summary"] == "2 s ago: scored T20" and rep1["bytes"] == 300 + len(report_json)
        # sent again with the person's note: the picture stays, the note arrives, the size is not counted twice
        noted = json.dumps({"expected": "T19", "note": "hit the wire", "looks": [], "now": {"summary": "Now"}})
        assert nobody.post("/api/helper/reports/r1", content=packed({"report.json": noted}), headers=bearer).json() == {"ok": True}
        rep1 = store.report(acc["id"], "r1")
        assert rep1["expected"] == "T19" and rep1["note"] == "hit the wire" and rep1["bytes"] == 300 + len(noted)
        assert (folder / "frame-01.png").exists() and len(store.reports(acc["id"])) == 1
        # too much: refused, and what is there is untouched
        r = nobody.post("/api/helper/reports/r2", content=b"x", headers={**bearer, "Content-Length": str(61 * 2**20)})
        assert r.status_code == 413
        with store.connect() as c:
            c.execute("UPDATE reports SET bytes = ? WHERE id = 'r1'", (2**30,))
        assert nobody.post("/api/helper/reports/r2", content=body, headers=bearer).status_code == 413  # the account's room is full
        assert not (Path(tmp) / "reports" / acc["id"] / "r2").exists()
        ann.delete("/api/helper")

        # --- the private pages: for admins (Bob), and not there at all for anyone else ---
        ann.patch("/api/me", json={"nickname": "<b>Ann</b>"})
        pages = ["/admin", "/admin/reports", "/admin/feedback", f"/admin/reports/{acc['id']}/r1",
                 f"/admin/reports/{acc['id']}/r1/frame-01.png", f"/admin/reports/{acc['id']}/r1/download.zip"]
        for path in pages:
            assert ann.get(path).status_code == 404, path
            assert nobody.get(path).status_code == 404, path
            assert bob.get(path).status_code == 200, path
        got = bob.get("/admin")
        assert "default-src 'none'" in got.headers["content-security-policy"]  # no script runs there, even one let through
        home = got.text
        assert "&lt;b&gt;Ann&lt;/b&gt;" in home and "<b>Ann</b>" not in home     # typed text is shown as text
        assert "Bob" in home and "(admin)" in home and "Accuracy" in home and "<script" not in home.lower()
        assert "Sign-ins" in home
        # sorted and filtered from the address, still with no script
        by_name = bob.get("/admin?sort=who&dir=asc").text
        assert by_name.index("&lt;b&gt;Ann") < by_name.index("<b>Bob")
        by_name = bob.get("/admin?sort=who&dir=desc").text
        assert by_name.index("<b>Bob") < by_name.index("&lt;b&gt;Ann") and "Who ▼" in by_name
        only = bob.get("/admin?q=bob&sort=games&dir=desc").text
        assert "<b>Bob" in only and "&lt;b&gt;Ann" not in only and "Showing 1 of" in only
        assert 'name="sort" value="games"' in only and "q=bob" in only   # sorting keeps the filter, filtering keeps the sort
        assert "Nobody matches" in bob.get("/admin?q=zzz").text
        assert bob.get("/admin?sort=nonsense&setup=nonsense&reached=99&seen=x").status_code == 200
        assert "<script" not in only.lower()
        said_page = bob.get("/admin/feedback").text
        assert "The 20s are &lt;b&gt;great&lt;/b&gt;" in said_page and "<b>great</b>" not in said_page
        listing = bob.get("/admin/reports").text
        assert "hit the wire" in listing and "T19" in listing and f"/admin/reports/{acc['id']}/r1" in listing
        assert "hit the wire" in bob.get(f"/admin/reports/{acc['id']}/r1").text
        assert bob.get(f"/admin/reports/{acc['id']}/r1/frame-01.png").content == b"PNG" * 100
        got = zipfile.ZipFile(io.BytesIO(bob.get(f"/admin/reports/{acc['id']}/r1/download.zip").content))
        assert sorted(got.namelist()) == ["r1/frame-01.png", "r1/report.json"]
        for missing in [f"/admin/reports/{acc['id']}/nope", f"/admin/reports/{acc['id']}/r1/host.db",
                        f"/admin/reports/{acc['id']}/r1/..%2Freport.json", "/admin/reports/zzzz/r1",
                        f"/admin/reports/{acc['id']}/r1/missing.png"]:
            assert bob.get(missing).status_code == 404, missing
        ann.patch("/api/me", json={"nickname": "Annie"})

        # an account's helper is dropped with the account (checked after the delete below)
        p = nobody.post("/api/pair/start").json()
        ann2.post("/api/pair/claim", json={"code": p["code"]})
        ann_token = nobody.post("/api/pair/collect", json={"code": p["code"], "secret": p["secret"]}).json()["token"]

        assert ann.patch("/api/me", json={"nickname": "Annie"}).json()["account"]["nickname"] == "Annie"
        assert ann2.get("/api/me").json()["account"]["nickname"] == "Annie"
        assert ann.patch("/api/me", json={"nickname": " "}).status_code == 400

        # a page on another site cannot act as the person
        evil = {"Origin": "https://evil.example"}
        assert ann.post("/api/players", json={"name": "Evil"}, headers=evil).status_code == 403
        assert ann.post("/auth/signout", headers=evil).status_code == 403
        assert ann.post("/api/players", json={"name": "Fine"}, headers={"Origin": "http://testserver"}).status_code == 200

        # sign out on one device leaves the other signed in
        assert ann.post("/auth/signout").json() == {"ok": True}
        assert ann.get("/api/players").status_code == 401 and ann2.get("/api/players").status_code == 200

        # delete: gone everywhere, and nothing of it left
        assert ann2.delete("/api/me").json() == {"ok": True}
        assert ann2.get("/api/players").status_code == 401
        assert not (Path(tmp) / "accounts" / acc["id"]).exists()
        assert shown_the_door(ann_token) == 4401
        assert not (Path(tmp) / "reports" / acc["id"]).exists() and store.feedback() == []
        assert [p["name"] for p in bob.get("/api/players").json()] == ["Bob"]  # untouched
        assert ann.post("/auth/google", json={"credential": "tok-ann"}).json()["new"] is True  # a fresh start

        # with "dev" off the cookie is only ever sent over https
        # the home page at an address of its own: the app is told both, at either address
        split = TestClient(host.create(Path(tmp) / "h", {**settings, "site": "https://app.darts.example/",
                                                         "home": "https://darts.example"}, check_google=check))
        assert (split.get("/api/me").json()["home"], split.get("/api/me").json()["app"]) == ("https://darts.example", "https://app.darts.example")
        same = TestClient(host.create(Path(tmp) / "o", {**settings, "site": "https://darts.example", "home": "https://darts.example/"}, check_google=check))
        assert same.get("/api/me").json()["home"] is None and same.get("/api/me").json()["app"] is None

        strict = TestClient(host.create(Path(tmp) / "s", {**settings, "dev": False}, check_google=check))
        r = strict.post("/auth/google", json={"credential": "tok-ann"})
        assert "secure" in r.headers["set-cookie"].lower()

        # Sign in with Apple, where it is set up. Apple gives the name to the page, the first time only.
        apple = host.create(Path(tmp) / "a", {**settings, "apple_client_id": "apple-123"}, check_google=check, check_apple=check)
        cat, dan = TestClient(apple), TestClient(apple)
        assert cat.get("/api/me").json()["apple_client_id"] == "apple-123"
        assert cat.post("/auth/apple", json={"credential": "garbage"}).status_code == 401
        r = cat.post("/auth/apple", json={"credential": "tok-cat", "name": "  Catherine-Elizabeth of  the Fens "})
        assert r.json()["new"] is True and r.json()["account"]["nickname"] == "Catherine-Elizabeth of t"
        assert [p["name"] for p in cat.get("/api/players").json()] == ["Catherine-Elizab"]  # a player's name is shorter
        r = cat.post("/auth/apple", json={"credential": "tok-cat"})  # later sign-ins come with no name
        assert r.json()["new"] is False and r.json()["account"]["nickname"] == "Catherine-Elizabeth of t"
        # the same number from Google is a different person
        r = dan.post("/auth/google", json={"credential": "tok-ann"})
        assert r.json()["new"] is True and r.json()["account"]["id"] != cat.get("/api/me").json()["account"]["id"]
        # no name from anywhere
        apple.state.store.delete_account(cat.get("/api/me").json()["account"]["id"])
        r = cat.post("/auth/apple", json={"credential": "tok-cat"})
        assert r.json()["account"]["nickname"] == "Player"
        assert [p["name"] for p in cat.get("/api/players").json()] == ["Player"]

        # --- signing in by email: a code to type, or the link, each good once ---
        assert TestClient(host.create(Path(tmp) / "n", {**settings, "dev": False}, check_google=check)).get("/api/me").json()["email"] is False
        post = []

        def send(to, message):
            if to == "down@example.com":
                raise mail.NotSent("no")
            post.append((to, message))

        mailed = host.create(Path(tmp) / "e", {**settings, "site": "https://darts.example/"}, check_google=check, send_email=send)
        eve, eve2, mal = TestClient(mailed), TestClient(mailed), TestClient(mailed)
        assert eve.post("/auth/email/start", json={"email": "not an address"}).status_code == 400
        assert eve.post("/auth/email/start", json={"email": " Eve@Example.com "}).json() == {"sent": True}
        to, message = post[-1]
        code = message["subject"][:7].replace(" ", "")
        link = message["text"].split("https://darts.example/#/in/")[1].split()[0]
        assert to == "eve@example.com" and len(code) == 6 and code.isdigit() and code[:3] in message["html"]
        r = eve.post("/auth/email/start", json={"email": "eve@example.com"})  # not a second one straight away
        assert r.status_code == 429 and len(post) == 1
        assert mal.post("/auth/email", json={"email": "eve@example.com", "code": "x"}).status_code == 401
        assert mal.post("/auth/email", json={"email": "someone@else.example", "code": code}).status_code == 401
        assert mal.post("/auth/email/link", json={"token": "guess"}).status_code == 401
        r = eve.post("/auth/email", json={"email": "EVE@example.com", "code": f"{code[:3]} {code[3:]}"})  # typed as it is shown
        acc = r.json()["account"]
        assert r.json()["new"] is True and acc["nickname"] == "Player" and acc["admin"] is True and "ds_session" in r.cookies
        assert r.json()["named"] is False  # an email says nothing of who they are: the app asks
        assert [p["name"] for p in eve.get("/api/players").json()] == ["Player"]
        # they give their name: the account and its player both take it
        assert eve.patch("/api/me", json={"nickname": " Eve ", "player": True}).json()["account"]["nickname"] == "Eve"
        assert [p["name"] for p in eve.get("/api/players").json()] == ["Eve"]
        eve.post("/api/players", json={"name": "Zed"})
        assert eve.patch("/api/me", json={"nickname": "Zed", "player": True}).status_code == 400  # a player has it already
        assert eve.get("/api/me").json()["account"]["nickname"] == "Eve"                       # and nothing changed
        assert eve.patch("/api/me", json={"nickname": "Evie"}).json()["account"]["nickname"] == "Evie"
        assert sorted(p["name"] for p in eve.get("/api/players").json()) == ["Eve", "Zed"]  # the player only when asked
        assert eve2.post("/auth/email", json={"email": "eve@example.com", "code": code}).status_code == 401  # used up
        assert eve2.post("/auth/email/link", json={"token": link}).status_code == 401                        # and its link
        kept = b"".join(p.read_bytes() for p in (Path(tmp) / "e").glob("host.db*"))
        assert b"eve@example.com" not in kept and code.encode() not in kept and link.encode() not in kept

        # the link, opened on another device: the same account
        with mailed.state.store.connect() as c:
            c.execute("UPDATE email_codes SET sent = 0")  # a minute later
        assert eve.post("/auth/email/start", json={"email": "eve@example.com"}).json() == {"sent": True}
        link = post[-1][1]["text"].split("/#/in/")[1].split()[0]
        r = eve2.post("/auth/email/link", json={"token": link})
        assert r.json()["new"] is False and r.json()["account"]["id"] == acc["id"] and r.json()["account"]["admin"] is True
        assert eve2.post("/auth/email/link", json={"token": link}).status_code == 401

        # five wrong codes and the right one no longer works
        assert mal.post("/auth/email/start", json={"email": "fay@example.com"}).json() == {"sent": True}
        code = post[-1][1]["subject"][:7].replace(" ", "")
        wrong = f"{(int(code) + 1) % 10**6:06d}"
        for _ in range(hoststore.EMAIL_TRIES):
            assert mal.post("/auth/email", json={"email": "fay@example.com", "code": wrong}).status_code == 401
        assert mal.post("/auth/email", json={"email": "fay@example.com", "code": code}).status_code == 401

        # an email that could not be sent can be asked for again at once
        assert mal.post("/auth/email/start", json={"email": "down@example.com"}).status_code == 502
        assert mal.post("/auth/email/start", json={"email": "down@example.com"}).status_code == 502
    analytics()
    print("OK")


def analytics():
    """Cloudflare's visitor counter: on the hosted pages only when "analytics_token" is set."""
    with tempfile.TemporaryDirectory() as tmp:
        plain = TestClient(host.create(Path(tmp) / "a", {"google_client_id": "client-123", "dev": True}))
        assert "cloudflareinsights" not in plain.get("/").text
        counted = TestClient(host.create(Path(tmp) / "b", {"google_client_id": "client-123", "dev": True,
                                                          "analytics_token": "abc123"}))
        beacon = """data-cf-beacon='{"token": "abc123"}'"""
        for page in ("/", "/index.html", "/faq.html", "/download.html", "/opensource.html", "/privacy.html"):
            r = counted.get(page)
            head = r.text.lower().split("</head>")[0]
            assert r.status_code == 200 and "static.cloudflareinsights.com/beacon.min.js" in head, page
            assert beacon in r.text and r.headers["content-type"].startswith("text/html"), page
            assert int(r.headers["content-length"]) == len(r.content), page
        assert "cloudflareinsights" not in counted.get("/app.js").text  # only pages, not the app's code
        # a token that would break out of the tag is refused
        try:
            host.create(Path(tmp) / "c", {"google_client_id": "client-123", "analytics_token": "x'><script>"})
            raise AssertionError("bad token accepted")
        except ValueError:
            pass


if __name__ == "__main__":
    main()
