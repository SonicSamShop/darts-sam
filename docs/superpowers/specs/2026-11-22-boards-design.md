# Boards: design

2026-11-22. Status: draft for Sam.

## Why

Sam swaps boards over time (a worn board comes down, a new one goes up) and
wants to know whether the swap changed anything: does he score better, hit more
trebles, check out more on the new board? The app already answers that question
for darts (sets side by side on Stats). This does the same for boards, and lets
the two be looked at together ("Red 23g, on the new board").

Sam's words (2026-11-22): "i want to be able to add multiple boards and track
them against the darts for my stats etc." — "swapping boards I think." — "i
want boards & darts to be under one area in settings as well (the darts link to
players)".

## What is there already

- **Darts** (`dart_sets`, built 2026-11-22, see `2026-11-22-my-darts-design.md`):
  each player's sets; each game records the set each player threw
  (`match_players.darts`); Stats filters by set and puts sets side by side with
  "not enough yet" thresholds.
- **One board**, in the settings (`settings.board`: brand, model, year bought,
  notes; checked by `cleanBoard` in `web/sync.js`), shown in **Settings › Your
  board**. It is linked to nothing: "It changes nothing in the games or the
  stats."

## Approaches considered

- **A. Each game records the board it was played on (picked by Sam).** A list
  of boards; one is "on the wall"; a game started takes that board's id. Works
  like darts do, so Stats gets the board filter and comparison the same way.
  Risk: forget to switch on swap day and a few games land on the old board, so
  there is a way to move games across (below).
- **B. Boards have dates; a game's board is worked out from when it was
  played.** Nothing stored per game, and history fixes itself when a date is
  changed. Rejected: gaps and overlaps leave games with no board or two, every
  device (Pi, desktop, account) must agree on the dates before the stats agree,
  and it would not cope with playing on another board somewhere else.

## Goals

1. Settings holds **several boards**, one of them **on the wall**.
2. Every game remembers the board it was played on.
3. **Swapping** is one step: add the new board, put it on the wall, say when it
   went up. Games since then move to it.
4. Stats can be **limited to one board** (and combined with the darts picker),
   and puts **boards side by side** with the same figures and the same "not
   enough yet" thresholds as darts.
5. **One Settings section** for players, their darts and the boards.

## Non-goals

- Boards per player. A board belongs to the household (the Pi, the desktop, or
  the hosted account), as `settings.board` does now.
- Playing at more than one place at once, or picking the board on Play. (A
  would allow it later; not now.)
- A catalogue of board models, pictures, or links to shops (see
  `no-dart-upsell-yet`: nothing that reads as an advert).
- Naming a "best" board.
- Tying camera calibration to a board.

## Anti-goals

- Changing anyone's figures without their say. Moving games between boards
  happens only when the player asks for it.
- A game with no board breaking anything: old apps, typed games, games from an
  older Pi all still save and still count in "all boards".

## The design

### Settings: "Players, darts and boards"

"Players and darts" and "Your board" become one section, **Players, darts and
boards** (tab name **Players**; the list line shows the players' names and the
board on the wall, e.g. "Sam, Phil · Winmau Blade 6").

```
Players
  Sam      Red 23g · Blue 21g          [More]
  Phil     House darts                 [More]
  [ Add a player ]

Boards
  Winmau Blade 6          On the wall · up since March 2026
  Unicorn Eclipse Pro     Taken down · Jan 2024 – Mar 2026   [Put back up]
  [ Add a board ]
```

Players keep the panel they have now (`playersPanel()`), darts under each
player. **Boards** sits below it. Tapping a board opens its fields: brand,
model, year bought, notes (as today's board form), and **Put on the wall** /
**Take down**. A board can be removed only if no game was played on it;
otherwise it can only be taken down (like putting darts away).

A board has no separate name: it is shown as "Brand Model". With neither given
it is "Board 1", "Board 2" in the order added. (Builder: if two boards read the
same, add the year bought, then "(2)".)

### Swapping boards

**Put on the wall** asks one thing:

```
When did it go up?
  ( ) Today
  ( ) On [date picker]
  [ Put it up ]
```

- **Today**: games from now on are on this board.
- **On a date**: also moves games already played since that date (that are on
  the board coming down, or on no board) to this board, and says how many:
  "12 games since 3 March moved to Winmau Blade 6." Games on any other board
  are left alone.

The board coming down is marked taken down, with the same date. Each board
keeps `up` and `down` dates for the list line; they are for showing only — the
game's own `board` is what Stats uses.

Putting a taken-down board back up works the same way.

### Games already saved

When this ships, on each database (Pi, desktop, each hosted account) the first
start does this once:

- If `settings.board` has anything in it, it becomes the first board, on the
  wall. Otherwise a board "Board 1" with no details is made, on the wall.
- Every game already saved gets that board.
- `settings.board` is then removed.

So nobody's existing figures disappear from a board filter, and Sam's current
board is where all his games so far went. If that is wrong for him (he had an
older board for some of them), he adds the old one and uses "Put on the wall,
on a date" in the other order — or the builder adds a "move games before
[date]" (left out unless Sam wants it; see questions).

### Stats

- The picker row gets a **Board** picker next to **Darts**: "All boards" or one
  board. Both can be set at once. It shows only once there are two boards.
- **Stats › Games** gets a **Boards** table under the Darts table, the same
  columns: games, darts thrown, 3-dart average (X01), checkout rate, trebles
  hit, first and last played; the same "not yet" thresholds (300 X01 darts, 50
  at a double, 300 single darts) and the same note under it. With a set of darts
  picked, the board table is for that set only (and the darts table, with a
  board picked, for that board only), so "Red 23g on each board" is one tap.
- Each match in a player's history says the board as well as the darts.
- Naming: the existing Stats tab **Board** (the heat map) keeps its name; the
  new things always say "boards" or the board's name, never just "Board".

## How it is built

- **Storage.** New table:
  ```
  boards (id TEXT PRIMARY KEY,  -- made up by the app, like dart_sets
          brand TEXT, model TEXT, bought INTEGER, notes TEXT,
          up INTEGER, down INTEGER,   -- ms; down NULL while on the wall
          created INTEGER NOT NULL)
  ```
  and `matches.board TEXT` (NULL = not known). Which board is on the wall is
  the one with `down IS NULL` (at most one; saving a board on the wall takes
  down any other with the same time). Added on start-up the way `details` was
  added to `dart_sets`, with the move of `settings.board` and the stamping of
  old games in the same step.
- **Checking.** Board fields checked as `cleanBoard` checks them now, in both
  `web/sync.js` and `server/db.py`, same limits (`BOARD_MAX`).
- **Starting a game.** The match record gains `board`: the board on the wall
  when the game started, set once and kept on every later save of that match.
  `save_match` stores it if it is a known board, otherwise NULL (as darts do).
  `MatchIn` gains `board: str | None = None`; older apps leave it out and their
  games are saved with no board.
- **Moving games.** `POST /api/boards/{id}/up` with `{since: ms | null}`: in one
  transaction, puts that board up, takes the other down, and sets `board` on
  matches started at or after `since` whose board is NULL or the board coming
  down. Returns the count. Offline, the app queues it with the other changes
  (`ops`) and moves its own saved copies the same way, so the app's figures
  match before it syncs. A later save of a moved match must not move it back:
  the server keeps the match's stored board when a save brings the board that
  was moved away from (builder to settle the simplest safe rule; an
  unfinished match being moved is the only case).
- **Sync.** Boards sync like darts: `boards` and `boardsq` in the store,
  `GET /api/boards`, `PUT /api/boards/{id}`, `DELETE /api/boards/{id}` (refused
  when a game uses it). An older server that doesn't know `/api/boards` is
  treated as "keep ours", as darts are (`refused(e)`).
- **Stats.** `_matches` and `stats()` take `board` as they take `darts`
  (`AND m.board = ?`); `/api/players/{id}/stats?board=`. `_gear` gains a board
  side (`_boards`): the per-board use and the per-board X01 and treble sums,
  grouped the way sets are, with the same thresholds, from one stats call.
- **Settings screen.** `boardPanel()` moves into the players section as a list;
  the `board` group entry in `renderSettings` goes. `saveBoard` becomes save
  and put-up actions on a board.
- **Tests.** `tests/test_db.py`: boards saved, checked, only one on the wall,
  removal refused when used, the start-up move (with and without
  `settings.board`), `save_match` stores and keeps the board, `/up` with and
  without `since` moves only the right games, stats filtered by board and by
  board and darts together. `tests/sync.test.mjs`: the same on the app side,
  boards and the put-up survive offline then sync. `tests/stats.test.mjs`: the
  boards table and its thresholds.
- **Docs and release notes.** `docs/using.md` (the Settings section and Stats);
  one line in `release.json` "unreleased": "Keep more than one board, and see
  your stats on each one, side by side."
- **Admin page.** Counts boards per account, and accounts with two boards that
  are ready to compare, like it does for darts (counts only, nothing new sent).

## Left to the builder

- Exact wording on buttons and notes, inside the conventions in
  `ui-genuine-not-ai` (plain words, the fixed scale of sizes).
- How the date picker looks on a phone.
- The rule that stops a resaved match moving back (above).

## Questions for Sam

1. **Your old games.** They all go to the board you've entered now. Did you
   play some of them on an older board you'd want split off? If so I'll add
   "move games before [date]" too.
2. **When.** Before or after the Christmas store release? I suggest after, as
   with darts: it changes the database and the store builds shouldn't change
   late.
