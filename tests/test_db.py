# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Tests for the saved-data layer (server/db.py), using a throwaway database.

  python -m tests.test_db
"""
import tempfile
from pathlib import Path

from server import db


def throw(player, rnd, seg, mult, bust=False, x=None, y=None):
    return {"player": player, "round": rnd, "seg": seg, "mult": mult, "x": x, "y": y,
            "src": "tap", "bust": bust, "ts": 1000 * rnd}


def match(seq, players, throws, winner=None, game="x01", duration=None, opts=None):
    return {"seq": seq, "game_id": game, "game_name": game.upper(), "opts": opts or {"start": 101}, "log": [],
            "started": 1, "players": players, "winner": winner, "duration": duration, "throws": throws}


# Random Checkout targets as the app makes them (see the node command in main).
EXPECTED_RC_MID = [99, 59, 70, 90, 71]
EXPECTED_RC_ALL = [103, 2, 87, 161, 158, 47, 101, 118, 70, 170, 75, 81]


def expect(exc, fn, *args):
    try:
        fn(*args)
    except exc:
        return
    raise AssertionError(f"{fn.__name__} should have raised {exc.__name__}")


def main():
    with tempfile.TemporaryDirectory() as tmp:
        db.init(Path(tmp) / "sub" / "test.db")
        db.init(Path(tmp) / "sub" / "test.db")  # starting twice must be harmless

        # players: add, duplicates, rename, remove, bring back
        sam = db.add_player("  Sam  ")
        alex = db.add_player("Alex")
        assert sam["name"] == "Sam"
        assert [p["name"] for p in db.list_players()] == ["Alex", "Sam"]
        expect(db.Invalid, db.add_player, "sam")
        expect(db.Invalid, db.add_player, "   ")
        expect(db.Invalid, db.add_player, "x" * 17)
        expect(db.Invalid, db.rename_player, alex["id"], "SAM")
        expect(db.NotFound, db.rename_player, 999, "Nobody")
        assert db.rename_player(alex["id"], "Alexa")["name"] == "Alexa"

        # a computer player is a player with a level; its darts are not counted as thrown
        bot = db.add_player("Bot 7", 7)
        assert bot == {"id": bot["id"], "name": "Bot 7", "bot": 7}
        assert "bot" not in sam and bot in db.list_players()
        expect(db.Invalid, db.add_player, "Bot 0", 0)
        db.save_match("mb", match(1, [sam["id"], bot["id"]], [throw(0, 1, 20, 1), {**throw(1, 1, 20, 3), "src": "bot"}]))
        assert db.total_darts() == 1
        # the history says which seats the computer had, by level (the app's achievements read it)
        assert db.stats(sam["id"])["matches"][0]["bots"] == [None, 7]
        db.delete_match("mb")
        db.remove_player(bot["id"])
        assert db.add_player("bot 7", 7)["id"] == bot["id"]
        db.remove_player(bot["id"])

        # settings
        db.set_setting("settings", {"voice": False})
        db.set_setting("settings", {"voice": True})
        assert db.get_settings() == {"settings": {"voice": True}}

        # a 101 leg: Sam 60, Alexa busts, Sam finishes 41 with 9, D16
        t1 = [throw(0, 1, 20, 3, x=0, y=103)]
        assert db.save_match("m1", match(1, [sam["id"], alex["id"]], t1))
        full = t1 + [throw(1, 1, 20, 3, bust=True), throw(1, 1, 20, 3, bust=True),
                     throw(0, 2, 9, 1), throw(0, 2, 16, 2)]
        assert db.save_match("m1", match(3, [sam["id"], alex["id"]], full, winner=0, duration=95000))
        # a late, older copy (e.g. a retry arriving out of order) must not win
        assert not db.save_match("m1", match(2, [sam["id"], alex["id"]], t1))
        expect(db.Invalid, db.save_match, "m2", match(1, [sam["id"], 999], []))
        expect(db.Invalid, db.save_match, "m2", match(1, [sam["id"], sam["id"]], []))
        expect(db.Invalid, db.save_match, "m2", match(1, [sam["id"]], [throw(1, 1, 20, 1)]))

        rec = db.recent_matches()
        assert len(rec) == 1 and rec[0]["winner"] == "Sam" and rec[0]["players"] == ["Sam", "Alexa"]
        assert rec[0]["duration"] == 95000

        assert db.total_darts() == 5  # everyone's
        s = db.stats(sam["id"])
        assert s["darts"] == 3 and s["trebles"] == 1 and s["doubles"] == 1 and s["misses"] == 0
        # the history the app works the X01 figures out from: every visit, everyone's darts
        assert [m["id"] for m in s["matches"]] == ["m1"]
        h = s["matches"][0]
        assert (h["game"], h["players"], h["me"], h["winner"], h["duration"]) == ("x01", ["Sam", "Alexa"], 0, 0, 95000)
        assert h["opts"] == {"start": 101} and h["finished"] is not None
        assert h["bots"] == [None, None]
        assert h["visits"] == [[0, 1, 1000, 0, [203]], [1, 1, 1000, 1, [203, 203]], [0, 2, 2000, 0, [91, 162]]]
        assert s["recent"] == [[0.0, 103.0]]
        assert s["games"] == [{"game": "X01", "played": 1, "won": 1, "avg_ms": 95000, "best_ms": 95000, "total_ms": 95000}]
        a = db.stats(alex["id"])
        assert a["matches"][0]["me"] == 1 and a["matches"][0]["visits"] == h["visits"]
        assert a["games"] == [{"game": "X01", "played": 1, "won": 0, "avg_ms": 95000, "best_ms": 95000, "total_ms": 95000}]
        expect(db.NotFound, db.stats, 999)
        # one match on its own: the same history entry, belonging to nobody (so thrown with no one's darts)
        assert h["darts"] is None
        assert db.match("m1") == {k: v for k, v in h.items() if k not in ("me", "darts", "board")}
        expect(db.NotFound, db.match, "nope")

        # undo after the win: the match goes back to unfinished
        assert db.save_match("m1", match(4, [sam["id"], alex["id"]], full[:-1]))
        assert db.recent_matches() == []
        assert db.stats(sam["id"])["darts"] == 2

        # game time is kept per game type: average and quickest of the timed games
        for i, ms in enumerate((60000, 120000)):
            assert db.save_match(f"t{i}", match(1, [sam["id"]], [throw(0, 1, 5, 1)], winner=0, game="clock", duration=ms))
        # an unfinished game has no time, whatever the app sends
        assert db.save_match("t2", match(1, [sam["id"]], [throw(0, 1, 5, 1)], game="clock", duration=5))
        assert {"game": "CLOCK", "played": 2, "won": 0, "avg_ms": 90000, "best_ms": 60000, "total_ms": 180000} in db.stats(sam["id"])["games"]
        # time played counts every game thrown in: a won game's time, and an unfinished
        # one from its start (1) to its last dart. m1 was undone to unfinished, its last dart at 2000.
        assert db.stats(sam["id"])["played_ms"] == 1999 + 180000 + 999
        assert db.stats(sam["id"], "clock")["played_ms"] == 180000 + 999
        assert db.stats(alex["id"])["played_ms"] == 1999
        assert db.delete_match("t2")

        # a solo game is "played" but never counts as a win
        assert db.save_match("m3", match(1, [sam["id"]], [throw(0, 1, 5, 1)], winner=0, game="countup"))
        assert {"game": "COUNTUP", "played": 1, "won": 0, "avg_ms": None, "best_ms": None, "total_ms": 999} in db.stats(sam["id"])["games"]

        # quitting a game part-way removes it and its throws from the stats
        darts = db.stats(sam["id"])["darts"]
        assert db.save_match("m4", match(1, [sam["id"]], [throw(0, 1, 20, 3), throw(0, 1, 20, 3)]))
        assert db.stats(sam["id"])["darts"] == darts + 2
        assert db.delete_match("m4")
        assert db.stats(sam["id"])["darts"] == darts
        assert not db.delete_match("m4")  # already gone
        assert not db.delete_match("m3")  # a finished game is kept
        assert {"game": "COUNTUP", "played": 1, "won": 0, "avg_ms": None, "best_ms": None, "total_ms": 999} in db.stats(sam["id"])["games"]

        # each game type has its own stats page: only that game's darts, plus its own figures
        x = db.stats(sam["id"], "x01")
        assert x["game"] == "x01" and x["darts"] == 2 and x["detail"] is None
        assert [m["id"] for m in x["matches"]] == ["m1"] and x["matches"][0]["winner"] is None
        assert x["recent"] == [[0.0, 103.0]] and [g["game"] for g in x["games"]] == []
        k = db.stats(sam["id"], "clock")
        assert k["darts"] == 2 and k["recent"] == []
        assert sorted(m["id"] for m in k["matches"]) == ["t0", "t1"]
        assert k["games"] == [{"game": "CLOCK", "played": 2, "won": 0, "avg_ms": 90000, "best_ms": 60000, "total_ms": 180000}]
        assert db.stats(alex["id"], "cricket")["detail"] is None

        # Around the Clock: 1, miss, 2 (a treble, jumping ahead to 5), then a wrong number
        ck = [throw(0, 1, 1, 1), throw(0, 1, 0, 0), throw(0, 1, 2, 3), throw(0, 2, 3, 1)]
        m = match(1, [alex["id"]], ck, game="clock")
        m["opts"] = {"skip": "yes"}
        assert db.save_match("k1", m)
        assert db.stats(alex["id"], "clock")["detail"] == {
            "hit_rate": 50.0, "avg_finish": None, "best_finish": None, "best_run": 1}

        # Round the World (hit=double): a single on the target is not a hit, a double is
        # (the single 1 breaks nothing and is not a hit; D1 then D2 make a run of 2, which is Sam's best)
        ck2 = [throw(0, 1, 1, 1), throw(0, 1, 1, 2), throw(0, 1, 2, 2)]
        assert db.save_match("ck2", match(1, [sam["id"]], ck2, game="clock", opts={"skip": "no", "hit": "double"}))
        assert db.stats(sam["id"], "clock")["detail"]["best_run"] == 2

        # skip is ignored when hit is not "any": D1 D2 D3 is a run of 3 (it would break if D1 jumped to 3)
        ck3 = [throw(0, 1, 1, 2), throw(0, 1, 2, 2), throw(0, 1, 3, 2)]
        assert db.save_match("ck3", match(1, [sam["id"]], ck3, game="clock", opts={"skip": "yes", "hit": "double"}))
        assert db.stats(sam["id"], "clock")["detail"]["best_run"] == 3

        # the bull counts on any part with hit=double: D1 to D20 then a single bull is a run of 21 and a finish in 21 darts
        ck4 = [throw(0, n, n, 2) for n in range(1, 21)] + [throw(0, 21, 25, 1)]
        assert db.save_match("ck4", match(1, [sam["id"]], ck4, game="clock", opts={"skip": "no", "hit": "double"}))
        ck = db.stats(sam["id"], "clock")["detail"]
        assert ck["best_run"] == 21 and ck["best_finish"] == 21

        # Cricket: Sam's T20 T20 20 is three marks to close, three that score and one more scoring;
        # once Alexa has closed 20 too, Sam's next 20 is dead and counts for nothing
        cr = [throw(0, 1, 20, 3), throw(0, 1, 20, 3), throw(0, 1, 20, 1),
              throw(1, 1, 20, 3), throw(1, 1, 5, 1), throw(1, 1, 19, 2),
              throw(0, 2, 20, 1), throw(0, 2, 25, 2), throw(0, 2, 0, 0)]
        assert db.save_match("c1", match(1, [sam["id"], alex["id"]], cr, game="cricket"))
        assert db.stats(sam["id"], "cricket")["detail"] == {"mpr": 4.5, "best_round": 7, "big_rounds": 1, "marks": 9}
        assert db.stats(alex["id"], "cricket")["detail"] == {"mpr": 5.0, "best_round": 5, "big_rounds": 1, "marks": 5}

        # Count Up: visits of 100 and 26, and a typed visit of 60 (stored as one 60 and two blanks)
        cu = [throw(0, 1, 20, 3), throw(0, 1, 20, 1), throw(0, 1, 20, 1),
              throw(0, 2, 20, 1), throw(0, 2, 5, 1), throw(0, 2, 1, 1),
              {**throw(0, 3, 60, 1), "src": "visit"}, {**throw(0, 3, 0, 0), "src": "visit"},
              {**throw(0, 3, 0, 0), "src": "visit"}]
        assert db.save_match("u1", match(1, [alex["id"]], cu, winner=0, game="countup"))
        u = db.stats(alex["id"], "countup")
        assert u["detail"] == {"average": 62.0, "highest": 100, "t100": 1, "avg_total": 186, "best_total": 186}
        assert u["darts"] == 6  # the typed visit has no single darts
        assert u["matches"][0]["visits"][-1] == [0, 3, 3000, 0, None, 60, 3]  # sent as a total, not darts

        # Bob's 27: D1 hit once then D2 missed (27 + 2 - 4 = 25), left unfinished
        o27 = {"bull": "yes", "zero": "stop"}
        b = [throw(0, 1, 1, 2), throw(0, 1, 0, 0), throw(0, 1, 0, 0),
             throw(0, 2, 0, 0), throw(0, 2, 0, 0), throw(0, 2, 0, 0)]
        assert db.save_match("b1", match(1, [alex["id"]], b, game="bobs27", opts=o27))
        d = db.stats(alex["id"], "bobs27")["detail"]
        assert d["double_rate"] == 16.7 and d["best_score"] is None and d["above_zero"] == 0
        # the same again, finished: 25 above zero
        assert db.save_match("b2", match(1, [alex["id"]], b, winner=0, game="bobs27", opts=o27))
        d = db.stats(alex["id"], "bobs27")["detail"]
        assert d == {"avg_score": 25.0, "best_score": 25, "double_rate": 16.7, "above_zero": 1}, d
        # five blank visits: 27 - 2 - 4 - 6 - 8 - 10 = -3, out at D5 (the game stops there)
        z = [throw(0, r, 0, 0) for r in range(1, 6) for _ in range(3)]
        assert db.save_match("b3", match(1, [alex["id"]], z, winner=0, game="bobs27", opts=o27))
        d = db.stats(alex["id"], "bobs27")["detail"]
        assert d == {"avg_score": 11.0, "best_score": 25, "double_rate": 7.4, "above_zero": 1}, d

        # Shanghai: a single, double and treble of 1 in round 1 is a win and a Shanghai; then a
        # round 2 visit of one 2 and two misses is a 4, so a second game left unfinished, with the rule off
        sh = [throw(0, 1, 1, 1), throw(0, 1, 1, 2), throw(0, 1, 1, 3)]
        assert db.save_match("s1", match(1, [alex["id"]], sh, winner=0, game="shanghai", opts={"rounds": 7, "shanghai": "yes"}))
        d = db.stats(alex["id"], "shanghai")["detail"]
        assert d["shanghais"] == 1 and d["hit_rate"] == 100.0
        assert d["avg_total"] == 6.0 and d["best_total"] == 6, d
        pts = [throw(0, 1, 1, 1), throw(0, 1, 20, 3), throw(0, 1, 0, 0),
               throw(0, 2, 2, 2), throw(0, 2, 2, 1), throw(0, 2, 2, 3)]
        assert db.save_match("s2", match(2, [alex["id"]], pts, winner=None, game="shanghai", opts={"rounds": 7, "shanghai": "no"}))
        d = db.stats(alex["id"], "shanghai")["detail"]
        assert d["shanghais"] == 2, d  # round 2's 2, D2, T2 counts even with the rule off
        assert d["avg_total"] == 6.0 and d["hit_rate"] == 77.8, d  # 7 of 9 darts; the unfinished game is not in the totals

        # Bermuda: round 1 is 12, round 2 is 13: one treble 12 in six darts is a hit rate of 1 in 6
        be = [throw(0, 1, 12, 3), throw(0, 1, 0, 0), throw(0, 1, 0, 0),
              throw(0, 2, 0, 0), throw(0, 2, 0, 0), throw(0, 2, 0, 0)]
        assert db.save_match("be1", match(1, [alex["id"]], be, game="bermuda", opts={}))
        d = db.stats(alex["id"], "bermuda")["detail"]
        assert d["hit_rate"] == 16.7

        # Segment Training: not split by bed. A trebled, a single and a miss on 20: two hits in three
        sg = [throw(0, 1, 20, 3), throw(0, 1, 20, 1), throw(0, 1, 1, 1)]
        assert db.save_match("sg1", match(1, [alex["id"]], sg, game="segment", opts={"seg": 20, "counts": "any", "darts": 30}))
        d = db.stats(alex["id"], "segment")["detail"]
        assert d["hit_rate"] == 66.7 and d["points_per_dart"] == 1.33 and d["best_points"] is None, d
        # a finished game on trebles only: the double and the single do not count, the treble scores 3
        sg = [throw(0, 1, 19, 2), throw(0, 1, 19, 3), throw(0, 1, 19, 1)]
        assert db.save_match("sg2", match(2, [alex["id"]], sg, winner=0, game="segment", opts={"seg": 19, "counts": "treble", "darts": 30}))
        d = db.stats(alex["id"], "segment")["detail"]
        assert d["best_points"] == 3 and d["hit_rate"] == 50.0 and d["points_per_dart"] == 1.17, d
        # the bull has no treble: "Trebles" on the bull means the inner bull, so two inner bulls and an outer one score 4
        sg = [throw(0, 1, 25, 2), throw(0, 1, 25, 1), throw(0, 1, 25, 2)]
        assert db.save_match("sg3", match(3, [alex["id"]], sg, game="segment", opts={"seg": 25, "counts": "treble", "darts": 30}))
        d = db.stats(alex["id"], "segment")["detail"]
        assert d["hit_rate"] == 55.6 and d["points_per_dart"] == 1.22, d

        # Random Checkout: the server makes the same targets from the seed as the app.
        # Expected lists are the output of
        #   node -e "import('./web/games/rcheckout.js').then(m => console.log(JSON.stringify(m.targets(12345, 'mid', 5))))"
        assert db._rc_targets(12345, "mid", 5) == EXPECTED_RC_MID
        assert db._rc_targets(1, "all", 12) == EXPECTED_RC_ALL
        # A finished solo game, six darts a target: the first target out in one visit; the
        # second after a bust (T20 is over any low target) and a second visit; the third
        # missed (six darts that score nothing); the other seven out in one visit each.
        rco = {"range": "low", "darts": 6, "count": 10, "seed": 7}
        rc_list = db._rc_targets(7, "low", 10)

        def rc_route(t):  # a finish for any target up to 40
            return [(t // 2, 2)] if t % 2 == 0 else [(1, 1), ((t - 1) // 2, 2)]

        rc, rnd = [], 0

        def rc_visit(darts):
            nonlocal rnd
            rnd += 1
            rc.extend(throw(0, rnd, seg, mult) for seg, mult in darts)

        for i, t in enumerate(rc_list):
            if i == 1:
                rc_visit([(20, 3)])
                rc[-1]["bust"] = True
            if i == 2:
                rc_visit([(0, 0)] * 3)
                rc_visit([(0, 0)] * 3)
                continue
            rc_visit(rc_route(t))
        took = sum(len(rc_route(t)) for i, t in enumerate(rc_list) if i != 2) + 3
        assert db.save_match("rc1", match(1, [alex["id"]], rc, winner=0, game="rcheckout", opts=rco))
        d = db.stats(alex["id"], "rcheckout")["detail"]
        assert d == {"rate": 90.0, "made": 9, "avg_darts": round(took / 9, 1)}, d

        # Gotcha: a visit of 180, then B throws a 1; the average counts A's visits that did not bust
        go = [throw(0, 1, 20, 3), throw(0, 1, 20, 3), throw(0, 1, 20, 3), throw(1, 1, 1, 1)]
        assert db.save_match("got1", match(1, [alex["id"], sam["id"]], go, game="gotcha", opts={"target": 301}))
        assert db.stats(alex["id"], "gotcha")["detail"]["average"] == 180.0
        assert db.stats(alex["id"], "gotcha")["detail"]["won"] == 0

        # 121 Checkout from 81, six darts a target: T19 D12 checks out 81 in two; then 82 is
        # missed (a bust, then three darts that leave it); back on 81, D20 D20 is one dart short
        co = [throw(0, 1, 19, 3), throw(0, 1, 12, 2),
              throw(0, 2, 20, 3, bust=True), throw(0, 2, 20, 3, bust=True),
              throw(0, 3, 20, 1), throw(0, 3, 20, 1), throw(0, 3, 20, 1),
              throw(0, 4, 20, 2), throw(0, 4, 20, 2)]
        m = match(1, [alex["id"]], co, game="c121")
        m["opts"] = {"start": 81, "darts": 6, "inc": 1, "dec": 1, "rounds": 10}
        assert db.save_match("o1", m)
        assert db.stats(alex["id"], "c121")["detail"] == {"rate": 50.0, "made": 1, "highest": 81, "avg_darts": 2.0}

        # darts: each player's sets, which one was thrown in each game, and stats set by set
        assert db.stats(sam["id"])["gear"][-1]["id"] is None  # games from before: no set named
        red = db.save_darts("red", {"player": sam["id"], "name": " Red  23g ", "grams": 23, "created": 5})
        assert red == {"id": "red", "player": sam["id"], "name": "Red 23g", "grams": 23, "created": 5, "retired": False,
                       "details": None}
        db.save_darts("blue", {"player": sam["id"], "name": "Blue", "created": 6})
        expect(db.Invalid, db.save_darts, "blue", {"player": alex["id"], "name": "Mine now"})
        expect(db.Invalid, db.save_darts, "x", {"player": sam["id"], "name": ""})
        expect(db.Invalid, db.save_darts, "x", {"player": sam["id"], "name": "Heavy", "grams": 500})
        expect(db.Invalid, db.save_darts, "no spaces", {"player": sam["id"], "name": "A"})
        expect(db.Invalid, db.save_darts, "x", {"player": 999, "name": "A"})
        assert db.save_darts("blue", {"player": sam["id"], "name": "Blue", "retired": True})["retired"]
        assert db.save_darts("blue", {"player": sam["id"], "name": "Blue"})["created"] == 6  # kept
        assert [d["id"] for d in db.list_darts()] == ["red", "blue"]
        # two games with red, one with blue; Alexa named Sam's set, which is not hers, so hers is not known
        for mid, set_id, n in (("g1", "red", 3), ("g2", "red", 2), ("g3", "blue", 1)):
            m = match(1, [sam["id"], alex["id"]], [throw(0, 1, 20, 1)] * n + [throw(1, 1, 5, 1)], winner=0, game="countup")
            m["darts"] = [set_id, "red"]
            assert db.save_match(mid, m)
        assert db.export_match("g1")["darts"] == ["red", None]
        r = db.stats(sam["id"], darts="red")
        assert r["set"] == "red" and r["darts"] == 5 and sorted(m["id"] for m in r["matches"]) == ["g1", "g2"]
        assert r["games"] == [{"game": "COUNTUP", "played": 2, "won": 2, "avg_ms": None, "best_ms": None, "total_ms": 1998}]
        assert r["played_ms"] == 1998  # only the games thrown with those darts
        assert db.stats(sam["id"], "countup", "blue")["detail"]["highest"] == 20
        assert db.stats(sam["id"], "x01", "red")["matches"] == []
        gear = {g["id"]: g for g in r["gear"]}  # the same whichever set is being looked at
        assert (gear["red"]["games"], gear["red"]["won"], gear["red"]["darts"]) == (2, 2, 5)
        assert (gear["blue"]["games"], gear["blue"]["darts"], gear["blue"]["retired"]) == (1, 1, False)
        assert gear[None]["games"] > 0 and list(gear)[-1] is None
        assert db.stats(alex["id"])["gear"] == [g for g in db.stats(alex["id"])["gear"] if g["id"] is None]
        expect(db.NotFound, db.stats, alex["id"], None, "red")  # not her darts
        # each match in the history says which set the player threw, so the app can put sets side by side
        assert {m["id"]: m["darts"] for m in db.stats(sam["id"])["matches"] if m["id"] in ("g1", "g3")} == {"g1": "red", "g3": "blue"}
        assert {m["id"]: m["darts"] for m in db.stats(alex["id"])["matches"] if m["id"] == "g1"} == {"g1": None}

        # a set's details: tidied, empty fields dropped, refused when not one of the choices
        red = db.save_darts("red", {"player": sam["id"], "name": "Red 23g", "grams": 23, "details": {
            "brand": "  Target ", "tungsten": 90, "shape": "torpedo", "grip": "", "notes": None}})
        assert red["details"] == {"brand": "Target", "tungsten": 90, "shape": "torpedo"}
        assert db.list_darts()[0]["details"] == red["details"]
        for bad in ({"colour": "red"}, {"tungsten": 50}, {"tungsten": True}, {"shape": "Torpedo"},
                    {"brand": "x" * 41}, {"notes": "x" * 121}, "Target"):
            expect(db.Invalid, db.save_darts, "red", {"player": sam["id"], "name": "Red", "details": bad})
        assert db.list_darts()[0]["details"] == red["details"]  # (nothing changed by a refused save)
        # left out (an older app that hasn't heard of details): kept; sent as nothing: cleared
        assert db.save_darts("red", {"player": sam["id"], "name": "Red 23g", "grams": 23})["details"] == red["details"]
        assert db.save_darts("red", {"player": sam["id"], "name": "Red 23g", "details": {"grip": ""}})["details"] is None
        assert db.clean_details(None) is None and db.clean_details({}) is None

        # a game's darts can change (picked wrongly at the start): the copy sent last wins
        m = match(2, [sam["id"], alex["id"]], [throw(0, 1, 20, 1)], winner=0, game="countup")
        m["darts"] = ["blue"]  # a short list: the rest are not known
        assert db.save_match("g3", m)
        assert db.export_match("g3")["darts"] == ["blue", None]

        # removing hides the player but keeps the throws; the name brings them back
        db.remove_player(alex["id"])
        assert [p["name"] for p in db.list_players()] == ["Sam"]
        assert db.stats(alex["id"], "x01")["darts"] == 2
        assert db.add_player("alexa")["id"] == alex["id"]
        assert len(db.list_players()) == 2

        # each account's own file: nothing crosses over, and the default is untouched
        a, b = Path(tmp) / "a" / "darts.db", Path(tmp) / "b" / "darts.db"
        db.prepare(a)
        db.prepare(b)
        db.prepare(a)  # twice is harmless
        # a database from before sets had details is brought up to date, its sets kept
        old = Path(tmp) / "old" / "darts.db"
        old.parent.mkdir()
        import sqlite3
        with sqlite3.connect(old) as c:
            c.executescript("""CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                                 created INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0, bot INTEGER);
                               CREATE TABLE dart_sets (id TEXT PRIMARY KEY, player_id INTEGER NOT NULL, name TEXT NOT NULL,
                                 grams REAL, created INTEGER NOT NULL, retired INTEGER NOT NULL DEFAULT 0);
                               INSERT INTO players VALUES (1, 'Old', 1, 0, NULL);
                               INSERT INTO dart_sets VALUES ('s', 1, 'Brass', 18, 1, 0);""")
        c.close()
        db.prepare(old)
        with db.at(old):
            assert db.list_darts() == [{"id": "s", "player": 1, "name": "Brass", "grams": 18, "created": 1,
                                        "retired": False, "details": None}]
            assert db.save_darts("s", {"player": 1, "name": "Brass", "details": {"grip": "heavy"}})["details"] == {"grip": "heavy"}
        before = db.list_players()
        with db.at(a):
            db.add_player("Ann")
            with db.at(b):
                db.add_player("Bob")
                assert [p["name"] for p in db.list_players()] == ["Bob"]
            assert [p["name"] for p in db.list_players()] == ["Ann"]
        with db.at(None):
            assert db.list_players() == before
        assert db.list_players() == before
    print("OK")


if __name__ == "__main__":
    main()
