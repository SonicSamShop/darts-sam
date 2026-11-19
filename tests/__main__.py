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


def main(argv) -> int:
    node = "--no-node" not in argv
    wanted = [a.removeprefix("test_") for a in argv if not a.startswith("--")]
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
        run = subprocess.run([sys.executable, "-m", f"tests.{name}"], cwd=ROOT, capture_output=True, text=True)
        print(f"{'ok  ' if run.returncode == 0 else 'FAIL'}  {name:18s} {time.time() - start:5.1f} s", flush=True)
        if run.returncode != 0:
            failed.append(name)
            print((run.stdout + run.stderr).rstrip(), flush=True)

    if node and not shutil.which("node"):
        print("skip  the app's tests: Node isn't installed (node --test tests/*.mjs)")
    elif node:
        start = time.time()
        files = sorted(str(p.relative_to(ROOT)) for p in HERE.glob("*.test.mjs"))
        run = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True)
        print(f"{'ok  ' if run.returncode == 0 else 'FAIL'}  {'the app (Node)':18s} {time.time() - start:5.1f} s", flush=True)
        if run.returncode != 0:
            failed.append("the app's tests")
            print((run.stdout + run.stderr).rstrip(), flush=True)

    print(f"\nFailed: {', '.join(failed)}" if failed else "\nAll passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
