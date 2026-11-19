"""The stamp for the app's files (server/version.py). Run: python -m tests.test_version"""
import os
import tempfile
from pathlib import Path

from server.version import web_version


def main():
    with tempfile.TemporaryDirectory() as tmp:
        web = Path(tmp)
        (web / "games").mkdir()
        (web / "app.js").write_text("one")
        (web / "games" / "x01.js").write_text("two")
        first = web_version(web)
        assert first == web_version(web)  # nothing changed: same stamp

        # a file edited (even to the same length) changes it
        (web / "app.js").write_text("eno")
        os.utime(web / "app.js", ns=(1, 1))
        second = web_version(web)
        assert second != first

        # so does one in a folder, a new file and a removed file
        (web / "games" / "x01.js").write_text("two!")
        third = web_version(web)
        assert third != second
        (web / "new.js").write_text("")
        fourth = web_version(web)
        assert fourth != third
        (web / "new.js").unlink()
        assert web_version(web) == third

        # files the computer leaves lying about don't count
        (web / ".DS_Store").write_text("x")
        assert web_version(web) == third
    print("OK")


if __name__ == "__main__":
    main()
