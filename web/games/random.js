// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// "Treble 16", "Single 16": a single is spelled out, since only that bed counts.
const name = t => (t.seg === 25 ? (t.mult === 2 ? 'Bull' : 'Outer bull (25)') : ['Single ', 'Double ', 'Treble '][t.mult - 1] + t.seg);

// Random Targets: like Around the Clock, but the app picks where to aim. Each
// go is one bed, shown lit up on the board, and up to three darts at it: hit
// it for a point and the go is over there and then; miss with all three and it
// is over too. So the score is out of the number of goes. Everyone gets the
// same targets in the same order, and the most points after the last go wins.

// The targets come from the match's own seed (engine.js puts one in the
// options of a `seeded` game), so replaying the log always gives the same ones.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Every bed that can come up: singles (and the 25) always, doubles (and the
// bull) and trebles if they are included.
function beds(opts) {
  const all = [];
  for (let seg = 1; seg <= 20; seg++) {
    all.push({ seg, mult: 1 });
    if (opts.doubles === 'yes') all.push({ seg, mult: 2 });
    if (opts.trebles === 'yes') all.push({ seg, mult: 3 });
  }
  all.push({ seg: 25, mult: 1 });
  if (opts.doubles === 'yes') all.push({ seg: 25, mult: 2 });
  return all;
}

export function targets(opts) {
  const pool = beds(opts), next = rng(opts.seed ?? 1), seq = [];
  while (seq.length < opts.goes) {
    const t = pool[Math.floor(next() * pool.length)];
    if (t !== seq.at(-1)) seq.push(t);  // never the same bed twice running
  }
  return seq;
}

function finish(s) {
  s.winner = s.hits.indexOf(Math.max(...s.hits));
}

export default {
  id: 'random',
  name: 'Random Targets',
  blurb: 'The board lights up a random target. Hit it within three darts for a point, then on to the next. Most points wins.',
  showTotal: false,  // the three-dart sum means nothing in this game
  seeded: true,
  options: [
    { key: 'doubles', label: 'Doubles', choices: [['yes', 'Include'], ['no', 'Leave out']], default: 'yes' },
    { key: 'trebles', label: 'Trebles', choices: [['yes', 'Include'], ['no', 'Leave out']], default: 'yes' },
    { key: 'goes', label: 'Goes', min: 5, max: 50, default: 20 },
  ],

  init(n, opts) {
    return { seq: targets(opts), hits: Array(n).fill(0), thrown: Array(n).fill(0) };
  },

  turnStart(s) { if (s.round > s.opts.goes) finish(s); },

  dart(s, d) {
    const p = s.current, t = s.seq[s.round - 1];
    s.thrown[p]++;
    const hit = d.seg === t.seg && d.mult === t.mult;
    if (hit) s.hits[p]++;
    const lastTurn = s.round === s.opts.goes && p === s.players.length - 1;
    if (lastTurn && (hit || s.turn.length === 3)) finish(s);
    else if (hit) s.turnOver = true;  // a point: the go is over, the next dart is at the next target
  },

  // The bed to light up on the board, while there is one to aim at. After a
  // hit that is already the next thrower's.
  target(s) {
    if (s.winner != null) return null;
    const round = s.round + (s.turnOver && s.current === s.players.length - 1 ? 1 : 0);
    return s.seq[Math.min(round, s.opts.goes) - 1];
  },

  summary(s, i) {
    const n = s.thrown[i];
    return { big: s.hits[i], small: n ? `${n} dart${n === 1 ? '' : 's'}` : '' };
  },

  panel(s) {
    return `<table class="cricket"><tr><td>Go</td><td>${Math.min(s.round, s.opts.goes)} / ${s.opts.goes}</td></tr></table>`;
  },

  hint(s) { return `Aim for ${name(this.target(s))}`; },

  // Alone there is nobody to beat: say how it went instead.
  result(s) {
    if (s.players.length > 1) return undefined;
    return `Hit ${s.hits[0]} of ${s.opts.goes} targets in ${s.thrown[0]} darts`;
  },
};
