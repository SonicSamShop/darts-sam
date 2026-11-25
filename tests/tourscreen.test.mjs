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
const { page, buttons, mainButton, frames, text, acts, pastLines } = await import('./tourscreen/page.mjs');
const P = await import('../web/screens/playerspanel.js');
const { makeDraw, readySlots, defaultRounds, recordResult } = await import('../web/tournament.js');
const { newMatch, compute } = await import('../web/engine.js');
const { data, store, loadPlayers } = app;

function fresh(people) {
  for (const k of ['players', 'ops', 'tournaments', 'tournamentsq', 'pending', 'tourSeen']) store.set(k, k === 'players' ? people : k === 'pending' || k === 'tourSeen' ? {} : []);
  store.set('match', null);
  app.setMatch(null);
  app.sent.length = 0;
  app.said.length = 0;
  loadPlayers();
  Object.assign(S.tourView, { id: null, setup: null, abandoning: false, past: false });
  Object.assign(P.roster, { formError: '', removeArmed: false, renameFailed: null, refused: null, open: null, adding: false });
  Object.assign(page, { on: false, reduced: true, narrow: null });
  app.marks.length = 0;
}
// Everything the screen has set going gets its turn (but no clock moves: a test moves its own).
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(done => setImmediate(done)); };
// The test's own clock, for the screen's waits: on(ms) moves it on. Each test's starts
// after the last one's stopped, and all of them before the real one, so that what the
// screen timed in one test (the pause after a tap that skips) is over in the next.
let epoch = 1.7e12;
function clock(t) {
  epoch += 1e8;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: epoch });
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

test('tournament screen: a bot numbered by the server between Draw and Start goes in under its new number', async () => {
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
  assert.deepEqual(store.get('tournamentsq', []), [], 'sent to the server');
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

test('tournament screen: a person numbered by the server between Draw and Start keeps their place', async () => {
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

test('tournament screen: bots the server numbers while their match is being simulated keep their new numbers', async t => {
  await settle();  // (a sync an earlier test set going is over)
  const on = clock(t);
  fresh([sam]);
  // two bots at levels never played here: made on this device, under numbers of its own until the server gives them theirs
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

  // While that line is up the sync that Start set going reaches the server, which numbers the bots (sync.js, remap);
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
  // The server has the match, under the numbers it gave, and the tournament as it now stands.
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

test('tournament screen: Start waits for a number the server has just given to reach the screen', async () => {
  await settle();
  fresh([sam, phil]);
  S.renderTournament();
  S.tourAct('tour-pick', { id: '1' });
  S.tourAct('tour-pick', { id: '2' });
  S.tourAct('tour-bot', {});
  S.tourAct('tour-draw', {});
  const made = app.bots[0].id;
  assert.ok(made < 0);
  // The app's timer syncs while the draw is looked at. The server has numbered the bot, and the saved lists
  // go by that number; the app's own lists do not until the sync is over. Start is pressed in that moment.
  assert.doesNotMatch(text(), /One moment/);
  await data.sync();
  const numbered = store.get('players').find(p => p.bot).id;
  S.tourAct('tour-start', {});
  assert.deepEqual(data.tournaments(), [], 'nothing is started under the number the bot no longer has');
  assert.ok(S.tourView.setup?.draw, 'and the draw stays as it was');
  assert.match(text(), /One moment: saving the new bots\./, 'and the screen says why Start did nothing');
  assert.match(app.$app.innerHTML, /data-act="tour-start">Start<\/button><span class="tour-status" aria-live="polite">One moment: saving the new bots\.<\/span>/, 'in its status line, beside Start');

  loadPlayers();  // the sync is over: what the app does then (and no more: only a bot's number changed, which it draws nothing again for)
  S.tourRemapped([[made, numbered]]);
  assert.doesNotMatch(text(), /One moment/, 'no longer so: no longer said');
  S.tourAct('tour-start', {});
  assert.deepEqual(data.tournaments()[0]?.data.entrants.map(e => e.id).sort((x, y) => x - y), [1, 2, numbered]);
  assert.doesNotMatch(text(), /One moment/);
});

test('tournament screen: Start bounced for a person the server is numbering says "players", and a draw gone out of date says nothing', async () => {
  await settle();
  fresh([sam, phil]);
  const jake = data.addPlayer('Jake');
  loadPlayers();
  S.renderTournament();
  for (const id of [1, 2, jake.id]) S.tourAct('tour-pick', { id: String(id) });
  S.tourAct('tour-draw', {});
  await data.sync();  // Jake has the server's number in the saved lists; the app's own still go by the old one
  S.tourAct('tour-start', {});
  assert.deepEqual(data.tournaments(), []);
  assert.match(text(), /One moment: saving the new players\./);
  // a change to the form is a new draw to make: nothing is waiting on Start any more
  S.tourAct('tour-opt', { field: 'out', val: 'straight' });
  assert.doesNotMatch(text(), /One moment/);
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

test('tournament screen: a won match whose result the bracket never heard of is filled in as the bracket opens, sent or not', async () => {
  // The app closed on the winning dart, before the bracket had the result; opened again, it is on the
  // won game, with "Back to the tournament". The match has gone to the server meanwhile (it is not waiting
  // here any more), so the game on screen is the only copy this device has of it.
  let t = going([sam, phil, mum, dad]);
  const of = names(t), m = begin('T1', 1);
  throwTo(m, 0, CHECKOUT_301);
  assert.equal(compute(m).winner, 0);
  store.set('match', m);
  assert.deepEqual(store.get('pending', {}), {}, 'not waiting to be sent');
  let s = data.tournament('T1').data.slots[1];
  assert.deepEqual([s.match, s.winner], ['m1', null], 'started, and no result');

  S.openTournament('T1');  // "Back to the tournament"
  t = data.tournament('T1');
  s = t.data.slots[1];
  assert.deepEqual([s.winner, s.legs, s.how], [m.playerIds[0], [1, 0], 'played'], 'the result is in');
  assert.equal(t.data.slots[2].b, m.playerIds[0], 'and its winner has moved on');
  assert.deepEqual(mainButton(), ['tour-play', `Play ${of(0).join(' v ')}`], 'the match is not offered again');
  assert.equal(S.tourTaps(t)[1].sheet, 'm1');
  assert.equal(app.match, null, 'and the won game has been looked at for the last time');
  assert.equal(store.get('match'), null);
  await settle();
  assert.deepEqual(app.sent.filter(([path]) => path === '/tournaments/T1').at(-1)[1].data.slots[1].winner, m.playerIds[0], 'and sent');
});

test('tournament screen: a match that is quit leaves its place in the bracket to be played again', async () => {
  let t = going([sam, phil, mum, dad]);
  const of = names(t), slot = i => data.tournament('T1').data.slots[i];
  const m = begin('T1', 1);
  m.log.push({ t: 'dart', seg: 20, mult: 1, ts: 1 });
  assert.equal(slot(1).match, 'm1');
  S.openTournament('T1');
  assert.deepEqual(mainButton(), ['resume', `Back to ${of(1).join(' v ')}`]);
  await settle();
  const before = app.sent.length;

  // Quit game (game.js: the match is forgotten, and the bracket is told)
  app.setMatch(null);
  store.set('match', null);
  S.onMatchQuit(m);
  assert.deepEqual([slot(1).match, slot(1).winner, slot(1).how], [null, null, null], 'the slot has no match any more');
  t = data.tournament('T1');
  assert.deepEqual(S.tourPlayable(t), [0, 1], 'and is ready again');
  S.openTournament('T1');
  assert.deepEqual(mainButton(), ['tour-play', `Play ${of(0).join(' v ')}`]);
  assert.deepEqual(S.tourTaps(t)[1], { label: `Play ${of(1).join(' v ')}`, act: 'tour-play', i: 1 });
  await settle();
  assert.deepEqual(app.sent.slice(before).map(([path, body]) => [path, body.data.slots[1].match]), [['/tournaments/T1', null]], 'and the server is told');

  // Only its own match, and only while there is no result: anything else is left as it is.
  const seq = () => data.tournament('T1').seq;
  let was = seq();
  S.onMatchQuit(m);  // (told twice)
  assert.equal(seq(), was, 'a match the slot no longer has changes nothing');
  const again = begin('T1', 1);
  S.onMatchQuit({ ...again, id: 'another' });
  assert.equal(slot(1).match, 'm1', 'nor does some other match of those two');
  throwTo(again, 1, CHECKOUT_301);
  S.onMatchWon(again);
  was = seq();
  S.onMatchQuit(again);
  assert.deepEqual([slot(1).match, slot(1).winner, seq()], ['m1', again.playerIds[1], was], 'and a match that was won keeps its result');
  // the tournament itself next: its only other first-round match is still to play, and nothing was lost
  assert.equal(S.tourNext(data.tournament('T1')), 0);
});

test('tournament screen: the match in play is the one the bracket marks, and is tagged "playing", not "next"', async () => {
  going([sam, phil, mum, dad]);
  page.on = true;
  const marked = () => page.svg.all().filter(e => /\bnext\b/.test(e.attrs.class ?? '')).map(e => e.attrs['data-box']);
  const tags = () => page.svg.all().filter(e => e.attrs.class === 'tag').map(e => e.textContent);
  S.openTournament('T1');
  await settle();
  assert.deepEqual([marked(), tags()], [['0:0', '0:1'], ['next']], 'none in play: the next one to play');
  begin('T1', 1);
  S.openTournament('T1');
  await settle();
  assert.deepEqual(marked(), ['0:2', '0:3']);
  assert.deepEqual(tags(), ['playing']);
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

// ---------- setting one up: what the form says, and where it is left ----------
test('tournament screen: the form says how many byes there are "in the first round"', () => {
  fresh([sam, phil, mum, dad]);
  S.renderTournament();
  for (const id of ['1', '2', '3']) S.tourAct('tour-pick', { id });
  assert.match(text(), / 3 players: 1 bye in the first round\. /);
  S.tourAct('tour-pick', { id: '4' });
  assert.match(text(), / 4 players\. /, 'none: nothing said of them');
  for (let k = 0; k < 2; k++) S.tourAct('tour-bot', {});
  assert.match(text(), / 6 players: 2 byes in the first round\. /);
  assert.doesNotMatch(text(), /round 1/, 'a round is never called by a number: the form\'s own lines name it');
  assert.match(text(), /Quarter-finals/);
});

test('tournament screen: a tap on the form leaves it where it was scrolled to', () => {
  fresh([sam, phil, mum]);
  page.on = true;
  S.renderTournament();
  for (const id of ['1', '2', '3']) S.tourAct('tour-pick', { id });
  page.body.scrollTop = 700;  // scrolled down to the rounds
  const taps = [['tour-legs', { i: '1', by: '1' }], ['tour-opt', { field: 'out', val: 'straight' }], ['tour-bot', {}],
    ['tour-botlevel', { i: '0', by: '1' }], ['tour-botdrop', { i: '0' }], ['tour-pick', { id: '3' }]];
  for (const [act, d] of taps) {
    const before = page.body;
    S.tourAct(act, d);
    assert.notEqual(page.body, before, `${act}: the screen is drawn again`);
    assert.equal(page.body.scrollTop, 700, `${act}: and is where it was`);
    assert.equal(page.shown, null, `${act}: nothing is brought into view`);
  }
});

test('tournament screen: Draw puts the draw under the form with Redraw and Start under it, and brings them into view', () => {
  fresh([sam, phil, mum]);
  page.on = true;
  S.renderTournament();
  for (const id of ['1', '2', '3']) S.tourAct('tour-pick', { id });
  assert.deepEqual(acts().at(-1), ['tour-draw', 'Draw']);
  page.body.scrollTop = 700;
  S.tourAct('tour-draw', {});
  const html = app.$app.innerHTML, at = what => html.indexOf(what);
  assert.ok(at('class="bracket"') > 0 && at('class="bracket"') < at('data-act="tour-draw"'), 'the draw, then its buttons');
  assert.deepEqual(acts().slice(-2), [['tour-draw', 'Redraw'], ['tour-start', 'Start']]);
  assert.equal(page.body.scrollTop, 700, 'not sent back to the top');
  assert.deepEqual(page.shown, { block: 'nearest' }, 'and Start, at the foot of the draw, is scrolled into view');
  // Drawn again by something else (a sync): it stays put. Redraw: shown again.
  S.renderTournament();
  assert.deepEqual([page.body.scrollTop, page.shown], [700, null]);
  S.tourAct('tour-draw', {});
  assert.deepEqual([page.body.scrollTop, page.shown], [700, { block: 'nearest' }]);
  // Started: the bracket's own screen opens at its top
  S.tourAct('tour-start', {});
  assert.ok(data.tournaments()[0]);
  assert.deepEqual([page.body.scrollTop, page.shown], [0, null]);
});

test('tournament screen: under a bracket the screen stays where it was scrolled to, and another tournament opens at its top', () => {
  going([sam, phil, mum]);
  over('A', 'Spring', Date.UTC(2026, 2, 7, 12), [sam, phil, mum]);
  page.on = true;
  S.openTournament('T1');
  page.body.scrollTop = 120;  // down at the list of past ones
  S.renderTournament();  // (a sync)
  assert.equal(page.body.scrollTop, 120);
  S.tourAct('tour-open', { id: 'A' });
  assert.equal(page.body.scrollTop, 0);
});

// ---------- how it ends, and what is kept ----------
// Four people's tournament on the device it is played on: both semi-finals watched moving on,
// then the final won by its player `idx`, and the bracket not yet looked at again.
async function toTheFinal(on, idx) {
  going([sam, phil, mum, dad]);
  Object.assign(page, { on: true, reduced: false });
  S.openTournament('T1');
  await settle();
  for (const i of [0, 1]) { play('T1', i, 0); S.openTournament('T1'); frames(); await on(250); }
  play('T1', 2, idx);
  const t = data.tournament('T1'), [a, b] = names(t)(2);
  assert.ok(t.finished);
  return { a, b, champ: idx ? b : a, score: idx ? '0 – 1' : '1 – 0' };
}
const WINNER = [['tour-new', 'New tournament'], ['home', 'Menu']];

test('tournament screen: the winner\'s screen comes up when the final\'s result has moved on, and the win is called once', async t => {
  const on = clock(t);
  const { a, b, champ, score } = await toTheFinal(on, 1);
  S.openTournament('T1');  // "Back to the tournament": the result is on its way to the Winner's box
  assert.doesNotMatch(text(), /wins/, 'not before it is there');
  assert.deepEqual(acts(), [], 'and nothing under the bracket to press yet');
  assert.deepEqual(app.said, []);
  frames();
  await on(250);
  assert.ok(text().startsWith(`${champ} wins Test Final: ${a} ${score} ${b} `), text());
  assert.match(app.$app.innerHTML, new RegExp(`<h1 class="tour-champ">${champ}</h1>`), 'the name is the heading');
  assert.match(app.$app.innerHTML, /class="bracket"/, 'the bracket is still there, under it');
  assert.deepEqual(acts(), WINNER);
  assert.doesNotMatch(text(), /See the bracket/);
  assert.deepEqual(app.said, [`${champ} wins Test`]);
  assert.equal(buttons().length, 3, 'and every match opens its scorecard');

  // Drawn again (a sync), come back to (a reload, the history), opened another day: said the once.
  S.renderTournament();
  S.openTournament('T1');
  frames();
  await on(2000);
  assert.ok(text().startsWith(`${champ} wins Test Final:`));
  assert.deepEqual(app.said, [`${champ} wins Test`]);
});

test('tournament screen: the winner\'s screen is straight up with reduced motion, and after a tap that skips', async t => {
  const on = clock(t);
  let { champ } = await toTheFinal(on, 0);
  page.reduced = true;
  S.openTournament('T1');
  await settle();
  assert.ok(text().startsWith(`${champ} wins Test Final:`));
  assert.deepEqual(acts(), WINNER);
  assert.deepEqual(app.said, [`${champ} wins Test`]);

  ({ champ } = await toTheFinal(on, 1));
  S.openTournament('T1');
  assert.doesNotMatch(text(), /wins/);
  S.tourAct('tour-skip', {});
  frames(16);
  await on(1);
  assert.ok(text().startsWith(`${champ} wins Test Final:`));
  assert.deepEqual(app.said, [`${champ} wins Test`]);
  assert.deepEqual(buttons(), [], 'the tap that skipped is not a tap on a match');
  await on(450);
  assert.equal(buttons().length, 3);
  assert.deepEqual(app.said, [`${champ} wins Test`]);
});

test('tournament screen: a device that did not see the final won shows the winner and says nothing', async t => {
  const on = clock(t);
  const { champ } = await toTheFinal(on, 0);
  store.set('tourSeen', {});  // (another device: the tournament has never been open on it)
  S.openTournament('T1');
  await settle();
  assert.ok(text().startsWith(`${champ} wins Test Final:`));
  assert.deepEqual(app.said, []);
});

// A tournament that is over, as it is saved: every match won by its first player, or abandoned as drawn.
function over(id, name, created, entrants, abandoned = false) {
  let t = makeDraw({ id, name, entrants, opts: { start: 301, out: 'straight' }, rounds: defaultRounds(entrants.length).map(() => ({ legs: 1 })), now: created }, () => 0.5);
  while (!abandoned && !t.finished) { const i = readySlots(t)[0]; t = recordResult(t, i, t.data.slots[i].a, [1, 0], 'played', created + 60000); }
  data.saveTournament({ ...t, abandoned });
  return data.tournament(id);
}
const dayOf = ts => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' });
const winnerOf = t => t.data.entrants.find(e => e.id === t.winner).name;

test('tournament screen: no "Past tournaments" until there is one', () => {
  fresh([sam, phil, mum]);
  S.openTournament();
  assert.match(text(), /^New tournament/);
  assert.doesNotMatch(text(), /Past tournaments/);
  going([sam, phil, mum]);
  assert.match(text(), /^Test/);
  assert.doesNotMatch(text(), /Past tournaments/, 'the one going is not past');
  assert.deepEqual(pastLines(), []);
});

test('tournament screen: past tournaments are listed under it, newest first, with who won or "abandoned"', () => {
  fresh([sam, phil, mum]);
  const spring = Date.UTC(2026, 2, 7, 12), summer = Date.UTC(2026, 5, 7, 12), autumn = Date.UTC(2026, 8, 7, 12);
  const one = over('A', 'Spring', spring, [sam, phil, mum]);
  over('B', 'Summer', summer, [sam, phil, mum], true);
  const three = over('C', 'Autumn', autumn, [phil, mum, sam, dad]);
  const lines = [['C', `Autumn ${dayOf(autumn)} ${winnerOf(three)}`], ['B', `Summer ${dayOf(summer)} abandoned`], ['A', `Spring ${dayOf(spring)} ${winnerOf(one)}`]];

  S.openTournament();  // none going: setting one up
  assert.match(text(), /^New tournament/);
  assert.match(text(), /Past tournaments/);
  assert.deepEqual(pastLines(), lines);

  data.saveTournament(makeDraw({ id: 'D', name: 'Winter', entrants: [sam, phil, mum], opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }], now: autumn + 1e9 }, () => 0.5));
  S.openTournament();  // one going: its bracket
  assert.match(text(), /^Winter/);
  assert.deepEqual(pastLines(), lines, 'the same list under the bracket, without the one going');
});

test('tournament screen: over a bracket with past ones under it there is a way to their list, which a wide screen has no room to show', () => {
  fresh([sam, phil, mum]);
  const link = () => acts().filter(([act]) => act === 'tour-past');
  data.saveTournament(makeDraw({ id: 'D', name: 'Winter', entrants: [sam, phil, mum], opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }] }, () => 0.5));
  page.on = true;
  S.openTournament();
  assert.match(text(), /^Winter/);
  assert.deepEqual(link(), [], 'no past ones: nothing to go to');
  over('A', 'Spring', Date.UTC(2026, 2, 7, 12), [sam, phil, mum]);
  S.renderTournament();
  assert.deepEqual(link(), [['tour-past', 'Past tournaments']]);
  assert.ok(app.$app.innerHTML.indexOf('data-act="tour-past"') < app.$app.innerHTML.indexOf('class="bracket"'), 'over the bracket, with the heading and the buttons');
  assert.equal(page.listShown, null);
  S.tourAct('tour-past', {});
  assert.ok(page.listShown, 'pressed, the list\'s heading is scrolled to');
  assert.equal(page.listShown.block, 'start');
  // One opened from that list has no list under it, and so no way to one; nor has the form, which is not a bracket.
  S.tourAct('tour-open', { id: 'A' });
  assert.deepEqual(link(), []);
  data.saveTournament({ ...data.tournament('D'), abandoned: true });
  S.openTournament();
  assert.match(text(), /^New tournament/);
  assert.deepEqual(link(), []);
  assert.equal(pastLines().length, 2);
});

test('tournament screen: a past tournament opens to its bracket, and Back is the way out of it', () => {
  fresh([sam, phil, mum]);
  const one = over('A', 'Spring', Date.UTC(2026, 2, 7, 12), [sam, phil, mum]);
  over('B', 'Summer', Date.UTC(2026, 5, 7, 12), [sam, phil, mum], true);
  page.on = true;
  S.openTournament();
  S.tourAct('tour-open', { id: 'A' });
  assert.deepEqual([S.tourView.id, S.tourView.past], ['A', true]);
  assert.ok(text().startsWith(`${winnerOf(one)} wins Spring Final:`), text());
  assert.match(app.$app.innerHTML, /class="bracket"/);
  assert.deepEqual(acts(), [['up', 'Back'], ['home', 'Menu']], 'no "New tournament" on the way through the list');
  assert.deepEqual(pastLines(), []);
  assert.deepEqual(app.said, [], 'the win is not called again');

  S.openTournament(null);  // Back: what the history brings back
  assert.equal(S.tourView.past, false);
  assert.match(text(), /^New tournament/);
  S.tourAct('tour-open', { id: 'B' });
  assert.match(text(), /^Summer .*Abandoned\./);
  assert.deepEqual(acts(), [['up', 'Back'], ['home', 'Menu']]);
  assert.deepEqual(app.said, []);

  // (come back to by the history, or a reload: still the one opened from the list)
  S.openTournament('A', true);
  assert.deepEqual(acts(), [['up', 'Back'], ['home', 'Menu']]);
  // and one that has gone (signed out, say) is no dead end
  S.openTournament('gone', true);
  assert.deepEqual([S.tourView.id, S.tourView.past], [null, false]);
  assert.match(text(), /^New tournament/);
});

test('tournament screen: a past one opened from the list is a step on in the history, which Back takes back; the screen\'s other buttons stay in their place', () => {
  fresh([sam, phil, mum]);
  over('A', 'Spring', Date.UTC(2026, 2, 7, 12), [sam, phil, mum]);
  page.on = true;
  S.openTournament();
  assert.deepEqual(app.marks, [], '(the way in is the app\'s to note)');
  S.tourAct('tour-open', { id: 'A' });
  assert.deepEqual(app.marks, [true], 'a new step: Back comes back to the screen it was opened from');
  S.tourAct('tour-open', { id: 'gone' });  // (a line of a list drawn before it went)
  assert.deepEqual(app.marks, [true], 'nothing opened, no step');

  // Start: the form's place in the history becomes the tournament's.
  S.openTournament(null);
  app.marks.length = 0;
  for (const id of ['1', '2', '3']) S.tourAct('tour-pick', { id });
  S.tourAct('tour-draw', {});
  assert.deepEqual(app.marks, []);
  S.tourAct('tour-start', {});
  const going = S.currentTournament();
  assert.ok(going);
  assert.deepEqual(app.marks, [false]);
  // From a finished one come back to through the history, the way to the one going: in its place.
  S.openTournament('A');
  S.tourAct('tour-current', {});
  assert.equal(S.tourView.id, going.id);
  assert.deepEqual(app.marks, [false, false]);
  // And "New tournament", from one that is over.
  data.saveTournament({ ...going, abandoned: true });
  S.openTournament(going.id);
  S.tourAct('tour-new', {});
  assert.match(text(), /^New tournament/);
  assert.deepEqual(app.marks, [false, false, false]);
});

test('tournament screen: where the bracket is wider than the screen it opens on the match to play, and once it is won on the Winner\'s box', async () => {
  // (a phone: the drawing is 1000 across in a box of 300. Two rounds: the first is in sight as it is,
  // the final and the Winner's column are not.)
  going([sam, phil, mum]);
  Object.assign(page, { on: true, narrow: 300 });
  S.openTournament('T1');
  await settle();
  const first = S.tourMarked(data.tournament('T1'));
  assert.equal(data.tournament('T1').data.slots[first].round, 0);
  assert.equal(page.box.scrollLeft, 0, 'the first round\'s match is where the bracket starts');

  play('T1', first, 0);
  S.openTournament('T1');
  await settle();
  assert.equal(S.tourMarked(data.tournament('T1')), 2, 'the final is next');
  const atFinal = page.box.scrollLeft;
  assert.ok(atFinal > 300 && atFinal < 700, `scrolled to the final's column (${atFinal})`);

  play('T1', 2, 0);
  S.openTournament('T1');
  await settle();
  assert.match(text(), / wins Test /, 'the winner\'s screen');
  assert.equal(S.tourMarked(data.tournament('T1')), null, 'no match is marked any more');
  assert.equal(page.box.scrollLeft, 700, 'at its end, where the Winner\'s box is');
  S.renderTournament();  // (drawn again, a new box: the same)
  await settle();
  assert.equal(page.box.scrollLeft, 700);

  // One abandoned has no match to play and no winner: left where it starts.
  going([sam, phil, mum]);
  Object.assign(page, { on: true, narrow: 300 });
  play('T1', first, 0);
  data.saveTournament({ ...data.tournament('T1'), abandoned: true });
  S.openTournament('T1');
  await settle();
  assert.match(text(), /Abandoned\./);
  assert.equal(page.box.scrollLeft, 0);
});

test('tournament screen: a finished one come back to while another is going leads on to that one, not to a new one', () => {
  fresh([sam, phil, mum]);
  const one = over('A', 'Spring', Date.UTC(2026, 2, 7, 12), [sam, phil, mum]);
  data.saveTournament(makeDraw({ id: 'D', name: 'Winter', entrants: [sam, phil, mum], opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }], now: Date.UTC(2026, 11, 7, 12) }, () => 0.5));
  S.openTournament('A');  // (as the history has it, from before Winter was started)
  assert.ok(text().startsWith(`${winnerOf(one)} wins Spring Final:`));
  assert.deepEqual(acts(), [['tour-current', 'Back to Winter'], ['home', 'Menu']]);
  S.tourAct('tour-current', {});
  assert.equal(S.tourView.id, 'D');
  assert.match(text(), /^Winter/);
  assert.deepEqual(pastLines().map(l => l[0]), ['A']);
});

test('tournament screen: "Menu" straight after the final: Tournament then shows its ending, once', async t => {
  const on = clock(t);
  const { a, b, champ, score } = await toTheFinal(on, 1);  // won here, and then Menu, not "Back to the tournament"
  assert.equal(S.currentTournament(), null);
  S.openTournament();  // Tournament, from the menu
  assert.equal(S.tourView.id, 'T1', 'the one just won, not a new one to set up');
  assert.deepEqual([text().startsWith('Test '), /New tournament|wins/.test(text())], [true, false], 'its bracket, the final\'s result on its way');
  assert.deepEqual(acts(), []);
  assert.deepEqual(app.said, []);
  frames();
  await on(250);
  assert.ok(text().startsWith(`${champ} wins Test Final: ${a} ${score} ${b} `), text());
  assert.deepEqual(acts(), WINNER);
  assert.deepEqual(app.said, [`${champ} wins Test`]);

  // Shown: from the menu again (or another day) it is a new one to set up, with that one in the list under it.
  S.openTournament();
  await settle();
  frames();
  await on(2000);
  assert.equal(S.tourView.id, null);
  assert.match(text(), /^New tournament/);
  assert.deepEqual(pastLines().map(l => l[0]), ['T1']);
  assert.deepEqual(app.said, [`${champ} wins Test`], 'called the once');
});

test('tournament screen: that ending is straight up with reduced motion, and is not shown where it already has been or never was open', async t => {
  const on = clock(t);
  let { champ } = await toTheFinal(on, 0);
  page.reduced = true;
  S.openTournament();
  await settle();
  assert.ok(text().startsWith(`${champ} wins Test Final:`), text());
  assert.deepEqual(acts(), WINNER);
  assert.deepEqual(app.said, [`${champ} wins Test`]);
  S.openTournament();
  await settle();
  assert.match(text(), /^New tournament/);
  assert.deepEqual(app.said, [`${champ} wins Test`]);

  // Won and shown here ("Back to the tournament"), then the menu: nothing of it comes up again.
  ({ champ } = await toTheFinal(on, 1));
  page.reduced = true;
  S.openTournament('T1');
  await settle();
  assert.deepEqual(app.said, [`${champ} wins Test`]);
  S.openTournament();
  await settle();
  assert.match(text(), /^New tournament/);
  assert.deepEqual(app.said, [`${champ} wins Test`]);

  // A device the tournament was never open on while it was going (it keeps no list for it): the form, and nothing said.
  await toTheFinal(on, 0);
  store.set('tourSeen', {});
  S.openTournament();
  await settle();
  frames();
  await on(2000);
  assert.match(text(), /^New tournament/);
  assert.deepEqual(pastLines().map(l => l[0]), ['T1']);
  assert.deepEqual(app.said, []);
  assert.deepEqual(store.get('tourSeen', {}), {}, 'and it still keeps none');
});

test('tournament screen: only the newest finished one\'s ending is shown that way, and never in place of one that is going', async t => {
  const on = clock(t);
  await toTheFinal(on, 0);  // T1: followed here, its final never shown
  const later = Date.now() + 1e6;
  // A newer one was played to its end somewhere else, and has never been open here: T1 is old news.
  over('N', 'Newer', later, [sam, phil, mum]);
  S.openTournament();
  await settle();
  assert.match(text(), /^New tournament/);
  assert.deepEqual(pastLines().map(l => l[0]), ['N', 'T1']);
  assert.deepEqual(app.said, []);
  // An abandoned one since is not a finished one: T1 is still the newest that was won.
  store.set('tournaments', store.get('tournaments').filter(x => x.id !== 'N'));
  over('X', 'Dropped', later, [sam, phil, mum], true);
  // With one going, Tournament is that one.
  data.saveTournament(makeDraw({ id: 'G', name: 'Going', entrants: [sam, phil, mum], opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }], now: later + 5 }, () => 0.5));
  S.openTournament();
  await settle();
  assert.equal(S.tourView.id, 'G');
  assert.match(text(), /^Going/);
  assert.deepEqual(app.said, []);
  data.saveTournament({ ...data.tournament('G'), abandoned: true });
  S.openTournament();
  assert.equal(S.tourView.id, 'T1');
  frames();
  await on(250);
  assert.deepEqual(app.said, [`${winnerOf(data.tournament('T1'))} wins Test`]);
});

test('tournament screen: opened from the list, a final never shown here is not played out or called', async t => {
  const on = clock(t);
  const { champ } = await toTheFinal(on, 0);  // (won here, then Menu instead of "Back to the tournament")
  // and another started since (on another screen, say), so that Tournament is that one, with this one listed under it
  data.saveTournament(makeDraw({ id: 'G', name: 'Going', entrants: [sam, phil, mum], opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }], now: Date.now() + 5 }, () => 0.5));
  S.openTournament();
  await settle();
  assert.match(text(), /^Going/);
  assert.equal(pastLines().length, 1);
  S.tourAct('tour-open', { id: 'T1' });
  await settle();
  assert.ok(text().startsWith(`${champ} wins Test Final:`));
  assert.equal(buttons().length, 3, 'at rest: its matches open their scorecards');
  assert.deepEqual(app.said, []);
});

// ---------- removing a player ----------
const jake = { id: 9, name: 'Jake' };
const here = id => store.get('players').some(p => p.id === id);
function withJake() {
  store.set('players', [...store.get('players'), jake]);
  loadPlayers();
}

test('players: someone in a tournament that is going can\'t be removed, knocked out or not', () => {
  const t = going([sam, phil, mum, dad]);
  withJake();
  const refusal = name => `${name} is still in Test. Finish or abandon it first.`;
  P.roster.open = 1;
  P.removePlayer(1);
  assert.equal(P.roster.removeArmed, false, 'refused before it is armed');
  assert.equal(P.roster.formError, refusal('Sam'));
  assert.ok(text(P.playersPanel()).includes(refusal('Sam')), 'said in their card');
  assert.doesNotMatch(text(P.playersPanel()), /Tap again to remove/);
  P.removePlayer(1);  // and a second tap is no different
  assert.ok(here(1));
  assert.equal(P.roster.formError, refusal('Sam'));
  // With the box for a new player's name open on the same screen: the refusal is under Sam's Remove, and
  // not under that box as well, where what is said is about the name typed there.
  P.roster.adding = true;
  P.removePlayer(1);
  assert.match(P.playersPanel(), /id="newplayer"/, 'the box is there');
  assert.doesNotMatch(text(P.newPlayerRow()), /still in/);
  assert.equal(text(P.playersPanel()).split(refusal('Sam')).length - 1, 1, 'said once');
  P.roster.adding = false;

  // knocked out in the first round: their match is still part of it
  play('T1', 0, 0);
  const out = t.data.slots[0].b, name = names(t)(0)[1];
  P.removePlayer(out);
  P.removePlayer(out);
  assert.ok(here(out));
  assert.equal(P.roster.formError, refusal(name));
  assert.equal(P.roster.removeArmed, false);

  // someone who is not in it goes as before: a tap to arm, a tap to remove
  P.removePlayer(9);
  assert.equal(P.roster.removeArmed, 9);
  assert.equal(P.roster.formError, '');
  P.removePlayer(9);
  assert.ok(!here(9));
});

test('players: once the tournament is finished or abandoned its players can be removed, and it keeps their names', async () => {
  // abandoned
  going([sam, phil, mum, dad]);
  data.saveTournament({ ...data.tournament('T1'), abandoned: true });
  P.removePlayer(1);
  assert.equal(P.roster.formError, '');
  assert.equal(P.roster.removeArmed, 1);
  P.removePlayer(1);
  assert.ok(!here(1));
  assert.equal(S.tourName(data.tournament('T1'), 1), 'Sam');

  // finished: the winner removed
  going([sam, phil, mum, dad]);
  for (const i of [0, 1, 2]) play('T1', i, 0);
  const t = data.tournament('T1'), champ = winnerOf(t);
  assert.ok(t.finished);
  P.removePlayer(t.winner);
  P.removePlayer(t.winner);
  assert.ok(!here(t.winner));
  page.on = true;
  S.openTournament();
  assert.deepEqual(pastLines(), [['T1', `Test ${dayOf(t.finished)} ${champ}`]]);
  S.tourAct('tour-open', { id: 'T1' });
  await settle();
  assert.ok(text().startsWith(`${champ} wins Test Final:`));
  const drawn = page.svg.all().filter(e => e.tag === 'text').map(e => e.textContent);
  assert.ok(drawn.filter(x => x === champ).length >= 3, 'in every round of the bracket, and its Winner\'s box');
});
