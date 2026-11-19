"""The hosted version's own records: who has an account, and who is signed in.

One file, <folder>/host.db. Each account's players, games and stats are not
here but in a database of its own, <folder>/accounts/<account id>/darts.db
(see db.py), so deleting an account is deleting its folder.

About a person this keeps Google's or Apple's number for their account
("sub"), or for someone who signs in by email a fingerprint of the address
(email_sub), a nickname (their first name until they change it), and some
times. Not their email address.

A desktop app whose owner agreed to share without an account (share.py) is an
account too, an "install": its sub is "install:" and a fingerprint of the
token the app sends with, its nickname "Desktop app" and four characters. So
its games, reports and feedback are kept, shown and deleted like anyone's.
Nobody can sign in to one.
"""
import hashlib
import json
import re
import secrets
import shutil
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from . import db

SESSION_MS = 90 * 24 * 3600 * 1000  # signed in for 90 days
NICKNAME_MAX = 24
ACCOUNT_ID = re.compile(r"^[0-9a-f]{16}$")
CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # none that look alike (0 O, 1 I L)
CODE_MS = 10 * 60 * 1000  # a pairing code works for ten minutes
EMAIL_MS = 15 * 60 * 1000  # so does the code in a sign-in email, with a little longer for the post
EMAIL_AGAIN_MS = 60 * 1000  # one email a minute to an address
EMAIL_TRIES = 5  # wrong codes before a new email is needed
APP_EVENTS = ("open", "correction", "calibrated", "report")  # what an app may record; the rest is the host's to say
EVENTS_AT_ONCE, DETAIL_MAX, FEEDBACK_MAX = 50, 2000, 2000
REPORT_ROOM = 2**30  # bytes of problem reports kept per account
INSTALL_REPORT_ROOM = 200 * 2**20  # ...per install, which anyone can make without signing in
INSTALLS_REPORT_ROOM = 4 * 2**30   # ...and for all the installs together
INSTALLS_A_DAY = 200  # new installs in any 24 hours
DAY_MS = 24 * 3600 * 1000
REPORT_ID = re.compile(r"^[\w-]+$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id        TEXT PRIMARY KEY,            -- 16 random hex characters; also its folder's name
  sub       TEXT NOT NULL UNIQUE,        -- Google's number for the person's account, "apple:" and Apple's, or email_sub()
  nickname  TEXT NOT NULL,
  created   INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  agreed    INTEGER NOT NULL,            -- when they signed up, which is when they agreed
  admin     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,           -- SHA-256 of the cookie; the cookie itself is not kept
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires    INTEGER NOT NULL
);
-- The computer a person's cameras are plugged into ("helper"), one per account.
CREATE TABLE IF NOT EXISTS helpers (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,       -- SHA-256 of the token the helper connects with
  platform   TEXT,                       -- what it last said about itself
  version    TEXT,
  cameras    INTEGER,
  calibrated INTEGER,
  last_seen  INTEGER NOT NULL
);
-- A helper being paired: it shows the code, the person types it when signed in.
CREATE TABLE IF NOT EXISTS pair_codes (
  code        TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,             -- proves which helper asked for the code
  expires     INTEGER NOT NULL,
  account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE  -- set once the code has been typed
);
-- Someone signing in by email: the code and link they were sent. One per address.
CREATE TABLE IF NOT EXISTS email_codes (
  sub        TEXT PRIMARY KEY,           -- email_sub() of the address
  code_hash  TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,       -- the link's
  admin      INTEGER NOT NULL,           -- the address is one of the admins' (the address itself is not kept)
  sent       INTEGER NOT NULL,
  expires    INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0  -- wrong codes typed
);
-- What the trial is for: how the app is used, what people say, what went wrong.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ts         INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL                -- JSON
);
CREATE INDEX IF NOT EXISTS events_account ON events(account_id, kind);
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ts         INTEGER NOT NULL,
  text       TEXT NOT NULL,
  detail     TEXT NOT NULL                -- JSON: the app and set-up it came from
);
-- Problem reports sent up by helpers. The files are in <folder>/reports/<account>/<id>/.
CREATE TABLE IF NOT EXISTS reports (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  bytes      INTEGER NOT NULL,
  expected   TEXT NOT NULL DEFAULT '',    -- what the person says it should have been
  note       TEXT NOT NULL DEFAULT '',
  summary    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (account_id, id)
);
"""


def clean_nickname(text: str) -> str:
    name = " ".join(text.split())[:NICKNAME_MAX].strip()
    if not name:
        raise ValueError("Choose a nickname.")
    return name


def clean_email(text: str) -> str:
    """An email address as someone typed it, or ValueError if it can't be one."""
    address = text.strip().lower()
    if len(address) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s.]+", address):
        raise ValueError("That doesn't look like an email address.")
    return address


def email_sub(address: str) -> str:
    """What stands for an email address in accounts.sub: a fingerprint that is
    the same every time for the same address, from which it cannot be read back."""
    return "email:" + _hash("dartssam-email:" + clean_email(address))


def clean_code(text: str) -> str:
    """A pairing code as someone typed it."""
    return "".join(ch for ch in text.upper() if ch.isalnum())


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _account(row) -> dict | None:
    return row and {"id": row["id"], "nickname": row["nickname"], "admin": bool(row["admin"]), "created": row["created"]}



# What an app says of itself (a helper's or an install's hello) is only kept as these.
def _number(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 100 else None


def _text(v):
    return str(v)[:40] if isinstance(v, str) else None

class Store:
    def __init__(self, folder: Path):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        with self.connect() as c:
            c.execute("PRAGMA journal_mode = WAL")
            c.executescript(SCHEMA)

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.folder / "host.db", timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        try:
            with c:  # commit on success, roll back on error
                yield c
        finally:
            c.close()

    # ---------- accounts ----------
    def account_by_sub(self, sub: str) -> dict | None:
        with self.connect() as c:
            return _account(c.execute("SELECT * FROM accounts WHERE sub = ?", (sub,)).fetchone())

    def create_account(self, sub: str, nickname: str, admin: bool) -> dict:
        now, account_id = db.now_ms(), secrets.token_hex(8)
        with self.connect() as c:
            c.execute("INSERT INTO accounts (id, sub, nickname, created, last_seen, agreed, admin) VALUES (?,?,?,?,?,?,?)",
                      (account_id, sub, clean_nickname(nickname), now, now, now, int(admin)))
        return self.account_by_sub(sub)

    def seen(self, account_id: str, admin: bool):
        with self.connect() as c:
            c.execute("UPDATE accounts SET last_seen = ?, admin = ? WHERE id = ?", (db.now_ms(), int(admin), account_id))

    def rename(self, account_id: str, nickname: str) -> dict:
        with self.connect() as c:
            c.execute("UPDATE accounts SET nickname = ? WHERE id = ?", (clean_nickname(nickname), account_id))
            return _account(c.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone())

    def account_db(self, account_id: str) -> Path:
        """The account's own database of players and games, made on first use."""
        if not ACCOUNT_ID.match(account_id):
            raise ValueError("not an account id")
        path = self.folder / "accounts" / account_id / "darts.db"
        if not path.exists():
            db.prepare(path)
        return path

    def delete_account(self, account_id: str):
        if not ACCOUNT_ID.match(account_id):
            raise ValueError("not an account id")
        with self.connect() as c:
            c.execute("DELETE FROM accounts WHERE id = ?", (account_id,))  # everything of its goes with it
        shutil.rmtree(self.folder / "accounts" / account_id, ignore_errors=True)
        shutil.rmtree(self.folder / "reports" / account_id, ignore_errors=True)

    def tally(self) -> dict:
        """What everyone here has played between them: darts thrown, games begun and accounts made.
        Three totals and nothing about anyone: the welcome page shows them."""
        darts = games = 0
        for path in (self.folder / "accounts").glob("*/darts.db"):
            try:
                with db.at(path):
                    darts += db.total_darts()
                    with db.connect() as c:
                        games += c.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
            except sqlite3.Error:
                continue  # an account being deleted as it is counted
        with self.connect() as c:
            users = c.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
        return {"darts": darts, "games": games, "users": users}

    def accounts(self) -> list[dict]:
        with self.connect() as c:
            return [{**_account(r), "last_seen": r["last_seen"]} for r in c.execute("SELECT * FROM accounts ORDER BY created")]

    # ---------- sessions ----------
    def new_session(self, account_id: str) -> str:
        token = secrets.token_urlsafe(32)
        with self.connect() as c:
            c.execute("DELETE FROM sessions WHERE expires < ?", (db.now_ms(),))
            c.execute("INSERT INTO sessions (token_hash, account_id, expires) VALUES (?,?,?)",
                      (_hash(token), account_id, db.now_ms() + SESSION_MS))
        return token

    def session_account(self, token: str | None) -> dict | None:
        if not token:
            return None
        with self.connect() as c:
            return _account(c.execute(
                "SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires > ?",
                (_hash(token), db.now_ms())).fetchone())

    def end_session(self, token: str):
        with self.connect() as c:
            c.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash(token),))

    # ---------- signing in by email ----------
    def email_code(self, sub: str, admin: bool) -> dict | None:
        """A code to type and a token for the link, for an email about to be
        sent. None: one went to this address under a minute ago."""
        code, token, now = f"{secrets.randbelow(10**6):06d}", secrets.token_urlsafe(32), db.now_ms()
        with self.connect() as c:
            c.execute("DELETE FROM email_codes WHERE expires < ?", (now,))
            if c.execute("SELECT 1 FROM email_codes WHERE sub = ? AND sent > ?", (sub, now - EMAIL_AGAIN_MS)).fetchone():
                return None
            c.execute("INSERT OR REPLACE INTO email_codes (sub, code_hash, token_hash, admin, sent, expires) VALUES (?,?,?,?,?,?)",
                      (sub, _hash(sub + code), _hash(token), int(admin), now, now + EMAIL_MS))
        return {"code": code, "token": token}

    def forget_email_code(self, sub: str):
        """The email could not be sent: they may ask again straight away."""
        with self.connect() as c:
            c.execute("DELETE FROM email_codes WHERE sub = ?", (sub,))

    def use_email_code(self, sub: str, code: str) -> dict | None:
        """The code was typed: {"sub", "admin"} if it is the one sent, and it
        is used up. After EMAIL_TRIES wrong ones it stops working."""
        with self.connect() as c:
            row = c.execute("SELECT * FROM email_codes WHERE sub = ? AND expires > ?", (sub, db.now_ms())).fetchone()
            if row is None:
                return None
            if row["code_hash"] != _hash(sub + "".join(ch for ch in code if ch.isdigit())):
                if row["tries"] + 1 >= EMAIL_TRIES:
                    c.execute("DELETE FROM email_codes WHERE sub = ?", (sub,))
                else:
                    c.execute("UPDATE email_codes SET tries = tries + 1 WHERE sub = ?", (sub,))
                return None
            c.execute("DELETE FROM email_codes WHERE sub = ?", (sub,))
            return {"sub": sub, "admin": bool(row["admin"])}

    def use_email_link(self, token: str) -> dict | None:
        """The link in the email was opened: the same, by its token."""
        with self.connect() as c:
            row = c.execute("SELECT * FROM email_codes WHERE token_hash = ? AND expires > ?", (_hash(token), db.now_ms())).fetchone()
            if row is None:
                return None
            c.execute("DELETE FROM email_codes WHERE sub = ?", (row["sub"],))
            return {"sub": row["sub"], "admin": bool(row["admin"])}

    # ---------- pairing a helper ----------
    def start_pairing(self) -> dict:
        """A helper asks to be paired: a code for the person to type, and a
        secret for the helper to collect its token with afterwards."""
        secret = secrets.token_urlsafe(32)
        with self.connect() as c:
            c.execute("DELETE FROM pair_codes WHERE expires < ?", (db.now_ms(),))
            while True:
                code = "".join(secrets.choice(CODE_LETTERS) for _ in range(6))
                if not c.execute("SELECT 1 FROM pair_codes WHERE code = ?", (code,)).fetchone():
                    break
            c.execute("INSERT INTO pair_codes (code, secret_hash, expires) VALUES (?,?,?)",
                      (code, _hash(secret), db.now_ms() + CODE_MS))
        return {"code": code, "secret": secret, "expires_in": CODE_MS // 1000}

    def claim(self, code: str, account_id: str) -> bool:
        """The signed-in person typed a code. False: no such code, run out, or already used."""
        with self.connect() as c:
            return c.execute("UPDATE pair_codes SET account_id = ? WHERE code = ? AND account_id IS NULL AND expires > ?",
                             (account_id, clean_code(code), db.now_ms())).rowcount == 1

    def collect(self, code: str, secret: str):
        """The helper asks how its code is doing. Its new token once the code has
        been typed (given once); None while nobody has; False if there is no such
        code, it has run out, or the secret is not the one it was made with."""
        with self.connect() as c:
            row = c.execute("SELECT * FROM pair_codes WHERE code = ? AND secret_hash = ? AND expires > ?",
                            (clean_code(code), _hash(secret), db.now_ms())).fetchone()
            if row is None:
                return False
            if row["account_id"] is None:
                return None
            token = secrets.token_urlsafe(32)
            c.execute("DELETE FROM pair_codes WHERE code = ?", (row["code"],))
            c.execute("INSERT OR REPLACE INTO helpers (account_id, token_hash, last_seen) VALUES (?,?,?)",
                      (row["account_id"], _hash(token), db.now_ms()))  # an earlier helper is replaced
            return token

    def helper_account(self, token: str | None) -> str | None:
        if not token:
            return None
        with self.connect() as c:
            row = c.execute("SELECT account_id FROM helpers WHERE token_hash = ?", (_hash(token),)).fetchone()
            return row and row["account_id"]

    def helper(self, account_id: str) -> dict | None:
        with self.connect() as c:
            row = c.execute("SELECT platform, version, cameras, calibrated, last_seen FROM helpers WHERE account_id = ?",
                            (account_id,)).fetchone()
            return row and dict(row)

    def helper_seen(self, account_id: str, hello: dict):
        """What a paired helper says of itself. It is somebody else's program
        talking, so only small numbers and short text are kept."""
        with self.connect() as c:
            c.execute("UPDATE helpers SET platform = ?, version = ?, cameras = ?, calibrated = ?, last_seen = ? WHERE account_id = ?",
                      (_text(hello.get("platform")), _text(hello.get("version")), _number(hello.get("cameras")),
                       _number(hello.get("calibrated")), db.now_ms(), account_id))

    def forget_helper(self, account_id: str):
        with self.connect() as c:
            c.execute("DELETE FROM helpers WHERE account_id = ?", (account_id,))

    # ---------- installs: desktop apps sharing without an account ----------
    def create_install(self) -> str | None:
        """A new install and the token its app will send with (given once).
        None: too many have been made today."""
        token = secrets.token_urlsafe(32)
        with self.connect() as c:
            if c.execute("SELECT COUNT(*) FROM accounts WHERE sub LIKE 'install:%' AND created > ?",
                         (db.now_ms() - DAY_MS,)).fetchone()[0] >= INSTALLS_A_DAY:
                return None
        acc = self.create_account("install:" + _hash(token), "Desktop app", False)
        self.rename(acc["id"], f"Desktop app {acc['id'][:4]}")
        return token

    def install_account(self, token: str | None) -> str | None:
        acc = self.account_by_sub("install:" + _hash(token)) if token else None
        return acc and acc["id"]

    def install_seen(self, account_id: str, hello: dict):
        """What an install's app says of itself, kept where a paired helper's is
        (its token_hash is no fingerprint, so nothing can connect as it)."""
        now = db.now_ms()
        with self.connect() as c:
            c.execute("""INSERT INTO helpers (account_id, token_hash, platform, version, cameras, calibrated, last_seen)
                         VALUES (?,?,?,?,?,?,?)
                         ON CONFLICT (account_id) DO UPDATE SET platform = excluded.platform, version = excluded.version,
                           cameras = excluded.cameras, calibrated = excluded.calibrated, last_seen = excluded.last_seen""",
                      (account_id, "install:" + account_id, _text(hello.get("platform")), _text(hello.get("version")),
                       _number(hello.get("cameras")), _number(hello.get("calibrated")), now))
            c.execute("UPDATE accounts SET last_seen = ? WHERE id = ?", (now, account_id))

    # ---------- what the trial records ----------
    def add_events(self, account_id: str, events: list) -> int:
        """Events sent by the app. Unknown kinds, oversized details and anything
        past the first 50 are dropped quietly. Returns how many were kept."""
        rows = []
        for e in events if isinstance(events, list) else []:
            if len(rows) == EVENTS_AT_ONCE:
                break
            if not isinstance(e, dict) or e.get("kind") not in APP_EVENTS:
                continue
            detail = json.dumps(e.get("detail") or {})
            ts = e.get("ts")
            if len(detail) <= DETAIL_MAX:
                rows.append((account_id, ts if isinstance(ts, int) else db.now_ms(), e["kind"], detail))
        with self.connect() as c:
            c.executemany("INSERT INTO events (account_id, ts, kind, detail) VALUES (?,?,?,?)", rows)
        return len(rows)

    def event(self, account_id: str, kind: str, detail: dict | None = None):
        """Something the host itself saw (signed up, paired)."""
        with self.connect() as c:
            c.execute("INSERT INTO events (account_id, ts, kind, detail) VALUES (?,?,?,?)",
                      (account_id, db.now_ms(), kind, json.dumps(detail or {})))

    def events(self, account_id: str, kind: str | None = None) -> list[dict]:
        with self.connect() as c:
            rows = c.execute("SELECT ts, kind, detail FROM events WHERE account_id = ? AND (? IS NULL OR kind = ?) ORDER BY ts, id",
                             (account_id, kind, kind))
            return [{"ts": r["ts"], "kind": r["kind"], "detail": json.loads(r["detail"])} for r in rows]

    def count_events(self, account_id: str, kind: str) -> int:
        with self.connect() as c:
            return c.execute("SELECT COUNT(*) FROM events WHERE account_id = ? AND kind = ?", (account_id, kind)).fetchone()[0]

    def add_feedback(self, account_id: str, text: str, detail: dict):
        text = text.strip()[:FEEDBACK_MAX]
        if not text:
            raise ValueError("Type what you want to say first.")
        with self.connect() as c:
            c.execute("INSERT INTO feedback (account_id, ts, text, detail) VALUES (?,?,?,?)",
                      (account_id, db.now_ms(), text, json.dumps(detail or {})[:DETAIL_MAX * 2]))

    def feedback(self) -> list[dict]:
        with self.connect() as c:
            rows = c.execute("SELECT f.*, a.nickname FROM feedback f JOIN accounts a ON a.id = f.account_id ORDER BY f.ts DESC, f.id DESC")
            return [{"account_id": r["account_id"], "nickname": r["nickname"], "ts": r["ts"], "text": r["text"],
                     "detail": _json(r["detail"])} for r in rows]

    # ---------- problem reports ----------
    def report_folder(self, account_id: str, report_id: str) -> Path:
        if not ACCOUNT_ID.match(account_id) or not REPORT_ID.match(report_id):
            raise ValueError("not a report")
        return self.folder / "reports" / account_id / report_id

    def report_room(self, account_id: str) -> int:
        """Bytes of reports the account may still send. An install has less
        room, and all the installs share a limit, since anyone can make one."""
        with self.connect() as c:
            used = c.execute("SELECT COALESCE(SUM(bytes), 0) FROM reports WHERE account_id = ?", (account_id,)).fetchone()[0]
            who = c.execute("SELECT sub FROM accounts WHERE id = ?", (account_id,)).fetchone()
            if who and who["sub"].startswith("install:"):
                all_used = c.execute("""SELECT COALESCE(SUM(r.bytes), 0) FROM reports r JOIN accounts a ON a.id = r.account_id
                                        WHERE a.sub LIKE 'install:%'""").fetchone()[0]
                return max(0, min(INSTALL_REPORT_ROOM - used, INSTALLS_REPORT_ROOM - all_used))
        return max(0, REPORT_ROOM - used)

    def save_report(self, account_id: str, report_id: str, size: int, meta: dict):
        """Record a report whose files are in report_folder (again, when it is sent again)."""
        with self.connect() as c:
            c.execute("""INSERT INTO reports (account_id, id, ts, bytes, expected, note, summary) VALUES (?,?,?,?,?,?,?)
                         ON CONFLICT (account_id, id) DO UPDATE SET bytes = excluded.bytes, expected = excluded.expected,
                           note = excluded.note, summary = excluded.summary""",
                      (account_id, report_id, db.now_ms(), size, str(meta.get("expected") or "")[:500],
                       str(meta.get("note") or "")[:2000], str(meta.get("summary") or "")[:500]))

    def reports(self, account_id: str | None = None) -> list[dict]:
        with self.connect() as c:
            rows = c.execute("""SELECT r.*, a.nickname FROM reports r JOIN accounts a ON a.id = r.account_id
                                WHERE ? IS NULL OR r.account_id = ? ORDER BY r.ts DESC, r.id DESC""", (account_id, account_id))
            return [dict(r) for r in rows]

    def report(self, account_id: str, report_id: str) -> dict | None:
        with self.connect() as c:
            row = c.execute("""SELECT r.*, a.nickname FROM reports r JOIN accounts a ON a.id = r.account_id
                               WHERE r.account_id = ? AND r.id = ?""", (account_id, report_id)).fetchone()
            return row and dict(row)

    def expire_reports(self, older_than_ms: int) -> int:
        """Delete reports received more than that long ago, files and all."""
        with self.connect() as c:
            old = c.execute("SELECT account_id, id FROM reports WHERE ts < ?", (db.now_ms() - older_than_ms,)).fetchall()
            c.execute("DELETE FROM reports WHERE ts < ?", (db.now_ms() - older_than_ms,))
        for r in old:
            shutil.rmtree(self.report_folder(r["account_id"], r["id"]), ignore_errors=True)
        return len(old)


def _json(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return {}
