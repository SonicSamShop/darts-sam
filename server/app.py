# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Darts S.A.M server: runs on the computer the cameras are plugged into (a
Raspberry Pi, or a Mac or PC; the desktop apps are this in a window).

  python -m server.app            # finds USB cameras; add a phone on the app's Cameras screen

For development: --no-cameras leaves the cameras alone, and --camera SOURCE
names them outright instead of what was found and added.

Serves the web app (web/), watches the cameras, and pushes dart events to the
app over a WebSocket. docs/architecture.md says where everything else is.
"""
import argparse
import asyncio
import json
import os
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from . import autocalib, board, build, cameras, camlist, data_api, db, guard, limits, link, paths, release, report, reportsync, share
from .awake import keep_awake
from . import calib
from .tracker import Tracker
from .version import WebFiles, vision_files, web_version

WEB = paths.BUNDLE / "web"
CONFIG_PATH = paths.HOME / "config.json"
# "added": stream addresses added in the app; "off": names of cameras switched
# off there; "calibration": by camera name (see camlist.py). "devices", like
# --camera, names the cameras outright and turns all of that off. "order": the
# cameras' names in the order they are shown. "width", "height", "fps": what
# USB cameras are asked for (Cameras screen, one of SIZES and RATES);
# "standby": minutes unused before the cameras rest, 0 never (STANDBY).
# "host": the hosted site's address; "link": {"token"} once paired with an
# account there (see link.py). "share": whether its owner agreed to send what
# it records without an account (see share.py). Without "link" or a yes in
# "share" this server contacts nothing.
DEFAULTS = {"devices": None, "added": [], "off": [], "order": [], "width": 1280, "height": 720, "fps": 15,
            "standby": 15, "calibration": {}, "host": None, "link": None, "share": None}
SIZES = [(640, 360), (1280, 720), (1920, 1080)]  # all one shape, so calibration scales from one to another
RATES = [15, 30]
STANDBY = [0, 5, 15, 30, 60]
SHARED_PATH = paths.HOME / "data" / "shared.json"  # which games have been sent (share.py)

loop: asyncio.AbstractEventLoop | None = None


@asynccontextmanager
async def lifespan(_app):
    global loop
    loop = asyncio.get_running_loop()  # lets the camera thread send events to the app
    if config.get("link") and site():
        start_link()
    start_share()
    if pair_at_start:
        loop.create_task(_pair(announce=True))
    yield


app = FastAPI(lifespan=lifespan)
config = dict(DEFAULTS)
# No sign-in here, so pages on other websites are kept out (guard.py), and no request may be huge (limits.py).
app.add_middleware(limits.BodyLimit)
app.add_middleware(guard.LocalOnly, extra=lambda: config.get("hosts") or ())
cams: dict[int, cameras.Camera] = {}
sources: list | None = None  # cameras named with --camera; None: config.json, else auto-detect
found: list[int] = []  # the USB cameras the last search saw, switched off or not
cameras_on = False  # False under --no-cameras
refreshing = threading.Lock()
wanted = time.time()  # when the cameras were last wanted: a dart, a game, the Cameras screen
resting = False  # standby: the cameras have let go of their devices until wanted
tracker = Tracker({})
clients: set[WebSocket] = set()
lock = threading.Lock()


def load_config():
    if CONFIG_PATH.exists():
        config.update(json.loads(CONFIG_PATH.read_text()))


def save_config():
    CONFIG_PATH.write_text(json.dumps(config, indent=2))


def rebuild_tracker():
    with lock:
        tracker.H = {int(i): calib.view(p) for i, p in calibration_by_id().items()}
        tracker.reset()
    if the_link:
        the_link.say_hello()  # the hosted site shows how many cameras score


def start_cameras():
    """Find the cameras and start watching them: at startup, and again whenever
    the app asks (a camera plugged in late, or back under another number)."""
    global cams, found
    old, cams = cams, {}  # a new dict, so nothing reading the old one sees it change
    for c in old.values():
        c.stop()
    for c in old.values():
        c.join()  # auto-detect can't open a device an old camera still holds
    if fixed():
        found, devices = [], sources or config["devices"]
    else:
        found = cameras.discover()
        devices = camlist.ordered(camlist.running(found, config["added"], config["off"]), config["order"])
    print("cameras:", devices)
    global resting, wanted
    resting, wanted = False, time.time()
    cams = {i: cameras.Camera(i, dev, config["width"], config["height"], config["fps"])
            for i, dev in enumerate(devices)}
    if camlist.adopt(config["calibration"], [camlist.name(dev) for dev in devices]):
        save_config()  # calibration from before cameras had names
    rebuild_tracker()


def fixed() -> bool:
    """The cameras were named when the server was started (--camera, or
    "devices" in config.json), so the app can't add, remove or switch them."""
    return bool(sources or config["devices"])


def key(cam_id: int) -> str:
    """The name a running camera's calibration is saved under."""
    cam = cams.get(cam_id)
    if cam is None:
        raise HTTPException(404, "camera not available")
    return camlist.name(cam.device)


def calibration_by_id() -> dict:
    """The running cameras' calibration by their id, as the tracker and reports know them."""
    saved = config["calibration"]
    return {str(c.id): saved[camlist.name(c.device)] for c in cams.values() if camlist.name(c.device) in saved}


def scoring_cameras() -> int:
    """How many cameras are both present and calibrated."""
    return sum(1 for i in cams if i in tracker.H)


async def broadcast(event: dict):
    if the_link:
        the_link.send_event(event)  # and to the person's apps on the hosted site
    for ws in list(clients):
        try:
            await ws.send_json(event)
        except Exception:
            clients.discard(ws)


def vision_loop():
    global wanted
    while True:
        start = time.time()
        period = 1.0 / config["fps"]
        frames = {c.id: c.frame for c in cams.values()
                  if c.ok and c.frame is not None and c.id in tracker.H}
        with lock:
            events = tracker.update(frames) if frames else []
        if events:
            wanted = time.time()
        for ev in events:
            print("event:", ev)
            if loop:
                asyncio.run_coroutine_threadsafe(broadcast(ev), loop)
        time.sleep(max(0.0, period - (time.time() - start)))


def standby_loop():
    """Rest the cameras once nothing has wanted them for "standby" minutes."""
    global resting
    while True:
        time.sleep(10)
        minutes = config.get("standby") or 0
        if minutes and cams and not resting and time.time() - wanted > minutes * 60:
            resting = True
            print("cameras: resting")
            for c in list(cams.values()):
                c.sleep()


def wake_cameras():
    """The cameras are wanted: a game, the Cameras screen. Wakes them if resting."""
    global wanted, resting
    wanted = time.time()
    if resting:
        resting = False
        print("cameras: awake")
        for c in list(cams.values()):
            c.wake()
        with lock:
            tracker.reset()  # the board may have changed while they rested


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    # version: lets an app that was already open see that its files have changed (web/update.js)
    await ws.send_json({"type": "hello", "cameras": scoring_cameras(), "version": web_version(WEB)})
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive pings from the app
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


@app.get("/api/status")
def status():
    return {
        "targets": [p["label"] for p in board.CALIBRATION_POINTS],
        "cameras": [{"id": c.id, "ok": c.ok, "points": config["calibration"].get(n), **_about(n)}
                    for c in cams.values() for n in [camlist.name(c.device)]],
        # switched off, but there to be switched back on
        "off": [_about(n) for n in config["off"]
                if n in config["added"] or n in map(camlist.name, found)],
        "fixed": fixed(),
        "resting": resting,
        "settings": {"width": config["width"], "height": config["height"], "fps": config["fps"],
                     "standby": config.get("standby") or 0},
        "choices": {"sizes": SIZES, "rates": RATES, "standby": STANDBY},
    }


def _about(name: str) -> dict:
    return {"name": name, "label": camlist.label(name), "kind": camlist.kind(name)}


def _frame(cam_id: int):
    wake_cameras()
    cam = cams.get(cam_id)
    deadline = time.time() + 3  # one just woken takes a moment
    while cam is not None and cam.frame is None and time.time() < deadline:
        time.sleep(0.1)
    if cam is None or cam.frame is None:
        raise HTTPException(404, "camera not available")
    return cam.frame.copy()


def _jpeg(img) -> Response:
    return Response(cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes(),
                    media_type="image/jpeg", headers={"Cache-Control": "no-store"})


def change_cameras(change=None) -> dict:
    """Look for the cameras again, as a restart would, after making `change`
    to the saved list (if any). One at a time: a second is refused, unmade."""
    if not cameras_on:
        raise HTTPException(409, "The server was started with its cameras switched off (--no-cameras).")
    if not refreshing.acquire(blocking=False):
        raise HTTPException(409, "Already looking for cameras.")
    try:
        if change:
            change()
            save_config()
        start_cameras()
        deadline = time.time() + 3  # give each a moment to deliver its first picture
        while time.time() < deadline and not all(c.ok for c in cams.values()):
            time.sleep(0.1)
    finally:
        refreshing.release()
    return {**status(), "scoring": scoring_cameras()}


def _changeable():
    if cameras_on and fixed():
        raise HTTPException(409, "These cameras were chosen when the server was started (--camera), "
                                 "so they can't be changed here.")


@app.post("/api/cameras/refresh")
def refresh_cameras():
    """For a camera plugged in late, or back under another number."""
    return change_cameras()


class Address(BaseModel):
    address: str


@app.post("/api/cameras")
def add_camera(body: Address):
    """Add a phone or other network camera by its stream address."""
    _changeable()
    try:
        address = camlist.clean_address(body.address)
    except ValueError as e:
        raise HTTPException(400, str(e))

    def add():
        if address in config["added"]:
            raise HTTPException(409, "That camera is already added.")
        config["added"].append(address)
    return change_cameras(add)


class CameraName(BaseModel):
    name: str


@app.post("/api/cameras/remove")
def remove_camera(body: CameraName):
    """Forget an added camera, and its calibration."""
    _changeable()

    def remove():
        if body.name not in config["added"]:
            raise HTTPException(404, "No such added camera.")
        config["added"].remove(body.name)
        if body.name in config["off"]:
            config["off"].remove(body.name)
        config["calibration"].pop(body.name, None)
    return change_cameras(remove)


class CameraOn(BaseModel):
    name: str
    on: bool


@app.post("/api/cameras/enabled")
def enable_camera(body: CameraOn):
    """Switch a camera off (a laptop's own webcam, say) or back on. Its calibration is kept."""
    _changeable()

    def switch():
        off = config["off"]
        if body.on:
            if body.name in off:
                off.remove(body.name)
        elif body.name not in off:
            if body.name not in config["added"] and body.name not in map(camlist.name, found):
                raise HTTPException(404, "No such camera.")
            off.append(body.name)
    return change_cameras(switch)


class Place(BaseModel):
    place: int  # a camera's position as shown (its id)
    name: str | None = None  # the camera to show there; None: none, that one switched off


@app.post("/api/cameras/place")
def place_camera(body: Place):
    """Choose the camera in one place: one shown elsewhere swaps with it, one
    switched off takes its place (and it is switched off), None switches it off."""
    _changeable()

    def place():
        names = [camlist.name(c.device) for c in cams.values()]
        if not 0 <= body.place < len(names):
            raise HTTPException(404, "No camera there.")
        here, off = names[body.place], config["off"]
        if body.name is None:
            off.append(here)
        elif body.name in names:
            there = names.index(body.name)
            names[body.place], names[there] = names[there], names[body.place]
        elif body.name in off:
            off.remove(body.name)
            off.append(here)
            names[body.place] = body.name
        else:
            raise HTTPException(404, "No such camera.")
        config["order"] = names + [n for n in config["order"] if n not in names]
    return change_cameras(place)


class CameraSettings(BaseModel):
    width: int
    height: int
    fps: int
    standby: int


@app.post("/api/cameras/settings")
def camera_settings(body: CameraSettings):
    """Picture size, frames a second and standby. A new size or rate restarts
    the cameras; each USB camera's calibration is scaled to the new size."""
    if (body.width, body.height) not in SIZES or body.fps not in RATES or body.standby not in STANDBY:
        raise HTTPException(400, "Not one of the choices.")
    config["standby"] = body.standby
    if (body.width, body.height, body.fps) == (config["width"], config["height"], config["fps"]):
        save_config()
        wake_cameras()
        return {**status(), "scoring": scoring_cameras()}
    _changeable()

    def change():
        old = (config["width"], config["height"])
        for name, saved in config["calibration"].items():
            if camlist.kind(name) == "usb":
                config["calibration"][name] = calib.rescale(saved, old, (body.width, body.height))
        config["width"], config["height"], config["fps"] = body.width, body.height, body.fps
    return change_cameras(change)


@app.post("/api/cameras/wake")
def wake():
    """The app is in a game or on the Cameras screen: keep the cameras awake."""
    wake_cameras()
    return {"ok": True, "resting": resting}


@app.get("/api/cameras/{cam_id}/snapshot.jpg")
def snapshot(cam_id: int, overlay: bool = False):
    img = _frame(cam_id)
    pts = config["calibration"].get(key(cam_id))
    if overlay and pts:
        calib.draw_board(img, pts)
    return _jpeg(img)


class Calibration(BaseModel):
    points: list[list[float]]  # four [x, y] pixel positions, in target order


@app.post("/api/cameras/{cam_id}/calibration")
def calibrate(cam_id: int, body: Calibration):
    if len(body.points) != 4:
        raise HTTPException(400, "need exactly 4 points")
    config["calibration"][key(cam_id)] = body.points
    save_config()
    rebuild_tracker()
    return {"ok": True}


class AutoCalibration(BaseModel):
    twenty: list[float] | None = None  # a pixel anywhere inside the 20 segment
    number: int = 20  # ...or inside this one, for a camera that can't see the 20
    idle: bool = False  # only if no darts are in the board: the app asking by itself as it opens


@app.post("/api/cameras/{cam_id}/autocalibration")
def autocalibrate(cam_id: int, body: AutoCalibration):
    """Calibrate from the picture itself (see autocalib.py). The colours can't
    say which way up the board is, so the app sends one rough tap on the 20;
    without one, the existing calibration says where the 20 is."""
    img = _frame(cam_id)
    if body.idle and tracker.darts:
        raise HTTPException(409, "There are darts in the board.")
    twenty = body.twenty
    if twenty is None:
        old = config["calibration"].get(key(cam_id))
        if not old:
            raise HTTPException(400, "Tap the 20 segment first.")
        twenty = calib.view(old).to_picture([board.polar(0, 130)])[0].tolist()
    if body.number not in board.SEGMENTS:
        raise HTTPException(400, "Not a number on the board.")
    try:
        board_found = autocalib.detect(img, twenty, body.number if body.twenty is not None else 20)
    except autocalib.Failed as e:
        raise HTTPException(422, str(e))
    config["calibration"][key(cam_id)] = board_found.saved()
    save_config()
    rebuild_tracker()
    return {"ok": True, "joins": board_found.joins, "rms_px": round(board_found.rms_px, 2),
            "lens": round(board_found.lens, 2)}


@app.post("/api/reset")
def reset():
    """Tell the tracker the board is empty right now."""
    wake_cameras()
    with lock:
        tracker.reset()
    return {"ok": True}


class ReportIn(BaseModel):
    app: Any = None  # what the app was showing: the game, the visit so far, the last darts


class ReportNote(BaseModel):
    expected: str = ""  # what the dart really was, e.g. "T20"
    note: str = ""


@app.post("/api/reports")
def make_report(body: ReportIn):
    """Save what the cameras saw over the last few darts (see report.py)."""
    with lock:  # the pictures are only pointed at here; the writing happens after
        frames = {c.id: c.frame for c in cams.values() if c.frame is not None and c.id in tracker.H}
        snap = report.snapshot(tracker, frames)
    if not snap["H"]:
        raise HTTPException(409, "No calibrated cameras to report on.")
    r = report.save(snap, calibration_by_id(), body.app)
    print("report:", r["id"])
    send_report(r["id"])
    return r


def send_report(report_id: str, noted: bool = False):
    """Paired with an online account, or sharing without one (share.py): mark
    the report to go up to the site (reportsync.py). Neither: reports stay on
    this machine, unmarked."""
    if not config.get("link") and not sharing():
        return
    folder = report.DIR / report_id
    reportsync.noted(folder) if noted else reportsync.mark(folder, "wait")


@app.patch("/api/reports/{report_id}")
def note_report(report_id: str, body: ReportNote):
    if not report.annotate_report(report_id, body.expected, body.note):
        raise HTTPException(404, "no such report")
    send_report(report_id, noted=True)
    return {"ok": True}


@app.get("/api/reports/{report_id}/{name}")
def report_file(report_id: str, name: str):
    p = report.path(report_id, name)
    if p is None:
        raise HTTPException(404, "no such file")
    return FileResponse(p, headers={"Cache-Control": "no-store"})


class SimDart(BaseModel):
    x: float
    y: float


@app.post("/api/simulate")
async def simulate(d: SimDart):
    """Development aid: pretend the cameras saw a dart at (x, y) mm.
    curl -X POST localhost:8000/api/simulate -H 'Content-Type: application/json' -d '{"x":0,"y":103}'"""
    ev = {"type": "dart", "x": d.x, "y": d.y, "confidence": 1.0, "cameras": 0, **board.score(d.x, d.y)}
    await broadcast(ev)
    return ev


@app.post("/api/simulate/takeout")
async def simulate_takeout():
    await broadcast({"type": "takeout"})
    return {"ok": True}


# ---------- the hosted site (see link.py) ----------
# Only for someone who wants these cameras to score in the hosted app. Nothing
# below contacts the site until they ask to be paired.
the_link: link.Link | None = None
uploader: reportsync.Uploader | None = None  # sends problem reports up while paired, or sharing
sharer: share.Sharer | None = None  # sends games up while sharing without an account
pairing: dict | None = None   # {"code", "url"} while a code is waiting to be typed on the site
pair_at_start = False         # --pair
host_override: str | None = None  # --host
own_address = "http://127.0.0.1:8000"  # where this server answers itself


def site() -> str | None:
    """The hosted site's address, if one is set."""
    return host_override or config.get("host") or link.DEFAULT_HOST


def _answer(method: str, path: str, content_type: str | None, body: bytes):
    """Answer one of the site's questions by asking this server."""
    req = urllib.request.Request(own_address + path, data=body or None, method=method,
                                 headers={"Content-Type": content_type} if content_type else {})
    ctx = ssl._create_unverified_context() if own_address.startswith("https") else None  # our own certificate
    try:
        with urllib.request.urlopen(req, timeout=40, context=ctx) as r:
            return r.status, r.headers.get("Content-Type"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type"), e.read()


def _hello() -> dict:
    return {"cameras": len(cams), "calibrated": scoring_cameras(), "platform": sys.platform, "version": web_version(WEB)}


def _forgotten():
    """The site no longer knows this helper (the person disconnected it there)."""
    global the_link
    the_link = None
    config["link"] = None
    save_config()
    start_uploader()
    print("link: disconnected from the online account")


def stop_uploader():
    global uploader
    if uploader:
        uploader.stop()
        uploader = None


def start_uploader():
    """Problem reports go to the account these cameras are paired with; with
    none, to the site as this install's, if its owner agreed to share."""
    global uploader
    stop_uploader()
    token = (config.get("link") or {}).get("token") or (sharing() and config["share"].get("token"))
    if token:
        uploader = reportsync.Uploader(report.DIR, site(), token)
        uploader.start()


def start_link():
    global the_link
    the_link = link.Link(site(), config["link"]["token"], _answer, _hello, _forgotten)
    asyncio.run_coroutine_threadsafe(the_link.run(), loop)
    start_uploader()


async def _pair(announce=False):
    global pairing

    def show(code, url):
        global pairing
        pairing = {"code": code, "url": url}
        if announce:
            print(f"Pairing code: {code} — open {url}")
    try:
        token = await link.pair(site(), show)
    except OSError as e:
        pairing = {"error": f"Couldn't reach the online site at {site()}."}
        print("link:", e)
        return
    pairing = None
    if token:
        stop_link()
        config["link"] = {"token": token}
        save_config()
        start_link()
        print("link: paired with an online account")


def stop_link():
    global the_link
    stop_uploader()
    if the_link:
        the_link.stop()
        the_link = None


@app.get("/api/link")
def link_status():
    waiting = pairing if pairing and "code" in pairing else None
    return {"host": site(), "paired": bool(config.get("link")), "connected": bool(the_link and the_link.connected),
            "code": waiting and waiting["code"], "url": waiting and waiting["url"]}


@app.post("/api/link/pair")
def start_pairing():
    """Ask the site for a code to type there. This is the first moment this server contacts the site."""
    global pairing
    if not site():
        raise HTTPException(409, 'No address is set for the online site. Start the server with --host, '
                                 'or set "host" in config.json.')
    if not (pairing and "code" in pairing):
        pairing = None
        asyncio.run_coroutine_threadsafe(_pair(), loop)
        deadline = time.time() + 12
        while pairing is None and time.time() < deadline:
            time.sleep(0.1)  # until the site has given a code, or could not be reached
        if pairing is None or "error" in pairing:
            message, pairing = (pairing or {}).get("error", "The online site didn't answer."), None
            raise HTTPException(502, message)
    return link_status()


@app.delete("/api/link")
def unlink():
    """Stop using these cameras with the online account."""
    stop_link()
    config["link"] = None
    save_config()
    start_uploader()
    return {"ok": True}


# ---------- sharing without an account (see share.py) ----------
# Only for someone who said yes when the app asked. Nothing below contacts the
# site until then.
class ShareIn(BaseModel):
    on: bool


class EventsIn(BaseModel):
    events: list


class FeedbackIn(BaseModel):
    text: str
    app: dict | None = None


def sharing() -> bool:
    return bool((config.get("share") or {}).get("on") and site())


def _share_token(token: str | None):
    """The site gave this install its token, or (None) no longer knows it."""
    config["share"] = {**(config.get("share") or {}), "token": token}
    save_config()
    start_uploader()


def start_share():
    global sharer
    if sharer:
        sharer.stop()
        sharer = None
    if sharing():
        sharer = share.Sharer(site(), config["share"].get("token"), SHARED_PATH, _hello, _share_token)
        sharer.start()
    start_uploader()


def _to_site(path: str, body: dict) -> dict:
    """Pass something from the app on to the site as this install's."""
    token = sharing() and config["share"].get("token")
    if not token:
        raise HTTPException(409, "Sharing is switched off.")
    try:
        status, answer = share.call(site() + path, token, "POST", body)
    except OSError:
        raise HTTPException(502, "Not sent: the Darts S.A.M site couldn't be reached. Try again.")
    if status != 200:
        detail = answer.get("detail")
        raise HTTPException(status if status in (400, 429) else 502,
                            detail if isinstance(detail, str) else "Not sent: the Darts S.A.M site refused it.")
    return answer


@app.get("/api/share")
def share_status():
    """asked: has anyone here said yes or no yet? The app asks until someone has."""
    return {"asked": config.get("share") is not None, "on": sharing(), "paired": bool(config.get("link")), "site": site()}


@app.put("/api/share")
def set_share(body: ShareIn):
    """Yes or no to sending what this server records. A yes is the first moment it contacts the site."""
    config["share"] = {**(config.get("share") or {}), "on": body.on}
    save_config()
    start_share()
    return share_status()


@app.delete("/api/share")
def delete_shared():
    """Stop sharing, and have the site delete everything this server has sent."""
    global sharer
    if sharer:
        sharer.stop()  # nothing more goes while the site is asked
        sharer = None
    token = (config.get("share") or {}).get("token")
    if token:
        try:
            status, _ = share.call(site() + "/api/install", token, "DELETE")
        except OSError:
            status = None
        if status not in (200, 401):  # 401: it was gone already
            start_share()
            raise HTTPException(502, "Nothing was deleted: the Darts S.A.M site couldn't be reached. Try again.")
    config["share"] = {"on": False}
    save_config()
    share.forget(SHARED_PATH)
    start_share()
    return share_status()


@app.post("/api/share/events")
def share_events(body: EventsIn):
    return _to_site("/api/install/events", body.model_dump())


@app.post("/api/share/feedback")
def share_feedback(body: FeedbackIn):
    return _to_site("/api/install/feedback", body.model_dump())


# ---------- saved data: players, settings, matches, stats (see data_api.py) ----------
app.include_router(data_api.make_router(lambda request: None, reports=report.count))


# ---------- a newer version of the desktop app (see release.py) ----------
updater = release.Updater(lambda: site())


@app.get("/api/update")
def update_status():
    """This app's version, and a newer one if the site has it (asked once, at start)."""
    return updater.state()


@app.post("/api/update")
def start_update():
    """Download the newer version, then start installing it."""
    if not updater.start_download():
        raise HTTPException(409, "There is no new version to download.")
    return updater.state()


@app.get("/version.json")
def version():
    """The stamp for the app's files as they are now. The app fetches it along with its
    files, so a saved copy of the app carries the stamp of the files it was saved with.
    release, build, commit: which code is running (server/build.py)."""
    b = build.info()
    return Response(json.dumps({"version": web_version(WEB), "release": b["version"], "build": b["build"],
                                "commit": b["commit"]}), media_type="application/json",
                    headers={"Cache-Control": "no-cache"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-cameras", action="store_true")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--db", help="database file (default: data/dartssam.db)")
    ap.add_argument("--camera", action="append", metavar="SOURCE",
                    help="for development: use only this camera, not those found or added in the app: a stream address such as "
                         "http://192.168.1.50:8080/video, or a camera number. Repeat for more cameras.")
    ap.add_argument("--cert", help="https certificate file. The app only installs itself for offline "
                                   "use when it is served over https (see docs/setup.md).")
    ap.add_argument("--key", help="the certificate's private key file")
    ap.add_argument("--host", metavar="URL", help="the hosted site's address, to use these cameras with an "
                                                  "account there (instead of \"host\" in config.json)")
    ap.add_argument("--pair", action="store_true", help="pair with an account on the hosted site now: "
                                                        "prints a code to type there")
    args = ap.parse_args()
    if bool(args.cert) != bool(args.key):
        ap.error("--cert and --key go together")

    print("Darts S.A.M", build.label(), flush=True)
    load_config()
    db.init(args.db)
    global sources, cameras_on, host_override, pair_at_start, own_address
    host_override = args.host and args.host.rstrip("/")
    own_address = f"{'https' if args.cert else 'http'}://127.0.0.1:{args.port}"
    if args.pair and not site():
        ap.error('--pair needs the hosted site\'s address: add --host URL, or set "host" in config.json')
    pair_at_start = args.pair
    if paths.FROZEN or os.environ.get("DARTSSAM_UPDATES") == "1":
        updater.start_check()  # only the built desktop app: the Pi is updated another way
    else:
        updater.checked = True  # nothing to wait for
    if not args.no_cameras:
        if args.camera:
            sources = [int(c) if c.isdigit() else c for c in args.camera]
        cameras_on = True
        keep_awake()  # a computer gone to sleep with its screen counts nothing
        start_cameras()
        threading.Thread(target=vision_loop, daemon=True).start()
        threading.Thread(target=standby_loop, daemon=True).start()

    vision_files(app)
    app.mount("/", WebFiles(directory=WEB, html=True), name="web")
    uvicorn.run(app, host="0.0.0.0", port=args.port, ssl_certfile=args.cert, ssl_keyfile=args.key)


if __name__ == "__main__":
    main()
