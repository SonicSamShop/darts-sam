# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Request sizes are counted as they arrive (server/limits.py). Run: python -m tests.test_limits"""
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel

from server.limits import BodyLimit


class Thing(BaseModel):
    text: str


def chunks(data: bytes, size=1000):
    for i in range(0, len(data), size):
        yield data[i:i + size]


def main():
    app = FastAPI()
    app.add_middleware(BodyLimit, most=5000, bigger={"/big/": 50_000})

    @app.post("/thing")
    def thing(body: Thing):
        return {"got": len(body.text)}

    @app.post("/big/raw")
    async def raw(request: Request):
        return {"got": len(await request.body())}

    c = TestClient(app)
    small = b'{"text": "' + b"x" * 100 + b'"}'
    huge = b'{"text": "' + b"x" * 20_000 + b'"}'
    assert c.post("/thing", content=small, headers={"content-type": "application/json"}).json() == {"got": 100}
    # too big, whether it says so...
    assert c.post("/thing", content=huge, headers={"content-type": "application/json"}).status_code == 413
    # ...or sends it in chunks with no Content-Length
    assert c.post("/thing", content=chunks(huge), headers={"content-type": "application/json"}).status_code == 413
    assert c.post("/thing", content=chunks(small), headers={"content-type": "application/json"}).json() == {"got": 100}
    # a header that lies or isn't a number
    assert c.post("/thing", content=small, headers={"content-type": "application/json", "content-length": "x"}).status_code == 413
    # an address given more room
    assert c.post("/big/raw", content=chunks(b"y" * 40_000)).json() == {"got": 40_000}
    assert c.post("/big/raw", content=chunks(b"y" * 60_000)).status_code == 413
    print("OK")


if __name__ == "__main__":
    main()
