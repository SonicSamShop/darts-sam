# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Test tools/fetch_pyodide.py from a folder standing in for the download site.

  python -m tests.test_fetch_pyodide
"""
import hashlib
import tempfile
from pathlib import Path

from tools import fetch_pyodide


def main():
    with tempfile.TemporaryDirectory() as tmp:
        site, dest = Path(tmp) / "site", Path(tmp) / "dest"
        site.mkdir()
        (site / "a.wasm").write_bytes(b"good")
        (site / "b.mjs").write_bytes(b"tampered")
        hashes = {"a.wasm": hashlib.sha256(b"good").hexdigest(), "b.mjs": hashlib.sha256(b"real").hexdigest()}
        got = fetch_pyodide.fetch(site.as_uri() + "/", dest, hashes)
        assert (dest / "a.wasm").read_bytes() == b"good"
        assert not (dest / "b.mjs").exists(), "a file that doesn't match its hash must not be kept"
        assert got == {"a.wasm": "fetched", "b.mjs": "wrong hash"}, got
        # A second run leaves a good file alone
        (site / "a.wasm").unlink()
        assert fetch_pyodide.fetch(site.as_uri() + "/", dest, {"a.wasm": hashes["a.wasm"]}) == {"a.wasm": "already there"}
        # Every file the worker loads is pinned
        assert {"pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip",
                "pyodide-lock.json"} <= set(fetch_pyodide.HASHES)
        assert any(n.startswith("opencv_python-") for n in fetch_pyodide.HASHES)
    print("OK")


if __name__ == "__main__":
    main()
