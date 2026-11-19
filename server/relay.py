# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The hosted version's switchboard between a person's cameras and their apps.

The computer the cameras are plugged into (the "helper", server/app.py with
link.py) cannot be reached from the internet, so it connects out to the host
and stays connected. Per account the relay holds that connection and the
connections of the person's open apps, and passes:

  darts and take-outs    helper -> every app of the same account
  the app's questions    (camera pictures, calibration, reports) app -> helper,
                         and the helper's answer back

Everything is in memory; a restart of the host just makes everyone reconnect.
A "socket" here is anything with `async send_text(str)` and `async close(code)`.

The helper's line carries JSON messages (bodies as base64, "" for none):
  helper -> host  {"t": "hello", "cameras", "calibrated", "platform", "version"}
                  {"t": "event", "event": {...}}        a dart or a take-out
                  {"t": "res", "id", "status", "type", "body"}
  host -> helper  {"t": "req", "id", "method", "path", "type", "body"}
"""
import asyncio
import base64
import json
import secrets

REPLACED = 4000   # close code: another helper took this account's place
FORGOTTEN = 4401  # close code: not (or no longer) paired; forget your token


class NoHelper(Exception):
    """The account's helper is not connected, or left before answering."""


class TimedOut(Exception):
    """The helper did not answer in time."""


class Relay:
    def __init__(self):
        self._helpers: dict[str, object] = {}           # account id -> the helper's socket
        self._cameras: dict[str, int] = {}              # account id -> calibrated cameras, as the helper last said
        self._apps: dict[str, set] = {}                 # account id -> its apps' sockets
        self._versions: dict[object, str] = {}          # app socket -> the web files stamp it is told
        self._waiting: dict[str, tuple[str, asyncio.Future]] = {}  # request id -> (account id, its answer)

    def connected(self, account_id: str) -> bool:
        return account_id in self._helpers

    def cameras(self, account_id: str) -> int:
        return self._cameras.get(account_id, 0)

    # ---------- apps ----------
    def _hello(self, account_id: str, socket) -> dict:
        return {"type": "hello", "cameras": self.cameras(account_id), "helper": self.connected(account_id),
                "version": self._versions.get(socket, "")}

    async def _tell(self, account_id: str, message=None):
        """Send to every app of the account: `message`, or each its own hello."""
        for socket in list(self._apps.get(account_id, ())):
            try:
                await socket.send_text(json.dumps(message or self._hello(account_id, socket)))
            except Exception:
                self.app_left(account_id, socket)

    async def app_joined(self, account_id: str, socket, version: str):
        self._apps.setdefault(account_id, set()).add(socket)
        self._versions[socket] = version
        await socket.send_text(json.dumps(self._hello(account_id, socket)))

    def app_left(self, account_id: str, socket):
        self._apps.get(account_id, set()).discard(socket)
        self._versions.pop(socket, None)
        if not self._apps.get(account_id):
            self._apps.pop(account_id, None)

    # ---------- the helper ----------
    async def helper_joined(self, account_id: str, socket):
        old = self._helpers.get(account_id)
        self._helpers[account_id] = socket
        if old is not None and old is not socket:
            self._fail(account_id)
            await self._close(old, REPLACED)
        self._cameras[account_id] = 0  # until it says hello

    async def helper_left(self, account_id: str, socket):
        if self._helpers.get(account_id) is not socket:
            return  # it was replaced; the new one stays
        del self._helpers[account_id]
        self._cameras.pop(account_id, None)
        self._fail(account_id)
        await self._tell(account_id)

    async def drop_helper(self, account_id: str):
        """The person disconnected their cameras on the site."""
        socket = self._helpers.get(account_id)
        if socket is not None:
            await self.helper_left(account_id, socket)
            await self._close(socket, FORGOTTEN)

    @staticmethod
    async def _close(socket, code: int):
        try:
            await socket.close(code)
        except Exception:
            pass  # already gone

    def _fail(self, account_id: str):
        for rid, (owner, answer) in list(self._waiting.items()):
            if owner == account_id and not answer.done():
                answer.set_exception(NoHelper())

    async def helper_said(self, account_id: str, text: str) -> dict | None:
        """One message from the account's helper. Returns a hello's fields, for the host to record."""
        try:
            m = json.loads(text)
            kind = m["t"]
        except (ValueError, TypeError, KeyError):
            return None
        if kind == "hello":
            said = {k: m.get(k) for k in ("cameras", "calibrated", "platform", "version")}
            count = said["calibrated"] if isinstance(said["calibrated"], int) else 0
            self._cameras[account_id] = count
            await self._tell(account_id)  # the apps learn a helper is there, and how many cameras score
            return said
        if kind == "event":
            event = m.get("event")
            # "hello" is the host's to say: it carries the host's own files stamp
            if isinstance(event, dict) and event.get("type") in ("dart", "takeout"):
                await self._tell(account_id, event)
        if kind == "res":
            owner, answer = self._waiting.get(m.get("id"), (None, None))
            if owner == account_id and not answer.done():
                try:
                    answer.set_result((int(m["status"]), m.get("type"), base64.b64decode(m.get("body") or "")))
                except (ValueError, TypeError, KeyError):
                    answer.set_exception(NoHelper())
        return None

    async def request(self, account_id: str, method: str, path: str, content_type: str | None, body: bytes,
                      timeout: float = 35) -> tuple[int, str | None, bytes]:
        """Ask the account's helper; its (status, content type, body)."""
        socket = self._helpers.get(account_id)
        if socket is None:
            raise NoHelper()
        rid = secrets.token_hex(8)
        answer = asyncio.get_running_loop().create_future()
        self._waiting[rid] = (account_id, answer)
        try:
            await socket.send_text(json.dumps({"t": "req", "id": rid, "method": method, "path": path,
                                               "type": content_type, "body": base64.b64encode(body).decode()}))
            return await asyncio.wait_for(answer, timeout)
        except asyncio.TimeoutError:
            raise TimedOut()
        except NoHelper:
            raise
        except Exception:
            raise NoHelper()  # the line broke while sending
        finally:
            self._waiting.pop(rid, None)
