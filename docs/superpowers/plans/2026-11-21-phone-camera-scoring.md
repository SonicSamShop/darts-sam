# Phone Camera Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone scores darts with its own camera inside the browser, gives each dart odds per bed, and asks the player when it is unsure.

**Architecture:** The existing Python vision (`board`, `calib`, `autocalib`, `detect`, `tracker`) runs unchanged in a Web Worker under Pyodide. A small Python glue module (`server/phonevision.py`) takes RGBA frames and returns the same events `/ws` sends today, plus `odds`. `web/phonecam.js` owns the camera and the worker; `web/app.js` feeds its events into the same handler as `/ws` and shows "Which bed?" when the top bed is under 80%.

**Tech Stack:** Pyodide 314.0.7 (Python 3.14, NumPy 2.4.6, opencv-python 4.11.0.86), getUserMedia, Web Worker, Screen Wake Lock; plain JS modules, no build step.

**Spec:** `docs/superpowers/specs/2026-11-21-phone-camera-scoring-design.md`

## Global Constraints

- Pyodide pinned at **314.0.7** (314.0.8 is under two weeks old). Served from the site itself, never a CDN at run time.
- Pyodide files are not committed: `tools/fetch_pyodide.py` downloads them into `web/vision/pyodide/` (git-ignored) and checks sha256 hashes pinned in the tool.
- The hosted server keeps running without OpenCV (`requirements-host.txt` unchanged). It only serves the `.py` files as text.
- One copy of the vision code: the worker loads `server/*.py` as served files; nothing is ported to JS.
- Ask threshold **0.8**; starting spread **6 mm along** the dart line, **2.5 mm across**.
- No pictures leave the phone except through an explicit Report.
- `web/` stays framework-free with no build step. UI follows the "genuine, not AI-looking" conventions (plain, fixed type sizes).
- Add a player-facing line to `release.json` "unreleased".

## Review Focus

- The phone gets knocked or slides: every dart lands wrong. Expect: the picture no longer matching the calibration is noticed (board edge check fails) and the player is told to find the board again. (Task 6 test.)
- Camera permission refused, or no back camera: a plain message and tap scoring carries on. (Task 5 test.)
- The page goes to the background or the screen locks: the camera stops; on return the tracker restarts from a fresh empty-board picture rather than scoring the difference. (Task 5 test.)
- Autofocus or auto-exposure hunting keeps the picture "moving" forever: nothing scores and nothing says why. Expect: lock exposure/focus where the browser allows, and show "Picture won't settle" after 10 s of constant motion. (Task 5 test.)
- A second dart lands while "Which bed?" is open: the first must be settled first, then the second is asked or scored in order. (Task 7 test.)

---

### Task 1: Measure Pyodide on a phone (gate)

Throwaway; nothing committed except the result in this plan.

**Files:** scratchpad only: `spike/index.html`, `spike/run.mjs`.

- [ ] **Step 1:** Page that loads Pyodide 314.0.7 + numpy + opencv-python from local files, writes `server/{board,calib,autocalib,detect,tracker}.py` into its file system, runs `autocalib.detect` on `docs/img/calibration/real.jpg` (with `twenty_px=(530,183)`), then 30 calls of `Tracker.update` on 1280×720 frames, and shows: download bytes, start time, calibration time, mean ms per frame.
- [ ] **Step 2:** Run it in desktop Chrome headless; then serve it on the LAN and open it on Sam's phone.
- [ ] **Step 3:** Gate: start ≤ 15 s and frame ≤ 200 ms on the phone → carry on. Otherwise stop and take the OpenCV.js fallback to Sam.

### Task 2: Odds per bed

**Files:**
- Modify: `server/detect.py` (add after `locate`)
- Test: `tests/test_vision.py`

**Interfaces:**
- Produces: `detect.bed_odds(line: DartLine, view: calib.View | np.ndarray, along: float = 6.0, across: float = 2.5) -> list[dict]` returning up to three `{"seg": int, "mult": int, "p": float}`, likeliest first, `p` rounded to 2 places.

- [ ] **Step 1: Failing tests** in `tests/test_vision.py`, using a bare identity-scaled homography (1 px = 1 mm) and hand-built `DartLine`s:

```python
def test_odds_middle_of_bed():
    ln = detect.DartLine(point=np.array([0, 60.0]), direction=np.array([0, 1.0]), tip=np.array([0, 60.0]), area=900)
    odds = detect.bed_odds(ln, np.eye(3))
    assert odds[0] == {"seg": 20, "mult": 1, "p": odds[0]["p"]} and odds[0]["p"] >= 0.97

def test_odds_on_treble_wire():
    ln = detect.DartLine(point=np.array([0, 99.0]), direction=np.array([0, 1.0]), tip=np.array([0, 99.0]), area=900)
    odds = detect.bed_odds(ln, np.eye(3))
    assert {(o["seg"], o["mult"]) for o in odds[:2]} == {(20, 1), (20, 3)}
    assert all(o["p"] > 0.25 for o in odds[:2]) and sum(o["p"] for o in odds) <= 1.0

def test_odds_spread_is_along_the_line():
    # Tip 3 mm inside the treble, line running across the ring: along-line spread
    # crosses the wire; a line running round the ring would not.
    radial = detect.DartLine(point=np.array([0, 102.0]), direction=np.array([0, 1.0]), tip=np.array([0, 102.0]), area=900)
    round_ = detect.DartLine(point=np.array([0, 102.0]), direction=np.array([1.0, 0]), tip=np.array([0, 102.0]), area=900)
    assert detect.bed_odds(radial, np.eye(3))[0]["p"] < detect.bed_odds(round_, np.eye(3))[0]["p"]

def test_odds_are_repeatable():
    ln = detect.DartLine(point=np.array([10, 100.0]), direction=np.array([0.1, 0.995]), tip=np.array([10, 100.0]), area=900)
    assert detect.bed_odds(ln, np.eye(3)) == detect.bed_odds(ln, np.eye(3))
```

Add all four to `main()`'s list of tests the way the existing ones are run.

- [ ] **Step 2:** `python -m tests.test_vision` → fails with `AttributeError: bed_odds`.
- [ ] **Step 3: Implement.** Deterministic quadrature, no randomness: a fixed 21×21 grid over ±3σ in (along, across) coordinates, weighted by the Gaussian, each point scored with `board.score`, weights summed per `(seg, mult)` and normalised. Widen both σ by `k = max(1.0, mm_per_px / 0.6)`, where `mm_per_px` is the distance in mm between `view.to_board(tip_px)` and `view.to_board(tip_px + (1, 0))` (use k = 1 when `line.tip_px is None`), and by a further ×1.5 when `line.area < 2 * MIN_DART_AREA`. Constants at the top of the file: `ODDS_ALONG_MM = 6.0`, `ODDS_ACROSS_MM = 2.5`, `ODDS_REF_MM_PER_PX = 0.6`.
- [ ] **Step 4:** `python -m tests.test_vision` → all pass, existing trials unchanged.
- [ ] **Step 5:** Commit `feat: odds per bed for a single camera's dart`.

### Task 3: Tracker gives odds with one camera

**Files:**
- Modify: `server/tracker.py` (the dart event at the end of `update`)
- Test: `tests/test_vision.py`

**Interfaces:**
- Consumes: `detect.bed_odds` (Task 2).
- Produces: with exactly one line, the dart event gains `"odds": [...]` and `"confidence"` becomes `odds[0]["p"]`; `seg`/`mult` stay `board.score(x, y)` of the tip. Multi-camera events are unchanged.

- [ ] **Step 1: Failing test** `test_single_camera_odds`: build one camera with `make_camera(30)`, a `Tracker({0: H})`, feed the empty board `STABLE_FRAMES + 1` times, then a frame with `dart_at(0, 60)`; assert one event, `"odds" in ev`, `ev["confidence"] == ev["odds"][0]["p"]`, `(ev["odds"][0]["seg"], ev["odds"][0]["mult"]) == (ev["seg"], ev["mult"])`. Also assert a 3-camera event has no `"odds"` key.
- [ ] **Step 2:** Run → fails (`KeyError: 'odds'`).
- [ ] **Step 3:** Implement in `update`: when `len(lines) == 1`, `odds = detect.bed_odds(lines[0], self.H[cam])` for that camera; set `confidence` and `odds`.
- [ ] **Step 4:** `python -m tests` → pass.
- [ ] **Step 5:** Commit `feat: single-camera darts carry their odds`.

### Task 4: Python glue for the phone

**Files:**
- Create: `server/phonevision.py`
- Test: `tests/test_phonevision.py`

**Interfaces:**
- Produces (all JSON-able, called from the worker):
  - `calibrate(rgba: bytes, w: int, h: int, twenty: tuple[float, float] | None) -> dict` → `{"ok": True, "calibration": <saved form as config.json keeps it: {"points", "lens", "size"}>}` or `{"ok": False, "reason": str}` (from `autocalib.Failed`).
  - `start(calibration: dict) -> None` — makes a fresh `Tracker({"phone": calib.view(calibration)})`.
  - `feed(rgba: bytes, w: int, h: int) -> list[dict]` — tracker events; `[]` before `start`.
  - `restart() -> None` — `tracker.reset()` (used after the page was hidden).
  - `still_matches(rgba: bytes, w: int, h: int) -> bool` — `autocalib._edge_misfit` of this frame against the calibration is under `MAX_RMS_PX * 2`; used to spot a knocked phone.
- Imports only `numpy`, `cv2` and sibling modules, so it runs both in Pyodide and in plain Python.

- [ ] **Step 1: Failing tests** in `tests/test_phonevision.py` (program style like the other `tests/test_*.py`, added to `tests/__main__.py` if that lists them): reuse `tests.test_vision`'s `make_camera`, `render`, `board_texture` to draw a 1280×720 single-camera picture, convert to RGBA bytes; then:
  - `calibrate` on the empty board returns `ok` and its `size == [1280, 720]`;
  - `start` + `feed` the empty board 5×, then the board with `dart_at(0, 60)` 5× → exactly one `dart` event with `seg == 20` and an `odds` list;
  - `feed` before `start` returns `[]`;
  - `still_matches` is true for the calibrated view and false for the same picture shifted 40 px.
- [ ] **Step 2:** `python -m tests.test_phonevision` → fails (no module).
- [ ] **Step 3:** Implement; RGBA → BGR with `cv2.cvtColor(..., cv2.COLOR_RGBA2BGR)` on `np.frombuffer(rgba, np.uint8).reshape(h, w, 4)`.
- [ ] **Step 4:** Tests pass; `python -m tests` passes.
- [ ] **Step 5:** Commit `feat: phonevision, the vision calls a phone makes`.

### Task 5: Pyodide served by the site, the worker, the camera

**Files:**
- Create: `tools/fetch_pyodide.py`, `web/vision-worker.js`, `web/phonecam.js`
- Modify: `.gitignore` (`web/vision/pyodide/`), `server/host.py` and `server/app.py` (route `/vision/py/<name>.py`), `docs/hosting.md` (run the fetch tool on deploy)
- Test: `tests/test_host.py`, `tests/phonecam.test.mjs`

**Interfaces:**
- `python -m tools.fetch_pyodide [--dest web/vision/pyodide]`: downloads `pyodide.mjs`, `pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json`, the numpy and opencv-python wheels for 314.0.7; verifies each against a `HASHES` dict in the tool; skips files already present with the right hash.
- `GET /vision/py/{name}.py` on both servers: serves only names in `VISION_FILES = ("board", "calib", "autocalib", "detect", "tracker", "phonevision")` from `server/`, `text/plain`, 404 otherwise. `.wasm` served as `application/wasm`, `.mjs` as `text/javascript` (register with `mimetypes.add_type`).
- Worker messages in: `{cmd: "load"}`, `{cmd: "calibrate", frame, w, h, twenty}`, `{cmd: "start", calibration}`, `{cmd: "frame", frame, w, h}`, `{cmd: "restart"}`, `{cmd: "check", frame, w, h}`. Out: `{type: "progress", loaded, total}`, `{type: "ready"}`, `{type: "calibrated", result}`, `{type: "events", events}`, `{type: "checked", ok}`, `{type: "error", message}`. Frames are transferred `ArrayBuffer`s of RGBA.
- `web/phonecam.js` exports `createPhoneCam({ onEvent, onStatus }) -> { open(videoEl): Promise<void>, calibrate(twentyXY): Promise<result>, start(calibration), stop(), supported(): boolean }`. `onStatus` receives one of `"loading" | "no-camera" | "denied" | "watching" | "unsettled" | "knocked" | "stopped"`.
- Frame loop: draw `<video>` into a canvas at 1280 px wide (height to aspect), send one frame, wait for the reply before the next (never more than one in flight); target at most 8 fps.
- `visibilitychange` hidden → pause loop and release wake lock; visible → `restart`, re-acquire wake lock.
- Every 60 s while no dart is on the board, send `check`; `ok: false` → status `knocked` and stop scoring.
- Constant motion: `phonevision.feed` returns `[{"type": "still"}]` when the tracker reached `STABLE_FRAMES` with nothing else to say (app.js ignores it). `phonecam.js` records the time of the last `still` or real event; `settleState(nowMs, lastStillMs) -> "watching" | "unsettled"` (exported, pure) turns `unsettled` after 10 000 ms without one.

- [ ] **Step 1: Failing tests.** `tests/test_host.py`: `/vision/py/detect.py` is 200 and contains `def find_dart`; `/vision/py/app.py` is 404; `/vision/py/../host.py` is 404. `tests/phonecam.test.mjs`: `settleState(10_001, 0) === "unsettled"`, `settleState(9_000, 0) === "watching"`; `supported()` false when `navigator.mediaDevices` is missing.
- [ ] **Step 2:** Run `python -m tests` → those fail.
- [ ] **Step 3:** Implement tool, routes, worker, phonecam. Add `"still"` to `phonevision.feed` (Task 4's module) and a test for it there.
- [ ] **Step 4:** `python -m tests` passes. Run `python -m tools.fetch_pyodide`, start `python -m server.app`, open `http://localhost:8000` in desktop Chrome, check in the console that `createPhoneCam` reaches `ready` with the webcam.
- [ ] **Step 5:** Commit `feat: run the vision in the browser for a phone's camera`.

### Task 6: Cameras screen and events into the game

**Files:**
- Modify: `web/app.js` (`connect()` around line 379; `drawCameras`/`renderCameras` around line 2128; `refreshStatus` around line 395), `web/style.css`

**Interfaces:**
- Consumes: `createPhoneCam` (Task 5).
- Produces: `onBoardEvent(ev)` in `app.js` — the body of today's `ws.onmessage` after the `hello` branch, called by both `/ws` and the phone. Phone calibration kept under settings key `phonecam` (`{calibration, savedAt}`) through the existing settings sync, and in local storage.

- [ ] **Step 1:** Split `onBoardEvent` out of `connect()`; `/ws` behaviour unchanged (existing Node tests still pass).
- [ ] **Step 2:** Cameras screen, when `createPhoneCam().supported()`: a **Use this phone's camera** button. Pressed: live picture, the placement hint ("Stand the phone to one side of the board, about level with it, with the whole board in view."), **Find the board**, then "Tap the 20" on the picture → `calibrate`. Failure shows the reason as the webcam screen does. Success saves `phonecam` and starts watching.
- [ ] **Step 3:** Status line: `Auto-scoring · phone` while watching; `Phone camera · find the board again` on `knocked`; `Phone camera · picture won't settle` on `unsettled`.
- [ ] **Step 4:** Manual check on desktop Chrome with the webcam pointed at a printed or on-screen board: find the board, throw (or place) a dart, see it scored in a game.
- [ ] **Step 5:** `python -m tests` passes; commit `feat: score with this phone's camera`.

### Task 7: "Which bed?" and keeping corrections

**Files:**
- Create: `web/ask.js`
- Modify: `web/app.js`, `web/voice.js`, `web/style.css`
- Test: `tests/ask.test.mjs`

**Interfaces:**
- `ask.js` exports `ASK_BELOW = 0.8`; `needsAsk(ev) -> boolean` (true when `ev.odds` exists and `ev.odds[0].p < ASK_BELOW`); `choices(ev) -> [{seg, mult, label, pct}]` (top beds with `p ≥ 0.05`, label like `T20`, `20`, `D20`, `Bull`, `25`, `Miss`; pct as integer); `createQueue() -> { add(ev), current(), settle(choice), size() }` holding darts in order so a second dart waits behind an open question.
- Push into the match: `{t: 'dart', seg, mult, x, y, src: 'cam', p}` where `p` is the chosen bed's probability (or `null` when "somewhere else"); a correction sends the existing "camera dart put right by hand" note via `track.js` with `{said: {seg, mult, p}, chose: {seg, mult}}`.

- [ ] **Step 1: Failing tests** in `tests/ask.test.mjs`: `needsAsk` false at 0.80, true at 0.79, false with no `odds`; `choices` of `[{20,3,.71},{20,1,.25},{5,3,.03}]` → labels `["T20","20"]`, pcts `[71,25]`; queue: add A (asks), add B → `current()` is A and `size() === 2`; `settle` → `current()` is B.
- [ ] **Step 2:** `python -m tests` → fails (no module).
- [ ] **Step 3:** Implement `ask.js`; in `app.js`, phone dart events go through the queue: high odds push at once; low odds open the panel ("Which bed?", a button per choice, **Somewhere else** → tap the board as manual scoring does). A pushed phone dart's mark shows its percentage faintly; tapping a camera dart opens the same panel to change it (undo + push). `voice.js`: when asking with sound on, say "<first> or <second>?" in words (e.g. "Treble twenty or twenty?").
- [ ] **Step 4:** Tests pass. Manual: in a game, a dart near a wire asks; choosing records it; a dart thrown while asking waits.
- [ ] **Step 5:** Commit `feat: ask which bed when the phone is unsure`.

### Task 8: Offline copy, docs, release note

**Files:**
- Modify: `web/sw.js`, `web/phonecam.js`, `docs/setup.md` (replace "A phone as a camera"), `docs/using.md`, `docs/detection.md` (odds section), `README.md` (one line under "Scores by camera"), `release.json`

- [ ] **Step 1:** `sw.js`: a separate cache `dartssam-vision-314.0.7`, never deleted by `activate`'s clean-up while its name is current; filled by `phonecam.js` posting `{cacheVision: [...urls]}` after the first successful load (not at install, so people who never use the camera don't download 19 MB). Bump `CACHE`.
- [ ] **Step 2:** Docs and `release.json` "unreleased": "Score with your phone's camera: stand it beside the board and it scores each dart, and asks when it isn't sure."
- [ ] **Step 3:** `python -m tests` passes; manual: load once online, go offline, reload, phone camera still starts.
- [ ] **Step 4:** Commit `docs: phone camera scoring`.

### Task 9: Report from the phone

**Files:**
- Modify: `server/phonevision.py` (`report() -> dict` with the tracker's history as base64 PNG frames in `report.py`'s layout), `web/app.js` (the game's Report uses it when the phone is the camera), `server/host.py` only if the report upload needs the frames accepted from the browser
- Test: `tests/test_phonevision.py`

- [ ] **Step 1: Failing test:** after one scored dart, `report()` has one look with `before`/`after` pictures for camera `"phone"` and the event; writing it with `report.py`'s writer to a temp folder and running `replay.replay` on it prints the same bed.
- [ ] **Step 2–4:** Implement, pass, manual Report from a phone game reaches the site's reports.
- [ ] **Step 5:** Commit `feat: problem reports from the phone camera`.
