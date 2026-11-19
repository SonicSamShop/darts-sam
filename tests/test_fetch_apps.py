# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Fetching the built apps into the downloads folder. Run: python -m tests.test_fetch_apps"""
import hashlib
import io
import json
import tempfile
import zipfile
from pathlib import Path

from tools import fetch_apps


def main():
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "apps"
        notes = {"1.0": ["First"], "1.1": ["Second"]}
        builds = {"DartsSAM-mac-arm64": {"id": 1, "created_at": "2026-11-16T21:26:00Z", "version": "1.0"},
                  "DartsSAM-windows": {"id": 2, "created_at": "2026-11-16T21:28:00Z", "version": "1.0"},
                  "DartsSAM-linux": {"id": 4, "created_at": "2026-11-16T21:30:00Z", "version": "1.0"}}
        fetched = []

        def latest(token):
            assert token == "tok"
            return {name: {**a, "name": name} for name, a in builds.items()}

        def download(artifact, token, to):
            fetched.append(artifact["id"])
            with zipfile.ZipFile(to, "w") as z:
                z.writestr("notes.txt", "not the app")
                if artifact["id"] != 9:
                    z.writestr(fetch_apps.APPS[artifact["name"]], f"build {artifact['id']}")
                if artifact["id"] in (2, 20):  # signed (tools/sign_release.py); 20's is for another file
                    body = f"build {2 if artifact['id'] == 2 else 'other'}".encode()
                    z.writestr(fetch_apps.APPS[artifact["name"]] + ".sig", json.dumps(
                        {"version": artifact["version"], "sha256": hashlib.sha256(body).hexdigest(), "signature": "c2ln"}))
                if artifact["id"] != 8:
                    z.writestr("release.json", json.dumps({"version": artifact["version"], "notes": notes}))

        did, wrong = fetch_apps.fetch(folder, "tok", latest, download)
        assert len(did) == 3 and fetched == [1, 2, 4]
        assert len(wrong) == 1 and "DartsSAM-x86_64.dmg" in wrong[0]  # no Intel build: said, and the others still come
        assert (folder / "DartsSAM-arm64.dmg").read_text() == "build 1"
        assert (folder / "DartsSAM.exe").read_text() == "build 2"
        assert int((folder / "DartsSAM.exe").stat().st_mtime) == 1794864480  # when it was built
        assert (folder / "DartsSAM-linux-x86_64.tar.gz").read_text() == "build 4"
        assert sorted(p.name for p in folder.iterdir()) == [
            ".fetched.json", "DartsSAM-arm64.dmg", "DartsSAM-linux-x86_64.tar.gz", "DartsSAM.exe", "releases.json"]
        releases = json.loads((folder / "releases.json").read_text())
        assert releases["DartsSAM.exe"] == {"version": "1.0", "notes": notes,  # what the site tells the apps
                                            "sha256": hashlib.sha256(b"build 2").hexdigest(), "signature": "c2ln"}
        assert releases["DartsSAM-arm64.dmg"] == {"version": "1.0", "notes": notes}  # unsigned: the apps won't take it

        # nothing new: nothing fetched again
        did, wrong = fetch_apps.fetch(folder, "tok", latest, download)
        assert did == [] and fetched == [1, 2, 4]

        # a newer build with the same version (a push between releases): not given out
        builds["DartsSAM-windows"] = {"id": 3, "created_at": "2026-11-17T09:00:00Z", "version": "1.0"}
        did, wrong = fetch_apps.fetch(folder, "tok", latest, download)
        assert did == [] and fetched == [1, 2, 4]
        assert (folder / "DartsSAM.exe").read_text() == "build 2"

        # a release: the new version replaces the old file; a file someone deleted comes back
        builds["DartsSAM-windows"] = {"id": 5, "created_at": "2026-11-18T09:00:00Z", "version": "1.1"}
        (folder / "DartsSAM-arm64.dmg").unlink()
        did, wrong = fetch_apps.fetch(folder, "tok", latest, download)
        assert fetched == [1, 2, 4, 1, 5]  # in the order of fetch_apps.APPS
        assert (folder / "DartsSAM.exe").read_text() == "build 5"
        assert (folder / "DartsSAM-arm64.dmg").read_text() == "build 1"
        releases = json.loads((folder / "releases.json").read_text())
        assert releases["DartsSAM.exe"]["version"] == "1.1" and releases["DartsSAM-arm64.dmg"]["version"] == "1.0"

        # a signature for some other file: refused, and the one that is there stays
        builds["DartsSAM-windows"] = {"id": 20, "created_at": "2026-11-19T09:00:00Z", "version": "1.2"}
        did, wrong = fetch_apps.fetch(folder, "tok", latest, download)
        assert any("not for this build" in w for w in wrong), wrong
        assert (folder / "DartsSAM.exe").read_text() == "build 5"
        builds["DartsSAM-windows"] = {"id": 5, "created_at": "2026-11-18T09:00:00Z", "version": "1.1"}

        # 1.10 comes after 1.9, not before 1.2
        assert fetch_apps.key("1.10") > fetch_apps.key("1.9") > fetch_apps.key("1.2") > fetch_apps.key(None)

        # a build without the app in it, or without release.json: the file that is there stays, and is tried again
        for broken, said in ((9, "no DartsSAM.exe in the build"), (8, "no release.json in the build")):
            builds["DartsSAM-windows"] = {"id": broken, "created_at": "2026-11-19T09:00:00Z", "version": "1.2"}
            did, wrong = fetch_apps.fetch(folder, "tok", latest, download)
            assert did == [] and any(said in w for w in wrong), wrong
            assert (folder / "DartsSAM.exe").read_text() == "build 5"
            assert json.loads((folder / ".fetched.json").read_text())["DartsSAM-windows"] == {"id": 5, "version": "1.1"}
        assert not [p for p in folder.iterdir() if p.name.startswith(".fetch-")]  # nothing half-fetched left behind

        # GitHub not answering: said, and nothing touched
        def down(token):
            raise OSError("no network")
        did, wrong = fetch_apps.fetch(folder, "tok", down, download)
        assert did == [] and wrong == ["couldn't ask GitHub for the builds: no network"]

        # a folder from before versions (".fetched.json" held only build numbers): the first versioned build is fetched
        old = Path(tmp) / "old"
        old.mkdir()
        (old / ".fetched.json").write_text(json.dumps({"DartsSAM-windows": 2}))
        (old / "DartsSAM.exe").write_text("unversioned")
        builds = {"DartsSAM-windows": {"id": 6, "created_at": "2026-11-18T09:00:00Z", "version": "1.0"}}
        fetch_apps.fetch(old, "tok", latest, download)
        assert (old / "DartsSAM.exe").read_text() == "build 6"

    # reading GitHub's list: the newest versioned build of each app from main
    listed = {"artifacts": [
        {"id": 10, "name": "DartsSAM-windows-1.1", "expired": False, "created_at": "2026-11-18T10:00:00Z",
         "workflow_run": {"head_branch": "some-pr"}},  # a pull request's: not given out
        {"id": 11, "name": "DartsSAM-windows-1.0", "expired": False, "created_at": "2026-11-18T09:00:00Z",
         "workflow_run": {"head_branch": "main"}},
        {"id": 12, "name": "DartsSAM-windows-1.0", "expired": False, "created_at": "2026-11-17T09:00:00Z",
         "workflow_run": {"head_branch": "main"}},
        {"id": 13, "name": "DartsSAM-windows", "expired": False, "created_at": "2026-11-19T09:00:00Z",
         "workflow_run": {"head_branch": "main"}},  # from before versions
        {"id": 14, "name": "DartsSAM-mac-arm64-1.0", "expired": True, "created_at": "2026-11-18T09:00:00Z",
         "workflow_run": {"head_branch": "main"}},
        {"id": 15, "name": "DartsSAM-mac-x86_64-1.0", "expired": False, "created_at": "2026-11-18T09:00:00Z",
         "workflow_run": {"head_branch": "main"}},
    ]}
    real = fetch_apps.urllib.request.urlopen
    fetch_apps.urllib.request.urlopen = lambda req, timeout: io.BytesIO(json.dumps(listed).encode())
    try:
        found = fetch_apps.latest("tok")
    finally:
        fetch_apps.urllib.request.urlopen = real
    assert {name: (a["id"], a["version"]) for name, a in found.items()} == {
        "DartsSAM-windows": (11, "1.0"), "DartsSAM-mac-x86_64": (15, "1.0")}
    print("ok")


if __name__ == "__main__":
    main()
