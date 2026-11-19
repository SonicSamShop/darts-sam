# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The relay between helpers and apps. Run: python -m tests.test_relay"""
import asyncio
import base64
import json

from server.relay import NoHelper, Relay, TimedOut


class Sock:
    def __init__(self):
        self.sent, self.closed = [], None

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def close(self, code=1000):
        self.closed = code


class Broken(Sock):
    async def send_text(self, text):
        raise RuntimeError("gone")


async def main():
    r = Relay()
    app_a, app_a2, app_b, helper_a = Sock(), Sock(), Sock(), Sock()

    # an app with no helper: hello, no cameras
    await r.app_joined("a", app_a, "v1")
    assert app_a.sent == [{"type": "hello", "cameras": 0, "helper": False, "version": "v1"}]
    assert not r.connected("a") and r.cameras("a") == 0
    try:
        await r.request("a", "GET", "/api/status", None, b"")
        raise AssertionError("answered with no helper")
    except NoHelper:
        pass

    # the helper arrives and says hello: every app of that account hears, no one else
    await r.app_joined("b", app_b, "v1")
    await r.helper_joined("a", helper_a)
    hello = {"t": "hello", "cameras": 3, "calibrated": 3, "platform": "linux", "version": "h1"}
    assert await r.helper_said("a", json.dumps(hello)) == {"cameras": 3, "calibrated": 3, "platform": "linux", "version": "h1"}
    assert app_a.sent[-1] == {"type": "hello", "cameras": 3, "helper": True, "version": "v1"}
    assert len(app_b.sent) == 1
    await r.app_joined("a", app_a2, "v1")
    assert app_a2.sent == [{"type": "hello", "cameras": 3, "helper": True, "version": "v1"}]
    assert r.connected("a") and r.cameras("a") == 3 and not r.connected("b")

    # a dart goes to that account's apps only
    dart = {"type": "dart", "seg": 20, "mult": 3, "x": 1.0, "y": 2.0}
    assert await r.helper_said("a", json.dumps({"t": "event", "event": dart})) is None
    assert app_a.sent[-1] == dart and app_a2.sent[-1] == dart and len(app_b.sent) == 1
    await r.helper_said("a", "not json")  # rubbish from a helper is ignored
    await r.helper_said("a", json.dumps([1, 2]))
    await r.helper_said("a", json.dumps({"t": "res", "id": "nobody-asked", "status": 200, "type": None, "body": ""}))
    # a helper cannot pose as the host's own hello
    n = len(app_a.sent)
    await r.helper_said("a", json.dumps({"t": "event", "event": {"type": "hello", "cameras": 99, "version": "evil"}}))
    assert len(app_a.sent) == n

    # a request goes down and its answer comes back, megabytes and all
    big = bytes(range(256)) * 8192  # 2 MB

    async def answer():
        while not any(m.get("t") == "req" for m in helper_a.sent):
            await asyncio.sleep(0)
        q = [m for m in helper_a.sent if m.get("t") == "req"][-1]
        assert q["method"] == "POST" and q["path"] == "/api/cameras/0/calibration?x=1"
        assert q["type"] == "application/json" and base64.b64decode(q["body"]) == b'{"points": []}'
        await r.helper_said("a", json.dumps({"t": "res", "id": q["id"], "status": 200, "type": "image/jpeg",
                                             "body": base64.b64encode(big).decode()}))
    asyncio.ensure_future(answer())
    got = await r.request("a", "POST", "/api/cameras/0/calibration?x=1", "application/json", b'{"points": []}')
    assert got == (200, "image/jpeg", big)

    # two at once get their own answers
    async def answer_all():
        await asyncio.sleep(0.01)
        for q in [m for m in helper_a.sent if m.get("t") == "req"][-2:]:
            await r.helper_said("a", json.dumps({"t": "res", "id": q["id"], "status": 200, "type": None,
                                                 "body": base64.b64encode(q["path"].encode()).decode()}))
    asyncio.ensure_future(answer_all())
    one, two = await asyncio.gather(r.request("a", "GET", "/api/status", None, b""),
                                    r.request("a", "GET", "/api/reset", None, b""))
    assert one[2] == b"/api/status" and two[2] == b"/api/reset"

    # no answer in time
    try:
        await r.request("a", "GET", "/api/status", None, b"", timeout=0.05)
        raise AssertionError("did not time out")
    except TimedOut:
        pass

    # the helper goes while a request waits: an error at once, and the apps are told
    waiting = asyncio.ensure_future(r.request("a", "GET", "/api/status", None, b"", timeout=30))
    await asyncio.sleep(0.01)
    await r.helper_left("a", helper_a)
    try:
        await asyncio.wait_for(waiting, 1)
        raise AssertionError("still waiting")
    except NoHelper:
        pass
    assert app_a.sent[-1] == {"type": "hello", "cameras": 0, "helper": False, "version": "v1"}
    assert not r.connected("a") and r.cameras("a") == 0

    # a second helper replaces the first; the first leaving late changes nothing
    h1, h2 = Sock(), Sock()
    await r.helper_joined("a", h1)
    await r.helper_joined("a", h2)
    assert h1.closed == 4000 and r.connected("a")
    await r.helper_left("a", h1)
    assert r.connected("a")

    # disconnected from the site
    await r.drop_helper("a")
    assert h2.closed == 4401
    await r.drop_helper("nobody")  # harmless

    # an app that has gone hears no more, and a broken one does not stop the others
    r.app_left("a", app_a2)
    r._apps["a"].add(Broken())
    h3 = Sock()
    await r.helper_joined("a", h3)
    n, n2 = len(app_a.sent), len(app_a2.sent)
    await r.helper_said("a", json.dumps({"t": "event", "event": dart}))
    assert len(app_a.sent) == n + 1 and len(app_a2.sent) == n2
    assert not any(isinstance(s, Broken) for s in r._apps["a"])  # and it is dropped
    print("OK")


if __name__ == "__main__":
    asyncio.run(main())
