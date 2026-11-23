# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""tools/backup.sh, the hosted site's nightly backup. Run: python -m tests.test_backup

Needs sh, tar, curl and the sqlite3 program (as the server has); skipped with a
note where they aren't (Windows)."""
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "backup.sh"
JPEG = b"\xff\xd8\xff" + b"picture"


def database(path: Path, rows: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE t (n INTEGER)")
        c.executemany("INSERT INTO t VALUES (?)", [(i,) for i in range(rows)])
    c.close()


def site(data: Path):
    """A data folder like the server's: host.db, two accounts, one with pictures."""
    database(data / "host.db", 3)
    database(data / "accounts" / "aaaaaaaaaaaaaaaa" / "darts.db", 5)
    database(data / "accounts" / "bbbbbbbbbbbbbbbb" / "darts.db", 7)
    pics = data / "accounts" / "aaaaaaaaaaaaaaaa" / "darts.photos" / "m1"
    pics.mkdir(parents=True)
    (pics / "3.jpg").write_bytes(JPEG)
    (pics / "4.part").write_bytes(b"half")  # being written as the backup runs
    (data / "reports" / "aaaaaaaaaaaaaaaa" / "r1").mkdir(parents=True)  # reports are left out on purpose
    (data / "reports" / "aaaaaaaaaaaaaaaa" / "r1" / "report.json").write_text("{}")


def run(*args, env=None):
    return subprocess.run(["sh", str(SCRIPT), *map(str, args)], capture_output=True, text=True,
                          env={**os.environ, "DARTSSAM_AFTER_BACKUP": "/nonexistent", "DARTSSAM_BACKUP_PING": "",
                               **(env or {})})


class Heard(BaseHTTPRequestHandler):
    pings: list = []

    def do_GET(self):
        Heard.pings.append(self.path)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *a):
        pass


def main():
    if os.name == "nt" or not all(shutil.which(p) for p in ("sh", "tar", "curl", "sqlite3")):
        print("backup: skipped (needs sh, tar, curl and sqlite3)")
        return
    server = HTTPServer(("127.0.0.1", 0), Heard)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    ping = f"http://127.0.0.1:{server.server_port}/ping-123"

    with tempfile.TemporaryDirectory() as tmp:
        data, out = Path(tmp) / "data", Path(tmp) / "out"
        site(data)

        # a good backup: every database, the pictures, not the reports or half-written files; checked; heartbeat sent
        sent = Path(tmp) / "sent.txt"
        after = Path(tmp) / "after.sh"
        after.write_text(f'#!/bin/sh\necho "$1" > "{sent}"\n')
        after.chmod(0o755)
        r = run(data, out, env={"DARTSSAM_BACKUP_PING": ping, "DARTSSAM_AFTER_BACKUP": str(after)})
        assert r.returncode == 0, r.stderr
        assert "3 databases checked, 1 pictures" in r.stdout, r.stdout
        made = sorted(out.glob("dartssam-*.tar.gz"))
        assert len(made) == 1 and not list(out.glob("*.part")), made
        with tarfile.open(made[0]) as t:
            names = set(t.getnames())
        assert {"dartssam/host.db", "dartssam/accounts/aaaaaaaaaaaaaaaa/darts.db",
                "dartssam/accounts/bbbbbbbbbbbbbbbb/darts.db",
                "dartssam/accounts/aaaaaaaaaaaaaaaa/darts.photos/m1/3.jpg"} <= names, names
        assert not any("reports" in n or n.endswith(".part") for n in names), names
        assert sent.read_text().strip() == str(made[0]), "after-backup was not given the new file"
        assert Heard.pings == ["/ping-123"], Heard.pings

        # restored, the games are all there
        back = Path(tmp) / "back"
        back.mkdir()
        with tarfile.open(made[0]) as t:
            t.extractall(back, filter="data") if sys.version_info >= (3, 12) else t.extractall(back)
        with sqlite3.connect(back / "dartssam" / "accounts" / "bbbbbbbbbbbbbbbb" / "darts.db") as c:
            assert c.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 7
        c.close()

        # --check on its own, on a good file and a damaged one
        r = run("--check", made[0])
        assert r.returncode == 0 and "3 databases checked" in r.stdout, r.stdout + r.stderr
        broken = Path(tmp) / "broken"
        shutil.copytree(back, broken)
        bad_db = broken / "dartssam" / "accounts" / "bbbbbbbbbbbbbbbb" / "darts.db"
        raw = bytearray(bad_db.read_bytes())
        raw[100:4096] = b"\x00" * (4096 - 100)  # the header past its first line, and the schema, wiped
        bad_db.write_bytes(bytes(raw))
        bad_file = Path(tmp) / "broken.tar.gz"
        with tarfile.open(bad_file, "w:gz") as t:
            t.add(broken / "dartssam", "dartssam")
        r = run("--check", bad_file)
        assert r.returncode != 0 and "bbbbbbbbbbbbbbbb/darts.db" in r.stderr, r.stdout + r.stderr

        # a failure on the way (here the after-backup step) stops it: no heartbeat, so the checker emails
        Heard.pings.clear()
        failing = Path(tmp) / "fail.sh"
        failing.write_text("#!/bin/sh\nexit 3\n")
        failing.chmod(0o755)
        r = run(data, out, env={"DARTSSAM_BACKUP_PING": ping, "DARTSSAM_AFTER_BACKUP": str(failing)})
        assert r.returncode != 0 and Heard.pings == [], (r.returncode, Heard.pings)

        # no data there: refused
        r = run(Path(tmp) / "nothing", out)
        assert r.returncode != 0 and "no host.db" in r.stderr, r.stderr

        # only the newest 14 are kept
        for i in range(20):
            (out / f"dartssam-2000-01-{i + 1:02d}_000000.tar.gz").write_bytes(b"old")
            os.utime(out / f"dartssam-2000-01-{i + 1:02d}_000000.tar.gz", (946684800 + i, 946684800 + i))
        assert run(data, out).returncode == 0
        assert len(list(out.glob("dartssam-*.tar.gz"))) == 14
    server.shutdown()
    print("backup: ok")


if __name__ == "__main__":
    main()
