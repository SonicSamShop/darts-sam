# Training Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Play screen's games into Matches and Training, and add Bob's 27, Shanghai, Bermuda, Segment Training, Random Checkout, Gotcha, and a Round the World option on Around the Clock.

**Architecture:** Every game is a pure module in `web/games/` replayed from the match log by `web/engine.js` (read the hook list at the top of that file before starting). Per-game stats are replayed again on the server in `server/db.py` (`GAME_STATS`) and labelled in `web/app.js` (`GAME_TILES`). The installed app caches every file listed in `web/sw.js`.

**Tech Stack:** Plain ES modules (no build), Node's built-in test runner, Python 3 + SQLite on the server.

**Spec:** `docs/superpowers/specs/2026-11-21-training-area-design.md`

## Global Constraints

- Every new game works for 1 to N players, each with their own score (except Gotcha: 2+). With 2+, the best result wins; ties go to the earlier player in throwing order (as Count Up does).
- New games take darts one at a time: no `visit()` hook. `app.js:1735` then hides "Type scores" by itself.
- Rules text, blurbs, hints and caller lines in our own plain words. Nothing copied from Autodarts.
- Each module gets `kind: 'match' | 'training'`.
- Every new module file: the 3-line AGPL header used by the existing modules.
- Every new module is added to `GAMES` (`web/games/index.js`) and to the cache list in `web/sw.js:18`.
- A finished practice game sets `s.winner` (the best player, `0` when solo) and provides `result(s)`, so the caller says "Game over. …".
- Lettering and sizes follow the existing theme scale (memory: UI genuine, not AI-looking). No new font sizes.
- Run all tests with `python -m tests` (Python and Node). Node only: `npm test`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only the files each task names: the tree has unrelated uncommitted edits in `web/app.js`, `web/games/killer.js`, `web/style.css`, so stage hunks (`git add -p`) in those files.

## Review Focus

1. **Undo across a visit boundary** (Bob's 27 penalty, Bermuda halving): undoing the third dart must give back the penalty. Holds because state is replayed; each game task has an undo test.
2. **"Next" before three darts** (player taps Next after one dart): the remaining darts count as misses, so the end-of-visit rule (penalty, halving, Shanghai check) must still fire. Each visit-scored game has a test with `NEXT` after one dart.
3. **A solo game ending** must set `winner = 0` and give a `result()` line, not "Player wins". Tested per game.
4. **Old saved Around the Clock games** have no `hit` option: they must replay and score exactly as before. Tested in Task 7 (JS and Python).
5. **Gotcha with one player** must not start. Tested in Task 8.

---

### Task 1: Matches and Training groups on the Play screen

**Files:**
- Modify: `web/games/*.js` (add `kind` to each of the 8 existing modules)
- Modify: `web/games/index.js` (order)
- Modify: `web/app.js:991-993` (Game step)
- Modify: `web/style.css` (group heading)
- Test: `tests/games.test.mjs`

**Interfaces:**
- Produces: `kind` on every module; `GAMES` order within each kind is display order. Later tasks insert their module into `GAMES` and extend the expected lists in the test `games are grouped into matches and training`.

- [ ] **Step 1: Write the failing test**

```js
import { GAMES } from '../web/games/index.js';
test('games are grouped into matches and training', () => {
  const ids = k => GAMES.filter(g => g.kind === k).map(g => g.id);
  assert.deepEqual(ids('match'), ['x01', 'cricket', 'killer']);
  assert.deepEqual(ids('training'), ['clock', 'c121', 'countup', 'random', 'free']);
  assert.ok(GAMES.every(g => g.kind === 'match' || g.kind === 'training'));
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL on the new test.
- [ ] **Step 3: Add `kind` to each module and reorder `GAMES`** to `[x01, cricket, killer, clock, c121, countup, random, free]`.
- [ ] **Step 4: Render two groups in the Game step.** Replace the single `.games` grid with, for each kind in order `match`, `training`: `<h3 class="group">Matches</h3>` / `<h3 class="group">Training</h3>` followed by its own `.games` grid of the same cards. Style `h3.group` in `style.css` from an existing small heading size; no new size.
- [ ] **Step 5: Run `npm test`.** Expected: PASS. Then view the Play screen at phone width (see memory: screenshots recipe) and check both headings show in Classic and Chalk & Oche.
- [ ] **Step 6: Commit** `feat: group games into Matches and Training on the Play screen`.

---

### Task 2: Bob's 27

**Files:**
- Create: `web/games/bobs27.js`
- Modify: `web/games/index.js`, `web/sw.js:18`, `web/app.js` (`GAME_TILES`), `server/db.py` (`_bobs27`, `GAME_STATS`)
- Test: `tests/games.test.mjs`, `tests/test_db.py`

**Interfaces:**
- Produces: module `{ id: 'bobs27', name: "Bob's 27", kind: 'training' }`; options `bull: 'yes'|'no'` (default `'yes'`), `zero: 'stop'|'on'` (default `'stop'`); state `score[]`, `target[]` (1–20, then 25), `hits[]`; hooks `init, dart, out, summary, result, target, aim, hint`.
- Produces (server): `_bobs27(db, player_id, dart_set) -> {avg_score, best_score, double_rate, above_zero} | None`.
- In `tests/test_db.py`: give `match()` an `opts=None` parameter (defaulting to `{"start": 101}`) so stats tests can pass game options. Later tasks use it.

Rules: start 27. One visit per double, D1…D20, then the bull (`seg 25, mult 2`) if `bull === 'yes'`. Each hit adds its value. A visit with no hit takes the double's value away once, applied on the visit's third dart (`s.turn.length === 3` inside `dart()`; "Next" fills in misses, so this always fires). With `zero === 'stop'`, a score ≤ 0 puts that player out (`out()`). The game ends when every player is out or past the last double. Then `winner` is the highest score.

- [ ] **Step 1: Write the failing tests**

```js
const miss3 = [D(0, 0), D(0, 0), D(0, 0)];
test("bob's 27: hits add, a blank visit takes the double away", () => {
  let s = play('bobs27', ['A'], {}, [D(1, 2), D(5), D(5)]);
  assert.equal(s.score[0], 29); assert.equal(s.target[0], 2);
  s = play('bobs27', ['A'], {}, [D(1, 2), D(5), D(5), ...miss3]);
  assert.equal(s.score[0], 25);
  s = play('bobs27', ['A'], {}, [D(1, 2), D(5), D(5), D(2, 2), D(2, 2), D(0, 0)]);
  assert.equal(s.score[0], 37);
});
test("bob's 27: Next after one dart still costs the double", () => {
  const s = play('bobs27', ['A'], {}, [D(0, 0), NEXT]);
  assert.equal(s.score[0], 25);
});
test("bob's 27: undoing the third dart gives the penalty back", () => {
  const s = play('bobs27', ['A'], {}, [D(0, 0), D(0, 0)]);
  assert.equal(s.score[0], 27);
});
test("bob's 27: falling to zero ends a solo game", () => {
  // 27 -2 -4 -6 -8 -10 = -3, out at D5
  const s = play('bobs27', ['A'], {}, Array(5).fill(miss3).flat());
  assert.equal(s.score[0], -3); assert.equal(s.winner, 0);
  assert.ok(gameById('bobs27').result(s));
});
test("bob's 27: one player out, the other plays on and wins", () => {
  const log = [];
  for (let r = 0; r < 5; r++) log.push(...miss3, D(r + 1, 2), D(0, 0), D(0, 0));
  const s = play('bobs27', ['A', 'B'], {}, log);
  assert.equal(s.winner, null); assert.equal(s.current, 1);  // A is passed over
});
test("bob's 27: a full round without the bull ends after D20", () => {
  const log = [];
  for (let d = 1; d <= 20; d++) log.push(D(d, 2), D(0, 0), D(0, 0));
  const s = play('bobs27', ['A'], { bull: 'no' }, log);
  assert.equal(s.score[0], 27 + 420); assert.equal(s.winner, 0);
});
```

```python
        # Bob's 27: one game, D1 hit once then D2 missed: 27 + 2 - 4 = 25
        b = [throw(0, 1, 1, 2), throw(0, 1, 0, 0), throw(0, 1, 0, 0),
             throw(0, 2, 0, 0), throw(0, 2, 0, 0), throw(0, 2, 0, 0)]
        assert db.save_match("b1", match(1, [alex["id"]], b, winner=0, game="bobs27", opts={"bull": "yes", "zero": "stop"}))
        d = db.stats(alex["id"], "bobs27")["detail"]
        assert d["double_rate"] == 16.7 and d["best_score"] is None  # not finished
```

(Count `best_score` / `avg_score` / `above_zero` only over games with `finished` set, as `_countup` does with `m["finished"]`. The partial game above is not finished, so `best_score` is `None`. Add a second, finished game in the test and assert its score.)

- [ ] **Step 2: Run `python -m tests db` and `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `web/games/bobs27.js`.** `target()` returns `{seg, mult: 2}` for the current double. `aim()` returns "Double 7" or "Bull". `summary(s, i)` → `{ big: score, small: 'D7' | 'out at D5' | 'done', out }`.
- [ ] **Step 4: Register it.** Add to `GAMES` after `clock`, to `sw.js`, and extend the grouping test's training list to `['clock', 'bobs27', 'c121', …]`.
- [ ] **Step 5: Implement `_bobs27` in `server/db.py`,** replaying each match's own-player visits with the same rules and options. Add `GAME_TILES.bobs27 = [['Average score', 'avg_score'], ['Best score', 'best_score'], ['Doubles hit', 'double_rate', '%'], ['Games above zero', 'above_zero']]`.
- [ ] **Step 6: Run `python -m tests`.** Expected: all PASS.
- [ ] **Step 7: Commit** `feat: add Bob's 27 training game`.

---

### Task 3: Shanghai

**Files:** Create `web/games/shanghai.js`. Modify `index.js`, `sw.js`, `app.js` (`GAME_TILES`), `server/db.py` (`_shanghai`). Test `tests/games.test.mjs`, `tests/test_db.py`.

**Interfaces:**
- Produces: `{ id: 'shanghai', name: 'Shanghai', kind: 'training' }`; options `rounds: 7|10|20` (default `7`), `shanghai: 'yes'|'no'` (default `'yes'`); state `total[]`, `shanghais[]`; hooks `init, dart, turnStart, summary, result, target, aim, hint`.
- Produces (server): `_shanghai(...) -> {avg_total, best_total, shanghais, hit_rate} | None`.

Rules: in round N only number N scores (`seg === s.round`), worth `value(d)`. At the end of a visit, if that visit held a single, a double and a treble of N and `shanghai === 'yes'`, that player wins outright. Otherwise the game ends after the last player's visit in the last round (use the Count Up pattern: `turnStart` finishing when `s.round > rounds`), and the highest total wins.

- [ ] **Step 1: Write the failing tests**

```js
test('shanghai: only the round number scores', () => {
  const s = play('shanghai', ['A'], {}, [D(1, 3), D(20, 3), D(1)]);
  assert.equal(s.total[0], 4);
});
test('shanghai: single, double and treble wins outright', () => {
  const s = play('shanghai', ['A', 'B'], {}, [D(1), D(1, 2), D(1, 3)]);
  assert.equal(s.winner, 0); assert.equal(s.shanghais[0], 1);
});
test('shanghai: with the rule off it is just points', () => {
  const log = [D(1), D(1, 2), D(1, 3), ...Array(18).fill(D(0, 0))];
  const s = play('shanghai', ['A'], { shanghai: 'no' }, log);
  assert.equal(s.total[0], 6); assert.equal(s.winner, 0);
});
test('shanghai: Next after one dart ends the visit', () => {
  const s = play('shanghai', ['A'], {}, [D(1), NEXT]);
  assert.equal(s.round, 2);
});
```

```python
        sh = [throw(0, 1, 1, 1), throw(0, 1, 1, 2), throw(0, 1, 1, 3)]
        assert db.save_match("s1", match(1, [alex["id"]], sh, winner=0, game="shanghai", opts={"rounds": 7, "shanghai": "yes"}))
        d = db.stats(alex["id"], "shanghai")["detail"]
        assert d["shanghais"] == 1 and d["hit_rate"] == 100.0
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `shanghai.js`.** `target()` returns `{ seg: round, mult: 1 }`. `aim()` returns the number. `result()` → "Shanghai! A wins" or "Total 84".
- [ ] **Step 4: Register it** after `bobs27` and update the grouping test.
- [ ] **Step 5: Implement `_shanghai` and `GAME_TILES.shanghai`:** `[['Average total', 'avg_total'], ['Best total', 'best_total'], ['Shanghais', 'shanghais'], ['Hit rate on the number', 'hit_rate', '%']]`.
- [ ] **Step 6: Run `python -m tests`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat: add Shanghai training game`.

---

### Task 4: Bermuda

**Files:** Create `web/games/bermuda.js`. Modify `index.js`, `sw.js`, `app.js`, `server/db.py` (`_bermuda`). Test both suites.

**Interfaces:**
- Produces: `{ id: 'bermuda', name: 'Bermuda', kind: 'training' }`; no options; state `total[]`, `halved[]`; exported constant `ROUNDS = [12, 13, 14, 'D', 15, 16, 17, 'T', 18, 19, 20, 25, 50]`.
- Produces (server): `_bermuda(...) -> {avg_total, best_total, avg_halved, hit_rate} | None`.

Rules: a dart hits the round's target when: number → `seg === n` (any part); `'D'` → `mult === 2` (the bull counts); `'T'` → `mult === 3`; `25` → `seg === 25` (outer or bull, scores its value); `50` → `seg === 25 && mult === 2`. A hit adds `value(d)`. On a visit's third dart with no hit, `total = Math.floor(total / 2)` and `halved++`. The game ends after round 13, and the highest total wins.

- [ ] **Step 1: Write the failing tests**

```js
test('bermuda: hits score, a blank visit halves', () => {
  let s = play('bermuda', ['A'], {}, [D(12), D(12, 3), D(0, 0)]);
  assert.equal(s.total[0], 48);
  s = play('bermuda', ['A'], {}, [D(12), D(12, 3), D(0, 0), D(1), D(1), D(1)]);
  assert.equal(s.total[0], 24); assert.equal(s.halved[0], 1);
});
test('bermuda: any double and any treble rounds', () => {
  const to4 = [D(12), D(0, 0), D(0, 0), D(13), D(0, 0), D(0, 0), D(14), D(0, 0), D(0, 0)];
  const s = play('bermuda', ['A'], {}, [...to4, D(20, 2), D(25, 2), D(5)]);
  assert.equal(s.total[0], 12 + 13 + 14 + 40 + 50);
});
test('bermuda: Next after one miss halves, undo gives it back', () => {
  assert.equal(play('bermuda', ['A'], {}, [D(12), D(0, 0), D(0, 0), D(0, 0), NEXT]).total[0], 6);
  assert.equal(play('bermuda', ['A'], {}, [D(12), D(0, 0), D(0, 0), D(0, 0), D(0, 0)]).total[0], 12);
});
test('bermuda: ends after the bull round', () => {
  const s = play('bermuda', ['A'], {}, Array(39).fill(D(0, 0)));
  assert.equal(s.winner, 0); assert.equal(s.total[0], 0);
});
```

```python
        be = [throw(0, 1, 12, 3), throw(0, 1, 0, 0), throw(0, 1, 0, 0),
              throw(0, 2, 0, 0), throw(0, 2, 0, 0), throw(0, 2, 0, 0)]
        assert db.save_match("be1", match(1, [alex["id"]], be, game="bermuda", opts={}))
        d = db.stats(alex["id"], "bermuda")["detail"]
        assert d["hit_rate"] == 16.7
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `bermuda.js`.** `target()` lights the number or bull (`null` for D/T rounds). `aim()`: "12", "Any double", "Any treble", "Outer bull", "Bull". `panel()` (optional): the 13 targets with the current one marked.
- [ ] **Step 4: Register it** after `shanghai` and update the grouping test.
- [ ] **Step 5: Implement `_bermuda` and `GAME_TILES.bermuda`:** `[['Average total', 'avg_total'], ['Best total', 'best_total'], ['Rounds halved per game', 'avg_halved'], ['Hit rate', 'hit_rate', '%']]`.
- [ ] **Step 6: Run `python -m tests`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat: add Bermuda training game`.

---

### Task 5: Segment Training

**Files:** Create `web/games/segment.js`. Modify `index.js`, `sw.js`, `app.js`, `server/db.py` (`_segment`). Test both suites.

**Interfaces:**
- Produces: `{ id: 'segment', name: 'Segment Training', kind: 'training' }`; options `seg: 1..20|25` (default `20`, choices for all 21), `counts: 'any'|'single'|'double'|'treble'` (default `'any'`), `darts: 30|60|99` (default `60`); state `points[]`, `hits[]`, `thrown[]`.
- Produces (server): `_segment(...) -> {hit_rate, points_per_dart, best_points} | None`, over the player's games for the bed in scope. Stats are not split by bed: one figure over all segment games. (My call. Splitting per bed needs a stats picker that doesn't exist.)

Rules: a dart counts if `seg === opts.seg` and (`counts === 'any'` or the mult matches: single 1, double 2, treble 3). A counted dart scores points equal to its `mult` (1, 2, 3). Each player throws `darts` darts. The game ends when the last player has thrown them all, and the most points wins.

- [ ] **Step 1: Write the failing tests**

```js
test('segment: points by multiplier on the chosen bed only', () => {
  const s = play('segment', ['A'], { seg: 20, counts: 'any', darts: 30 }, [D(20, 3), D(20), D(5)]);
  assert.equal(s.points[0], 4); assert.equal(s.hits[0], 2); assert.equal(s.thrown[0], 3);
});
test('segment: trebles only ignores singles', () => {
  const s = play('segment', ['A'], { seg: 19, counts: 'treble', darts: 30 }, [D(19), D(19, 3), D(19, 2)]);
  assert.equal(s.points[0], 3);
});
test('segment: ends after the set number of darts', () => {
  const s = play('segment', ['A'], { seg: 25, counts: 'any', darts: 30 }, Array(30).fill(D(25, 2)));
  assert.equal(s.winner, 0); assert.equal(s.points[0], 60);
});
```

```python
        sg = [throw(0, 1, 20, 3), throw(0, 1, 20, 1), throw(0, 1, 1, 1)]
        assert db.save_match("sg1", match(1, [alex["id"]], sg, game="segment", opts={"seg": 20, "counts": "any", "darts": 30}))
        d = db.stats(alex["id"], "segment")["detail"]
        assert d["hit_rate"] == 66.7 and d["points_per_dart"] == 1.33
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `segment.js`.** The `seg` option needs 21 choices. If the `choices` buttons wrap badly on a phone, use the existing `stepper(o)` style option (see `app.js:997`, options without `choices`). `target()` lights the bed (with the mult when not `'any'`). `summary` → `{ big: points, small: '12 of 30 hit · 40%' }`.
- [ ] **Step 4: Register it** after `bermuda` and update the grouping test.
- [ ] **Step 5: Implement `_segment` and `GAME_TILES.segment`:** `[['Hit rate', 'hit_rate', '%'], ['Points per dart', 'points_per_dart'], ['Best session', 'best_points']]`.
- [ ] **Step 6: Run `python -m tests`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat: add Segment Training game`.

---

### Task 6: Random Checkout

**Files:** Create `web/games/rcheckout.js`. Modify `index.js`, `sw.js`, `app.js`, `server/db.py` (`_rcheckout`). Test both suites.

**Interfaces:**
- Consumes: `checkout(score, darts, doubleOut)` from `web/games/x01.js`; the `rng(seed)` pattern from `random.js` (move `rng` to `board.js` as an export and import it in both, rather than copying it).
- Produces: `{ id: 'rcheckout', name: 'Random Checkout', kind: 'training', seeded: true }`; options `range: 'low'|'mid'|'high'|'all'` (2–40 / 41–100 / 101–170 / 2–170, default `'low'`), `darts: 3|6|9` (default `6`), `count: 10|20` (default `10`); exported `targets(seed, range, count) -> number[]` (only scores `checkout(t, 3, true)` can finish); state `target[]`, `left[]`, `used[]`, `made[]`, `tried[]`, `dartsMade[]`.
- Produces (server): `_rcheckout(...) -> {rate, made, avg_darts} | None`. The server recomputes targets from `opts.seed` with the same generator. Port `rng` and `targets` to Python exactly (32-bit arithmetic with `& 0xFFFFFFFF`), and add a test that both give the same first 5 targets for seed `12345`.

Rules: every player works through the same list of targets, each with their own `left`. Double out. A bust ends the visit and resets `left` to the visit's start (as 121). The attempt ends on a checkout (made), or when `used >= darts` (missed). Then the next target. A player who has had `count` targets is out. Most made wins, ties go to fewer `dartsMade`. Reuse 121's bust/settle shape; read `c121.js` first.

- [ ] **Step 1: Write the failing tests**

```js
import rco, { targets } from '../web/games/rcheckout.js';
test('random checkout: targets are seeded, in range and finishable', () => {
  const a = targets(12345, 'mid', 20);
  assert.deepEqual(a, targets(12345, 'mid', 20));
  assert.ok(a.every(t => t >= 41 && t <= 100 && checkout(t, 3, true)));
  assert.ok(targets(1, 'high', 50).every(t => t <= 170 && checkout(t, 3, true)));
});
test('random checkout: finishing on a double counts and moves on', () => {
  const opts = { range: 'low', darts: 6, count: 10, seed: 7 };
  const t = targets(7, 'low', 10)[0];
  const route = checkout(t, 3, true);  // [{seg, mult}, …]
  const s = play('rcheckout', ['A'], opts, route.map(d => D(d.seg, d.mult)));
  assert.equal(s.made[0], 1); assert.equal(s.tried[0], 1); assert.equal(s.left[0], targets(7, 'low', 10)[1]);
});
test('random checkout: out of darts is a miss', () => {
  const s = play('rcheckout', ['A'], { range: 'low', darts: 3, count: 10, seed: 7 }, [D(0, 0), D(0, 0), D(0, 0)]);
  assert.equal(s.made[0], 0); assert.equal(s.tried[0], 1);
});
```

(Check what `checkout()` returns before writing the route mapping. Adjust the mapping to its real shape, not the assertions.)

```python
        # expected list: the output of
        #   node -e "import('./web/games/rcheckout.js').then(m => console.log(JSON.stringify(m.targets(12345, 'mid', 5))))"
        assert db._rc_targets(12345, "mid", 5) == EXPECTED
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Move `rng` to `board.js`** (export), import it in `random.js`. Run `npm test`. Expected: Random Targets tests still PASS.
- [ ] **Step 4: Implement `rcheckout.js`.** `left()` returns `s.left[s.current]` so the caller says "You require 36", as in 121. `hint()` shows the checkout route.
- [ ] **Step 5: Register it** after `segment` and update the grouping test.
- [ ] **Step 6: Implement `_rc_targets`, `_rcheckout` and `GAME_TILES.rcheckout`:** `[['Checkout rate', 'rate', '%'], ['Checkouts hit', 'made'], ['Average darts per checkout', 'avg_darts']]`.
- [ ] **Step 7: Run `python -m tests`.** Expected: PASS.
- [ ] **Step 8: Commit** `feat: add Random Checkout training game`.

---

### Task 7: Round the World (Around the Clock option)

**Files:** Modify `web/games/clock.js`, `server/db.py:_clock`. Test both suites.

**Interfaces:**
- Produces: a new option `{ key: 'hit', label: 'What counts', choices: [['any', 'Any part'], ['double', 'Doubles only'], ['treble', 'Trebles only']], default: 'any' }`. A saved game with no `hit` reads as `'any'`.

Rules: with `hit !== 'any'`, a dart on 1–20 counts only with mult 2 or 3 as chosen. The final bull counts on any part in every mode (my call: there is no treble bull). `skip` applies only when `hit === 'any'`. With doubles or trebles only, every hit moves on by one. Change the blurb to mention Round the World.

- [ ] **Step 1: Write the failing tests**

```js
test('clock: doubles only (round the world)', () => {
  let s = play('clock', ['A'], { skip: 'no', hit: 'double' }, [D(1), D(1, 3), D(1, 2)]);
  assert.equal(s.target[0], 2); assert.equal(s.hits[0], 1);
  s = play('clock', ['A'], { skip: 'yes', hit: 'treble' }, [D(1, 3)]);
  assert.equal(s.target[0], 2);  // skip ignored outside 'any'
});
test('clock: a game saved before the option replays the same', () => {
  const s = play('clock', ['A'], { skip: 'yes' }, [D(1, 3)]);
  assert.equal(s.target[0], 4);
});
```

```python
        # _clock with hit=double: a single on the target is not a hit
        cleo = db.add_player("Cleo")
        ck2 = [throw(0, 1, 1, 1), throw(0, 1, 1, 2)]
        assert db.save_match("ck2", match(1, [cleo["id"]], ck2, game="clock", opts={"skip": "no", "hit": "double"}))
        assert db.stats(cleo["id"], "clock")["detail"]["hit_rate"] == 50.0
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement the option in `clock.js` and the same rule in `_clock`.**
- [ ] **Step 4: Run `python -m tests`.** Expected: PASS, including every existing clock test unchanged.
- [ ] **Step 5: Commit** `feat: Round the World option on Around the Clock`.

---

### Task 8: Gotcha

**Files:** Create `web/games/gotcha.js`. Modify `index.js`, `sw.js`, `app.js:970` (Start), `app.js` (`GAME_TILES`), `server/db.py` (`_gotcha`). Test both suites.

**Interfaces:**
- Produces: `{ id: 'gotcha', name: 'Gotcha', kind: 'match', minPlayers: 2 }`; options `target: 301|501` (default `301`); state `score[]`, `visitStart`; hooks `init, dart, turnStart, summary, call, hint`.
- Produces (app): the generic module field `minPlayers`. Start is disabled while fewer human-or-bot seats than `game.minPlayers ?? 1` are picked, with the line "Gotcha needs two or more players." under the players step.
- Produces (server): `_gotcha(...) -> {won, average} | None` (`average` = three-dart average of visits that did not bust).

Rules: scores count up from 0. A dart that takes a player past `target` is a bust: `score = visitStart`, `s.note = 'BUST'` (the engine moves on). Reaching exactly `target` wins. After each scoring dart, any other player whose score equals the thrower's new score goes back to 0. `call()` says "Gotcha! B back to zero".

- [ ] **Step 1: Write the failing tests**

```js
const T20x3 = [D(20, 3), D(20, 3), D(20, 3)];
test('gotcha: matching a score sends the other player back to zero', () => {
  const s = play('gotcha', ['A', 'B'], {}, [...T20x3, ...T20x3]);
  assert.deepEqual(s.score, [0, 180]);
});
test('gotcha: going over is a bust, exactly the target wins', () => {
  let s = play('gotcha', ['A', 'B'], {}, [...T20x3, D(1), NEXT, D(20, 3), D(20, 3), D(20, 3)]);
  // A 180, B 1, A 360 > 301: bust back to 180
  assert.equal(s.score[0], 180); assert.equal(s.bust, 0);
  s = play('gotcha', ['A', 'B'], {}, [...T20x3, D(1), NEXT, D(20, 3), D(20, 3), D(1)]);
  assert.equal(s.score[0], 301); assert.equal(s.winner, 0);
});
```

Add a test in `tests/games.test.mjs` for the Start rule if the rule is a pure helper. Make it one: `export const canStart = (game, seatCount) => seatCount >= (game.minPlayers ?? 1)` in `web/engine.js`, tested with `canStart(gameById('gotcha'), 1) === false`, `…, 2) === true`, `canStart(gameById('x01'), 1) === true`. `app.js:970` uses it alongside the existing "at least one human" check.

```python
        go = [throw(0, 1, 20, 3), throw(0, 1, 20, 3), throw(0, 1, 20, 3), throw(1, 1, 1, 1)]
        assert db.save_match("g1", match(1, [alex["id"], sam["id"]], go, game="gotcha", opts={"target": 301}))
        assert db.stats(alex["id"], "gotcha")["detail"]["average"] == 180.0
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `gotcha.js` and `canStart`, and wire `canStart` into `app.js:970`.**
- [ ] **Step 4: Register it** after `killer` and update the grouping test's match list to `['x01', 'cricket', 'killer', 'gotcha']`.
- [ ] **Step 5: Implement `_gotcha` and `GAME_TILES.gotcha`:** `[['Games won', 'won'], ['3-dart average', 'average']]`.
- [ ] **Step 6: Run `python -m tests`.** Expected: PASS. Pick Gotcha with one player on the Play screen and check that Start is greyed out and the line shows.
- [ ] **Step 7: Commit** `feat: add Gotcha`.

---

### Task 9: Words on the site, README and release notes

**Files:** Modify `release.json` ("unreleased"), `README.md:23-25`, `web/faq.html:71`. Check `web/app.js:812,835` wording.

- [ ] **Step 1: Add to `release.json` "unreleased"** (the player-facing lines, plain, in the style of the 1.3/1.4 notes):
  - "The Play screen now splits the games into Matches and Training, so the practice games are easy to find."
  - "Five new training games: Bob's 27 (every double in turn, starting on 27), Shanghai, Bermuda, Segment Training (pick a bed and see how often you hit it) and Random Checkout. Each has its own stats."
  - "Around the Clock has a Round the World option: count only doubles, or only trebles."
  - "New game: Gotcha, a race to exactly 301 where matching someone's score sends them back to zero."
- [ ] **Step 2: Update README's games line** to "Thirteen games" with the full list, split into Matches and Training. Update the FAQ answer at `web/faq.html:71` the same way.
- [ ] **Step 3: Check the landing-page sentence at `app.js:812/835`.** `inWords(GAMES.length)` must give "Thirteen". If `inWords` stops below 13, extend it.
- [ ] **Step 4: Run `python -m tests`.** Expected: PASS (`test_release` checks `release.json`).
- [ ] **Step 5: Commit** `docs: training games in the release notes, README and FAQ`.
