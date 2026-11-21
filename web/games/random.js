// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import { half, rng } from '../board.js';

// "Treble 16", "Single 16": a single is spelled out, since only that bed
// counts. In hard mode a single is one half of it: "Inner 16", "Outer 16".
const single = t => (t.part === 'in' ? 'Inner ' : t.part === 'out' ? 'Outer ' : 'Single ');
const bed = t => [single(t), 'Double ', 'Treble '][t.mult - 1] + t.seg;
const name = t => (t.seg === 25 ? (t.mult === 2 ? 'Bull' : 'Outer bull (25)') : bed(t));
const said = t => (t.seg === 25 ? (t.mult === 2 ? 'Bullseye' : 'Outer bull') : bed(t));  // as the caller says it

// Random Targets: like Around the Clock, but the app picks where to aim. The
// bed to aim at is lit up on the board. A go is a visit of three darts: hit the
// bed for a point and the next dart is at a new one, so a good visit takes
// three targets. Every visit starts on a new bed, so the next thrower never
// carries on at the bed the last one was left on. The most points after the
// last go wins.

// Every bed that can come up: singles (and the 25) always, doubles (and the
// bull) and trebles if they are included. In hard mode the two halves of a
// single, inside and outside the treble ring, are beds of their own.
function beds(opts) {
  const all = [];
  for (let seg = 1; seg <= 20; seg++) {
    if (opts.hard === 'yes') all.push({ seg, mult: 1, part: 'in' }, { seg, mult: 1, part: 'out' });
    else all.push({ seg, mult: 1 });
    if (opts.doubles === 'yes') all.push({ seg, mult: 2 });
    if (opts.trebles === 'yes') all.push({ seg, mult: 3 });
  }
  all.push({ seg: 25, mult: 1 });
  if (opts.doubles === 'yes') all.push({ seg: 25, mult: 2 });
  return all;
}

// Three beds for every visit (each player's turn in every go): the one it
// starts on and the ones after a first and a second hit. A bed is never one of
// the three before it, so whichever of a visit's beds a player got to, the
// next thrower is given a different bed.
// They come from the match's own seed (engine.js puts one in the options of
// a `seeded` game), so replaying the log always gives the same ones.
const PER_GO = 3;
export function targets(opts, players = 1) {
  const pool = beds(opts), next = rng(opts.seed ?? 1), seq = [];
  while (seq.length < opts.goes * players * PER_GO) {
    const t = pool[Math.floor(next() * pool.length)];
    if (!seq.slice(-PER_GO).includes(t)) seq.push(t);
  }
  return seq;
}

// Did the dart land in the bed? In hard mode it has to be the right half of
// the single too; a dart entered with no position gets the benefit of the doubt.
export function hits(d, t) {
  if (d.seg !== t.seg || d.mult !== t.mult) return false;
  return !t.part || (half(d) ?? t.part) === t.part;
}

function finish(s) {
  s.winner = s.hits.indexOf(Math.max(...s.hits));
}

export default {
  id: 'random',
  kind: 'training',
  name: 'Random Targets',
  blurb: 'The board lights up a random target. Hit it for a point and your next dart is at a new one, so a good visit takes three. Hard mode splits each single into its inner and outer half. Most points wins.',
  showTotal: false,  // the three-dart sum means nothing in this game
  seeded: true,
  options: [
    { key: 'doubles', label: 'Doubles', choices: [['yes', 'Include'], ['no', 'Leave out']], default: 'yes', brief: v => v === 'no' ? 'No doubles' : '',
      help: v => v === 'no' ? 'No double comes up as a target, and nor does the bull itself: only the outer bull.' : 'Doubles come up among the targets, and the bull with them.' },
    { key: 'trebles', label: 'Trebles', choices: [['yes', 'Include'], ['no', 'Leave out']], default: 'yes', brief: v => v === 'no' ? 'No trebles' : '',
      help: v => v === 'no' ? 'No treble comes up as a target.' : 'Trebles come up among the targets.' },
    { key: 'hard', label: 'Hard mode', choices: [['no', 'Off'], ['yes', 'Inner & outer singles']], default: 'no', brief: v => v === 'yes' ? 'Hard mode' : '',
      help: v => v === 'yes' ? 'Each single is split in two: the inner single, between the bull and the treble ring, and the outer single, between the treble and double rings. Only the half called counts.'
        : 'A single counts anywhere in its number, inside the treble ring or outside it.' },
    { key: 'goes', label: 'Goes', min: 5, max: 50, default: 20, brief: v => `${v} goes`,
      help: v => `${v} visits each. The most points after the last one wins.` },
  ],

  init(n, opts) {
    return { seq: targets(opts, n), hits: Array(n).fill(0), thrown: Array(n).fill(0), got: 0 };
  },

  // got: how many targets this visit has hit so far.
  turnStart(s) {
    s.got = 0;
    if (s.round > s.opts.goes) finish(s);
  },

  dart(s, d) {
    const p = s.current;
    s.thrown[p]++;
    if (hits(d, this.target(s))) { s.hits[p]++; s.got++; }  // a point, and the next dart is at a new bed
    const lastTurn = s.round === s.opts.goes && p === s.players.length - 1;
    if (lastTurn && s.turn.length === 3) finish(s);
  },

  // The bed to light up on the board, while there is one to aim at.
  target(s) {
    if (s.winner != null || s.round > s.opts.goes) return null;
    const visit = (s.round - 1) * s.players.length + s.current;
    return s.seq[visit * PER_GO + Math.min(s.got, PER_GO - 1)];
  },

  // The same, as the caller says it when it changes: "Treble 16", "Inner 9".
  aim(s) { const t = this.target(s); return t ? said(t) : ''; },

  summary(s, i) {
    const n = s.thrown[i];
    return { big: s.hits[i], small: n ? `${n} dart${n === 1 ? '' : 's'}` : '' };
  },

  panel(s) {
    return `<table class="cricket"><tr><td>Go</td><td>${Math.min(s.round, s.opts.goes)} / ${s.opts.goes}</td></tr></table>`;
  },

  hint(s) { const t = this.target(s); return t ? `Aim for ${name(t)}` : ''; },

  // Alone there is nobody to beat: say how it went instead.
  result(s) {
    if (s.players.length > 1) return undefined;
    return `Hit ${s.hits[0]} target${s.hits[0] === 1 ? '' : 's'} in ${s.thrown[0]} darts`;
  },
};
