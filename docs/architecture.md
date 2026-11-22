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
| `phonevision.py` | The same, for one phone scoring with its own camera (Beta): run in the phone's browser, see below. |

## The server at home: `server/app.py`

| File | What it does |
|---|---|
| `app.py` | Starts the cameras and the vision loop, serves `web/`, and answers `/api/...` (camera pictures, calibration, reports, pairing) and `/ws` (darts as they land). |
| `data_api.py`, `db.py` | Players, their darts, settings, matches and stats: the addresses, and the SQLite behind them. Shared with the hosted site. |
| `photos.py` | A picture of the board kept with a game, taken when a dart the cameras scored earned an achievement. |
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
| `app.js` | What the screens share: the saved data and syncing it, the players and the game in progress, the link to the cameras, voice, fitting a screen to the window, the addresses and the back button, the four places along the top, one click handler for every screen, and starting up. |
| `screens/*.js` | One module per screen or part of one: `home.js` (the menu), `start.js` (who throws first, the bull-off, a new match), `game.js` (a game being played: the board, the number pad, the TV view, the computer's throws, quitting), `earned.js` (achievements as they are earned in a game, and their pictures), `report.js` (problem reports), `stats.js` (the Stats screen and scoresheets), `achievements.js` (its Achievements tab), `cameras.js` (the Cameras screen, calibrating, pairing), `settings.js` (the Settings screen, its Theme and In game sections), `playerspanel.js`, `accountpanel.js` and `sharing.js` (three more sections of Settings), `release.js` (a newer desktop app on offer, and About), `landing.js` (the welcome page, signing in) and `welcome.js` (the desktop app's first questions). Each imports what it needs from `app.js` and from the others. What `app.js`'s click handler changes in one of them is a property of an object it exports (`camScreen.note`, `menu.step`, `statsView.tab`), since a module can't assign to an imported variable; the `app.js` values a screen sets (the screen shown, the game in progress, how many cameras score, and a few more) go through setters (`setScreen`, `setMatch`, `setCameraCount`). A screen module uses `app.js`'s values only once the app is running, never while it is first loaded: it is loaded before `app.js`'s own code runs. |
| `engine.js` | A match is `{gameId, players, opts, log}`; the state is always worked out by replaying the log, which makes Undo "drop the last entry". |
| `games/*.js` | One small module per game, match games (X01, Cricket, Killer) and training games alike; `games/index.js` lists them. |
| `board.js` | The board's geometry again, and the board you tap. |
| `sync.js` | Saved data, offline first: written to the device at once, queued, and sent when the server can be reached. |
| `stats.js` | The deep stats, counted on the device from the history the server sends. |
| `achievements.js` | Achievements (a first 180, a 170 finish): none is stored, each is worked out from that same history, and from the game in progress after every dart. |
| `account.js`, `track.js` | The hosted version: who is signed in, and its notes on how the app is used. |
| `voice.js` | Calling the scores in the device's own voice. |
| `phoneui.js`, `phonecam.js`, `vision-worker.js`, `ask.js` | A phone scoring with its own camera (Beta): its screen; the camera and the frames; Python (Pyodide, from `vision/pyodide/`, put there by `tools/fetch_pyodide.py`) running `server/`'s vision files in the browser, served at `/vision/py/`; and asking **Which bed?** when it isn't sure. Nothing leaves the phone. |
| `bot.js` | Computer players: the levels, and how one throws a dart. Which bed to aim at is each game's own `bot()`; `tools/bot_levels.mjs` works the levels out. |
| `update.js`, `sw.js`, `install.js` | Reloading onto new files; keeping a copy for offline; "Add to Home Screen". |
| `index.html`, `faq.html`, `download.html`, `releases.html`, `opensource.html`, `privacy.html` | The app's one page, and the site's plain pages. |
| `shots/` | Pictures of the app, taken from the app itself, for the welcome page and the README; and one camera's picture of a real board. |
| `style.css`, `themes.css`, `fonts/` | How it looks, in each theme. |
| `theme.js` | Before a page is first drawn: puts the saved theme on it, and starts fetching that theme's lettering. |

## How a dart gets to the screen

1. `cameras.py` keeps each camera's newest frame.
2. `app.py`'s vision loop hands the frames to `tracker.update()` about 15 times
   a second.
3. When the board has changed and gone still, `detect.py` finds the dart in
   each picture and where the lines cross; `board.score()` names the segment.
4. The event goes to every open app over the WebSocket `/ws` and, if paired,
   up `link.py` to the site, whose `relay.py` passes it to that account's apps.
5. `web/app.js` passes it to the game (`push()` in `web/screens/game.js`), which adds it to the match's log; `engine.js` replays the log; the
   screen is drawn again and `voice.js` calls it.
6. `sync.js` saves the match on the device and sends it to the server, which
   keeps every dart in `db.py`.

## Where things are kept

| What | Where |
|---|---|
| Camera list, calibration, pairing, sharing | `config.json` |
| Players, games, every dart | `data/dartssam.db` |
| Pictures of the board kept with achievements | `data/dartssam.photos/<game>/` (on the site, beside the account's games) |
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
| `tools/fetch_pyodide.py` | Where the app is served from: fetches Python for the browser (checked against pinned hashes) for phones' cameras. |
| `tools/backup.sh` | On a site's server: a dated copy of everything it keeps. |
| `tools/calib_figures.py` | Makes the pictures in [calibration.md](calibration.md) again. |
| `tools/linux/install.sh` | Puts the Linux build in the app menu. |
| `tools/build_trial_form.gs` | A Google Apps Script that made the trial's sign-up form. Not part of the app. |
| `.github/workflows/` | `tests.yml` runs the tests on every pull request and every push to `main`; `mac.yml`, `windows.yml` and `linux.yml` build the apps when the version goes up. |
