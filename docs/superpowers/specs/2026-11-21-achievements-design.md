# Achievements: design

2026-11-21. Status: approved by Sam, 2026-11-21 (his answers are at the end). Plan: `docs/superpowers/plans/2026-11-21-achievements.md`.

## Why

Sam wants players to be rewarded for what they do at the board: finishing
their first game of X01, hitting their first 180, and so on. The app should
notice, say so there and then, and keep a record the player can look back at.

Darts already has this tradition. Leagues hand out a pin or a cloth patch for
a 180 or a 170 finish, and clubs keep an honours board. This is the app's
version of that, not a points-and-levels system.

## What it is

- An **achievement** is something a player has done, named in darts' own words
  (Maximum, Big fish, Madhouse, Shanghai).
- When a dart earns one, a **slip pops up** over the game with the player's
  name and the achievement's badge, and the caller says it. If the cameras
  scored the dart, a **picture of the board** is taken and kept with it.
- Each player has an **Achievements** tab on the Stats page: the ones they hold, when
  and in which game each was earned, and the ones still to get.
- Achievements belong to a **player**, not to a device or an account, the same as
  stats. Computer players get none.

## Goals

- About 45 achievements at first: one for finishing each game, the famous X01
  feats, a few per other game, and long-service ones (darts thrown, games
  finished).
- Players who already have games on record get their achievements from those games
  the first time they look, with the real dates.
- Works the same at home, on the hosted site, in the desktop app and offline.
- Adding an achievement later is one entry in one list.

## Non-goals (for this round)

- Comparing achievements between players or accounts, leaderboards, sharing an achievement
  as a picture.
- Achievements on the menu, on player chips or on a scoresheet. (A scoresheet line
  "Achievements earned in this game" is the obvious next step.)
- Achievements per set of darts.

## Anti-goals

- **No streaks, no daily targets, no notifications, no points, XP or levels.**
  Nothing that nags anyone to come back.
- Nothing that gets between a player and the next dart: the slip never has to
  be dismissed and never covers the score or the board.
- Stock art: gradient medals, emoji, confetti. (See the look, below.)

## The main decision: an achievement is worked out, not stored

Approaches considered:

- **A. Worked out from the games on record (recommended).** An achievement is a line
  drawn on a figure the app can already count from a player's history. Nothing
  new is saved anywhere: no table and no sync. (The picture, below, is the one thing kept.)
- B. An `achievements` table on the server, written when one is earned. Needs a
  schema change, a new address, a new kind of thing for `sync.js` to queue
  (and to renumber for players made offline), a way to fill it in for old
  games, and rules for Undo and deleted games.
- C. Worked out on the server in Python. The X01 figures (legs, checkouts)
  only exist in JavaScript (`stats.js`), so the rules would be written twice.

A fits how the app already works ("the state is always worked out by replaying
the log"; the deep stats are "counted on the device from the history the
server sends"). What follows from it:

- **Old games count** with no migration.
- **Undo takes an achievement back** by itself: undo the third treble 20 and the
  Maximum is gone, slip and all.
- An achievement is held **for as long as the game it was thrown in is kept**. Quit a
  game with "Save your results" unticked, or delete it, and what was earned in
  it goes too, exactly as its darts leave the stats.
- An achievement and the stats page **cannot disagree**: "180s: 10" and the ten-180s
  achievement are counted from the same list.
- The database, `sync.js` and `share.py` are untouched. The only new thing
  kept is the picture (see "The picture"). The paired desktop app gets achievements with whatever it gets its
  stats from.

Its cost: the app needs each player's history on the device to know what they
already hold. It already fetches and keeps that for the stats page
(`warmStats`, the `dartssam-data` cache).

### How it is counted

A new module, `web/achievements.js`. Plain data in, plain data out, like `stats.js`.

1. **A tally per game.** `tally(sheet, me)` takes one game in the shape of a
   history entry (`_history()` in `server/db.py`; `matchSheet()` in `sync.js`
   makes the same shape from a game on the device) and returns what that
   player did in it: counts (darts, 180s, games finished, legs won) and bests
   (highest checkout, fewest darts for a 501 leg), plus one-off feats
   (Shanghai, three in a bed).
   - Visits of any game come from `visitsOf()`.
   - X01 legs and checkouts come from `x01Legs()`, already there.
   - The other games' few feats come from the engine: a history entry's visits
     turn back into a log, and `compute()` gives the end state. No game's
     rules are written a second time.
2. **Tallies add up.** Counts are summed, bests take the best. A player's
   total is the sum over their games, oldest first.
3. **An achievement is a test on the total**: `{id, group, mark, name, how, test}`,
   or a list of steps for one that is earned several times (1, 10, 50, 100).
   The date and game of an achievement is the first game after which its test passes.

### Knowing it the moment the dart lands

- When a match starts, the app works out each human player's total from their
  kept history, plus any finished games still waiting to sync
  (`data.waitingGames()`'s queue), and holds it for the match.
- In `push()`, after the dart: held-before is `total + tally(game before the
  dart)`, held-after is `total + tally(game after)`. Anything in after and not
  in before is **new**: show it and say it.
- Only the device a dart is entered on shows a slip. Opening the app on
  another device later shows the achievement on the Achievements tab, quietly.
- If a player's history isn't on the device yet (brand new device, never
  reached the server), no slips are shown for them in that game rather than
  showing "first" achievements they may already hold. The achievements still turn up on
  their tab.

## What counts

- **Darts from cameras, taps and typed visits all count.** It is the player's
  own board and there is nobody to cheat but themselves.
- A typed visit has no single darts, so it can earn a 180 or a checkout but
  not an achievement that depends on which beds were hit (Shanghai, Bed and
  breakfast, Madhouse).
- Feats in a visit count when thrown, in a game that is kept, finished or not.
  "Finish a game" and "win" achievements need the game finished.
- A win counts when there were two or more players, the same as "Won (2+
  players)" on the stats page. A computer player counts as an opponent.
- Computer players earn nothing and get no tab.

## The achievements (first list)

`mark` is the two or three characters on its badge. Steps are in brackets.
Names and thresholds are proposals for Sam to change.

### First games (one per game, made from `GAMES`, so a new game brings its own)

| Mark | Name | How |
|---|---|---|
| the game's initials | First game of X01, of Cricket, … | Finish a game of it |
| 14 | Been round the board | Finish a game of every one |

### Scoring (any game where a visit adds up, unless it says X01)

| Mark | Name | How |
|---|---|---|
| 100 | Ton | 100 or more in a visit |
| 140 | Ton forty | 140 or more in a visit |
| 180 | Maximum (1, 10, 50, 100) | 180 in a visit |
| 50 | Bullseye | Hit the bull |
| 3B | Hat trick | Three bulls in a visit |
| 3× | Three in a bed | Three darts in the same double or treble |
| SDT | Shanghai | Single, double and treble of one number in a visit |
| 26 | Bed and breakfast | 20, 5 and 1 in a visit (kept as a surprise) |

### Finishing (X01, double out)

| Mark | Name | How |
|---|---|---|
| D | Game shot | Check out a leg |
| 100+ | Ton-plus finish (1, 10, 50) | Check out 100 or more |
| 170 | Big fish | Check out 170 |
| DB | Bull finish | Check out on the bull |
| D1 | Madhouse | Check out on double 1 (kept as a surprise) |
| 18 | 18-darter | Win a 501 leg in 18 darts or fewer |
| 15 | 15-darter | In 15 or fewer |
| 12 | 12-darter | In 12 or fewer |
| 9 | Nine-darter | In 9 |

### Matches

| Mark | Name | How |
|---|---|---|
| W | First win | Win a game against someone |
| W | Wins (10, 50, 100) | Games won |
| PC | Beat the computer | Win against a computer player |
| 15 | Beat the best | Win against the top level |
| 0 | Whitewash | Win a match of three or more legs without losing one |

### Other games

| Mark | Name | How |
|---|---|---|
| 9M | Nine marks | Cricket: three trebles on scoring numbers in a visit |
| ATC | Clockwork | Around the Clock: finish in 30 darts or fewer |
| 27 | Still standing | Bob's 27: finish above zero |
| 27+ | In profit | Bob's 27: finish above the 27 you started on |
| ½ | Never halved | Bermuda: finish without being halved |
| K | Last one standing | Killer: win |
| K5 | Untouched | Killer: win without losing a life |
| 121 | Ladder | 121 Checkout: check out 121 |
| RC | Clean sheet | Random Checkout: make every target in a game |

### Long service

| Mark | Name | How |
|---|---|---|
| the number | Darts thrown (1,000 · 10,000 · 50,000 · 100,000) | Darts on record |
| the number | Games finished (10 · 50 · 100 · 500) | Finished games |
| the number | Days at the board (7 · 30 · 100) | Different days with a dart thrown. Not days in a row. |

Surprises show as a blank badge and "A surprise" until earned. Everything else
says how to get it.

## When one is earned

- **The slip.** A line across the top of the game screen, clear of the score
  cards and the board: the badge, then `Sam · Maximum` and under it `180 in a
  visit`. With one player the name is left out. In the TV view it sits above
  the scoreboard.
  - Stays about 6 seconds, then goes. A tap opens that player's Achievements tab
    only once the game is over; during a game a tap just closes it.
  - Two or more at once (a first 180 that is also a first Ton forty and a
    first Ton): the slip shows the highest of a family (Maximum, not Ton) and
    the rest are held quietly. Unrelated ones queue, one slip after another.
  - It slides in; with `prefers-reduced-motion` it just appears. No sound of
    its own.
- **The caller** says it after the score, when the caller is on: "One hundred
  and eighty. Sam, Maximum."
- **At the end of the game**, under the result banner: `Achievements this game: Sam,
  Maximum · Sam, Ton-plus finish · Alex, First game of X01`. Players standing
  at the oche miss slips; this is where they catch up.
- **Undo** of the dart that earned it removes the slip if it is still up and
  the line at the end.
- A step of a counted achievement (your 10th 180) gets a slip like any other.
- One setting, in Settings beside the caller's: **Show achievements as they are
  earned** (on). Off: no slips, no call, no end-of-game line. The tab stays.

## The picture

Sam's idea: when an achievement is earned and cameras are scoring, take a
picture of the board with the darts in it, and show it with the achievement.

- **When.** The dart that earned it was scored by a camera (`src: 'cam'`, or
  the phone's own camera). The picture is asked for at once, in `push()`,
  while the darts are still in the board. Tapped and typed darts have no
  picture: there may be nothing in the board to see.
- **Which camera.** One picture, from one camera: the first one that is on,
  as it sees the board (`/api/cameras/<n>/snapshot.jpg`, which the hosted app
  already reaches through the pairing). With a phone scoring, the phone's own
  frame. A face-on picture made from the calibration can come later.
- **Where it is kept.** With the games: the app fetches the picture and sends
  it to the server it saves games to, as
  `PUT /api/matches/<match id>/photos/<achievement id>`; read back with `GET`.
  At home that is `data/photos/<match id>/`, on the site the account's own
  folder, so deleting an account still is deleting a folder. A JPEG no wider
  than 1280 and no bigger than 400 KB; anything else is refused.
- **It follows the achievement.** Undo the dart and the picture is deleted.
  Delete or throw away the game and its pictures go with it. Earn the same
  dart again and it is replaced. There is at most one per achievement step,
  so a player can never have more than about 70.
- **Offline, or the camera doesn't answer in a couple of seconds:** no
  picture. The achievement is shown without one. Nothing is queued.
- **Seeing it.** A small one in the slip, beside the badge. On the
  Achievements tab, on the achievement's own view, full width; a tap shows it
  alone. The end-of-game line doesn't show pictures.
- **Privacy.** A camera at the board can catch a hand or someone walking
  past. Pictures are kept only with the player's own games, are never sent by
  `share.py`, and are in no problem report. A setting, **Keep a picture of the
  board with an achievement**, turns it off. At home it starts on. On the
  hosted site, and for a phone scoring with its own camera (whose pictures
  don't leave the phone today), the app asks once, the first time there is
  one to keep, and the privacy page says what is kept.
- Old achievements have no picture, and never get one.

## The Achievements tab

A fourth tab on the Stats page: Stats, Games, Board, **Achievements**. It uses the
page's player picker. The Game picker narrows it to that game's achievements; the
Darts picker doesn't apply and is ignored.

- Heading: `Achievements · 12 of 45`.
- Under it, the groups above as ruled lists (the stats page's ledger lines,
  not cards). Each line: the badge, its name, how it is earned, and on the
  right the date. Held ones first within a group.
- A held line opens the achievement: its badge, name, date, the picture if
  there is one, and **Open the game** (its scoresheet, which the stats page
  already shows, at the visit where that is known). A line with a picture
  shows a small one at its end.
- A counted achievement is one line: `Maximum ×10 · 12 so far, next at 50`.
- One not yet held: the badge as an outline, its line muted. Where there is a
  number to show, how far along: `Darts thrown · 6,214 of 10,000`.
- First time with old games on record, one line at the top: `These come from
  every game on record, so some are from before achievements existed.`

## The look

Each achievement has a **badge**: a small round pin with its mark lettered on it, the way
a league's 180 badge is. One SVG shape and two or three characters, drawn in
code. No pictures, no icon set, no emoji.

- Each theme draws it in its own way, using colours it already has: Classic
  gold on the dark (gold already means "finish"), Chalk a chalked ring in the
  theme's hand, Scoresheet a rubber stamp, Stage and Arcade in their accent.
- Lettering takes steps from each theme's existing scale (`--sz-fine` to
  `--sz-score` in Chalk), not new pixel sizes.
- Three sizes of the same pin: in a list line, in the slip, and large on the
  achievement's own view.
- The slip is a `.banner` at the top of the screen, not a new kind of box.

## What changes, file by file

- `web/achievements.js` (new): `tally()`, adding tallies, the list of achievements,
  `held(total)`, `newly(before, after)`.
- `web/app.js`: totals worked out at match start; the check in `push()` and
  `undo()`; the slip; the caller's line; the end-of-game line; the Achievements tab
  in `drawPlayers()` and `STAT_TABS`; the setting.
- `web/stats.js`: nothing new expected, but `x01Legs()` and `visitsOf()` are
  what `achievements.js` reads.
- `web/sync.js`: a way to read the finished games still waiting to sync, if
  `waitingGames()` only gives their number.
- `web/style.css`, `web/themes.css`: the pin in each theme, the slip, the tab.
- `web/sw.js`: `achievements.js` in the cache list, or the installed app won't have
  it offline.
- `tests/achievements.test.mjs` (new): each achievement earned and not earned from small
  made-up histories; steps; Undo; typed visits; a computer player; old games.
- `web/rules.html` or the FAQ: a short "Achievements" section listing them.
- `release.json` "unreleased": a player-facing line.
- `docs/architecture.md`: `achievements.js` in the table of `web/`.
- `server/data_api.py` and a small new `server/photos.py`: the picture's two
  addresses and its files (see "The picture"). `server/db.py`'s
  `delete_match` also removes the game's pictures. `tests/test_photos.py`.
- `web/privacy.html`: what a picture is, where it is kept, how to turn it off.
- Database schema, `sync` protocol: no change.

## Risks

- **A wrongly scored dart shows an achievement that isn't deserved.** Undo takes it
  back, and the slip goes with it. The caller will have said it.
- **History size.** A player with thousands of games has a large history and
  the totals are worked out from all of it at match start. Tallies are per
  game and can be kept by game id and `seq`, so only new games are counted
  again. Measure on Sam's own data before deciding whether that is needed.
- **A stale history** (offline for a week on one device, played on another)
  can show a "first" slip for something already held elsewhere. It rights
  itself on the tab once synced. Accepted.
- **Scope before Christmas.** The catalogue is the easy part to cut: the
  First games, Scoring, Finishing and Long service groups alone are a
  complete feature.

## Left to the builder

- The exact shape of a tally and which fields it needs.
- The pin's drawing per theme, checked in all five.
- Wording of each "how" line and of the caller's line, short and plain.
- Whether tallies need caching (see Risks).

## Decided (Sam, 2026-11-21)

1. It is called **Achievements**. (The round pin each one has is its badge.)
2. Typed and tapped scores count the same as camera-scored ones.
3. Bed and breakfast and Madhouse stay hidden until earned.
4. The list stands as written, all of it in the first release.
5. An achievement goes when its game goes.
6. Pictures are on from the start at home (the server by the board and the
   desktop app with its own cameras). On the hosted site, and for a phone
   scoring with its own camera, the app asks once before keeping the first one.
