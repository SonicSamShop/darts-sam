// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Saved data, offline first.
//
// Everything the app saves (players, settings, matches) is written to this
// device straight away and queued for the Pi. The queue is sent whenever the
// Pi can be reached, in the order it happened, and then the Pi's copy is
// fetched back. Nothing here waits for the network, so the app behaves the
// same with or without the Pi.
//
// Kept in the store (the browser's localStorage, see app.js):
//   players   [{id, name}]   a player made offline has a negative id until the
//                            Pi has given them a real one. A computer player
//                            also has bot: its level (see bot.js)
//   ops       [{n, op: 'add'|'rename'|'remove', id, name?, bot?}]  player changes to send
//   darts     [{id, player, name, grams, created, retired, details}]  every player's sets of
//                            darts; the app makes up their ids, so none is renumbered.
//                            details: brand, barrel and so on (DARTS_DETAILS), or null
//   dartsq    [id]           sets added or changed here, to send
//   boards    [{id, brand, model, bought, notes, up, down, created}]  the household's
//                            boards. The one with no `down` is on the wall; one with no
//                            `up` (and down 0) hasn't been put up yet. Ids made up here.
//   boardsq   [id]           boards added, changed or removed here, to send
//   boardsup  [id]           those of them put up or taken down here: only these send their
//                            up and down, so details changed on a device that hasn't heard
//                            of a swap don't undo it
//   moves     [{n, id, start, end, only}]  games said to be on a board (see moveGames), to send
//   tournaments [{id, seq, name, data, created, finished, abandoned, winner}]  knockouts
//                            (see tournament.js), each saved whole with a seq that goes up
//   tournamentsq [id]        tournaments changed here, to send
//   dirty     {setup?, settings?}   settings changed here since they were last sent
//   pending   {matchId: {seq, m: match} | {seq, quit: true}}  matches to send
//   recent    finished games as the Pi last listed them
import { gameById, compute, elapsed } from './engine.js';
import { remapIds } from './tournament.js';

export const cleanName = name => String(name).trim().split(/\s+/).join(' ');

// What else can be said about a set of darts, every part of it optional: each
// field with either the choices it can take or, for words typed in, how long
// they can be. The same list is in server/db.py (DARTS_DETAILS), which checks
// the same way.
export const DARTS_DETAILS = {
  brand: 40,
  tungsten: [80, 85, 90, 95, 97],  // per cent
  shape: ['straight', 'torpedo', 'bomb', 'scalloped', 'other'],
  grip: ['smooth', 'light', 'medium', 'heavy'],
  shaft: ['short', 'inbetween', 'medium', 'long'],
  flight: ['standard', 'slim', 'kite', 'pear', 'small', 'other'],
  notes: 120,
};
// What can be said about a board (the same checks are in server/db.py, clean_board):
//   brand, model, notes   words typed in, at most BOARD_MAX[field] characters
//   bought                the year it was bought (a number), not after `year`
export const BOARD_MAX = { brand: 40, model: 40, notes: 120 };
export function cleanBoard(board, year = new Date().getFullYear()) {
  if (board == null) return null;
  const out = {};
  for (const [key, value] of Object.entries(board)) {
    if (value == null || value === '') continue;
    if (key === 'bought') {
      if (!Number.isInteger(value) || value < 1900 || value > year) throw new Error('the year it was bought is not one there has been');
      out.bought = value;
    } else if (key in BOARD_MAX) {
      const words = cleanName(value);
      if (words.length > BOARD_MAX[key]) throw new Error(`the ${key} can be at most ${BOARD_MAX[key]} characters`);
      if (words) out[key] = words;
    } else throw new Error(`a board has no detail called ${key}`);
  }
  return Object.keys(out).length ? out : null;
}

// A set's details checked and tidied: empty fields dropped, null if nothing is left.
// Throws on a field that isn't one, or a choice a field doesn't have.
export function cleanDetails(details) {
  if (details == null) return null;
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    const rule = DARTS_DETAILS[key];
    if (rule === undefined) throw new Error(`darts have no detail called ${key}`);
    if (value == null || value === '') continue;
    if (typeof rule === 'number') {
      const words = cleanName(value);
      if (words.length > rule) throw new Error(`the ${key} can be at most ${rule} characters`);
      if (words) out[key] = words;
    } else if (rule.includes(value)) out[key] = value;
    else throw new Error(`${value} is not one of the choices for ${key}`);
  }
  return Object.keys(out).length ? out : null;
}
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const byName = list => list.sort((a, b) => a.name.localeCompare(b.name));
// The Pi answered and said no (as opposed to: the Pi could not be reached).
const refused = e => e.status >= 400 && e.status < 500;

// What the Pi stores for a match: the log, plus one record per dart for stats.
export function matchBody(m) {
  const s = compute(m);
  return {
    seq: m.seq, game_id: m.gameId, game_name: gameById(m.gameId).name, opts: m.opts,
    log: m.log, started: m.started, players: m.playerIds, darts: m.darts ?? null, board: m.board ?? null, winner: s.winner, throws: s.throws,
    duration: s.winner != null ? elapsed(m, s) : null,  // how long the game took, once it is won
  };
}

// A match on this device as the Pi would send it back for a scoresheet: the
// same shape as an entry of a player's history (see _history() in
// server/db.py), so the app shows either the same way.
export function matchSheet(m) {
  const s = compute(m), visits = [];
  for (const t of s.throws) {
    const v = visits.at(-1);
    if (v && v[0].player === t.player && v[0].round === t.round) v.push(t); else visits.push([t]);
  }
  return {
    id: m.id, game: m.gameId, name: gameById(m.gameId).name, opts: m.opts, started: m.started,
    finished: s.winner != null ? m.log.at(-1)?.ts ?? m.started : null,
    duration: s.winner != null ? elapsed(m, s) : null, players: m.players, winner: s.winner,
    bots: m.bots ?? m.players.map(() => null),  // which seats the computer had: its level, or null for a person
    visits: visits.map(v => [v[0].player, v[0].round, v.at(-1).ts, +v.some(t => t.bust),
      ...(v[0].src === 'visit' ? [null, v[0].seg, v.length] : [v.map(t => t.mult ? t.seg * 10 + t.mult : 0)])]),
  };
}

// store: {get(key, fallback), set(key, value)}
// api(path, method, body): resolves with the Pi's reply; rejects with an error
//   that has .status if the Pi refused, and no .status if it wasn't reached
// changed({remapped, pulled, sent}): called after every sync attempt.
//   remapped: [[old id, new id]] for players the Pi has now numbered
export function createSync({ store, api, changed = () => {} }) {
  const { get, set } = store;
  // Player ids in a queued match (entries queued by older versions keep them in .players).
  const idsOf = item => item.m?.playerIds ?? item.players ?? [];

  // ---------- changes made on this device ----------
  function checkName(name, except) {
    name = cleanName(name);
    if (name.length < 1 || name.length > 16) throw new Error('a name needs 1 to 16 characters');
    const clash = get('players', []).find(p => p.id !== except && same(p.name, name));
    if (clash) throw new Error(`there is already a player called ${clash.name}`);
    return name;
  }
  function queue(op) {
    const ops = get('ops', []);
    set('ops', [...ops, { ...op, n: Math.max(0, ...ops.map(o => o.n)) + 1 }]);
  }
  // bot: the level of a computer player; left out for a person.
  function addPlayer(name, bot) {
    name = checkName(name);
    const players = get('players', []);
    const id = Math.min(0, ...players.map(p => p.id), ...get('ops', []).map(o => o.id)) - 1;
    const p = bot ? { id, name, bot } : { id, name };
    set('players', byName([...players, p]));
    queue({ op: 'add', ...p });
    return p;
  }
  function renamePlayer(id, name) {
    name = checkName(name, id);
    set('players', byName(get('players', []).map(p => p.id === id ? { ...p, name } : p)));
    queue({ op: 'rename', id, name });
    return { id, name };
  }
  function removePlayer(id) {
    set('players', get('players', []).filter(p => p.id !== id));
    queue({ op: 'remove', id });
  }
  // ---------- darts ----------
  const DARTS_MAX = 24;
  function checkDarts(player, name, grams, except) {
    name = cleanName(name);
    if (name.length < 1 || name.length > DARTS_MAX) throw new Error(`a set of darts needs a name of 1 to ${DARTS_MAX} characters`);
    if (grams != null && !(grams >= 1 && grams <= 100)) throw new Error('darts weigh between 1 and 100 grams');
    const clash = get('darts', []).find(d => d.player === player && d.id !== except && same(d.name, name));
    if (clash) throw new Error(`there are already darts called ${clash.name}`);
    return name;
  }
  function queueDarts(d) {
    set('darts', [...get('darts', []).filter(o => o.id !== d.id), d]);
    set('dartsq', [...get('dartsq', []).filter(id => id !== d.id), d.id]);
  }
  // A new set of darts for a player. grams: their weight, or null. details: see DARTS_DETAILS.
  function addDarts(player, name, grams = null, details = null) {
    name = checkDarts(player, name, grams);
    details = cleanDetails(details);
    const d = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), player, name, grams, created: Date.now(), retired: false, details };
    queueDarts(d);
    return d;
  }
  // Change a set: {name?, grams?, retired?, details?}. Put away (retired), it is off the menu but kept in the stats.
  function changeDarts(id, changes) {
    const d = get('darts', []).find(o => o.id === id);
    if (!d) throw new Error('no such darts');
    const next = { ...d, ...changes };
    next.name = checkDarts(d.player, next.name, next.grams, id);
    next.details = cleanDetails(next.details);
    queueDarts(next);
    return next;
  }

  // ---------- boards ----------
  // The household's boards. One is on the wall, and a game takes that one when it starts
  // (match.board); the stats can then be seen board by board.
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const boardsNow = () => get('boards', []);
  function queueBoard(b, placed) {
    set('boards', [...boardsNow().filter(o => o.id !== b.id), b]);
    set('boardsq', [...get('boardsq', []).filter(id => id !== b.id), b.id]);
    if (placed && !get('boardsup', []).includes(b.id)) set('boardsup', [...get('boardsup', []), b.id]);
  }
  const wallBoard = () => boardsNow().find(b => b.down == null)?.id ?? null;
  // A new board: not up yet (see putUp). fields: brand, model, bought, notes.
  function addBoard(fields = {}) {
    const b = { id: newId(), brand: null, model: null, bought: null, notes: null, ...cleanBoard(fields), up: null, down: 0, created: Date.now() };
    queueBoard(b, true);
    return b;
  }
  // Change a board's details (brand, model, bought, notes), or its up and down.
  function changeBoard(id, changes) {
    const b = boardsNow().find(o => o.id === id);
    if (!b) throw new Error('no such board');
    const next = { ...b, ...changes };
    const details = cleanBoard({ brand: next.brand, model: next.model, bought: next.bought, notes: next.notes }) ?? {};
    for (const k of ['brand', 'model', 'bought', 'notes']) next[k] = details[k] ?? null;
    queueBoard(next, 'up' in changes || 'down' in changes);
    return next;
  }
  function removeBoard(id) {
    const b = boardsNow().find(o => o.id === id);
    if (!b) return;
    if (b.down == null) throw new Error('the board on the wall can\'t be removed: put another one up first');
    const games = [...Object.values(get('pending', {})).map(i => i.m), get('match', null)];
    if (games.some(m => m?.board === id)) throw new Error('games were played on this board: it can be taken down, not removed');
    set('boards', boardsNow().filter(o => o.id !== id));
    set('boardsq', [...get('boardsq', []).filter(q => q !== id), id]);
  }
  // Games started from `start` up to `end` (ms; null: open) were on this board; with `only`,
  // just those on one of those boards (null: on none). The games waiting here change at once,
  // and the Pi is told to change its own.
  function moveGames(id, start, end, only = null) {
    const fits = m => m && (start == null || m.started >= start) && (end == null || m.started < end)
      && (!only || only.includes(m.board ?? null));
    const pending = get('pending', {});
    for (const item of Object.values(pending)) if (fits(item.m)) item.m.board = id;
    set('pending', pending);
    const match = get('match', null);
    if (fits(match)) set('match', { ...match, board: id });
    const moves = get('moves', []);
    set('moves', [...moves, { n: Math.max(0, ...moves.map(o => o.n)) + 1, id, start, end, only }]);
  }
  // This board goes on the wall from `since` (ms), or from now if null, and the one up there
  // comes down at the same moment. From a date, the games since then that were on the board
  // coming down (or on none) move to this one.
  function putUp(id, since = null) {
    const at = since ?? Date.now(), was = wallBoard();
    if (was === id) return;
    // (one that went up after `at` has no games from before it, and those since move off it:
    // it never really stood, as with the first board a new account is given)
    const old = boardsNow().find(b => b.id === was);
    if (old) changeBoard(was, old.up != null && old.up > at ? { up: null, down: 0 } : { down: at });
    changeBoard(id, { up: at, down: null });
    if (since != null) moveGames(id, since, null, [was, null]);
  }
  // This board was the one played on before `until`: every game from before then moves to it.
  function playedBefore(id, until) {
    const b = boardsNow().find(o => o.id === id);
    if (!b) throw new Error('no such board');
    if (b.down === 0) changeBoard(id, { down: until });  // (never put up: it was played on until then)
    moveGames(id, null, until, null);
  }

  function saveSetting(key, value) {
    set(key, value);
    set('dirty', { ...get('dirty', {}), [key]: true });
  }
  function saveMatch(match) {
    set('pending', { ...get('pending', {}), [match.id]: { seq: match.seq, m: match } });
  }
  // A game that was quit: the Pi is told to forget it.
  function quitMatch(match) {
    set('pending', { ...get('pending', {}), [match.id]: { seq: (match.seq || 0) + 1, quit: true } });
  }

  // ---------- tournaments ----------
  // Saved whole, with a seq one more than before, so the Pi keeps the newest copy.
  const byCreated = list => list.sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : 1));
  const tournaments = () => get('tournaments', []);
  const tournament = id => tournaments().find(t => t.id === id) ?? null;
  function saveTournament(t) {
    const seq = Math.max(t.seq ?? 0, tournament(t.id)?.seq ?? 0) + 1;
    set('tournaments', byCreated([...tournaments().filter(o => o.id !== t.id), { ...t, seq }]));
    set('tournamentsq', [...get('tournamentsq', []).filter(id => id !== t.id), t.id]);
  }

  // How many changes have not reached the Pi yet, and how many of them are games.
  const waiting = () => get('ops', []).length + get('dartsq', []).length + get('boardsq', []).length + get('moves', []).length
    + get('tournamentsq', []).length
    + Object.keys(get('dirty', {})).length
    + Object.keys(get('pending', {})).length;
  const waitingGames = () => Object.values(get('pending', {})).filter(i => !i.quit).length;
  // Those games as history entries, each with its players' ids: what the Pi's history hasn't got
  // yet, for working out achievements (achievements.js).
  const waitingSheets = () => Object.values(get('pending', {})).filter(i => i.m)
    .map(i => ({ sheet: matchSheet(i.m), ids: i.m.playerIds }));

  // Finished games, newest first: the ones still waiting here, then the Pi's list.
  function recent(limit = 8) {
    const mine = Object.entries(get('pending', {})).flatMap(([id, item]) => {
      if (!item.m) return [];
      const s = compute(item.m);
      if (s.winner == null) return [];
      return [{
        id, game: gameById(item.m.gameId).name, when: item.m.log.at(-1)?.ts ?? item.m.started,
        players: item.m.players, winner: item.m.players[s.winner], duration: elapsed(item.m, s), waiting: true,
      }];
    });
    return [...mine, ...get('recent', []).filter(r => !mine.some(m => m.id === r.id))]
      .sort((a, b) => b.when - a.when).slice(0, limit);
  }

  // The scoresheet of a game still waiting here to be sent, or null.
  function sheet(id) {
    const item = get('pending', {})[id];
    return item?.m ? matchSheet(item.m) : null;
  }

  // ---------- sending to the Pi ----------
  // The Pi has numbered a player who was made offline: swap the number everywhere.
  function remap(old, id) {
    const swap = ids => ids.map(i => i === old ? id : i);
    const mine = get('players', []).find(p => p.id === old);
    const others = get('players', []).filter(p => p.id !== old && p.id !== id);
    set('players', byName(mine ? [...others, { ...mine, id }] : others));
    set('darts', get('darts', []).map(d => d.player === old ? { ...d, player: id } : d));
    const setup = get('setup', null);
    if (setup?.players?.includes(old) || setup?.darts?.[old]) {
      const darts = { ...setup.darts };
      if (old in darts) { darts[id] = darts[old]; delete darts[old]; }
      saveSetting('setup', { ...setup, players: swap(setup.players ?? []), darts });
    }
    const match = get('match', null);
    if (match?.playerIds?.includes(old)) set('match', { ...match, playerIds: swap(match.playerIds) });
    const pending = get('pending', {});
    for (const item of Object.values(pending)) {
      if (item.m) item.m.playerIds = swap(item.m.playerIds);
      else if (item.players) item.players = swap(item.players);
    }
    set('pending', pending);
    set('tournaments', tournaments().map(t => remapIds(t, old, id)));
    set('ops', get('ops', []).map(o => o.id === old ? { ...o, id } : o));
  }
  // The Pi will never accept this new player: drop them and what depends on them.
  function forget(id) {
    set('players', get('players', []).filter(p => p.id !== id));
    set('ops', get('ops', []).filter(o => o.id !== id));
    const theirs = get('darts', []).filter(d => d.player === id).map(d => d.id);
    set('darts', get('darts', []).filter(d => d.player !== id));
    set('dartsq', get('dartsq', []).filter(q => !theirs.includes(q)));
    const pending = get('pending', {});
    for (const [key, item] of Object.entries(pending)) if (idsOf(item).includes(id)) delete pending[key];
    set('pending', pending);
  }

  async function pushPlayers(report) {
    for (;;) {
      const op = get('ops', [])[0];
      if (!op) return;
      try {
        if (op.op === 'add') {
          let p;
          try { p = await api('/players', 'POST', op.bot ? { name: op.name, bot: op.bot } : { name: op.name }); } catch (e) {
            // The name is already on the Pi (added from another device, or our
            // own earlier try got there but its reply didn't): use that player.
            if (e.status !== 400) throw e;
            p = (await api('/players')).find(o => same(o.name, op.name));
            if (!p) throw e;
          }
          remap(op.id, p.id);
          report.remapped.push([op.id, p.id]);
        } else if (op.id > 0) {
          const rename = op.op === 'rename';
          await api(`/players/${op.id}`, rename ? 'PATCH' : 'DELETE', rename ? { name: op.name } : undefined);
        }
      } catch (e) {
        if (!refused(e)) throw e;
        if (op.op === 'add') forget(op.id);  // other refusals: the Pi's list puts things right
      }
      set('ops', get('ops', []).filter(o => o.n !== op.n));
    }
  }

  async function pushDarts() {
    const now = id => get('darts', []).find(o => o.id === id);
    for (const id of get('dartsq', [])) {
      const d = now(id);
      if (d?.player < 0) continue;  // their player is still waiting for a number
      if (d) try {
        await api(`/darts/${id}`, 'PUT', { player: d.player, name: d.name, grams: d.grams, created: d.created, retired: d.retired, details: d.details ?? null });
      } catch (e) {
        if (!refused(e)) throw e;  // refused: the Pi's list puts it right
      }
      // Sent, unless it was changed again meanwhile: then it goes next time.
      if (JSON.stringify(now(id)) === JSON.stringify(d)) set('dartsq', get('dartsq', []).filter(o => o !== id));
    }
  }

  async function pushBoards() {
    const now = id => boardsNow().find(o => o.id === id);
    for (const id of get('boardsq', [])) {
      const b = now(id);
      try {
        const placed = get('boardsup', []).includes(id);
        if (b) await api(`/boards/${id}`, 'PUT', { brand: b.brand, model: b.model, bought: b.bought, notes: b.notes, created: b.created, ...(placed && { up: b.up, down: b.down }) });
        else await api(`/boards/${id}`, 'DELETE');
      } catch (e) {
        if (!refused(e)) throw e;  // refused: the Pi's list puts it right
      }
      if (JSON.stringify(now(id)) === JSON.stringify(b)) {
        set('boardsq', get('boardsq', []).filter(o => o !== id));
        set('boardsup', get('boardsup', []).filter(o => o !== id));
      }
    }
    for (;;) {
      const mv = get('moves', [])[0];
      if (!mv) return;
      try { await api(`/boards/${mv.id}/games`, 'POST', { start: mv.start, end: mv.end, only: mv.only }); } catch (e) {
        if (!refused(e)) throw e;
      }
      set('moves', get('moves', []).filter(o => o.n !== mv.n));
    }
  }

  async function pushSettings() {
    for (const key of Object.keys(get('dirty', {}))) {
      const flag = on => {
        const dirty = get('dirty', {});
        if (on) dirty[key] = true; else delete dirty[key];
        set('dirty', dirty);
      };
      flag(false);  // a change made while this is being sent sets it again
      try { await api(`/settings/${key}`, 'PUT', { value: get(key, null) }); } catch (e) {
        if (!refused(e)) { flag(true); throw e; }
      }
    }
  }

  async function pushMatches(report) {
    for (const id of Object.keys(get('pending', {}))) {
      const item = get('pending', {})[id];
      if (!item) continue;
      const body = item.quit ? null : item.m ? matchBody(item.m) : item;
      if (body?.players.some(p => p < 0)) continue;  // a player still waiting for a number
      try { await api(`/matches/${id}`, body ? 'PUT' : 'DELETE', body ?? undefined); } catch (e) {
        if (!refused(e)) throw e;  // not reached: keep it. Refused: it never will be accepted.
      }
      report.sent++;
      if (!body || body.winner != null) report.pull = true;  // the list of finished games changed
      const now = get('pending', {});
      if (now[id]?.seq === item.seq) { delete now[id]; set('pending', now); }  // unless it changed meanwhile
    }
  }

  async function pushTournaments() {
    for (const id of get('tournamentsq', [])) {
      const t = tournament(id);
      if (t?.data.entrants.some(e => e.id < 0)) continue;  // a player still waiting for a number
      if (t) try {
        const { seq, name, data, created, finished, abandoned, winner } = t;
        await api(`/tournaments/${id}`, 'PUT', { seq, name, data, created, finished, abandoned, winner });
      } catch (e) {
        if (!refused(e)) throw e;  // refused: the Pi's list puts it right
      }
      // Sent, unless it was changed again meanwhile: then it goes next time.
      if (tournament(id)?.seq === t?.seq) set('tournamentsq', get('tournamentsq', []).filter(o => o !== id));
    }
  }

  // The Pi's copy replaces ours, except for anything changed here since we sent.
  async function pull() {
    const older = e => { if (refused(e)) return null; throw e; };  // (a Pi too old to know them: keep ours)
    const [players, saved, games, darts, boards, cups] = await Promise.all([api('/players'), api('/settings'), api('/matches?limit=8'),
      api('/darts').catch(older), api('/boards').catch(older), api('/tournaments').catch(older)]);
    if (!get('ops', []).length) set('players', players);
    if (darts) {
      const q = get('dartsq', []), mine = get('darts', []).filter(d => q.includes(d.id));
      set('darts', [...darts.filter(d => !q.includes(d.id)), ...mine]);
    }
    if (boards) {
      const q = get('boardsq', []), mine = boardsNow().filter(b => q.includes(b.id));
      set('boards', [...boards.filter(b => !q.includes(b.id)), ...mine].sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1)));
    }
    if (cups) {
      const q = get('tournamentsq', []), mine = tournaments().filter(t => q.includes(t.id));
      set('tournaments', byCreated([...cups.filter(t => !q.includes(t.id)), ...mine]));
    }
    const dirty = get('dirty', {});
    for (const key of ['settings', 'setup']) if (saved[key] && !dirty[key]) set(key, saved[key]);
    set('recent', games);
  }

  // One sync runs at a time; asking again while one is running queues another
  // straight after it. Resolves true if the Pi was reached and took everything.
  let running = null, again = false, wantPull = false;
  function sync(withPull = false) {
    wantPull ||= withPull;
    if (running) { again = true; return running; }
    const report = { remapped: [], sent: 0, pull: wantPull, pulled: false };
    wantPull = false;
    running = (async () => {
      try {
        await pushPlayers(report);
        await pushDarts();
        await pushBoards();
        await pushSettings();
        await pushMatches(report);
        await pushTournaments();
        if (report.pull) { await pull(); report.pulled = true; }
        return true;
      } catch {
        wantPull ||= report.pull;  // still owed, next time the Pi answers
        return false;
      } finally {
        running = null;
        changed(report);
        if (again) { again = false; sync(); }
      }
    })();
    return running;
  }

  return { addPlayer, renamePlayer, removePlayer, addDarts, changeDarts, addBoard, changeBoard, removeBoard, putUp, playedBefore, wallBoard, saveTournament, tournaments, tournament, saveSetting, saveMatch, quitMatch, waiting, waitingGames, waitingSheets, recent, sheet, sync };
}
