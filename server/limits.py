# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""How much a request may send, counted as it arrives.

A Content-Length header can be left out (a chunked upload) or be wrong, so the
bytes are counted as they come in, and a request that sends too many is turned
away with 413 before the rest is read. Used by both the hosted site (host.py)
and the server at home (app.py).
"""
MOST = 4 * 2**20  # bytes in any one request, unless its address is given more below


class BodyLimit:
    """ASGI middleware. bigger maps an address prefix to the bytes allowed
    there, for the few addresses that take something big (problem reports)."""

    def __init__(self, app, most: int = MOST, bigger: dict[str, int] | None = None):
        self.app, self.most, self.bigger = app, most, bigger or {}

    def limit(self, path: str) -> int:
        return next((n for prefix, n in self.bigger.items() if path.startswith(prefix)), self.most)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        most = self.limit(scope["path"])
        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared and (not declared.isdigit() or int(declared) > most):
            return await too_big(send)
        seen, started, refused = 0, False, False

        async def counted():
            nonlocal seen, refused
            message = await receive()
            if message["type"] == "http.request" and not refused:
                seen += len(message.get("body", b""))
                if seen > most:
                    # answered here, and the endpoint is told the sender went
                    # away, so it stops reading and nothing it says gets out
                    refused = True
                    if not started:
                        await too_big(send)
                    return {"type": "http.disconnect"}
            return message

        async def watched(message):
            nonlocal started
            if refused:
                return
            started = started or message["type"] == "http.response.start"
            await send(message)
        try:
            await self.app(scope, counted, watched)
        except Exception:
            if not refused:
                raise  # a real fault, not the endpoint stumbling over the cut-off body


async def too_big(send):
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"connection", b"close")]})
    await send({"type": "http.response.body", "body": b'{"detail":"Too big."}'})
