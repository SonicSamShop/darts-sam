// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// Offline-first saving (web/sync.js) against a pretend Pi that can be switched off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanBoard, cleanDetails, createSync, matchBody } from '../web/sync.js';
import { newMatch } from '../web/engine.js';

function rig() {
  const kept = new Map();
  const store = {
    get: (k, d) => kept.has(k) ? JSON.parse(kept.get(k)) ?? d : d,
    set: (k, v) => kept.set(k, JSON.stringify(v)),
  };
  const pi = { up: false, players: [], settings: {}, matches: new Map(), darts: new Map(), boards: new Map(), noBoards: false, tournaments: new Map(), noTournaments: false, calls: [], nextId: 1 };
  const refuse = (status, msg) => { throw Object.assign(new Error(msg), { status }); };
  async function api(path, method = 'GET', body) {
    if (!pi.up) throw new TypeError('Failed to fetch');
    pi.calls.push(`${method} ${path}`);
    const id = +path.split('/')[2];
    if (path === '/players' && method === 'GET') return pi.players.filter(p => !p.gone).map(({ gone, ...p }) => p)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (path === '/players' && method === 'POST') {
      if (pi.noAdd?.includes(body.name)) refuse(422, 'the Pi will not take this player');
      const old = pi.players.find(p => p.name.toLowerCase() === body.name.toLowerCase());
      if (old && !old.gone) refuse(400, 'there is already a player called ' + old.name);
      if (old) { old.gone = false; return { id: old.id, name: old.name }; }
      pi.players.push({ id: pi.nextId++, name: body.name, ...(body.bot ? { bot: body.bot } : {}) });
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
    if (path.startsWith('/boards')) {
      if (pi.noBoards) refuse(404, 'Not Found');
      const key = path.split('/')[2];
      if (!key) return [...pi.boards.values()];
      if (path.endsWith('/games')) {
        if (!pi.boards.has(key)) refuse(404, 'no such board');
        let moved = 0;
        for (const m of pi.matches.values()) {
          if ((body.start == null || m.started >= body.start) && (body.end == null || m.started < body.end)
            && (!body.only || body.only.includes(m.board ?? null)) && m.board !== key) { m.board = key; moved++; }
        }
        return { moved };
      }
      if (method === 'DELETE') {
        if ([...pi.matches.values()].some(m => m.board === key)) refuse(400, 'games were played on this board');
        pi.boards.delete(key); return null;
      }
      const placed = 'down' in body, was = pi.boards.get(key);
      if (placed && body.down == null) for (const b of pi.boards.values()) if (b.down == null && b.id !== key) b.down = body.up;
      pi.boards.set(key, { id: key, ...(placed ? {} : { up: was?.up ?? null, down: was?.down ?? 0 }), ...body });
      return pi.boards.get(key);
    }
    if (path.startsWith('/tournaments')) {
      if (pi.noTournaments) refuse(404, 'Not Found');
      const key = path.split('/')[2];
      if (!key) return [...pi.tournaments.values()].sort((a, b) => b.created - a.created);
      if (body.data.entrants.some(e => !pi.players.some(o => o.id === e.id))) refuse(400, 'unknown player id');
      if (!(pi.tournaments.get(key)?.seq >= body.seq)) pi.tournaments.set(key, { id: key, ...body });
      return { ok: true };
    }
    if (path === '/settings') return pi.settings;
    if (path.startsWith('/settings/')) { pi.settings[path.split('/')[2]] = body.value; return { ok: true }; }
    if (path.startsWith('/matches?')) return [...pi.matches].filter(([, m]) => m.winner != null)
      .map(([id, m]) => ({ id, game: m.game_name, when: 5, players: [], winner: 'x', duration: m.duration }));
    if (path.startsWith('/matches/')) {
      const key = path.split('/')[2];
      if (method === 'DELETE') { pi.matches.delete(key); return { ok: true }; }
      if (body.players.some(p => !pi.players.some(o => o.id === p))) refuse(400, 'unknown player id');
      const was = pi.matches.get(key);
      if (!(was?.seq >= body.seq)) pi.matches.set(key, { ...body, board: was?.board ?? body.board });
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

test('a computer player keeps its level through the Pi numbering it', async () => {
  const { store, pi, data } = rig();
  const sam = data.addPlayer('Sam'), bot = data.addPlayer('Bot 7', 7);
  assert.deepEqual(bot, { id: -2, name: 'Bot 7', bot: 7 });
  const m = { ...game('m1', [sam.id, bot.id], ['Sam', 'Bot 7'], [D(20, 3)]), bots: [null, 7] };
  store.set('match', m);
  data.saveMatch(m);
  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.deepEqual(pi.players, [{ id: 1, name: 'Sam' }, { id: 2, name: 'Bot 7', bot: 7 }]);
  assert.deepEqual(store.get('players'), [{ id: 2, name: 'Bot 7', bot: 7 }, { id: 1, name: 'Sam' }]);
  assert.deepEqual(store.get('match').playerIds, [1, 2]);
  assert.deepEqual(store.get('match').bots, [null, 7]);
  assert.deepEqual(pi.matches.get('m1').players, [1, 2]);
});

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

test('a set\'s details are tidied, and refused when not one of the choices', () => {
  assert.equal(cleanDetails(null), null);
  assert.equal(cleanDetails({ brand: '  ', grip: '', notes: null }), null);
  assert.deepEqual(cleanDetails({ brand: ' Target  Power ', tungsten: 95, shaft: 'inbetween' }),
    { brand: 'Target Power', tungsten: 95, shaft: 'inbetween' });
  assert.throws(() => cleanDetails({ colour: 'red' }), /no detail called colour/);
  assert.throws(() => cleanDetails({ tungsten: '95' }), /not one of the choices/);  // a number, as the server wants
  assert.throws(() => cleanDetails({ shape: 'Torpedo' }), /not one of the choices/);
  assert.throws(() => cleanDetails({ notes: 'x'.repeat(121) }), /at most 120/);
});

test('the board\'s details are tidied, and refused when they can\'t be right', () => {
  assert.equal(cleanBoard(null), null);
  assert.equal(cleanBoard({ brand: ' ', model: '', bought: null, notes: '' }), null);
  assert.deepEqual(cleanBoard({ brand: ' Winmau ', model: 'Blade  6', bought: 2024, notes: 'turned in March' }, 2026),
    { brand: 'Winmau', model: 'Blade 6', bought: 2024, notes: 'turned in March' });
  assert.throws(() => cleanBoard({ bought: 2027 }, 2026), /year it was bought/);
  assert.throws(() => cleanBoard({ bought: '2024' }, 2026), /year it was bought/);
  assert.throws(() => cleanBoard({ colour: 'red' }), /no detail called colour/);
  assert.throws(() => cleanBoard({ model: 'x'.repeat(41) }), /at most 40/);
});

test('a set\'s details are kept offline and go to the Pi with it', async () => {
  const { store, pi, data } = rig();
  pi.up = true;
  const sam = data.addPlayer('Sam');
  await data.sync(true);
  const red = data.addDarts(1, 'Red', 23, { brand: 'Unicorn', grip: 'heavy', notes: '' });
  assert.deepEqual(red.details, { brand: 'Unicorn', grip: 'heavy' });
  assert.throws(() => data.addDarts(1, 'Blue', null, { grip: 'sticky' }), /not one of the choices/);
  assert.throws(() => data.changeDarts(red.id, { details: { grip: 'sticky' } }), /not one of the choices/);
  await data.sync(true);
  assert.deepEqual(pi.darts.get(red.id).details, { brand: 'Unicorn', grip: 'heavy' });
  pi.up = false;
  data.changeDarts(red.id, { details: { brand: '' } });  // all taken off: nothing to say
  assert.equal(store.get('darts')[0].details, null);
  pi.up = true;
  await data.sync(true);
  assert.equal(pi.darts.get(red.id).details, null);
  assert.equal(sam.id < 0, true);
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
  assert.deepEqual([...pi.darts.values()].map(d => [d.name, d.player, d.grams, d.retired, d.details]),
    [['Red', 1, 23, false, null], ['Blue', 1, null, true, null]]);
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

// ---------- boards ----------
test('boards made offline reach the Pi, and one goes up taking the other down', async () => {
  const { store, pi, data } = rig();
  const old = data.addBoard({ brand: 'Winmau', model: 'Blade 6' });
  assert.equal(data.wallBoard(), null);  // added, not put up yet
  data.putUp(old.id, null);
  assert.equal(data.wallBoard(), old.id);
  const neu = data.addBoard({ brand: 'Unicorn', bought: 2026 });
  data.putUp(neu.id, null);
  assert.equal(data.wallBoard(), neu.id);
  const boards = store.get('boards');
  assert.equal(boards.filter(b => b.down == null).length, 1);
  assert.equal(boards.find(b => b.id === old.id).down, boards.find(b => b.id === neu.id).up);
  assert.throws(() => data.addBoard({ brand: 'x'.repeat(41) }), /at most 40/);
  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.deepEqual([...pi.boards.keys()].sort(), [old.id, neu.id].sort());
  assert.equal(pi.boards.get(neu.id).down, null);
  assert.equal(pi.boards.get(neu.id).brand, 'Unicorn');
  assert.equal(data.waiting(), 0);
});

test('a game carries the board it was played on', () => {
  const { data } = rig();
  const m = { ...game('m1', [1], ['Sam'], [D(20)]), board: 'b1' };
  assert.equal(matchBody(m).board, 'b1');
  assert.equal(matchBody(game('m2', [1], ['Sam'], [])).board, null);
  assert.ok(data);
});

test('putting a board up from a date moves the games since then, here and on the Pi', async () => {
  const { store, pi, data } = rig();
  pi.players.push({ id: 1, name: 'Sam' });
  store.set('players', [{ id: 1, name: 'Sam' }]);
  const old = data.addBoard({ brand: 'Old' });
  data.putUp(old.id, 100);
  pi.up = true;
  await data.sync(true);
  // one game already on the Pi, one waiting here, both on the old board; one from before the date
  pi.matches.set('sent', { players: [1], seq: 1, started: 2000, board: old.id, winner: 0 });
  pi.matches.set('before', { players: [1], seq: 1, started: 500, board: old.id, winner: 0 });
  pi.up = false;
  const waiting = { ...game('waiting', [1], ['Sam'], [D(20)]), started: 3000, board: old.id };
  data.saveMatch(waiting);
  const neu = data.addBoard({ brand: 'New' });
  data.putUp(neu.id, 1000);
  assert.equal(store.get('pending').waiting.m.board, neu.id);  // moved here at once
  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.equal(pi.matches.get('sent').board, neu.id);
  assert.equal(pi.matches.get('waiting').board, neu.id);
  assert.equal(pi.matches.get('before').board, old.id);
  assert.equal(pi.boards.get(old.id).down, 1000);
});

test('games before a date can be put on an older board', async () => {
  const { store, pi, data } = rig();
  pi.players.push({ id: 1, name: 'Sam' });
  store.set('players', [{ id: 1, name: 'Sam' }]);
  const wall = data.addBoard({ brand: 'Wall' });
  data.putUp(wall.id, null);
  const older = data.addBoard({ brand: 'Older' });
  data.playedBefore(older.id, 1000);
  assert.equal(store.get('boards').find(b => b.id === older.id).down, 1000);
  assert.equal(data.wallBoard(), wall.id);
  pi.matches.set('a', { players: [1], seq: 1, started: 500, board: wall.id, winner: 0 });
  pi.matches.set('b', { players: [1], seq: 1, started: 1500, board: wall.id, winner: 0 });
  pi.up = true;
  await data.sync(true);
  assert.equal(pi.matches.get('a').board, older.id);
  assert.equal(pi.matches.get('b').board, wall.id);
});

test('the board on the wall, or one a waiting game was played on, can\'t be removed', async () => {
  const { store, pi, data } = rig();
  const wall = data.addBoard({});
  data.putUp(wall.id, null);
  assert.throws(() => data.removeBoard(wall.id), /on the wall/);
  const spare = data.addBoard({ brand: 'Spare' });
  data.saveMatch({ ...game('m', [1], ['Sam'], []), board: spare.id });
  assert.throws(() => data.removeBoard(spare.id), /played on/);
  store.set('pending', {});
  pi.up = true;
  await data.sync(true);
  assert.ok(pi.boards.has(spare.id));
  data.removeBoard(spare.id);
  assert.ok(!store.get('boards').some(b => b.id === spare.id));
  await data.sync(true);
  assert.ok(!pi.boards.has(spare.id));
});

test('a Pi that doesn\'t know boards leaves ours alone', async () => {
  const { store, pi, data } = rig();
  pi.noBoards = true;
  const b = data.addBoard({ brand: 'Mine' });
  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.deepEqual(store.get('boards').map(o => o.id), [b.id]);
});

test('the Pi\'s boards come back, except ones changed here and not yet sent', async () => {
  const { store, pi, data } = rig();
  pi.boards.set('pb', { id: 'pb', brand: 'On the Pi', up: 1, down: null, created: 1 });
  pi.up = true;
  await data.sync(true);
  assert.equal(data.wallBoard(), 'pb');
  pi.up = false;
  data.changeBoard('pb', { notes: 'turned' });
  pi.boards.get('pb').notes = 'old';
  assert.equal(store.get('boards')[0].notes, 'turned');
});

test('a board put up from before the one on the wall went up leaves that one never put up', () => {
  const { store, data } = rig();
  const first = data.addBoard({});
  data.putUp(first.id, 5000);
  const neu = data.addBoard({ brand: 'New' });
  data.putUp(neu.id, 1000);
  const was = store.get('boards').find(b => b.id === first.id);
  assert.deepEqual([was.up, was.down], [null, 0]);
});

test('changing a board\'s details from a device that hasn\'t heard of a swap doesn\'t undo it', async () => {
  const { store, pi, data } = rig();
  pi.boards.set('old', { id: 'old', brand: 'Old', up: 1, down: null, created: 1 });
  pi.up = true;
  await data.sync(true);
  // another device puts a new board up; this one hasn't synced since
  pi.boards.get('old').down = 500;
  pi.boards.set('new', { id: 'new', brand: 'New', up: 500, down: null, created: 2 });
  data.changeBoard('old', { notes: 'turned twice' });
  await data.sync(true);
  assert.equal(pi.boards.get('new').down, null);
  assert.equal(pi.boards.get('old').down, 500);
  assert.equal(pi.boards.get('old').notes, 'turned twice');
  assert.equal(data.wallBoard(), 'new');
});

test('saying an older board was played on before a date keeps the dates it already has', () => {
  const { store, data } = rig();
  const a = data.addBoard({ brand: 'A' });
  data.putUp(a.id, 1000);
  const b = data.addBoard({ brand: 'B' });
  data.putUp(b.id, 3000);
  data.playedBefore(a.id, 2000);
  const now = store.get('boards').find(o => o.id === a.id);
  assert.deepEqual([now.up, now.down], [1000, 3000]);
});

// ---------- tournaments ----------
const cup = (id, ids, created = 1) => ({
  id, name: 'Tournament 24 Nov', created, finished: null, abandoned: false, winner: null,
  data: {
    opts: { start: 501, out: 'double' }, rounds: [{ legs: 2 }, { legs: 3 }],
    entrants: ids.map(i => ({ id: i, name: 'P' + i })),
    slots: [{ round: 0, a: ids[0], b: ids[1], match: null, winner: null, legs: [0, 0], how: null },
      { round: 0, a: ids[2], b: 'bye', match: null, winner: ids[2], legs: [0, 0], how: 'bye' },
      { round: 1, a: null, b: ids[2], match: null, winner: null, legs: [0, 0], how: null }],
  },
});

test('a tournament saved here goes to the Pi with its seq', async () => {
  const { store, pi, data } = rig();
  pi.players.push({ id: 1, name: 'P1' }, { id: 2, name: 'P2' }, { id: 3, name: 'P3' });
  data.saveTournament(cup('t1', [1, 2, 3]));
  assert.equal(data.tournament('t1').seq, 1);
  assert.equal(data.waiting(), 1);
  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.ok(pi.calls.includes('PUT /tournaments/t1'));
  assert.equal(pi.tournaments.get('t1').seq, 1);
  assert.equal(pi.tournaments.get('t1').name, 'Tournament 24 Nov');
  assert.deepEqual(store.get('tournamentsq'), []);
  assert.equal(data.waiting(), 0);
});

test('a tournament with a player made offline waits for their number, then goes with it', async () => {
  const { store, pi, data } = rig();
  pi.players.push({ id: 1, name: 'P1' }, { id: 3, name: 'P3' });
  pi.nextId = 6;
  data.addPlayer('Newbie');
  const other = data.addPlayer('Other');
  assert.equal(other.id, -2);
  data.saveTournament(cup('t1', [1, -2, 3]));
  // the Pi can't be reached, so the player has no number yet: the tournament stays here
  assert.equal(await data.sync(true), false);
  assert.equal(pi.tournaments.size, 0);
  assert.deepEqual(store.get('tournamentsq'), ['t1']);
  pi.up = true;
  assert.equal(await data.sync(true), true);
  const sent = pi.tournaments.get('t1');
  assert.deepEqual(sent.data.entrants.map(e => e.id), [1, 7, 3]);
  assert.deepEqual(sent.data.slots[0].b, 7);
  assert.deepEqual(data.tournament('t1').data.slots[0].b, 7);
  assert.deepEqual(store.get('tournamentsq'), []);
});

test('the Pi\'s tournaments come back, except ones changed here and not yet sent', async () => {
  const { pi, data } = rig();
  pi.players.push({ id: 1, name: 'P1' }, { id: 2, name: 'P2' }, { id: 3, name: 'P3' });
  pi.up = true;
  data.saveTournament(cup('old', [1, 2, 3], 1));
  data.saveTournament(cup('mine', [1, 2, 3], 2));
  await data.sync(true);
  pi.tournaments.get('old').name = 'Renamed elsewhere';
  pi.tournaments.get('old').seq = 5;
  pi.tournaments.get('mine').name = 'Theirs';
  // changed here, with a player who has no number yet, so it stays queued through the pull below
  const mine = data.tournament('mine');
  data.saveTournament({ ...mine, name: 'Mine', data: { ...mine.data, entrants: [...mine.data.entrants, { id: -9, name: 'New' }] } });
  assert.equal(await data.sync(true), true);
  assert.equal(data.tournament('old').name, 'Renamed elsewhere');
  assert.equal(data.tournament('mine').name, 'Mine');
  assert.equal(pi.tournaments.get('mine').name, 'Theirs');  // not sent
  assert.deepEqual(data.tournaments().map(t => t.id), ['mine', 'old']);  // newest first
  assert.equal(data.tournament('nope'), null);
});

test('a Pi that doesn\'t know tournaments leaves ours alone', async () => {
  const { store, pi, data } = rig();
  pi.players.push({ id: 1, name: 'P1' }, { id: 2, name: 'P2' }, { id: 3, name: 'P3' });
  pi.noTournaments = true;
  data.saveTournament(cup('t1', [1, 2, 3]));
  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.deepEqual(data.tournaments().map(t => t.id), ['t1']);
  // not reached, so still to send: once the Pi is updated, it goes and is kept
  assert.deepEqual(store.get('tournamentsq'), ['t1']);
  pi.noTournaments = false;
  assert.equal(await data.sync(true), true);
  assert.deepEqual(data.tournaments().map(t => t.id), ['t1']);
  assert.equal(pi.tournaments.get('t1').seq, 1);
  assert.equal(data.waiting(), 0);
});

test('a tournament the Pi refuses stays on this device', async () => {
  const { store, pi, data } = rig();
  pi.players.push({ id: 1, name: 'P1' }, { id: 2, name: 'P2' });
  data.saveTournament(cup('t1', [1, 2, 9]));  // 9: a player this Pi has never had
  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.equal(pi.tournaments.size, 0);
  assert.deepEqual(store.get('tournamentsq'), []);
  assert.deepEqual(data.tournaments().map(t => t.id), ['t1']);
});

test('a player the Pi will never take goes, and so do the tournaments they are in', async () => {
  const { store, pi, data } = rig();
  pi.players.push({ id: 1, name: 'P1' }, { id: 3, name: 'P3' });
  pi.nextId = 7;
  pi.noAdd = ['Bad'];
  const bad = data.addPlayer('Bad');
  data.saveTournament(cup('t1', [1, bad.id, 3]));
  data.saveTournament(cup('t2', [1, 3, 1]));
  pi.up = true;
  assert.equal(await data.sync(true), true);
  assert.deepEqual(data.tournaments().map(t => t.id), ['t2']);
  assert.deepEqual(store.get('tournamentsq'), []);
  assert.equal(data.waiting(), 0);
  // the next new player is not mistaken for the one that went
  data.addPlayer('Newcomer');
  assert.equal(await data.sync(true), true);
  assert.deepEqual(data.tournaments().map(t => t.id), ['t2']);
  assert.deepEqual([...pi.tournaments.keys()], ['t2']);
});

test('a new player is never given an id a stored tournament still uses', () => {
  const { data } = rig();
  data.saveTournament(cup('t1', [1, -5, 3]));
  assert.equal(data.addPlayer('Newcomer').id, -6);
});
