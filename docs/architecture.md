# How the code is laid out

Darts S.A.M is one web app and two programs that serve it.

```
              AT HOME                                         ON THE INTERNET
  cameras ──► server/app.py ──serves──► web/            server/host.py ──serves──► web/
              the server by the board                   the hosted site
              (and inside the desktop apps)             (dartssam.co.uk)

              cameras, vision, one database,            accounts, a database per account,
              no sign-in, home network only             no cameras, no OpenCV
                    │                                         ▲
                    └── link.py: connects out, once paired ───┘
                        so the hosted app can reach the cameras
```

- **`python -m server.app`** runs by the board: it watches the cameras, works
  out each dart, keeps players and games in one file, and serves the app to
  anything on the home network. The Mac, Windows and Linux apps are this same
  program (`server/desktop.py`), in a window of its own on a Mac and Windows.
- **`python -m server.host`** is the same app for many people at one address:
  each signs in and has their own players, games and stats. It has no cameras.
  Someone's cameras at home reach it by their own server connecting *out* to it.
- **`web/`** is the app both serve: plain JavaScript modules, HTML and CSS. No
  framework and no build step: edit a file and reload.

Nearly every file starts with a comment saying what it is for and why. This
page is the map; the files are the detail.

## The cameras: `server/`

No network, no database, only NumPy and OpenCV. In the order a picture goes
through them:

| File | What it does |
|---|---|
| `cameras.py` | Opens USB cameras and network streams; a thread per camera keeps the newest frame. |
| `camlist.py` | Which cameras run and what each is called, so a calibration stays with its camera. |
| `board.py` | The board's sizes in millimetres, and which segment a position scores. |
| `calib.py` | A calibration: picture pixels ⇄ board millimetres, lens bend included. |
| `autocalib.py` | Finds the board in a picture by itself. [calibration.md](calibration.md) |
| `detect.py` | Finds a new dart in one camera's picture and crosses the cameras' lines. [detection.md](detection.md) |
| `tracker.py` | Turns a stream of pictures into "dart", "takeout" and "removed". |
| `report.py`, `replay.py` | Saves what the cameras saw when a dart is scored wrongly, and runs detection over it again. |

## The server at home: `server/app.py`

| File | What it does |
|---|---|
| `app.py` | Starts the cameras and the vision loop, serves `web/`, and answers `/api/...` (camera pictures, calibration, reports, pairing) and `/ws` (darts as they land). |
| `data_api.py`, `db.py` | Players, their darts, settings, matches and stats: the addresses, and the SQLite behind them. Shared with the hosted site. |
| `guard.py`, `limits.py` | No sign-in here, so: only names a home network uses are answered, and no request may be huge. |
| `paths.py` | Where the code, the app's files and the kept data are (different once built into one program). |
| `awake.py` | Keeps the computer from sleeping while it watches the cameras. |
| `version.py`, `build.py` | The stamp that tells an open app its files have changed; which version and build is running. |
| `desktop.py`, `release.py` | The desktop app: its window, a second start, and offering and checking a newer version. |

## The hosted site: `server/host.py`

It must run without OpenCV installed (`requirements-host.txt`).

| File | What it does |
|---|---|
| `host.py` | Signing in, each account's data, pairing, the downloads, and the welcome page's numbers. |
| `hoststore.py` | Accounts and sessions (`host.db`). Each account's games are in a database of its own, so deleting an account is deleting a folder. |
| `auth.py`, `mail.py` | Checking a Google or Apple sign-in; sending the sign-in code by email. |
| `relay.py` | The switchboard between a person's cameras at home and their open apps. |
| `admin.py`, `insight.py` | The private pages for whoever runs the site, and the accuracy numbers on them. |

## Between the two

| File | What it does |
|---|---|
| `link.py` | The home server's line to the site once paired: darts go up, the app's questions come down. Nothing runs until someone asks to pair. |
| `reportsync.py` | Sends problem reports from a paired home server to the site. |
| `share.py` | Sends games and reports without an account, only after the owner says yes. |

## The app: `web/`

| File | What it does |
|---|---|
| `app.js` | Every screen, and the events between them. The biggest file by far. |
| `engine.js` | A match is `{gameId, players, opts, log}`; the state is always worked out by replaying the log, which makes Undo "drop the last entry". |
| `games/*.js` | One small module per game (X01, Cricket, Around the Clock, Count Up, 121 Checkout, Killer, Random Targets, Free Mode); `games/index.js` lists them. |
| `board.js` | The board's geometry again, and the board you tap. |
| `sync.js` | Saved data, offline first: written to the device at once, queued, and sent when the server can be reached. |
| `stats.js` | The deep stats, counted on the device from the history the server sends. |
| `account.js`, `track.js` | The hosted version: who is signed in, and its notes on how the app is used. |
| `voice.js` | Calling the scores in the device's own voice. |
| `update.js`, `sw.js`, `install.js` | Reloading onto new files; keeping a copy for offline; "Add to Home Screen". |
| `index.html`, `faq.html`, `download.html`, `privacy.html`, `opensource.html` | The app's one page, and the site's plain pages. |
| `style.css`, `themes.css`, `fonts/` | How it looks, in each theme. |

## How a dart gets to the screen

1. `cameras.py` keeps each camera's newest frame.
2. `app.py`'s vision loop hands the frames to `tracker.update()` about 15 times
   a second.
3. When the board has changed and gone still, `detect.py` finds the dart in
   each picture and where the lines cross; `board.score()` names the segment.
4. The event goes to every open app over the WebSocket `/ws` and, if paired,
   up `link.py` to the site, whose `relay.py` passes it to that account's apps.
5. `web/app.js` adds it to the match's log; `engine.js` replays the log; the
   screen is drawn again and `voice.js` calls it.
6. `sync.js` saves the match on the device and sends it to the server, which
   keeps every dart in `db.py`.

## Where things are kept

| What | Where |
|---|---|
| Camera list, calibration, pairing, sharing | `config.json` |
| Players, games, every dart | `data/dartssam.db` |
| Problem reports | `data/reports/<date_time>/` |
| The hosted site's accounts and sessions | `<data>/host.db` |
| Each account's games | `<data>/accounts/<id>/darts.db` |
| The hosted site's settings | `host.json` (see `host.example.json`) |

Run from the code, `config.json` and `data/` are in the code's folder (and
ignored by git). A desktop app keeps them in the user's own folder
(`server/paths.py`). A device also keeps its own copy of what it needs to work
offline, in the browser's storage.

## Tests and tools

`python -m tests` runs everything: `tests/test_*.py` (the server, each a
program of its own) and `tests/*.test.mjs` (the app's rules and logic, with
Node). The vision tests draw their own cameras' pictures, so they need no
hardware. [CONTRIBUTING.md](../CONTRIBUTING.md) says how to run them.

| File | What it does |
|---|---|
| `tools/build_exe.py` | Builds the desktop app for the system it is run on (PyInstaller). |
| `tools/sign_release.py` | Signs a build so the apps can tell an update is genuine. |
| `tools/fetch_apps.py` | On a site's server: fetches the newest builds for its download page. |
| `tools/backup.sh` | On a site's server: a dated copy of everything it keeps. |
| `tools/calib_figures.py` | Makes the pictures in [calibration.md](calibration.md) again. |
| `tools/linux/install.sh` | Puts the Linux build in the app menu. |
| `tools/build_trial_form.gs` | A Google Apps Script that made the trial's sign-up form. Not part of the app. |
| `.github/workflows/` | `tests.yml` runs the tests on every pull request and every push to `main`; `mac.yml`, `windows.yml` and `linux.yml` build the apps when the version goes up. |
