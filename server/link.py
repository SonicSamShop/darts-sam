"""The helper's line to the hosted site.

A person's cameras are plugged into a computer at home (this server, app.py).
To score in the hosted app (host.py) that computer connects *out* to the site
and stays connected: darts go up the line, and the app's questions (camera
pictures, calibration, reports) come down it and are answered by asking this
server itself. relay.py at the other end describes the messages.

Nothing here runs until the person asks to be paired (pair()) or a token from
an earlier pairing is saved. A server that was never paired contacts nothing,
unless its owner agreed to share what it records (share.py).
"""
import asyncio
import base64
import json
import time
import urllib.error
import urllib.request

import websockets

DEFAULT_HOST: str | None = "https://app.dartssam.co.uk"  # the hosted site; "host" in config.json or --host overrides
FORGOTTEN = 4401                 # the site's close code for "not paired any more"
PASSED = ("/api/status", "/api/reset", "/api/cameras", "/api/reports")  # and everything under the last two


def ws_url(host: str) -> str:
    return "ws" + host.rstrip("/")[4:] + "/helper"  # http -> ws, https -> wss


def ALLOWED(path: str) -> bool:
    """May the site ask this of the helper? The site keeps the same list; the
    helper does not take its word for it."""
    p = path.split("?", 1)[0]
    if ".." in p:
        return False
    return p in PASSED or p.startswith(("/api/cameras/", "/api/reports/"))


class Link:
    """answer(method, path, content_type, body) -> (status, content_type, body):
    asks this server; an ordinary blocking function. hello() -> what to tell the
    site about this helper now. forgotten(): the site no longer knows us."""

    def __init__(self, host: str, token: str, answer, hello, forgotten=lambda: None):
        self.host, self.token = host, token
        self.answer, self.hello, self.forgotten = answer, hello, forgotten
        self.connected = False
        self._ws = None
        self._loop = None
        self._stop = None

    async def run(self):
        """Stay connected until stop(), or until the site says we are forgotten."""
        self._loop = asyncio.get_running_loop()
        self._stop = asyncio.Event()
        wait = 2
        while not self._stop.is_set():
            began, code = time.monotonic(), None
            try:
                async with websockets.connect(ws_url(self.host), max_size=32 * 2**20,
                                              additional_headers={"Authorization": f"Bearer {self.token}"}) as ws:
                    self._ws, self.connected = ws, True
                    await self._send(ws, {"t": "hello", **self.hello()})
                    tasks = set()
                    try:
                        async for text in ws:
                            task = asyncio.ensure_future(self._serve(ws, text))
                            tasks.add(task)
                            task.add_done_callback(tasks.discard)
                    finally:
                        code = ws.close_code
                        for task in tasks:
                            task.cancel()
            except websockets.ConnectionClosed as e:
                code = e.rcvd.code if e.rcvd else code
            except (OSError, websockets.WebSocketException, asyncio.TimeoutError):
                pass  # the site, or the internet, is not there just now
            finally:
                self._ws, self.connected = None, False
            if code == FORGOTTEN:
                self.forgotten()
                return
            if time.monotonic() - began > 30:
                wait = 2  # it was a good connection: start patiently again
            try:
                await asyncio.wait_for(self._stop.wait(), wait)
            except asyncio.TimeoutError:
                wait = min(wait * 2, 30)

    def stop(self):
        if self._loop:
            self._loop.call_soon_threadsafe(self._halt)

    def _halt(self):
        self._stop.set()
        if self._ws:
            asyncio.ensure_future(self._ws.close())

    @staticmethod
    async def _send(ws, message: dict):
        try:
            await ws.send(json.dumps(message))
        except websockets.ConnectionClosed:
            pass

    async def _serve(self, ws, text: str):
        try:
            m = json.loads(text)
            if m["t"] != "req":
                return
            rid, method, path = m["id"], m["method"], m["path"]
            body = base64.b64decode(m.get("body") or "")
        except (ValueError, TypeError, KeyError):
            return
        if not ALLOWED(path):
            status, kind, out = 404, "application/json", b'{"detail": "Not passed to the cameras."}'
        else:
            try:
                status, kind, out = await asyncio.to_thread(self.answer, method, path, m.get("type"), body)
            except Exception as e:
                status, kind, out = 502, "application/json", json.dumps({"detail": f"The cameras' computer failed: {e}"}).encode()
        await self._send(ws, {"t": "res", "id": rid, "status": status, "type": kind, "body": base64.b64encode(out).decode()})
        if method != "GET":
            await self._send(ws, {"t": "hello", **self.hello()})  # cameras or calibration may have changed

    # ---------- from the rest of the server, on any thread ----------
    def _later(self, message: dict):
        ws = self._ws
        if ws is not None and self._loop is not None:
            asyncio.run_coroutine_threadsafe(self._send(ws, message), self._loop)

    def send_event(self, event: dict):
        """A dart or a take-out, for the person's apps. Lost if not connected: it is live or nothing."""
        self._later({"t": "event", "event": event})

    def say_hello(self):
        self._later({"t": "hello", **self.hello()})


def _post(url: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=json.dumps(body or {}).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, {}


async def pair(host: str, show, every: float = 2) -> str | None:
    """Pair this helper with someone's account on the site. show(code, url) is
    called with the code to display; the person types it on the site while
    signed in. Returns the token to connect with, or None if the code ran out.
    Raises OSError if the site cannot be reached."""
    host = host.rstrip("/")
    status, started = await asyncio.to_thread(_post, f"{host}/api/pair/start")
    if status != 200:
        raise OSError(f"the site answered {status}")
    code = started["code"]
    show(code, f"{host}/#/pair/{code}")
    until = time.monotonic() + started.get("expires_in", 600)
    while time.monotonic() < until:
        await asyncio.sleep(every)
        try:
            status, got = await asyncio.to_thread(_post, f"{host}/api/pair/collect", {"code": code, "secret": started["secret"]})
        except OSError:
            continue  # a blip: the code is still good
        if status == 404:
            return None
        if got.get("token"):
            return got["token"]
    return None
