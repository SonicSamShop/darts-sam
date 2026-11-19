"""Telling the desktop app's user about a newer version (server/release.py). Run: python -m tests.test_release"""
import base64
import hashlib
import io
import tempfile
import time
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from server import release

NOTES = {"1.0": ["First"], "1.1": ["Fixed the 501 checkout"], "1.2": ["Cricket", "Quicker cameras"]}


def wait(cond):
    for _ in range(200):
        if cond():
            return
        time.sleep(0.01)
    raise AssertionError("never happened")


class Answer(io.BytesIO):
    def __init__(self, body: bytes, length=None):
        super().__init__(body)
        self.headers = {"Content-Length": str(len(body) if length is None else length)}


def main():
    # the release.json in the code is a good one
    mine = release.load()
    assert release.VERSION.match(mine["version"]) and isinstance(mine["notes"], dict)
    assert "unreleased" in mine
    with tempfile.TemporaryDirectory() as tmp:
        assert release.load(Path(tmp) / "missing.json")["version"] == "0"
        (Path(tmp) / "bad.json").write_text('{"version": "one"}')
        assert release.load(Path(tmp) / "bad.json")["version"] == "0"

    assert release.key("1.10") > release.key("1.9") > release.key("1") > release.key("nonsense") == ()

    assert release.app_id("darwin", "arm64") == "mac-arm64"
    assert release.app_id("darwin", "x86_64") == "mac-x86_64"
    assert release.app_id("win32", "AMD64") == "windows"
    assert release.app_id("linux", "x86_64") == "linux"
    assert release.app_id("linux", "aarch64") is None  # a Pi: no download for it

    # only what changed after the version you have, newest first
    assert release.since(NOTES, "1.0") == [{"version": "1.2", "changes": ["Cricket", "Quicker cameras"]},
                                          {"version": "1.1", "changes": ["Fixed the 501 checkout"]}]
    assert release.since(NOTES, "1.2") == []

    asked = []

    def site_says(answer):
        def get(url):
            asked.append(url)
            return answer
        return get

    # builds are signed (tools/sign_release.py) and checked with the key built into the app
    private = Ed25519PrivateKey.generate()
    KEY = private.public_key().public_bytes_raw()

    def signed(app, version, body):
        sha = hashlib.sha256(body).hexdigest()
        return {"sha256": sha, "signature": base64.b64encode(private.sign(release.signed_text(app, version, sha))).decode()}
    assert release.genuine(KEY, "windows", "1.2", **signed("windows", "1.2", b"12345"))
    assert not release.genuine(KEY, "windows", "1.3", **signed("windows", "1.2", b"12345"))  # another version
    assert not release.genuine(KEY, "linux", "1.2", **signed("windows", "1.2", b"12345"))    # another app
    assert not release.genuine(Ed25519PrivateKey.generate().public_key().public_bytes_raw(),
                               "windows", "1.2", **signed("windows", "1.2", b"12345"))         # another key
    assert not release.genuine(KEY, "windows", "1.2", hashlib.sha256(b"x").hexdigest(), "not base64!")
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "k.pub").write_text(base64.b64encode(KEY).decode() + "\n")
        assert release.public_key(Path(tmp) / "k.pub") == KEY
        assert release.public_key(Path(tmp) / "missing.pub") is None

    newer = {"version": "1.2", "notes": NOTES, "file": "DartsSAM.exe", "size": 5, "url": "/downloads/DartsSAM.exe",
             **signed("windows", "1.2", b"12345")}
    found = release.check("https://app.example", "windows", "1.0", site_says(newer))
    assert asked == ["https://app.example/api/release?app=windows"]  # nothing but the kind of computer
    assert found["version"] == "1.2" and [v["version"] for v in found["changes"]] == ["1.2", "1.1"]
    assert found["url"] == "https://app.example/downloads/DartsSAM.exe"
    assert release.check("https://app.example", "windows", "1.2", site_says(newer)) is None  # up to date
    assert release.check("https://app.example", "windows", "1.3", site_says(newer)) is None  # newer than the site's
    assert release.check("https://app.example", "windows", "1.0", site_says({"version": None})) is None
    # not signed, or somewhere other than the site: not offered
    unsigned = {k: v for k, v in newer.items() if k not in ("sha256", "signature")}
    assert release.check("https://app.example", "windows", "1.0", site_says(unsigned)) is None
    for elsewhere in ["https://evil.example/DartsSAM.exe", "//evil.example/DartsSAM.exe", "http://app.example/x.exe"]:
        assert release.check("https://app.example", "windows", "1.0", site_says({**newer, "url": elsewhere})) is None

    assert release.saved_name("DartsSAM.exe", "1.2") == "DartsSAM-1.2.exe"
    assert release.saved_name("DartsSAM-arm64.dmg", "1.2") == "DartsSAM-1.2-arm64.dmg"

    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        installed = []

        def make(answer, body=b"12345", length=None):
            return release.Updater(
                lambda: "https://app.example", {"version": "1.0", "notes": {}}, "windows", get=site_says(answer),
                fetch=lambda req, timeout: Answer(body, length), folder=lambda: folder,
                install=lambda path: installed.append(path) or "quit", key=KEY)

        # the site can't be reached: nothing is offered, and the page stops waiting
        def no_site(url):
            raise OSError("no network")
        u = release.Updater(lambda: "https://app.example", {"version": "1.0", "notes": {}}, "windows", get=no_site)
        u.check()
        assert u.state()["checked"] and u.state()["available"] is None
        assert not u.start_download()

        # a newer version: offered, downloaded, installed
        u = make(newer)
        assert u.state()["checked"] is False
        u.check()
        s = u.state()
        assert s["version"] == "1.0" and s["available"]["version"] == "1.2"
        assert s["page"] == "https://app.example/download.html"
        assert u.start_download()
        wait(lambda: u.download["state"] != "downloading")
        assert u.download["state"] == "ready", u.download
        assert (folder / "DartsSAM-1.2.exe").read_bytes() == b"12345"
        assert installed == [folder / "DartsSAM-1.2.exe"] and u.download["next"] == "quit"
        assert not u.start_download()  # once is enough

        # a download that stops part way: said, nothing half-written left, and it can be tried again
        installed.clear()
        u = make(newer, body=b"123", length=5)
        u.check()
        u.start_download()
        wait(lambda: u.download["state"] != "downloading")
        assert u.download["state"] == "failed" and "part way" in u.download["error"]
        assert installed == [] and not list(folder.glob("*.part"))
        assert u.start_download()  # Try again
        wait(lambda: u.download["state"] != "downloading")

        # a file that isn't what was signed (the site broken into): never opened, and not left about
        for answer, body in [(newer, b"EVIL!"),                                         # other bytes
                             ({**newer, **signed("windows", "1.1", b"EVIL!")}, b"EVIL!"),  # an old genuine signature
                             ({**newer, "sha256": hashlib.sha256(b"EVIL!").hexdigest()}, b"EVIL!")]:  # a made-up hash
            installed.clear()
            u = make(answer, body=body)
            u.check()
            assert u.start_download()
            wait(lambda: u.download["state"] != "downloading")
            assert u.download["state"] == "failed" and "genuine" in u.download["error"], u.download
            assert installed == [] and not (folder / "DartsSAM-1.2.exe.part").exists()

        # an app with no key built in (a fork's) offers no updates at all
        u = release.Updater(lambda: "https://app.example", {"version": "1.0", "notes": {}}, "windows",
                            get=site_says(newer), key=b"")
        u.check()
        assert u.state()["checked"] and u.state()["available"] is None
    print("ok")


if __name__ == "__main__":
    main()
