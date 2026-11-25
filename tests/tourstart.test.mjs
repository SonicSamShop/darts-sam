// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// Starting a match of a tournament (web/screens/start.js: "Who throws first?", the
// bull, the new match) without a browser, over the real Tournament screen and data
// layer; the rest of the app is the stand-ins in tests/tourscreen. The question and
// the bull are screens to sit on: what they were asked can change while they are up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./tourscreen/hooks.mjs', import.meta.url);
// The page: its listeners kept, to press the question's buttons with; the question and the bull's side panel hold what they are given.
const listeners = {}, side = {};
globalThis.document = {
  addEventListener(type, f) { (listeners[type] ??= []).push(f); },
  body: { appendChild: e => e },
  createElement: () => ({ dataset: {}, remove() {}, querySelector: () => ({ focus() {} }) }),
  querySelector: sel => (sel === '.side' ? side : sel === '.bullup' && app.$app.innerHTML.includes('bullup') ? {} : null),
  getElementById: () => null,
};
const B = await import('../web/screens/start.js');
const S = await import('../web/screens/tournament.js');
const app = await import('./tourscreen/app.mjs');
const asked = await import('./tourscreen/start.mjs');
const { BOT_WAIT } = await import('./tourscreen/game.mjs');
const { makeDraw } = await import('../web/tournament.js');
const { data, store, loadPlayers } = app;

const sam = { id: 1, name: 'Sam' }, phil = { id: 2, name: 'Phil' };
// "Who throws first?" answered: 'bull', 'random' or 'cancel'.
const answer = first => listeners.click.forEach(f => f({ target: { closest: sel => (sel.includes('[data-first]') ? { dataset: { first } } : null) } }));
// What the app does when a sync is over (app.js, synced): its lists again, and the Pi's numbers passed on.
function synced(remapped) {
  loadPlayers();
  S.tourRemapped(remapped);
  B.playRemapped(remapped);
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(done => setImmediate(done)); };

// Sam, Phil and a bot at a level never played here (made on this device, under a number of
// its own until the Pi gives it one) in a tournament going: Sam has the bye, the bot plays
// Phil. Gives back the bot's number, and that match as the bracket asks for it (tour-play).
async function going() {
  await settle();  // (a sync an earlier test set going is over)
  for (const k of ['ops', 'tournaments', 'tournamentsq']) store.set(k, []);
  store.set('players', [sam, phil]);
  store.set('pending', {});
  store.set('match', null);
  app.setMatch(null);
  loadPlayers();
  B.closeFirst();
  B.dropBull();
  const made = app.botPlayer(5);
  assert.ok(made < 0);
  data.saveTournament(makeDraw({
    id: 'T1', name: 'Test', entrants: [sam, phil, { id: made, name: 'Bot 5', bot: 5 }],
    opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }],
  }, () => 0.5));
  assert.deepEqual(data.tournament('T1').data.slots.map(s => [s.a, s.b]), [[1, 'bye'], [made, 2], [1, null]]);
  S.openTournament('T1');
  S.tourAct('tour-play', { i: '1' });
  assert.deepEqual(asked.asked.play.ids, [made, 2]);
  return { made, play: asked.asked.play };
}
// The Pi numbers the bot (sync.js, remap) and the app hears of it. Gives back the new number.
async function number(made) {
  await data.sync();
  const id = store.get('players').find(p => p.bot === 5).id;
  assert.ok(id > 0);
  synced([[made, id]]);
  return id;
}

test('starting a tournament match: a bot the Pi numbers while the bull is being thrown for still throws its own dart', async t => {
  const { made, play } = await going();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1.8e12 });
  B.openBull('start', play);
  assert.equal(app.screen, 'bull');
  const id = await number(made);
  assert.deepEqual(B.bull.ids, [id, 2], 'the bull goes by the number the Pi gave');

  t.mock.timers.tick(BOT_WAIT);
  assert.equal(B.bull.darts.length, 1, 'the bot throws for the bull itself');
  assert.ok(B.bull.darts[0].bot);
  B.bullDart({ seg: 0, mult: 0 });  // Phil misses the board
  B.bullStart();
  assert.equal(app.screen, 'game');
  assert.deepEqual([app.match.playerIds, app.match.bots], [[id, 2], [5, null]], 'and plays its own darts in the match');
  assert.equal(data.tournament('T1').data.slots[1].match, app.match.id, 'which is the bracket\'s');
});

test('starting a tournament match: "Who throws first?" answered after the Pi has numbered a player starts it with both', async () => {
  const { made, play } = await going();
  B.askFirst('start', play);
  const id = await number(made);
  answer('random');
  assert.equal(app.screen, 'game');
  assert.deepEqual([app.match?.playerIds, app.match?.bots], [[id, 2], [5, null]]);
  assert.equal(data.tournament('T1').data.slots[1].match, app.match.id);
});

test('starting a tournament match: one asked for before the bracket moved on is not started', async () => {
  const { made, play } = await going();
  const id = await number(made);
  B.askFirst('start', { ...play, ids: [id, 2] });
  // while the question is up, another screen's copy arrives with that match played: Phil won it
  const theirs = structuredClone(data.tournament('T1'));
  Object.assign(theirs.data.slots[1], { match: 'theirs', winner: 2, legs: [0, 1], how: 'played' });
  theirs.data.slots[2].b = 2;
  data.saveTournament(theirs);
  answer('bull');
  assert.equal(B.bull, null, 'nobody is asked to throw for the bull');
  assert.equal(app.screen, 'tournament', 'back to the bracket instead');
  // (and the same if it changes while the bull is being thrown for)
  B.startMatch('start', { ...play, ids: [id, 2] }, [id, 2]);
  assert.equal(app.match, null, 'no match is started for a place already decided');
  assert.equal(app.screen, 'tournament');
  assert.equal(data.tournament('T1').data.slots[1].match, 'theirs');
});
