# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Pages on other websites are kept away from the server at home (server/guard.py).
Run: python -m tests.test_guard"""
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from server.guard import LocalOnly, home_name


def main():
    for ok in ["my-computer.local:8000", "my-computer", "192.168.1.50:8000", "127.0.0.1", "localhost:8000",
               "[::1]:8000", "[fe80::1]", "darts.lan", "pc.home.arpa", "box.internal", "My-Computer.Local"]:
        assert home_name(ok), ok
    for bad in ["evil.com", "evil.com:8000", "192.168.1.50.evil.com", "local.evil.com", "", ":8000", "rebind.example.org"]:
        assert not home_name(bad), bad
    assert home_name("darts.example.com", {"darts.example.com"})  # named in config.json's "hosts"

    app = FastAPI()
    app.add_middleware(LocalOnly, extra=lambda: ["darts.example.com"])

    @app.get("/api/status")
    def status():
        return {"ok": True}

    @app.post("/api/link/pair")
    def pair():
        return {"ok": True}

    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        await socket.accept()
        await socket.send_json({"hi": 1})
        await socket.close()

    def client(host):
        return TestClient(app, base_url=f"http://{host}")

    home = client("my-computer.local:8000")
    assert home.get("/api/status").status_code == 200
    assert home.post("/api/link/pair").status_code == 200  # curl, the app's own relay: no Origin
    assert home.post("/api/link/pair", headers={"origin": "http://my-computer.local:8000"}).status_code == 200
    # a page on another site, sending through the owner's browser
    assert home.post("/api/link/pair", headers={"origin": "https://evil.com"}).status_code == 403
    assert home.get("/api/status", headers={"origin": "https://evil.com"}).status_code == 200  # reading it tells them nothing
    # a rebound name: the browser thinks it is still talking to evil.com
    assert client("evil.com").get("/api/status").status_code == 403
    assert client("evil.com").post("/api/link/pair", headers={"origin": "http://evil.com"}).status_code == 403
    assert client("darts.example.com").get("/api/status").status_code == 200
    # the live line too
    # (a full address: the test client otherwise calls every websocket's host "testserver")
    with home.websocket_connect("ws://my-computer.local:8000/ws", headers={"origin": "http://my-computer.local:8000"}) as s:
        assert s.receive_json() == {"hi": 1}
    for host, origin in [("my-computer.local:8000", "https://evil.com"), ("evil.com", "http://evil.com")]:
        try:
            with client(host).websocket_connect(f"ws://{host}/ws", headers={"origin": origin}) as s:
                s.receive_json()
            raise AssertionError(f"{host} / {origin} should have been refused")
        except WebSocketDisconnect:
            pass
    print("OK")


if __name__ == "__main__":
    main()
