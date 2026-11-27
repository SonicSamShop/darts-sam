// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// The menu's lines about tournaments (web/screens/home.js) without a browser, over the
// real Tournament screen and data layer; the rest of the app is the stand-ins in
// tests/tourscreen. "Tournament" itself is on the menu only when home.js's
// TOURNAMENT_ON_MENU constant is on (it is, since 1.8). The menu each way is tried on a
// copy of the file that the loader makes (tests/tourscreen/hooks.mjs:
// home.js?tournament-off-menu and ?tournament-on-menu); the file itself is never changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./tourscreen/hooks.mjs', import.meta.url);
const body = { scrollTop: 0 };  // what the menu scrolls in
globalThis.document = { addEventListener() {}, querySelector: sel => (sel === '.home-body' ? body : null), getElementById: () => null };
const H = await import('../web/screens/home.js?tournament-off-menu');
const On = await import('../web/screens/home.js?tournament-on-menu');
const S = await import('../web/screens/tournament.js');
const app = await import('./tourscreen/app.mjs');
const { text } = await import('./tourscreen/page.mjs');
const { makeDraw } = await import('../web/tournament.js');
const { newMatch, compute } = await import('../web/engine.js');
const { data, store, loadPlayers } = app;

const sam = { id: 1, name: 'Sam' }, phil = { id: 2, name: 'Phil' }, mum = { id: 3, name: 'Mum' }, dad = { id: 4, name: 'Dad' };
function fresh() {
  for (const k of ['ops', 'tournaments', 'tournamentsq']) store.set(k, []);
  store.set('players', [sam, phil, mum, dad]);
  store.set('pending', {});
  store.set('match', null);
  app.setMatch(null);
  loadPlayers();
}
// Every tag of the menu that is a way to the Tournament screen: [its class, what it is].
const ways = () => [...app.$app.innerHTML.matchAll(/<(\w+)[^>]*>/g)].filter(m => /data-act="tournament"/.test(m[0]))
  .map(m => [m[0].match(/class="([^"]*)"/)?.[1].trim() ?? '', m[1]]);
const lines = () => ways().filter(([cls]) => /\btourline\b/.test(cls));
function going() {
  data.saveTournament(makeDraw({ id: 'T1', name: 'Test', entrants: [sam, phil, mum, dad], opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }] }, () => 0.5));
  const t = data.tournament('T1');
  return i => [t.data.slots[i].a, t.data.slots[i].b].map(id => t.data.entrants.find(e => e.id === id).name).join(' v ');
}

test('menu: Tournament is not on it while TOURNAMENT_ON_MENU is off', () => {
  fresh();
  H.renderHome();
  assert.match(text(), /Matches/, 'the menu is drawn');
  assert.deepEqual(lines(), [], 'no line for it, a computer\'s or a phone\'s');
  assert.deepEqual(ways(), [], 'and no other way in, with none going');
  assert.doesNotMatch(text(), /Tournament|tournament/);
});

test('menu: with a tournament going, "Back to the tournament" is there all the same, and names the next match', () => {
  fresh();
  const title = going();
  H.renderHome();
  assert.deepEqual(lines(), []);
  assert.deepEqual(ways(), [['start', 'button']]);
  assert.match(text(), new RegExp(`In progress Back to the tournament: Test, ${title(0)} `));
});

test('menu: "Back to the tournament" names the match being played, not the first one ready', () => {
  fresh();
  const title = going();
  // the second match is the one started (a tap on its boxes): the game in progress on this device
  const s = data.tournament('T1').data.slots[1];
  const m = { ...newMatch('x01', ['A', 'B'], { start: 301, out: 'straight', legs: 1, sets: 1, tournament: { id: 'T1', slot: 1 } }),
    id: 'm1', playerIds: [s.a, s.b], bots: [null, null], seq: 0 };
  app.setMatch(m);
  S.onMatchStarted(m);
  H.renderHome();
  assert.match(text(), new RegExp(`Back to the tournament: Test, ${title(1)} `));
  assert.doesNotMatch(text(), new RegExp(title(0)));
});

test('menu: "Menu" on a won match whose result the bracket never heard of puts the result in before the game is let go of', () => {
  // The app closed on the winning dart, and is opened again on the won game, which has been sent since
  // (it is not waiting here): "Menu" is one of its two ways out, and the game on screen the only copy
  // of it this device has. (The other, "Back to the tournament": tests/tourscreen.test.mjs.)
  fresh();
  const title = going();
  const s = data.tournament('T1').data.slots[1];
  const m = { ...newMatch('x01', ['A', 'B'], { start: 301, out: 'straight', legs: 1, sets: 1, tournament: { id: 'T1', slot: 1 } }),
    id: 'm1', playerIds: [s.a, s.b], bots: [null, null], seq: 0 };
  app.setMatch(m);
  S.onMatchStarted(m);
  for (const [seg, mult] of [[20, 3], [20, 3], [20, 3], [0, 0], [0, 0], [0, 0], [20, 3], [20, 3], [1, 1]]) m.log.push({ t: 'dart', seg, mult, ts: 1 });
  assert.equal(compute(m).winner, 0);
  store.set('match', m);
  assert.equal(data.tournament('T1').data.slots[1].winner, null, 'started, and no result');

  H.renderHome();
  const now = data.tournament('T1').data.slots[1];
  assert.deepEqual([now.winner, now.legs, now.how], [s.a, [1, 0], 'played'], 'the result is in');
  assert.equal(app.match, null, 'and the game is let go of');
  assert.match(text(), new RegExp(`Back to the tournament: Test, ${title(0)} `), 'the menu names the match still to play');

  // An ordinary won game is let go of as ever.
  const plain = { ...newMatch('x01', ['A', 'B'], { start: 301, out: 'straight', legs: 1, sets: 1 }), id: 'm2', playerIds: [1, 2], bots: [null, null], seq: 0, log: m.log };
  app.setMatch(plain);
  const seq = data.tournament('T1').seq;
  H.renderHome();
  assert.equal(app.match, null);
  assert.equal(data.tournament('T1').seq, seq);
});

test('menu: with TOURNAMENT_ON_MENU on, Tournament has its line, one for a computer and one for a phone', () => {
  fresh();
  On.renderHome();
  assert.deepEqual(lines().map(([cls]) => cls.split(/\s+/).includes('tour-phone')), [false, true], 'the computer\'s among the games, the phone\'s under the steps');
  assert.ok(lines().every(([, tag]) => tag === 'button'));
  assert.match(text(), /Tournament A knockout for 3 to 16 players, people and bots/);
  const html = app.$app.innerHTML;
  assert.ok(html.indexOf('tourline') < html.indexOf('class="setup"'), 'the computer\'s is in the games\' column');
  assert.ok(html.lastIndexOf('tourline') > html.indexOf('class="setup"'), 'the phone\'s in the other, which is under it there');
  // and "Back to the tournament" is as it is with it off
  going();
  On.renderHome();
  assert.equal(lines().length, 2);
  assert.deepEqual(ways().filter(([cls]) => cls === 'start'), [['start', 'button']]);
});

test('menu: a game in progress shows a distinct Resume button with game and players', () => {
  fresh();
  const m = { ...newMatch('x01', ['Sam', 'Phil'], { start: 501, out: 'double', legs: 1, sets: 1 }), id: 'm3', playerIds: [1, 2], bots: [null, null], seq: 0 };
  app.setMatch(m);
  On.renderHome();
  assert.match(app.$app.innerHTML, /class="start resume" data-act="resume"/);
  assert.match(text(), /Resume game in progress 501 · Sam v Phil/);
});
