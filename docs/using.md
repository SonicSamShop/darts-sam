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
- **Playing the computer:** in X01, **Bot** is one more player to tap. Once it
  is playing, **Bot level** sets how good it is, from 1 (averages about 18,
  and hits a double with about 1 dart in 12) to 15 (averages about 110 and
  hits 80% of its doubles). Once you have thrown some X01 the menu shows your
  own average, and the level is set to the first one that averages as much as
  you or more (on 40, the level that averages 44). Change the level and it
  stays where you put it; **Use level …** goes back to the suggested one. It
  throws by itself when its turn comes, a dart at
  a time, and each dart is shown landing on the board (**Settings › In a
  game** switches that off). While it throws, nothing at the real board is
  scored, so your darts can come out. Undo takes back your last dart, along
  with anything the bot has thrown since. Each level's games are kept like a
  player's, but bots are not listed with the players.
- **Darts:** add each set you own to your card under **Settings › Players,
  darts and boards**, pick which you
  are throwing on the Play screen, and see how much each set has been thrown
  and its stats on their own. **More details** on a set keeps its brand,
  tungsten, barrel shape, grip, shaft, flight and a note. Under **Stats ›
  Games** the sets are side by side: 3-dart average and checkout rate (X01) and
  trebles hit. A figure says "not yet" until the set has enough darts behind
  it (300 for the average and trebles, 50 at a double for checkouts), and
  nothing picks a "best" set.
- **Boards:** **Settings › Players, darts and boards** lists your boards under
  the players, each with its brand, model, the year it was bought and a note.
  One is **on the wall**, and every game started is played on it. When you swap
  boards, add the new one and **Put on the wall**: say the day it went up, and
  the games since then move to it. **Played on it before a date** moves every
  game from before that day to an older board. With two boards or more,
  **Stats** has a **Board** picker beside **Darts** (both can be picked), and
  **Stats › Games** puts the boards side by side the way it does the sets,
  with the same "not yet" until a board has enough darts.
- **Achievements:** a first game of each kind, a first 180, a 170 finish and
  the like are shown and called as they happen, and listed for each player
  under **Stats › Achievements** with the game each was earned in. They are
  worked out from the games on record, never stored: a game that is thrown
  away takes what was earned in it with it. **Settings › In a game** turns
  the showing off.
- **Stats:** **Stats** has a page for all games together and one for
  each game type, with that game's own averages (X01 and Count Up: 3-dart
  average; Cricket: marks per round; Around the Clock: hit rate and darts to
  finish; 121 Checkout: checkout rate; the other training games have their own
  figures too, such as Bob's 27 score or Segment Training points per dart) and a heat map of where the darts
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
  average, quickest and total time for each game type. **Time played** on a
  player's stats adds up every game they threw in, a game quit part-way and
  kept counting up to its last dart.

## Scoring with your phone's camera (Beta)

On the hosted site a phone can score by itself with its own camera, with no
computer and nothing to install. Open **Cameras** and press **Use this Device
Camera**, stand the phone to one side of the board (about level with it, with
the whole board in the picture), take the darts out, press **Find the board**
and tap the 20. The first time it downloads about 27 MB; after that it starts
in a few seconds, even with no network.

It is in **Beta**: one camera can't be as sure as two or three, so it gets some
darts wrong. When it isn't sure, it asks **Which bed?** with its best guesses
and how likely each is; pick one, or **Somewhere else** and tap the board. After
a dart it was sure of, **Change** shows for a few seconds to put it right. If
the phone gets moved it says so: find the board again. Everything is worked
out on the phone; no pictures are sent anywhere, except when you tap **Report**
in a game: that sends the camera's last few pictures to your account, to help
put it right.

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

- Stats count every dart saved, those of a game still in progress included. **Quit
  game** asks if you are sure and offers to save your results: left ticked, the
  darts thrown stay in your stats; unticked, the game is thrown away, darts and
  all.
- X01 is double out; its checkout hints follow the standard published chart.
- With **Sound** on (Settings › In a game; off to begin with), scores are called
  in the device's own voice: each visit's total, and each dart as well if **Call
  each dart** is on. A device with no voice (a Pi, most Linux PCs) stays quiet.

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
