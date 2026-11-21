# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Fetch Python for the browser (Pyodide, with NumPy and OpenCV) into
web/vision/pyodide/, for scoring with a phone's own camera (web/vision-worker.js).

  python tools/fetch_pyodide.py [--to web/vision/pyodide]

Run once wherever the app is served from, and again when VERSION changes. The
files are about 27 MB, so they are not kept in git. The site gives them out
itself, not from a CDN, so a phone that has loaded them once scores with no
network, and nobody else hears about it. Each file must match the hash pinned
below or it is not kept. Needs nothing but Python.
"""
import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = "314.0.7"
SOURCE = f"https://cdn.jsdelivr.net/npm/pyodide@{VERSION}/"
# The wheels are not in the npm package, only beside it on Pyodide's own CDN.
WHEELS = f"https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/"
HASHES = {
    "pyodide.mjs": "6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109",
    "pyodide.asm.mjs": "f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635",
    "pyodide.asm.wasm": "cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6",
    "python_stdlib.zip": "fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a",
    "pyodide-lock.json": "5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010",
    "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl":
        "a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf",
    "opencv_python-4.11.0.86-cp314-cp314-pyemscripten_2026_0_wasm32.whl":
        "469a8ba6758ec4e0bce12436da977a1db3a953e320927c3f55ca6233a5d20acf",
}


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def fetch(base: str, dest: Path, hashes: dict) -> dict:
    """Fetch each file from `base` into `dest` unless it is there already;
    answers what happened to each: "fetched", "already there" or "wrong hash"."""
    dest.mkdir(parents=True, exist_ok=True)
    done = {}
    for name, want in hashes.items():
        p = dest / name
        if p.is_file() and _sha(p) == want:
            done[name] = "already there"
            continue
        src = (WHEELS if base == SOURCE and name.endswith(".whl") else base) + name
        with urllib.request.urlopen(src, timeout=120) as r:
            body = r.read()
        if hashlib.sha256(body).hexdigest() != want:
            done[name] = "wrong hash"
            continue
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(body)
        tmp.replace(p)
        done[name] = "fetched"
    return done


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--to", type=Path, default=ROOT / "web" / "vision" / "pyodide")
    args = ap.parse_args(argv)
    done = fetch(SOURCE, args.to, HASHES)
    for name, what in done.items():
        print(f"{what:14s} {name}")
    if "wrong hash" in done.values():
        print("Some files did not match their hashes and were not kept.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
