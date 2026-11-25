# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Accounts and sessions on the host. Run: python -m tests.test_hoststore"""
import tempfile
from pathlib import Path

from server import db, hoststore


def main():
    assert hoststore.clean_nickname("  Sam   the  Man ") == "Sam the Man"
    assert hoststore.clean_nickname("x" * 200) == "x" * 24
    assert hoststore.clean_nickname("<b>Sam</b>") == "<b>Sam</b>"  # stored as typed; the app escapes it
    for bad in ["", "   ", "\n\t"]:
        try:
            hoststore.clean_nickname(bad)
            raise AssertionError("accepted an empty nickname")
        except ValueError as e:
            assert str(e) == "Choose a nickname."

    with tempfile.TemporaryDirectory() as tmp:
        s = hoststore.Store(Path(tmp))
        hoststore.Store(Path(tmp))  # opening twice is harmless
        assert s.account_by_sub("g-1") is None
        a = s.create_account("g-1", " Ann ", admin=False)
        assert a["nickname"] == "Ann" and a["admin"] is False and len(a["id"]) == 16
        assert s.account_by_sub("g-1")["id"] == a["id"]
        b = s.create_account("g-2", "Bob", admin=True)
        assert b["id"] != a["id"] and b["admin"] is True
        s.seen(a["id"], admin=True)
        assert s.account_by_sub("g-1")["admin"] is True
        assert s.rename(a["id"], "Annie")["nickname"] == "Annie"

        t1, t2 = s.new_session(a["id"]), s.new_session(a["id"])
        assert t1 != t2 and len(t1) >= 40
        assert s.session_account(t1)["id"] == a["id"] == s.session_account(t2)["id"]
        assert s.session_account(None) is None and s.session_account("nope") is None
        kept = b"".join(p.read_bytes() for p in Path(tmp).glob("host.db*"))
        assert t1.encode() not in kept  # only a hash is kept
        s.end_session(t1)
        assert s.session_account(t1) is None and s.session_account(t2) is not None

        # an expired session is no session
        old = s.new_session(b["id"])
        with s.connect() as c:
            c.execute("UPDATE sessions SET expires = 1")
        assert s.session_account(old) is None

        # each account's games in its own file
        fa, fb = s.account_db(a["id"]), s.account_db(b["id"])
        assert fa == Path(tmp) / "accounts" / a["id"] / "darts.db" and fa != fb
        with db.at(fa):
            db.add_player("Ann")
        with db.at(fb):
            assert db.list_players() == []
        try:
            s.account_db("../../etc")
            raise AssertionError("a path was accepted as an account id")
        except ValueError:
            pass

        # an account file from before darts were tracked is brought up to date after a restart
        import sqlite3
        with sqlite3.connect(fa) as c:
            c.execute("DROP TABLE dart_sets")
            c.execute("ALTER TABLE match_players DROP COLUMN darts")
        c.close()
        fa = hoststore.Store(Path(tmp)).account_db(a["id"])
        with db.at(fa):
            ann = db.list_players()[0]["id"]
            db.save_darts("d1", {"player": ann, "name": "Mine"})
            assert db.save_match("m1", {"seq": 1, "game_id": "x01", "game_name": "X01", "opts": {}, "log": [],
                                        "started": 1, "players": [ann], "darts": ["d1"], "winner": None,
                                        "throws": [{"player": 0, "round": 1, "seg": 20, "mult": 3}]})
            assert db.stats(ann)["darts"] == 1

        # pairing a helper
        assert hoststore.clean_code(" ab-c 2 3d ") == "ABC23D"
        p = s.start_pairing()
        assert len(p["code"]) == 6 and set(p["code"]) <= set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
        assert p["expires_in"] == 600 and len(p["secret"]) >= 40
        kept = b"".join(f.read_bytes() for f in Path(tmp).glob("host.db*"))
        assert p["secret"].encode() not in kept
        assert s.collect(p["code"], p["secret"]) is None              # nobody has typed it yet
        assert s.collect(p["code"], "wrong") is False
        assert s.claim("ZZZZZZ", b["id"]) is False
        assert s.claim(p["code"].lower(), b["id"]) is True            # typed in lower case
        assert s.claim(p["code"], a["id"]) is False                   # a code is used once
        token = s.collect(p["code"], p["secret"])
        assert isinstance(token, str) and len(token) >= 40
        assert s.collect(p["code"], p["secret"]) is False             # and collected once
        assert s.helper_account(token) == b["id"] and s.helper_account("nope") is None and s.helper_account(None) is None
        assert s.helper(b["id"]) == {"platform": None, "version": None, "cameras": None, "calibrated": None,
                                     "last_seen": s.helper(b["id"])["last_seen"]}
        s.helper_seen(b["id"], {"platform": "linux", "version": "abc", "cameras": 3, "calibrated": 2})
        assert s.helper(b["id"])["cameras"] == 3 and s.helper(b["id"])["platform"] == "linux"
        assert s.helper(a["id"]) is None
        # a helper is somebody else's program: only small numbers and short text are kept
        s.helper_seen(b["id"], {"platform": "x" * 500, "version": ["v"], "cameras": "<img src=x onerror=alert(1)>",
                                "calibrated": 10**9})
        h = s.helper(b["id"])
        assert h["cameras"] is None and h["calibrated"] is None and h["version"] is None and len(h["platform"]) == 40
        s.helper_seen(b["id"], {"platform": "linux", "version": "abc", "cameras": 3, "calibrated": 2})

        # pairing again replaces the first helper
        p2 = s.start_pairing()
        s.claim(p2["code"], b["id"])
        token2 = s.collect(p2["code"], p2["secret"])
        assert s.helper_account(token) is None and s.helper_account(token2) == b["id"]

        # a code that has run out
        p3 = s.start_pairing()
        with s.connect() as c:
            c.execute("UPDATE pair_codes SET expires = 1")
        assert s.claim(p3["code"], b["id"]) is False and s.collect(p3["code"], p3["secret"]) is False

        s.forget_helper(b["id"])
        assert s.helper(b["id"]) is None and s.helper_account(token2) is None

        # --- what the trial records ---
        # events from the app: only known kinds, small details, 50 at a time
        sent = [{"kind": "open", "ts": 5, "detail": {"w": 800}}, {"kind": "correction", "ts": 6, "detail": {"was": 1}},
                {"kind": "evil", "ts": 7, "detail": {}}, {"kind": "open", "ts": 8, "detail": {"x": "y" * 3000}},
                {"kind": "report"}, "rubbish", {"kind": "signup", "ts": 1}]
        assert s.add_events(b["id"], sent) == 3                      # open, correction, report
        assert s.add_events(b["id"], [{"kind": "open", "ts": i} for i in range(80)]) == 50
        assert s.count_events(b["id"], "open") == 51 and s.count_events(b["id"], "correction") == 1
        assert s.count_events(b["id"], "signup") == 0                # only the host says that
        assert s.add_events(b["id"], [{"kind": "phone-check"}, {"kind": "phone-game", "detail": {"match": "m"}}]) == 2
        s.event(b["id"], "signup")
        s.event(b["id"], "paired", {"platform": "linux"})
        assert s.count_events(b["id"], "signup") == 1
        ev = s.events(b["id"], "correction")
        assert ev == [{"ts": 6, "kind": "correction", "detail": {"was": 1}}]
        assert s.events(b["id"], "paired")[0]["detail"] == {"platform": "linux"}
        assert s.count_events(a["id"], "open") == 0

        # feedback
        for bad in ["", "   "]:
            try:
                s.add_feedback(b["id"], bad, {})
                raise AssertionError("empty feedback accepted")
            except ValueError as e:
                assert str(e)
        s.add_feedback(b["id"], "  Love it <3  ", {"version": "v1"})
        s.add_feedback(a["id"], "x" * 5000, {})
        said = s.feedback()
        assert [f["nickname"] for f in said] == ["Annie", "Bob"] and len(said[0]["text"]) == 2000
        assert said[1]["text"] == "Love it <3" and said[1]["detail"] == {"version": "v1"} and said[1]["account_id"] == b["id"]

        # problem reports: an index here, the files in a folder per account
        assert s.report_room(b["id"]) == 2**30
        folder = s.report_folder(b["id"], "2026-11-16_101500")
        assert folder == Path(tmp) / "reports" / b["id"] / "2026-11-16_101500"
        for bad in ["../x", "a/b", "", ".."]:
            try:
                s.report_folder(b["id"], bad)
                raise AssertionError(f"report id {bad!r} accepted")
            except ValueError:
                pass
        folder.mkdir(parents=True)
        (folder / "report.json").write_text("{}")
        s.save_report(b["id"], "2026-11-16_101500", 1000, {"expected": "", "note": "", "summary": "3 darts"})
        s.save_report(b["id"], "2026-11-16_101500", 1200, {"expected": "T20", "note": "bounced", "summary": "3 darts"})
        rep = s.report(b["id"], "2026-11-16_101500")
        assert rep["bytes"] == 1200 and rep["expected"] == "T20" and rep["note"] == "bounced" and rep["summary"] == "3 darts"
        assert s.report_room(b["id"]) == 2**30 - 1200
        assert s.report(a["id"], "2026-11-16_101500") is None and s.report(b["id"], "nope") is None
        assert [r["nickname"] for r in s.reports()] == ["Bob"] and s.reports(a["id"]) == []
        assert len(s.reports(b["id"])) == 1
        assert [x["nickname"] for x in s.accounts()] == ["Annie", "Bob"] or [x["nickname"] for x in s.accounts()] == ["Bob", "Annie"]

        # old reports go, files and all
        assert s.expire_reports(older_than_ms=60_000) == 0           # nothing is a minute old
        old_folder = s.report_folder(a["id"], "old-one")
        old_folder.mkdir(parents=True)
        s.save_report(a["id"], "old-one", 10, {})
        with s.connect() as c:
            c.execute("UPDATE reports SET ts = 5 WHERE id = 'old-one'")
        # cut off at ts 1000, so only the back-dated report goes however slow the runner is
        assert s.expire_reports(older_than_ms=db.now_ms() - 1000) == 1
        assert not old_folder.exists() and s.report(a["id"], "old-one") is None and folder.exists()
        s.save_report(a["id"], "anns", 10, {})
        s.report_folder(a["id"], "anns").mkdir(parents=True)
        s.add_events(a["id"], [{"kind": "open", "ts": 1}])

        # an account's helper goes with the account
        p4 = s.start_pairing()
        s.claim(p4["code"], a["id"])
        token4 = s.collect(p4["code"], p4["secret"])
        assert s.helper_account(token4) == a["id"]

        # deleting leaves nothing
        t3 = s.new_session(a["id"])
        s.delete_account(a["id"])
        assert s.account_by_sub("g-1") is None and s.session_account(t3) is None
        assert not (Path(tmp) / "accounts" / a["id"]).exists()
        assert s.helper_account(token4) is None
        assert s.count_events(a["id"], "open") == 0 and s.reports(a["id"]) == []
        assert [f["nickname"] for f in s.feedback()] == ["Bob"]
        assert not (Path(tmp) / "reports" / a["id"]).exists() and folder.exists()
        assert s.account_by_sub("g-2") is not None and fb.exists()
    print("OK")


if __name__ == "__main__":
    main()
