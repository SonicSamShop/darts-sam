# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Pictures of the board, kept with the game they were taken in.

When a dart the cameras scored earns an achievement (web/achievements.js), the
app takes one camera's picture of the board, darts and all, and sends it here.
It is the only thing an achievement keeps: the achievement itself is worked
out from the game.

A picture is <database's name>.photos/<match id>/<visit>.jpg beside the database
its game is in: data/dartssam.photos/ at home, and on the hosted site in the
account's own folder, so that deleting an account is still deleting a folder.
The folder is named after the database, so two databases in one folder never
share pictures. <visit> is where in the game's
visits the dart was thrown, so a picture is found from the game alone. It goes
when its game goes (data_api.py), and when the dart is undone (the app asks).
"""
import re
import shutil
from pathlib import Path

MOST = 400_000        # bytes in one picture: the app sends a JPEG no wider than 1280
MOST_KEPT = 300       # pictures beside one database; after that no more are taken
SAFE_MATCH = re.compile(r"^[\w-]{1,64}$")
SAFE_VISIT = re.compile(r"^\d{1,5}$")
JPEG = b"\xff\xd8\xff"


class Refused(Exception):
    pass


def folder(db_path: Path) -> Path:
    return Path(db_path).with_suffix(".photos")


def _file(db_path: Path, match_id: str, visit: str) -> Path:
    if not SAFE_MATCH.match(match_id) or not SAFE_VISIT.match(visit):
        raise Refused("no such picture")
    return folder(db_path) / match_id / f"{int(visit)}.jpg"


def save(db_path: Path, match_id: str, visit: str, body: bytes):
    """Keep a picture, in place of any already kept for that visit."""
    path = _file(db_path, match_id, visit)
    if not body.startswith(JPEG):
        raise Refused("a picture must be a JPEG")
    if len(body) > MOST:
        raise Refused("the picture is too big")
    if not path.exists() and sum(1 for _ in folder(db_path).glob("*/*.jpg")) >= MOST_KEPT:
        raise Refused("no room for more pictures")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(body)
    tmp.replace(path)


def read(db_path: Path, match_id: str, visit: str) -> bytes | None:
    path = _file(db_path, match_id, visit)
    return path.read_bytes() if path.is_file() else None


def drop(db_path: Path, match_id: str, visit: str | None = None) -> bool:
    """Throw away one picture, or with no visit every picture of the game."""
    if visit is None:
        if not SAFE_MATCH.match(match_id):
            return False
        there = folder(db_path) / match_id
        shutil.rmtree(there, ignore_errors=True)
        return True
    path = _file(db_path, match_id, visit)
    if not path.is_file():
        return False
    path.unlink()
    if not any(path.parent.iterdir()):
        path.parent.rmdir()
    return True
