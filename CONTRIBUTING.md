# Contributing to Darts S.A.M

Thank you for wanting to help. Bug reports, pictures from your own board, fixes
and new games are all welcome.

- **Found a bug, or have an idea?** [Open an issue](https://github.com/SonicSamShop/darts-sam/issues/new/choose).
- **Found a security problem?** Don't open an issue: see [SECURITY.md](SECURITY.md).
- **Want to change the code?** Read on.

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## What helps most

- **What your cameras saw.** The camera scoring is tested on simulated
  pictures; real boards, lights and cameras are where it goes wrong. When a
  dart is scored wrongly, press **Report** in the game and say what it should
  have been. When **Find the board** fails or lands off the wires, the picture
  it was looking at says why. The issue forms ask for the right files.
- **Trying it on real hardware.** The README's [status](README.md#status-and-known-limits)
  lists what has never been tried: real cameras on Windows and Linux among them.
- **The lists of what could be better** at the end of
  [docs/calibration.md](docs/calibration.md#where-it-could-be-better) and
  [docs/detection.md](docs/detection.md#how-good-is-it).
- **A new game.** See [Adding a game](#adding-a-game): it is the easiest way in.

## Getting it running

You need Python 3.11 or newer, and Node 22 for the app's tests.

```bash
git clone https://github.com/SonicSamShop/darts-sam.git && cd darts-sam
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-host.txt -r requirements-dev.txt
.venv/bin/python -m server.app
```

Open `http://localhost:8000`. It runs with no cameras at all: score by tapping
the board. (`requirements.txt` alone is enough to run it; the other two are
for the hosted site and its tests.)

Useful while working on it:

- `--no-cameras` leaves the cameras alone altogether, and `--camera SOURCE`
  (repeatable) uses exactly the cameras named instead of those found and added.
- Fake a throw while a game is on screen (x, y in mm from the bull, +y is up),
  and the darts being pulled out:

  ```bash
  curl -X POST localhost:8000/api/simulate -H 'Content-Type: application/json' -d '{"x":0,"y":103}'
  curl -X POST localhost:8000/api/simulate/takeout
  ```

- Find the board in one picture, with nothing else running:
  `python -m server.autocalib picture.jpg --debug steps`
  ([docs/calibration.md](docs/calibration.md)).
- The hosted site on your own computer: "Trying it on a laptop" in
  [docs/hosting.md](docs/hosting.md#trying-it-on-a-laptop).

[docs/architecture.md](docs/architecture.md) says which file does what.

## Tests

```bash
python -m tests                 # everything: the server's tests, then the app's
python -m tests calib vision    # only the ones named
node --test tests/*.mjs         # only the app's
```

They run on every pull request and every push to `main`
(`.github/workflows/tests.yml`). Each of the server's tests is also a program
of its own:

| | |
|---|---|
| `python -m tests.test_vision` | The vision pipeline against a simulated 3-camera rig (the slow one: about a minute). |
| `python -m tests.test_calib` | Automatic calibration against simulated cameras. |
| `python -m tests.test_db` | Saved players, matches and stats. |
| `python -m tests.test_data_api` | The saved-data addresses, shared by the server at home and the hosted site. |
| `python -m tests.test_camlist`, `test_refresh` | Camera names and which are used; looking for the cameras again without a restart. |
| `python -m tests.test_guard`, `test_limits` | Keeping other websites out of the server at home; how much a request may send. |
| `python -m tests.test_version`, `test_build` | The stamp that tells an open app its files have changed; which build is running. |
| `python -m tests.test_release`, `test_fetch_apps` | Telling the desktop app about a newer version; putting only new versions on the download page. |
| `python -m tests.test_host`, `test_auth`, `test_hoststore` | The hosted site: sign-in, accounts, each account's own games. |
| `python -m tests.test_relay`, `test_link`, `test_share` | Passing darts and camera requests between a home server and the site; the home server's line to it, and sharing without an account, against a real running host. |
| `python -m tests.test_insight`, `test_reportsync` | The accuracy numbers from saved games; packing problem reports and sending them to the site. |
| `python -m tests.test_awake` | Keeping the cameras' computer awake. |
| `node --test tests/*.mjs` | Game rules, offline saving and syncing, stats, the caller's voice. |

A change to the camera code should come with a test that draws the case it
fixes (`tests/test_vision.py` and `tests/test_calib.py` show how), and, if you
have saved reports, a run of `python -m server.replay` to see that the darts
that went wrong before come out right without breaking the others.

## How the code is written

It is meant to be read by someone who is not a programmer by trade. Please
keep it that way.

- **Say why, in plain words.** Nearly every file opens by saying what it is for.
  Comments explain why the code is as it is, in everyday words: "picture" not
  "frame buffer", "bend" not "radial distortion coefficient". The same goes
  for anything the app says to a player, and for error messages: say what
  happened and what to do.
- **British spelling** in the app and the docs: colour, licence, centre.
- **Few moving parts.** The app is plain JavaScript modules with no framework,
  no packages and no build step. The server's dependencies are the handful in
  `requirements.txt`. A new dependency needs a good reason.
- **Follow what is there.** Python: 4 spaces, lines up to about 120. JavaScript:
  2 spaces, single quotes, semicolons. There is no linter to argue with;
  match the file you are in.
- **A new file starts with the three licence lines** the others start with.
- **The server at home contacts nothing** until its owner pairs it or agrees to
  share. (The desktop app also asks the site, when it starts, whether there is
  a newer version, and says only which kind of computer it is.) Don't add a
  request that breaks that.
- **The hosted site runs without OpenCV.** `server/host.py` and what it
  imports must not need it.
- **Old data keeps working.** `config.json` and the database of someone who
  installed a year ago must still load (see `prepare()` in `server/db.py` and
  `adopt()` in `server/camlist.py` for how that has been done).

## Adding a game

Copy one of `web/games/*.js` (Free Mode is the smallest; Count Up is the
smallest that keeps a score and has a winner), change the rules, and add it to
the list in `web/games/index.js`. A game is a few small functions;
turn handling, undo, saving and the scoreboard come for free. The top of
`web/engine.js` lists what a game can provide, and `tests/games.test.mjs`
shows how each game's rules are tested.

## Sending a pull request

1. Branch from `main`. One change per pull request is easiest to look at.
2. Run `python -m tests`.
3. If a player would notice the change, add one plain-English line to
   `"unreleased"` in `release.json`. That is what the desktop app shows people
   when it offers them the next version.
4. Say in the pull request what it changes, why, and how you tried it: in
   simulation only, or with real cameras (which, and how many).

Before posting pictures, logs or files anywhere public:

- **`config.json` holds secrets** once a server is paired or sharing: the
  tokens under `"link"` and `"share"`. Remove them before pasting it.
- **Camera pictures show your room.** Check nothing and nobody is in them that
  you'd rather keep to yourself.

## Licence

Darts S.A.M is under the [GNU AGPL v3.0](LICENSE) with the extra terms in
[NOTICE](NOTICE). By sending a pull request you agree your contribution is
released under the same licence.
