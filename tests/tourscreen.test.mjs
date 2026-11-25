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
const start = await import('./tourscreen/start.mjs');
const { page, buttons, mainButton, frames } = await import('./tourscreen/page.mjs');
const { makeDraw, readySlots, defaultRounds } = await import('../web/tournament.js');
const { newMatch, compute } = await import('../web/engine.js');
const { data, store, loadPlayers } = app;

function fresh(people) {
  for (const k of ['players', 'ops', 'tournaments', 'tournamentsq', 'pending', 'tourSeen']) store.set(k, k === 'players' ? people : k === 'pending' || k === 'tourSeen' ? {} : []);
  store.set('match', null);
  app.setMatch(null);
  app.sent.length = 0;
  loadPlayers();
  Object.assign(S.tourView, { id: null, setup: null, abandoning: false });
  Object.assign(page, { on: false, reduced: true });
}
// Everything the screen has set going gets its turn (but no clock moves: a test moves its own).
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(done => setImmediate(done)); };
// The test's own clock, for the screen's waits: on(ms) moves it on.
function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1.8e12 });
  return async ms => { t.mock.timers.tick(ms); await settle(); };
}
const sam = { id: 1, name: 'Sam' }, phil = { id: 2, name: 'Phil' }, mum = { id: 3, name: 'Mum' }, dad = { id: 4, name: 'Dad' };

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

// A tournament of `entrants` going, on screen, first to one leg of straight-out 301 in every round.
function going(entrants) {
  fresh(entrants.filter(e => !e.bot));
  data.saveTournament(makeDraw({
    id: 'T1', name: 'Test', entrants, opts: { start: 301, out: 'straight' }, rounds: defaultRounds(entrants.length).map(() => ({ legs: 1 })),
  }, () => 0.5));
  S.openTournament('T1');
  return data.tournament('T1');
}
const names = t => i => [t.data.slots[i].a, t.data.slots[i].b].map(id => t.data.entrants.find(e => e.id === id).name);

test('tournament screen: any ready match can be played, not only the next one', () => {
  const t = going([sam, phil, mum, dad]);
  assert.equal(S.tourNext(t), 0);
  S.tourAct('tour-play', { i: '1' });  // a tap on the second match's boxes
  const s = t.data.slots[1];
  assert.deepEqual(start.asked?.play.tournament, { id: 'T1', slot: 1 }, 'asks who throws first, for that match');
  assert.deepEqual(start.asked.play.ids, [s.a, s.b]);
  assert.equal(start.asked.act, 'start');
  S.tourAct('tour-play', { i: '2' });  // the final has no players yet
  assert.equal(start.asked.play.tournament.slot, 1, 'nothing asked for a match that is not ready');
  S.tourAct('tour-play', { i: '0' });  // the main button's own
  assert.equal(start.asked.play.tournament.slot, 0);
  assert.deepEqual(S.tourPlayable(t), [0, 1]);
});

test('tournament screen: a tap on a ready match plays it, on a played one opens its scorecard', () => {
  let t = going([sam, phil, mum, dad]);
  const of = names(t);
  assert.deepEqual(S.tourTaps(t), {
    0: { label: `Play ${of(0).join(' v ')}`, act: 'tour-play', i: 0 },
    1: { label: `Play ${of(1).join(' v ')}`, act: 'tour-play', i: 1 },
  });
  const m = play('T1', 1, 1);
  t = data.tournament('T1');
  assert.deepEqual(S.tourTaps(t), {
    0: { label: `Play ${of(0).join(' v ')}`, act: 'tour-play', i: 0 },
    1: { label: `${of(1)[0]} 0, ${of(1)[1]} 1: see the scorecard`, sheet: m.id },
  }, 'the final still waits for a player: no tap');
  play('T1', 0, 0);
  const final = play('T1', 2, 0);
  t = data.tournament('T1');
  assert.ok(t.finished);
  assert.deepEqual(Object.values(S.tourTaps(t)).map(x => x.sheet), ['m0', 'm1', final.id], 'a finished one: every match opens');
  assert.deepEqual(S.tourPlayable(t), []);
});

test('tournament screen: byes and bot against bot are not tapped, and an abandoned one only opens what was played', () => {
  const bot5 = { id: 7, name: 'Bot 5', bot: 5 }, bot9 = { id: 8, name: 'Bot 9', bot: 9 };
  let t = going([sam, phil, mum, bot5, bot9]);  // a bracket of 8: three byes
  store.set('players', [sam, phil, mum, bot5, bot9]);
  loadPlayers();
  // Put the bots together in the one first-round match, whatever the draw did.
  const real = t.data.slots.findIndex(s => s.round === 0 && s.how !== 'bye');
  const { a, b } = t.data.slots[real], rest = [1, 2, 3, 7, 8].filter(id => id !== a && id !== b);
  const swap = new Map([[a, 7], [b, 8], ...rest.map((id, n) => [id, n + 1])]);
  const to = v => swap.get(v) ?? v;
  data.saveTournament({ ...t, data: { ...t.data, slots: t.data.slots.map(s => ({ ...s, a: to(s.a), b: to(s.b), winner: to(s.winner) })) } });
  t = data.tournament('T1');
  assert.deepEqual([t.data.slots[real].a, t.data.slots[real].b].sort(), [7, 8]);
  const taps = S.tourTaps(t), ready = S.tourPlayable(t);
  assert.ok(!(real in taps), 'bot against bot plays itself');
  assert.ok(t.data.slots.every((s, i) => s.how !== 'bye' || !(i in taps)), 'a bye has no scorecard');
  assert.deepEqual(Object.keys(taps).map(Number), ready);
  assert.ok(ready.length >= 1 && ready.every(i => t.data.slots[i].round === 1), 'the people given byes can play');

  const m = play('T1', ready[0], 0);
  data.saveTournament({ ...data.tournament('T1'), abandoned: true });
  t = data.tournament('T1');
  assert.deepEqual(S.tourPlayable(t), []);
  const [won, lost] = names(t)(ready[0]);
  assert.deepEqual(S.tourTaps(t), { [ready[0]]: { label: `${won} 1, ${lost} 0: see the scorecard`, sheet: m.id } });
  const before = start.asked;
  S.tourAct('tour-play', { i: String(ready[0]) });
  assert.equal(start.asked, before, 'and nothing of it can be played');
});

// Slot i's match as starting it leaves it (start.js, startMatch): the game in progress on this device.
function begin(id, i) {
  const s = data.tournament(id).data.slots[i];
  const m = {
    ...newMatch('x01', ['A', 'B'], { start: 301, out: 'straight', legs: 1, sets: 1, tournament: { id, slot: i } }),
    id: `m${i}`, playerIds: [s.a, s.b], bots: [null, null], seq: 0,
  };
  app.setMatch(m);
  store.set('match', m);
  S.onMatchStarted(m);
  return m;
}
const below = t => [...t.data.entrants.map(e => e.id), ...t.data.slots.flatMap(s => [s.a, s.b, s.winner]), t.winner].filter(id => id < 0);

test('tournament screen: bots the Pi numbers while their match is being simulated keep their new numbers', async t => {
  await settle();  // (a sync an earlier test set going is over)
  const on = clock(t);
  fresh([sam]);
  // two bots at levels never played here: made on this device, under numbers of its own until the Pi gives them theirs
  const made = [app.botPlayer(5), app.botPlayer(6)];
  assert.ok(made.every(id => id < 0));
  data.saveTournament(makeDraw({
    id: 'T1', name: 'Test', entrants: [sam, { id: made[0], name: 'Bot 5', bot: 5 }, { id: made[1], name: 'Bot 6', bot: 6 }],
    opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }],
  }, () => 0.5));
  assert.deepEqual(data.tournament('T1').data.slots.map(s => [s.a, s.b]), [[1, 'bye'], [made[1], made[0]], [1, null]]);
  Object.assign(page, { on: true, reduced: false });
  S.openTournament('T1');
  assert.equal(page.status.textContent, 'Simulating Bot 6 v Bot 5…');

  // While that line is up the sync that Start set going reaches the Pi, which numbers the bots (sync.js, remap);
  // the app then picks its lists up again, as after every sync.
  await data.sync();
  loadPlayers();
  const numbered = app.bots.map(b => b.id).sort();
  assert.ok(numbered.every(id => id > 0));
  assert.deepEqual(below(data.tournament('T1')), [], 'numbered in the tournament too');

  await on(700);
  const now = data.tournament('T1'), s = now.data.slots[1];
  assert.deepEqual(below(now), [], 'the old numbers are not put back');
  assert.equal(s.how, 'simulated');
  assert.ok(numbered.includes(s.winner), 'the result is on the bots\' own match');
  assert.deepEqual([now.data.slots[2].a, now.data.slots[2].b], [1, s.winner], 'and its winner is through to the final');
  // The Pi has the match, under the numbers it gave, and the tournament as it now stands.
  const match = app.sent.find(([path]) => path === `/matches/${s.match}`)?.[1];
  assert.deepEqual(match?.players.toSorted(), numbered);
  assert.equal(app.sent.findLast(([path]) => path === '/tournaments/T1')?.[1].seq, now.seq);
  assert.deepEqual([store.get('tournamentsq', []), store.get('pending', {})], [[], {}], 'nothing is left waiting that can never be sent');
});

test('tournament screen: a bot match decided elsewhere while "Simulating" is up is not played out again', async t => {
  await settle();
  const on = clock(t);
  const bot5 = { id: 7, name: 'Bot 5', bot: 5 }, bot6 = { id: 8, name: 'Bot 6', bot: 6 };
  fresh([sam]);
  store.set('players', [sam, bot5, bot6]);
  loadPlayers();
  data.saveTournament(makeDraw({ id: 'T1', name: 'Test', entrants: [sam, bot5, bot6], opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }] }, () => 0.5));
  Object.assign(page, { on: true, reduced: false });
  S.openTournament('T1');
  assert.equal(page.status.textContent, 'Simulating Bot 6 v Bot 5…');
  // another screen's copy arrives with that match played out already, Bot 5 the winner by a leg
  const theirs = structuredClone(data.tournament('T1'));
  Object.assign(theirs.data.slots[1], { match: 'theirs', winner: 7, legs: [0, 1], how: 'simulated' });
  theirs.data.slots[2].b = 7;
  data.saveTournament(theirs);
  await on(700);
  const s = data.tournament('T1').data.slots[1];
  assert.deepEqual([s.match, s.winner, s.legs], ['theirs', 7, [0, 1]], 'their result stands');
  assert.equal(Object.keys(store.get('pending', {})).length + app.sent.filter(([path]) => path.startsWith('/matches/')).length, 0, 'no second match is made');
});

test('tournament screen: Start waits for a number the Pi has just given to reach the screen', async () => {
  await settle();
  fresh([sam, phil]);
  S.renderTournament();
  S.tourAct('tour-pick', { id: '1' });
  S.tourAct('tour-pick', { id: '2' });
  S.tourAct('tour-bot', {});
  S.tourAct('tour-draw', {});
  const made = app.bots[0].id;
  assert.ok(made < 0);
  // The app's timer syncs while the draw is looked at. The Pi has numbered the bot, and the saved lists
  // go by that number; the app's own lists do not until the sync is over. Start is pressed in that moment.
  await data.sync();
  const numbered = store.get('players').find(p => p.bot).id;
  S.tourAct('tour-start', {});
  assert.deepEqual(data.tournaments(), [], 'nothing is started under the number the bot no longer has');
  assert.ok(S.tourView.setup?.draw, 'and the draw stays as it was');

  loadPlayers();  // the sync is over: what the app does then
  S.tourRemapped([[made, numbered]]);
  S.tourAct('tour-start', {});
  assert.deepEqual(data.tournaments()[0]?.data.entrants.map(e => e.id).sort((x, y) => x - y), [1, 2, numbered]);
});

test('tournament screen: with a match in play, the way back to it is the only match on offer', () => {
  let t = going([sam, phil, mum, dad]);
  const of = names(t), title = i => of(i).join(' v ');
  assert.deepEqual(mainButton(), ['tour-play', `Play ${title(0)}`]);
  // The second match is tapped and started; a dart (off the board), then Menu and "Back to the tournament".
  const m = begin('T1', 1);
  m.log.push({ t: 'dart', seg: 0, mult: 0, ts: 1 });
  S.openTournament('T1');
  t = data.tournament('T1');
  assert.deepEqual(mainButton(), ['resume', `Back to ${title(1)}`], 'the main button goes back to it, not on to the first match');
  assert.deepEqual(S.tourTaps(t), { 1: { label: `Back to ${title(1)}`, act: 'resume' } }, 'and no other match is a button');
  const before = start.asked;
  S.tourAct('tour-play', { i: '0' });  // (a button from before the match started, say)
  assert.equal(start.asked, before, 'nothing takes the place of the game in progress');
  assert.equal(app.match, m);

  // Won: the others are on offer again.
  throwTo(m, 0, CHECKOUT_301);
  assert.equal(compute(m).winner, 0);
  S.onMatchWon(m);
  S.openTournament('T1');
  t = data.tournament('T1');
  assert.deepEqual(mainButton(), ['tour-play', `Play ${title(0)}`]);
  assert.deepEqual(S.tourTaps(t), {
    0: { label: `Play ${title(0)}`, act: 'tour-play', i: 0 },
    1: { label: `${of(1)[0]} 1, ${of(1)[1]} 0: see the scorecard`, sheet: 'm1' },
  });
});

test('tournament screen: the match in play is the one the bracket marks', async () => {
  going([sam, phil, mum, dad]);
  begin('T1', 1);
  page.on = true;
  S.openTournament('T1');
  await settle();
  const marked = page.svg.all().filter(e => /\bnext\b/.test(e.attrs.class ?? '')).map(e => e.attrs['data-box']);
  assert.deepEqual(marked, ['0:2', '0:3']);
  assert.deepEqual(buttons(), [`Back to ${names(data.tournament('T1'))(1).join(' v ')}`]);
});

test('tournament screen: a tap that skips a result moving on is not a tap on a match as well', async t => {
  const on = clock(t);
  going([sam, phil, mum, dad]);
  Object.assign(page, { on: true, reduced: false });
  S.openTournament('T1');  // (this device has now seen the tournament: what is decided from here on is shown moving on)
  await settle();
  assert.equal(buttons().length, 2);

  play('T1', 0, 0);
  S.openTournament('T1');  // back from the match: its result is moving on
  assert.equal(page.box.dataset.act, 'tour-skip');
  assert.deepEqual(buttons(), [], 'no match is a button while a result moves');
  S.tourAct('tour-skip', {});  // the first tap of two
  frames(16);
  await on(1);
  assert.deepEqual(store.get('tourSeen', {}).T1, [0], 'skipped to the end');
  assert.deepEqual(buttons(), [], 'the second tap, a moment later, finds no button either');
  assert.equal(page.box.dataset.act, 'tour-skip');
  await on(300);
  assert.deepEqual(buttons(), []);
  await on(150);
  assert.equal(buttons().length, 2, 'then the matches can be tapped: the one played, and the one still to play');
  assert.equal(page.box.dataset.act, undefined);

  // A result watched to the end holds nothing back.
  play('T1', 1, 0);
  S.openTournament('T1');
  assert.deepEqual(buttons(), []);
  frames();
  await on(250);
  assert.equal(buttons().length, 3);
  assert.equal(page.box.dataset.act, undefined);
});
