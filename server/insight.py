# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""What the trial wants to know about one account, worked out from its games.

How accurate were the cameras? Every saved dart says how it was entered
(throws.src: 'cam', 'tap' or 'miss'), but a dart that was undone is not in the
saved game at all, so the app also records a "correction" each time a
camera-scored dart is undone and replaced by hand. From those:

  kept       camera darts still in the saved games: the cameras had them right
  corrected  camera darts the person replaced by hand: the cameras had them wrong
  missed     darts entered by hand in a game the cameras were scoring, other
             than corrections: the cameras did not see them
  accuracy   kept / (kept + corrected + missed)

Games with no camera dart at all (scored wholly by hand) say nothing about the
cameras and are left out of "missed".

Do players compare sets of darts? (The evidence asked for before any thought of
suggesting darts to people: see docs/superpowers/specs/2026-11-22-my-darts-design.md.)

  sets       sets of darts the account's players have added
  comparing  players with two or more sets that each have ENOUGH_DARTS single
             darts thrown: enough for the Stats page to put them side by side

And boards, the same way (every account starts with one):

  boards            boards the account has added
  comparing_boards  players who have ENOUGH_DARTS single darts on each of two or more boards
"""
from pathlib import Path

from . import db

ENOUGH_DARTS = 300  # the Stats page's ENOUGH.trebles (web/stats.js)
STEPS = ["Signed up", "Paired", "Calibrated", "First camera dart", "Played 2+ days"]


def numbers(db_file: Path, corrected: int) -> dict:
    with db.at(db_file), db.connect() as c:
        one = lambda sql: c.execute(sql).fetchone()[0]  # noqa: E731
        kept = one("SELECT COUNT(*) FROM throws WHERE src = 'cam'")
        by_hand = one("""SELECT COUNT(*) FROM throws WHERE src IN ('tap', 'miss')
                         AND match_id IN (SELECT match_id FROM throws WHERE src = 'cam')""")
        missed = max(0, by_hand - corrected)
        judged = kept + corrected + missed
        return {
            "games": one("SELECT COUNT(*) FROM matches"),
            "finished": one("SELECT COUNT(*) FROM matches WHERE finished IS NOT NULL"),
            "darts": one("SELECT COUNT(*) FROM throws"),
            "kept": kept, "corrected": corrected, "missed": missed,
            "accuracy": kept / judged if judged else None,
            "days_played": one("SELECT COUNT(DISTINCT started / 86400000) FROM matches"),
            "last_played": one("SELECT MAX(started) FROM matches"),
            "played_ms": one(f"SELECT COALESCE(SUM({db.PLAYED_MS}), 0) FROM matches m"),
            "by_game": {r["game_id"]: r["n"] for r in
                        c.execute("SELECT game_id, COUNT(*) AS n FROM matches GROUP BY game_id ORDER BY n DESC")},
            "sets": one("SELECT COUNT(*) FROM dart_sets"),
            "comparing": c.execute("""
                SELECT COUNT(*) FROM (SELECT player_id FROM (
                  SELECT mp.player_id FROM throws t
                  JOIN match_players mp ON mp.match_id = t.match_id AND mp.player_id = t.player_id
                  WHERE mp.darts IS NOT NULL AND COALESCE(t.src, '') <> 'visit'
                  GROUP BY mp.player_id, mp.darts HAVING COUNT(*) >= ?)
                GROUP BY player_id HAVING COUNT(*) >= 2)""", (ENOUGH_DARTS,)).fetchone()[0],
            "boards": one("SELECT COUNT(*) FROM boards"),
            "comparing_boards": c.execute("""
                SELECT COUNT(*) FROM (SELECT player_id FROM (
                  SELECT t.player_id FROM throws t JOIN matches m ON m.id = t.match_id
                  WHERE m.board IS NOT NULL AND COALESCE(t.src, '') NOT IN ('visit', 'bot')
                  GROUP BY t.player_id, m.board HAVING COUNT(*) >= ?)
                GROUP BY player_id HAVING COUNT(*) >= 2)""", (ENOUGH_DARTS,)).fetchone()[0],
        }


def steps(account: dict, helper: dict | None, n: dict, calibrated_events: int) -> list[bool]:
    """How far along the trial's path the account is, one True/False per STEPS entry."""
    paired = helper is not None
    calibrated = paired and (bool(helper.get("calibrated")) or calibrated_events > 0)
    return [True, paired, calibrated, n["kept"] > 0, n["days_played"] >= 2]
