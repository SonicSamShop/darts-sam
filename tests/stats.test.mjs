// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// The deep stats (web/stats.js): X01 figures and the lists behind them, worked
// out from the history the Pi sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { X01_TILES, x01Tile, x01Stats, x01Legs, visitsOf, dartTable, visitsWith } from '../web/stats.js';

const T20 = 203, S20 = 201, D20 = 202, D16 = 162, S1 = 11, MISS = 0;
const match = (id, visits, more = {}) => ({
  id, game: 'x01', name: 'X01', opts: { start: 501, out: 'double' }, started: 1000, finished: 2000, duration: 1000,
  players: ['Sam', 'Alex'], me: 0, winner: 0, visits, ...more,
});
// Sam throws first and wins 501 in 12 darts: 180, 140, 141 (leaving 40), then D20 with the third dart.
const quick = match('a', [
  [0, 1, 1100, 0, [T20, T20, T20]], [1, 1, 1200, 0, [S20, S20, S20]],
  [0, 2, 1300, 0, [T20, T20, S20]], [1, 2, 1400, 0, [S1, S1, MISS]],
  [0, 3, 1500, 0, [T20, T20, 73]], [1, 3, 1600, 0, [S20, S20, S20]],
  [0, 4, 1700, 0, [MISS, MISS, D20]],
]);
// Sam throws second from 101 and loses: a typed 60, then a bust on 41 (9 leaves 32, D20 is too many).
const lost = match('b', [
  [0, 1, 5100, 0, [T20, S1, MISS]],
  [1, 1, 5200, 0, null, 60, 3],
  [0, 2, 5300, 0, null, 0, 3],
  [1, 2, 5400, 1, [91, D20]],
  [0, 3, 5500, 0, null, 40, 2],
], { opts: { start: 101, out: 'double' }, players: ['Alex', 'Sam'], me: 1, winner: 0, started: 5000 });

test('a visit as the Pi sends it', () => {
  const [first, , , , , , last] = visitsOf(quick);
  assert.deepEqual(first.darts, [{ seg: 20, mult: 3 }, { seg: 20, mult: 3 }, { seg: 20, mult: 3 }]);
  assert.equal(first.total, 180);
  assert.equal(last.i, 6);
  const typed = visitsOf(lost)[1];
  assert.deepEqual([typed.darts, typed.total, typed.n], [null, 60, 3]);
});

test('x01 leg: what was left, darts at a double, both sides', () => {
  const [leg] = x01Legs(quick);
  assert.deepEqual(leg.mine.map(v => [v.no, v.before, v.score, v.after]), [[1, 501, 180, 321], [2, 321, 140, 181], [3, 181, 141, 40], [4, 40, 40, 0]]);
  assert.deepEqual(leg.mine[3].atDouble, [{ aim: 20, hit: false }, { aim: 20, hit: false }, { aim: 20, hit: true }]);
  assert.equal(leg.mine[3].checkout, true);
  assert.deepEqual([leg.darts, leg.points, leg.checkout, leg.won, leg.first], [12, 501, 40, true, true]);
  assert.equal(leg.avg, 125.25);
  assert.ok(Math.abs(leg.first9 - 461 / 3) < 1e-9);
  assert.equal(leg.sides[1].avg, 122 / 9 * 3);
  assert.equal(leg.sides[1].checkout, null);
  // a bust scores nothing, leaves what was there and counts as three darts
  const bust = x01Legs(lost)[0].mine[1];
  assert.deepEqual([bust.before, bust.score, bust.after, bust.thrown], [41, 0, 41, 3]);
  assert.deepEqual(bust.atDouble, [{ aim: 16, hit: false }]);  // the 9 left 32
});

test('x01 figures, and each tile counted from the list it opens', () => {
  const s = x01Stats([quick, lost, match('c', [], { game: 'clock' }), match('d', [[1, 1, 1, 0, [S20]]])]);
  assert.equal(s.legs.length, 2);  // not the Around the Clock game, nor the leg Sam has not thrown in
  const shows = key => { const t = x01Tile(key), rows = t.rows(s); return t.value ? t.value(s, rows) : rows.length; };
  assert.equal(shows('average'), (561 / 18 * 3).toFixed(1));
  assert.equal(shows('first9'), (521 / 15 * 3).toFixed(1));
  assert.deepEqual(['highest', 't180', 't140', 't100', 't60', 'busts'].map(shows), [180, 1, 2, 0, 1, 1]);
  assert.equal(shows('checkout'), '25.0%');
  assert.deepEqual(s.doubles, [{ aim: 20, hit: 1, darts: 3 }, { aim: 16, hit: 0, darts: 1 }]);
  assert.deepEqual(['bestCheckout', 'tonCheckouts', 'played', 'won'].map(shows), [40, 0, 2, 1]);
  assert.deepEqual(['holds', 'breaks', 'bestLeg', 'perLeg', 'in15', 'in18'].map(shows), ['1/1', '0/1', 12, '12.0', 1, 1]);
  for (const t of X01_TILES.flatMap(g => g.tiles)) assert.ok(Array.isArray(t.rows(s)), t.key);
  assert.equal(x01Stats([match('c', [], { game: 'clock' })]), null);
});

test('straight out has no darts at a double; nothing thrown gives no figures', () => {
  const s = x01Stats([match('e', [[0, 1, 1, 0, [S20, S20, D20]]], { opts: { start: 301, out: 'straight' }, winner: null })]);
  assert.equal(s.coDarts, 0);
  assert.equal(x01Tile('checkout').value(s), null);
  assert.equal(x01Tile('played').rows(s).length, 0);  // not finished
});

test('on 50, a dart counts as one at the bull only if it lands there or is the last', () => {
  const on50 = darts => x01Legs(match('f', [[0, 1, 1, 0, darts]], { opts: { start: 50, out: 'double' }, winner: null }))[0].mine[0].atDouble;
  assert.deepEqual(on50([101, D20]), [{ aim: 20, hit: true }]);  // 10, D20: the 10 was a set-up dart
  assert.deepEqual(on50([251, MISS, MISS]), [{ aim: 25, hit: false }]);
  assert.deepEqual(on50([MISS, MISS, 252]), [{ aim: 25, hit: true }]);
});

test('darts by number, from visits with single darts', () => {
  const mine = [quick, lost].flatMap(m => visitsOf(m).filter(v => v.p === m.me));
  const table = dartTable(mine);
  assert.deepEqual(table[0], { seg: 20, by: [0, 1, 2, 7], n: 10, share: 10 / 14 });
  assert.deepEqual(table.find(r => r.seg === 0).by, [2, 0, 0, 0]);
  assert.equal(table.reduce((n, r) => n + r.n, 0), 14);  // the typed visit has no darts to count
  assert.equal(visitsWith(mine, 0).length, 1);
  assert.equal(visitsWith(mine, 9).length, 1);
});

test('a match of several legs is split into its legs', () => {
  // First to two legs from 101: Sam wins the first, Alex (who starts the second) wins it,
  // Sam starts the third and it is not finished.
  const legs = x01Legs(match('g', [
    [0, 1, 100, 0, [T20, S1, D20]],
    [1, 2, 200, 0, [T20, S1, MISS]], [0, 2, 300, 0, [T20, MISS, MISS]], [1, 3, 400, 0, [D20]],
    [0, 4, 500, 0, [S20]],
  ], { opts: { start: 101, out: 'double', legs: 2, sets: 1 }, winner: null }));
  assert.deepEqual(legs.map(l => [l.n, l.of, l.when, l.first, l.finished, l.won, l.darts, l.checkout]), [
    [1, 3, 100, true, true, true, 3, 101], [2, 3, 200, false, true, false, 3, null], [3, 3, 500, true, false, false, 1, null]]);
  assert.deepEqual(legs[1].visits.map(v => [v.p, v.no, v.before, v.after]), [[1, 1, 101, 40], [0, 1, 101, 41], [1, 2, 40, 0]]);
  assert.equal(legs[1].sides[1].checkout, 40);
  const s = x01Stats([legs[0].m]);
  assert.deepEqual(['played', 'won', 'holds', 'breaks'].map(k => x01Tile(k).rows(s).length), [2, 1, 1, 1]);
});
