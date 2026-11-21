# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Local SQLite storage: players, their darts, settings, matches and every throw.

One file, data/dartssam.db, created on first run. Back it up by copying it.

The app sends the whole match (its log plus one row per dart) every time it
changes, and the server replaces what it had. That keeps Undo simple: an
undone dart simply isn't in the next copy.

All times are milliseconds since 1970 (what JavaScript's Date.now() gives).
"""
import json
import re
import sqlite3
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

from . import paths

DB_PATH = paths.HOME / "data" / "dartssam.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created  INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,     -- removed players keep their throws
  bot      INTEGER                         -- a computer player: its level (NULL for a person)
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                      -- JSON
);
CREATE TABLE IF NOT EXISTS matches (
  id        TEXT PRIMARY KEY,              -- made up by the app
  seq       INTEGER NOT NULL,              -- goes up with every change; stale saves are ignored
  game_id   TEXT NOT NULL,
  game_name TEXT NOT NULL,
  opts      TEXT NOT NULL,                 -- JSON
  log       TEXT NOT NULL,                 -- JSON, the engine's replay log
  started   INTEGER NOT NULL,
  finished  INTEGER,                       -- NULL while in progress / abandoned
  duration  INTEGER,                       -- ms from start to the winning dart; NULL until won
  winner_id INTEGER REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS dart_sets (     -- a player's darts, like a runner's shoes
  id        TEXT PRIMARY KEY,              -- made up by the app
  player_id INTEGER NOT NULL REFERENCES players(id),
  name      TEXT NOT NULL,
  grams     REAL,                          -- weight, if given
  created   INTEGER NOT NULL,
  retired   INTEGER NOT NULL DEFAULT 0     -- put away: off the menu, kept in the stats
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,              -- throwing order, 0 first
  player_id INTEGER NOT NULL REFERENCES players(id),
  darts     TEXT,                          -- the dart_sets id they threw with; NULL if not said
  PRIMARY KEY (match_id, position)
);
CREATE TABLE IF NOT EXISTS throws (
  id        INTEGER PRIMARY KEY,
  match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  round     INTEGER NOT NULL,              -- (match, player, round) is one visit
  seg       INTEGER NOT NULL,              -- 1-20, 25 for bull, 0 for a miss
  mult      INTEGER NOT NULL,              -- 0 miss, 1 single, 2 double, 3 treble
  x         REAL,                          -- mm from the bull, NULL if unknown (Miss button)
  y         REAL,
  src       TEXT,                          -- 'cam', 'tap', 'miss', 'visit' or 'bot' (a computer player's)
  bust      INTEGER NOT NULL DEFAULT 0,    -- part of a bust visit (scores nothing)
  ts        INTEGER
);
CREATE INDEX IF NOT EXISTS throws_player ON throws(player_id);
CREATE INDEX IF NOT EXISTS throws_match ON throws(match_id);
"""


class NotFound(Exception):
    pass


class Invalid(Exception):
    pass


def now_ms() -> int:
    return int(time.time() * 1000)


# The hosted version (host.py) keeps each account's games in a file of its own
# and says which one with at(); everywhere else this stays unset and DB_PATH is used.
_file: ContextVar[Path | None] = ContextVar("db_file", default=None)


@contextmanager
def at(path: Path | None):
    """Within this block every function here works on `path` (None: the usual file)."""
    token = _file.set(path)
    try:
        yield
    finally:
        _file.reset(token)


@contextmanager
def connect():
    db = sqlite3.connect(_file.get() or DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        with db:  # commit on success, roll back on error
            yield db
    finally:
        db.close()


def _adopt_old_db():
    """The app used to be called OmniSam, and DartsOmni before that: carry
    the old database over once."""
    if DB_PATH.exists():
        return
    for name in ("omnisam.db", "dartsomni.db"):   # newest name first
        old = DB_PATH.with_name(name)
        if not old.exists():
            continue
        with sqlite3.connect(old) as db:  # fold any -wal file into the main file
            db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        db.close()
        old.rename(DB_PATH)
        for ext in ("-wal", "-shm"):
            old.with_name(old.name + ext).unlink(missing_ok=True)
        return


def init(path=None):
    global DB_PATH
    if path:
        DB_PATH = Path(path)
    else:
        _adopt_old_db()
    prepare(DB_PATH)


def prepare(path: Path):
    """Make `path` a database ready to use; harmless on one that already is."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with at(path), connect() as db:
        db.execute("PRAGMA journal_mode = WAL")  # survives a power cut mid-write
        db.executescript(SCHEMA)
        # Databases from before games were timed: add the column, leave old games untimed.
        if "duration" not in [c["name"] for c in db.execute("PRAGMA table_info(matches)")]:
            db.execute("ALTER TABLE matches ADD COLUMN duration INTEGER")
        # From before darts were tracked: nobody's darts are known for the games already played.
        if "darts" not in [c["name"] for c in db.execute("PRAGMA table_info(match_players)")]:
            db.execute("ALTER TABLE match_players ADD COLUMN darts TEXT")
        # From before there were computer players: everyone already here is a person.
        if "bot" not in [c["name"] for c in db.execute("PRAGMA table_info(players)")]:
            db.execute("ALTER TABLE players ADD COLUMN bot INTEGER")


# ---------- players ----------
NAME_MAX = 16


def _clean_name(name: str) -> str:
    name = " ".join(str(name).split())
    if not 1 <= len(name) <= NAME_MAX:
        raise Invalid(f"a name needs 1 to {NAME_MAX} characters")
    return name


def _player(row) -> dict:
    # A computer player says its level; a person has no "bot" at all.
    return {"id": row["id"], "name": row["name"], **({"bot": row["bot"]} if row["bot"] else {})}


def list_players() -> list[dict]:
    with connect() as db:
        return [_player(r) for r in db.execute(
            "SELECT * FROM players WHERE archived = 0 ORDER BY name")]


BOT_LEVELS = 99  # the most levels a computer player could have (the app has the real list: web/bot.js)


def add_player(name: str, bot: int | None = None) -> dict:
    """Create a player. Adding a removed player's name brings them back,
    history and all. bot: the level of a computer player (the app plays its
    darts and saves them like anyone's), or None for a person."""
    name = _clean_name(name)
    if bot is not None and not 1 <= bot <= BOT_LEVELS:
        raise Invalid("no such level of computer player")
    with connect() as db:
        row = db.execute("SELECT * FROM players WHERE name = ?", (name,)).fetchone()
        if row and not row["archived"]:
            raise Invalid(f"there is already a player called {row['name']}")
        if row:
            db.execute("UPDATE players SET archived = 0, name = ?, bot = ? WHERE id = ?", (name, bot, row["id"]))
            return _player({"id": row["id"], "name": name, "bot": bot})
        cur = db.execute("INSERT INTO players (name, created, bot) VALUES (?, ?, ?)", (name, now_ms(), bot))
        return _player({"id": cur.lastrowid, "name": name, "bot": bot})


def player_named(name: str) -> int:
    """The id of the player called this, made now if there is none."""
    name = _clean_name(name)
    with connect() as db:
        row = db.execute("SELECT id FROM players WHERE name = ?", (name,)).fetchone()
        if row:
            return row["id"]
        return db.execute("INSERT INTO players (name, created) VALUES (?, ?)", (name, now_ms())).lastrowid


def rename_player(player_id: int, name: str) -> dict:
    name = _clean_name(name)
    with connect() as db:
        clash = db.execute("SELECT name FROM players WHERE name = ? AND id <> ?",
                           (name, player_id)).fetchone()
        if clash:
            raise Invalid(f"there is already a player called {clash['name']}")
        if not db.execute("UPDATE players SET name = ? WHERE id = ?", (name, player_id)).rowcount:
            raise NotFound("no such player")
        return {"id": player_id, "name": name}


def remove_player(player_id: int):
    """Hide a player from the lists. Their matches and throws are kept."""
    with connect() as db:
        if not db.execute("UPDATE players SET archived = 1 WHERE id = ?", (player_id,)).rowcount:
            raise NotFound("no such player")


# ---------- darts ----------
# Each player can have several sets of darts and say which they threw with in
# each game, so their stats can be seen set by set. The app makes up a set's id
# (as it does a match's), so a set added with no Pi needs no renumbering later.
DARTS_NAME_MAX = 24
_ID = re.compile(r"^[\w-]{1,64}$")


def _dart_set(row) -> dict:
    return {"id": row["id"], "player": row["player_id"], "name": row["name"], "grams": row["grams"],
            "created": row["created"], "retired": bool(row["retired"])}


def list_darts() -> list[dict]:
    """Every player's darts, put away ones too, oldest first."""
    with connect() as db:
        return [_dart_set(r) for r in db.execute("SELECT * FROM dart_sets ORDER BY created, id")]


def save_darts(darts_id: str, d: dict) -> dict:
    """Add a set of darts, or change one: d has player, name, grams (or None)
    and retired. A set stays with the player it was made for."""
    if not _ID.match(darts_id):
        raise Invalid("a set of darts needs an id of letters, numbers, - and _")
    name = " ".join(str(d.get("name", "")).split())
    if not 1 <= len(name) <= DARTS_NAME_MAX:
        raise Invalid(f"a set of darts needs a name of 1 to {DARTS_NAME_MAX} characters")
    grams = d.get("grams")
    if grams is not None and not 1 <= grams <= 100:
        raise Invalid("darts weigh between 1 and 100 grams")
    with connect() as db:
        if not db.execute("SELECT 1 FROM players WHERE id = ?", (d["player"],)).fetchone():
            raise Invalid("unknown player id")
        old = db.execute("SELECT player_id FROM dart_sets WHERE id = ?", (darts_id,)).fetchone()
        if old and old["player_id"] != d["player"]:
            raise Invalid("those darts belong to another player")
        db.execute(
            "INSERT INTO dart_sets (id, player_id, name, grams, created, retired) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET name = excluded.name, grams = excluded.grams, retired = excluded.retired",
            (darts_id, d["player"], name, grams, int(d.get("created") or now_ms()), int(bool(d.get("retired")))))
        return _dart_set(db.execute("SELECT * FROM dart_sets WHERE id = ?", (darts_id,)).fetchone())


# ---------- settings ----------
def get_settings() -> dict:
    with connect() as db:
        return {r["key"]: json.loads(r["value"]) for r in db.execute("SELECT * FROM settings")}


def set_setting(key: str, value):
    with connect() as db:
        db.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                   "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, json.dumps(value)))


# ---------- matches ----------
def save_match(match_id: str, m: dict) -> bool:
    """Store the current state of a match, replacing any earlier copy.

    m: seq, game_id, game_name, opts, log, started, players (ids in throwing
    order), darts (optional: the dart set each player threw with, in the same
    order; None, or a set that is not that player's, is stored as not known), winner (index into players, or None), duration (ms the game took,
    kept only once it is won), throws (list of dicts with player index, round,
    seg, mult, x, y, src, bust, ts).
    Returns False if a newer copy is already stored.
    """
    ids = m["players"]
    if not ids or len(set(ids)) != len(ids):
        raise Invalid("players must be a list of different player ids")
    if m["winner"] is not None and not 0 <= m["winner"] < len(ids):
        raise Invalid("winner is not one of the players")
    if any(not 0 <= t["player"] < len(ids) for t in m["throws"]):
        raise Invalid("a throw belongs to a player who is not in the match")
    with connect() as db:
        known = db.execute(f"SELECT COUNT(*) FROM players WHERE id IN ({','.join('?' * len(ids))})",
                           ids).fetchone()[0]
        if known != len(ids):
            raise Invalid("unknown player id")
        old = db.execute("SELECT seq, finished FROM matches WHERE id = ?", (match_id,)).fetchone()
        if old and old["seq"] >= m["seq"]:
            return False
        winner_id = finished = duration = None
        if m["winner"] is not None:
            winner_id = ids[m["winner"]]
            if m.get("duration") is not None:
                duration = max(0, int(m["duration"]))
            finished = (old and old["finished"]) or now_ms()
        db.execute(
            "INSERT INTO matches (id, seq, game_id, game_name, opts, log, started, finished, winner_id, duration) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, opts = excluded.opts, log = excluded.log, "
            "finished = excluded.finished, winner_id = excluded.winner_id, duration = excluded.duration",
            (match_id, m["seq"], m["game_id"], m["game_name"], json.dumps(m["opts"]),
             json.dumps(m["log"]), int(m["started"]), finished, winner_id, duration))
        given = list(m.get("darts") or [])[:len(ids)]
        given += [None] * (len(ids) - len(given))
        theirs = {(r["id"], r["player_id"]) for r in db.execute(
            f"SELECT id, player_id FROM dart_sets WHERE id IN ({','.join('?' * len(ids))})", given)}
        darts = [d if (d, pid) in theirs else None for d, pid in zip(given, ids)]
        db.execute("DELETE FROM match_players WHERE match_id = ?", (match_id,))
        db.executemany("INSERT INTO match_players (match_id, position, player_id, darts) VALUES (?, ?, ?, ?)",
                       [(match_id, i, pid, d) for i, (pid, d) in enumerate(zip(ids, darts))])
        db.execute("DELETE FROM throws WHERE match_id = ?", (match_id,))
        db.executemany(
            "INSERT INTO throws (match_id, player_id, round, seg, mult, x, y, src, bust, ts) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(match_id, ids[t["player"]], t["round"], t["seg"], t["mult"], t.get("x"), t.get("y"),
              t.get("src"), int(bool(t.get("bust"))), t.get("ts")) for t in m["throws"]])
    return True


def match_seqs() -> dict[str, int]:
    """Every stored match's seq by its id: what has changed since some earlier look."""
    with connect() as db:
        return {r["id"]: r["seq"] for r in db.execute("SELECT id, seq FROM matches")}


def export_match(match_id: str) -> dict | None:
    """A stored match as save_match() takes one, so a copy can be saved
    somewhere else (share.py). None: no such match."""
    with connect() as db:
        m = db.execute("SELECT * FROM matches WHERE id = ?", (match_id,)).fetchone()
        if m is None:
            return None
        seats = db.execute(
            "SELECT player_id, darts FROM match_players WHERE match_id = ? ORDER BY position", (match_id,)).fetchall()
        ids = [r["player_id"] for r in seats]
        throws = db.execute("SELECT * FROM throws WHERE match_id = ? ORDER BY id", (match_id,)).fetchall()
        return {
            "seq": m["seq"], "game_id": m["game_id"], "game_name": m["game_name"], "opts": json.loads(m["opts"]),
            "log": json.loads(m["log"]), "started": m["started"], "players": ids,
            "darts": [r["darts"] for r in seats],
            "winner": ids.index(m["winner_id"]) if m["winner_id"] in ids else None, "duration": m["duration"],
            "throws": [{"player": ids.index(t["player_id"]), "round": t["round"], "seg": t["seg"], "mult": t["mult"],
                        "x": t["x"], "y": t["y"], "src": t["src"], "bust": bool(t["bust"]), "ts": t["ts"]}
                       for t in throws if t["player_id"] in ids],
        }


def delete_match(match_id: str) -> bool:
    """Throw away a game that was quit part-way, along with all its throws.

    A finished game is left alone. Returns True if something was removed.
    """
    with connect() as db:
        if not db.execute("SELECT 1 FROM matches WHERE id = ? AND finished IS NULL", (match_id,)).fetchone():
            return False
        db.execute("DELETE FROM throws WHERE match_id = ?", (match_id,))
        db.execute("DELETE FROM match_players WHERE match_id = ?", (match_id,))
        db.execute("DELETE FROM matches WHERE id = ?", (match_id,))
    return True


def recent_matches(limit: int = 20) -> list[dict]:
    """Finished matches, newest first."""
    with connect() as db:
        out = []
        for r in db.execute(
                "SELECT m.*, w.name AS winner FROM matches m LEFT JOIN players w ON w.id = m.winner_id "
                "WHERE m.finished IS NOT NULL ORDER BY m.finished DESC LIMIT ?", (limit,)).fetchall():
            names = [p["name"] for p in db.execute(
                "SELECT p.name FROM match_players mp JOIN players p ON p.id = mp.player_id "
                "WHERE mp.match_id = ? ORDER BY mp.position", (r["id"],))]
            out.append({"id": r["id"], "game": r["game_name"], "when": r["finished"],
                        "players": names, "winner": r["winner"], "duration": r["duration"]})
        return out


def total_darts() -> int:
    """Every dart on record, everyone's. A visit typed in as one number has no
    single darts to count (the same rule as a player's own stats), and a
    computer player's darts were never thrown at all."""
    with connect() as db:
        return db.execute(
            "SELECT COUNT(*) FROM throws WHERE COALESCE(src, '') NOT IN ('visit', 'bot')").fetchone()[0]


# ---------- stats ----------
# The numbers behind the Players & stats screen: one page for all games
# together and one per game type. Each game's own figures (averages and the
# like) are worked out by going back through its throws in the order thrown;
# X01's are worked out by the app, from the history sent along with the rest.
CRICKET = (20, 19, 18, 17, 16, 15, 25)
HEAT_DARTS = 5000  # most recent dart positions sent for the heat map
# How long a match (m) was played for, in ms: its time once won, and otherwise
# (quit part-way and kept, still going, or won before games were timed) from
# its start to the last dart thrown in it.
PLAYED_MS = "COALESCE(m.duration, MAX(0, (SELECT MAX(ts) FROM throws WHERE match_id = m.id) - m.started), 0)"


def _matches(db, player_id: int, game_id: str | None, darts: str | None = None) -> list:
    """Every match the player took part in (of one game type, or of them all;
    with darts, only those they threw that set of darts in), oldest first, as
    (match row, player ids in throwing order, throws in the order thrown)."""
    out = []
    for m in db.execute(
            "SELECT m.* FROM matches m JOIN match_players mp ON mp.match_id = m.id "
            "WHERE mp.player_id = ?" + (" AND m.game_id = ?" if game_id else "")
            + (" AND mp.darts = ?" if darts else "") + " ORDER BY m.started",
            (player_id, *([game_id] if game_id else []), *([darts] if darts else []))).fetchall():
        ids = [r["player_id"] for r in db.execute(
            "SELECT player_id FROM match_players WHERE match_id = ? ORDER BY position", (m["id"],))]
        throws = db.execute("SELECT * FROM throws WHERE match_id = ? ORDER BY id", (m["id"],)).fetchall()
        out.append((m, ids, throws))
    return out


def _visits(throws) -> list:
    """Split throws (in order) into visits: one player's darts in one round."""
    out = []
    for t in throws:
        if out and out[-1][0]["player_id"] == t["player_id"] and out[-1][0]["round"] == t["round"]:
            out[-1].append(t)
        else:
            out.append([t])
    return out


def _history(db, player_id: int, game_id: str | None, darts: str | None = None) -> list[dict]:
    """The player's matches, oldest first, visit by visit and with everyone's
    darts. The app works the X01 figures out from this, and opens any figure
    up into the visits, legs and scoresheets behind it (web/stats.js).

    A visit is [player, round, ts, bust, darts]: player is an index into the
    match's players and each dart is seg * 10 + mult (T20 is 203, a miss 0).
    A visit typed in as one number has no darts to list and is
    [player, round, ts, bust, None, total, darts used].
    """
    names = _names(db)
    return [{**_sheet(m, ids, throws, names), "me": ids.index(player_id)}
            for m, ids, throws in _matches(db, player_id, game_id, darts)]


def _names(db) -> dict:
    return {r["id"]: r["name"] for r in db.execute("SELECT id, name FROM players")}


def _sheet(m, ids, throws, names) -> dict:
    """One match of a history: who played, how it ended and every visit."""
    visits = []
    for v in _visits(throws):
        head = [ids.index(v[0]["player_id"]), v[0]["round"], v[-1]["ts"], int(any(t["bust"] for t in v))]
        if v[0]["src"] == "visit":
            visits.append(head + [None, v[0]["seg"], len(v)])
        else:
            visits.append(head + [[t["seg"] * 10 + t["mult"] if t["mult"] else 0 for t in v]])
    return {
        "id": m["id"], "game": m["game_id"], "name": m["game_name"], "opts": json.loads(m["opts"]),
        "started": m["started"], "finished": m["finished"], "duration": m["duration"],
        "players": [names[i] for i in ids],
        "winner": ids.index(m["winner_id"]) if m["winner_id"] in ids else None,
        "visits": visits,
    }


def match(match_id: str) -> dict:
    """One match by its id, in the shape of a history entry (see _history) but
    belonging to no player in particular, so without "me". The app shows it as
    a scoresheet when the match's own address is opened."""
    with connect() as db:
        m = db.execute("SELECT * FROM matches WHERE id = ?", (match_id,)).fetchone()
        if m is None:
            raise NotFound("no such match")
        ids = [r["player_id"] for r in db.execute(
            "SELECT player_id FROM match_players WHERE match_id = ? ORDER BY position", (match_id,))]
        throws = db.execute("SELECT * FROM throws WHERE match_id = ? ORDER BY id", (match_id,)).fetchall()
        return _sheet(m, ids, throws, _names(db))


def _cricket(db, player_id: int, dart_set: str | None = None):
    """Marks per round, the usual Cricket average. A mark counts if it went
    towards closing a number or scored points; darts at a dead number don't."""
    marks = rounds = best = big = 0
    for _m, ids, throws in _matches(db, player_id, "cricket", dart_set):
        got = {p: dict.fromkeys(CRICKET, 0) for p in ids}
        for visit in _visits(throws):
            n = 0
            for t in visit:
                p, seg = t["player_id"], t["seg"]
                if seg not in CRICKET:
                    continue
                for _ in range(t["mult"]):
                    if got[p][seg] < 3:
                        got[p][seg] += 1
                        n += 1
                    elif any(got[o][seg] < 3 for o in ids if o != p):
                        n += 1
            if visit[0]["player_id"] == player_id:
                rounds += 1
                marks += n
                best = max(best, n)
                big += n >= 5
    if not rounds:
        return None
    return {"mpr": round(marks / rounds, 2), "best_round": best, "big_rounds": big, "marks": marks}


def _clock(db, player_id: int, dart_set: str | None = None):
    darts = hits = best_run = 0
    finishes = []  # darts taken in each game the player got all the way round
    for m, _ids, throws in _matches(db, player_id, "clock", dart_set):
        skip = json.loads(m["opts"]).get("skip") == "yes"
        target, n, run = 1, 0, 0
        for t in throws:
            if t["player_id"] != player_id or target is None:
                continue
            n += 1
            if not t["mult"] or t["seg"] != target:
                run = 0
                continue
            hits += 1
            run += 1
            best_run = max(best_run, run)
            if target == 25:
                target = None
                finishes.append(n)
            else:
                target += t["mult"] if skip else 1
                if target > 20:
                    target = 25
        darts += n
    if not darts:
        return None
    return {
        "hit_rate": round(hits / darts * 100, 1),
        "avg_finish": round(sum(finishes) / len(finishes), 1) if finishes else None,
        "best_finish": min(finishes, default=None),
        "best_run": best_run,
    }


def _countup(db, player_id: int, dart_set: str | None = None):
    scores, totals, darts = [], [], 0
    for m, _ids, throws in _matches(db, player_id, "countup", dart_set):
        mine = [t for t in throws if t["player_id"] == player_id]
        visits = [sum(t["seg"] * t["mult"] for t in v) for v in _visits(mine)]
        scores += visits
        darts += len(mine)
        if m["finished"]:
            totals.append(sum(visits))
    if not darts:
        return None
    return {
        "average": round(sum(scores) / darts * 3, 1),
        "highest": max(scores),
        "t100": sum(s >= 100 for s in scores),
        "avg_total": round(sum(totals) / len(totals)) if totals else None,
        "best_total": max(totals, default=None),
    }


def _bobs27(db, player_id: int, dart_set: str | None = None):
    """Bob's 27: every player has their own score and double, so only the
    player's own visits are replayed, with the game's own options. Score
    figures count finished games only."""
    darts = hits = 0
    scores = []
    for m, _ids, throws in _matches(db, player_id, "bobs27", dart_set):
        o = json.loads(m["opts"])
        last = 20 if o.get("bull") == "no" else 25
        stop = o.get("zero") != "on"
        score, target, over = 27, 1, False
        for visit in _visits(throws):
            if visit[0]["player_id"] != player_id or over:
                continue
            got = [t for t in visit if t["mult"] == 2 and t["seg"] == target]
            darts += len(visit)
            hits += len(got)
            score += sum(t["seg"] * 2 for t in got)
            if len(visit) < 3:  # cut short: the game ended on this visit
                continue
            if not got:
                score -= target * 2
                over = stop and score <= 0
            over = over or target >= last
            target = 25 if target == 20 else target + 1
        if m["finished"]:
            scores.append(score)
    if not darts:
        return None
    return {
        "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        "best_score": max(scores, default=None),
        "double_rate": round(hits / darts * 100, 1),
        "above_zero": sum(s > 0 for s in scores),
    }


def _shanghai(db, player_id: int, dart_set: str | None = None):
    """Shanghai: in round N only the number N scores, so the player's own
    visits are read by round. A Shanghai is a single, a double and a treble of
    the round's number in one visit, counted whether or not it ended the game.
    Total figures count finished games only."""
    darts = hits = shanghais = 0
    totals = []
    for m, _ids, throws in _matches(db, player_id, "shanghai", dart_set):
        total = 0
        for visit in _visits(throws):
            if visit[0]["player_id"] != player_id:
                continue
            got = [t for t in visit if t["seg"] == visit[0]["round"]]
            darts += len(visit)
            hits += len(got)
            total += sum(t["seg"] * t["mult"] for t in got)
            shanghais += {1, 2, 3} <= {t["mult"] for t in got}
        if m["finished"]:
            totals.append(total)
    if not darts:
        return None
    return {
        "avg_total": round(sum(totals) / len(totals), 1) if totals else None,
        "best_total": max(totals, default=None),
        "shanghais": shanghais,
        "hit_rate": round(hits / darts * 100, 1),
    }


def _bermuda(db, player_id: int, dart_set: str | None = None):
    """Bermuda: round N has its own target (see ROUNDS in web/games/bermuda.js),
    so the player's visits are read by round. A visit with no hit halves the
    total. Total and halved figures count finished games only."""
    rounds = [12, 13, 14, "D", 15, 16, 17, "T", 18, 19, 20, 25, 50]

    def hit(target, t):
        if target == "D":
            return t["mult"] == 2
        if target == "T":
            return t["mult"] == 3
        if target == 50:
            return t["seg"] == 25 and t["mult"] == 2
        return t["seg"] == target

    darts = hits = 0
    totals, halves = [], []
    for m, _ids, throws in _matches(db, player_id, "bermuda", dart_set):
        total = halved = 0
        for visit in _visits(throws):
            if visit[0]["player_id"] != player_id:
                continue
            target = rounds[visit[0]["round"] - 1]
            got = [t for t in visit if hit(target, t)]
            darts += len(visit)
            hits += len(got)
            total += sum(t["seg"] * t["mult"] for t in got)
            if len(visit) == 3 and not got:
                total //= 2
                halved += 1
        if m["finished"]:
            totals.append(total)
            halves.append(halved)
    if not darts:
        return None
    return {
        "avg_total": round(sum(totals) / len(totals), 1) if totals else None,
        "best_total": max(totals, default=None),
        "avg_halved": round(sum(halves) / len(halves), 1) if halves else None,
        "hit_rate": round(hits / darts * 100, 1),
    }


def _segment(db, player_id: int, dart_set: str | None = None):
    """Segment Training: a dart counts if it is in the game's bed (and ring, when
    the game asks for one) and scores its multiplier. One figure over all the
    player's segment games, whichever bed they aimed at; best session counts
    finished games only."""
    ring = {"single": 1, "double": 2, "treble": 3}
    darts = hits = points = 0
    best = []
    for m, _ids, throws in _matches(db, player_id, "segment", dart_set):
        o = json.loads(m["opts"])
        want = ring.get(o.get("counts"))
        got = [t for t in throws
               if t["player_id"] == player_id and t["mult"] and t["seg"] == o.get("seg", 20) and want in (None, t["mult"])]
        darts += sum(t["player_id"] == player_id for t in throws)
        hits += len(got)
        mine = sum(t["mult"] for t in got)
        points += mine
        if m["finished"]:
            best.append(mine)
    if not darts:
        return None
    return {
        "hit_rate": round(hits / darts * 100, 1),
        "points_per_dart": round(points / darts, 2),
        "best_points": max(best, default=None),
    }


# Finishes that three darts cannot make (double out): everything over 170 too.
_NO_FINISH = {159, 162, 163, 165, 166, 168, 169}


def _c121(db, player_id: int, dart_set: str | None = None):
    """121 Checkout: every player has their own target, so only the player's
    own visits are replayed. (Games from when the target was shared are read
    the same way.)"""
    tries = made = highest = 0
    took = []  # darts used on each target that was checked out
    played = False
    for m, _ids, throws in _matches(db, player_id, "c121", dart_set):
        played = played or bool(throws)
        o = json.loads(m["opts"])
        start, limit = o.get("start", 121), o.get("darts", 9)
        inc, dec = o.get("inc", 1), o.get("dec", 0)
        target = left = start
        used = 0

        def settle(ok):
            nonlocal target, left, used, tries, made, highest
            tries += 1
            if ok:
                made += 1
                took.append(used)
                highest = max(highest, target)
                target += inc
            else:
                target = max(start, target - dec) if dec else start
            left, used = target, 0

        for visit in _visits(throws):
            if visit[0]["player_id"] != player_id:
                continue
            begin = left
            if visit[0]["src"] == "visit":  # typed in as one number
                if visit[0]["bust"]:
                    used += 3
                else:
                    left -= visit[0]["seg"]
                    used += len(visit)
            else:
                for t in visit:
                    used += 1
                    after = left - t["seg"] * t["mult"]
                    if after < 0 or after == 1 or (after == 0 and t["mult"] != 2):
                        left = begin
                        break
                    left = after
                    if left == 0:
                        break
            if left == 0:
                settle(True)
                continue
            # The visit is over, whether it was three darts, a bust, or cut short
            # because no finish was left: the darts not thrown are gone. The
            # attempt ends when none are left, or the last three can't finish.
            used = -(-used // 3) * 3
            if used >= limit or (limit - used <= 3 and (left > 170 or left in _NO_FINISH)):
                settle(False)
    if not played:
        return None
    return {
        "rate": round(made / tries * 100, 1) if tries else None,
        "made": made,
        "highest": highest or None,
        "avg_darts": round(sum(took) / len(took), 1) if took else None,
    }


GAME_STATS = {"cricket": _cricket, "clock": _clock, "countup": _countup, "c121": _c121, "bobs27": _bobs27, "shanghai": _shanghai, "bermuda": _bermuda, "segment": _segment}


def _gear(db, player_id: int, game_id: str | None) -> list[dict]:
    """How much each of the player's sets of darts has been used (in one game
    type, or in all), the way a running app counts the miles on each pair of
    shoes. Every set is listed, used or not, and games thrown with no set
    named are one more line with id None (left out if there are none).
    darts counts every dart thrown, typed visits too: they wore the darts all the same."""
    game, args = (" AND m.game_id = ?", (player_id, game_id)) if game_id else ("", (player_id,))
    used = {r["id"]: dict(r) for r in db.execute(
        "SELECT mp.darts AS id, COUNT(*) AS games, "
        "SUM(m.winner_id = mp.player_id AND (SELECT COUNT(*) FROM match_players o WHERE o.match_id = m.id) > 1) AS won, "
        "MIN(m.started) AS first, MAX(COALESCE(m.finished, m.started)) AS last "
        "FROM match_players mp JOIN matches m ON m.id = mp.match_id "
        "WHERE mp.player_id = ?" + game + " GROUP BY mp.darts", args)}
    for r in db.execute(
            "SELECT mp.darts AS id, COUNT(*) AS n FROM throws t "
            "JOIN match_players mp ON mp.match_id = t.match_id AND mp.player_id = t.player_id "
            "JOIN matches m ON m.id = t.match_id WHERE t.player_id = ?" + game + " GROUP BY mp.darts", args):
        used[r["id"]]["darts"] = r["n"]
    out = []
    for s in db.execute("SELECT * FROM dart_sets WHERE player_id = ? ORDER BY created, id", (player_id,)):
        u = used.pop(s["id"], {})
        out.append({**_dart_set(s), "games": u.get("games", 0), "won": u.get("won", 0), "darts": u.get("darts", 0),
                    "first": u.get("first"), "last": u.get("last")})
    if None in used:
        u = used[None]
        out.append({"id": None, "name": None, "games": u["games"], "won": u["won"], "darts": u.get("darts", 0),
                    "first": u["first"], "last": u["last"]})
    return out


def stats(player_id: int, game_id: str | None = None, darts: str | None = None) -> dict:
    """A player's stats: for every game together, or for one game type.

    With game_id, everything is limited to that game and "detail" holds the
    game's own figures (None if the player has not played it, and for X01,
    whose figures the app works out itself from "matches").
    With darts (the id of one of the player's sets), everything is limited
    to the games they threw those darts in. "gear" is always every set's use.
    """
    where, args = [], [player_id]
    if game_id:
        where.append("match_id IN (SELECT id FROM matches WHERE game_id = ?)")
        args.append(game_id)
    if darts:
        where.append("match_id IN (SELECT match_id FROM match_players WHERE player_id = ? AND darts = ?)")
        args += [player_id, darts]
    scope = "".join(" AND " + w for w in where)
    args = tuple(args)
    with connect() as db:
        p = db.execute("SELECT * FROM players WHERE id = ?", (player_id,)).fetchone()
        if p is None:
            raise NotFound("no such player")
        if darts and not db.execute("SELECT 1 FROM dart_sets WHERE id = ? AND player_id = ?",
                                    (darts, player_id)).fetchone():
            raise NotFound("no such darts")
        h = db.execute(
            "SELECT COUNT(*) AS darts, COALESCE(SUM(mult = 0), 0) AS misses, "
            "COALESCE(SUM(mult = 3), 0) AS trebles, COALESCE(SUM(mult = 2 AND seg <> 25), 0) AS doubles, "
            "COALESCE(SUM(seg = 25), 0) AS bulls, MIN(ts) AS first FROM throws "
            # A visit typed in as one number has no single darts to count.
            "WHERE player_id = ? AND COALESCE(src, '') <> 'visit'" + scope, args).fetchone()
        games = db.execute(
            "SELECT m.game_name AS game, COUNT(*) AS played, "
            "SUM(m.winner_id = mp.player_id AND "
            "    (SELECT COUNT(*) FROM match_players o WHERE o.match_id = m.id) > 1) AS won, "
            # Time per game type; games from before the timer have no duration and are left out.
            "CAST(AVG(m.duration) AS INTEGER) AS avg_ms, MIN(m.duration) AS best_ms, "
            f"SUM({PLAYED_MS}) AS total_ms "
            "FROM match_players mp JOIN matches m ON m.id = mp.match_id "
            "WHERE mp.player_id = ? AND m.finished IS NOT NULL" + (" AND m.game_id = ?" if game_id else "")
            + (" AND mp.darts = ?" if darts else "") + " GROUP BY m.game_id ORDER BY played DESC",
            (player_id, *([game_id] if game_id else []), *([darts] if darts else []))).fetchall()
        # Time at the board in every game they threw in, finished or not.
        played = db.execute(
            f"SELECT COALESCE(SUM({PLAYED_MS}), 0) FROM match_players mp JOIN matches m ON m.id = mp.match_id "
            "WHERE mp.player_id = ?" + (" AND m.game_id = ?" if game_id else "") + (" AND mp.darts = ?" if darts else ""),
            (player_id, *([game_id] if game_id else []), *([darts] if darts else []))).fetchone()[0]
        segs = db.execute(
            "SELECT seg, COUNT(*) AS n FROM throws WHERE player_id = ? AND mult > 0 "
            "AND COALESCE(src, '') <> 'visit'" + scope + " GROUP BY seg ORDER BY n DESC LIMIT 5", args).fetchall()
        # Where the darts landed, newest first: drawn as the heat map.
        recent = db.execute(
            "SELECT x, y FROM throws WHERE player_id = ? AND x IS NOT NULL" + scope
            + " ORDER BY ts DESC, id DESC LIMIT ?", (*args, HEAT_DARTS)).fetchall()
        matches = _history(db, player_id, game_id, darts)
        detail = GAME_STATS[game_id](db, player_id, darts) if game_id in GAME_STATS else None
        gear = _gear(db, player_id, game_id)
    return {
        "player": _player(p),
        "game": game_id,
        "set": darts,
        "darts": h["darts"], "misses": h["misses"], "trebles": h["trebles"],
        "doubles": h["doubles"], "bulls": h["bulls"], "since": h["first"],
        "played_ms": played,
        "games": [dict(g) for g in games],
        "detail": detail,
        "matches": matches,
        "segments": [dict(s) for s in segs],
        "recent": [[r["x"], r["y"]] for r in recent],
        "gear": gear,
    }
