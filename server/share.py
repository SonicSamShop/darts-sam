# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Sharing what this server records with whoever makes Darts S.A.M, without an account.

Someone using the desktop app by itself is asked once whether it may send what
it records to the hosted site, so the automatic scoring can be improved. They
can say no, and can change their mind in Settings → Sharing. Nothing here runs,
and the site is not contacted, until they have said yes.

Said yes, this server is given a token by the site (an "install" there, see
hoststore.py) and from then on sends with it:

  games          every saved game and its darts, again whenever one changes.
                 Players go as their numbers here ("Player 3" on the site):
                 their names are not sent.
  set-up         how many cameras, how many calibrated, which system, which version
  usage notes    passed on from the app: opened, calibrated, a camera dart
                 put right by hand (track.js)
  feedback       what they type in Settings → Sharing
  problem reports  each one made with Report, pictures and all (reportsync.py,
                 started by app.py with this token)

"share" in config.json: missing or null, not asked yet; {"on": false}, said no;
{"on": true, "token": ...}, said yes (the token arrives a moment later, or when
the site can next be reached).

This file needs no OpenCV.
"""
import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import db

EVERY = 60  # seconds between looks for games to send


def call(url: str, token: str | None, method: str = "POST", body=None, timeout: float = 20) -> tuple[int, dict]:
    """Ask the site something: (status, its JSON answer). OSError: not reached."""
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, _json(r.read())
    except urllib.error.HTTPError as e:
        return e.code, _json(e.read())


def _json(data: bytes) -> dict:
    try:
        answer = json.loads(data)
    except ValueError:
        return {}
    return answer if isinstance(answer, dict) else {}


class Sharer:
    """Sends the games, and what this server says of itself, now and then, in the
    background. sent_file remembers which games have gone. hello() -> the set-up.
    on_token(token) is told the token the site gave, or None when the site no
    longer knows the one we had (a new one is asked for next time round)."""

    def __init__(self, host: str, token: str | None, sent_file: Path, hello, on_token=lambda token: None, call=call):
        self.host, self.token, self.sent_file = host.rstrip("/"), token, sent_file
        self.hello, self.on_token, self.call = hello, on_token, call
        self._said = None
        self._stop = threading.Event()

    def _ask(self, method: str, path: str, body=None) -> int:
        status, _ = self.call(self.host + path, self.token, method, body)
        if status == 401:  # the site has deleted what we sent, token and all
            self.token = self._said = None
            forget(self.sent_file)
            if not self._stop.is_set():
                self.on_token(None)
            raise _Forgotten
        return status

    def register(self) -> bool:
        status, answer = self.call(self.host + "/api/install", None, "POST", self.hello())
        token = answer.get("token") if status == 200 else None
        if not isinstance(token, str) or self._stop.is_set():
            return False
        self.token = token
        self.on_token(token)
        return True

    def once(self):
        """One round. OSError: the site was not reached; what is owed waits."""
        if not self.token and not self.register():
            return
        try:
            said = self.hello()
            if said != self._said and self._ask("POST", "/api/install/hello", said) == 200:
                self._said = said
            self._games()
        except _Forgotten:
            pass

    def _games(self):
        sent = _read(self.sent_file)
        before = dict(sent)
        try:
            now = db.match_seqs()
            for match_id, seq in now.items():
                if sent.get(match_id) == seq:
                    continue
                m = db.export_match(match_id)
                if m is None:
                    continue  # thrown away since we looked
                status = self._ask("PUT", "/api/install/matches/" + urllib.parse.quote(match_id, safe=""), m)
                if status == 200 or (400 <= status < 500 and status != 429):
                    sent[match_id] = seq  # gone, or refused for good: not sent again until it changes
            for match_id in [i for i in sent if i not in now]:  # thrown away here: there too
                if self._ask("DELETE", "/api/install/matches/" + urllib.parse.quote(match_id, safe="")) in (200, 404):
                    del sent[match_id]
        finally:
            if sent != before and self.token:
                self.sent_file.parent.mkdir(parents=True, exist_ok=True)
                self.sent_file.write_text(json.dumps(sent))

    def start(self):
        def run():
            wait = 1
            while not self._stop.wait(wait):
                wait = EVERY
                try:
                    self.once()
                except OSError:
                    pass  # offline: next time
                except Exception as e:  # never let one bad game end the sharing
                    print("share:", e)
        threading.Thread(target=run, daemon=True).start()

    def stop(self):
        self._stop.set()


class _Forgotten(Exception):
    pass


def _read(sent_file: Path) -> dict:
    try:
        sent = json.loads(sent_file.read_text())
    except (OSError, ValueError):
        return {}
    return sent if isinstance(sent, dict) else {}


def forget(sent_file: Path):
    """Nothing has been sent, as far as the site now has it."""
    sent_file.unlink(missing_ok=True)
