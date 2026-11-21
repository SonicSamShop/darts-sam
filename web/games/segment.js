// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Segment Training. Pick one bed of the board and throw at it for a set number
// of darts. A dart in that bed scores its multiplier (1, 2 or 3), or only the
// doubles or only the trebles of it, if you chose that. Everyone throws the same
// number of darts and the most points wins.

const MULT = { single: 1, double: 2, treble: 3 };
const WORD = { any: '', single: 'single ', double: 'double ', treble: 'treble ' };
const bed = n => (n === 25 ? 'bull' : String(n));

// The bull has no treble: on the bull "Trebles" means the inner bull (the double ring).
const ring = s => (s.opts.seg === 25 && s.opts.counts === 'treble' ? 2 : MULT[s.opts.counts]);
const word = s => (s.opts.seg === 25 && s.opts.counts === 'treble' ? '' : WORD[s.opts.counts] ?? '');
const counts = (s, d) => d.seg === s.opts.seg && d.mult > 0 && (s.opts.counts === 'any' || ring(s) === d.mult);
const darts = s => s.opts.darts ?? 60;  // the app always sends the options; a bare {} gets the default

function finish(s) {
  const best = Math.max(...s.points);
  s.winner = s.points.indexOf(best);
}

export default {
  id: 'segment',
  kind: 'training',
  name: 'Segment Training',
  blurb: 'Pick one bed and throw at it for a set number of darts. Every dart in it scores 1, 2 or 3 by its ring.',
  showTotal: false,  // the three-dart sum includes darts that did not score
  options: [
    { key: 'seg', label: 'Bed', choices: [...Array(20)].map((_, i) => [i + 1, String(i + 1)]).concat([[25, 'Bull']]), default: 20, brief: v => `Bed: ${v === 25 ? 'bull' : v}`,
      help: v => `Every dart is thrown at ${v === 25 ? 'the bull' : `the ${v}`}. Nothing else on the board scores.` },
    { key: 'counts', label: 'Counts', choices: [['any', 'Any ring'], ['single', 'Singles'], ['double', 'Doubles'], ['treble', 'Trebles']], default: 'any', brief: v => v === 'any' ? '' : `${v[0].toUpperCase()}${v.slice(1)}s only`,
      help: (v, o) => (o?.seg === 25
        ? { any: 'The outer bull scores 1 and the bull 2.', single: 'Only the outer bull scores, 1 a dart.', double: 'Only the bull itself scores, 2 a dart.',
            treble: 'The bull has no treble, so only the bull itself scores, 2 a dart.' }
        : { any: 'A single scores 1, a double 2 and a treble 3.', single: 'Only the single scores, 1 a dart.', double: 'Only the double scores, 2 a dart.',
            treble: 'Only the treble scores, 3 a dart.' })[v] },
    { key: 'darts', label: 'Darts each', choices: [[30, '30'], [60, '60'], [99, '99']], default: 60, brief: v => `${v} darts`,
      help: v => `Everyone throws ${v} darts, which is ${v / 3} visits.` },
  ],

  init(n) { return { points: Array(n).fill(0), hits: Array(n).fill(0), thrown: Array(n).fill(0) }; },

  dart(s, d) {
    const p = s.current;
    s.thrown[p]++;
    if (counts(s, d)) { s.hits[p]++; s.points[p] += d.mult; }
    if (p === s.players.length - 1 && s.thrown[p] >= darts(s)) finish(s);
  },

  summary(s, i) {
    const n = s.thrown[i];
    return { big: s.points[i], small: `${s.hits[i]} of ${n} hit${n ? ` · ${Math.round(s.hits[i] / n * 100)}%` : ''}` };
  },

  result(s) {
    const w = s.winner;
    return s.players.length > 1 ? `${s.players[w]} wins with ${s.points[w]}.` : `You scored ${s.points[w]}.`;
  },

  // The bed to light up, with its ring when only one ring counts.
  target(s) {
    if (s.winner != null) return null;
    return { seg: s.opts.seg, mult: ring(s) ?? 1 };
  },

  aim(s) { return s.winner == null ? `${word(s)}${bed(s.opts.seg)}` : ''; },

  hint(s) {
    if (s.turnOver || s.winner != null) return '';
    const left = darts(s) - s.thrown[s.current];
    return `${left} dart${left === 1 ? '' : 's'} left on ${word(s)}${bed(s.opts.seg)}`;
  },
};
