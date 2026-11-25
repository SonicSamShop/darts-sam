// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// The rules of a knockout tournament (web/tournament.js): the draw, byes, results moving on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedOrder, makeDraw, roundName, roundCount, defaultRounds, suggestName, freeLevel,
  readySlots, nextSlot, botSlots, boardSlots, startSlot, dropMatch, recordResult, clearResult,
  reconcile, remapIds, simulateMatch, playedMatch, seenResults,
} from '../web/tournament.js';
import { compute } from '../web/engine.js';

// A tiny LCG, so a draw comes out the same every run.
function lcg(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}

const people = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}` }));
const draw = (entrants, seed = 1) => makeDraw({
  id: 't1', name: 'Test', entrants, opts: { start: 501, out: 'double' },
  rounds: defaultRounds(entrants.length), now: 1000,
}, lcg(seed));
// The slots of round r, in order.
const inRound = (t, r) => t.data.slots.filter(s => s.round === r);

test('tournament: seed order puts 1 against the last seed', () => {
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('tournament: every size from 3 to 16 draws a bracket where byes never meet', () => {
  for (let n = 3; n <= 16; n++) {
    const t = draw(people(n), n);
    const size = 2 ** Math.ceil(Math.log2(n));
    assert.equal(roundCount(t), Math.log2(size), `n=${n}`);
    assert.equal(t.data.slots.length, size - 1, `n=${n}`);
    const first = inRound(t, 0);
    assert.equal(first.length, size / 2, `n=${n}`);
    const ids = first.flatMap(s => [s.a, s.b]).filter(p => p !== 'bye');
    assert.deepEqual([...ids].sort((x, y) => x - y), people(n).map(p => p.id), `n=${n}: each player once`);
    first.forEach((s, j) => {
      assert.ok(!(s.a === 'bye' && s.b === 'bye'), `n=${n}: bye v bye`);
      if (s.a !== 'bye' && s.b !== 'bye') return;
      const player = s.a === 'bye' ? s.b : s.a;
      assert.equal(s.how, 'bye');
      assert.equal(s.winner, player);
      const next = inRound(t, 1)[Math.floor(j / 2)];
      assert.equal(j % 2 ? next.b : next.a, player, `n=${n}: bye goes straight through`);
    });
  }
});

test('tournament: round lengths and names', () => {
  assert.deepEqual(defaultRounds(5), [{ legs: 2 }, { legs: 2 }, { legs: 3 }]);
  assert.deepEqual(defaultRounds(3), [{ legs: 2 }, { legs: 3 }]);
  const eight = draw(people(8));
  assert.deepEqual([0, 1, 2].map(r => roundName(eight, r)), ['Quarter-finals', 'Semi-finals', 'Final']);
  assert.equal(roundName(eight, 3), 'Winner');
  assert.equal(roundName(draw(people(16)), 0), 'Last 16');
});

test('tournament: a suggested name', () => {
  assert.equal(suggestName(new Date(2026, 11, 24)), 'Christmas 2026');
  assert.equal(suggestName(new Date(2026, 11, 20)), 'Christmas 2026');
  assert.equal(suggestName(new Date(2026, 11, 31)), 'Christmas 2026');
  assert.equal(suggestName(new Date(2026, 10, 24)), 'Tournament 24 Nov');
  assert.equal(suggestName(new Date(2026, 11, 19)), 'Tournament 19 Dec');
});

test('tournament: a second bot at the same level takes the next free one', () => {
  assert.equal(freeLevel(5, []), 5);
  assert.equal(freeLevel(5, [5]), 6);
  assert.equal(freeLevel(15, [15]), 14);
  assert.equal(freeLevel(14, [14, 15, 13]), 12);
  assert.equal(freeLevel(3, Array.from({ length: 15 }, (_, i) => i + 1)), null);
});

test('tournament: results move on to the final, and the final finishes it', () => {
  let t = draw(people(4));
  const [s0, s1] = inRound(t, 0);
  t = recordResult(t, 0, s0.a, [2, 1], 'played');
  t = recordResult(t, 1, s1.b, [0, 2], 'played');
  assert.deepEqual([t.data.slots[2].a, t.data.slots[2].b], [s0.a, s1.b]);
  assert.deepEqual(t.data.slots[0].legs, [2, 1]);
  assert.equal(t.winner, null);
  assert.equal(t.finished, null);
  t = recordResult(t, 2, s1.b, [3, 1], 'played');
  assert.equal(t.winner, s1.b);
  assert.equal(typeof t.finished, 'number');
});

test('tournament: recordResult leaves the record it was given alone', () => {
  const t = draw(people(4));
  const copy = JSON.parse(JSON.stringify(t));
  recordResult(t, 0, t.data.slots[0].a, [2, 0], 'played');
  assert.deepEqual(t, copy);
});

test('tournament: a result can be taken back until the next match starts', () => {
  let t = draw(people(4));
  const s0 = t.data.slots[0];
  t = recordResult(t, 0, s0.a, [2, 0], 'played');
  const undone = clearResult(t, 0);
  assert.equal(undone.data.slots[0].winner, null);
  assert.equal(undone.data.slots[0].legs, null);
  assert.equal(undone.data.slots[0].how, null);
  assert.equal(undone.data.slots[2].a, null);
  assert.equal(t.data.slots[2].a, s0.a);  // the one given is unchanged

  t = recordResult(t, 1, t.data.slots[1].a, [2, 1], 'played');
  t = startSlot(t, 2, 'm9');
  assert.equal(clearResult(t, 0), t);

  // The final: taking it back unfinishes the tournament.
  t = recordResult(t, 2, s0.a, [3, 0], 'played');
  const back = clearResult(t, 2);
  assert.equal(back.winner, null);
  assert.equal(back.finished, null);
  assert.equal(back.data.slots[2].winner, null);
});

test('tournament: the next match skips bot against bot, which is listed to play out', () => {
  const entrants = [{ id: 1, name: 'Sam' }, { id: 2, name: 'Jake' }, { id: 3, name: 'Bot 5', bot: 5 }, { id: 4, name: 'Bot 9', bot: 9 }];
  let t = makeDraw({ id: 't', name: 'T', entrants, opts: { start: 501, out: 'double' }, rounds: defaultRounds(4), now: 1 }, lcg(1));
  // Put the bots together in slot 0 and the people in slot 1, whatever the draw did.
  t = { ...t, data: { ...t.data, slots: t.data.slots.map((s, i) => i === 0 ? { ...s, a: 3, b: 4 } : i === 1 ? { ...s, a: 1, b: 2 } : s) } };
  const isBot = id => id === 3 || id === 4;
  assert.deepEqual(readySlots(t), [0, 1]);
  assert.equal(nextSlot(t, isBot), 1);
  assert.deepEqual(botSlots(t, isBot), [0]);
});

test('tournament: quitting a match leaves it to play again', () => {
  let t = draw(people(4));
  t = startSlot(t, 0, 'm1');
  assert.equal(t.data.slots[0].match, 'm1');
  t = dropMatch(t, 0);
  assert.equal(t.data.slots[0].match, null);
  assert.equal(nextSlot(t, () => false), 0);
});

test('tournament: a won match whose result never reached the bracket is filled in on load', () => {
  const entrants = [{ id: 1, name: 'Bot 15', bot: 15 }, { id: 2, name: 'Bot 1', bot: 1 }, { id: 3, name: 'Sam' }, { id: 4, name: 'Jake' }];
  let t = makeDraw({ id: 't', name: 'T', entrants, opts: { start: 501, out: 'double' }, rounds: defaultRounds(4), now: 1 }, lcg(3));
  const slot = t.data.slots[0], level = id => entrants.find(e => e.id === id).bot ?? 9;
  const m = { ...simulateMatch(t, 0, [slot.b, slot.a], [level(slot.b), level(slot.a)], lcg(7)), id: 'm1', playerIds: [slot.b, slot.a], bots: [level(slot.b), level(slot.a)] };
  t = startSlot(t, 0, 'm1');
  const s = compute(m), winner = m.playerIds[s.winner];
  const done = reconcile(t, id => id === 'm1' ? m : null);
  assert.equal(done.data.slots[0].winner, winner);
  assert.deepEqual(done.data.slots[0].legs, [s.legs[1], s.legs[0]]);  // a's legs first
  assert.equal(done.data.slots[0].how, 'simulated');
  assert.equal(done.data.slots[2].a, winner);
  assert.equal(t.data.slots[0].winner, null);  // the one given is unchanged
  // Nothing to fill in: the same record back.
  assert.equal(reconcile(done, () => m), done);
  assert.equal(reconcile(t, () => null), t);
});

test('tournament: a player id made offline is swapped for the real one everywhere', () => {
  const entrants = [{ id: -3, name: 'Bot 5', bot: 5 }, { id: 2, name: 'Sam' }, { id: 3, name: 'Jake' }];
  let t = makeDraw({ id: 't', name: 'T', entrants, opts: { start: 501, out: 'double' }, rounds: defaultRounds(3), now: 1 }, lcg(2));
  const real = t.data.slots.findIndex(s => s.a !== 'bye' && s.b !== 'bye');
  t = recordResult(t, real, t.data.slots[real].a, [2, 0], 'played');
  t = recordResult(t, 2, -3, [3, 1], 'played');
  const moved = remapIds(t, -3, 42);
  const all = moved.data.slots.flatMap(s => [s.a, s.b, s.winner]);
  assert.ok(!all.includes(-3));
  assert.ok(all.includes(42));
  assert.deepEqual(moved.data.entrants.map(e => e.id), [42, 2, 3]);
  assert.equal(moved.winner, 42);
  assert.equal(t.winner, -3);  // the one given is unchanged
});

test('tournament: bot against bot is played out to a winner', () => {
  const entrants = [{ id: 1, name: 'Bot 15', bot: 15 }, { id: 2, name: 'Bot 1', bot: 1 }, { id: 3, name: 'Sam' }];
  const t = makeDraw({ id: 'tx', name: 'T', entrants, opts: { start: 501, out: 'double' }, rounds: [{ legs: 2 }, { legs: 3 }], now: 1 }, lcg(4));
  const m = simulateMatch(t, 0, [1, 2], [15, 1], lcg(11));
  const s = compute(m);
  assert.notEqual(s.winner, null);
  assert.equal(s.legs[s.winner], 2);
  assert.ok(m.log.length > 0);
  assert.ok(m.log.every(e => e.src === 'bot' && e.t === 'dart'));
  assert.deepEqual(m.players, ['Bot 15', 'Bot 1']);
  assert.equal(m.gameId, 'x01');
  assert.deepEqual(m.opts.tournament, { id: 'tx', slot: 0 });
  assert.equal(m.opts.legs, 2);
  assert.equal(m.opts.sets, 1);
  assert.equal(m.opts.start, 501);
});

test('tournament: every ready match that is not bot against bot can be played on the board', () => {
  const entrants = [...people(6), { id: 7, name: 'Bot 5', bot: 5 }, { id: 8, name: 'Bot 9', bot: 9 }];
  let t = makeDraw({ id: 't', name: 'T', entrants, opts: { start: 501, out: 'double' }, rounds: defaultRounds(8), now: 1 }, lcg(1));
  // The bots together in slot 1, the people in the other three, whatever the draw did.
  const at = [[1, 2], [7, 8], [3, 4], [5, 6]];
  t = { ...t, data: { ...t.data, slots: t.data.slots.map((s, i) => (i < 4 ? { ...s, a: at[i][0], b: at[i][1] } : s)) } };
  const isBot = id => id >= 7;
  assert.deepEqual(boardSlots(t, isBot), [0, 2, 3]);
  assert.equal(nextSlot(t, isBot), 0, 'the main button still offers the first');
  // One played: it is no longer ready, and the semi-final it feeds still waits for its other player.
  t = recordResult(t, 2, 3, [2, 0], 'played');
  assert.deepEqual(boardSlots(t, isBot), [0, 3]);
  // The bots' match decided and slot 0 played: their semi-final is ready too.
  t = recordResult(recordResult(t, 1, 8, [0, 2], 'simulated'), 0, 1, [2, 1], 'played');
  assert.deepEqual(boardSlots(t, isBot), [3, 4]);
});

test('tournament: a played or simulated match has a scorecard, a bye or a match still to play has none', () => {
  let t = draw(people(3));  // a bracket of 4: one bye
  const bye = t.data.slots.findIndex(s => s.how === 'bye'), real = 1 - bye;
  assert.equal(playedMatch(t, bye), null, 'a bye');
  assert.equal(playedMatch(t, real), null, 'not started');
  t = startSlot(t, real, 'm1');
  assert.equal(playedMatch(t, real), null, 'being played');
  t = recordResult(t, real, t.data.slots[real].a, [2, 0], 'played');
  assert.equal(playedMatch(t, real), 'm1');
  t = recordResult(startSlot(t, 2, 'm2'), 2, t.data.slots[2].a, [3, 1], 'simulated');
  assert.equal(playedMatch(t, 2), 'm2', 'simulated matches are saved too');
  assert.ok(t.finished, 'and a finished tournament still knows its matches');
});

test('tournament: a device opening a tournament for the first time has seen what is already decided', () => {
  let t = draw(people(8));
  t = recordResult(t, 0, t.data.slots[0].a, [2, 0], 'played');
  t = recordResult(t, 1, t.data.slots[1].b, [1, 2], 'played');
  // No entry on this device (the TV joining part way through): nothing is played back.
  assert.deepEqual(seenResults(t, undefined), { seen: [0, 1], unseen: [] });
  // What is decided after that moves on as usual.
  t = recordResult(t, 3, t.data.slots[3].a, [2, 1], 'played');
  assert.deepEqual(seenResults(t, [0, 1]), { seen: [0, 1], unseen: [3] });
  // The device that started it wrote an empty entry at Start: it shows every result, in bracket order.
  assert.deepEqual(seenResults(t, []), { seen: [], unseen: [0, 1, 3] });
  assert.deepEqual(seenResults(draw(people(8)), undefined), { seen: [], unseen: [] }, 'nothing decided yet');
});

test('tournament: a bye is never a result to show, and one taken back is shown again', () => {
  let t = draw(people(3));
  const bye = t.data.slots.findIndex(s => s.how === 'bye'), real = 1 - bye;
  assert.deepEqual(seenResults(t, []), { seen: [], unseen: [] });
  t = recordResult(t, real, t.data.slots[real].a, [2, 0], 'played');
  assert.deepEqual(seenResults(t, []), { seen: [], unseen: [real] });
  assert.deepEqual(seenResults(clearResult(t, real), [real]), { seen: [], unseen: [] }, 'taken back: no longer seen');
});
