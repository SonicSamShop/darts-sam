# Setting it up at home

Cameras round the board, a computer they plug into, and the app on a tablet,
phone or TV:

```
3 USB cameras ──► computer by the board (server/)  ──Wi-Fi──►  tablet, phone or TV (web/)
                  finds each dart, works                       scoreboard, games,
                  out the segment                              tap-to-score fallback
```

The computer by the board can be a Mac, a Windows PC or a Linux PC. There are two ways to run it:

- **The desktop app** ([Mac](#on-a-mac-dartssamapp), [Windows](#on-windows-dartssamexe),
  [Linux](#on-linux-dartssam-linux-x86_64targz)): one download, no Python.
- **From the code** ([below](#2-run-it-from-the-code)): if you want to change it.

With no cameras at all the app still works: score by tapping the board.

## 1. Hardware

| Part | What to search for | Notes |
|---|---|---|
| 3 × camera | "OV9732 USB camera module 100 degree" | 720p, MJPEG, manual-focus lens. The de-facto standard for DIY dart scoring. Get the 100° "no distortion" lens, not the fisheye. |
| Computer | A Mac, Windows or Linux PC | One camera per USB port is safest. On Windows several can share one hub. |
| Mounts | "Target Corona Vision OV9732 mount" on MakerWorld / Cults3D | Printable clips made for your exact light ring exist. No printer: use a print service. |

Placement:

- Three cameras spaced evenly (120° apart) around the Corona Vision ring, each
  aimed at the bull. The printable mounts set the angle for you.
- Each camera must see the **whole** board face including the full double ring.
- Turn each lens to focus on the board wires, then lock it with a dab of
  nail varnish or tape. Blurry wires = bad calibration.
- Route cables behind the surround so nothing moves in front of the cameras.

## 2. Run it from the code

It needs Python 3.11 or newer and git. On Debian or Ubuntu, first:

```bash
sudo apt install -y python3-venv git
```

```bash
git clone https://github.com/SonicSamShop/darts-sam.git dartssam
```

```bash
cd dartssam && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python -m server.app
```

Then on an iPad open `http://my-computer.local:8000` (the computer's name or IP address),
tap Share → **Add to Home Screen**. It then launches full-screen like a native
app: no Mac, Xcode or Apple developer account needed. On a phone or tablet the
app shows a reminder bar with these steps when it is opened in a browser tab
instead of from the home screen, until it is dismissed.

On an Android phone, open the same address in Chrome and use the menu **⋮ →
Add to Home screen**. Chrome only offers a one-tap **Install** button if the
page is served over https.

On Windows the programs are in `.venv\Scripts` instead of `.venv/bin`. On the
computer itself the app is at `http://localhost:8000`.

The server has no sign-in, so it only answers to the names a home network uses:
an IP address, `localhost`, a name with no dots (`my-computer`), or one ending
`.local`, `.lan`, `.home`, `.home.arpa` or `.internal`. This stops web pages on
other sites from reaching it through your browser. If you reach it by some
other name (through a reverse proxy, say), list it in `config.json`:
`"hosts": ["darts.example.com"]`.

### Working offline (needs https)

The app is offline-first: once installed it opens and runs with no computer and no
network (at the pub, or with the computer switched off). Games, new players and
settings are saved on the device and sent to the computer the next time it can be
reached; the top bar shows how many changes are waiting. Only the cameras and
calibration need the computer.

Browsers only let a web app store itself on the device when it comes over
**https** (or from `localhost`). Plain `http://my-computer.local:8000` scores
and syncs fine while the app is open, but it cannot be *opened* without the computer.
To serve https, give the server a certificate:

```bash
.venv/bin/python -m server.app --cert cert.pem --key key.pem
```

then use `https://my-computer.local:8000`. The certificate must be one the
iPad or phone trusts. For a home network the usual way is
[mkcert](https://github.com/FiloSottile/mkcert) on your laptop:
`mkcert my-computer.local` makes the two files to copy to the computer, and
`mkcert -CAROOT` shows where its `rootCA.pem` is. Send that file to the iPad,
install it (Settings → General → VPN & Device Management) and switch it on
under Settings → General → About → Certificate Trust Settings. If you start
the server from `dartssam.service`, add the two options to `ExecStart` there.

What works offline: every game, tap and typed scoring, undo, adding, renaming
and removing players, settings and themes. Stats
come from the computer, so offline you see them as they were at the last sync (the
screen says so), lists and scoresheets included; they catch up once the queued
games have been sent.

### Starting it when the computer starts (Linux)

Edit the paths in `dartssam.service`, then:

```bash
sudo cp dartssam.service /etc/systemd/system/ && sudo systemctl enable --now dartssam
```

### Getting a newer version

```bash
cd dartssam && git pull && .venv/bin/pip install -r requirements.txt
```

then start the server again (`sudo systemctl restart dartssam` if it starts
with the computer). Your players, games and calibration are in `data/` and
`config.json`, which git leaves alone. Open apps notice the new files and
reload themselves when no game is being played.

If you change the code on another computer and copy it across instead,
leave the data alone:

```bash
rsync -av --exclude .venv --exclude .git --exclude __pycache__ --exclude data --exclude config.json ./ me@my-computer.local:dartssam/
```

## 3. Or the desktop app

The same server with Python and everything else inside it, for a computer with
the cameras plugged in. Download it from
[dartssam.co.uk/download.html](https://dartssam.co.uk/download.html). It opens
on **Cameras** until a camera is lined up with the board, and on the menu
after that. To use the cameras with the hosted site, go to **Cameras → Connect
to your account** there (see [Using your cameras with the hosted
site](#using-your-cameras-with-the-hosted-site)). When there is a newer
version it says so, shows what changed and can download it.

Each takes the same options as `python -m server.app`, plus `--no-browser`
(the server alone, with no window).

### On Windows: DartsSAM.exe

One file to double-click. Darts S.A.M opens in a window of its own, with its
icon on the taskbar; closing the window stops it. Double-clicking it again
while it is running brings that window to the front.

- Players, games, calibration and reports are kept in `%LOCALAPPDATA%\DartsSAM`
  (paste that into the Explorer address bar), so a newer `DartsSAM.exe` simply
  replaces the old one.
- The file is not signed, so the first time Windows says "Windows protected
  your PC": click **More info → Run anyway**.
- The window is drawn by Microsoft's WebView2, which Windows 11 has and
  Windows 10 nearly always has (it comes with Edge).
- `DartsSAM.log` in the same folder is what the server said since it was last
  started; the window's **Data** menu opens the folder.

It is built on GitHub's Windows machines by `.github/workflows/windows.yml`,
which also runs the tests there and checks the built file's server starts.
After `pip install -r requirements.txt -r requirements-windows.txt pyinstaller`,
`python tools/build_exe.py` is the build itself (it builds for whatever system
it is run on). **Not yet tried:** real USB cameras on Windows, and the file on
a real Windows desktop.

### On a Mac: DartsSAM.app

A `.dmg` to download: `DartsSAM-arm64.dmg` for a Mac with Apple silicon (M1
and later), `DartsSAM-x86_64.dmg` for an Intel Mac. Open it, drag **DartsSAM**
to **Applications** and double-click it there. Darts S.A.M opens in a window of
its own, with its icon in the Dock, and macOS asks once whether it may use the
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

It is built on GitHub's Macs by `.github/workflows/mac.yml`, which also checks
the built app starts. On a Mac, `pip install -r requirements.txt -r
requirements-mac.txt pyinstaller` then `python tools/build_exe.py` builds it
for that Mac's chip. **Not yet tried:** a signed build.

### On Linux: DartsSAM-linux-x86_64.tar.gz

For a Linux PC (64-bit Intel or AMD). Unpack it, then in a terminal:

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

It is built on GitHub by `.github/workflows/linux.yml`, which also checks the
program starts and that `install.sh` installs and uninstalls it. On Linux,
`pip install -r requirements.txt pyinstaller` then `python tools/build_exe.py`
builds it. **Not yet
tried:** real USB cameras with the built program.

## 4. Cameras

USB cameras are found by themselves, on Linux, a Mac or Windows (where they
are opened through DirectShow, so several can share one USB hub). A camera you
don't want used (a laptop's own webcam) can be switched off on the app's
**Cameras** screen. On Linux a camera that comes back under another number
after being replugged shows **No picture**: press **Look again**. Its
calibration stays with the old number, so press **Find the board** for it and
tap the 20 once more.

**A phone scoring by itself** (Beta): on the hosted site a phone can use its own
camera with no computer at all; see [Using the app](using.md#scoring-with-your-phones-camera-beta).
Browsers only give a page the camera over https, so this doesn't work from a plain
`http://` address at home.

**A phone as one of these cameras** (single, experimental): run an IP-webcam app on the
phone, then in the app go to **Cameras → Add a camera** and type the address
the phone app shows, such as `http://PHONE-IP:8080/video`. It is remembered in
`config.json`.

## 5. Calibrate (once, and again if a camera gets knocked)

In the app: **Cameras**, from the menu. Take the darts out of the board, then
for each camera press **Find the board**. The server finds the board by its
red and green rings and fits the calibration to the 40 places where a red
block meets a green one. The colours can't say which way up the board is, so a
camera that has never been calibrated asks for one rough tap anywhere in the
20; after that it needs no taps, so it is also the quick fix when a camera
gets knocked. [How the cameras find the board](calibration.md) explains it,
with pictures.

Green lines are then drawn over the picture: they should sit on top of the
real wires, with the green "20" inside the 20 segment. The app reports how
many of the 40 points agreed and how far off they are in pixels; it refuses
rather than guess if it can't see enough of the rings.

If it can't manage (odd lighting, a board that isn't red and green), press
**Mark it by hand** instead and tap the four points where the outer double wire
crosses the wire between 20|1, 6|10, 3|19 and 11|14 (pinch to zoom in first).
Four taps are much less accurate: a tap a couple of pixels out moves scores by
several millimetres. Pressing **Find the board again** afterwards tidies it up.

With an empty board, press **Board is empty now** and start a game.

## Using your cameras with the hosted site

The hosted site, [dartssam.co.uk](https://dartssam.co.uk), keeps your players,
games and stats in an account, on every device you sign in on. The cameras
stay plugged into a computer at home running the ordinary server (the desktop
app, or `python -m server.app`), which connects out to the site so the hosted
app can reach them:

1. Start the server at home as usual. It knows the site is
   `https://app.dartssam.co.uk`; for a site of your own use `--host URL` or
   `"host"` in `config.json`.
2. Open its own page, **Cameras → Connect to your account** (the button is
   beside a camera's picture, so a camera has to be found first). It
   shows a 6-letter code. (`--pair` prints one in the terminal instead.)
3. On the site, signed in: **Cameras**, type the code.

From then on darts, calibration and problem reports work in the hosted app on
any device signed in to that account, and the pairing is remembered in
`config.json`. **Disconnect cameras** on the site, or **Disconnect** on the
server's page, ends it. A server that has never been paired contacts nothing,
unless its owner agreed to share (below): it only reaches the site once you
press Connect. (The desktop app also asks the site, each time it starts,
whether there is a newer version. That question says only which kind of
computer it is.)

While paired, each problem report made with **Report** is also sent to the site
(pictures included) so whoever runs it can see what went wrong; see
[hosting.md](hosting.md) for the admin pages.

## Sharing without an account

Someone using the server at home (or the desktop app) by itself has no account,
so nothing it records would reach the site. The first time its page is opened
it asks once whether it may send what it records; **Settings → Sharing**
changes the answer later. Nothing is sent, and the site is not contacted, until
someone says yes. The desktop app then asks, that first time only, for their
name (which makes the first player) and whether they will use a camera: with
one they go on to the Cameras screen to set it up, without one to the menu.
Paired servers are not asked: their data goes with the account.

Said yes, the server (`server/share.py`) sends its games and darts (players as
"Player 1", not by name), its set-up, the app's usage notes (calibrations,
camera darts put right by hand), feedback typed in Settings → Sharing, and
each problem report made from then on. The site keeps it as an account of its
own called "Desktop app" and four characters, so it appears on the admin pages
beside everyone else. **Delete what has been sent** in Settings → Sharing
removes all of it from the site. The answer is `"share"` in `config.json`.

If you run a site of your own: it must be updated before apps that ask are
given out. An older site turns the sharing away, and the app just keeps trying.
