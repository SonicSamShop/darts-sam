# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Darts S.A.M, hosted: one address on the internet that anyone can sign in to.

  python -m server.host            # needs host.json (see host.example.json)

Serves the same web app as the server at home (app.py), but for many people:
each signs in with Google, Apple or a code sent by email and has their own players, games and stats. It has
no cameras and must run without OpenCV installed. See docs/hosting.md.
"""
import argparse
import ipaddress
import json
import re
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import admin, auth, build, data_api, db, hoststore, limits, mail, reportsync, seo
from .relay import FORGOTTEN, NoHelper, Relay, TimedOut
from .version import WebFiles, vision_files, web_version

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
COOKIE = "ds_session"
# The apps people download to score with their cameras (web/download.html): the
# files tools/build_exe.py makes, by the name the page knows each one by.
DOWNLOADS = {"mac-arm64": "DartsSAM-arm64.dmg", "mac-x86_64": "DartsSAM-x86_64.dmg", "windows": "DartsSAM.exe",
             "linux": "DartsSAM-linux-x86_64.tar.gz"}
RELEASES = "releases.json"  # in the downloads folder: each file's version and notes (tools/fetch_apps.py)


class SignIn(BaseModel):
    credential: str  # the token Google's or Apple's button gave the page
    name: str | None = None  # Apple only: it tells the page the person's name, once, and leaves it out of the token


class Email(BaseModel):
    email: str


class EmailCode(BaseModel):
    email: str
    code: str


class EmailLink(BaseModel):
    token: str  # from the link in the email


class Nickname(BaseModel):
    nickname: str
    player: bool = False  # their player of the old name takes the new one too (a new account naming itself)


class Code(BaseModel):
    code: str


class Collect(BaseModel):
    code: str
    secret: str


class Events(BaseModel):
    events: list


class Feedback(BaseModel):
    text: str
    app: dict | None = None  # the app it was sent from: version, browser, screen


class Hello(BaseModel):
    """What a desktop app says of itself (as a paired helper does down its line)."""
    platform: str | None = None
    version: str | None = None
    cameras: int | None = None
    calibrated: int | None = None


MATCH_MOST = 4 * 2**20  # bytes in one game sent by an install
ACCOUNT_MOST = 256 * 2**20  # bytes one account's (or install's) games may fill; past it nothing more is saved
REPORTS_KEPT_MS = 60 * 24 * 3600 * 1000  # problem reports are deleted after 60 days
TALLY_KEPT = 60  # seconds the welcome page's totals stand before they are counted again


class Tries:
    """No more than `most` of something in any minute (kept in memory: a restart forgives)."""

    def __init__(self, most: int):
        self.most, self.times = most, {}

    def another(self, who: str = "") -> bool:
        now = time.time()
        recent = [t for t in self.times.get(who, []) if now - t < 60]
        self.times[who] = recent + [now]
        return len(recent) < self.most


def create(folder: Path, settings: dict, check_google=auth.check_google, check_apple=auth.check_apple,
           send_email=None) -> FastAPI:
    """The host, keeping everything under `folder`. settings: "google_client_id";
    "apple_client_id", the Services ID for "Sign in with Apple" (left out: no Apple
    button); "email" and "site", for signing in by email (see mail.py; left out: no
    such button), "site" being the address of the app, where the email's link leads;
    "home", the address of the home page when that is a different one (there the
    welcome page is always shown, and it sends people to "site" to sign in; search
    engines are asked to list that address only: seo.py); "admins", the
    email addresses whose accounts may see the admin pages; "analytics_token", the
    site token of Cloudflare Web Analytics (left out: no visitor counter on the pages);
    "google_analytics_id", the G-... measurement ID of Google Analytics (left out: no
    Google Analytics; when set, each page asks before counting: web/consent.js);
    "analytics_skip_ips", addresses (or ranges, like "2a00:1:2:3::/64") whose visits
    are not counted: pages sent to them carry neither counter; "android", the
    Android app from Google Play, {"package": "uk.co.dartssam.app", "fingerprints":
    ["AB:CD:..."]}: the SHA-256 fingerprints of the keys it is signed with (Play
    Console, Setup > App signing), so Android opens the site in the app without an
    address bar (left out: no /.well-known/assetlinks.json); "dev", true when run
    on a laptop over plain http."""
    store = hoststore.Store(folder)
    relay = Relay()
    app = FastAPI()
    app.state.store, app.state.relay = store, relay
    store.expire_reports(REPORTS_KEPT_MS)
    code_tries, pairings, emails, installs = Tries(5), Tries(20), Tries(30), Tries(10)
    send_email = send_email or mail.sender(settings)
    site = str(settings.get("site") or "http://localhost:8000").rstrip("/")
    home = str(settings.get("home") or "").rstrip("/") or None
    if home == site:
        home = None  # one address for both, as it was before the two were split
    client_id = settings["google_client_id"]
    apple_id = settings.get("apple_client_id") or None
    admins = {a.lower() for a in settings.get("admins", [])}
    downloads = Path(settings.get("downloads") or ROOT / "downloads")  # the folder the apps to download are put in
    counter = str(settings.get("analytics_token") or "")
    if counter and not re.fullmatch(r"[A-Za-z0-9_-]+", counter):
        raise ValueError('"analytics_token" should be the token from Cloudflare Web Analytics, nothing else')
    beacon = ("<script defer src='https://static.cloudflareinsights.com/beacon.min.js' "
              f"""data-cf-beacon='{{"token": "{counter}"}}'></script>\n""") if counter else ""
    google = str(settings.get("google_analytics_id") or "")
    if google and not re.fullmatch(r"G-[A-Z0-9]+", google):
        raise ValueError('"google_analytics_id" should be the measurement ID from Google Analytics, like G-AB12CD34EF')
    counters = beacon + (f"<script defer src='consent.js' data-ga='{google}'></script>\n" if google else "")
    try:
        skipped = [ipaddress.ip_network(str(a).strip(), strict=False) for a in settings.get("analytics_skip_ips", [])]
    except ValueError as e:
        raise ValueError(f'"analytics_skip_ips" should be a list of IP addresses or ranges: {e}')

    def page_head(scope) -> str:
        """The counters for a page, or nothing for an address in "analytics_skip_ips".
        Behind Caddy the address is the visitor's: uvicorn takes it from the
        X-Forwarded-For header Caddy sets, trusting that header from this machine only."""
        try:
            ip = ipaddress.ip_address((scope.get("client") or ("",))[0])
        except ValueError:
            return counters
        ip = getattr(ip, "ipv4_mapped", None) or ip
        return "" if any(ip in net for net in skipped) else counters

    @app.middleware("http")
    async def same_origin(request: Request, call_next):
        # A page on another site can make a signed-in browser send requests here,
        # cookie and all. Browsers say which site a changing request came from.
        origin = request.headers.get("origin")
        if request.method not in ("GET", "HEAD", "OPTIONS") and origin \
                and urlsplit(origin).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "Wrong origin."}, status_code=403)
        return await call_next(request)

    # Every request's size is counted as it arrives, not taken from its headers.
    app.add_middleware(limits.BodyLimit, most=MATCH_MOST, bigger={"/api/helper/reports/": reportsync.MOST,
                                                                   "/api/phone/reports/": reportsync.MOST})

    def full(path: Path) -> bool:
        return path.exists() and path.stat().st_size > ACCOUNT_MOST

    def account_file(request: Request) -> Path:
        """The signed-in account's games, refusing anything new once they fill their room."""
        path = store.account_db(signed_in(request)["id"])
        if request.method in ("POST", "PUT", "PATCH") and full(path):
            raise HTTPException(507, "This account has no room left for more games.")
        return path

    def account(request: Request) -> dict | None:
        return store.session_account(request.cookies.get(COOKIE))

    def signed_in(request: Request) -> dict:
        who = account(request)
        if who is None:
            raise HTTPException(401, "Sign in first.")
        return who

    def start_session(response: Response, account_id: str):
        response.set_cookie(COOKIE, store.new_session(account_id), max_age=hoststore.SESSION_MS // 1000,
                            httponly=True, samesite="lax", secure=not settings.get("dev"))

    def is_admin(email: str) -> bool:
        return email.lower() in admins  # the address is looked at, never kept

    def enter(sub: str, name: str | None, admin: bool, response: Response) -> dict:
        """Sign in the person a sign-in was checked for. Someone new gets an account
        there and then, called by their first name, and a first player of that name.
        "named" is false when the sign-in said no name: the app asks for one."""
        acc, new, named = store.account_by_sub(sub), False, True
        if acc is None:
            try:
                nickname = hoststore.clean_nickname(name or "")
            except ValueError:
                nickname, named = "Player", False  # they gave no name
            acc, new = store.create_account(sub, nickname, admin), True
            with db.at(store.account_db(acc["id"])):
                db.add_player(nickname[:db.NAME_MAX].strip())
            store.event(acc["id"], "signup")
        else:
            store.seen(acc["id"], admin)
            store.event(acc["id"], "signin")  # a sign-up is the first sign-in, so is not counted twice
            acc["admin"] = admin
        start_session(response, acc["id"])
        return {"account": acc, "new": new, "named": named}

    @app.post("/auth/google")
    def sign_in(body: SignIn, response: Response):
        try:
            who = check_google(body.credential, client_id)
        except auth.Rejected:
            raise HTTPException(401, "Google sign-in was not accepted. Try again.")
        return enter(who["sub"], who.get("name"), is_admin(who.get("email", "")), response)

    @app.post("/auth/apple")
    def sign_in_apple(body: SignIn, response: Response):
        if not apple_id:
            raise HTTPException(404, "Sign in with Apple is not set up here.")
        try:
            who = check_apple(body.credential, apple_id)
        except auth.Rejected:
            raise HTTPException(401, "Apple sign-in was not accepted. Try again.")
        # "apple:" keeps Apple's numbers apart from Google's in the one column
        return enter("apple:" + who["sub"], body.name, is_admin(who.get("email", "")), response)

    # By email: 1. the person gives their address and is sent a code and a link
    # 2. they type the code where they asked for it, or open the link anywhere.
    @app.post("/auth/email/start")
    def email_start(body: Email):
        if not send_email:
            raise HTTPException(404, "Signing in by email is not set up here.")
        try:
            address = hoststore.clean_email(body.email)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if not emails.another():
            raise HTTPException(429, "Too many sign-in emails just now. Try again in a minute.")
        sub = hoststore.email_sub(address)
        made = store.email_code(sub, is_admin(address))
        if made is None:
            raise HTTPException(429, "An email was sent to you less than a minute ago. Check your inbox, or wait a minute and ask again.")
        try:
            send_email(address, mail.sign_in_message(made["code"], f"{site}/#/in/{made['token']}", hoststore.EMAIL_MS // 60000))
        except mail.NotSent:
            store.forget_email_code(sub)
            raise HTTPException(502, "The email could not be sent. Try again.")
        return {"sent": True}

    @app.post("/auth/email")
    def email_code(body: EmailCode, response: Response):
        try:
            who = store.use_email_code(hoststore.email_sub(body.email), body.code)
        except ValueError:
            who = None
        if who is None:
            raise HTTPException(401, "That code isn't right, or it has run out. Check the email, or ask for a new one.")
        return enter(who["sub"], None, who["admin"], response)

    @app.post("/auth/email/link")
    def email_link(body: EmailLink, response: Response):
        who = store.use_email_link(body.token)
        if who is None:
            raise HTTPException(401, "That link has been used or has run out. Ask for a new email.")
        return enter(who["sub"], None, who["admin"], response)

    @app.post("/auth/signout")
    def sign_out(request: Request, response: Response):
        token = request.cookies.get(COOKIE)
        if token:
            store.end_session(token)
        response.delete_cookie(COOKIE)
        return {"ok": True}

    @app.get("/api/me")
    def me(request: Request):
        """Only the hosted version has this address: it is how the app knows it is hosted."""
        who = account(request)
        return {"hosted": True, "google_client_id": client_id, "apple_client_id": apple_id, "email": bool(send_email),
                "home": home, "app": site if home else None,  # the two addresses, when the home page has its own
                "account": who, "helper": who and helper_of(who["id"])}

    def helper_of(account_id: str) -> dict | None:
        """The computer the person's cameras are plugged into, if they have paired one."""
        h = store.helper(account_id)
        return h and {"connected": relay.connected(account_id), "cameras": h["cameras"], "platform": h["platform"]}

    @app.patch("/api/me")
    def rename(request: Request, body: Nickname):
        acc = signed_in(request)
        try:
            nickname = hoststore.clean_nickname(body.nickname)
            if body.player:
                # the player first: if a player of that name exists already, nothing changes
                with db.at(store.account_db(acc["id"])):
                    old = acc["nickname"][:db.NAME_MAX].strip()
                    mine = next((p for p in db.list_players() if p["name"] == old), None)
                    if mine:
                        db.rename_player(mine["id"], nickname[:db.NAME_MAX].strip())
            return {"account": store.rename(acc["id"], nickname)}
        except (ValueError, db.Invalid) as e:
            raise HTTPException(400, str(e))

    @app.delete("/api/me")
    async def delete(request: Request, response: Response):
        """Everything of the account's goes: its games, its sign-ins, its record."""
        account_id = signed_in(request)["id"]
        store.delete_account(account_id)
        await relay.drop_helper(account_id)
        response.delete_cookie(COOKIE)
        return {"ok": True}

    # ---------- pairing the computer the cameras are plugged into (the "helper") ----------
    # 1. the helper asks for a code and shows it   2. the signed-in person types it here
    # 3. the helper, which has been asking, is given the token it will connect with
    @app.post("/api/pair/start")
    def pair_start():
        if not pairings.another():
            raise HTTPException(429, "Too many pairings just now. Try again in a minute.")
        return store.start_pairing()

    @app.post("/api/pair/claim")
    def pair_claim(request: Request, body: Code):
        account_id = signed_in(request)["id"]
        if not code_tries.another(account_id):
            raise HTTPException(429, "Too many tries. Wait a minute.")
        if not store.claim(body.code, account_id):
            raise HTTPException(404, "That code isn't right, or it has run out. Check the code on your cameras' computer.")
        store.event(account_id, "paired")
        return {"ok": True}

    @app.post("/api/pair/collect")
    def pair_collect(body: Collect):
        token = store.collect(body.code, body.secret)
        if token is False:
            raise HTTPException(404, "No such code, or it has run out.")
        return {"token": token} if token else {"waiting": True}

    @app.delete("/api/helper")
    async def forget_helper(request: Request):
        """Disconnect cameras: the helper is told to forget its token, and is not let back in."""
        account_id = signed_in(request)["id"]
        store.forget_helper(account_id)
        await relay.drop_helper(account_id)
        return {"ok": True}

    # ---------- what the trial records (see insight.py and admin.py) ----------
    @app.post("/api/events")
    def events(request: Request, body: Events):
        """Small notes from the app on how it is being used, such as a camera dart put right by hand."""
        return {"kept": store.add_events(signed_in(request)["id"], body.events)}

    @app.post("/api/feedback")
    def feedback(request: Request, body: Feedback):
        who = signed_in(request)
        try:
            store.add_feedback(who["id"], body.text, {"app": body.app or {}, "helper": store.helper(who["id"])})
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    # ---------- desktop apps sharing without an account ("installs": share.py, hoststore.py) ----------
    # The app's owner said yes to sending what it records; nobody signs in. The
    # app is given a token once and sends with it from then on.
    def bearer(request: Request) -> str:
        return request.headers.get("authorization", "").removeprefix("Bearer ").strip()

    def install(request: Request) -> str:
        account_id = store.install_account(bearer(request))
        if account_id is None:
            raise HTTPException(401, "Not sharing.")
        return account_id

    @app.post("/api/install")
    def install_start(body: Hello):
        token = store.create_install() if installs.another() else None
        if token is None:
            raise HTTPException(429, "Too many just now. Try again later.")
        account_id = store.install_account(token)
        store.install_seen(account_id, body.model_dump())
        store.event(account_id, "install")
        return {"token": token}

    @app.post("/api/install/hello")
    def install_hello(request: Request, body: Hello):
        store.install_seen(install(request), body.model_dump())
        return {"ok": True}

    @app.post("/api/install/events")
    def install_events(request: Request, body: Events):
        return {"kept": store.add_events(install(request), body.events)}

    @app.post("/api/install/feedback")
    def install_feedback(request: Request, body: Feedback):
        account_id = install(request)
        try:
            store.add_feedback(account_id, body.text, {"app": body.app or {}, "helper": store.helper(account_id)})
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    @app.put("/api/install/matches/{match_id}")
    def install_match(request: Request, match_id: str, body: data_api.MatchIn):
        """A game from the app's own database. Its players are the app's numbers
        for them and are kept here as "Player 3": their names are not sent."""
        account_id = install(request)
        if len(body.players) > 12 or len(match_id) > 64:  # the bytes themselves are counted by limits.BodyLimit
            raise HTTPException(413, "That game is too big.")
        if full(store.account_db(account_id)):
            raise HTTPException(507, "No room left for more games.")
        m = body.model_dump()
        with db.at(store.account_db(account_id)):
            try:
                m["players"] = [db.player_named(f"Player {n}") for n in m["players"]]
                return {"ok": True, "saved": db.save_match(match_id, m)}
            except db.Invalid as e:
                raise HTTPException(400, str(e))

    @app.delete("/api/install/matches/{match_id}")
    def install_match_gone(request: Request, match_id: str):
        """A game that was quit part-way and thrown away in the app."""
        with db.at(store.account_db(install(request))):
            return {"ok": True, "deleted": db.delete_match(match_id)}

    @app.delete("/api/install")
    def install_delete(request: Request):
        """Everything the app has sent goes, and its token stops working."""
        store.delete_account(install(request))
        return {"ok": True}

    @app.post("/api/helper/reports/{report_id}")
    async def report_up(report_id: str, request: Request):
        """A helper sends a problem report: a zip of its folder (reportsync.py). Sent again, it is laid over the first.
        So does a desktop app sharing without an account, with its install's token."""
        account_id = store.helper_account(bearer(request)) or store.install_account(bearer(request))
        if account_id is None:
            raise HTTPException(401, "Not paired.")
        return await take_report(account_id, report_id, request)

    @app.post("/api/phone/reports/{report_id}")
    async def phone_report_up(report_id: str, request: Request):
        """A phone scoring with its own camera (Beta) sends a problem report it made
        itself (server/phonevision.py), packed the same way. It has no computer
        paired, so it is the person signed in on it who sends it."""
        return await take_report(signed_in(request)["id"], report_id, request)

    async def take_report(account_id: str, report_id: str, request: Request):
        try:
            folder = store.report_folder(account_id, report_id)
        except ValueError:
            raise HTTPException(400, "Not a report.")
        data = await request.body()  # no bigger than reportsync.MOST: limits.BodyLimit counts it
        store.expire_reports(REPORTS_KEPT_MS)
        had = store.report(account_id, report_id)
        room = store.report_room(account_id) + (had["bytes"] if had else 0)
        if len(data) > min(room, reportsync.MOST):
            raise HTTPException(413, "No room left for reports.")
        try:
            reportsync.unpack(data, folder, most=min(room, reportsync.MOST))
        except ValueError as e:
            raise HTTPException(413 if str(e) == "too big" else 400, "That report could not be read.")
        store.save_report(account_id, report_id, reportsync.folder_size(folder), reportsync.meta(folder))
        return {"ok": True}

    app.include_router(admin.make_router(store, relay, account))

    @app.websocket("/helper")
    async def helper_line(ws: WebSocket):
        """A helper's line to the host: it connects out from home and stays (see relay.py)."""
        await ws.accept()
        account_id = store.helper_account(ws.headers.get("authorization", "").removeprefix("Bearer ").strip())
        if account_id is None:
            return await ws.close(FORGOTTEN)
        await relay.helper_joined(account_id, ws)
        try:
            while True:
                hello = await relay.helper_said(account_id, await ws.receive_text())
                if hello:
                    store.helper_seen(account_id, hello)
        except WebSocketDisconnect:
            pass
        finally:
            await relay.helper_left(account_id, ws)

    # What the app asks its cameras: passed down the helper's line, answer passed back.
    # Only these addresses; nothing else ever reaches a helper.
    async def cameras(request: Request):
        account_id = signed_in(request)["id"]
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        try:
            status, kind, body = await relay.request(account_id, request.method, path,
                                                     request.headers.get("content-type"), await request.body())
        except NoHelper:
            raise HTTPException(503, "Your cameras aren't connected.")
        except TimedOut:
            raise HTTPException(504, "Your cameras' computer didn't answer.")
        return Response(body, status_code=status, media_type=kind, headers={"Cache-Control": "no-store"})

    for path in ("/api/status", "/api/reset", "/api/cameras", "/api/cameras/{rest:path}",
                 "/api/reports", "/api/reports/{rest:path}"):
        app.add_api_route(path, cameras, methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)

    app.include_router(data_api.make_router(account_file))

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        """An app's live line: a hello (which also lets an open app see its files
        have changed), then, for someone signed in, their cameras' darts."""
        await ws.accept()
        who = store.session_account(ws.cookies.get(COOKIE))
        if who is None:
            await ws.send_json({"type": "hello", "cameras": 0, "helper": False, "version": web_version(WEB)})
        else:
            await relay.app_joined(who["id"], ws, web_version(WEB))
        try:
            while True:
                await ws.receive_text()  # keep-alive pings from the app
        except WebSocketDisconnect:
            pass
        finally:
            if who:
                relay.app_left(who["id"], ws)

    # ---------- the totals on the welcome page (no signing in needed) ----------
    app.state.tally = None  # (when counted, the totals)

    @app.get("/api/tally")
    def tally():
        """How many darts everyone has thrown here between them, and in how many
        games. Counted again at most once a minute, however often it is asked for."""
        if app.state.tally is None or time.time() - app.state.tally[0] > TALLY_KEPT:
            app.state.tally = (time.time(), store.tally())
        return app.state.tally[1]

    # ---------- the apps to download (no signing in needed) ----------
    @app.get("/api/downloads")
    def downloads_there():
        """Which of the apps are in the downloads folder now, and how big each is."""
        there = []
        for name, file in DOWNLOADS.items():
            try:
                st = (downloads / file).stat()
            except OSError:
                continue  # not put on the server (yet): the page says so
            there.append({"id": name, "file": file, "size": st.st_size, "updated": int(st.st_mtime * 1000)})
        return {"downloads": there}

    @app.get("/api/release")
    def release(app_id: str = Query(alias="app")):
        """The version of one app in the downloads folder, and what changed in each
        version (tools/fetch_apps.py records them). The desktop app asks this when it
        starts, to offer a newer version (server/release.py)."""
        file = DOWNLOADS.get(app_id)
        if not file:
            raise HTTPException(404, "No such app.")
        try:
            there = json.loads((downloads / RELEASES).read_text()).get(file) or {}
            size = (downloads / file).stat().st_size
        except (OSError, ValueError, AttributeError):
            there, size = {}, None
        if not there.get("version") or size is None:
            return {"version": None}
        return {"version": there["version"], "notes": there.get("notes") or {}, "file": file, "size": size,
                "url": f"/downloads/{file}", "sha256": there.get("sha256"), "signature": there.get("signature")}

    @app.get("/downloads/{file}")
    def download(file: str):
        # only the names above: nothing else in the folder, or outside it, can be asked for
        if file not in DOWNLOADS.values() or not (downloads / file).is_file():
            raise HTTPException(404, "No such download.")
        return FileResponse(downloads / file, filename=file, media_type="application/octet-stream")

    # ---------- for an uptime checker (no signing in needed; see docs/hosting.md, "Being told") ----------
    disk_low = int(settings.get("disk_low_mb", 2048)) * 2**20  # less free than this and the site says so

    @app.api_route("/api/health", methods=["GET", "HEAD"])
    def health():
        """200 while the site can keep what people send it; 503 when its disk is
        nearly full or the accounts' database won't open. Says nothing more,
        since anyone can ask."""
        try:
            with store.connect() as c:
                c.execute("SELECT 1 FROM accounts LIMIT 1").fetchall()
        except sqlite3.Error:
            return JSONResponse({"ok": False, "problem": "database"}, status_code=503, headers={"Cache-Control": "no-store"})
        if shutil.disk_usage(folder).free < disk_low:
            return JSONResponse({"ok": False, "problem": "disk"}, status_code=503, headers={"Cache-Control": "no-store"})
        return JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})

    @app.get("/version.json")
    def version():
        """version: the stamp for the app's files (web/update.js). release, build,
        commit: which code the site is running (server/build.py)."""
        b = build.info()
        return Response(json.dumps({"version": web_version(WEB), "release": b["version"], "build": b["build"],
                                    "commit": b["commit"]}), media_type="application/json",
                        headers={"Cache-Control": "no-cache"})

    # ---------- the Android app proving the site is its own (no signing in needed) ----------
    android = settings.get("android") or {}
    android_package = str(android.get("package") or "")
    android_keys = [str(f).upper() for f in android.get("fingerprints") or []]
    for f in android_keys:
        if not re.fullmatch(r"([0-9A-F]{2}:){31}[0-9A-F]{2}", f):
            raise ValueError(f'"android" "fingerprints" in the settings: {f!r} is not a SHA-256 fingerprint (AB:CD:... 32 pairs)')
    if android_keys and not re.fullmatch(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+", android_package):
        raise ValueError(f'"android" "package" in the settings: {android_package!r} is not an Android package name')

    @app.get("/.well-known/assetlinks.json")
    def assetlinks():
        """Digital Asset Links: the Android app (a Trusted Web Activity, see
        android/README.md) shows the site full screen only when the site names it here."""
        if not android_keys:
            raise HTTPException(404, "No Android app.")
        return [{"relation": ["delegate_permission/common.handle_all_urls"],
                 "target": {"namespace": "android_app", "package_name": android_package,
                            "sha256_cert_fingerprints": android_keys}}]

    search = seo.Search(WEB, site, home)  # robots.txt, the sitemap, and which address is listed
    search.install(app)
    vision_files(app)
    app.mount("/", WebFiles(directory=WEB, html=True, head=lambda scope: page_head(scope) + search.head(scope)), name="web")
    return app


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--data", default=str(ROOT / "data" / "host"), help="folder for accounts and their games")
    ap.add_argument("--settings", default=str(ROOT / "host.json"), help="settings file (see host.example.json)")
    args = ap.parse_args()
    try:
        settings = json.loads(Path(args.settings).read_text())
    except (OSError, ValueError) as e:
        sys.exit(f"Can't read the settings file {args.settings}: {e}. Copy host.example.json to it and fill it in.")
    if not str(settings.get("google_client_id", "")).endswith(".apps.googleusercontent.com") \
            or settings["google_client_id"].startswith("YOUR-"):
        sys.exit(f'{args.settings} needs "google_client_id": the Client ID of the Google sign-in client.')
    # Only this machine can reach the port: on a server Caddy sits in front (see
    # docs/hosting.md), and on a laptop Google's button only works on localhost anyway.
    print("Darts S.A.M site", build.label(), flush=True)  # in journalctl -u dartssam-host
    uvicorn.run(create(Path(args.data), settings), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
