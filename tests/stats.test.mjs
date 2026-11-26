// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// The deep stats (web/stats.js): X01 figures and the lists behind them, worked
// out from the history the server sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENOUGH, X01_TILES, x01Tile, x01Stats, x01Legs, x01Trend, x01Brackets, headToHead, visitsOf, dartTable, visitsWith, setsSideBySide, boardsSideBySide } from '../web/stats.js';
import { practiceStreak, recordPracticeDay } from '../web/routine.js';

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

test('a visit as the server sends it', () => {
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

test('sets of darts side by side: each set\'s figures, once there are enough darts behind them', () => {
  // Sam's 12-darter thrown with red, 101 games with blue, and one with no set said.
  const many = n => Array.from({ length: n }, (_, i) => ({ ...quick, id: `q${i}`, darts: 'red' }));
  const blue = { ...lost, darts: 'blue' }, unsaid = { ...quick, id: 'u', darts: null };
  let side = setsSideBySide([...many(1), blue, unsaid]);
  assert.deepEqual([...side.keys()], ['red', 'blue', null]);
  const red = side.get('red');
  assert.deepEqual([red.x01Darts, red.coDarts, red.coHit, red.singles, red.trebleHits], [12, 3, 1, 12, 8]);
  assert.deepEqual(red.need, { average: ENOUGH.average - 12, checkout: ENOUGH.checkout - 3, trebles: ENOUGH.trebles - 12 });
  assert.deepEqual([red.average, red.checkout, red.trebles], [null, null, null]);  // not enough yet
  // blue: only Sam's visits (Alex threw first): a typed 60 counts 3 in the average but has no single
  // darts, and the bust's two darts count as three in the average, as the X01 tiles count them
  const b = side.get('blue');
  assert.deepEqual([b.x01Darts, b.singles, b.trebleHits], [6, 2, 0]);

  // 17 games: 51 darts at a double (17 hit) is enough for checkouts, 204 darts is not for the rest
  side = setsSideBySide(many(17));
  assert.equal(side.get('red').checkout, 17 / 51 * 100);
  assert.deepEqual([side.get('red').average, side.get('red').trebles], [null, null]);
  // 25 games of 12 darts is 300 X01 darts and 300 single darts: everything shows
  const r = setsSideBySide(many(25)).get('red');
  assert.equal(r.average, 501 / 12 * 3);
  assert.equal(r.trebles, 8 / 12 * 100);
  assert.deepEqual(r.need, { average: 0, checkout: 0, trebles: 0 });
  assert.deepEqual(setsSideBySide([]), new Map());
});

test('boards side by side: the same figures, grouped by the board each game was on', () => {
  const side = boardsSideBySide([{ ...quick, board: 'old', darts: 'red' }, { ...lost, board: 'new', darts: 'red' }]);
  assert.deepEqual([...side.keys()], ['old', 'new']);
  assert.equal(side.get('old').x01Darts, 12);
  assert.equal(side.get('new').x01Darts, 6);
  assert.equal(side.get('old').average, null);  // not enough yet, as for sets
});

test('matchSummary: everyone side by side, the best marked, X01 leg by leg', async () => {
  const { matchSummary } = await import('../web/stats.js');
  // 101, first to 2 legs. A: T20 S11 (40 left), then D20 out; B: 60 (41 left). Leg 2 unfinished, B typed a visit.
  const m = { game: 'x01', opts: { start: 101, legs: 2 }, players: ['A', 'B'], started: 0, visits: [
    [0, 1, 1, 0, [203, 11, 0]], [1, 1, 2, 0, [201, 201, 201]], [0, 2, 3, 0, [202]],
    [0, 1, 4, 0, [201, 0, 0]], [1, 1, 5, 0, null, 45, 3]] };
  const { rows, legs } = matchSummary(m);
  const line = label => rows.find(r => r.label === label);
  assert.deepEqual(line('Legs won').cells, ['1', '0']);
  assert.equal(line('Legs won').best, 0);
  assert.deepEqual(line('Highest checkout').cells, ['40', '–']);
  assert.deepEqual(line('Checkout rate').cells, ['50% (1/2)', '–']);  // the miss left on 40 was a dart at D20
  assert.deepEqual(line('Trebles').cells, ['1', '0']);
  assert.deepEqual(line('Darts thrown').cells, ['7', '6']);
  assert.equal(line('Darts thrown').best, null);  // more or fewer is neither better nor worse
  assert.equal(line('Highest checkout').best, null);  // only one player has one
  assert.equal(legs.length, 2);
  assert.deepEqual(legs[0], { n: 1, set: 1, winner: 0, cells: [{ avg: '75.8', darts: 4 }, { avg: '60.0', darts: 3 }] });
  assert.equal(legs[1].winner, null);
  // other games: the darts alone
  assert.deepEqual(matchSummary({ ...m, game: 'cricket' }).rows.map(r => r.label),
    ['Darts thrown', 'Trebles', 'Doubles', 'Bulls (25 and 50)', 'Misses']);
});

test('x01Trend and x01Brackets summarise recent form and visit score distribution', () => {
  // Two 101 legs: first leg 6 darts (50.5 avg), second leg 3 darts (101.0 avg -> +50.5 delta)
  const m = {
    game: 'x01', opts: { start: 101, legs: 2 }, players: ['Sam'], me: 0, started: 1000,
    visits: [
      [0, 1, 1001, 0, null, 61, 3], [0, 2, 1002, 0, null, 40, 3],
      [0, 1, 1003, 0, null, 101, 3],
    ],
  };
  const s = x01Stats([m]);
  const trend = x01Trend(s);
  assert.equal(trend.legs.length, 2);
  assert.equal(Math.round(trend.min * 10) / 10, 50.5);
  assert.equal(Math.round(trend.max * 10) / 10, 101);
  assert.equal(Math.round(trend.delta * 10) / 10, 50.5);

  const brackets = x01Brackets(s);
  const byLabel = Object.fromEntries(brackets.map(b => [b.label, b.count]));
  assert.deepEqual(byLabel, { '180': 0, '140+': 0, '100+': 1, '60+': 1, 'Under 60': 1 });
});

test('headToHead aggregates 2-player rivalry records and X01 averages', () => {
  const m1 = { game: 'x01', opts: { start: 101 }, players: ['Sam', 'Jo'], me: 0, winner: 0, started: 1,
    visits: [[0, 1, 1, 0, null, 101, 3]] };
  const m2 = { game: 'x01', opts: { start: 101 }, players: ['Sam', 'Jo'], me: 0, winner: 1, started: 2,
    visits: [[0, 1, 2, 0, null, 41, 3], [1, 1, 3, 0, null, 101, 3]] };
  const rows = headToHead([m1, m2]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].opponent, 'Jo');
  assert.equal(rows[0].won, 1);
  assert.equal(rows[0].lost, 1);
  assert.equal(rows[0].bestCheckout, 101);
});

test('practiceStreak counts consecutive practice days', () => {
  const mem = new Map();
  const st = { get: (k, d) => mem.has(k) ? mem.get(k) : d, set: (k, v) => mem.set(k, v) };
  recordPracticeDay(st, new Date(2026, 10, 24));
  recordPracticeDay(st, new Date(2026, 10, 25));
  assert.deepEqual(practiceStreak(st, new Date(2026, 10, 26)), { days: 2, doneToday: false });
  recordPracticeDay(st, new Date(2026, 10, 26));
  assert.deepEqual(practiceStreak(st, new Date(2026, 10, 26)), { days: 3, doneToday: true });
});
