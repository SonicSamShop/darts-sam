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
//   dirty     {setup?, settings?}   settings changed here since they were last sent
//   pending   {matchId: {seq, m: match} | {seq, quit: true}}  matches to send
//   recent    finished games as the Pi last listed them
import { gameById, compute, elapsed } from './engine.js';

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
    log: m.log, started: m.started, players: m.playerIds, darts: m.darts ?? null, winner: s.winner, throws: s.throws,
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

  // How many changes have not reached the Pi yet, and how many of them are games.
  const waiting = () => get('ops', []).length + get('dartsq', []).length + Object.keys(get('dirty', {})).length
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

  // The Pi's copy replaces ours, except for anything changed here since we sent.
  async function pull() {
    const [players, saved, games, darts] = await Promise.all([api('/players'), api('/settings'), api('/matches?limit=8'),
      api('/darts').catch(e => { if (refused(e)) return null; throw e; })]);  // (a Pi too old to know darts: keep ours)
    if (!get('ops', []).length) set('players', players);
    if (darts) {
      const q = get('dartsq', []), mine = get('darts', []).filter(d => q.includes(d.id));
      set('darts', [...darts.filter(d => !q.includes(d.id)), ...mine]);
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
        await pushSettings();
        await pushMatches(report);
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

  return { addPlayer, renamePlayer, removePlayer, addDarts, changeDarts, saveSetting, saveMatch, quitMatch, waiting, waitingGames, waitingSheets, recent, sheet, sync };
}
