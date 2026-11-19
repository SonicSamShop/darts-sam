# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The helper's line to the host, against a real running host. Run: python -m tests.test_link"""
import asyncio
import json
import socket
import tempfile
import threading
import time
from pathlib import Path

import httpx
import uvicorn
import websockets

from server import host, link, reportsync


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_host(folder: Path, port: int):
    """The real host on a real port, in a thread. Returns (app, stop)."""
    app = host.create(folder, {"google_client_id": "c", "admins": [], "dev": True},
                      check_google=lambda cred, cid: {"sub": "g-ann", "email": "ann@example.com", "name": "Ann"})
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="critical"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.02)

    def stop():
        server.should_exit = True
        server.force_exit = True  # don't wait for open lines to finish
        thread.join(10)
    return app, stop


async def until(fn, seconds=5):
    end = time.monotonic() + seconds
    while True:
        if await asyncio.to_thread(fn):
            return
        assert time.monotonic() < end, "waited too long"
        await asyncio.sleep(0.05)


async def main():
    assert link.ws_url("https://darts.example.com") == "wss://darts.example.com/helper"
    assert link.ws_url("http://localhost:8000/") == "ws://localhost:8000/helper"
    for ok in ["/api/status", "/api/cameras", "/api/cameras/0/snapshot.jpg?overlay=1", "/api/reset",
               "/api/reports", "/api/reports/x/y.png"]:
        assert link.ALLOWED(ok), ok
    for no in ["/api/players", "/api/simulate", "/api/camerasx", "/api/link", "/", "/api/reportsx",
               "/api/status/../players", "/api/cameras/../players"]:
        assert not link.ALLOWED(no), no

    with tempfile.TemporaryDirectory() as tmp:
        port = free_port()
        base = f"http://127.0.0.1:{port}"
        app, stop = start_host(Path(tmp), port)
        ann = httpx.Client(base_url=base, timeout=40)
        get = lambda path: asyncio.to_thread(ann.get, path)  # noqa: E731  (off the loop the link shares)
        try:
            r = ann.post("/auth/google", json={"credential": "x"})
            account_id = r.json()["account"]["id"]
            p = ann.post("/api/pair/start").json()
            assert ann.post("/api/pair/claim", json={"code": p["code"]}).json() == {"ok": True}
            token = ann.post("/api/pair/collect", json={"code": p["code"], "secret": p["secret"]}).json()["token"]

            calls, state, gone = [], {"cameras": 2}, []

            def answer(method, path, content_type, body):
                calls.append((method, path, content_type, body))
                if path == "/api/cameras/slow":
                    time.sleep(0.5)
                if method == "POST":
                    state["cameras"] = 3
                if path == "/api/cameras/boom":
                    raise RuntimeError("camera fell off")
                return 200, "application/octet-stream", b"x" * 2_000_000 if "big" in path else b"hi:" + path.encode()

            def hello():
                return {"cameras": state["cameras"], "calibrated": 1, "platform": "test", "version": "h1"}

            ln = link.Link(base, token, answer, hello, forgotten=lambda: gone.append(1))
            task = asyncio.ensure_future(ln.run())
            me = lambda: ann.get("/api/me").json()["helper"]  # noqa: E731
            await until(lambda: me() == {"connected": True, "cameras": 2, "platform": "test"})
            assert ln.connected

            # the app's questions go down the line and the answers come back
            r = await get("/api/cameras/0/snapshot.jpg?overlay=1")
            assert r.status_code == 200 and r.content == b"hi:/api/cameras/0/snapshot.jpg?overlay=1"
            assert r.headers["content-type"] == "application/octet-stream"
            assert calls[-1] == ("GET", "/api/cameras/0/snapshot.jpg?overlay=1", None, b"")
            assert len((await get("/api/reports/big/frame.png")).content) == 2_000_000  # megabytes arrive whole
            slow, quick = await asyncio.gather(get("/api/cameras/slow"), get("/api/status"))  # one slow, one not
            assert slow.content == b"hi:/api/cameras/slow" and quick.content == b"hi:/api/status"
            r = await get("/api/cameras/boom")
            assert r.status_code == 502 and "camera fell off" in r.json()["detail"]
            assert [p["name"] for p in (await get("/api/players")).json()] == ["Ann"]  # the account's own data: not sent to the helper
            assert not any(c[1] == "/api/players" for c in calls)

            # a change: its body arrives, and a fresh hello follows
            r = await asyncio.to_thread(lambda: ann.post("/api/cameras/refresh", json={"a": 1}))
            assert r.status_code == 200 and calls[-1][0] == "POST" and calls[-1][2] == "application/json"
            assert json.loads(calls[-1][3]) == {"a": 1}
            await until(lambda: me()["cameras"] == 3)

            # a dart reaches the app's live line
            cookie = f"ds_session={ann.cookies['ds_session']}"
            async with websockets.connect(f"ws://127.0.0.1:{port}/ws", additional_headers={"Cookie": cookie}) as app_ws:
                first = json.loads(await app_ws.recv())
                assert first["type"] == "hello" and first["helper"] is True and first["cameras"] == 1
                dart = {"type": "dart", "seg": 5, "mult": 1, "x": 0, "y": 0}
                ln.send_event(dart)
                assert json.loads(await asyncio.wait_for(app_ws.recv(), 3)) == dart

            # the internet drops: the site goes away and comes back; the link returns by itself
            await asyncio.to_thread(stop)
            await until(lambda: not ln.connected)
            ln.send_event(dart)  # said into the void: harmless
            app, stop = await asyncio.to_thread(start_host, Path(tmp), port)
            await until(lambda: me() and me()["connected"], seconds=12)

            # disconnected on the site: told to forget, and it stops for good
            assert (await asyncio.to_thread(ann.delete, "/api/helper")).json() == {"ok": True}
            await until(lambda: gone == [1])
            await asyncio.wait_for(task, 5)  # run() returned
            await asyncio.sleep(2.5)
            assert me() is None and not ln.connected

            # stop() ends a running link
            p = ann.post("/api/pair/start").json()
            ann.post("/api/pair/claim", json={"code": p["code"]})
            token = ann.post("/api/pair/collect", json={"code": p["code"], "secret": p["secret"]}).json()["token"]
            ln2 = link.Link(base, token, answer, hello)
            task2 = asyncio.ensure_future(ln2.run())
            await until(lambda: me()["connected"])
            ln2.stop()
            await asyncio.wait_for(task2, 5)
            await until(lambda: not me()["connected"])
            ann.delete("/api/helper")

            # pairing, end to end
            shown = []
            pairing = asyncio.ensure_future(link.pair(base, lambda code, url: shown.append((code, url)), every=0.2))
            await until(lambda: shown)
            code, url = shown[0]
            assert url == f"{base}/#/pair/{code}"
            assert (await asyncio.to_thread(lambda: ann.post("/api/pair/claim", json={"code": code.lower()}))).json() == {"ok": True}
            token2 = await asyncio.wait_for(pairing, 6)
            assert app.state.store.helper_account(token2) == account_id

            # a problem report goes up from the helper's folder to the account
            root = Path(tmp) / "helper-reports"
            folder = root / "2026-11-16_10-00-00"
            folder.mkdir(parents=True)
            (folder / "report.json").write_text(json.dumps({"expected": "", "note": "", "looks": [{"summary": "scored T20"}]}))
            (folder / "frame-01.png").write_bytes(b"P" * 1_500_000)
            reportsync.mark(folder, "now")
            up = reportsync.Uploader(root, base, token2)
            await asyncio.to_thread(up.once)
            got = app.state.store.report(account_id, "2026-11-16_10-00-00")
            assert got["summary"] == "scored T20" and got["bytes"] > 1_500_000
            assert not (folder / reportsync.MARKER).exists()
            site_copy = app.state.store.report_folder(account_id, "2026-11-16_10-00-00")
            assert (site_copy / "frame-01.png").stat().st_size == 1_500_000
            (folder / "report.json").write_text(json.dumps({"expected": "T19", "note": "wire", "looks": []}))
            reportsync.noted(folder)  # the note was saved after the report had gone
            await asyncio.to_thread(up.once)
            got = app.state.store.report(account_id, "2026-11-16_10-00-00")
            assert got["expected"] == "T19" and got["note"] == "wire" and (site_copy / "frame-01.png").exists()
            # an uploader whose token the site does not know leaves the report waiting
            reportsync.mark(folder, "now")
            await asyncio.to_thread(reportsync.Uploader(root, base, "nope").once)
            assert (folder / reportsync.MARKER).read_text() == "now"

            # a site that isn't there
            try:
                await link.pair(f"http://127.0.0.1:{free_port()}", lambda *a: None)
                raise AssertionError("paired with nothing")
            except OSError:
                pass
        finally:
            stop()
    print("OK")


if __name__ == "__main__":
    asyncio.run(main())
