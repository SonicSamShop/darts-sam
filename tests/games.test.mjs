// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { newMatch, compute, gameById, elapsed, clock, timeSpent, previousVisit } from '../web/engine.js';
import { checkout } from '../web/games/x01.js';
import { scoreAt, value, label, spoken, half, heatGrid, bullUp } from '../web/board.js';
import { GAMES } from '../web/games/index.js';
import { targets as rcTargets } from '../web/games/rcheckout.js';

const D = (seg, mult = 1) => ({ t: 'dart', seg, mult });
const NEXT = { t: 'next' };
const play = (id, players, opts, log) => compute({ ...newMatch(id, players, opts), log });

test('board geometry', () => {
  assert.deepEqual(scoreAt(0, 0), { seg: 25, mult: 2 });
  assert.deepEqual(scoreAt(0, 10), { seg: 25, mult: 1 });
  assert.deepEqual(scoreAt(0, 103), { seg: 20, mult: 3 });
  assert.deepEqual(scoreAt(0, -166), { seg: 3, mult: 2 });
  assert.deepEqual(scoreAt(130, 0), { seg: 6, mult: 1 });
  assert.deepEqual(scoreAt(-130, 0), { seg: 11, mult: 1 });
  assert.deepEqual(scoreAt(0, 180), { seg: 0, mult: 0 });
});

test('x01: scoring, turns and averages', () => {
  const s = play('x01', ['A', 'B'], { start: 501, out: 'double' }, [D(20, 3), D(20, 3), D(20, 3), NEXT, D(5)]);
  assert.deepEqual(s.score, [321, 496]);
  assert.equal(s.current, 1);
  assert.equal(s.turn.length, 1);
});

test('x01: a new dart after three auto-advances without a takeout', () => {
  const s = play('x01', ['A', 'B'], { start: 501, out: 'double' }, [D(1), D(1), D(1), D(20)]);
  assert.deepEqual(s.score, [498, 481]);
});

test('x01: bust restores the score and moves straight on', () => {
  const o = { start: 301, out: 'double' };
  let s;
  const to32 = [D(20, 3), D(20, 3), D(20, 3), NEXT, D(19, 3), D(16, 2), NEXT];  // 301-180-89 = 32
  s = play('x01', ['A'], o, [...to32, D(20), D(20)]);
  assert.equal(s.score[0], 32); assert.equal(s.bust, 0);
  assert.equal(s.turnOver, false); assert.equal(s.turn.length, 0); assert.equal(s.round, 4);
  s = play('x01', ['A'], o, [...to32, D(16), D(15)]);   // leaves 1
  assert.equal(s.score[0], 32); assert.equal(s.bust, 0);
  s = play('x01', ['A'], o, [...to32, D(16), D(15), D(1)]);  // the flag clears with the next dart
  assert.equal(s.score[0], 31); assert.equal(s.bust, null);
  // With two players a bust on the first dart hands over immediately.
  s = play('x01', ['A', 'B'], { start: 101, out: 'double' }, [D(20, 3), NEXT, D(1), NEXT, D(20, 3)]);
  assert.equal(s.bust, 0); assert.equal(s.current, 1); assert.deepEqual(s.score, [41, 100]);
  s = play('x01', ['A'], o, [...to32, D(16), D(16)]);   // zero but not on a double
  assert.equal(s.winner, null); assert.equal(s.score[0], 32);
  s = play('x01', ['A'], o, [...to32, D(16, 2)]);
  assert.equal(s.winner, 0);
  s = play('x01', ['A'], { start: 301, out: 'straight' }, [...to32, D(16), D(16)]);
  assert.equal(s.winner, 0);
});

test('x01: checkout suggestions are valid', () => {
  for (let n = 2; n <= 170; n++) {
    const r = checkout(n, 3, true);
    if ([169, 168, 166, 165, 163, 162, 159].includes(n)) { assert.equal(r, null, `${n}`); continue; }
    assert.ok(r, `no route for ${n}`);
    assert.equal(r.reduce((t, d) => t + value(d), 0), n);
    assert.equal(r.at(-1).mult, 2);
  }
  assert.deepEqual(checkout(170, 3, true), [{ seg: 20, mult: 3 }, { seg: 20, mult: 3 }, { seg: 25, mult: 2 }]);
  assert.deepEqual(checkout(40, 1, true), [{ seg: 20, mult: 2 }]);
  assert.equal(checkout(100, 1, true), null);
});

test('x01: checkouts follow the standard chart and the darts in hand', () => {
  const route = (n, darts, dbl = true) => checkout(n, darts, dbl)?.map(label).join(' ') ?? null;
  assert.equal(route(170, 3), 'T20 T20 Bull');
  assert.equal(route(57, 3), '17 D20');
  assert.equal(route(48, 2), '16 D16');       // 57, hit a 9, two darts left
  assert.equal(route(99, 3), 'T19 10 D16');
  assert.equal(route(101, 3), 'T20 9 D16');   // three darts: no need to risk the bull
  assert.equal(route(101, 2), 'T17 Bull');    // two darts: the only way out
  assert.equal(route(61, 3), 'T15 D8');
  assert.equal(route(61, 2), 'T11 D14');      // a single 11 still leaves the bull
  assert.equal(route(50, 1), 'Bull');
  assert.equal(route(32, 1), 'D16');
  assert.equal(route(57, 1), null);
  assert.equal(route(57, 1, false), 'T19');   // straight out is worked out, not charted
  // Every two-dart and one-dart suggestion is a real finish, and nothing finishable is missed.
  const doubles = new Set([50, ...Array.from({ length: 20 }, (_, i) => 2 * i + 2)]);
  const singles = new Set([0, 25, 50]);
  for (let n = 1; n <= 20; n++) [n, 2 * n, 3 * n].forEach(v => singles.add(v));
  for (let n = 2; n <= 170; n++) {
    for (const darts of [1, 2]) {
      const r = checkout(n, darts, true);
      const possible = [...doubles].some(d => d === n || (darts === 2 && singles.has(n - d)));
      assert.equal(r != null, possible, `${n} with ${darts}`);
      if (!r) continue;
      assert.ok(r.length <= darts, `${n} with ${darts}`);
      assert.equal(r.reduce((t, d) => t + value(d), 0), n, `${n} with ${darts}`);
      assert.equal(r.at(-1).mult, 2, `${n} with ${darts}`);
    }
  }
});

test('x01: the TV scoreboard counts each finished visit once', () => {
  const x01 = gameById('x01'), o = { start: 501, out: 'double', legs: 2 };
  const s = play('x01', ['A', 'B'], o, [
    D(20, 3), D(20, 3), D(20, 3),            // A 180
    { t: 'visit', total: 140 },              // B 140, typed
    D(20, 3), D(20, 3), D(19),               // A 139
    { t: 'visit', total: 99 },               // B 99
    D(20, 3), D(20, 3),                      // A on 120, still throwing
  ]);
  assert.deepEqual(x01.tv(s, 0), { score: 62, legs: 0, sets: null, t100: 1, t140: 0, t180: 1, average: '164.6' });
  assert.deepEqual(x01.tv(s, 1), { score: 262, legs: 0, sets: null, t100: 0, t140: 1, t180: 0, average: '119.5' });
  assert.equal(x01.tvTitle(s), '501 · Best of 3');
  assert.equal(x01.tvTitle(play('x01', ['A'], { start: 301, legs: 3, sets: 2 }, [])), '301 · First to 2 sets');
  assert.equal(x01.tvTitle(play('x01', ['A', 'B'], { start: 501 }, [])), '501 · One leg');
  // a bust scores nothing, and the visit that wins the match counts although its darts are still on show
  const w = play('x01', ['A'], { start: 101, out: 'double' }, [D(20, 3), D(20), D(20), D(7, 3), D(20, 2)]);
  assert.equal(w.winner, null);
  const won = play('x01', ['A'], { start: 141, out: 'double' }, [D(20, 3), D(19, 3), D(12, 2)]);
  assert.equal(won.winner, 0);
  assert.equal(x01.tv(won, 0).t140, 1);
  assert.equal(x01.tv(w, 0).t100, 0);
});

test('cricket: marks, points and win', () => {
  let s = play('cricket', ['A', 'B'], {}, [D(20, 3), D(20, 3), D(1)]);
  assert.equal(s.marks[0][20], 3); assert.equal(s.points[0], 60);
  s = play('cricket', ['A', 'B'], {}, [D(20, 3), D(1), D(1), NEXT, D(20, 3), D(1), D(1), NEXT, D(20)]);
  assert.equal(s.points[0], 0, 'no points on a number everyone has closed');
  const all = [D(20, 3), D(19, 3), D(18, 3), NEXT, NEXT, D(17, 3), D(16, 3), D(15, 3), NEXT, NEXT, D(25, 2), D(25)];
  s = play('cricket', ['A', 'B'], {}, all);
  assert.equal(s.winner, 0);
});

test('around the clock', () => {
  let s = play('clock', ['A'], { skip: 'no' }, [D(1), D(2, 3), D(4)]);
  assert.equal(s.target[0], 3);
  assert.equal(gameById('clock').aim(s), String(s.target[0]));    // the number needed, for the caller
  assert.equal(gameById('clock').aim({ ...s, target: [25] }), 'Bull');
  s = play('clock', ['A'], { skip: 'yes' }, [D(1, 3), D(4, 2), D(6)]);
  assert.equal(s.target[0], 7);
  const log = [];
  for (let n = 1; n <= 20; n++) { log.push(D(n)); if (n % 3 === 0) log.push(NEXT); }
  log.push(D(25));
  assert.equal(play('clock', ['A'], { skip: 'no' }, log).winner, 0);
});

test('clock: doubles only (round the world)', () => {
  let s = play('clock', ['A'], { skip: 'no', hit: 'double' }, [D(1), D(1, 3), D(1, 2)]);
  assert.equal(s.target[0], 2); assert.equal(s.hits[0], 1);
  s = play('clock', ['A'], { skip: 'yes', hit: 'treble' }, [D(1, 3)]);
  assert.equal(s.target[0], 2);  // skip ignored outside 'any'
  s = play('clock', ['A'], { skip: 'no', hit: 'treble' }, [D(1, 2)]);
  assert.equal(s.target[0], 1);  // a double is not a treble
  s = play('clock', ['A'], { skip: 'no', hit: 'double' }, [D(25)]);
  assert.equal(s.target[0], 1);
});
test('clock: the bull counts on any part in every mode', () => {
  const log = [];
  for (let n = 1; n <= 20; n++) { log.push(D(n, 2)); if (n % 3 === 0) log.push(NEXT); }
  log.push(D(25));
  assert.equal(play('clock', ['A'], { skip: 'no', hit: 'double' }, log).winner, 0);
});
test('clock: a game saved before the option replays the same', () => {
  const s = play('clock', ['A'], { skip: 'yes' }, [D(1, 3)]);
  assert.equal(s.target[0], 4);
});

test('free mode: only the visit in hand is added up, and it never ends', () => {
  let s = play('free', ['A'], {}, [D(20, 3), D(20)]);
  assert.deepEqual(s.visit, [80]); assert.equal(s.turn.length, 2);
  s = play('free', ['A'], {}, [D(20, 3), D(20), D(5), D(1)]);       // a new visit starts from nothing
  assert.deepEqual(s.visit, [1]); assert.equal(s.lastVisit, null);
  assert.deepEqual(previousVisit(s).darts.map(label), ['T20', '20', '5']);
  s = play('free', ['A', 'B'], {}, [D(20, 3), D(20), D(5), D(19)]);  // each player keeps their own last visit
  assert.deepEqual(s.visit, [85, 19]); assert.equal(s.current, 1);
  assert.deepEqual(gameById('free').summary(s, 0), { big: 85, small: 'last visit' });
  assert.deepEqual(gameById('free').summary(s, 1), { big: 19, small: 'this visit' });
  s = play('free', ['A'], {}, Array.from({ length: 300 }, () => D(20, 3)));
  assert.equal(s.winner, null); assert.equal(s.round, 101);
  assert.deepEqual([D(20, 3), D(16, 2), D(7), D(25, 2), D(25), D(0, 0)].map(spoken),
    ['Treble 20', 'Double 16', '7', 'Bullseye', '25', 'Miss']);
});

test('count up ends after the last round', () => {
  const log = [];
  for (let r = 0; r < 5; r++) log.push(D(20), D(20), D(20), NEXT, D(1), D(1), D(1), NEXT);
  const s = play('countup', ['A', 'B'], { rounds: 5 }, log);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.total, [300, 15]);
});

test('undo is just dropping the last log entry', () => {
  const log = [D(20, 3), D(20, 3)];
  const a = play('x01', ['A'], { start: 501, out: 'double' }, log);
  const b = play('x01', ['A'], { start: 501, out: 'double' }, log.slice(0, -1));
  assert.equal(a.score[0], 381); assert.equal(b.score[0], 441);
});

test('throws: every dart is credited to the right player and round', () => {
  const s = play('x01', ['A', 'B'], { start: 101, out: 'double' },
    [D(20, 3), NEXT, D(20, 3), D(20, 3), { t: 'dart', seg: 1, mult: 1, x: 5, y: 60, src: 'cam', ts: 7 }, D(20, 2)]);
  assert.deepEqual(s.throws.map(t => [t.player, t.round, t.seg * t.mult, t.bust]), [
    [0, 1, 60, false], [0, 1, 0, false], [0, 1, 0, false],  // moving on early: the other two are misses
    [1, 1, 60, true], [1, 1, 60, true],  // 101 - 120 is a bust: both darts of the visit are marked
    [0, 2, 1, false], [0, 2, 40, false],
  ]);
  assert.deepEqual(s.throws[5], { player: 0, round: 2, seg: 1, mult: 1, x: 5, y: 60, src: 'cam', ts: 7, bust: false });
  assert.equal(s.winner, 0);
});

test('x01: what is left is only called at 170 or below', () => {
  const x01 = gameById('x01');
  const at = log => x01.left(play('x01', ['A', 'B'], { start: 301, out: 'double' }, log));
  assert.equal(at([]), null);                                    // 301
  assert.equal(at([D(20, 3), D(20, 3)]), null);                  // 181
  assert.equal(at([D(20, 3), D(20, 3), D(11)]), null);           // third dart moves on to B: 301
  assert.equal(at([D(20, 3), D(20, 3), D(11), NEXT]), null);     // B's turn: 301
  assert.equal(at([D(20, 3), D(20, 3), D(11), NEXT, NEXT]), 170);
});

test('next player: darts not entered count as misses, in every game', () => {
  const misses = s => s.throws.filter(t => t.src === 'miss').map(t => [t.player, t.seg, t.mult]);
  let s = play('x01', ['A', 'B'], { start: 501, out: 'double' }, [D(20), NEXT]);
  assert.deepEqual(misses(s), [[0, 0, 0], [0, 0, 0]]);
  assert.equal(s.score[0], 481); assert.equal(s.thrown[0], 3); assert.equal(s.current, 1);
  s = play('x01', ['A', 'B'], { start: 501, out: 'double' }, [NEXT]);          // nothing entered: three misses
  assert.equal(misses(s).length, 3); assert.equal(s.score[0], 501); assert.equal(s.current, 1);
  s = play('x01', ['A', 'B'], { start: 501, out: 'double' }, [D(1), D(1), D(1), NEXT]);  // a full visit adds none
  assert.equal(s.throws.length, 3); assert.equal(s.current, 1);
  s = play('cricket', ['A', 'B'], {}, [D(20, 3), NEXT]);
  assert.equal(s.throws.length, 3); assert.equal(s.marks[0][20], 3); assert.equal(s.current, 1);
  s = play('clock', ['A', 'B'], { skip: 'no' }, [D(1), NEXT]);
  assert.equal(s.thrown[0], 3); assert.equal(s.target[0], 2); assert.equal(s.current, 1);
  s = play('countup', ['A'], { rounds: 5 }, [D(20), NEXT, NEXT, NEXT, NEXT, NEXT]);
  assert.equal(s.throws.length, 15); assert.equal(s.total[0], 20); assert.equal(s.winner, 0);
  const o = { start: 121, darts: 9, inc: 1, rounds: 2 };
  s = play('c121', ['A'], o, [D(20, 3), NEXT, NEXT, NEXT]);                     // out of darts (61 can't go in one): back to the start
  assert.equal(s.throws.length, 8); assert.deepEqual(s.results[0], [{ target: 121, ok: false, darts: 9 }]);
  s = play('c121', ['A'], o, [D(20, 3), D(11, 3), D(14, 2), NEXT]);             // a checkout is not padded out
  assert.equal(s.throws.length, 3); assert.equal(s.target[0], 122);
});

test('the third dart moves play on by itself', () => {
  const x = { start: 501, out: 'double' };
  let s = play('x01', ['A', 'B'], x, [D(20), D(20), D(20)]);
  assert.equal(s.current, 1); assert.equal(s.turn.length, 0); assert.equal(s.turnOver, false);
  assert.equal(s.lastVisit.player, 0); assert.equal(s.lastVisit.total, 60); assert.equal(s.lastVisit.darts.length, 3);
  assert.equal(s.lastVisit.auto, true);
  s = play('x01', ['A', 'B'], x, [D(20), D(20), D(20), NEXT]);   // pressing next out of habit skips nobody
  assert.equal(s.current, 1); assert.equal(s.throws.length, 3);
  s = play('x01', ['A', 'B'], x, [D(20), D(20), D(20), NEXT, NEXT]);  // a second press is B passing
  assert.equal(s.current, 0); assert.equal(s.round, 2); assert.equal(s.throws.length, 6);
  s = play('x01', ['A', 'B'], x, [D(20), NEXT]);                 // filled with misses: asked for, not automatic
  assert.equal(s.lastVisit.total, 20); assert.equal(s.lastVisit.auto, false);
  s = play('x01', ['A', 'B'], x, [D(20), D(20), D(20), D(5)]);   // the visit is only shown until the next dart
  assert.equal(s.lastVisit, null); assert.equal(s.score[1], 496);
  s = play('x01', ['A'], x, [D(20), D(20), D(20)]);              // solo: round two
  assert.equal(s.current, 0); assert.equal(s.round, 2);
  s = play('cricket', ['A', 'B'], {}, [D(20), D(1), D(1)]);
  assert.equal(s.current, 1);
  s = play('clock', ['A', 'B'], { skip: 'no' }, [D(1), D(2), D(9)]);
  assert.equal(s.current, 1); assert.equal(s.target[0], 3);
  s = play('countup', ['A', 'B'], { rounds: 5 }, [D(1), D(2), D(3)]);
  assert.equal(s.current, 1); assert.equal(s.total[0], 6);
  s = play('x01', ['A', 'B'], { start: 101, out: 'double' }, [D(20, 3), D(1), D(20, 2)]);  // a win stays put
  assert.equal(s.winner, 0); assert.equal(s.current, 0); assert.equal(s.turn.length, 3);
});

const V = (total, darts) => ({ t: 'visit', total, ...(darts ? { darts } : {}) });

test('x01: a visit typed in as one number', () => {
  const o = { start: 101, out: 'double' };
  let s = play('x01', ['A', 'B'], o, [V(60)]);
  assert.deepEqual(s.score, [41, 101]); assert.equal(s.current, 1);   // straight on to B
  assert.deepEqual(s.lastVisit, { player: 0, total: 60 });
  assert.equal(s.throws.length, 3);
  assert.deepEqual(s.throws.map(t => t.seg * t.mult), [60, 0, 0]);
  assert.ok(s.throws.every(t => t.src === 'visit' && t.player === 0));
  s = play('x01', ['A', 'B'], o, [V(60), V(100)]);                     // B leaves 1: bust
  assert.deepEqual(s.score, [41, 101]); assert.equal(s.bust, 1); assert.equal(s.current, 0);
  assert.ok(s.throws.slice(3).every(t => t.bust));
  s = play('x01', ['A', 'B'], o, [V(60), V(0), V(41, 2)]);             // A finishes in two darts
  assert.equal(s.winner, 0); assert.equal(s.throws.filter(t => t.player === 0).length, 5);
  assert.equal(s.thrown[0], 5);
  s = play('x01', ['A'], o, [D(20), V(60)]);                           // not in the middle of a visit
  assert.equal(s.score[0], 81); assert.equal(s.turn.length, 1);
  s = play('x01', ['A'], o, [D(20), D(20), D(20), V(41, 2)]);          // after three darts it moves on first
  assert.equal(s.winner, 0);
  const game = gameById('x01');
  s = play('x01', ['A'], { start: 301, out: 'double' }, [V(131)]);     // 170 left
  assert.equal(game.visitDarts(s, 60), null);
  assert.deepEqual(game.visitDarts(s, 170), [3]);
  s = play('x01', ['A'], { start: 301, out: 'double' }, [V(132)]);     // 169 can't be finished
  assert.deepEqual(game.visitDarts(s, 169), []);
  s = play('x01', ['A'], { start: 301, out: 'double' }, [V(180), V(81)]);  // 40 left
  assert.deepEqual(game.visitDarts(s, 40), [1, 2, 3]);
});

test('count up: typed visits', () => {
  const s = play('countup', ['A', 'B'], { rounds: 5 }, Array.from({ length: 10 }, (_, i) => V(i % 2 ? 40 : 60)));
  assert.deepEqual(s.total, [300, 200]); assert.equal(s.winner, 0);
});

test('typed visits are ignored by games that need each dart', () => {
  const s = play('cricket', ['A', 'B'], {}, [V(60)]);
  assert.equal(s.current, 0); assert.equal(s.throws.length, 0);
});

test('121 checkout: target climbs on a finish and falls back to the start', () => {
  const o = { start: 121, darts: 9, inc: 1, rounds: 10 };
  const M = D(0, 0), miss9 = Array(9).fill(M);
  const c121 = [D(20, 3), D(11, 3), D(14, 2)], c122 = [D(18, 3), D(18, 3), D(7, 2)];
  let s = play('c121', ['A'], o, [M, M, M, ...c121]);            // checked out with the sixth dart
  assert.equal(s.target[0], 122); assert.equal(s.turnOver, false);  // third dart of the visit: straight on
  assert.deepEqual(s.results[0], [{ target: 121, ok: true, darts: 6 }]);
  s = play('c121', ['A'], { ...o, start: 81 }, [D(19, 3), D(12, 2)]);  // out with a dart in hand: pull them first
  assert.equal(s.target[0], 82); assert.equal(s.turnOver, true); assert.equal(s.turn.length, 2);
  s = play('c121', ['A'], o, [...c121, ...c122]);
  assert.equal(s.target[0], 123); assert.equal(s.streak[0], 2);
  s = play('c121', ['A'], o, [...c121, ...c122, ...miss9]);      // a miss goes all the way back
  assert.equal(s.target[0], 121); assert.equal(s.left[0], 121); assert.equal(s.streak[0], 0); assert.equal(s.highest[0], 122);
  s = play('c121', ['A'], { ...o, inc: 5 }, [...c121, D(20, 3)]);
  assert.equal(s.target[0], 126); assert.equal(s.left[0], 66);
  s = play('c121', ['A'], { ...o, dec: 0 }, [...c121, ...c122, ...miss9]);     // "back to start", spelled out
  assert.equal(s.target[0], 121);
  s = play('c121', ['A'], { ...o, dec: 1 }, [...c121, ...c122, ...miss9]);     // a miss costs the chosen amount
  assert.equal(s.target[0], 122); assert.equal(s.left[0], 122); assert.equal(s.streak[0], 0);
  s = play('c121', ['A'], { ...o, dec: 1 }, [...c121, ...c122, ...miss9, ...miss9, ...miss9]);  // but never below the start
  assert.equal(s.target[0], 121); assert.equal(s.left[0], 121);
  s = play('c121', ['A'], { ...o, dec: 5 }, [...c121, ...c122, ...miss9]);     // 123 - 5 stops at 121
  assert.equal(s.target[0], 121);
  s = play('c121', ['A'], { ...o, inc: 5, dec: 2 }, [...c121, ...miss9]);
  assert.equal(s.target[0], 124);
});

test('121 checkout: typed visits', () => {
  const o = { start: 121, darts: 9, inc: 1, rounds: 2 };
  const game = gameById('c121');
  let s = play('c121', ['A'], o, [V(60), V(61, 2)]);             // checked out with the fifth dart
  assert.deepEqual(s.results[0], [{ target: 121, ok: true, darts: 5 }]);
  assert.equal(s.target[0], 122); assert.equal(s.left[0], 122); assert.equal(s.used[0], 0); assert.equal(s.turnOver, false);
  s = play('c121', ['A'], o, [V(100), V(40)]);                   // 21 - 40 is a bust, as is leaving 1
  assert.equal(s.left[0], 21); assert.equal(s.bust, 0); assert.equal(s.used[0], 6);
  s = play('c121', ['A'], o, [V(100), V(20)]);
  assert.equal(s.left[0], 21); assert.equal(s.bust, 0);
  s = play('c121', ['A'], o, [V(20), V(20), V(20)]);             // out of darts: back to the start
  assert.deepEqual(s.results[0], [{ target: 121, ok: false, darts: 9 }]); assert.equal(s.left[0], 121);
  s = play('c121', ['A'], o, [V(60), V(60), V(140)]);            // a bust on the last visit also ends it
  assert.deepEqual(s.results[0], [{ target: 121, ok: false, darts: 9 }]); assert.equal(s.bust, 0);
  s = play('c121', ['A', 'B'], o, [V(81), V(60), V(40, 1)]);     // each has their own score: A takes out their 40
  assert.deepEqual(s.left, [122, 61]); assert.deepEqual(s.checks, [1, 0]); assert.equal(s.current, 1);
  s = play('c121', ['A'], o, [D(20, 3), NEXT, V(61, 2)]);        // mixed with darts tapped on the board
  assert.deepEqual(s.results[0], [{ target: 121, ok: true, darts: 5 }]);
  s = play('c121', ['A'], o, [V(81)]);
  assert.equal(game.visitDarts(s, 20), null);
  assert.deepEqual(game.visitDarts(s, 40), [1, 2, 3]);
  s = play('c121', ['A'], o, []);
  assert.deepEqual(game.visitDarts(s, 121), [3]);
});

test('121 checkout: busts, dart limit, separate scores and the end of the game', () => {
  const o = { start: 121, darts: 9, inc: 1, rounds: 2 };
  const M = D(0, 0);
  let s = play('c121', ['A'], o, [D(20, 3), D(20), D(20, 3)]);   // 121-140: bust on the third dart
  assert.equal(s.left[0], 121); assert.equal(s.bust, 0); assert.equal(s.used[0], 3);
  s = play('c121', ['A'], o, [D(20, 3), D(19, 3), D(4)]);        // zero, but not on a double
  assert.equal(s.left[0], 121); assert.equal(s.bust, 0);
  s = play('c121', ['A'], o, [M, NEXT]);                         // unthrown darts are gone
  assert.equal(s.used[0], 3);
  s = play('c121', ['A'], { ...o, darts: 3 }, [D(20, 3), D(11), D(1)]);
  assert.deepEqual(s.results[0], [{ target: 121, ok: false, darts: 3 }]); assert.equal(s.left[0], 121);
  // Two players each have their own target: B's darts do nothing to A's score.
  s = play('c121', ['A', 'B'], o, [D(20, 3), D(11, 3), M, D(20), M, M, D(14, 2)]);
  assert.deepEqual(s.target, [122, 121]); assert.deepEqual(s.left, [122, 101]); assert.equal(s.winner, null);
  // A fails the second target; B misses both. A is passed over once done, and wins on the highest checkout.
  s = play('c121', ['A', 'B'], { ...o, darts: 3 }, [D(20, 3), D(11, 3), D(14, 2), NEXT, NEXT, NEXT]);
  assert.equal(s.winner, null); assert.equal(s.current, 1); assert.equal(s.results[0].length, 2);
  s = play('c121', ['A', 'B'], { ...o, darts: 3 }, [D(20, 3), D(11, 3), D(14, 2), NEXT, NEXT, NEXT, NEXT]);
  assert.equal(s.winner, 0); assert.deepEqual(s.highest, [121, 0]);
  assert.match(gameById('c121').result(s), /A wins.*121.*1 of 2/);
});

test('121 checkout: an attempt ends as soon as it cannot be finished', () => {
  const o = { start: 121, darts: 3, inc: 1, dec: 1, rounds: 5 };
  const M = D(0, 0);
  let s = play('c121', ['A'], o, [D(20, 3), D(20)]);             // 41 left with one dart: no way out
  assert.deepEqual(s.results[0], [{ target: 121, ok: false, darts: 3 }]);
  assert.equal(s.bust, 0); assert.equal(s.turn.length, 0); assert.equal(s.left[0], 121);
  s = play('c121', ['A'], o, [M]);                               // 121 with two darts
  assert.equal(s.results[0].length, 1); assert.equal(s.bust, 0);
  s = play('c121', ['A'], o, [D(20, 3), D(1)]);                  // 60 left: still not one dart
  assert.equal(s.results[0].length, 1);
  s = play('c121', ['A'], o, [D(20, 3), D(11)]);                 // 50 left: the bull is on
  assert.equal(s.results[0].length, 0); assert.equal(s.turn.length, 2);
  s = play('c121', ['A'], { ...o, darts: 9 }, [D(20, 3), D(20)]);  // more visits to come: carry on
  assert.equal(s.results[0].length, 0); assert.equal(s.left[0], 41);
  s = play('c121', ['A'], { ...o, darts: 6 }, [M, M, M, D(20, 3), D(20)]);  // the last visit of two
  assert.deepEqual(s.results[0], [{ target: 121, ok: false, darts: 6 }]);
  s = play('c121', ['A', 'B'], o, [D(20, 3), D(20)]);            // straight on to the next player
  assert.equal(s.current, 1); assert.equal(s.bust, 0);
});

test('match clock: runs until the winning dart, then stops', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(65999), '1:05');
  assert.equal(clock(3723000), '1:02:03');
  assert.deepEqual([59999, 2700000, 12000000].map(timeSpent), ['under a minute', '45 min', '3 h 20 min']);
  const m = { ...newMatch('x01', ['A'], { start: 101, out: 'double' }), started: 1000, log: [] };
  assert.equal(elapsed(m, compute(m), 31000), 30000);
  m.log.push({ ...D(20, 3), ts: 5000 }, { ...D(9), ts: 8000 }, { ...D(16, 2), ts: 12000 });
  assert.equal(compute(m).winner, 0);
  assert.equal(elapsed(m, compute(m), 99000), 11000);   // stopped at the winning dart
  m.log.pop();                                          // undo: running again
  assert.equal(elapsed(m, compute(m), 99000), 98000);
});

test('previous visit: the last finished visit, kept while the next one is thrown', () => {
  const o = { start: 501, out: 'double' };
  const segs = v => v.darts.map(d => d.seg);
  assert.equal(previousVisit(play('x01', ['A'], o, [D(20), D(5)])), null);
  let v = previousVisit(play('x01', ['A', 'B'], o, [D(20), D(5), D(1)]));       // third dart moved play on
  assert.equal(v.player, 0); assert.deepEqual(segs(v), [20, 5, 1]); assert.equal(v.bust, false);
  v = previousVisit(play('x01', ['A', 'B'], o, [D(20), D(5), D(1), D(19), D(7)])); // still A's while B throws
  assert.equal(v.player, 0); assert.deepEqual(segs(v), [20, 5, 1]);
  v = previousVisit(play('x01', ['A'], o, [D(20), D(5), D(1), D(19), D(7), D(3)])); // solo: same player, next round
  assert.deepEqual(segs(v), [19, 7, 3]);
  v = previousVisit(play('x01', ['A'], { start: 101, out: 'double' }, [D(20, 3), D(20, 3)]));
  assert.equal(v.bust, true); assert.equal(v.darts.length, 2);
  v = previousVisit(play('x01', ['A'], o, [{ t: 'visit', total: 100 }]));
  assert.equal(v.typed, true);
});

test('heat map: hottest where the darts are, nothing where there are none', () => {
  const grid = heatGrid([[0, 103], [1, 104], [0, 102], [-120, -60]]);
  const at = (x, y) => grid[Math.floor((226 - y) / 2) * 226 + Math.floor((x + 226) / 2)];
  assert.ok(at(0, 103) > 0.95);                // three darts together: the busiest spot
  assert.ok(at(-120, -60) > 0.3 && at(-120, -60) < at(0, 103));  // one dart: warm, not hottest
  assert.equal(at(120, -120), 0);              // nowhere near a dart
  assert.ok(heatGrid([]).every(v => v === 0));
  assert.ok(heatGrid([[900, 900]]).every(v => v === 0));  // far off the board: left out
});

test('x01: legs and sets', () => {
  const V = (total, darts) => ({ t: 'visit', total, darts });
  const WIN = [D(20, 3), D(1), D(20, 2)];  // 101 in three darts
  const o = { start: 101, out: 'double', legs: 2, sets: 1 };
  const game = gameById('x01');
  // A takes the first leg: scores start again and B throws first in the second.
  let s = play('x01', ['A', 'B'], o, WIN);
  assert.equal(s.winner, null);
  assert.deepEqual(s.legs, [1, 0]); assert.deepEqual(s.score, [101, 101]);
  assert.equal(s.current, 1); assert.equal(s.turn.length, 0);
  assert.deepEqual(s.legWon, { player: 0, set: false });
  assert.equal(s.lastVisit.darts.length, 3);          // the winning darts stay on show
  assert.equal(game.summary(s, 0).small, 'legs 1 · 3 darts · avg 101.0');
  s = play('x01', ['A', 'B'], o, [...WIN, NEXT]);      // pressing next out of habit skips nobody
  assert.equal(s.current, 1); assert.equal(s.throws.length, 3);
  s = play('x01', ['A', 'B'], o, [...WIN, D(20)]);     // the news only lasts until the next dart
  assert.equal(s.legWon, null); assert.deepEqual(s.score, [101, 81]);
  // A leg won in fewer than three darts moves on just the same.
  s = play('x01', ['A', 'B'], o, [D(20, 3), NEXT, NEXT, D(1), D(20, 2)]);   // B passes
  assert.deepEqual(s.legs, [1, 0]); assert.equal(s.current, 1); assert.equal(s.lastVisit.darts.length, 2);
  // B wins the second leg, A the third: A has two and the match.
  const three = [...WIN, ...WIN, ...WIN];
  s = play('x01', ['A', 'B'], o, three.slice(0, 6));
  assert.deepEqual(s.legs, [1, 1]); assert.equal(s.current, 0); assert.equal(s.winner, null);
  s = play('x01', ['A', 'B'], o, three);
  assert.equal(s.winner, 0); assert.deepEqual(s.legs, [2, 1]); assert.equal(s.legWon, null);
  // Every visit is still one player in one round, so the Pi can tell them apart.
  const visits = new Set(s.throws.map(t => `${t.player}/${t.round}`));
  assert.equal(visits.size, 3);
  s = play('x01', ['A'], o, [...WIN, ...WIN]);         // alone: the same player starts every leg
  assert.equal(s.winner, 0); assert.equal(new Set(s.throws.map(t => t.round)).size, 2);
  // Typed visits win legs too.
  s = play('x01', ['A', 'B'], o, [V(101, 3)]);
  assert.deepEqual(s.legs, [1, 0]); assert.equal(s.current, 1); assert.deepEqual(s.legWon, { player: 0, set: false });
  s = play('x01', ['A', 'B'], o, [V(101, 3), V(0), V(101, 2)]);
  assert.equal(s.winner, 0);
  // Sets: first to two legs takes the set, first to two sets the match.
  const so = { ...o, sets: 2 };
  s = play('x01', ['A', 'B'], so, [V(101, 3), V(0), V(101, 3)]);   // A wins the first set 2-0
  assert.deepEqual(s.sets, [1, 0]); assert.deepEqual(s.legs, [0, 0]); assert.equal(s.winner, null);
  assert.deepEqual(s.legWon, { player: 0, set: true });
  assert.equal(s.current, 1);                                      // B throws first in the second set
  assert.equal(game.summary(s, 0).small, 'sets 1 · legs 0 · 6 darts · avg 101.0');
  s = play('x01', ['A', 'B'], so, [V(101, 3), V(0), V(101, 3), V(0), V(101, 3), V(101, 3)]);  // A starts the last leg
  assert.equal(s.winner, 0); assert.deepEqual(s.sets, [2, 0]);
  // A set that took three legs: A, B, A started them, and B still starts the next set.
  s = play('x01', ['A', 'B'], so, [V(101, 3), V(101, 3), V(101, 3)]);
  assert.deepEqual(s.sets, [1, 0]); assert.equal(s.current, 1);
  // A match saved before the options existed is one leg.
  s = play('x01', ['A', 'B'], { start: 101, out: 'double' }, WIN);
  assert.equal(s.winner, 0); assert.equal(game.summary(s, 0).small, '3 darts · avg 101.0');
});

test('killer: weak-hand darts hand out the numbers', () => {
  const o = { lives: 5, mode: 'house' };
  // A gets 7 with one dart; B misses, hits the taken 7 and the bull, then comes round again.
  let s = play('killer', ['A', 'B', 'C'], o, [D(7), NEXT, D(0, 0), D(7, 3), D(25)]);
  assert.deepEqual(s.num, [7, null, null]); assert.equal(s.current, 2);
  s = play('killer', ['A', 'B', 'C'], o, [D(7), NEXT, D(0, 0), D(7, 3), D(25), D(12, 2), NEXT]);
  assert.deepEqual(s.num, [7, null, 12]); assert.equal(s.current, 1);  // A has a number: passed over
  // The next dart moves play on without a takeout; play starts once all have a number.
  s = play('killer', ['A', 'B'], o, [D(7), D(3), NEXT]);
  assert.deepEqual(s.num, [7, 3]); assert.equal(s.current, 0); assert.deepEqual(s.lives, [5, 5]);
});

test('killer: becoming a killer, taking lives and knocking players out', () => {
  const pick = [D(7), D(3), D(12), NEXT];
  let s = play('killer', ['A', 'B', 'C'], { lives: 3, mode: 'classic' }, [...pick, D(3, 2), D(7), D(7, 2)]);
  assert.deepEqual(s.killer, [true, false, false]);   // B's double did nothing: A wasn't a killer yet
  assert.deepEqual(s.lives, [3, 3, 3]); assert.equal(s.event, 'A is a killer');
  // Only doubles count; a killer's own double costs them a life.
  s = play('killer', ['A', 'B', 'C'], { lives: 3, mode: 'classic' },
    [...pick, D(7, 2), D(3, 2), D(3, 3), D(1), D(1), D(1), D(1), D(1), D(1), D(7, 2), D(12, 2), D(12)]);
  assert.deepEqual(s.lives, [2, 2, 2]);
  // B is knocked out and passed over from then on; C takes their own last life and A wins.
  const M = D(0, 0);
  const kill = [...pick, D(7, 2), D(3, 2), D(3, 2), M, M, M, D(12, 2), D(3, 2), D(12, 2), D(12, 2), M, M];
  s = play('killer', ['A', 'B', 'C'], { lives: 3, mode: 'classic' }, kill);
  assert.deepEqual(s.lives, [3, 0, 1]); assert.equal(s.current, 2); assert.equal(s.winner, null);
  assert.equal(gameById('killer').summary(s, 1).out, true);
  s = play('killer', ['A', 'B', 'C'], { lives: 3, mode: 'classic' }, [...kill, D(12, 2)]);
  assert.equal(s.winner, 0);
  // A killer who takes their own last life is out and their visit ends there.
  s = play('killer', ['A', 'B', 'C'], { lives: 3, mode: 'classic' },
    [...pick, D(7, 2), D(7, 2), D(7, 2), M, M, M, M, M, M, D(7, 2), D(1)]);
  assert.equal(s.lives[0], 0); assert.equal(s.current, 1); assert.equal(s.turn.length, 1);
});

test('killer: house rules', () => {
  const o = { lives: 5, mode: 'house' }, pick = [D(7), D(3), D(12), NEXT];
  // Hit someone else's double before you are a killer and they become one.
  let s = play('killer', ['A', 'B', 'C'], o, [...pick, D(3, 2)]);
  assert.deepEqual(s.killer, [false, true, false]); assert.deepEqual(s.lives, [5, 5, 5]);
  assert.equal(s.event, 'B is a killer');
  // A Shanghai on your own number wins outright, in any order.
  s = play('killer', ['A', 'B', 'C'], o, [...pick, D(7, 3), D(7), D(7, 2)]);
  assert.equal(s.winner, 0); assert.equal(s.event, 'Shanghai');
  s = play('killer', ['A', 'B', 'C'], o, [...pick, D(3, 3), D(3), D(3, 2)]);   // not on someone else's number
  assert.equal(s.winner, null); assert.equal(s.current, 1);
  s = play('killer', ['A', 'B', 'C'], { lives: 5, mode: 'classic' }, [...pick, D(7, 3), D(7), D(7, 2)]);
  assert.equal(s.winner, null);
  // It has to be in one visit.
  s = play('killer', ['A', 'B', 'C'], o, [...pick, D(1), D(7, 3), D(7), NEXT, NEXT, D(7, 2)]);
  assert.equal(s.winner, null);
});

test('killer: treble to become a killer, any part of a number to take a life', () => {
  const pick = [D(7), D(3), D(12), NEXT], M = D(0, 0);
  // Treble to start: A's double does nothing, the treble makes A a killer.
  let s = play('killer', ['A', 'B', 'C'], { lives: 3, mode: 'classic', become: 'treble' }, [...pick, D(7, 2), D(7, 3)]);
  assert.deepEqual(s.killer, [true, false, false]); assert.equal(s.event, 'A is a killer');
  assert.match(gameById('killer').hint(play('killer', ['A', 'B', 'C'], { lives: 3, become: 'treble' }, pick)), /T7/);
  // House rules with treble to start: someone else's treble makes them a killer, their double doesn't.
  s = play('killer', ['A', 'B', 'C'], { lives: 3, mode: 'house', become: 'treble' }, [...pick, D(3, 2), D(12, 3)]);
  assert.deepEqual(s.killer, [false, false, true]);
  // Any part: a killer's single takes a life (one a dart, whatever the bed); doubles still only.
  const any = { lives: 3, mode: 'classic', kill: 'any' };
  s = play('killer', ['A', 'B', 'C'], any, [...pick, D(7, 2), D(3), D(12, 3)]);
  assert.deepEqual(s.lives, [3, 2, 2]);
  s = play('killer', ['A', 'B', 'C'], { lives: 3, mode: 'classic' }, [...pick, D(7, 2), D(3), D(12, 3)]);
  assert.deepEqual(s.lives, [3, 3, 3]);
  // Before you are a killer a single on your own number does nothing; after, it costs a life.
  s = play('killer', ['A', 'B', 'C'], any, [...pick, D(7), D(7, 2), D(7)]);
  assert.deepEqual(s.lives, [2, 3, 3]);
  // Both together.
  s = play('killer', ['A', 'B', 'C'], { ...any, become: 'treble' }, [...pick, D(7, 3), D(3), D(3), M]);
  assert.deepEqual(s.lives, [3, 1, 3]);
});

test('random targets: seeded targets, a point for each hit, up to three in a visit', async () => {
  const { targets } = await import('../web/games/random.js');
  const o = { doubles: 'yes', trebles: 'yes', hard: 'no', goes: 20, seed: 7 };
  const seq = targets(o);
  assert.equal(seq.length, 60);                                   // three beds for every go
  assert.deepEqual(targets(o), seq);                              // the same seed, the same targets
  assert.notDeepEqual(targets({ ...o, seed: 8 }), seq);
  seq.forEach((t, i) => assert.ok(!seq.slice(Math.max(0, i - 3), i).includes(t)));  // never one of the last three
  const plain = targets({ doubles: 'no', trebles: 'no', goes: 50, seed: 3 });
  assert.ok(plain.every(t => t.mult === 1 && !t.part));
  assert.ok(targets({ ...o, trebles: 'no', goes: 50 }).every(t => t.mult !== 3));
  const game = gameById('random');
  assert.ok(Number.isInteger(newMatch('random', ['A'], { ...o, seed: undefined }).opts.seed));  // a new match is given a seed
  assert.equal(newMatch('x01', ['A'], {}).opts.seed, undefined);
  assert.equal(targets(o, 3).length, 180);                        // ... of every player
  const two = { ...o, goes: 2 }, [a1, a2, a3, b1, b2, , c1, , , d1] = targets(two, 2);
  assert.deepEqual(targets(two).slice(0, 3), [a1, a2, a3]);       // alone, a go is one visit
  const hit = t => ({ t: 'dart', ...t }), M = D(0, 0);
  let s = play('random', ['A', 'B'], two, []);
  assert.deepEqual(game.target(s), a1);
  s = play('random', ['A', 'B'], two, [hit(a1)]);                 // a hit on the first dart: two darts left, at the next bed
  assert.deepEqual(s.hits, [1, 0]); assert.equal(s.current, 0); assert.equal(s.turn.length, 1);
  assert.deepEqual(game.target(s), a2);
  s = play('random', ['A', 'B'], two, [hit(a1), hit(a2)]);
  assert.deepEqual(game.target(s), a3); assert.equal(s.current, 0);
  s = play('random', ['A', 'B'], two, [hit(a1), hit(a2), hit(a3)]);  // three targets in one visit
  assert.deepEqual(s.hits, [3, 0]); assert.equal(s.current, 1);
  assert.deepEqual(game.target(s), b1);                           // B starts on a bed of their own
  s = play('random', ['A', 'B'], two, [M, M, M]);
  assert.deepEqual(game.target(s), b1);                           // ... not the one A was left on
  s = play('random', ['A', 'B'], two, [M, hit(a1), M, M, M, hit(b1)]);
  assert.deepEqual(s.hits, [1, 1]); assert.deepEqual(s.thrown, [3, 3]);
  assert.deepEqual(game.target(s), c1);                           // a new go starts on a new bed
  // the right number in the wrong ring does not count
  s = play('random', ['A'], two, [{ t: 'dart', seg: a1.seg, mult: a1.mult === 1 ? 2 : 1 }]);
  assert.equal(s.hits[0], 0); assert.deepEqual(game.target(s), a1);
  s = play('random', ['A', 'B'], two, [M, M, M, M, M, M]);         // three misses each: no points, next go
  assert.deepEqual(s.hits, [0, 0]); assert.deepEqual(game.target(s), c1); assert.equal(s.current, 0);
  s = play('random', ['A', 'B'], two, [hit(a1), NEXT, NEXT, hit(c1), M, M, hit(d1), M, M]);
  assert.equal(s.winner, 0); assert.deepEqual(s.hits, [2, 1]); assert.equal(game.target(s), null);
  s = play('random', ['A'], two, [hit(a1), M, M, M, NEXT]);        // moving on early ends the last go too
  assert.equal(s.winner, 0); assert.match(game.result(s), /Hit 1 target in 6 darts/);
});

test('random targets: hard mode splits each single into its inner and outer half', async () => {
  const { targets, hits } = await import('../web/games/random.js');
  const o = { doubles: 'yes', trebles: 'yes', hard: 'yes', goes: 50, seed: 5 };
  const seq = targets(o);
  assert.ok(seq.every(t => t.mult !== 1 || t.seg === 25 || t.part === 'in' || t.part === 'out'));
  assert.ok(seq.some(t => t.part === 'in') && seq.some(t => t.part === 'out'));
  const inner = { seg: 20, mult: 1, part: 'in' }, outer = { seg: 20, mult: 1, part: 'out' };
  assert.equal(half({ ...scoreAt(0, 60), x: 0, y: 60 }), 'in');
  assert.equal(half({ ...scoreAt(0, 130), x: 0, y: 130 }), 'out');
  assert.equal(half({ seg: 20, mult: 3, x: 0, y: 103 }), null);
  assert.equal(hits({ seg: 20, mult: 1, x: 0, y: 60 }, inner), true);
  assert.equal(hits({ seg: 20, mult: 1, x: 0, y: 130 }, inner), false);  // the right number, the wrong half
  assert.equal(hits({ seg: 20, mult: 1, x: 0, y: 130 }, outer), true);
  assert.equal(hits({ seg: 20, mult: 1 }, outer), true);                 // no position: taken as a hit
  assert.equal(hits({ seg: 20, mult: 3, x: 0, y: 103 }, outer), false);
  const game = gameById('random'), s = play('random', ['A'], o, []);
  const first = seq[0], word = first.part === 'in' ? 'Inner' : first.part === 'out' ? 'Outer' : null;
  if (word) assert.equal(game.aim(s), `${word} ${first.seg}`);
  const said = t => game.aim({ winner: null, round: 1, got: 0, opts: o, seq: [t], players: ['A'], current: 0 });
  assert.equal(said(inner), 'Inner 20'); assert.equal(said(outer), 'Outer 20');
  assert.equal(said({ seg: 16, mult: 3 }), 'Treble 16'); assert.equal(said({ seg: 9, mult: 2 }), 'Double 9');
  assert.equal(said({ seg: 9, mult: 1 }), 'Single 9'); assert.equal(said({ seg: 25, mult: 2 }), 'Bullseye');
});

test('checkout hints can be hidden', () => {
  const x = gameById('x01');
  const s = play('x01', ['A'], { start: 40, out: 'double' }, []);
  assert.equal(x.hint(s), 'Checkout: D20');
  assert.equal(x.hint(s, { checkouts: false }), '');
  const c = gameById('c121');
  const t = play('c121', ['A'], { start: 121, darts: 9, inc: 1, rounds: 2 }, []);
  assert.match(c.hint(t), /^Checkout: /);
  assert.equal(c.hint(t, { checkouts: false }), '');
});

test('closest to the bull: who throws first', () => {
  const at = (x, y) => ({ ...scoreAt(x, y), x, y });
  // part-way through: B is next
  let b = bullUp([1, 2, 3], [at(0, 50)]);
  assert.deepEqual([b.next, b.order, b.thrown], [2, null, 1]);
  // nearest first, the rest nearest first too
  b = bullUp([1, 2, 3], [at(0, 50), at(30, 0), at(0, -40)]);
  assert.deepEqual(b.order, [2, 3, 1]);
  assert.equal(b.next, null);
  // the bullseye beats the 25 ring, which beats a dart just outside it
  assert.deepEqual(bullUp([1, 2, 3], [at(0, 17), at(0, 15), at(6, 0)]).order, [3, 2, 1]);
  // two in the 25 ring are level whatever the distance: those two throw again, the third is settled
  b = bullUp([1, 2, 3], [at(0, 8), at(0, 60), at(15, 0)]);
  assert.deepEqual([b.order, b.round, b.next, b.again, b.thrown, b.tail], [null, [1, 3], 1, true, 0, [2]]);
  b = bullUp([1, 2, 3], [at(0, 8), at(0, 60), at(15, 0), at(0, 90), at(0, 70)]);
  assert.deepEqual(b.order, [3, 1, 2]);
  // the same distance out is level too, and so on until it is settled
  b = bullUp([1, 2], [at(0, 40), at(40, 0), at(0, 0), at(1, 1), at(0, 100), at(0, 99)]);
  assert.deepEqual(b.order, [2, 1]);
  // a dart with no position is the furthest away
  assert.deepEqual(bullUp([1, 2], [{ seg: 0, mult: 0 }, at(0, 160)]).order, [2, 1]);
});

test('games are grouped into matches and training', () => {
  const ids = k => GAMES.filter(g => g.kind === k).map(g => g.id);
  assert.deepEqual(ids('match'), ['x01', 'cricket', 'killer']);
  assert.deepEqual(ids('training'), ['clock', 'bobs27', 'shanghai', 'bermuda', 'segment', 'rcheckout', 'c121', 'countup', 'random', 'free']);
  assert.ok(GAMES.every(g => g.kind === 'match' || g.kind === 'training'));
});

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
test("bob's 27: the bull is the last double, and the game goes on past zero if asked", () => {
  const log = [];
  for (let d = 1; d <= 20; d++) log.push(D(d, 2), D(0, 0), D(0, 0));
  let s = play('bobs27', ['A'], {}, log);
  assert.equal(s.winner, null); assert.deepEqual(gameById('bobs27').target(s), { seg: 25, mult: 2 });
  assert.equal(gameById('bobs27').aim(s), 'Bull');
  s = play('bobs27', ['A'], { zero: 'on' }, Array(6).fill(miss3).flat());
  assert.equal(s.winner, null); assert.equal(gameById('bobs27').aim(s), 'Double 7');
});

test('shanghai: only the round number scores', () => {
  const s = play('shanghai', ['A'], {}, [D(1, 3), D(20, 3), D(1)]);
  assert.equal(s.total[0], 4);
});
test('shanghai: single, double and treble wins outright', () => {
  const s = play('shanghai', ['A', 'B'], {}, [D(1), D(1, 2), D(1, 3)]);
  assert.equal(s.winner, 0); assert.equal(s.shanghais[0], 1);
  assert.equal(gameById('shanghai').result(s), 'Shanghai! A wins');
});
test('shanghai: with the rule off it is just points', () => {
  const log = [D(1), D(1, 2), D(1, 3), ...Array(18).fill(D(0, 0))];
  const s = play('shanghai', ['A'], { shanghai: 'no' }, log);
  assert.equal(s.total[0], 6); assert.equal(s.winner, 0);
  assert.equal(s.shanghais[0], 1);
  assert.equal(gameById('shanghai').result(s), 'Total 6');
});
test('shanghai: Next after one dart ends the visit', () => {
  const s = play('shanghai', ['A'], {}, [D(1), NEXT]);
  assert.equal(s.round, 2);
});
test('shanghai: two players, the highest total wins and a tie goes to the earlier player', () => {
  // 7 rounds: A hits the round's number once a visit, B twice
  const rounds = (a, b) => Array.from({ length: 7 }, (_, r) => [
    ...a.map(() => D(r + 1)), ...Array(3 - a.length).fill(D(0, 0)),
    ...b.map(() => D(r + 1)), ...Array(3 - b.length).fill(D(0, 0))]).flat();
  let s = play('shanghai', ['A', 'B'], {}, rounds([1], [1, 1]));
  assert.deepEqual(s.total, [28, 56]); assert.equal(s.winner, 1);
  s = play('shanghai', ['A', 'B'], {}, rounds([1, 1], [1, 1]));
  assert.deepEqual(s.total, [56, 56]); assert.equal(s.winner, 0);
  assert.equal(gameById('shanghai').result(s), 'Total 56');
  s = play('shanghai', ['A', 'B'], {}, rounds([1], [1, 1]).slice(0, -3));  // not finished until B's last visit
  assert.equal(s.winner, null);
});

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
test('bermuda: two players, the highest total wins', () => {
  // B scores 36 in round 1 and halves away to nothing, then hits the bull in round 13; A never hits
  const log = [...Array(3).fill(D(0, 0)), D(12), D(12), D(12), ...Array(66).fill(D(0, 0)),
    ...Array(3).fill(D(0, 0)), D(25, 2), D(0, 0), D(0, 0)];
  let s = play('bermuda', ['A', 'B'], {}, log);
  assert.deepEqual(s.total, [0, 50]); assert.equal(s.winner, 1);
  assert.equal(gameById('bermuda').result(s), 'B wins with 50.');
  s = play('bermuda', ['A', 'B'], {}, log.slice(0, -3));  // not finished until B's last visit
  assert.equal(s.winner, null);
});

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
test('segment: two players, most points wins, a tie goes to the first', () => {
  const opts = { seg: 20, counts: 'any', darts: 30 };
  const turn = (...ds) => [...ds, ...Array(3 - ds.length).fill(D(0, 0))];
  const log = [];
  for (let r = 0; r < 10; r++) log.push(...turn(D(20)), ...turn(r === 9 ? D(20, 3) : D(20)));
  let s = play('segment', ['A', 'B'], opts, log.slice(0, -3));
  assert.equal(s.winner, null);  // not over until B's last darts
  s = play('segment', ['A', 'B'], opts, log);
  assert.equal(s.winner, 1); assert.equal(s.points[1], 12);
  assert.match(gameById('segment').result(s), /B wins/);
  s = play('segment', ['A', 'B'], opts, [...Array(10).fill(turn(D(20))).flat(), ...Array(10).fill(turn(D(20))).flat()]);
  assert.equal(s.winner, 0);
});

test('random checkout: targets are seeded, in range and finishable', () => {
  const a = rcTargets(12345, 'mid', 20);
  assert.equal(a.length, 20);
  assert.deepEqual(a, rcTargets(12345, 'mid', 20));
  assert.ok(a.every(t => t >= 41 && t <= 100 && checkout(t, 3, true)));
  assert.ok(rcTargets(1, 'high', 50).every(t => t >= 101 && t <= 170 && checkout(t, 3, true)));
  assert.ok(rcTargets(1, 'low', 50).every(t => t >= 2 && t <= 40));
  assert.notDeepEqual(rcTargets(1, 'all', 20), rcTargets(2, 'all', 20));
});
test('random checkout: finishing on a double counts and moves on', () => {
  const opts = { range: 'low', darts: 6, count: 10, seed: 7 };
  const t = rcTargets(7, 'low', 10)[0];
  const route = checkout(t, 3, true);  // [{seg, mult}, …]
  const s = play('rcheckout', ['A'], opts, route.map(d => D(d.seg, d.mult)));
  assert.equal(s.made[0], 1); assert.equal(s.tried[0], 1); assert.equal(s.left[0], rcTargets(7, 'low', 10)[1]);
  assert.equal(s.dartsMade[0], route.length);
  assert.equal(gameById('rcheckout').left(s), rcTargets(7, 'low', 10)[1]);
});
test('random checkout: out of darts is a miss', () => {
  const s = play('rcheckout', ['A'], { range: 'low', darts: 3, count: 10, seed: 7 }, [D(0, 0), D(0, 0), D(0, 0)]);
  assert.equal(s.made[0], 0); assert.equal(s.tried[0], 1);
  assert.equal(s.left[0], rcTargets(7, 'low', 10)[1]);
});
test('random checkout: a bust resets the visit and uses it up', () => {
  const t = rcTargets(7, 'low', 10)[0];
  let s = play('rcheckout', ['A'], { range: 'low', darts: 6, count: 10, seed: 7 }, [D(20, 3)]);  // over any low target
  assert.equal(s.left[0], t); assert.equal(s.used[0], 3); assert.equal(s.tried[0], 0);
  s = play('rcheckout', ['A'], { range: 'low', darts: 3, count: 10, seed: 7 }, [D(20, 3)]);
  assert.equal(s.tried[0], 1); assert.equal(s.made[0], 0);
});

// Plays a whole game: plan(s, p) gives the darts of the current player's next visit.
function playOut(players, opts, plan) {
  const m = newMatch('rcheckout', players, opts);
  for (let n = 0; n < 500; n++) {
    const s = compute(m);
    if (s.winner != null) return s;
    if (s.turnOver) m.log.push(NEXT);  // checked out: pull the darts first
    else m.log.push(...plan(s, s.current));
  }
  throw new Error('the game never ended');
}
const M = D(0, 0);
const routeTo = left => checkout(left, 3, true).map(d => D(d.seg, d.mult));

test('random checkout: a game ends once everyone has had every target; most made wins', () => {
  const opts = { range: 'mid', darts: 3, count: 10, seed: 99 };
  let s = playOut(['A', 'B'], opts, (s, p) => (p === 1 ? routeTo(s.left[p]) : [M, M, M]));
  assert.equal(s.winner, 1); assert.deepEqual(s.made, [0, 10]); assert.deepEqual(s.tried, [10, 10]);
  assert.match(gameById('rcheckout').result(s), /^B wins/);
  s = playOut(['A'], opts, s => routeTo(s.left[0]));
  assert.equal(s.winner, 0); assert.equal(s.made[0], 10);
  assert.match(gameById('rcheckout').result(s), /10 of 10/);
});
test('random checkout: equal checkouts go to fewer darts, then to the first player', () => {
  const opts = { range: 'low', darts: 6, count: 10, seed: 3 };
  // A wastes a visit on every target; B goes straight out: 10 each, B in fewer darts
  let s = playOut(['A', 'B'], opts, (s, p) => (p === 0 && s.used[p] === 0 ? [M, M, M] : routeTo(s.left[p])));
  assert.deepEqual(s.made, [10, 10]); assert.ok(s.dartsMade[1] < s.dartsMade[0]);
  assert.equal(s.winner, 1);
  s = playOut(['A', 'B'], opts, (s, p) => routeTo(s.left[p]));
  assert.equal(s.winner, 0);
});
