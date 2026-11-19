# Using the app

What the app keeps and shows once it is running. Setting it up is in
[setup.md](setup.md).

## Players, history and stats

Players, settings, finished games and **every dart thrown** are saved by the
server in one database file, `data/dartssam.db` (SQLite, created on first
run). The app saves each change on the device first and then sends it to the
server, so nothing is lost if the server is unreachable (see "Working offline"
in [setup.md](setup.md#working-offline-needs-https)). On the hosted site each
account has a database of its own instead.

- **Players:** add them on the home screen, or under **Settings › Players and
  darts**, where each player has a card: tap it to rename them, look after
  their darts or remove them. Then tap who is playing in
  throwing order. With two or more playing, Start (and Play again) asks who
  throws first: **Closest to bull** (one dart each at the bull, taken out
  before the next player throws; the nearest starts, and players who are level
  throw again) or **Random**. Removing a player only hides them:
  their throws are kept, and adding the same name again brings them back.
- **Darts:** add each set you own to your card under **Settings › Players and
  darts**, pick which you
  are throwing on the Play screen, and see how much each set has been thrown
  and its stats on their own.
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

## When a dart is scored wrongly

Use **Undo** and tap the board where the dart really is. If the cameras got it
wrong, tap **Report** in the game's top bar straight away, before pulling the
darts: the server saves what each camera saw, and the app then shows each
camera's picture marked up and asks what the dart should have been.
[How a dart is found](detection.md#when-a-dart-is-scored-wrongly) says what is
in a report and how to run the detection over it again.

Things the cameras don't do yet:

- A dart only one camera can see (hidden behind earlier darts from the
  others) is not scored: enter it by tapping the board.
- Bounce-outs are not detected (press Miss).

And about the rest:

- Stats count every dart saved, those of a game still in progress included. A
  game ended with **Quit game** is thrown away, darts and all.
- X01 is double out; its checkout hints follow the standard published chart.
- Scores are called in the device's own voice. A device with none (a Pi, most
  Linux PCs) doesn't call them aloud.

## Backing up

Copy the database file. From a Pi to your laptop:

```bash
scp pi@raspberrypi.local:dartssam/data/dartssam.db dartssam-backup.db
```

The desktop apps keep theirs in their data folder ([setup.md](setup.md#3-or-the-desktop-app)
says where). If you have an older copy from when the app was called OmniSam or
DartsOmni, its `data/omnisam.db` (or `data/dartsomni.db`) is renamed to
`data/dartssam.db` the first time the new version starts, so nothing is lost.

The tables are described at the top of `server/db.py`. To look inside:
`sqlite3 data/dartssam.db` then, for example, `SELECT * FROM throws LIMIT 20;`.
