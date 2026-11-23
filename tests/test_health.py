# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The host's /api/health, which an uptime checker watches. Run: python -m tests.test_health"""
import sys
import tempfile
from pathlib import Path

sys.modules["cv2"] = None    # the host must not need OpenCV…
sys.modules["numpy"] = None  # …or numpy

from fastapi.testclient import TestClient  # noqa: E402

from server import host  # noqa: E402

BASE = {"google_client_id": "client-123", "dev": True}


def main():
    with tempfile.TemporaryDirectory() as tmp:
        # plenty of room: well, and nothing about the machine is given away
        well = TestClient(host.create(Path(tmp) / "a", {**BASE, "disk_low_mb": 0}))
        r = well.get("/api/health")
        assert r.status_code == 200 and r.json() == {"ok": True}, r.text
        assert r.headers["cache-control"] == "no-store", r.headers
        assert well.head("/api/health").status_code == 200  # uptime checkers often only ask for the headers

        # less room left than "disk_low_mb": 503, so the checker sends its email
        low = TestClient(host.create(Path(tmp) / "b", {**BASE, "disk_low_mb": 10**12}))
        r = low.get("/api/health")
        assert r.status_code == 503 and r.json() == {"ok": False, "problem": "disk"}, r.text
        assert low.head("/api/health").status_code == 503

        # the accounts' database can't be opened: 503 too
        made = host.create(Path(tmp) / "c", {**BASE, "disk_low_mb": 0})
        (Path(tmp) / "c" / "host.db").unlink()
        (Path(tmp) / "c" / "host.db").mkdir()  # a folder where the file should be: sqlite can't open it
        r = TestClient(made).get("/api/health")
        assert r.status_code == 503 and r.json() == {"ok": False, "problem": "database"}, r.text

        # left out of the settings, it still answers (2 GB is the line)
        assert TestClient(host.create(Path(tmp) / "d", BASE)).get("/api/health").status_code in (200, 503)
    print("health: ok")


if __name__ == "__main__":
    main()
