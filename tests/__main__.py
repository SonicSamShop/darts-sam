# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Run every test, the Python ones and then the app's (Node).

  python -m tests                 # everything
  python -m tests calib vision    # only the Python tests named
  python -m tests --no-node       # leave out the app's tests

Each Python test is a program of its own (python -m tests.test_calib), and is
run as one here, one after another: several start a real server on a port of
their own. A failing test's output is shown; the rest are a line each. The
app's tests are `node --test tests/*.mjs`, skipped with a note if there is no
Node on this computer.
"""
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LIMIT = 600  # seconds any one test may take (the slowest takes about a minute)


def run(command) -> tuple[bool, str]:
    """Run one lot of tests: whether it passed, and all it printed. One that
    hasn't ended in LIMIT seconds is stopped and counts as failed, so a test
    that hangs doesn't hold everything (and what it had printed is still seen)."""
    try:
        done = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=LIMIT)
        return done.returncode == 0, done.stdout + done.stderr
    except subprocess.TimeoutExpired as e:
        said = "".join(s.decode(errors="replace") if isinstance(s, bytes) else s or "" for s in (e.stdout, e.stderr))
        return False, f"{said.rstrip()}\nStopped: still running after {LIMIT} s."


def main(argv) -> int:
    if "-h" in argv or "--help" in argv:
        print(__doc__.strip())
        return 0
    options = [a for a in argv if a.startswith("-") and a != "--no-node"]
    if options:
        print(f"No such option: {', '.join(options)}. There is only --no-node.")
        return 2
    node = "--no-node" not in argv
    wanted = [a.removeprefix("test_") for a in argv if not a.startswith("-")]
    names = sorted(p.stem for p in HERE.glob("test_*.py"))
    unknown = [w for w in wanted if f"test_{w}" not in names]
    if unknown:
        print(f"No such test: {', '.join(unknown)}. There are: {', '.join(n.removeprefix('test_') for n in names)}")
        return 2
    if wanted:
        names, node = [f"test_{w}" for w in wanted], False

    failed = []
    for name in names:
        start = time.time()
        ok, said = run([sys.executable, "-m", f"tests.{name}"])
        print(f"{'ok  ' if ok else 'FAIL'}  {name:18s} {time.time() - start:5.1f} s", flush=True)
        if not ok:
            failed.append(name)
            print(said.strip(), flush=True)

    if node and not shutil.which("node"):
        print("skip  the app's tests: Node isn't installed (node --test tests/*.mjs)")
    elif node:
        start = time.time()
        files = sorted(str(p.relative_to(ROOT)) for p in HERE.glob("*.test.mjs"))
        ok, said = run(["node", "--test", *files])
        print(f"{'ok  ' if ok else 'FAIL'}  {'the app (Node)':18s} {time.time() - start:5.1f} s", flush=True)
        if not ok:
            failed.append("the app's tests")
            print(said.strip(), flush=True)

    print(f"\nFailed: {', '.join(failed)}" if failed else "\nAll passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
