// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// The Tournament screen (web/screens/tournament.js) without a browser: the app it
// imports is a stand-in (tests/tourscreen/app.mjs) over the real data layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./tourscreen/hooks.mjs', import.meta.url);
globalThis.document = { addEventListener() {} };
const S = await import('../web/screens/tournament.js');
const app = await import('./tourscreen/app.mjs');
const { makeDraw, readySlots } = await import('../web/tournament.js');
const { newMatch, compute } = await import('../web/engine.js');
const { data, store, loadPlayers } = app;

function fresh(people) {
  for (const k of ['players', 'ops', 'tournaments', 'tournamentsq', 'pending', 'match']) store.set(k, k === 'players' ? people : k === 'pending' ? {} : []);
  loadPlayers();
  Object.assign(S.tourView, { id: null, setup: null, abandoning: false });
}
const sam = { id: 1, name: 'Sam' }, phil = { id: 2, name: 'Phil' }, mum = { id: 3, name: 'Mum' };

// Player `idx` of match m throws `darts` ([seg, mult]), the other missing whenever it is their throw.
function throwTo(m, idx, darts) {
  for (const [seg, mult] of darts) {
    while (compute(m).current !== idx) m.log.push({ t: 'dart', seg: 0, mult: 0, ts: 1 });
    m.log.push({ t: 'dart', seg, mult, ts: 1 });
  }
}
const CHECKOUT_301 = [[20, 3], [20, 3], [20, 3], [20, 3], [20, 3], [1, 1]];  // straight out
// Slot i played on the board through the screen's hooks, won by its player `idx`.
function play(id, i, idx) {
  const s = data.tournament(id).data.slots[i];
  const m = {
    ...newMatch('x01', ['A', 'B'], { start: 301, out: 'straight', legs: 1, sets: 1, tournament: { id, slot: i } }),
    id: `m${i}`, playerIds: [s.a, s.b], bots: [null, null], seq: 0,
  };
  S.onMatchStarted(m);
  throwTo(m, idx, CHECKOUT_301);
  assert.equal(compute(m).winner, idx);
  S.onMatchWon(m);
  return m;
}

test('tournament screen: undoing the final\'s winning dart takes the result back, and the next winner counts', () => {
  fresh([sam, phil, mum]);
  data.saveTournament(makeDraw({
    id: 'T1', name: 'Test', entrants: [sam, phil, mum], opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }],
  }, () => 0.5));
  play('T1', readySlots(data.tournament('T1'))[0], 0);
  const final = readySlots(data.tournament('T1'))[0];
  assert.equal(final, 2);
  const m = play('T1', final, 0);
  const [a, b] = m.playerIds;
  let t = data.tournament('T1');
  assert.ok(t.finished);
  assert.equal(t.winner, a);

  m.log.pop();  // the winning dart undone, still on the match's screen
  S.onMatchUndone(m);
  t = data.tournament('T1');
  assert.equal(t.finished, null);
  assert.equal(t.winner, null);
  assert.equal(t.data.slots[final].winner, null);
  assert.equal(t.data.slots[final].match, m.id);

  throwTo(m, 1, CHECKOUT_301);  // play goes on, and the other player wins it
  assert.equal(compute(m).winner, 1);
  S.onMatchWon(m);
  t = data.tournament('T1');
  assert.ok(t.finished);
  assert.equal(t.winner, b);
  assert.equal(t.data.slots[final].winner, b);
});

test('tournament screen: a bot numbered by the Pi between Draw and Start goes in under its new number', async () => {
  fresh([sam, phil]);
  S.renderTournament();
  S.tourAct('tour-pick', { id: '1' });
  S.tourAct('tour-pick', { id: '2' });
  S.tourAct('tour-bot', {});
  S.tourAct('tour-draw', {});
  const made = app.bots[0];
  assert.ok(made.id < 0, 'the bot is made offline at Draw');
  await data.sync();  // the app's timer, while the draw is looked at
  loadPlayers();
  const numbered = app.bots[0].id;
  assert.ok(numbered > 0);

  S.tourAct('tour-start', {});
  const t = data.tournaments()[0];
  assert.ok(t, 'started');
  assert.deepEqual(t.data.entrants.map(e => e.id).sort((x, y) => x - y), [1, 2, numbered]);
  assert.ok(t.data.slots.every(s => ![s.a, s.b, s.winner].includes(made.id)));
  await data.sync();
  assert.deepEqual(store.get('tournamentsq', []), [], 'sent to the Pi');
});

test('tournament screen: a person removed between Draw and Start makes the draw out of date', () => {
  fresh([sam, phil, mum]);
  S.renderTournament();
  for (const id of ['1', '2', '3']) S.tourAct('tour-pick', { id });
  S.tourAct('tour-draw', {});
  assert.ok(S.tourView.setup.draw);
  data.removePlayer(3);  // (on another screen, say)
  loadPlayers();

  S.tourAct('tour-start', {});
  assert.equal(data.tournaments().length, 0, 'nothing started with Mum in it');
  assert.equal(S.tourView.setup.draw, null);
  assert.deepEqual(S.tourView.setup.ids, [1, 2]);
});

test('tournament screen: a person numbered by the Pi between Draw and Start keeps their place', async () => {
  fresh([sam, phil]);
  const jake = data.addPlayer('Jake');
  loadPlayers();
  S.renderTournament();
  for (const id of [1, 2, jake.id]) S.tourAct('tour-pick', { id: String(id) });
  S.tourAct('tour-draw', {});
  await data.sync();
  const now = store.get('players').find(p => p.name === 'Jake').id;
  S.tourRemapped([[jake.id, now]]);  // what the app does after each sync
  loadPlayers();

  assert.deepEqual(S.tourView.setup.ids, [1, 2, now]);
  S.tourAct('tour-start', {});
  const t = data.tournaments()[0];
  assert.ok(t, 'started');
  assert.deepEqual(t.data.entrants.map(e => e.id).sort((x, y) => x - y), [1, 2, now]);
});
