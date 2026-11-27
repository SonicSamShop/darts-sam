// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// The app itself (web/app.js) without a browser: how it joins its parts up. Its own
// rules and the data layer are the real ones; every screen is a stand-in that draws
// nothing and notes what it was asked (tests/app/), and the browser is the few things
// below. Here: what it does when a sync is over or a player is numbered, where the
// Tournament screen is kept in the history, and what the menu's Tournament button does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./app/hooks.mjs', import.meta.url);

// ---------- the browser ----------
const heard = {};  // what listens on the window and the document, by event
const listen = (type, fn) => { (heard[type] ??= []).push(fn); };
const tell = (type, e = {}) => { for (const fn of heard[type] ?? []) fn(e); };
const onApp = {};  // what listens on the app's own element
const $app = { innerHTML: '', addEventListener: (type, fn) => { onApp[type] = fn; }, querySelectorAll: () => [], querySelector: () => null };
const kept = new Map();
// The history: every entry written, as [how, what rides along, its address].
const steps = [];
const history = {
  state: null,
  pushState(state, _, url) { this.state = state; steps.push(['push', state, url]); },
  replaceState(state, _, url) { this.state = state; steps.push(['replace', state, url]); },
  go() {}, back() {},
};
Object.assign(globalThis, {
  window: globalThis, history, addEventListener: listen,
  location: { host: '', hash: '#/', protocol: 'http:' },  // (no host: no live line to the cameras, no version to ask for)
  localStorage: { getItem: k => kept.get(k) ?? null, setItem: (k, v) => { kept.set(k, v); } },
  document: {
    getElementById: id => (id === 'app' ? $app : null), querySelector: () => null, querySelectorAll: () => [],
    addEventListener: listen, documentElement: {}, hidden: false, activeElement: null,
  },
  setInterval: () => 0,  // (the app's own timers would keep the test from ending)
});
globalThis.navigator ??= {};  // (Node has one of its own from version 21)

const S = await import('./app/standins.mjs');
const app = await import('../web/app.js');
const { makeDraw, recordResult } = await import('../web/tournament.js');
const { newMatch } = await import('../web/engine.js');
const { server, calls, asked, tourView } = S;
const { data, store } = app;

// ---------- a pretend server ----------
// players and tournaments as it has them; hold: a request whose address starts with this waits until let go.
const srv = { players: [], tournaments: [], nextId: 1, hold: null, letGo: null };
server.answer = async (path, method, body) => {
  if (srv.hold && path.startsWith(srv.hold)) await new Promise(done => { srv.letGo = done; });
  if (path === '/players' && method === 'GET') return srv.players.map(p => ({ ...p }));
  if (path === '/players' && method === 'POST') { srv.players.push({ id: srv.nextId++, ...body }); return { ...srv.players.at(-1) }; }
  if (path === '/tournaments') return structuredClone(srv.tournaments);
  if (path.startsWith('/tournaments/')) {
    const id = path.split('/')[2], at = srv.tournaments.findIndex(t => t.id === id);
    if (!(srv.tournaments[at]?.seq >= body.seq)) srv.tournaments.splice(at < 0 ? srv.tournaments.length : at, at < 0 ? 0 : 1, { id, ...structuredClone(body) });
    return { ok: true };
  }
  if (path === '/settings') return {};
  if (method === 'GET') return [];  // darts, boards, finished games
  return { ok: true };
};
// Everything set going gets its turn, and any sync still running is over.
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(done => setImmediate(done)); };
// A new device, at the menu, with these people on the server and nothing else anywhere.
async function fresh(people = []) {
  await settle();
  for (const k of ['players', 'ops', 'pending', 'tournaments', 'tournamentsq', 'tourSeen', 'match']) store.set(k, null);
  Object.assign(srv, { players: people.map(p => ({ ...p })), tournaments: [], nextId: 50, hold: null, letGo: null });
  app.setMatch(null);
  Object.assign(tourView, { id: null, past: false });
  app.setScreen('home');
  await data.sync(true);
  await settle();
  calls.length = steps.length = 0;
}
const sam = { id: 1, name: 'Sam' }, phil = { id: 2, name: 'Phil' }, mum = { id: 3, name: 'Mum' };
const cup = (id, name = 'Test') => makeDraw({ id, name, entrants: [sam, phil, mum], opts: { start: 301, out: 'straight' }, rounds: [{ legs: 1 }, { legs: 1 }] }, () => 0.5);
// What was drawn since `calls` was last emptied, by which screen.
const drawn = () => calls.map(c => c[0]).filter(n => /^render/.test(n));
// A tap on something of the app's with these data- attributes.
const tap = dataset => onApp.click({ target: { tagName: 'BUTTON', closest: sel => (sel === '.camview' ? null : { tagName: 'BUTTON', dataset }) }, preventDefault() {} });

test('app: it starts at the menu, and has the server\'s players once its first sync is over', async () => {
  await fresh([sam, phil]);
  assert.equal(app.screen, 'home');
  assert.deepEqual(app.players, [sam, phil]);
});

test('app: a pull that brings a tournament changed on another screen draws the bracket again', async () => {
  await fresh([sam, phil, mum]);
  data.saveTournament(cup('T1'));
  await data.sync(true);
  await settle();
  app.setScreen('tournament');
  calls.length = 0;
  await data.sync(true);
  assert.deepEqual(drawn(), [], 'nothing new: nothing drawn again');

  // Another screen plays the first match. This one is brought to the front, which syncs and pulls.
  const theirs = srv.tournaments[0], i = theirs.data.slots.findIndex(s => s.winner == null && s.a != null && s.b != null);
  srv.tournaments[0] = { ...recordResult(theirs, i, theirs.data.slots[i].a, [1, 0], 'played'), seq: theirs.seq + 1 };
  tell('visibilitychange');
  await settle();
  assert.equal(data.tournament('T1').data.slots[i].winner, theirs.data.slots[i].a, 'the result is here');
  assert.deepEqual(drawn(), ['renderTournament'], 'and the bracket shows it');
  calls.length = 0;
  await data.sync(true);
  assert.deepEqual(drawn(), [], 'drawn the once');

  // A change made here is drawn by the screen that made it, not again when the server hands it back.
  data.saveTournament({ ...data.tournament('T1'), name: 'Renamed here' });
  await data.sync(true);
  await settle();
  assert.equal(srv.tournaments[0].name, 'Renamed here');
  assert.deepEqual(drawn(), []);
});

test('app: and the menu, for its line about the tournament going; the other screens are left alone', async () => {
  await fresh([sam, phil, mum]);
  // One started on another screen while this one is at the menu.
  srv.tournaments.push({ ...cup('T1'), seq: 1 });
  await data.sync(true);
  assert.deepEqual(drawn(), ['renderHome'], '"Back to the tournament" appears');
  // And abandoned there, while this one is in the stats, then the settings.
  for (const [at, seq] of [['players', 2], ['settings', 3], ['game', 4]]) {
    app.setScreen(at);
    calls.length = 0;
    srv.tournaments[0] = { ...srv.tournaments[0], seq, name: `Test ${seq}` };
    await data.sync(true);
    assert.equal(data.tournament('T1').name, `Test ${seq}`);
    assert.deepEqual(drawn(), [], `${at}: nothing of a tournament is on it`);
  }
});

test('app: the game in progress goes by a player\'s new number the moment the server gives it, not when the sync is over', async () => {
  await fresh([sam]);
  const jake = data.addPlayer('Jake');
  assert.equal(jake.id, -1);
  const m = { ...newMatch('x01', ['Sam', 'Jake'], { start: 301, out: 'straight' }), id: 'm1', playerIds: [1, jake.id], seq: 1 };
  app.setMatch(m);
  store.set('match', m);
  data.saveMatch(m);
  srv.hold = '/matches/';  // the server numbers Jake, and is then slow to take the game
  const syncing = data.sync();
  try {
    while (store.get('ops', []).length) await null;
    assert.equal(srv.letGo, null, 'the sync is not over');
    assert.deepEqual(store.get('match').playerIds, [1, 50], 'the saved game has the number');
    assert.deepEqual(app.match.playerIds, [1, 50], 'and so has the app\'s own copy of it, which the next dart saves whole');
    // That dart, as the game screen saves it (queueSync): the old number is not put back.
    app.match.log.push({ t: 'dart', seg: 20, mult: 1, ts: 1 });
    app.queueSync();
    assert.deepEqual(store.get('pending')['m1'].m.playerIds, [1, 50]);
  } finally {
    while (!srv.letGo) await null;
    srv.hold = null;
    srv.letGo();
    await syncing;
    await settle();
  }
  assert.equal(data.waiting(), 0, 'and the game is not left waiting for ever');
});

test('app: the Tournament screen\'s place in the history says which tournament, and whether it was opened from the list of past ones', async () => {
  await fresh([sam, phil, mum]);
  app.setScreen('tournament');
  Object.assign(tourView, { id: 'A', past: true });
  app.mark(true);
  const [how, state, url] = steps.at(-1);
  assert.deepEqual([how, url, state.screen, state.tourId, state.tourPast], ['push', '#/tournament', 'tournament', 'A', true]);
  Object.assign(tourView, { id: 'B', past: false });
  app.mark();
  assert.deepEqual([steps.at(-1)[0], steps.at(-1)[1].tourId, steps.at(-1)[1].tourPast], ['replace', 'B', false]);

  // Back, forward or a reload brings that entry back: the same tournament, opened the same way.
  calls.length = 0;
  tell('popstate', { state });
  assert.deepEqual(asked('openTournament'), [['A', true]]);
  tell('popstate', { state: { screen: 'tournament', depth: 1, tourId: 'B', tourPast: false } });
  assert.deepEqual(asked('openTournament').at(-1), ['B', false]);
  // (an entry from the form, which is no tournament's)
  tell('popstate', { state: { screen: 'tournament', depth: 1, tourId: null } });
  assert.deepEqual(asked('openTournament').at(-1), [null, false]);
});

test('app: "Tournament" on the menu opens it as a step on from the menu, and a won match\'s "Back to the tournament" takes the game\'s place', async () => {
  await fresh([sam, phil, mum]);
  tap({ act: 'tournament' });
  assert.deepEqual(asked('openTournament'), [[]], 'from the menu: whichever it is to show');
  assert.equal(steps.at(-1)[0], 'push');

  app.setMatch({ id: 'm9', opts: { tournament: { id: 'T7', slot: 2 } } });
  tap({ act: 'tour-back' });
  assert.deepEqual(asked('openTournament').at(-1), ['T7']);
  assert.equal(steps.at(-1)[0], 'replace');
  app.setMatch(null);

  // Every other button of the Tournament screen is its own to answer.
  tap({ act: 'tour-open', id: 'A' });
  assert.deepEqual(asked('tourAct').at(-1).slice(0, 1), ['tour-open']);
  assert.equal(asked('tourAct').at(-1)[1].id, 'A');
});

test('app: starting a new game checks confirmNewGame before starting', async () => {
  await fresh([sam, phil]);
  app.setup.players = [1];
  tap({ act: 'start' });
  assert.equal(asked('confirmNewGame').length, 1);
  assert.equal(asked('startMatch').length, 0, 'waits for confirmNewGame callback');
  // Invoking the callback proceeds to startMatch
  asked('confirmNewGame')[0][0]();
  assert.equal(asked('startMatch').length, 1);
});
