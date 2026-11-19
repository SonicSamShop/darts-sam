# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Packing problem reports and deciding which to send. Run: python -m tests.test_reportsync"""
import io
import json
import os
import tempfile
import zipfile
from pathlib import Path

from server import reportsync as rs


def make(root: Path, rid: str, note="") -> Path:
    f = root / rid
    f.mkdir(parents=True)
    (f / "report.json").write_text(json.dumps({
        "id": rid, "expected": "T20" if note else "", "note": note,
        "looks": [{"summary": "9 s ago: scored T20"}, {"summary": "2 s ago: scored Miss"}], "now": {"summary": "Now: 2 darts"}}))
    (f / "frame-01.png").write_bytes(b"PNG" * 1000)
    (f / "look1-cam0-seen.jpg").write_bytes(b"JPG" * 500)
    (f / "notes.txt").write_text("not a report file")
    return f


def main():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "reports"
        assert rs.due(root, 1000) == []  # no folder yet: nothing, no error

        # a new report waits two minutes for the person's note, then everything goes
        a = make(root, "a")
        rs.mark(a, "wait")
        made = (a / rs.MARKER).stat().st_mtime
        assert rs.due(root, made + 60) == []
        assert rs.due(root, made + 121) == [("a", "all")]
        # the note is saved: everything goes now
        rs.noted(a)
        assert rs.due(root, made + 1) == [("a", "all")]
        # sent: no marker, nothing due; a note saved later sends report.json again
        rs.clear(a)
        assert rs.due(root, made + 500) == []
        rs.noted(a)
        assert rs.due(root, made + 500) == [("a", "note")]
        # refused for size: never again
        rs.mark(a, "refused")
        assert rs.due(root, made + 10**6) == []
        # a report made while not paired has no marker and is never sent
        make(root, "b")
        assert rs.due(root, made + 10**6) == []
        (root / "stray-file").write_text("x")
        assert rs.due(root, made + 10**6) == []

        # packing: only pictures and JSON, never the marker or other files
        rs.mark(a, "now")
        names = lambda data: sorted(zipfile.ZipFile(io.BytesIO(data)).namelist())  # noqa: E731
        assert names(rs.pack(a, "all")) == ["frame-01.png", "look1-cam0-seen.jpg", "report.json"]
        assert names(rs.pack(a, "note")) == ["report.json"]

        # unpacking at the other end
        dest = Path(tmp) / "site" / "acc" / "a"
        size = rs.unpack(rs.pack(a, "all"), dest)
        assert size == 3000 + 1500 + (a / "report.json").stat().st_size
        assert sorted(p.name for p in dest.iterdir()) == ["frame-01.png", "look1-cam0-seen.jpg", "report.json"]
        assert (dest / "frame-01.png").read_bytes() == b"PNG" * 1000
        assert rs.folder_size(dest) == size
        assert rs.meta(dest) == {"expected": "", "note": "", "summary": "2 s ago: scored Miss"}
        # sent again with the note: the pictures stay, the note arrives
        (a / "report.json").write_text(json.dumps({"expected": "T20", "note": "bounced <b>out</b>", "looks": [], "now": {"summary": "Now: 0 darts"}}))
        rs.unpack(rs.pack(a, "note"), dest)
        assert (dest / "frame-01.png").exists()
        assert rs.meta(dest) == {"expected": "T20", "note": "bounced <b>out</b>", "summary": "Now: 0 darts"}

        # a hostile zip: nothing lands outside the folder, odd files are skipped
        evil = io.BytesIO()
        with zipfile.ZipFile(evil, "w") as z:
            z.writestr("../escaped.png", b"x")
            z.writestr("/abs.png", b"x")
            z.writestr("sub/inner.png", b"x")
            z.writestr("script.sh", b"x")
            z.writestr("..png", b"x")
            z.writestr("fine.png", b"ok")
        d2 = Path(tmp) / "site" / "acc" / "evil"
        assert rs.unpack(evil.getvalue(), d2) == 2
        assert [p.name for p in d2.iterdir()] == ["fine.png"]
        assert not (Path(tmp) / "site" / "acc" / "escaped.png").exists() and not (Path(tmp) / "site" / "escaped.png").exists()
        for junk in [b"", b"not a zip at all"]:
            try:
                rs.unpack(junk, Path(tmp) / "site" / "acc" / "junk")
                raise AssertionError("unpacked rubbish")
            except ValueError:
                pass
        # a zip that would unpack to more than it is allowed
        bomb = io.BytesIO()
        with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("big.png", b"\0" * 5_000_000)
        try:
            rs.unpack(bomb.getvalue(), Path(tmp) / "site" / "acc" / "bomb", most=1_000_000)
            raise AssertionError("unpacked past the limit")
        except ValueError:
            pass
        assert rs.meta(Path(tmp) / "nowhere") == {"expected": "", "note": "", "summary": ""}

        # the uploader: sends what is due, clears on success, gives up on "too big", keeps on failure
        sent = []
        answers = {"a": 200, "c": 413, "d": 500, "e": OSError("offline")}

        def post(url, token, body):
            rid = url.rsplit("/", 1)[1]
            sent.append((url, token, sorted(zipfile.ZipFile(io.BytesIO(body)).namelist())))
            if isinstance(answers[rid], Exception):
                raise answers[rid]
            return answers[rid]

        for rid in "cde":
            rs.mark(make(root, rid), "now")
        up = rs.Uploader(root, "https://site.example/", "tok", post=post)
        up.once()
        assert sent[0] == ("https://site.example/api/helper/reports/a", "tok", ["frame-01.png", "look1-cam0-seen.jpg", "report.json"])
        assert len(sent) == 4
        assert not (a / rs.MARKER).exists()
        assert (root / "c" / rs.MARKER).read_text() == "refused"
        assert (root / "d" / rs.MARKER).read_text() == "now" and (root / "e" / rs.MARKER).read_text() == "now"
        sent.clear()
        up.once()
        assert sorted(s[0][-1] for s in sent) == ["d", "e"]  # only the two that failed are tried again
        os.utime(root / "d" / rs.MARKER)
    print("OK")


if __name__ == "__main__":
    main()
