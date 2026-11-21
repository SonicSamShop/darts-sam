# Achievements Implementation Plan

> **For agentic workers:** work task by task, in order. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with the tests passing and one commit.

**Goal:** Players earn achievements (first game of X01, first 180, Big fish…). One pops up when it is earned, with a picture of the board when cameras scored the dart, and each player has an Achievements tab on the Stats page.

**Architecture:** An achievement is not stored. It is worked out on the device from the player's games: `web/achievements.js` makes a tally per game from a history entry (the shape `_history()` in `server/db.py` sends and `matchSheet()` in `web/sync.js` makes), tallies add up, and each achievement is a test on the total. In a game, `push()` compares what is held before and after the dart. Only the picture is kept: a JPEG per achievement beside the games, through two new addresses.

**Tech Stack:** Plain ES modules (no build), Node's built-in test runner, Python 3 + FastAPI + SQLite on the server.

**Spec:** `docs/superpowers/specs/2026-11-21-achievements-design.md` (read it first: the list of achievements, what counts, and the look are there and are not repeated here).

## Global Constraints

- `achievements.js` is plain data in, plain data out, like `stats.js`: nothing in it touches the page, the store or the network.
- No game's rules are written a second time. X01 legs come from `x01Legs()`; other games' end states come from `compute()` on a log rebuilt from the history entry.
- Computer players (`bot` set) earn nothing: never tallied, no slip, no tab.
- A typed visit (`darts === null`) can earn what its total says (Ton, Maximum, a checkout) and nothing that needs the beds.
- No change to the database schema or to what `sync.js` sends.
- No new font sizes or colours: each theme's existing scale and colours (memory: UI genuine, not AI-looking). No emoji, no pictures for badges.
- Every new file starts with the 3-line AGPL header the others have. Every new file under `web/` goes in the cache list in `web/sw.js`.
- Run everything with `python -m tests`. Node only: `npm test`.
- Other sessions commit to `main` in this folder at the same time: commit from a private git index, and only the files the task names (memory: concurrent sessions share the index).
- Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Nothing here is deployed by the builder. The server by the board and the hosted site pick the change up the way Sam releases any other.

## Review Focus

1. **Undo.** Undoing the dart that earned an achievement removes the slip, the end-of-game line and the picture. Holds because held-after is recomputed; Task 4 tests it, Task 8 tests the picture.
2. **Nothing shown twice.** Play again straight after a game: the game just finished must already be in the player's total (it may still be waiting to sync, and the kept stats reply won't have it). Task 4 has a test for exactly this.
3. **Never a wrong "first".** With no history on the device for a player, no slips for them in that game.
4. **Stats and achievements agree.** The 180 count behind the Maximum steps equals the stats page's "180s" tile for the same history. Task 2 asserts it against `x01Stats`.
5. **A picture can only be put where the account's own games are**, is a JPEG, and is small. Task 7 tests each refusal.
6. **Old games replay.** A history entry rebuilt into a log gives the same end state as the original game, including seeded games and visits ended early with Next. Task 3 tests it per game.

---

### Task 1: Tallies, and the Scoring achievements

**Files:**
- Create: `web/achievements.js`, `tests/achievements.test.mjs`
- Modify: `web/sw.js` (cache list)

**Interfaces (produced, used by every later task):**
- `tally(sheet, me) -> T`: what player index `me` did in one game. `T` is `{count: {key: n}, best: {key: n}, first: {key: visit index}, days: [yyyy-mm-dd]}`. `count` adds, `best` keeps the better (each key says whether higher or lower is better), `first` is where in this game a count first became non-zero (for "open the game at that visit").
- `add(a, b) -> T`, `EMPTY`.
- `ACHIEVEMENTS`: `[{id, group, mark, name, how, secret?, game?, steps?: [n], value: T => number, need?: n}]`. Held when `value(total) >= need` (default 1); with `steps`, one entry per step, ids `id:10`, `id:50`.
- `held(total) -> Set<id>`; `newly(before, after) -> [achievement]`, with a family's lesser ones dropped when a greater one is in the same list (Ton and Ton forty when Maximum is new).
- `timeline(sheets, meOf) -> [{id, at, match, visit}]`: every achievement a history earns, with the first game after which it is held.

- [ ] **Step 1: Tests first**, from small made-up sheets (a helper `sheet(game, opts, players, visits)` in the test file building the `_history` shape). At least: a 180 earns Ton, Ton forty and Maximum, and `newly` reports only Maximum; a typed 180 earns Maximum but three typed bulls can't earn Hat trick; T20 T20 T20 is Three in a bed, D20 S20 T20 is Shanghai, 20 5 1 in any order is Bed and breakfast and T20 T5 T1 is not; a bust visit earns no scoring achievement; `add` sums counts and keeps bests; ten sheets with one 180 each hold `maximum:10` and not `maximum:50`.
- [ ] **Step 2:** `npm test`: the new tests fail.
- [ ] **Step 3:** Write `tally` over `visitsOf(sheet)` for the Scoring group and the darts/days counts, then `add`, `held`, `newly`, `timeline`, and the Scoring entries of `ACHIEVEMENTS` with the spec's marks, names and "how" lines.
- [ ] **Step 4:** `npm test` passes. Add the file to `web/sw.js`.
- [ ] **Step 5: Commit** `feat: achievements worked out from a player's games (scoring)`.

---

### Task 2: First games, Finishing, Matches and Long service

**Files:** Modify `web/achievements.js`, `tests/achievements.test.mjs`

- [ ] **Step 1: Tests.** A finished X01 game earns "First game of X01" and an unfinished one doesn't; one entry per game in `GAMES` exists without being written out by hand, and finishing all of them earns "Been round the board"; a 170 checkout earns Game shot, Ton-plus finish and Big fish; a D1 finish earns Madhouse and a typed finish of 2 doesn't; a bull finish; a 501 leg won in 15 darts earns the 18- and 15-darter and not the 12; a 301 leg in 9 darts earns none of them; a solo win earns no First win, a win over a computer player earns First win and Beat the computer; a 3-0 match is a Whitewash and 3-1 is not; darts thrown, games finished and days at the board cross their steps. And the check from Review Focus 4: for one made-up history, `total.count.t180` equals `x01Tile('t180').rows(x01Stats(history)).length`.
- [ ] **Step 2:** Fails.
- [ ] **Step 3:** Extend `tally` with `x01Legs(sheet)` (legs won, checkouts, darts per 501 leg, legs lost in a won match) and with the game-level facts (finished, won, players, whether an opponent was a computer player and its level). A history entry carries player names, not who is a bot: add `bots` (levels by position, `null` for a person) to what `tally` is given, passed by the caller, and say so in the interface comment.
- [ ] **Step 4:** Passes.
- [ ] **Step 5: Commit** `feat: achievements for finishing, winning and long service`.

**Check before starting:** how the app knows a history entry's opponent was a computer player. `_sheet()` sends names only. If the names can't be matched to `players` reliably (a renamed or removed bot), add `"bots"` to `_sheet()` in `server/db.py` (from `players.bot`) and to `matchSheet()`, with a test in `tests/test_db.py`. That is a reply gaining a field, not a schema change.

---

### Task 3: The other games' achievements, from the engine

**Files:** Modify `web/achievements.js`, `tests/achievements.test.mjs`

**Interfaces:** `logOf(sheet) -> log` (each dart of a visit as `{t:'dart', seg, mult}`, a typed visit as `{t:'visit', total, darts}`); `endOf(sheet) -> state` (`compute({gameId, players, opts, log})`).

- [ ] **Step 1: Tests.** For each of Cricket, Around the Clock, Bob's 27, Bermuda, Killer, 121 Checkout and Random Checkout: play a short game through the engine, turn it into a sheet with `matchSheet()`, and assert `endOf(sheet)` has the same winner and scores as the original (this is Review Focus 6; include a game where Next was pressed after one dart, and a seeded Random Checkout). Then one earned and one not-earned case per achievement in the spec's "Other games" table.
- [ ] **Step 2:** Fails.
- [ ] **Step 3:** Write `logOf`, `endOf`, and read each game's facts from its end state. Read each module first: the spec's wording for 121 Checkout ("check out 121") and Random Checkout ("make every target") must match what those games really record; if a game doesn't expose the fact, change the achievement's test to one it does and note it in the spec rather than adding state to the game.
- [ ] **Step 4:** Passes.
- [ ] **Step 5: Commit** `feat: achievements for Cricket, Killer and the training games`.

---

### Task 4: Knowing it as the dart lands

**Files:**
- Modify: `web/app.js` (match start, `push()`, `undo()`, `renderGame()`, settings), `web/sync.js` (hand out the finished games waiting to sync), `web/style.css`
- Test: `tests/achievements.test.mjs`, `tests/sync.test.mjs`

**Interfaces:**
- `sync.js`: `waitingSheets() -> [sheet]` beside `waitingGames()`, from `pending` (not the quit ones).
- `achievements.js`: `standing(history, waiting, live) -> T` (the total from a kept history plus waiting games not already in it by id, leaving the live game out), and `earnedBy(base, before, after, me) -> [achievement]`. Keeping these two pure is what makes Review Focus 2 and 3 testable without the page.
- `app.js`: `bases` (player id → total, or `null` when there is no history on the device), filled when a match starts or is picked up again after a reload; `slips` (what is on show).

- [ ] **Step 1: Tests** for `standing` and `earnedBy`: the game just finished and still waiting is counted once when the kept history already has it and once when it hasn't; a first 180 in the live game is new, a second isn't; with the earning dart taken off the log again nothing is held; a `null` base earns nothing.
- [ ] **Step 2:** Fails. **Step 3:** Write them.
- [ ] **Step 4: In the app.** At match start, for each person playing: the kept stats reply (`loadStats(statsPath(id))`, short timeout, falling back to the kept copy) gives the history. In `push()`, after `compute`: for each person, `earnedBy`; show a slip and add the call after the score (`…One hundred and eighty. Sam, Maximum`). In `undo()`: recompute and drop slips no longer earned. In `renderGame()` when the game is won: the line `Achievements this game: …` under the result banner, worked out from held-with-the-game minus held-without.
- [ ] **Step 5: The slip.** A `.banner` fixed at the top of the game screen (above the scoreboard in TV view), one at a time, about 6 seconds each, queued. Tap closes it during a game; once the game is over a tap opens that player's Achievements tab. Slides in; under `prefers-reduced-motion` it just appears. It must not take taps meant for the board: check at phone width.
- [ ] **Step 6: The setting.** `settings.achievements !== false`, a `switchRow` in the "In a game" section beside "Checkout hints": **Show achievements as they are earned**. Off: no slip, no call, no end-of-game line.
- [ ] **Step 7:** `python -m tests` passes. By hand on throwaway data (memory: screenshots recipe): a first 180 pops and is called; Undo removes it; Play again and a second 180 doesn't pop "first"; with the setting off nothing shows.
- [ ] **Step 8: Commit** `feat: an achievement pops up, and is called, as it is earned`.

---

### Task 5: The Achievements tab

**Files:** Modify `web/app.js` (`STAT_TABS`, `drawPlayers()`, the drill-down), `web/style.css`

- [ ] **Step 1:** Add `['achievements', 'Achievements']` to `STAT_TABS`. The pane is drawn from `timeline(deep(st).matches, …)` for the player chosen, so it uses the stats reply already on the page and nothing is fetched for it. The Game picker narrows to achievements with that `game`; the Darts picker is ignored here (the reply is then only part of the history: fetch the unfiltered one for this tab).
- [ ] **Step 2:** Heading `Achievements · 12 of 45`, then the spec's groups as ruled lists in the stats page's existing ledger style. Held first within a group, with the date on the right; a stepped one as one line (`Maximum ×10 · 12 so far, next at 50`); not held, muted with how far along where there is a number; a secret one not held as a blank badge and "A surprise".
- [ ] **Step 3:** A held line opens the achievement's own view through the existing drill-down (`drill`, `drawDrill`): badge, name, how, date, and **Open the game**, which goes to that game's scoresheet at the visit (`timeline`'s `match` and `visit`), the way a figure's list already opens one.
- [ ] **Step 4:** The line for players with games from before: `These come from every game on record, so some are from before achievements existed.` Shown while any held achievement is dated before the release that added the tab; no stored flag.
- [ ] **Step 5:** A computer player chosen in the picker: the tab says they earn none.
- [ ] **Step 6:** By hand: phone width and the wide layout (`BIG`), a player with nothing, a player with history. **Commit** `feat: Achievements tab on the Stats page`.

---

### Task 6: The badge, in each theme

**Files:** Modify `web/app.js` (one function, `badge(a, size, held)`, returning inline SVG), `web/style.css`, `web/themes.css`

- [ ] **Step 1:** One round pin with the achievement's `mark` lettered on it; three sizes (list line, slip, the achievement's view); held is filled, not held is the outline only. Marks are up to four characters ("100+"): fit the lettering by mark length, using steps of the theme's scale.
- [ ] **Step 2:** Per theme, with colours the theme already has: Classic gold on the dark; Chalk a chalked ring in Playpen Sans; Scoresheet a rubber stamp; Stage and Arcade in their accent.
- [ ] **Step 3:** Look at all five themes, on the tab, in the slip and on the achievement's view, at phone width. Retake any shot in `web/shots` that now shows the Stats tabs (memory: screenshots recipe).
- [ ] **Step 4: Commit** `feat: achievement badges drawn in each theme`.

---

### Task 7: Keeping a picture (server)

**Files:**
- Create: `server/photos.py`, `tests/test_photos.py`
- Modify: `server/data_api.py` (two addresses), `server/db.py` (`delete_match`), `server/limits.py` if the address needs a smaller limit of its own, `server/host.py` only if the account's room (`full()`) doesn't already count files beside the database

**Interfaces:**
- `photos.folder(db_path) -> Path`: `photos/` beside the database, so `data/photos/` at home and the account's own folder on the site.
- `photos.save(db_path, match_id, key, body)`, `photos.read(...) -> bytes | None`, `photos.drop(db_path, match_id, key=None)`.
- `PUT /api/matches/{match_id}/photos/{key}` (body: the JPEG), `GET` the same, `DELETE` the same.

- [ ] **Step 1: Tests**, each a refusal that must hold: a body that doesn't start with the JPEG marker; one over 400 KB; a `match_id` or `key` that isn't a plain word (`[\w:-]`, no dots or slashes: the step ids use a colon); a match that isn't in this database (so an account can only put pictures beside its own games); more than one file per key (a second PUT replaces). Then: GET gives back what was put with `image/jpeg`; `delete_match` removes the game's folder; on the hosted site one account can't read another's (through `make_router`'s `db_file`).
- [ ] **Step 2:** Fails. **Step 3:** Write it. `data_api.make_router` already gets each request's database from `db_file`; the folder comes from that path and nothing else.
- [ ] **Step 4:** Check the account's room on the site counts the pictures, and that deleting an account still removes everything (it deletes the folder). `tools/backup.sh` takes the whole data folder: confirm it does.
- [ ] **Step 5:** `python -m tests` passes. **Commit** `feat: keep a picture with an achievement (server)`.

---

### Task 8: Taking and showing the picture (app)

**Files:** Modify `web/app.js`, `web/phoneui.js` or `web/phonecam.js` (hand out the current frame as a JPEG blob), `web/style.css`, `web/privacy.html`

- [ ] **Step 1:** In `push()`, when an achievement is new and the dart that earned it has `src: 'cam'` (or came from the phone's own camera), and pictures are allowed: fetch `/api/cameras/<first camera that is on>/snapshot.jpg` (on the hosted site this already goes down the pairing to the cameras' computer), or take the phone's frame. Scale to at most 1280 wide on a canvas, JPEG, under 400 KB. `PUT` it. Two seconds for the whole thing; on any failure, no picture and nothing queued. It must never hold up the dart being shown or called.
- [ ] **Step 2: Allowed?** `settings.photos`: at home (the server by the board, the desktop app) it starts on. On the hosted site, and whenever the phone's own camera is scoring, it starts unanswered: the first time there is a picture to keep, ask once, over the end of the game rather than mid-visit (`Keep a picture of the board with your achievements? It is kept with your games and nowhere else.` Keep / No thanks), and take none until answered. A `switchRow` in Settings under the achievements one: **Keep a picture of the board with an achievement**.
- [ ] **Step 3: Undo** of the earning dart: `DELETE` the picture. Quit without saving and deleting a game are covered by the server.
- [ ] **Step 4: Showing it.** In the slip, small, beside the badge, once it has arrived. On the tab, a small one at the end of the line; on the achievement's view, full width, a tap shows it alone. A missing picture (404) leaves no gap.
- [ ] **Step 5:** `web/privacy.html`: what the picture is, that it is kept only with the player's own games, never shared and never in a problem report, how to turn it off, and that it goes when the game or the account goes. Check `share.py` and `reportsync.py` send nothing from `photos/`.
- [ ] **Step 6:** By hand, at the real board: a camera-scored achievement keeps a picture with the darts in it; the same by tapping keeps none; Undo removes it. With the phone's camera: asked first, and nothing leaves the phone before the answer.
- [ ] **Step 7: Commit** `feat: a picture of the board with an achievement the cameras scored`.

---

### Task 9: Telling people

**Files:** Modify `web/rules.html` (or `web/faq.html`), `release.json`, `docs/architecture.md`, `README.md` if it lists features

- [ ] **Step 1:** A short "Achievements" section listing them by group, leaving the two surprises out.
- [ ] **Step 2:** `release.json` "unreleased": player-facing lines for achievements and for the picture (memory: release notes upkeep).
- [ ] **Step 3:** `docs/architecture.md`: `achievements.js` in the table of `web/`, `photos.py` in the server's, and `data/photos/` under "Where things are kept".
- [ ] **Step 4:** `python -m tests`. **Commit** `docs: achievements`.

## Order and cutting

Tasks 1 to 6 are the feature and need nothing from the server. Tasks 7 and 8 are the picture and can ship in a later release without changing anything before them. If time before Christmas is short, cut Task 3 (the other games' achievements) first, then the picture.
