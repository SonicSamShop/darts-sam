# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The saved-data addresses: players, their darts, boards, settings, matches and stats (see db.py).

Shared by the server at home (app.py), which keeps everything in one file, and
the hosted version (host.py), where each account has a file of its own.
"""
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from . import db, photos


class Name(BaseModel):
    name: str
    bot: int | None = None  # a new player only: the level of a computer player


class DartsIn(BaseModel):
    player: int
    name: str
    grams: float | None = None
    created: int | None = None
    retired: bool = False
    details: dict | None = None  # brand, barrel and so on: see db.DARTS_DETAILS


class BoardIn(BaseModel):
    brand: str | None = None
    model: str | None = None
    bought: int | None = None  # the year
    notes: str | None = None
    up: int | None = None  # ms: when it went up
    down: int | None = None  # ms: when it came down; None while it is on the wall
    created: int | None = None


class MoveIn(BaseModel):
    """Games started from `start` up to `end` (ms; None: open) were on a board. With
    `only`, just those on one of these boards (None: on no board)."""
    start: int | None = None
    end: int | None = None
    only: list[str | None] | None = None


class Setting(BaseModel):
    value: Any


class ThrowIn(BaseModel):
    player: int  # index into the match's players
    round: int
    seg: int
    mult: int
    x: float | None = None
    y: float | None = None
    src: str | None = None
    bust: bool = False
    ts: int | None = None


class MatchIn(BaseModel):
    seq: int
    game_id: str
    game_name: str
    opts: dict
    log: list[dict]
    started: float
    players: list[int]
    darts: list[str | None] | None = None  # the set each player threw with, in the same order
    board: str | None = None  # the board it was played on (left out: the one on the wall)
    winner: int | None = None
    duration: float | None = None  # ms from start to the winning dart
    throws: list[ThrowIn]


def _db(fn, *args):
    try:
        return fn(*args)
    except db.NotFound as e:
        raise HTTPException(404, str(e))
    except db.Invalid as e:
        raise HTTPException(400, str(e))


def make_router(db_file: Callable[[Request], Path | None], reports: Callable[[], int] = lambda: 0) -> APIRouter:
    """db_file says which database a request is for (None: the usual one), or
    refuses it by raising HTTPException. reports counts saved problem reports."""
    router = APIRouter()

    @router.get("/api/players")
    def players(request: Request):
        with db.at(db_file(request)):
            return db.list_players()

    @router.post("/api/players")
    def add_player(request: Request, body: Name):
        with db.at(db_file(request)):
            return _db(db.add_player, body.name, body.bot)

    @router.patch("/api/players/{player_id}")
    def rename_player(request: Request, player_id: int, body: Name):
        with db.at(db_file(request)):
            return _db(db.rename_player, player_id, body.name)

    @router.delete("/api/players/{player_id}")
    def remove_player(request: Request, player_id: int):
        with db.at(db_file(request)):
            _db(db.remove_player, player_id)
            return {"ok": True}

    @router.get("/api/players/{player_id}/stats")
    def player_stats(request: Request, player_id: int, game: str | None = None, darts: str | None = None,
                     board: str | None = None):
        """Stats for every game together, or with ?game=x01 (a game id) for one game type,
        with ?darts=<set id> only from the games thrown with that set, and with ?board=<board id>
        only from the games played on that board."""
        with db.at(db_file(request)):
            return _db(db.stats, player_id, game, darts, board)

    @router.get("/api/darts")
    def darts(request: Request):
        with db.at(db_file(request)):
            return db.list_darts()

    @router.put("/api/darts/{darts_id}")
    def save_darts(request: Request, darts_id: str, body: DartsIn):
        with db.at(db_file(request)):
            # (details left out, not sent as nothing: an older app keeps a set's details as they are)
            return _db(db.save_darts, darts_id, body.model_dump(exclude={"details"} if "details" not in body.model_fields_set else None))

    @router.get("/api/boards")
    def boards(request: Request):
        with db.at(db_file(request)):
            return db.list_boards()

    @router.put("/api/boards/{board_id}")
    def save_board(request: Request, board_id: str, body: BoardIn):
        with db.at(db_file(request)):
            return _db(db.save_board, board_id, body.model_dump())

    @router.delete("/api/boards/{board_id}", status_code=204)
    def delete_board(request: Request, board_id: str):
        with db.at(db_file(request)):
            _db(db.delete_board, board_id)

    @router.post("/api/boards/{board_id}/games")
    def move_games(request: Request, board_id: str, body: MoveIn):
        with db.at(db_file(request)):
            return {"moved": _db(db.move_games, board_id, body.start, body.end, body.only)}

    @router.get("/api/settings")
    def get_settings(request: Request):
        with db.at(db_file(request)):
            return db.get_settings()

    @router.put("/api/settings/{key}")
    def put_setting(request: Request, key: str, body: Setting):
        with db.at(db_file(request)):
            db.set_setting(key, body.value)
            return {"ok": True}

    @router.put("/api/matches/{match_id}")
    def put_match(request: Request, match_id: str, body: MatchIn):
        with db.at(db_file(request)):
            return {"ok": True, "saved": _db(db.save_match, match_id, body.model_dump())}

    @router.delete("/api/matches/{match_id}")
    def delete_match(request: Request, match_id: str):
        with db.at(db_file(request)):
            deleted = db.delete_match(match_id)
            if deleted:
                photos.drop(db.file(), match_id)  # its pictures go with it
            return {"ok": True, "deleted": deleted}

    @router.get("/api/matches")
    def matches(request: Request, limit: int = 20):
        with db.at(db_file(request)):
            return db.recent_matches(max(1, min(limit, 200)))

    @router.get("/api/totals")
    def totals(request: Request):
        """The two figures in the corner of the menu: darts on record and problem reports saved."""
        with db.at(db_file(request)):
            return {"darts": db.total_darts(), "reports": reports()}

    @router.get("/api/matches/{match_id}")
    def get_match(request: Request, match_id: str):
        """One match, visit by visit: what the app shows at a match's own address."""
        with db.at(db_file(request)):
            return _db(db.match, match_id)

    # A picture of the board, taken when a dart the cameras scored earned an achievement
    # (photos.py). Only ever beside a game that is in this database: on the hosted site,
    # the signed-in account's own.
    def _photo(fn, *args):
        try:
            return fn(db.file(), *args)
        except photos.Refused as e:
            raise HTTPException(400, str(e))

    @router.put("/api/matches/{match_id}/photos/{visit}")
    async def put_photo(request: Request, match_id: str, visit: str):
        body = await request.body()
        with db.at(db_file(request)):
            if not db.has_match(match_id):
                raise HTTPException(404, "no such match")
            _photo(photos.save, match_id, visit, body)
            return {"ok": True}

    @router.get("/api/matches/{match_id}/photos/{visit}")
    def get_photo(request: Request, match_id: str, visit: str):
        with db.at(db_file(request)):
            body = _photo(photos.read, match_id, visit)
        if body is None:
            raise HTTPException(404, "no picture")
        return Response(body, media_type="image/jpeg", headers={"Cache-Control": "private, no-cache"})

    @router.delete("/api/matches/{match_id}/photos/{visit}")
    def delete_photo(request: Request, match_id: str, visit: str):
        with db.at(db_file(request)):
            return {"ok": True, "deleted": _photo(photos.drop, match_id, visit)}

    return router
