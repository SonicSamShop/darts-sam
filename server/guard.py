# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Keeps web pages from other sites away from the server at home (app.py).

The server has no sign-in: anything on the home network may use it. Two ways a
page on some other website could still reach it through the owner's browser:

- DNS rebinding: the page's own name is made to point at the Pi (or at this
  computer), so the browser lets it read the answers. Its requests still carry
  that name in their Host header, so only names a home network uses are let
  in: an IP address, localhost, a name with no dots (raspberrypi), and names
  ending .local, .lan, .home, .home.arpa or .internal.
- A form or fetch sent from the page: the browser can't be stopped from sending
  it, but it says which site sent it (Origin), and a change from a page that
  isn't this server's own is refused.

Extra names (a reverse proxy, say) can be allowed under "hosts" in config.json.
"""
import ipaddress
from urllib.parse import urlsplit

HOME_ENDINGS = (".local", ".lan", ".home", ".home.arpa", ".internal")
SAFE = ("GET", "HEAD", "OPTIONS")


def _name(host: str) -> str:
    """The name in a Host header, without its port: "raspberrypi.local:8000" -> "raspberrypi.local"."""
    host = host.strip().lower()
    if host.startswith("["):  # [::1]:8000
        return host[1:host.find("]")] if "]" in host else host
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


def home_name(host: str, extra=()) -> bool:
    name = _name(host).rstrip(".")
    if not name:
        return False
    if name in extra or name == "localhost" or "." not in name or name.endswith(HOME_ENDINGS):
        return True
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        return False


def own_origin(origin: str | None, host: str) -> bool:
    """A request with no Origin is not from a web page (curl, the relay, the
    desktop app's own calls); one with an Origin must be from this server."""
    return not origin or urlsplit(origin).netloc.lower() == host.strip().lower()


class LocalOnly:
    """ASGI middleware. extra() gives names allowed besides the usual home ones."""

    def __init__(self, app, extra=lambda: ()):
        self.app, self.extra = app, extra

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope["headers"]}
        host = headers.get("host", "")
        ok = home_name(host, {n.lower() for n in self.extra()})
        if ok and (scope["type"] == "websocket" or scope["method"] not in SAFE):
            ok = own_origin(headers.get("origin"), host)
        if ok:
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            return await send({"type": "websocket.close", "code": 1008})
        await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": b'{"detail":"Not from this server."}'})
