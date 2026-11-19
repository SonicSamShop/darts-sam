# How a dart is found

Once each camera knows where the board is ([calibration.md](calibration.md)),
scoring a dart is the same idea the commercial systems use:

1. Wait until the picture is still, then compare it with the previous still
   picture.
2. What changed is the new dart. Fit a line along it.
3. Lay that line on the board using the camera's calibration. The dart's tip
   touches the board, so the tip is somewhere on that line.
4. Lines from two or three cameras cross at the tip: that is the segment and
   whether it is a single, double or treble.
5. When the picture goes back to matching the empty board, the darts have been
   pulled out, which moves the game on to the next player.

The code is [`server/detect.py`](../server/detect.py) (one picture: find the
dart, cross the lines) and [`server/tracker.py`](../server/tracker.py) (a
stream of pictures: what happened). Neither touches a camera or the network,
so both are tested on drawn pictures (`python -m tests.test_vision`).

## Step by step

**Is anything moving?** Each camera's picture is shrunk and compared with the
one before. While more than a sliver of it is changing (a hand, a dart in
flight, the board shaking), nothing is looked at. After three still pictures
in a row, it looks.

**What changed?** The still picture is compared with the reference: the still
picture from before the dart. Pixels that differ make a mask
(`detect.diff_mask`). If more than 12% of a picture changed, that is no dart
but someone standing in view or the lights changing, and it is left alone.

**Is there a dart in it?** (`detect.find_dart`) A dart rarely shows up in one
piece: wires, glare on the barrel and the thin point split it, and the flight
is far bigger than the rest. So every piece that isn't speckle is kept, if it
lies along the same line as the biggest piece and within a dart's length of
it; the dart's shadow, off to one side, is dropped. The line is fitted through
the middle of the dart's width all the way along, so the lumpy flight doesn't
pull it about. The lens's bend is taken out first, so a straight dart is a
straight line.

**Which end is the tip?** The end nearer the camera. The dart sticks out of
the board, so seen from the camera its flight lands further away on the board
than its point does.

**A dart added, or darts pulled out?** The tracker keeps a picture of the
empty board and measures how much of the board now differs from it. Less than
before means something came out: everything (a **takeout**), or one dart that
fell or was pulled (**removed**). More means something went in.

**Is it really a dart?** Three checks, each there because of a dart scored out
of thin air:

- More than one camera must see it. A change in a single camera is the camera
  or board still shaking from the last dart, a shadow, or a hand leaving.
- It must add to what differs from the empty board. A dart sagging in the
  board, or a wire glinting, changes the pictures without adding anything.
- The position must be near where at least one camera saw a tip. Lines through
  scraps cross anywhere.

**Where is it?** (`detect.locate`) The point nearest all the cameras' lines.
With three lines that don't agree, each camera is left out in turn and the
best pair kept. Each result carries a confidence: 0.95 from three cameras that
agree, 0.8 from two, lower when a camera had to be left out or the lines only
roughly cross. With a single camera running there are no lines to cross, and
the position is that camera's own guess at the tip (0.3).

The tracker then says what happened, and the server passes it to every open
app over a WebSocket (`/ws`):

```json
{"type": "dart", "x": 0.4, "y": 103.2, "seg": 20, "mult": 3, "confidence": 0.95, "cameras": 3}
{"type": "takeout"}
{"type": "removed"}
```

`x` and `y` are millimetres from the bull, `x` to the right and `y` up.

To see the app react without a camera, send a dart yourself while a game is
on its screen:

```bash
curl -X POST localhost:8000/api/simulate -H 'Content-Type: application/json' -d '{"x":0,"y":103}'
```

## When a dart is scored wrongly

Tap **Report** in the game's top bar straight away, before pulling the darts.
The server saves a folder in `data/reports/` with the cameras' pictures from
the last four times the board changed (before and after each), what each
camera made of them, what was scored and why, and the board as it is now. The
app then shows each camera's picture marked up (what changed, the board as
calibrated, the dart's line and tip, the scored position) and asks what the
dart should have been. [`server/report.py`](../server/report.py) lists what is
in the folder.

```bash
python -m server.replay        # run today's detection over every saved report
```

That prints, for each reported dart, what was scored then, what the code
scores now and what you said it should have been, so a change to `detect.py`
can be checked against the darts that went wrong. A report is about 20-35 MB
(the pictures are kept exact); delete the folders you no longer need.

## Tuning

These depend on your lighting and your cameras' exposure. Every report records
the values it was made with (all but the first here).

| Name | Value | What it is |
|---|---|---|
| `detect.diff_mask(thresh=…)` | 28 | How much a pixel must change (grey, out of 255) to count as changed. |
| `detect.MIN_DART_AREA` | 150 px | Fewer changed pixels than this is noise, not a dart. |
| `detect.MAX_DART_FRACTION` | 0.12 | More of the picture than this changing is a hand or a body. |
| `detect.MIN_PART_AREA` | 30 px | A piece of the dart smaller than this is speckle. |
| `detect.MAX_OFF_AXIS` | 14 px | A piece further than this from the dart's line isn't part of it. |
| `detect.MAX_DART_LENGTH` | 0.25 | Of the picture's width: pieces further apart than this aren't one dart. |
| `tracker.MOTION_FRACTION` | 0.0015 | More of the (shrunk) picture than this changing between frames is movement. |
| `tracker.STABLE_FRAMES` | 3 | Still pictures needed before looking for a dart. |
| `tracker.STUCK_FRAMES` | 90 | A big change that stays this long is taken as the new empty board. |
| `tracker.MAX_TIP_GAP` | 40 mm | A position further than this from every camera's own tip is no dart. |

The cameras' picture size and rate (`"width"`, `"height"`, `"fps"`: 1280, 720
and 15) are in `config.json`.

## How good is it

In simulation (`python -m tests.test_vision`: three drawn cameras on the ring,
darts leaning at random): 120 darts thrown, all found, all in the right
segment, 0.4 mm from the truth on average, and all 40 takeouts seen. The same
test covers the cases that went wrong on real boards: a dart in pieces, a
camera shaking, a dart that sags, glints, a lens that bends the picture.

On real cameras it works but is not yet as good as that: wires, shadows and
flights still fool it now and then, which is what **Report** and
`server.replay` are for. What it doesn't do yet:

- A dart only one camera can see (hidden behind earlier darts from the others)
  is not scored: enter it by tapping the board.
- Bounce-outs are not detected (press Miss).

Reports with the pictures and the right answer are the most useful thing to
send: see [CONTRIBUTING.md](../CONTRIBUTING.md).
