// node --test tests/
// Offline-first saving (web/sync.js) against a pretend Pi that can be switched off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../web/sync.js';
import { newMatch } from '../web/engine.js';

function rig() {
  const kept = new Map();
  const store = {
    get: (k, d) => kept.has(k) ? JSON.parse(kept.get(k)) ?? d : d,
    set: (k, v) => kept.set(k, JSON.stringify(v)),
  };
  const pi = { up: false, players: [], settings: {}, matches: new Map(), darts: new Map(), calls: [], nextId: 1 };
  const refuse = (status, msg) => { throw Object.assign(new Error(msg), { status }); };
  async function api(path, method = 'GET', body) {
    if (!pi.up) throw new TypeError('Failed to fetch');
    pi.calls.push(`${method} ${path}`);
    const id = +path.split('/')[2];
    if (path === '/players' && method === 'GET') return pi.players.filter(p => !p.gone).map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (path === '/players' && method === 'POST') {
      const old = pi.players.find(p => p.name.toLowerCase() === body.name.toLowerCase());
      if (old && !old.gone) refuse(400, 'there is already a player called ' + old.name);
      if (old) { old.gone = false; return { id: old.id, name: old.name }; }
      pi.players.push({ id: pi.nextId++, name: body.name });
      return { ...pi.players.at(-1) };
    }
    if (path.startsWith('/players/')) {
      const p = pi.players.find(o => o.id === id);
      if (!p) refuse(404, 'no such player');
      if (method === 'PATCH') p.name = body.name; else p.gone = true;
      return { id, name: p.name };
    }
    if (path === '/darts') return [...pi.darts.values()];
    if (path.startsWith('/darts/')) {
      if (!pi.players.some(p => p.id === body.player)) refuse(400, 'unknown player id');
      const key = path.split('/')[2], old = pi.darts.get(key);
      if (old && old.player !== body.player) refuse(400, 'those darts belong to another player');
      pi.darts.set(key, { id: key, ...body });
      return pi.darts.get(key);
    }
    if (path === '/settings') return pi.settings;
    if (path.startsWith('/settings/')) { pi.settings[path.split('/')[2]] = body.value; return { ok: true }; }
    if (path.startsWith('/matches?')) return [...pi.matches].filter(([, m]) => m.winner != null)
      .map(([id, m]) => ({ id, game: m.game_name, when: 5, players: [], winner: 'x', duration: m.duration }));
    if (path.startsWith('/matches/')) {
      const key = path.split('/')[2];
      if (method === 'DELETE') { pi.matches.delete(key); return { ok: true }; }
      if (body.players.some(p => !pi.players.some(o => o.id === p))) refuse(400, 'unknown player id');
      if (!(pi.matches.get(key)?.seq >= body.seq)) pi.matches.set(key, body);
      return { ok: true };
    }
    throw new Error('unexpected ' + path);
  }
  const reports = [];
  return { store, pi, reports, data: createSync({ store, api, changed: r => reports.push(r) }) };
}
const D = (seg, mult = 1, ts = 1000) => ({ t: 'dart', seg, mult, ts });
function game(id, playerIds, names, log) {
  return { ...newMatch('x01', names, { start: 101, out: 'double' }), id, playerIds, seq: 1, log, started: 0 };
}

test('offline: players, settings and a whole game are kept, then reach the Pi in order', async () => {
  const { store, pi, data, reports } = rig();
  const sam = data.addPlayer('  Sam   C ');
  assert.deepEqual(sam, { id: -1, name: 'Sam C' });
  const alex = data.addPlayer('Alex');
  assert.equal(alex.id, -2);
  assert.throws(() => data.addPlayer('sam c'), /already a player/);
  assert.throws(() => data.addPlayer('x'.repeat(17)), /1 to 16/);
  data.renamePlayer(alex.id, 'Alexa');
  data.saveSetting('setup', { gameId: 'x01', players: [sam.id, alex.id], opts: {} });
  // Sam wins 101: T20, 9, D16
  const m = game('m1', [sam.id, alex.id], ['Sam C', 'Alexa'], [D(20, 3), D(9), D(16, 2, 61000)]);
  store.set('match', m);
  data.saveMatch(m);

  assert.equal(await data.sync(true), false);  // no Pi
  assert.equal(data.waiting(), 5);             // 3 player changes, the setup, the game
  assert.deepEqual(data.recent().map(r => [r.id, r.winner, r.duration, r.waiting]), [['m1', 'Sam C', 61000, true]]);
  assert.deepEqual(store.get('players').map(p => p.name), ['Alexa', 'Sam C']);

  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.equal(data.waiting(), 0);
  assert.deepEqual(pi.players, [{ id: 1, name: 'Sam C' }, { id: 2, name: 'Alexa' }]);
  assert.deepEqual(pi.settings.setup.players, [1, 2]);  // the Pi's numbers, not the made-up ones
  assert.deepEqual(pi.matches.get('m1').players, [1, 2]);
  assert.equal(pi.matches.get('m1').winner, 0);
  assert.equal(pi.matches.get('m1').throws.length, 3);
  assert.deepEqual(store.get('players'), [{ id: 2, name: 'Alexa' }, { id: 1, name: 'Sam C' }]);
  assert.deepEqual(store.get('match').playerIds, [1, 2]);
  assert.deepEqual(reports.at(-1).remapped, [[-1, 1], [-2, 2]]);
  assert.deepEqual(data.recent().map(r => [r.id, !!r.waiting]), [['m1', false]]);  // now the Pi's own list
});

test('a name the Pi already has is adopted rather than refused', async () => {
  const { store, pi, data } = rig();
  pi.players.push({ id: 7, name: 'Sam' }, { id: 8, name: 'Old', gone: true });
  pi.nextId = 9;
  data.addPlayer('sam');
  data.addPlayer('Old');  // a removed player comes back with their history
  const m = game('m1', [-1], ['sam'], [D(20)]);
  data.saveMatch(m);
  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.deepEqual(pi.matches.get('m1').players, [7]);
  assert.deepEqual(store.get('players'), [{ id: 8, name: 'Old' }, { id: 7, name: 'Sam' }]);
});

test('the Pi going away half-way loses nothing and sends nothing twice', async () => {
  const { pi, data } = rig();
  data.addPlayer('Sam');
  data.addPlayer('Alex');
  pi.up = true;
  await data.sync();
  pi.up = false;
  data.removePlayer(2);
  data.renamePlayer(1, 'Sammy');
  assert.equal(await data.sync(), false);
  assert.equal(data.waiting(), 2);
  pi.up = true;
  pi.calls.length = 0;
  assert.equal(await data.sync(true), true);
  assert.deepEqual(pi.calls.slice(0, 2), ['DELETE /players/2', 'PATCH /players/1']);
  assert.deepEqual(pi.players, [{ id: 1, name: 'Sammy' }, { id: 2, name: 'Alex', gone: true }]);
  pi.calls.length = 0;
  await data.sync();
  assert.deepEqual(pi.calls, []);  // nothing left to send
});

test('settings changed here are not overwritten by the Pi before they are sent', async () => {
  const { store, pi, data } = rig();
  pi.settings = { settings: { voice: true, theme: 'stage' } };
  data.saveSetting('settings', { voice: false, theme: 'chalk' });
  pi.up = true;
  await data.sync(true);
  assert.deepEqual(pi.settings.settings, { voice: false, theme: 'chalk' });
  assert.deepEqual(store.get('settings'), { voice: false, theme: 'chalk' });
  // with nothing changed here, the Pi's copy (changed on another device) wins
  pi.settings.settings = { voice: true, theme: 'sheet' };
  await data.sync(true);
  assert.deepEqual(store.get('settings'), { voice: true, theme: 'sheet' });
});

test('a game quit offline is forgotten by the Pi; a change made during a sync is sent after it', async () => {
  const { store, pi, data } = rig();
  pi.up = true;
  data.addPlayer('Sam');
  await data.sync();
  const m = game('m1', [1], ['Sam'], [D(20)]);
  data.saveMatch(m);
  const first = data.sync();
  const newer = { ...m, seq: 2, log: [D(20), D(5)] };
  data.saveMatch(newer);   // thrown while the first copy is on its way
  data.sync();
  await first;
  await data.sync();
  assert.equal(pi.matches.get('m1').seq, 2);
  assert.equal(data.waiting(), 0);
  pi.up = false;
  data.quitMatch(newer);
  await data.sync();
  assert.equal(pi.matches.has('m1'), true);
  pi.up = true;
  await data.sync();
  assert.equal(pi.matches.has('m1'), false);
  assert.deepEqual(store.get('pending'), {});
});

test('a game still waiting here can be shown as a scoresheet, in the shape the Pi sends', () => {
  const { data } = rig();
  const m = game('g1', [1, 2], ['Sam', 'Alex'], [
    D(20, 3, 10), D(0, 0, 11), { t: 'next', ts: 12 },  // Sam 60, and moves on a dart early
    { t: 'visit', total: 45, ts: 20 },                 // Alex types 45
    D(9, 1, 30), D(16, 2, 31)]);                       // Sam finishes 41
  data.saveMatch(m);
  const sheet = data.sheet('g1');
  assert.deepEqual(sheet.visits, [[0, 1, 12, 0, [203, 0, 0]], [1, 1, 20, 0, null, 45, 3], [0, 2, 31, 0, [91, 162]]]);
  assert.deepEqual([sheet.game, sheet.name, sheet.players, sheet.winner, sheet.finished, sheet.duration],
    ['x01', 'X01', ['Sam', 'Alex'], 0, 31, 31]);
  assert.equal(data.sheet('nope'), null);
  data.quitMatch(m);
  assert.equal(data.sheet('g1'), null);
});

test('darts made offline wait for their player\'s number, then go with the games thrown in them', async () => {
  const { store, pi, data } = rig();
  const sam = data.addPlayer('Sam');
  const red = data.addDarts(sam.id, ' Red ', 23);
  assert.equal(red.name, 'Red');
  assert.equal(red.player, -1);
  assert.throws(() => data.addDarts(sam.id, 'red'), /already darts called Red/);
  assert.throws(() => data.addDarts(sam.id, 'Lead', 400), /between 1 and 100 grams/);
  const blue = data.addDarts(sam.id, 'Blue');
  data.changeDarts(blue.id, { retired: true });
  assert.throws(() => data.changeDarts(blue.id, { name: 'RED' }), /already darts/);
  data.saveSetting('setup', { gameId: 'x01', players: [sam.id], opts: {}, darts: { [sam.id]: red.id } });
  const m = { ...game('m1', [sam.id], ['Sam'], [D(20, 3), D(9), D(16, 2)]), darts: [red.id] };
  data.saveMatch(m);
  assert.equal(data.waiting(), 5);  // the player, two sets, the setup, the game

  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.equal(data.waiting(), 0);
  assert.deepEqual([...pi.darts.values()].map(d => [d.name, d.player, d.grams, d.retired]),
    [['Red', 1, 23, false], ['Blue', 1, null, true]]);
  assert.deepEqual(pi.matches.get('m1').darts, [red.id]);
  assert.deepEqual(pi.settings.setup.darts, { 1: red.id });  // filed under the Pi's number for Sam
  assert.deepEqual(store.get('darts').map(d => [d.name, d.player]), [['Red', 1], ['Blue', 1]]);

  // Another device renamed one; a change made here and not yet sent is kept over the Pi's copy.
  pi.darts.get(red.id).name = 'Red (old)';
  data.changeDarts(blue.id, { retired: false });
  pi.up = false;
  await data.sync(true);
  pi.up = true;
  await data.sync(true);
  assert.deepEqual(store.get('darts').map(d => [d.name, d.retired]), [['Red (old)', false], ['Blue', false]]);
});
