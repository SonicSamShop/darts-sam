// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The rules of a knockout tournament: the draw, byes, and results moving on
// through the bracket. Pure: every function returns a new record and leaves the
// one it was given alone. The screen is screens/tournament.js.
//
// The record, as it is saved (see server/db.py, table tournaments):
//   {id, seq, name, created, finished: null|ms, abandoned, winner: null|id, data}
// data:
//   opts      {start, out}: the X01 options every match uses
//   rounds    [{legs}], one per round, first round first
//   entrants  [{id, name, bot?}]: bot is the level; names kept for players removed later
//   slots     every match in the bracket, round by round and top to bottom:
//             {round, a, b, match, winner, legs: [a's, b's], how}
//             a and b are player ids, null until known, or 'bye'. how is
//             'played', 'bye' or 'simulated' once decided. Slot j of round r+1 is
//             played for by the winners of slots 2j and 2j+1 of round r.
import { newMatch, compute, gameById } from './engine.js';
import { botLevel, LEVELS } from './bot.js';

const BYE = 'bye';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The bracket for n players: the next power of two at or above n (and at least 2).
const sizeFor = n => 2 ** Math.max(1, Math.ceil(Math.log2(n)));

// Bracket positions by seed, top to bottom, so that 1 meets N, and the top two
// seeds can only meet in the final: seedOrder(8) = [1, 8, 4, 5, 2, 7, 3, 6].
export function seedOrder(N) {
  let order = [1];
  while (order.length < N) {
    const size = order.length * 2;
    order = order.flatMap(s => [s, size + 1 - s]);
  }
  return order;
}

export const roundCount = t => Math.log2(t.data.slots.length + 1);

// Round r (0 is the first) named by how far it is from the final; the column
// after the final is the Winner's.
export function roundName(t, r) {
  const left = roundCount(t) - 1 - r;
  if (left < 0) return 'Winner';
  return ['Final', 'Semi-finals', 'Quarter-finals'][left] ?? `Last ${2 ** (left + 1)}`;
}

// First to 2 legs in every round, first to 3 in the final.
export function defaultRounds(n) {
  const count = Math.log2(sizeFor(n));
  return Array.from({ length: count }, (_, r) => ({ legs: r === count - 1 ? 3 : 2 }));
}

// "Christmas 2026" from 20 to 31 December, otherwise "Tournament 24 Nov".
export function suggestName(date) {
  if (date.getMonth() === 11 && date.getDate() >= 20) return `Christmas ${date.getFullYear()}`;
  return `Tournament ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

// A bot's level is who it is, so two bots can't share one: `level` if no other
// bot has it, else the next free level up, then down. null if all are taken.
export function freeLevel(level, taken) {
  const free = n => !taken.includes(n);
  if (free(level)) return level;
  for (let n = level + 1; n <= LEVELS.length; n++) if (free(n)) return n;
  for (let n = level - 1; n >= 1; n--) if (free(n)) return n;
  return null;
}

// Where slot i's winner goes: {i, side} of the next slot, or null for the final.
function nextOf(t, i) {
  const slots = t.data.slots, round = slots[i].round;
  const start = slots.findIndex(s => s.round === round);
  const next = slots.findIndex(s => s.round === round + 1);
  if (next < 0) return null;
  const j = i - start;
  return { i: next + Math.floor(j / 2), side: j % 2 ? 'b' : 'a' };
}

// A copy deep enough for one change: the record, its data and its slots.
const copy = t => ({ ...t, data: { ...t.data, slots: t.data.slots.map(s => ({ ...s })) } });

// Decides slot i on a copy already made: sets the result, and moves the winner on.
function decide(t, i, winner, legs, how, now) {
  Object.assign(t.data.slots[i], { winner, legs, how });
  const next = nextOf(t, i);
  if (next) t.data.slots[next.i][next.side] = winner;
  else Object.assign(t, { winner, finished: now });
  return t;
}

// A new tournament: the entrants shuffled into bracket positions, with byes for
// the seeds past the count. Seed s meets seed N+1-s, and there are fewer byes
// than players, so a bye never meets a bye. A bye is decided at once and its
// player is already in round 2.
export function makeDraw({ id, name, entrants, opts, rounds = defaultRounds(entrants.length), now = Date.now() }, random = Math.random) {
  const shuffled = [...entrants];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const N = sizeFor(entrants.length);
  const at = seedOrder(N).map(seed => shuffled[seed - 1]?.id ?? BYE);
  const slots = [];
  for (let r = 0, count = N / 2; count >= 1; r++, count /= 2) {
    for (let j = 0; j < count; j++) {
      slots.push({ round: r, a: r ? null : at[2 * j], b: r ? null : at[2 * j + 1], match: null, winner: null, legs: null, how: null });
    }
  }
  let t = {
    id, seq: 0, name, created: now, finished: null, abandoned: false, winner: null,
    data: { opts: { start: opts.start, out: opts.out }, rounds, entrants: entrants.map(e => ({ ...e })), slots },
  };
  slots.forEach((s, i) => {
    if (s.a === BYE || s.b === BYE) t = decide(t, i, s.a === BYE ? s.b : s.a, null, 'bye', now);
  });
  return t;
}

// Undecided slots with both players known, in bracket order.
export const readySlots = t => t.data.slots.flatMap((s, i) =>
  s.winner == null && s.a != null && s.b != null && s.a !== BYE && s.b !== BYE ? [i] : []);

const botMatch = (t, isBot) => i => isBot(t.data.slots[i].a) && isBot(t.data.slots[i].b);

// Ready matches to play on the board, in bracket order: all but bot against bot.
export const boardSlots = (t, isBot) => readySlots(t).filter(i => !botMatch(t, isBot)(i));

// The next match to play on the board: the first of them.
export const nextSlot = (t, isBot) => boardSlots(t, isBot)[0] ?? null;

// Ready matches that are bot against bot, to be played out.
export const botSlots = (t, isBot) => readySlots(t).filter(botMatch(t, isBot));

// The saved match slot i was decided by, played or simulated: the one its scorecard
// shows. null for a bye, and for a match not yet won.
export function playedMatch(t, i) {
  const s = t.data.slots[i];
  return s.winner != null && s.how !== BYE ? s.match ?? null : null;
}

// Which results a device has shown moving on, and which it still has to, in bracket
// order. `was` is the list it keeps for this tournament: none yet (it is opening the
// tournament for the first time, part way through, say) and everything already
// decided counts as seen. A bye is never one, and a result taken back drops out.
export function seenResults(t, was) {
  const decided = t.data.slots.flatMap((s, i) => (s.winner != null && s.how !== BYE ? [i] : []));
  const seen = was == null ? decided : was.filter(i => decided.includes(i));
  return { seen, unseen: decided.filter(i => !seen.includes(i)) };
}

// Slot i's match has started: matchId is the saved match playing it.
export function startSlot(t, i, matchId) {
  const out = copy(t);
  out.data.slots[i].match = matchId;
  return out;
}

// Slot i's match was quit: the slot is ready to play again.
export function dropMatch(t, i) {
  const out = copy(t);
  out.data.slots[i].match = null;
  return out;
}

// Slot i is won by `winner` (a player id), with legs [a's, b's]; how is
// 'played' or 'simulated'. The final's winner wins the tournament.
export const recordResult = (t, i, winner, legs, how, now = Date.now()) => decide(copy(t), i, winner, legs, how, now);

// Takes slot i's result back (the winning dart undone): only while the match it
// fed hasn't started. Otherwise, or if there is no result to take back, the
// record comes back unchanged.
export function clearResult(t, i) {
  const slot = t.data.slots[i], next = nextOf(t, i);
  if (slot.winner == null || slot.how === BYE) return t;
  if (next && (t.data.slots[next.i].match != null || t.data.slots[next.i].winner != null)) return t;
  const out = copy(t);
  Object.assign(out.data.slots[i], { winner: null, legs: null, how: null });
  if (next) out.data.slots[next.i][next.side] = null;
  else Object.assign(out, { winner: null, finished: null });
  return out;
}

// The tournament of `list` that player `id` is still in: one neither finished nor
// abandoned that they were drawn into, or null. Knocked out or not: their matches are
// part of it, and it could not be saved without them.
export const stillIn = (list, id) => list.find(t => !t.finished && !t.abandoned && t.data.entrants.some(e => e.id === id)) ?? null;

// Fills in any slot whose saved match is won but whose result never reached the
// bracket (the app closed just after the winning dart). matchById gives the
// saved match, with its playerIds and bots, or null. The match is the truth.
export function reconcile(t, matchById, now = Date.now()) {
  let out = t;
  t.data.slots.forEach((slot, i) => {
    if (slot.match == null || slot.winner != null) return;
    const m = matchById(slot.match);
    if (!m?.playerIds) return;
    const s = compute(m);
    if (s.winner == null) return;
    // With sets at 1 the won state still holds each player's legs.
    const legs = [slot.a, slot.b].map(id => s.legs[m.playerIds.indexOf(id)] ?? 0);
    const how = m.bots?.length && m.bots.every(b => b != null) ? 'simulated' : 'played';
    out = recordResult(out, i, m.playerIds[s.winner], legs, how, now);
  });
  return out;
}

// Swaps player id `old` for `id` everywhere (a player made offline, once synced).
export function remapIds(t, old, id) {
  const swap = v => v === old ? id : v;
  return {
    ...t, winner: swap(t.winner),
    data: {
      ...t.data,
      entrants: t.data.entrants.map(e => e.id === old ? { ...e, id } : e),
      slots: t.data.slots.map(s => ({ ...s, a: swap(s.a), b: swap(s.b), winner: swap(s.winner) })),
    },
  };
}

// Slot i played out, bot against bot, dart by dart: a whole X01 match of that
// round's length between players `ids` (in throwing order) at `levels`. The
// caller gives it id, playerIds, bots and seq, and saves it like any match.
export function simulateMatch(t, i, ids, levels, random = Math.random) {
  const x01 = gameById('x01'), r = t.data.slots[i].round;
  const names = ids.map(id => t.data.entrants.find(e => e.id === id)?.name ?? '');
  const m = newMatch('x01', names, { ...t.data.opts, legs: t.data.rounds[r].legs, sets: 1, tournament: { id: t.id, slot: i } });
  const skills = levels.map(botLevel);
  for (let s = compute(m); s.winner == null; s = compute(m)) {
    m.log.push({ t: 'dart', ...x01.bot(s, skills[s.current], random), src: 'bot', ts: Date.now() });
  }
  return m;
}
