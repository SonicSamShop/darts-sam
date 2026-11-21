# Training area — design

Date: 2026-11-21 · Status: approved by Sam — all six games (Gotcha kept) in this release

## Why

Autodarts offers a set of practice games that Darts S.A.M lacks (Bob's 27,
Shanghai, Bermuda, Segment Training, Round the World, Random Checkout, Gotcha).
Sam wants players to be able to **practise alone or with a friend**, and to find
those games in a clear Training section rather than in one long list. These are
traditional darts drills; the rules are written here in our own words, and
nothing of Autodarts' wording, screens or caller is copied.

## Goals

- A **Training** group on the Play screen's Game step, beside **Matches**.
- Six new games, each a module in `web/games/`, each playable by 1 to N players
  side by side (each player has their own score; with 2+ the best result wins).
- Each new game gets its own figures on the Stats page, like Cricket, Clock,
  Count Up and 121 have now.
- Each new game works with cameras, with tapping the board, and with the caller.

## Non-goals (for this round)

- A separate Training tab or page (approach B; can come later).
- A "Best: …" line on each Training card.
- Playing the computer (bot) in the training games. X01 keeps its bot.
- Typing a whole visit as one number in the new games: every one of them
  scores by which bed each dart hit, so they take darts one at a time.

## Anti-goals

- Copying Autodarts' text, layout, names of their own invention, or voice.
- Making the Play screen harder to use on a phone: the Game step must stay one
  tap to open, one tap to pick.

## Approaches considered

- **A. Training group inside Play (chosen by Sam).** Two headings in the Game
  step over the same cards. Reuses players, options, caller, stats and start
  flow unchanged. Smallest and safest before the Christmas release.
- B. A Training tab in the top bar with its own page and personal bests. Feels
  more like a place, but needs its own player picker and start flow.
- C. Add the games to the flat list. Least work, but about 14 cards in one list
  buries the practice games on a phone.

## Grouping (Play screen)

- Each game module gets `kind: 'match' | 'training'`. The Game step renders
  `<h3>Matches</h3>` cards, then `<h3>Training</h3>` cards, in the order of
  `GAMES` within each group.
- **Matches:** X01, Cricket, Killer, Gotcha.
- **Training:** Around the Clock, Bob's 27, Shanghai, Bermuda, Segment
  Training, Random Checkout, 121 Checkout, Count Up, Random Targets, Free Mode.
- The "Eight games" headings on the landing page (`app.js` ~812, ~835) count
  `GAMES` already, so they update by themselves; check the wording still reads.

## The games (rules as we will build them)

Rules below are my proposals unless marked; they are the common versions of
each drill. Option defaults in **bold**.

### Bob's 27 (training) — new `bobs27.js`
- Start on 27 points. Targets D1, D2 … D20, then D-Bull (option: **include
  bull** / stop at D20).
- One visit (3 darts) per double. Each hit adds the double's value; a visit with
  no hit takes away the double's value once.
- Falling to 0 or below ends that player's game (option: **stop at 0** / play on
  below 0). Others carry on (`out()`).
- Result: final score; with 2+ highest score wins. `target()` lights the double;
  `aim()` calls it ("Double 7").
- Stats: average score, best score, doubles hit %, games finished above 0.

### Shanghai (training) — new `shanghai.js`
- Rounds 1 to 7 (option: **7** / 10 / 20). In round N only number N scores:
  single N, double 2N, treble 3N.
- A single, a double and a treble of N in one visit is a **Shanghai** and wins
  outright (option: **on** / off).
- Otherwise highest total after the last round wins.
- Stats: average score, best score, Shanghais, hit rate on the round's number.

### Bermuda (training) — new `bermuda.js`
- Thirteen rounds with fixed targets: 12, 13, 14, any double, 15, 16, 17,
  any treble, 18, 19, 20, outer bull (25), bull (50).
- Hits on the round's target add their value (for "any double"/"any treble",
  the dart's full value). A visit with no hit on the target **halves** the
  player's score (rounded down).
- Highest score after round 13 wins.
- Stats: average score, best score, rounds halved per game, hit rate.

### Segment Training (training) — new `segment.js`
- Pick a bed to practise: any number 1–20 or bull, and what counts: **any part**
  / singles / doubles / trebles. Throw a set number of darts (option: 30 /
  **60** / 99).
- Score: hits and hit rate; points for value (single 1, double 2, treble 3) so a
  treble-heavy session scores higher than singles. With 2+ highest points wins.
- Stats are kept per bed: hit rate, trebles/doubles hit, best session.

### Random Checkout (training) — new `rcheckout.js`
- Each player gets random checkout targets (seeded, so replay is identical)
  from a range (option: **2–40** / 41–100 / 101–170 / 2–170), double out.
- Darts per target (option: 3 / **6** / 9). Number of targets (option: **10** /
  20). Bust or out of darts: target missed, next one.
- Reuses 121's checkout and bust logic (`checkout()` from `board.js`).
- Result: checkouts made out of targets; with 2+ most made wins, ties go to
  fewer darts.
- Stats: checkout rate, average darts per checkout, by range.

### Round the World (option on Around the Clock, not a new game)
- My call: Autodarts' Round the World is Around the Clock with a stricter target.
  Add an option to `clock.js`: **What counts: any part** / doubles only /
  trebles only. Existing games (no option saved) read as "any part".
- `server/db.py:_clock` reads the new option the same way it reads `skip`.

### Gotcha (match) — new `gotcha.js`
- Race from 0 up to exactly 301 (option: **301** / 501). Going over is a bust:
  the visit doesn't count.
- If your new score equals another player's exactly, theirs goes back to 0.
- First to exactly the target wins. Needs 2+ players (Start is disabled with
  one, with a line saying why).
- Stats: games won, average visit. (Can be X01-like; keep minimal.)

## What changes, file by file

- `web/games/*.js`: six new modules; `kind` on all modules; `clock.js` gets the
  new option.
- `web/games/index.js`: add the modules to `GAMES`.
- `web/app.js`: Game step renders the two groups; `GAME_TILES` gets each new
  game's figures.
- `web/sw.js`: add the new files to the cache list (line ~18), or the installed
  app won't have them offline.
- `server/db.py`: a stats function per new game in `GAME_STATS`, replaying
  throws as `_clock` / `_c121` do.
- `web/style.css` / `themes.css`: the group headings, in each theme's lettering
  (see the UI-genuine conventions: plain, consistent sizes).
- `tests/games.test.mjs`: rules tests per game (solo and two players, undo,
  end of game). `tests/test_db.py`: stats per game.
- `release.json` "unreleased": a player-facing line for the Training group and
  one per game.
- README "Eight games" list and the website FAQ: updated game count and names.

## Left to the builder

- Exact headline (`summary().big/small`) and `panel()` table per game, in the
  style of 121's table.
- Hint and caller wording, short and plain, matching existing games.
- Order of cards within each group beyond the lists above.
- Whether Bob's 27 / Bermuda show a small per-round table in `panel()`.
