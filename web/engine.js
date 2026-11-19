// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Match engine. A match is just {gameId, players, opts, log}; the current
// state is always recomputed by replaying the log, which makes undo trivial
// (drop the last entry) and keeps every game a small pure module.
//
// Log entries:  {t:'dart', seg, mult, x?, y?, ts?, src?}   or   {t:'next'}
//               ('next' before the third dart counts the rest as misses; play
//               moves on by itself after the third, so a 'next' straight after
//               that does nothing)
//          or   {t:'visit', total, darts?}   a whole visit typed in as one
//               number (games with visit() only); darts is how many it took,
//               which only differs from 3 on a finish.
//
// compute() also returns `throws`: one record per dart saying who threw it and
// in which round. That list is what the Pi stores for stats. A typed visit is
// stored as src 'visit': the first record carries the whole total and the rest
// score nothing, so the visit still adds up and counts the right number of
// darts. The Pi leaves those records out of per-dart stats.
//
// A game module provides:
//   id, name, blurb, options[]
//   init(playerCount, opts)   -> game-specific state fields
//   dart(state, dart)         -> mutate state for one dart
//   visit?(state, total, n)   -> optional: mutate state for a typed visit total
//   visitDarts?(state, total) -> optional: null if total isn't a finish, else
//                                the dart counts it could have taken ([] = can't)
//   turnStart?(state)         -> called when a new player's turn begins
//   summary(state, i)         -> {big, small} for player i's scoreboard card
//   panel?(state)             -> optional extra HTML (e.g. cricket marks)
//   hint?(state, {checkouts}) -> optional one-line tip for the current player;
//                                checkouts: false leaves out the checkout route
//   result?(state)            -> optional end-of-game line, for games with no real winner
//   out?(state, i)            -> optional: true if player i's turn is passed over
//   call?(state)              -> optional: something to say after the last dart
//   target?(state)            -> optional: the bed {seg, mult, part?} to light up on the board
//   aim?(state)               -> optional: that bed as the caller says it, called out when it changes
//                                and at the start of each visit; needs no target()
//   seeded                    -> optional: true to be given opts.seed (a random number)
//   bot?(state, skill, random) -> optional: the dart {seg, mult, x, y} a computer player of that
//                                skill throws now (see bot.js). A game with one can be played
//                                against the computer; the app enters the dart as src 'bot'.
//   summary() may also return out: true, to grey out a player's card
//
// A match of several legs (X01): when a dart or visit wins a leg but not the
// match, the game resets its own scores and sets state.newLeg = {starter, set}:
// who throws first in the next leg, and whether the leg also won a set. Play
// moves straight on to that player, and state.legWon says what just happened.
import { GAMES } from './games/index.js';
import { value } from './board.js';

export const gameById = id => GAMES.find(g => g.id === id);

export function newMatch(gameId, players, opts) {
  // A game that picks things at random gets a seed to pick them from, kept
  // with the match so that replaying the log always comes out the same.
  if (gameById(gameId)?.seeded && opts.seed == null) opts = { ...opts, seed: Math.floor(Math.random() * 2 ** 32) };
  return { gameId, players, opts, log: [], started: Date.now() };
}

// How long the match has been going, in ms. Once it is won the clock stops at
// the winning dart, so undoing that dart sets it running again.
export function elapsed(match, s = compute(match), now = Date.now()) {
  const end = s.winner != null ? match.log.at(-1)?.ts ?? now : now;
  return Math.max(0, end - match.started);
}

// 65000 -> "1:05", 3723000 -> "1:02:03"
export function clock(ms) {
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60;
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// A length of time added up over many games: 2700000 -> "45 min", 12000000 -> "3 h 20 min"
export function timeSpent(ms) {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h ? `${h.toLocaleString()} h ${m % 60} min` : m ? `${m} min` : 'under a minute';
}

// The visit before the one being thrown now: {player, darts, bust, typed}, or
// null if there hasn't been one. darts are that visit's records from s.throws;
// typed means it was entered as one number, so there are no single darts.
export function previousVisit(s) {
  const done = s.throws.slice(0, s.throws.length - s.turn.length);
  const last = done.at(-1);
  if (!last) return null;
  let i = done.length;
  while (i > 0 && done[i - 1].player === last.player && done[i - 1].round === last.round) i--;
  return { player: last.player, darts: done.slice(i), bust: last.bust, typed: last.src === 'visit' };
}

// Who throws after the current player. Games where players drop out (Killer)
// say who with out(), and those are passed over.
export function nextPlayer(game, s) {
  const n = s.players.length;
  let i = s.current;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (!game.out?.(s, i)) break;
  }
  return i;
}

function advance(game, s) {
  if (s.newLeg) {
    // A new leg: the game says who starts it. Always a new round, so that a
    // player and a round still pick out one visit even if the winner starts.
    s.current = s.newLeg.starter;
    s.round++;
    s.newLeg = null;
  } else {
    const next = nextPlayer(game, s);
    if (next <= s.current) s.round++;  // back round to the top of the order
    s.current = next;
  }
  s.turn = [];
  s.turnOver = false;
  s.note = '';
  game.turnStart?.(s);
}

// One dart for the current player. Returns true if play has moved on to the
// next player: the dart went bust, or it was the third of the visit.
function throwDart(game, s, ev) {
  s.turn.push(ev);
  s.throws.push({
    player: s.current, round: s.round, seg: ev.seg, mult: ev.mult,
    x: ev.x ?? null, y: ev.y ?? null, src: ev.src ?? null, ts: ev.ts ?? null, bust: false,
  });
  game.dart(s, ev);
  if (s.note === 'BUST') {
    // A bust ends the visit there and then: play moves straight on rather
    // than waiting for the remaining darts or a takeout.
    for (const t of s.throws.slice(-s.turn.length)) t.bust = true;
    const who = s.current;
    advance(game, s);
    s.bust = who;
    return true;
  }
  if (s.newLeg && s.winner == null) {
    // The leg is won but not the match: straight on to whoever starts the
    // next leg. The winning darts stay on show as the last visit.
    const who = s.current, darts = s.turn, set = s.newLeg.set;
    advance(game, s);
    s.legWon = { player: who, set };
    s.lastVisit = { player: who, total: darts.reduce((t, d) => t + value(d), 0), darts, auto: true };
    return true;
  }
  if (s.turn.length >= 3 && s.winner == null) {
    // Third dart: straight on to the next player, no need to press anything.
    const who = s.current, darts = s.turn;
    advance(game, s);
    s.lastVisit = { player: who, total: darts.reduce((t, d) => t + value(d), 0), darts, auto: true };
    return true;
  }
  return false;
}

export function compute(match) {
  const game = gameById(match.gameId);
  const s = {
    players: match.players, opts: match.opts,
    current: 0, round: 1, turn: [], turnOver: false, winner: null, note: '', throws: [],
    bust: null,  // who just went bust, while that is still the last thing that happened
    // {player, total} of a typed visit, or {player, total, darts, auto} of three
    // darts, while that is still the last thing. auto: play moved on by itself.
    lastVisit: null,
    newLeg: null,  // set by the game when a leg is won: {starter, set}
    legWon: null,  // {player, set} while winning a leg is still the last thing that happened
    ...game.init(match.players.length, match.opts),
  };
  game.turnStart?.(s);
  for (const ev of match.log) {
    if (s.winner != null) break;
    const movedOn = s.lastVisit?.auto;
    s.bust = null;
    s.lastVisit = null;
    s.legWon = null;
    if (ev.t === 'next') {
      if (movedOn) continue;  // the third dart already moved play on
      // Moving on early: any darts not entered count as misses, so the visit
      // is still three darts and scores nothing for the ones left out.
      let moved = false;
      while (!moved && !s.turnOver && s.winner == null && s.turn.length < 3) {
        moved = throwDart(game, s, { t: 'dart', seg: 0, mult: 0, src: 'miss', ts: ev.ts });
      }
      if (!moved && s.winner == null) advance(game, s);
      if (s.lastVisit) s.lastVisit.auto = false;  // asked for: another 'next' skips a player
      continue;
    }
    if (s.turnOver) advance(game, s);
    if (s.winner != null) break;
    if (ev.t === 'visit') {
      // Only at the start of a visit: a total can't be mixed with single darts.
      if (!game.visit || s.turn.length) continue;
      const n = ev.darts ?? 3, who = s.current, first = s.throws.length;
      for (let i = 0; i < n; i++) s.throws.push({
        player: who, round: s.round, seg: i ? 0 : ev.total, mult: i ? 0 : 1,
        x: null, y: null, src: 'visit', ts: ev.ts ?? null, bust: false,
      });
      game.visit(s, ev.total, n);
      if (s.note === 'BUST') for (const t of s.throws.slice(first)) t.bust = true;
      const bust = s.note === 'BUST', leg = s.winner == null && s.newLeg;
      if (s.winner == null) advance(game, s);  // nothing to pull: straight on
      if (bust) s.bust = who; else s.lastVisit = { player: who, total: ev.total };
      if (leg) s.legWon = { player: who, set: leg.set };
      continue;
    }
    throwDart(game, s, ev);
  }
  return s;
}
