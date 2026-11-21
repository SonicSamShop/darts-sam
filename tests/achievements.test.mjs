// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// Achievements (web/achievements.js): worked out from a player's games.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tally, add, held, newly, chief, totalOf, timeline, visitOf, standing, earnedBy, logOf, endOf, byId, ACHIEVEMENTS } from '../web/achievements.js';
import { newMatch, compute } from '../web/engine.js';
import { matchSheet } from '../web/sync.js';
import { x01Stats, x01Tile } from '../web/stats.js';
import { GAMES } from '../web/games/index.js';
import { LEVELS } from '../web/bot.js';

const T20 = 203, S20 = 201, D20 = 202, T19 = 193, S5 = 51, S1 = 11, T5 = 53, T1 = 13, D1 = 12, BULL = 252, MISS = 0;
const DAY = 86400000;
let n = 0;
// A game as a history entry. Visits are [player, darts] (or [player, null, total, darts used] typed in,
// or [player, darts, 'bust']); rounds and times are filled in.
function sheet(game, opts, players, visits, more = {}) {
  const rounds = players.map(() => 0), started = more.started ?? 1000;
  return {
    id: 'g' + ++n, game, name: game, opts, started, finished: started + 500, duration: 500, players, winner: 0,
    bots: players.map(() => null),
    visits: visits.map(([p, darts, total, used], i) => darts
      ? [p, ++rounds[p], started + i, +(total === 'bust'), darts] : [p, ++rounds[p], started + i, 0, null, total, used]),
    ...more,
  };
}
const x01 = (visits, more) => sheet('x01', { start: 501, out: 'double' }, ['Sam', 'Alex'], visits, more);
const has = (t, id) => held(t).has(id);

test('a 180 is a Ton, a Ton forty and a Maximum, and is shown as a Maximum', () => {
  const t = tally(x01([[0, [T20, T20, T20]]], { winner: null }), 0);
  assert.equal(t.t100, 1); assert.equal(t.t140, 1); assert.equal(t.t180, 1);
  const fresh = newly(held({}), held(t));
  assert.deepEqual(fresh.map(a => a.id), ['max', 'bed']);
  assert.equal(chief(fresh).id, 'max');
  assert.equal(tally(x01([[0, [T20, T20, T20]]], { winner: null }), 1).t180, undefined);  // not Alex's
});

test('a visit still being thrown is not judged on its total', () => {
  const s = x01([[0, [T20, T20]]], { winner: null });
  assert.equal(tally(s, 0, 0).t100, undefined);
  assert.equal(tally(s, 0).t100, 1);
});

test('a typed visit earns what its total says and nothing that needs the beds', () => {
  const t = tally(x01([[0, null, 180, 3], [1, null, 150, 3]], { winner: null }), 0);
  assert.equal(t.t180, 1);
  assert.equal(t.bed, undefined);
  assert.equal(t.darts, undefined);  // as on the stats page: typed visits have no single darts
  assert.equal(tally(sheet('countup', {}, ['Sam'], [[0, null, 150, 3]], { winner: null }), 0).hat, undefined);
});

test('three in a bed, Shanghai, hat trick, Bed and breakfast', () => {
  const of = darts => tally(x01([[0, darts]], { winner: null }), 0);
  assert.equal(of([T20, T20, T20]).bed, 1);
  assert.equal(of([S20, S20, S20]).bed, undefined);
  assert.equal(of([D20, S20, T20]).shanghai, 1);
  assert.equal(of([D20, S20, T19]).shanghai, undefined);
  assert.equal(of([BULL, BULL, BULL]).hat, 1);
  assert.equal(of([BULL, BULL, BULL]).bull, 3);
  assert.equal(of([S5, S1, S20]).breakfast, 1);
  assert.equal(of([T20, T5, T1]).breakfast, undefined);
  assert.equal(of([S20, S5]).breakfast, undefined);
});

test('a bust visit earns nothing', () => {
  const s = sheet('x01', { start: 101, out: 'double' }, ['Sam'], [[0, [T20, T20, T20], 'bust']], { winner: null });
  const t = tally(s, 0);
  assert.equal(t.t180, undefined); assert.equal(t.bed, undefined); assert.equal(t.darts, 3);
});

test('counts add up, and a stepped achievement is earned at each step', () => {
  const games = Array.from({ length: 10 }, () => ({ sheet: x01([[0, [T20, T20, T20]]], { winner: null }), me: 0 }));
  const t = totalOf(games);
  assert.equal(t.t180, 10);
  assert.ok(has(t, 'max') && has(t, 'max:10') && !has(t, 'max:50'));
  assert.equal(byId('max:10').name, 'Maximum ×10');
  assert.deepEqual(add({ a: 1, 'day:x': 1 }, { a: 2, 'day:x': 1 }), { a: 3, 'day:x': 1 });
});

test('the 180s behind Maximum are the stats page\'s 180s', () => {
  const history = [
    x01([[0, [T20, T20, T20]], [1, [S20, S20, S20]], [0, null, 180, 3], [1, [T20, T20, T20]]], { winner: null }),
    sheet('x01', { start: 101, out: 'double' }, ['Sam', 'Alex'], [[0, [T20, T20, T20], 'bust']], { winner: null }),
  ].map(m => ({ ...m, me: 0 }));
  const total = totalOf(history.map(m => ({ sheet: m, me: 0 })));
  const stats = x01Stats(history);
  assert.equal(total.t180, x01Tile('t180').rows(stats).length);
  assert.equal(total.t180, 2);
});

test('first games: one per game, only when finished, and all of them', () => {
  assert.equal(ACHIEVEMENTS.filter(a => a.group === 'First games').length, GAMES.length + 1);
  assert.ok(has(tally(x01([[0, [S20]]]), 0), 'first:x01'));
  assert.ok(!has(tally(x01([[0, [S20]]], { winner: null }), 0), 'first:x01'));
  const every = GAMES.reduce((t, g) => add(t, { ['g:' + g.id]: 1 }), {});
  assert.ok(has(every, 'round'));
  const { ['g:killer']: _, ...most } = every;
  assert.ok(!has(most, 'round'));
});

test('finishing: Big fish, bull finish, Madhouse, and the darts a 501 leg took', () => {
  const on = (start, visits) => tally(sheet('x01', { start, out: 'double' }, ['Sam', 'Alex'], visits), 0);
  const fish = on(170, [[0, [T20, T20, BULL]]]);
  assert.deepEqual([fish.out, fish.out100, fish.out170, fish.outBull], [1, 1, 1, 1]);
  assert.deepEqual(newly(held({}), held(fish)).filter(a => a.family?.[0] === 'out').map(a => a.id), ['out170']);
  assert.equal(on(2, [[0, [D1]]]).outD1, 1);
  assert.equal(on(2, [[0, null, 2, 1]]).outD1, undefined);
  assert.equal(on(2, [[0, null, 2, 1]]).out, 1);
  // straight out: a finish, but not one of these
  assert.equal(tally(sheet('x01', { start: 60, out: 'straight' }, ['Sam'], [[0, [T20]]]), 0).out, undefined);
  // 501 in 15: 180, 180, 81 (T20 S20 S1), 40 left... 180+180+81 = 441, 60 left: S20, D20
  const leg = on(501, [[0, [T20, T20, T20]], [1, [S1, S1, S1]], [0, [T20, T20, T20]], [1, [S1, S1, S1]],
    [0, [T20, S20, S1]], [1, [S1, S1, S1]], [0, [S20, MISS, MISS]], [1, [S1, S1, S1]], [0, [MISS, MISS, D20]]]);
  assert.deepEqual([leg.in18, leg.in15, leg.in12], [1, 1, undefined]);
  // a 301 leg in few darts is none of them
  assert.equal(on(301, [[0, [T20, T20, T20]], [1, [S1]], [0, [T20, T19, D2()]]]).in9, undefined);
});
function D2() { return 22; }  // T20 T20 T20 (121 left), T20 T19 D2 = 60 + 57 + 4

test('winning: against someone, against the computer, and a whitewash', () => {
  const solo = sheet('x01', { start: 2, out: 'double' }, ['Sam'], [[0, [D1]]]);
  assert.equal(tally(solo, 0).wins, undefined);
  assert.equal(tally(solo, 0).games, 1);
  const two = sheet('x01', { start: 2, out: 'double' }, ['Sam', 'Bot 7'], [[0, [D1]]]);
  assert.equal(tally(two, 0).wins, 1);
  assert.equal(tally(two, 0).botWins, undefined);
  assert.equal(tally(two, 1).wins, undefined);
  const top = LEVELS.at(-1).level;
  assert.equal(tally({ ...two, bots: [null, 7] }, 0).botWins, 1);
  assert.equal(tally({ ...two, bots: [null, 7] }, 0).topWins, undefined);
  assert.equal(tally({ ...two, bots: [null, top] }, 0).topWins, 1);
  assert.equal(byId('wins').name, 'First win');
  // first to three legs of 2: Sam takes all three
  const legs = { start: 2, out: 'double', legs: 3 };
  const clean = sheet('x01', legs, ['Sam', 'Alex'], [[0, [D1]], [1, [D1]], [0, [D1]], [0, [D1]]].filter((v, i) => i !== 1));
  assert.equal(tally(clean, 0).whitewash, 1);
  const dropped = sheet('x01', legs, ['Sam', 'Alex'], [[0, [D1]], [1, [D1]], [0, [D1]], [1, [MISS, MISS, MISS]], [0, [D1]]]);
  assert.equal(tally(dropped, 0).whitewash, undefined);
});

test('long service: darts, games and different days', () => {
  const games = [0, 0, 1, 3].map(d => ({ sheet: x01([[0, [S20, S20, S20]]], { started: 1e12 + d * DAY }), me: 0 }));
  const t = totalOf(games);
  assert.equal(t.darts, 12); assert.equal(t.games, 4);
  assert.equal(byId('days').value(t), 3);
  assert.ok(has({ darts: 1000 }, 'darts') && !has({ darts: 999 }, 'darts'));
  assert.equal(byId('darts').name, '1,000 darts thrown');
  assert.equal(byId('darts:10000').mark, '10k');
});

// ---------- the other games, read from the engine ----------
const D = (seg, mult = 1) => ({ t: 'dart', seg, mult, ts: 5000 });
const NEXT = { t: 'next', ts: 5000 };
const game = (id, players, opts, log) => ({ ...newMatch(id, players, opts), id: 'e' + ++n, log });
const defaults = id => Object.fromEntries(GAMES.find(g => g.id === id).options.map(o => [o.key, o.default]));

test('a sheet played back through the engine ends where the game did', () => {
  const games = [
    game('x01', ['A', 'B'], { start: 101, out: 'double' }, [D(20, 3), NEXT, D(5), D(5), D(5), D(1), D(20, 2)]),
    game('clock', ['A', 'B'], defaults('clock'), [D(1), D(2), D(3), D(7), NEXT, D(4), D(5)]),
    game('bobs27', ['A'], defaults('bobs27'), [D(1, 2), NEXT, D(2, 2), D(2, 2), D(9)]),
    game('bermuda', ['A', 'B'], {}, [D(12), NEXT, D(3), D(3), D(3), D(13, 3)]),
    game('killer', ['A', 'B'], defaults('killer'), [D(7), D(0, 0), D(9), D(7, 2), D(9, 2), D(9, 2)]),
    game('c121', ['A'], defaults('c121'), [D(20, 3), D(11), D(25, 2), D(20), NEXT, D(20, 3)]),
    game('rcheckout', ['A', 'B'], { ...defaults('rcheckout'), seed: 12345 }, [D(1), D(1), D(1), D(20), NEXT, D(2, 2)]),
    game('cricket', ['A', 'B'], {}, [D(20, 3), D(19, 3), D(18, 3), D(20)]),
  ];
  for (const m of games) {
    const was = compute(m), now = endOf(matchSheet(m));
    for (const k of ['winner', 'current', 'round', 'score', 'target', 'total', 'halved', 'lives', 'killer', 'left', 'made', 'tried', 'points', 'thrown']) {
      assert.deepEqual(now[k], was[k], `${m.gameId}: ${k}`);
    }
    assert.equal(logOf(matchSheet(m)).filter(e => e.t === 'dart').length, was.throws.length, m.gameId);
  }
});

const played = (id, players, opts, log, me = 0) => tally(matchSheet(game(id, players, opts, log)), me);

test('Cricket: nine marks', () => {
  assert.equal(played('cricket', ['A', 'B'], {}, [D(20, 3), D(19, 3), D(18, 3)]).nine, 1);
  assert.equal(played('cricket', ['A', 'B'], {}, [D(20, 3), D(19, 3), D(14, 3)]).nine, undefined);
});

test('Around the Clock: finished in 30 darts or fewer', () => {
  const round = [...Array.from({ length: 20 }, (_, i) => D(i + 1)), D(25)];
  assert.equal(played('clock', ['A'], defaults('clock'), round).clock30, 1);
  const slow = [...Array(12).fill(D(0, 0)), ...round];
  assert.equal(played('clock', ['A'], defaults('clock'), slow).clock30, undefined);
  assert.equal(played('clock', ['A'], defaults('clock'), round.slice(0, 5)).clock30, undefined);
});

test("Bob's 27: above zero, and above the start", () => {
  const miss = [D(0, 0), D(0, 0), D(0, 0)];
  // hit every double once: 27 + 2 * (1 + ... + 20) + 50
  const all = [...Array.from({ length: 20 }, (_, i) => [D(i + 1, 2), D(0, 0), D(0, 0)]).flat(), D(25, 2), D(0, 0), D(0, 0)];
  const good = played('bobs27', ['A'], defaults('bobs27'), all);
  assert.deepEqual([good.bobUp, good.bobProfit], [1, 1]);
  // D1 three times then nothing: 33 - 4 - 6 - 8 - 10 = 5, then out at D6
  const out = played('bobs27', ['A'], defaults('bobs27'), [D(1, 2), D(1, 2), D(1, 2), ...Array(5).fill(miss).flat()]);
  assert.deepEqual([out.bobUp, out.bobProfit], [undefined, undefined]);
  assert.equal(played('bobs27', ['A'], defaults('bobs27'), [D(1, 2)]).bobUp, undefined);  // not finished
});

test('Bermuda: never halved', () => {
  const hit = [12, 13, 14, [1, 2], 15, 16, 17, [1, 3], 18, 19, 20, [25, 1], [25, 2]]
    .flatMap(t => [Array.isArray(t) ? D(...t) : D(t), D(0, 0), D(0, 0)]);
  assert.equal(played('bermuda', ['A'], {}, hit).unhalved, 1);
  const halved = [D(0, 0), D(0, 0), D(0, 0), ...hit.slice(3)];
  assert.equal(played('bermuda', ['A'], {}, halved).unhalved, undefined);
  assert.equal(played('bermuda', ['A'], {}, hit.slice(0, 9)).unhalved, undefined);
});

test('Killer: winning, and winning untouched', () => {
  const opts = { ...defaults('killer'), lives: 3 };
  // A is 7, B is 9. A becomes a killer and takes B's three lives.
  const log = [D(7), D(9), D(7, 2), D(9, 2), D(9, 2), D(0, 0), NEXT, D(9, 2)];
  const s = compute(game('killer', ['A', 'B'], opts, log));
  assert.equal(s.winner, 0);
  const a = played('killer', ['A', 'B'], opts, log);
  assert.deepEqual([a.killer, a.untouched], [1, 1]);
  assert.equal(played('killer', ['A', 'B'], opts, log, 1).killer, undefined);
  // B takes one of A's lives first
  const fight = [D(7), D(9), D(7, 2), D(0, 0), D(0, 0), D(9, 2), D(7, 2), D(0, 0), D(9, 2), D(9, 2), D(9, 2)];
  const f = compute(game('killer', ['A', 'B'], opts, fight));
  assert.equal(f.winner, 0); assert.equal(f.lives[0], 2);
  const b = played('killer', ['A', 'B'], opts, fight);
  assert.deepEqual([b.killer, b.untouched], [1, undefined]);
});

test('121 Checkout and Random Checkout', () => {
  const c = defaults('c121');
  assert.equal(played('c121', ['A'], { ...c, start: 121 }, [D(20, 3), D(11), D(25, 2)]).c121, 1);
  assert.equal(played('c121', ['A'], { ...c, start: 121 }, [D(20, 3), D(11), D(25, 1)]).c121, undefined);
  const r = { ...defaults('rcheckout'), seed: 7, count: 10 };
  const targets = compute(game('rcheckout', ['A'], r, [])).list;
  // every target in one dart where it is a double, else leave it: only an all-doubles list is a clean sheet
  const blank = played('rcheckout', ['A'], r, targets.flatMap(() => Array(r.darts).fill(D(0, 0))));
  assert.equal(blank.rcAll, undefined);
  assert.equal(blank.games, 1);
});

// ---------- in a game ----------
test('what a player holds as a match starts', () => {
  const a = { ...x01([[0, [T20, T20, T20]]]), me: 0 }, b = { ...x01([[1, [T20, T20, T20]]]), me: 1 };
  assert.equal(standing(null), null);
  assert.equal(standing([a, b]).t180, 2);
  assert.equal(standing([a, b], [], b.id).t180, 1);  // the live game is left out
  // a game waiting to be sent: counted once whether or not the history has it yet
  const w = { sheet: x01([[0, [T20, T20, T20]]]), me: 0 };
  assert.equal(standing([a], [w]).t180, 2);
  assert.equal(standing([a, { ...w.sheet, me: 0 }], [w]).t180, 2);
  assert.equal(standing([a], [w], w.sheet.id).t180, 1);
  assert.deepEqual(standing([]), {});
});

test('what a dart earns, and Undo taking it back', () => {
  const m = game('x01', ['Sam', 'Alex'], { start: 501, out: 'double' }, [D(20, 3), D(20, 3)]);
  const open = x => { const s = compute(x); return s.winner == null && s.turn.length ? matchSheet(x).visits.length - 1 : -1; };
  const after = { ...m, log: [...m.log, D(20, 3)] };
  const earned = base => earnedBy(base, matchSheet(m), open(m), matchSheet(after), open(after), 0).map(a => a.id);
  assert.deepEqual(earned({}), ['max', 'bed']);
  assert.deepEqual(earned({ t100: 5, t140: 2, t180: 1, bed: 1 }), []);          // not a first
  assert.deepEqual(earned({ t100: 20, t140: 12, t180: 9, bed: 9 }), ['max:10']);  // the tenth
  assert.deepEqual(earned(null), []);                                            // nothing to go on: nothing shown
  // the second treble 20 alone earns nothing yet: the visit is not over
  const one = { ...m, log: [D(20, 3)] };
  assert.deepEqual(earnedBy({}, matchSheet(one), open(one), matchSheet(m), open(m), 0), []);
  // Undo: with the dart gone it is not held
  const total = add({}, tally(matchSheet(m), 0, open(m)));
  assert.ok(!has(total, 'max'));
});

test('when and where each was earned', () => {
  const first = x01([[0, [S20, S20, S20]], [1, [S1]], [0, [T20, T20, T20]]], { started: 1e12 });
  const second = x01([[0, [T20, T20, T20]]], { started: 1e12 + DAY });
  const { got, total } = timeline([{ sheet: first, me: 0 }, { sheet: second, me: 0 }]);
  assert.equal(got.get('max').match, first.id);
  assert.equal(got.get('max').at, first.finished);
  assert.equal(total.t180, 2);
  assert.equal(visitOf(byId('max'), {}, first, 0), 2);
  assert.equal(visitOf(byId('first:x01'), {}, first, 0), 2);
  assert.equal(visitOf(byId('max:10'), {}, first, 0), null);
});
