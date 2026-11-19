# Darts S.A.M (home build)

Automatic dart scoring with three cheap USB cameras, a Raspberry Pi and an iPad.

```
3 USB cameras ──► Raspberry Pi (server/)  ──Wi-Fi──►  iPad (web/, runs in Safari)
                  finds each dart, works               scoreboard, games,
                  out the segment                      tap-to-score fallback
```

The iPad app is a web app served by the Pi. You open it in Safari and "Add to
Home Screen"; it then launches full-screen like a native app. No Mac, Xcode or
Apple developer account needed, and updating it is just editing files on the Pi.

## 1. Hardware

| Part | What to search for | Notes |
|---|---|---|
| 3 × camera | "OV9732 USB camera module 100 degree" | 720p, MJPEG, manual-focus lens. The de-facto standard for DIY dart scoring. Get the 100° "no distortion" lens, not the fisheye. |
| Computer | Raspberry Pi 4 (2 GB+) or Pi 5 | One camera per USB port, no hub needed. |
| Mounts | "Target Corona Vision OV9732 mount" on MakerWorld / Cults3D | Printable clips made for your exact light ring exist. No printer: use a print service. |
| Power/SD | Official Pi PSU, 16 GB+ card | Under-powered Pis drop USB cameras. |

Placement:

- Three cameras spaced evenly (120° apart) around the Corona Vision ring, each
  aimed at the bull. The printable mounts set the angle for you.
- Each camera must see the **whole** board face including the full double ring.
- Turn each lens to focus on the board wires, then lock it with a dab of
  nail varnish or tape. Blurry wires = bad calibration.
- Route cables behind the surround so nothing moves in front of the cameras.

## 2. Raspberry Pi setup

```bash
sudo apt install -y python3-venv
```

```bash
cd dartssam && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python -m server.app
```

Then on the iPad open `http://raspberrypi.local:8000` (or the Pi's IP address),
tap Share → **Add to Home Screen**. The app shows a reminder bar with these
steps whenever it is opened in a browser tab instead of from the home screen.

The server has no sign-in, so it only answers to the names a home network uses:
an IP address, `localhost`, a name with no dots (`raspberrypi`), or one ending
`.local`, `.lan`, `.home`, `.home.arpa` or `.internal`. This stops web pages on
other sites from reaching it through your browser. If you reach it by some
other name (through a reverse proxy, say), list it in `config.json`:
`"hosts": ["darts.example.com"]`.

On an Android phone, open the same address in Chrome and use the menu **⋮ →
Add to Home screen**. Chrome only offers a one-tap **Install** button if the
page is served over https.

### Working offline (needs https)

The app is offline-first: once installed it opens and runs with no Pi and no
network (at the pub, or with the Pi switched off). Games, new players and
settings are saved on the device and sent to the Pi the next time it can be
reached; the top bar shows how many changes are waiting. Only the cameras and
calibration need the Pi.

Browsers only let a web app store itself on the device when it comes over
**https** (or from `localhost`). Plain `http://raspberrypi.local:8000` scores
and syncs fine while the app is open, but it cannot be *opened* without the Pi.
To serve https, give the server a certificate:

```bash
.venv/bin/python -m server.app --cert cert.pem --key key.pem
```

then use `https://raspberrypi.local:8000`. The certificate must be one the
iPad or phone trusts. For a home network the usual way is
[mkcert](https://github.com/FiloSottile/mkcert) on your laptop:
`mkcert raspberrypi.local` makes the two files to copy to the Pi, and
`mkcert -CAROOT` shows where its `rootCA.pem` is. Send that file to the iPad,
install it (Settings → General → VPN & Device Management) and switch it on
under Settings → General → About → Certificate Trust Settings. If you start
the server from `dartssam.service`, add the two options to `ExecStart` there.

What works offline: every game, tap and typed scoring, undo, adding, renaming
and removing players, settings and themes. Stats
come from the Pi, so offline you see them as they were at the last sync (the
screen says so), lists and scoresheets included; they catch up once the queued
games have been sent.

To start it automatically on boot, edit the paths in `dartssam.service`, then:

```bash
sudo cp dartssam.service /etc/systemd/system/ && sudo systemctl enable --now dartssam
```

### On Windows, without Python: DartsSAM.exe

For a Windows PC with the cameras plugged in there is one file to download and
double-click, `DartsSAM.exe`: the same server with Python and everything else
inside it. Darts S.A.M opens in a window of its own, with its icon on the
taskbar; closing the window stops it. It opens on **Cameras** until a camera is
lined up with the board, and on the menu after that. To use the cameras with the
hosted site, go to **Cameras → Connect to your account** there (see "Using your
cameras with the hosted site"). Double-clicking it again while it is running
brings that window to the front.

- Players, games, calibration and reports are kept in `%LOCALAPPDATA%\DartsSAM`
  (paste that into the Explorer address bar), so a newer `DartsSAM.exe` simply
  replaces the old one.
- The file is not signed, so the first time Windows says "Windows protected
  your PC": click **More info → Run anyway**.
- The window is drawn by Microsoft's WebView2, which Windows 11 has and
  Windows 10 nearly always has (it comes with Edge).
- `DartsSAM.log` in the same folder is what the server said since it was last
  started; the window's **Data** menu opens the folder.
- It takes the same options as `python -m server.app`, plus `--no-browser`
  (the server alone, with no window).

It is built on GitHub's Windows machines by `.github/workflows/windows.yml`,
which also runs the tests there and checks the built file's server starts;
download it from the run's **Artifacts**. After `pip install -r requirements.txt
-r requirements-windows.txt pyinstaller`, `python tools/build_exe.py` is the build itself
(it builds for whatever system it is run on). **Not yet tried:** real USB
cameras on Windows, and the file on a real Windows desktop.

### On a Mac, without Python: DartsSAM.app

For a Mac with the cameras plugged in there is a `.dmg` to download:
`DartsSAM-arm64.dmg` for a Mac with Apple silicon (M1 and later),
`DartsSAM-x86_64.dmg` for an Intel Mac. Open it, drag **DartsSAM** to
**Applications** and double-click it there. Darts S.A.M opens in a window of its
own, with its icon in the Dock, and macOS asks once whether it may use the
cameras. Closing the window (or **Quit**) stops it; the **Data** menu shows
the data folder.

- Players, games, calibration and reports are kept in
  `~/Library/Application Support/DartsSAM`, with `DartsSAM.log` (what the
  server said since it was last started), so a newer app simply replaces the
  old one.
- The app is not signed by Apple yet, so the first time macOS refuses to open
  it: go to **System Settings → Privacy & Security**, scroll down and click
  **Open Anyway**. Signing it needs an Apple Developer ID certificate;
  `tools/build_exe.py` says how to build with one.
- It takes the same options as `python -m server.app`, plus `--no-browser`
  (the server alone, with no window).

It is built on GitHub's Macs by `.github/workflows/mac.yml`, which also checks
the built app starts; download the `.dmg` from the run's **Artifacts**. On a
Mac, `pip install -r requirements.txt -r requirements-mac.txt pyinstaller`
then `python tools/build_exe.py` builds it for that Mac's chip. **Not yet
tried:** the Intel build, the GitHub workflow, a signed build, and the app on
a Mac other than the one it was built on.

### On Linux, without Python: DartsSAM-linux-x86_64.tar.gz

For a Linux PC (64-bit Intel or AMD) with the cameras plugged in there is a
`.tar.gz` to download. Unpack it, then in a terminal:

```bash
cd DartsSAM && ./install.sh
```

That puts **Darts S.A.M** in the app menu and `DartsSAM` in `~/.local/bin`,
with no sudo. Starting it opens a terminal window that says it is running and
opens its page in the browser; closing that window stops it.
`./install.sh --uninstall` takes it out again.

- Players, games, calibration and reports are kept in `~/.local/share/dartssam`,
  so installing a newer version simply replaces the program.
- It runs on Linux systems at least as new as Ubuntu 22.04 (the one GitHub
  builds it on): Mint 21, Debian 12, Fedora 36 and later.
- If the cameras can't be opened, `install.sh` says so: add yourself to the
  `video` group (`sudo usermod -aG video $USER`) and log out and back in.
- It takes the same options as `python -m server.app`, plus `--no-browser`.

It is built on GitHub by `.github/workflows/linux.yml`, which also checks the
program starts and that `install.sh` installs and uninstalls it; download it
from the run's **Artifacts**. On Linux, `pip install -r requirements.txt
pyinstaller` then `python tools/build_exe.py` builds it. A Raspberry Pi runs
it from the code instead (section 2). **Not yet tried:** real USB cameras with
the built program, and the program on a real Linux desktop.

## 3. Calibrate (once, and again if a camera gets knocked)

USB cameras are found by themselves, on a Pi, a Mac or Windows. A camera you
don't want used (a laptop's own webcam) can be switched off on the app's
**Cameras** screen, and a phone or other network camera is added there too, under
**Add a camera** (see Developing). On a Pi a camera that comes back under another
number after being replugged needs **Find the board again** pressed.

In the app: **Cameras**, from the menu. Take the darts out of the board, then for
each camera press **Find the board** (called Auto below). The Pi finds the board by its red and green rings
and fits the calibration to the 40 places where a red block meets a green one
(`server/autocalib.py`). The colours can't say which way up the board is, so a
camera that has never been calibrated asks for one rough tap anywhere in the
20; after that Auto needs no taps, so it is also the quick fix when a camera
gets knocked.

Green lines are then drawn over the picture: they should sit on top of the
real wires, with the green "20" inside the 20 segment. Auto reports how many
of the 40 points agreed and how far off they are in pixels; it refuses rather
than guess if it can't see enough of the rings.

If Auto can't manage (odd lighting, a board that isn't red and green), press
**Mark it by hand** instead and tap the four points where the outer double wire
crosses the wire between 20|1, 6|10, 3|19 and 11|14 (pinch to zoom in first).
Four taps are much less accurate than Auto: a tap a couple of pixels out
moves scores by several millimetres. Pressing Auto afterwards tidies it up.

With an empty board, press **Board is empty now** and start a game.

## 4. Players, history and stats

Players, settings, finished games and **every dart thrown** are saved on the Pi
in one database file, `data/dartssam.db` (SQLite, created on first run). The
app saves each change on the device first and then sends it to the Pi, so
nothing is lost if the Pi is unreachable (see "Working offline" above).

- **Players:** add them on the home screen, or under **Settings › Players**
  (where they are renamed and removed too), then tap who is playing in
  throwing order. Removing a player only hides them:
  their throws are kept, and adding the same name again brings them back.
- **Stats:** **Stats** has a page for all games together and one for
  each game type, with that game's own averages (X01 and Count Up: 3-dart
  average; Cricket: marks per round; Around the Clock: hit rate and darts to
  finish; 121 Checkout: checkout rate) and a heat map of where the darts
  landed on the board.
- **X01 in depth:** the X01 page has the figures the PDC publishes for its
  matches: three-dart and first-nine averages, 180s / 140+ / 100+ / 60+,
  checkout rate (checkouts per dart thrown at a double), highest and 100+
  checkouts, legs won with and against the throw, best leg and darts per leg.
  A match of several legs counts leg by leg.
- **Opening a figure up:** anything marked with a › can be tapped to see what
  it was counted from, and each line of that can be tapped again. **140+**
  lists every visit of 140 or more with when it was thrown, the darts and what
  it left; tapping one shows the whole leg's scoresheet with that visit
  marked. **Checkout rate** opens into each double (hit / darts at it) and
  then the visits behind it; the averages open into a list of legs; the darts
  figures into how often each number was hit; a line under **Games** into
  those games and their scoresheets, for every game type. Tap a column
  heading to sort by it. A visit typed in as one number has no single darts,
  so it counts towards scores and averages but not doubles or numbers hit.
- **Addresses and the back button:** every screen has an address, so the
  browser's or phone's back button goes back a screen and a reload stays where
  it was. A game's address is its kind and its id, `#/501/<id>` (X01 by its
  start score; `#/cricket/<id>` and so on for the others): the game itself
  while it is being played, its scoresheet once it is over. A game
  under **Stats** opens its scoresheet. The others are `#/`,
  `#/stats`, `#/cameras` and `#/settings`.
- **Match time:** a clock runs in the top bar from "Game on" to the winning
  dart. The time is saved with the finished game, and the stats show the
  average and quickest time for each game type.
- **Back it up** by copying the file to your laptop:

```bash
scp pi@raspberrypi.local:dartssam/data/dartssam.db dartssam-backup.db
```

When copying a new version of the code to the Pi, leave the Pi's data alone:

```bash
rsync -av --exclude .venv --exclude .git --exclude __pycache__ --exclude data --exclude config.json ./ pi@raspberrypi.local:dartssam/
```

If you have an older copy from when the app was called OmniSam or DartsOmni,
its `data/omnisam.db` (or `data/dartsomni.db`) is renamed to `data/dartssam.db`
the first time the new version starts, so nothing is lost.

The tables are described at the top of `server/db.py`. To look inside:
`sqlite3 data/dartssam.db` then, for example, `SELECT * FROM throws LIMIT 20;`.

## 5. How detection works

`server/detect.py` + `server/tracker.py`:

1. Wait until the picture is still, then diff it against the previous still picture.
2. The changed blob is the new dart; fit a line along it.
3. Project that line onto the board using the camera's calibration. The dart's
   tip is somewhere on that line.
4. Lines from two or three cameras cross at the tip → segment and multiplier.
5. When the picture goes back to matching the empty board, that's a takeout,
   which moves the game on to the next player.

### When a dart is scored wrongly

Tap **Report** in the game's top bar straight away, before pulling the darts.
The Pi saves a folder in `data/reports/` with the cameras' pictures from the
last four times the board changed (before and after each), what each camera
made of them, what was scored and why, and the board as it is now. The app
then shows each camera's picture marked up (what changed, the board as
calibrated, the dart's line and tip, the scored position) and asks what the
dart should have been.

```bash
python -m server.replay        # run today's detection over every saved report
```

That prints, for each reported dart, what was scored then, what the code
scores now and what you said it should have been, so a change to `detect.py`
can be checked against the darts that went wrong. A report is about 20-35 MB
(the pictures are kept exact); delete the folders you no longer need.

## Releasing a new version

The desktop app's version, and what changed in each one, are in
`release.json`. As changes go in, a line for each one a player would notice
goes in `"unreleased"`. To release, say 1.1: set `"version"` to `"1.1"`, move
the `"unreleased"` lines into `"notes"` under `"1.1"`, empty `"unreleased"`, and
push to `main`. GitHub builds the apps (named with the version, such as
`DartsSAM-windows-1.1`), the server puts them on the download page
(`tools/fetch_apps.py`), and each desktop app that starts after that offers the
new version with its notes, and downloads it if asked (`server/release.py`).
Pushes that don't change the version build nothing, which saves GitHub Actions
minutes. To check that the apps still build without releasing, start a build by
hand: **Actions → Mac / Windows / Linux → Run workflow**. The server ignores it
because its version isn't new. GitHub keeps each build for 14 days.

### Signed updates

The apps only install an update that GitHub signed when it built it, so a site
that was broken into can't push anything else to them. Set this up once:

1. `pip install cryptography`, then `python tools/sign_release.py new-key`.
2. It writes the public key to `release-key.pub`: commit it. Every build carries it.
3. It prints the private key once. In GitHub open **Settings → Secrets and
   variables → Actions → New repository secret**, name it `RELEASE_SIGNING_KEY`
   and paste the key in. Keep it nowhere else; anyone who has it can sign updates.

Each build is then signed (`*.sig` next to the app in its GitHub build), the
server passes the signature on, and the app checks it before opening the file.
A build with no signature is put on the download page as usual, but the apps
don't offer it as an update. A fork without the secret builds apps that don't
offer updates at all.

To try the offer without building: run the site, then the app with
`DARTSSAM_UPDATES=1 python -m server.app --host http://127.0.0.1:8000`, with a
file and a `releases.json` saying a newer version in the site's downloads folder.

## 6. Developing

```bash
node --test tests/*.mjs        # game rules, offline saving and syncing, the caller's voice
```

```bash
python -m tests.test_vision    # vision pipeline against a simulated 3-camera rig
```

```bash
python -m tests.test_calib     # automatic calibration against simulated cameras
```

```bash
python -m tests.test_db        # saved players, matches and stats
```

```bash
python -m tests.test_version   # the stamp that tells an open app its files have changed
```

```bash
python -m tests.test_release   # telling the desktop app about a newer version
python -m tests.test_fetch_apps  # putting only new versions on the download page
```

```bash
python -m tests.test_refresh   # looking for the cameras again without a restart
```

```bash
python -m tests.test_camlist   # camera names, and which cameras are used
```

The app runs on any computer with no cameras at all: start it the same way,
with no flags, and score by tapping the board.

Use a phone as a (single, experimental) camera: run an IP-webcam app on the
phone, then in the app go to **Cameras → Add a camera** and type the address the phone app shows, such as
`http://PHONE-IP:8080/video`. It is remembered in `config.json`.

Two flags remain for development: `--no-cameras` leaves the cameras alone
altogether, and `--camera SOURCE` (repeatable) uses exactly the cameras named
instead of those found and added.

Fake a throw while the app is open (x, y in mm from the bull, +y is up):

```bash
curl -X POST localhost:8000/api/simulate -H 'Content-Type: application/json' -d '{"x":0,"y":103}'
```

**Adding a game:** copy one of `web/games/*.js` (Count Up is the smallest),
change the rules, add it to the list in `web/games/index.js`. A game is a few
small functions; turn handling, undo, saving and the scoreboard come for free.

## 7. Hosted version

`python -m server.host` is the same app for many people at one web address:
each signs in with Google, Apple or a code sent by email and has their own players, games and stats, with no
server of their own to set up. Nobody plays there without signing in: a signed-out
visitor gets the welcome page (`renderLanding()` in `app.js`), and their first
sign-in makes the account and a first player with their first name. It needs `requirements-host.txt`, not OpenCV. Setting it up on a server, backups
and updating are in [docs/hosting.md](docs/hosting.md).

```bash
python -m tests.test_host      # sign-in, accounts, each account's own games
python -m tests.test_auth      # checking a "Sign in with Apple" token
python -m tests.test_hoststore # accounts and sessions
python -m tests.test_data_api  # the saved-data addresses, shared with the server at home
```

```bash
python -m tests.test_insight    # the trial's accuracy numbers from saved games
python -m tests.test_reportsync # packing problem reports and sending them to the site
```

```bash
python -m tests.test_relay     # passing darts and camera requests between a helper and apps
python -m tests.test_link      # the helper's line to the site, against a real running host
python -m tests.test_share     # sharing without an account, against a real running host
```

(`pip install -r requirements-dev.txt` first: these need it.)

### Using your cameras with the hosted site

The cameras stay plugged into a computer at home running the ordinary server
(`python -m server.app`), which connects out to the site so the hosted app can
reach them:

1. Start the server at home as usual: `python -m server.app`. It knows the
   site is `https://app.dartssam.co.uk`; for a site of your own use `--host URL`
   or `"host"` in `config.json`.
2. Open its own page, **Cameras → Connect to your account**. It
   shows a 6-letter code. (`--pair` prints one in the terminal instead.)
3. On the site, signed in: **Cameras**, type the code.

From then on darts, calibration and problem reports work in the hosted app on
any device signed in to that account, and the pairing is remembered in
`config.json`. **Disconnect cameras** on the site, or **Disconnect** on the
server's page, ends it. A server that has never been paired contacts nothing,
unless its owner agreed to share (below): it only reaches the site once you
press Connect.

While paired, each problem report made with **Report** is also sent to the site
(pictures included) so whoever runs it can see what went wrong; see
[docs/hosting.md](docs/hosting.md) for the admin pages.

### Sharing without an account

Someone using the server at home (or the desktop app) by itself has no account,
so nothing it records would reach the site. The first time its page is opened
it asks once whether it may send what it records; **Settings → Sharing**
changes the answer later. Nothing is sent, and the site is not contacted, until
someone says yes. The desktop app then asks, that first time only, for their
name (which makes the first player) and whether they will use a camera: with
one they go on to the Cameras screen to set it up, without one to the menu. Paired servers are not asked: their data goes with the
account.

Said yes, the server (`server/share.py`) sends its games and darts (players as
"Player 1", not by name), its set-up, the app's usage notes (calibrations,
camera darts put right by hand), feedback typed in Settings → Sharing, and
each problem report made from then on. The site keeps it as an account of its
own called "Desktop app" and four characters, so it appears on the admin pages
beside everyone else. **Delete what has been sent** in Settings → Sharing
removes all of it from the site. The answer is `"share"` in `config.json`.

The site must be updated before apps that ask are given out: an older site
turns the sharing away, and the app just keeps trying.

## 8. Status and known limits

Tested: game rules (unit tests), the app's screens in a browser, the WebSocket
link, and the vision pipeline in simulation (120/120 simulated darts scored
correctly, 0.4 mm average error).

Not yet tested: **real cameras**. Expect to tune on your own board:

- `MIN_DART_AREA`, the diff threshold in `detect.py`, and `MOTION_FRACTION` in
  `tracker.py` depend on your lighting and camera exposure.
- Lens distortion is not corrected. On the 100° lenses it leaves the overlay
  a pixel or two (about 1 mm) off the wires in places, which is why Auto
  reports a fit of 1-2 px rather than a fraction of one. A lens-distortion
  step is the next thing to add.
- Auto-calibration needs the whole double ring in view and an empty board.
- A dart hidden behind an earlier dart from two cameras falls back to a
  lower-confidence single-camera estimate. Use Undo and tap the board to correct.
- Bounce-outs are not detected (press Miss).
- Stats count every dart saved, including darts from games you abandoned part-way.
- X01 checkout hints follow the standard published chart for double out; straight
  out is worked out by the app.
- Scores are called in the device's own voice. A device with none (a Pi, most
  Linux PCs) doesn't call them aloud.

## 9. Licence and credit

Darts S.A.M is free software under the
[GNU Affero General Public License v3.0](LICENSE). You may use, change and
share it, including running it as a website, as long as:

- you keep the copyright and licence notices, and say clearly that your version
  is based on Darts S.A.M by Sam Cramphorn (https://github.com/SonicSamShop/darts-sam);
- anything you build from it, or run for other people over a network, is
  released under the same licence with its source code available to them.

"Darts S.A.M" and dartssam.co.uk are not covered by the licence. A changed
version must go out under a different name and must not suggest it is the
official app.

The fonts in `web/fonts/` are by their own authors, under the SIL Open Font
License (Special Elite: Apache License 2.0). Each one's licence is in
`web/fonts/licences/`.

Contributions are welcome: open an issue or a pull request. By sending a pull
request you agree it is released under the same licence.
