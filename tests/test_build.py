"""Which version and build is running (server/build.py). Run: python -m tests.test_build"""
import json
import subprocess
import tempfile
from pathlib import Path

from server import build, release


def main():
    version = release.load()["version"]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        # a built app: build.json says
        (tmp / "build.json").write_text(json.dumps({"build": 61, "commit": "a140399"}))
        b = build.load(tmp / "build.json", cwd=tmp)
        assert b == {"version": version, "build": 61, "commit": "a140399"}, b
        assert build.label(b) == f"{version} (build 61, a140399)"

        # no build.json and no git: only the version
        b = build.load(tmp / "missing.json", cwd=tmp)
        assert b == {"version": version, "build": None, "commit": None}, b
        assert build.label(b) == version

        # a git clone: the number of commits and the commit's short name
        repo = tmp / "repo"
        repo.mkdir()
        git = lambda *a: subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=repo, check=True,
                                        capture_output=True, text=True).stdout.strip()
        git("init", "-q")
        for n in range(3):
            git("commit", "-q", "--allow-empty", "-m", str(n))
        b = build.load(tmp / "missing.json", cwd=repo)
        assert b["build"] == 3 and b["commit"] == git("rev-parse", "--short=7", "HEAD"), b

    # this code itself
    assert build.info()["build"], build.info()
    print("build ok:", build.label())


if __name__ == "__main__":
    main()
