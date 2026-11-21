# Phone camera scoring: design

2026-11-21. Status: draft for Sam's approval.

## Why

Auto-scoring today needs two or three USB webcams and a computer running the
desktop app by the board. That is too much for most people. Sam wants anyone to
get auto-scoring with the phone they already have: open the site, prop the
phone up facing the board, play. No computer, no third-party app.

## What it is

On app.dartssam.co.uk (or a home server reached over https), a phone can
**use its own camera to score**. The phone finds the board, watches for each
dart, scores it, and moves on when the darts are pulled, all inside the
browser. The phone is also the scoreboard.

One camera can't cross lines, so it will be wrong more often than three
webcams: on the saved reports, one webcam alone got the exact bed about 20
times in 28. So every dart carries **a probability**, and when the phone is
unsure it **asks the player** instead of guessing silently.

## Goals

- Score a dart from one phone camera in the browser, with no install beyond the
  site itself (which already installs to the home screen).
- Give each dart a probability for the bed it was scored in, and the next
  likeliest beds.
- When the probability is low, ask: show the two or three likeliest beds as
  buttons, plus "somewhere else" (tap the board). When it is high, score it and
  move on, with the dart still tappable to put right.
- Find the board with the existing method (red/green rings, one tap on the 20),
  on the phone's own picture.
- Keep every correction, so the probabilities and detection can be tuned on
  real phone throws later.

## Non-goals (for now)

- Several phones together (crossing lines from two phones). The design should
  not rule it out, but it is not built now.
- A phone camera feeding the desktop app or a home server's cameras.
- Showing the "which bed?" question on a different device from the phone.
- Spotting that the phone has been knocked; the player calibrates again.

## Anti-goals

- Silent wrong scores. A confident wrong score is worse than a question.
- Asking so often it is slower than tapping the score in. If that happens on
  real throws, the ask threshold or detection needs changing before release.
- Sending pictures off the phone. Everything is worked out on the device.
  (Problem reports stay as they are: only when the player says so.)
- A second copy of the vision code that drifts from the first.

## Constraints

- Phone browsers only give a page the camera over **https** (or localhost).
  The hosted site is https; a plain-http home server is not, so this is a
  hosted-site feature in practice.
- The hosted server has no OpenCV and must stay that way; all vision runs on
  the phone.
- Must work on recent iPhone Safari and Android Chrome.
- The phone must not sleep while scoring (Screen Wake Lock API).
- No framework, no build step in `web/` (see docs/architecture.md).

## Approaches considered

1. **The phone scores in the browser** (chosen by Sam). No computer, no
   network beyond loading the site. Weak point: one camera.
2. Phone streams to the paired home computer through the site. Reuses
   everything and allows several phones, but still needs the computer and
   sends video through the Google Cloud VM.
3. Phone guesses, player confirms every dart. Folded into 1 as "ask when
   unsure" rather than asking every time.

### Within 1: how the vision code gets to the browser (Claude's call)

- **Run the existing Python in the browser with Pyodide** (chosen). Pyodide
  ships NumPy and OpenCV for the browser. `board.py`, `calib.py`,
  `autocalib.py`, `detect.py` and `tracker.py` run unchanged or near it, the
  tests in `tests/test_vision.py` keep covering them, and `server.replay` works
  on phone reports. Cost: a large first download (tens of MB, then cached by
  the service worker) and a few seconds to start.
- Port to JavaScript with OpenCV.js. Lighter and faster to start, but about
  1,100 lines rewritten and two copies of every rule to keep in step. Rejected
  for the drift.
- Hand-written JavaScript with no OpenCV. Even more to write. Rejected.

If Pyodide turns out too slow or too big on a mid-range phone (first task
measures this), fall back to OpenCV.js for the hot path only (`diff_mask`,
motion check) and keep Python for calibration.

## How it works

### Turning it on

Menu → **Cameras** on the hosted site gains **Use this phone's camera**. It
asks for the camera (back camera, `facingMode: environment`), loads the vision
code (with a progress bar the first time), and shows the live picture.

Guidance on that screen: stand the phone to one side of the board, roughly
level with it and at about 45°, with the whole board in the picture. A straight
front-on view hides the tip behind the flight.

### Finding the board

The same as a webcam: darts out, tap **Find the board**, tap the 20 once.
`autocalib.detect` runs on a still frame. The calibration is kept on the
device (local storage, and in the account's settings so it survives a reload)
keyed as this phone's camera. If finding fails, the screen says why, as the
webcam screen does now.

### Watching

A loop grabs a frame from the `<video>` about 5–10 times a second (whatever the
phone manages), shrinks it as `tracker._small` does, and hands it to
`Tracker.update`. Tracker events (`dart`, `takeout`, `removed`) go into the
same handler the `/ws` messages use in `web/app.js` (`connect()`'s
`onmessage`), so games, bull-off, bot turns and undo need no changes.
That handler is split out into a function both sources call.

With one camera, the tracker's "more than one camera must see it" check cannot
apply; for a phone-only setup it is replaced by stricter single-camera checks
(the change must add to what differs from the empty board, and must be
dart-shaped). The other checks stay.

Scoring pauses while the screen is not showing a game, and while the
"which bed?" question is open.

### The probability

Today a single camera's position comes with a flat confidence of 0.3. The
new figure is a probability for each bed:

- The tip position from one camera is uncertain mostly **along** the dart's
  line (where along it the tip really is) and less **across** it. Model it as
  a spread of positions on the board: a Gaussian with a longer axis along the
  dart's line. Starting widths: about 6 mm along, 2.5 mm across (tuned later
  from corrections).
- Widen the spread when the dart was hard to see: few pixels, pieces that
  don't line up well, the camera's view of that area being very slanted
  (pixels per mm from the calibration).
- Add up the spread inside each bed (sample a few hundred points through
  `board.score`). The result: e.g. `T20 71%, 20 24%, T5 3%`.

This lives in Python next to `detect.locate` (e.g. `detect.bed_odds(line, H)`),
so it is tested on drawn pictures like the rest, and later could use two
cameras' lines too.

The dart event gains `odds: [{seg, mult, p}, ...]` (likeliest first, top three)
and `confidence` becomes the top bed's `p`.

### Asking

- Top bed at or above the threshold (start at 80%; a setting, not exposed in
  the UI at first): score it. The dart's mark on the board shows its
  percentage faintly; tapping the dart opens the same question.
- Below the threshold: the dart is drawn where the phone thinks it is, and a
  panel asks **"Which bed?"** with the top beds as large buttons
  ("T20 · 71%", "20 · 24%") and **Somewhere else** (tap the board, as manual
  scoring does). The answer is pushed as the dart; the tracker carries on.
- If the next dart lands while the question is open, the question stays: the
  first dart must be settled first. (Darts are in order in the log.)
- With sound on, `voice.js` says "Treble twenty or twenty?" when it asks.

### Keeping corrections

Each dart from the phone records what the phone said, its odds, and what the
player chose (a correction or an accepted guess), using the existing
"camera dart put right by hand" notes (`/api/...` in host.py, `track.js`).
Problem reports (`report.py`'s format) can be made from the phone too, with
the before/after frames, only when the player taps Report, so `server.replay`
runs on phone throws.

## Where things go

- `web/phonecam.js` (new): camera, frame loop, wake lock, loading Pyodide and
  the Python files, calling the tracker, emitting events.
- `web/app.js`: the camera choice on the Cameras screen, the "Which bed?"
  panel, the shared event handler, the status line ("Auto-scoring · phone").
- `server/detect.py`, `server/tracker.py`: the odds and the single-camera
  mode. They must keep running under ordinary Python for the desktop app.
- `web/sw.js`: cache the Pyodide files and Python sources for offline use.
- Pyodide served from the site itself (not a CDN), so it works offline and
  sends nothing to a third party. `server/host.py` must serve `.wasm` with the
  right type and allow it in any content-security rules.
- Tests: `tests/test_vision.py` gains single-camera odds on drawn pictures;
  a Node test for the "which bed?" flow logic where it is separable.
- `release.json` "unreleased": a player-facing line.
- `docs/setup.md` and `docs/using.md`: replace the "IP-webcam app" section.

## Left to the builder

- Exact frame rate and picture size for the phone loop (balance battery,
  heat and lag; measure on a mid-range Android and an iPhone).
- How the Python files are bundled for Pyodide (fetched as files or one zip).
- Where exactly in the Cameras screen and the game screen the new parts sit,
  following the conventions in the "UI genuine" notes (plain pages, fixed type
  sizes, no decorative extras).
- The sample count and the exact widening rules for the odds, as long as they
  are tested and in one place to tune.

## First task: measure before building the rest

Load Pyodide with NumPy and OpenCV on a phone, run `autocalib.detect` on one
frame and `tracker.update` on a stream, and record: download size, start time,
time per frame. If start is over ~15 s or a frame over ~200 ms on a mid-range
phone, stop and take the OpenCV.js fallback above back to Sam.
