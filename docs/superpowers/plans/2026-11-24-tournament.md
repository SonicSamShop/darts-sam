# Tournament (first release) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A knockout tournament for 3 to 16 players (people and bots) on one board: set up, a draw-sheet bracket with the winner animating forward, bot-v-bot matches played out by themselves, saved and synced, with a winner's screen and past tournaments.

**Architecture:** Pure bracket logic in `web/tournament.js` (no DOM), the bracket's drawing and animation in `web/screens/bracket.js`, the screen in `web/screens/tournament.js`. Matches are ordinary matches started through a `start.js` that now takes its players and options as arguments. Tournaments are a new household record: a `tournaments` table, `/api/tournaments`, and a queue in `sync.js`, built the way boards are.

**Tech Stack:** Vanilla ES modules in `web/`, `node --test` for JS tests; Python 3.11 FastAPI + SQLite in `server/`, tests run as `python -m tests.<name>`.

**Spec:** `docs/superpowers/specs/2026-11-24-tournament-design.md` (read it first). Approved prototype of the look and animation: https://claude.ai/artifact/4gTvdzDhZnZtrkxMNiekUt (its source is the spec's "Prototype" numbers).

## Global Constraints

- First release only (spec "In what order"): **no** Withdraw/walkover, **no** two-screen result merge (last save wins).
- Knockout only, X01 only, 3 to 16 entrants, bracket size = next power of two, byes never meet.
- Round lengths: legs only (x01 `sets` stays 1). Defaults: first to 2 legs, first to 3 in the final.
- Name: 1 to 40 characters; default "Christmas <year>" from 20 to 31 December, else "Tournament <d> <Mon>" (e.g. "Tournament 24 Nov").
- Round names by distance from the final: Final, Semi-finals, Quarter-finals, then "Last 16". Column after the final: "Winner".
- Look (from the approved prototype): boxes 156 × 34, 46 between rows, 40 between rounds; "next" and "simulated" in `--accent` above a match; winner's box travels out, down/up, in over 0.9 s after a 0.35 s pause, its wire lighting behind it; "Simulating Bot 5 v Bot 9…" for 0.7 s before a bot match plays out; loser's box dims to 0.4. Colours only from theme tokens (`--text`, `--muted`, `--line`, `--accent`) so every theme works. `prefers-reduced-motion`: no animation; a tap on the bracket skips it.
- Copy in the README's plain voice; no PDC / World Championship names; no trophies or confetti (memory: ui-genuine-not-ai).
- Every new file starts with the AGPL header the other files have.
- Other sessions commit to `main` in this folder at the same time: commit from a private index (`GIT_INDEX_FILE=$(mktemp -d)/index git read-tree HEAD`, then `git add` only your files).
- Add the player-facing line to `release.json` "unreleased": "Tournaments: a knockout for 3 to 16 players, people and bots, on one board."

## Review Focus

1. **A bot made offline** (negative player id) enters a tournament before the first sync: the tournament must not be sent until the id is remapped, and must show the right names after. (Task 3 test.)
2. **A refresh or the app closing mid-match or just after the winning dart:** on load the result must still reach the bracket. (Task 2 `reconcile` test.)
3. **Two bots at the same level** are the same player: the second "+ Bot" takes the next free level. (Task 2 `freeLevel` test.)
4. **Odd sizes** (3, 5, 9, 11 players): byes never meet, every first-round match has at least one player, and the person with a bye appears in round 2 at once. (Task 2 test over 3..16.)
5. **Quitting a tournament match** leaves the slot playable again, and the bracket's main button offers it. (Task 2 `dropMatch` test.)

---

### Task 1: Server: tournaments table and addresses

**Files:**
- Modify: `server/db.py` (SCHEMA; new section "tournaments" after boards)
- Modify: `server/data_api.py` (model `TournamentIn`, three routes)
- Create: `tests/test_tournaments.py`
- Check: `server/host.py` / `server/hoststore.py` call `db.prepare` on existing account files (so the new table appears there). If an existing account file would not get it, add a test in `tests/test_hoststore.py`.

**Interfaces:**
- Produces (Python): `db.save_tournament(tid: str, t: dict) -> bool` (t: `seq, name, data, created, finished, abandoned, winner`; False when a stored copy has `seq >=` the new one; raises `db.Invalid` for an empty or >40-char name, or a `winner` that is not a known player id), `db.list_tournaments() -> list[dict]` (newest `created` first), `db.get_tournament(tid) -> dict` (raises `db.NotFound`). Dict shape out: `{id, seq, name, data, created, finished, abandoned (bool), winner}` with `data` parsed from JSON.
- Produces (HTTP): `PUT /api/tournaments/{id}` → `{"ok": true, "saved": bool}`; `GET /api/tournaments` → list; `GET /api/tournaments/{id}` → one (404 if none).

- [ ] **Step 1: Write the failing tests** in `tests/test_tournaments.py`, in the style of `tests/test_boards.py` (temp db via `db.init(path)`):
  - `test_saved_and_listed`: save `t1` (created 1) and `t2` (created 2) → `list_tournaments()` ids `['t2','t1']`; `get_tournament('t1')['data'] == {...}` as given.
  - `test_older_copy_ignored`: save seq 2 then seq 1 → second returns False and the name is still seq 2's.
  - `test_name_checked`: name `''` and `'x'*41` raise `db.Invalid`.
  - `test_winner_must_be_a_player`: winner 999 raises `db.Invalid`.
  - `test_missing`: `get_tournament('nope')` raises `db.NotFound`.
  - `test_api_round_trip` via FastAPI `TestClient` (as `tests/test_data_api.py` does): PUT then GET list and one; GET of an unknown id is 404.
- [ ] **Step 2: Run** `python -m tests.test_tournaments` — expect failures (no `save_tournament`).
- [ ] **Step 3: Implement.** Table as in the spec's "Saving" section (`id, seq, name, data, created, finished, abandoned, winner_id`). `ON CONFLICT(id) DO UPDATE` like `save_match`. Add the three routes inside `make_router`, wrapped in `with db.at(db_file(request))` and `_db(...)` like the others.
- [ ] **Step 4: Run** `python -m tests.test_tournaments` and `python -m tests.test_db` and `python -m tests.test_data_api` — all pass.
- [ ] **Step 5: Commit** `feat: tournaments table and /api/tournaments`.

---

### Task 2: The bracket's rules (pure)

**Files:**
- Create: `web/tournament.js`
- Create: `tests/tournament.test.mjs`

**Interfaces:**
- Consumes: `newMatch`, `compute`, `gameById` from `web/engine.js`; `botLevel` from `web/bot.js`.
- Produces — the record (spec "Saving"), `t`:
  `{ id, seq, name, created, finished: null|ms, abandoned: false, winner: null|id, data: { opts: {start, out}, rounds: [{legs}], entrants: [{id, name, bot?}], slots: [{round, a, b, match: null|id, winner: null|id, legs: null|[la, lb], how: null|'played'|'bye'|'simulated'}] } }`
  where `a`/`b` are player ids, `null` (not known yet) or `'bye'`. Slots are ordered round by round, and within a round top to bottom; slot `i` of round `r+1` is fed by slots `2i` and `2i+1` of round `r`.
- Functions (all return new objects; none mutate their input):
  - `seedOrder(N: number) -> number[]` — standard bracket positions (1 meets N; e.g. `seedOrder(8)` = `[1,8,4,5,2,7,3,6]`).
  - `makeDraw({id, name, entrants, opts, rounds, now}, random = Math.random) -> t` — shuffles entrants into `seedOrder` positions, seeds past the count are `'bye'`, byes decided at once (`how: 'bye'`, winner placed in round 2).
  - `roundName(t, r) -> string` and `roundCount(t) -> number`.
  - `defaultRounds(n: number) -> [{legs}]` — 2 legs each, 3 in the final.
  - `suggestName(date: Date) -> string` — per Global Constraints.
  - `freeLevel(level: number, taken: number[]) -> number|null` — `level` if free, else the next free level up, then down; null if all 15 taken.
  - `readySlots(t) -> number[]` — undecided slots with both players known.
  - `nextSlot(t, isBot: id => bool) -> number|null` — first ready slot in order that is not bot v bot.
  - `botSlots(t, isBot) -> number[]` — ready bot-v-bot slots.
  - `startSlot(t, i, matchId) -> t`, `dropMatch(t, i) -> t` (match quit: `match` back to null).
  - `recordResult(t, i, winner, legs, how) -> t` — sets the slot, places the winner in the next slot's `a` (from an even slot) or `b` (odd); the final sets `t.winner` and `t.finished`.
  - `clearResult(t, i) -> t` — undo of the winning dart: only while the next slot has no `match` and no `winner`; otherwise returns `t` unchanged.
  - `reconcile(t, matchById: id => match|null) -> t` — for every slot with a `match` and no `winner`, if `compute(match).winner != null`, records it with `legs` = `compute(m).legs` (with sets at 1 the won state still holds each player's legs; x01.js does not reset them on the winning leg) and `how: 'played'` (or `'simulated'` when both seats are bots).
  - `remapIds(t, old, id) -> t` — swaps a player id everywhere (entrants, slots, winner).
  - `simulateMatch(t, i, ids: [a, b], levels: [la, lb], random) -> match` — a whole x01 match with `newMatch('x01', names, {...t.data.opts, legs: rounds[r].legs, sets: 1, tournament: {id: t.id, slot: i}})`, pushing `{t: 'dart', ...x01.bot(s, botLevel(level), random), src: 'bot', ts}` for the seat in `s.current` until `compute(m).winner != null`. Returns the match (the caller gives it `id`, `playerIds`, `bots`, `seq` and saves it like any).

- [ ] **Step 1: Write the failing tests** in `tests/tournament.test.mjs` (seeded `random` from a tiny LCG so draws repeat):
  - `seedOrder` for 4 and 8 equals `[1,4,2,3]` and `[1,8,4,5,2,7,3,6]`.
  - For every n in 3..16: bracket size is the next power of two; no first-round slot is `'bye'` v `'bye'`; every entrant appears exactly once in round 1; each bye's player is already in round 2.
  - `defaultRounds(5)` → `[{legs:2},{legs:2},{legs:3}]`; `roundName` for an 8-bracket → `['Quarter-finals','Semi-finals','Final']`, for 16 the first is `'Last 16'`.
  - `suggestName(new Date(2026, 11, 24))` → `'Christmas 2026'`; `(2026, 10, 24)` → `'Tournament 24 Nov'`; `(2026, 11, 19)` → `'Tournament 19 Dec'`.
  - `freeLevel(5, [5])` → 6; `freeLevel(15, [15])` → 14; all 15 taken → null.
  - Results move on: 4 players, record slot 0 then slot 1 → final slot has both; record the final → `t.winner` set, `t.finished` a number.
  - `clearResult` takes a winner back out of the next slot; after the next slot has `match` set it changes nothing.
  - `nextSlot` skips a bot-v-bot slot; `botSlots` lists it.
  - `dropMatch` (Review Focus 5): start slot 0, drop it → `match` null and `nextSlot` is 0 again.
  - `reconcile` (Review Focus 2): a slot whose match is won (build one with `simulateMatch`) and `winner` null → filled with the right winner and legs.
  - `remapIds(t, -3, 42)` replaces -3 in entrants, slots and winner (Review Focus 1).
  - `simulateMatch` with levels 15 v 1, first to 2 legs: `compute(m).winner != null`, the winner has 2 legs, every log entry has `src: 'bot'`.
- [ ] **Step 2: Run** `node --test tests/tournament.test.mjs` — fails (no module).
- [ ] **Step 3: Implement** `web/tournament.js` with the signatures above.
- [ ] **Step 4: Run** `npm test` — all pass.
- [ ] **Step 5: Commit** `feat: tournament bracket rules`.

---

### Task 3: Sync tournaments

**Files:**
- Modify: `web/sync.js` (store keys `tournaments`, `tournamentsq`; header comment list)
- Modify: `tests/sync.test.mjs`

**Interfaces:**
- Consumes: `remapIds` from `web/tournament.js`.
- Produces on the object `createSync` returns: `saveTournament(t) -> void` (stores with `seq` + 1, queues its id), `tournaments() -> t[]` (newest `created` first), `tournament(id) -> t|null`. `waiting()` counts `tournamentsq`.
- `pushTournaments()` runs after `pushMatches` in the sync: PUT `/tournaments/{id}` with `{seq, name, data, created, finished, abandoned, winner}`; skips (keeps queued) any whose entrants include a negative id; refused → dropped from the queue (like boards); leaves the id queued if the record changed while sending.
- `pull()` adds `api('/tournaments').catch(older)`; keeps local copies still queued, takes the server's for the rest.
- `remap(old, id)` also runs `remapIds` on every stored tournament.

- [ ] **Step 1: Write the failing tests** in `tests/sync.test.mjs`, using the file's existing fake store/api:
  - save → PUT sent with seq 1, queue empty after.
  - a tournament with an entrant id -2: not sent; after the player add is answered with id 7, it is sent with 7 in entrants and slots.
  - pull replaces an unqueued local copy with the server's and keeps a queued one.
  - a server too old for `/tournaments` (404) leaves local ones alone.
- [ ] **Step 2: Run** `node --test tests/sync.test.mjs` — new tests fail.
- [ ] **Step 3: Implement** in `sync.js` following `pushBoards`/`pull`'s boards lines.
- [ ] **Step 4: Run** `npm test` — all pass.
- [ ] **Step 5: Commit** `feat: tournaments sync`.

---

### Task 4: Starting a match with given players

**Files:**
- Modify: `web/screens/start.js` (`askFirst`, `openBull`, `bullDart`/`bullBot`, `randomOrder` use, `startMatch`)
- Modify: `web/app.js` (`randomOrder`, the `start`/`rematch` cases), `web/screens/game.js` (rematch passes the same)

**Interfaces:**
- Produces: a "who plays" value `play = {gameId, ids, opts, tournament?: {id, slot}}`. `homePlay() -> play` (in `start.js`: `{gameId: setup.gameId, ids: seats(), opts: startOpts()}`, BOT mapped to `botPlayer(botAt().level)` at start as today). `askFirst(act, play)`, `openBull(act, play)`, `startMatch(act, play, order?)`, `randomOrder(ids) -> ids`. `isBotId(id) -> bool` (exported from `app.js`: `id === BOT || bots.some(b => b.id === id)`), `levelOf(id) -> number|null`.
- The match made carries `opts.tournament` when `play.tournament` is set; `match.bots` is filled from each id's bot level (as now).
- The bull screen throws for a seat when `isBotId(next)`, at that id's own level.

- [ ] **Step 1:** Refactor so the home screen passes `homePlay()` everywhere it called these; no behaviour change for the home screen.
- [ ] **Step 2: Verify** `npm test` passes, then in a headless browser (recipe: memory "screenshots-recipe"; throwaway data) start 501 with two people (closest to bull, then random) and with a person v Bot 5 (closest to bull: the bot throws its bull dart by itself). Expected: each game starts with the right players and order.
- [ ] **Step 3: Commit** `refactor: start a match from given players and options`.

---

### Task 5: Tournament screen: set up, play, back

**Files:**
- Create: `web/screens/tournament.js`
- Modify: `web/screens/home.js` (a "Tournament" line under the game list; "In progress": "Back to the tournament: <name>, <next match>")
- Modify: `web/app.js` (screen `'tournament'`, `#/tournament` address in the routing at lines ~418-460, click cases)
- Modify: `web/screens/game.js` (won tournament match: "Back to the tournament" in place of "Play again"; record on win, clear on undo of the winning dart; quit → `dropMatch`)
- Modify: `web/style.css` (only what the setup form needs, from existing classes first)

**Interfaces:**
- Consumes: Task 2 functions; Task 3 `data.saveTournament/tournaments/tournament`; Task 4 `askFirst(act, play)`, `isBotId`, `levelOf`, `botPlayer`.
- Produces: `renderTournament()`, `tourView = {id: null|string, setup: {...}|null}` state object (as other screens' state objects), `currentTournament() -> t|null` (the one not finished and not abandoned, newest), `onMatchWon(match)`, `onMatchUndone(match)`, `onMatchQuit(match)` — called from `game.js` when `match.opts.tournament` is set.
- Setup form (spec "Setting one up"): Name (prefilled `suggestName`), people chips, "+ Bot" chip with − / + (level from `freeLevel`), Game (start 301/501/701, out double/straight from x01's options), one "first to N legs" stepper per round (`defaultRounds`, re-made when the player count changes the round count), Draw → shows the bracket (Task 6 draws it; until then a plain list is fine), Redraw, Start (saves). Draw disabled under 3 or over 16 entrants with the reason shown.
- Bracket screen buttons: "Play <A> v <B>" (`nextSlot`) → `askFirst('start', play)`; "Abandon tournament" (asks once in-page, then `abandoned: true`).
- On load of the screen: `reconcile` against the current match and pending matches, then play out `botSlots` one by one (`simulateMatch`, saved through `data.saveMatch` with `id`, `playerIds`, `bots`, `seq: 1`, `board: data.wallBoard()`), saving the tournament after each.

- [ ] **Step 1:** Build setup and the Play/back loop, with the list placeholder for the bracket.
- [ ] **Step 2: Verify** headless: 5 players incl. 2 bots → Draw → Start → play each person match by typing visits until a winner (the bot's darts throw themselves) → back → next. Reload mid-match and just after the winning dart: the result is in the bracket. Quit a match: it is offered again. `npm test` passes.
- [ ] **Step 3: Commit** `feat: tournament set up and played`.

---

### Task 6: The drawn bracket and its animation

**Files:**
- Create: `web/screens/bracket.js`
- Create: `tests/bracket.test.mjs`
- Modify: `web/screens/tournament.js` (use it), `web/style.css` (`.bracket` rules, tokens only)

**Interfaces:**
- Produces: `layout(t) -> {w, h, x(r), ys: number[][]}` (pure; constants BW 156, BH 34, ROW 46, GAP 40, TOP 44 from the prototype), `wirePath(L, r, k) -> string` (pure), `drawBracket(svg, t, {hide: Set<slotIndex>, next: slotIndex|null, nameOf})`, `animate(svg, t, slotIndex, {nameOf, reduced, skip: () => bool}) -> Promise<void>`.
- Port from the prototype's `geo`, `render`, `animateResult` (same timings). Which results are still to animate: kept per device in `store` key `tourSeen` (`{[tournamentId]: slotIndex[]}`), so opening the bracket again doesn't replay them; byes are marked seen at the draw.
- Fills its screen: the SVG scales to the space (not `fit()`); when that would make 15 px names smaller than the theme's `--sz-fine`, its box scrolls sideways (`overflow-x: auto`) and opens scrolled to the round with the next match.

- [ ] **Step 1: Write the failing tests** in `tests/bracket.test.mjs`: for an 8-bracket, `ys[1][0] === (ys[0][0] + ys[0][1]) / 2` and `ys[3][0]` is the middle of round 0; `layout(t).w === 4 * 156 + 3 * 40`; `wirePath(L, 0, 1)` ends at `x(1)` and the y of `ys[1][0] + 17`.
- [ ] **Step 2: Run** `node --test tests/bracket.test.mjs` — fails.
- [ ] **Step 3: Implement** `bracket.js` and wire it into the screen: results unseen are animated in bracket order on arrival; bot-v-bot slots show "Simulating A v B…" for 0.7 s, then play out and animate; a tap skips; reduced motion draws the end state at once.
- [ ] **Step 4: Run** `npm test`; headless screenshots of the bracket at phone (390 px), tablet and 1920×1080 with 6 and 16 players, in Chalk and Classic, and one frame part way through an animation. Compare with the prototype.
- [ ] **Step 5: Commit** `feat: tournament bracket drawn like a draw sheet, winners move on`.

---

### Task 7: Winner, past tournaments, removing players, release note

**Files:**
- Modify: `web/screens/tournament.js` (winner's screen; Past tournaments list; a finished bracket opened from it)
- Modify: `web/screens/playerspanel.js` (`removePlayer`: refuse while in a running tournament)
- Modify: `release.json` ("unreleased" line from Global Constraints)

**Interfaces:**
- Consumes: Task 5 `currentTournament()`, Task 3 `data.tournaments()`.
- Winner's screen: "<name>" large, "wins <tournament name>", "Final: <A> <la> – <lb> <B>", buttons "See the bracket" and "Menu"; score calling says "<name> wins <tournament name>". Shown after the final's animation.
- Past tournaments: one line each, newest first: name, date, winner (or "abandoned").
- Remove refusal text: "<Name> is still in <tournament name>. Finish or abandon it first." (Withdraw comes in the second release.)

- [ ] **Step 1:** Build the three, and the release note.
- [ ] **Step 2: Verify** headless: the 5-player tournament from Task 5 to the winner's screen; it then shows under Past tournaments and opens to its bracket; removing a player who is in a running one shows the refusal; abandoning lists it as abandoned. `npm test` and `python -m tests` pass.
- [ ] **Step 3: Commit** `feat: tournament winner and history`.
