// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

const name = t => (t === 25 ? 'Bull' : String(t));
const RING = { double: 2, treble: 3 };
// What to aim at: with Round the World the ring too ("Double 5"); the bull is the bull.
const aimAt = (s, t) => (t === 25 || !RING[s.opts.hit] ? name(t) : `${s.opts.hit === 'double' ? 'Double' : 'Treble'} ${t}`);

export default {
  id: 'clock',
  kind: 'training',
  name: 'Around the Clock',
  blurb: 'Hit 1 through 20 in order, then the bull. First to finish wins. Choose doubles only or trebles only for Round the World.',
  showTotal: false,  // the three-dart sum means nothing in this game
  options: [
    { key: 'skip', label: 'Doubles & trebles', choices: [['no', 'Count as one'], ['yes', 'Jump ahead 2 / 3']], default: 'no', brief: (v, o) => o?.hit === 'double' || o?.hit === 'treble' ? '' : v === 'yes' ? 'Doubles & trebles jump ahead' : 'Doubles & trebles count as one' },
    { key: 'hit', label: 'What counts', choices: [['any', 'Any part'], ['double', 'Doubles only'], ['treble', 'Trebles only']], default: 'any', brief: v => v === 'double' ? 'Doubles only' : v === 'treble' ? 'Trebles only' : '' },
  ],

  init(n) {
    return { target: Array(n).fill(1), hits: Array(n).fill(0), thrown: Array(n).fill(0) };
  },

  dart(s, d) {
    const p = s.current;
    s.thrown[p]++;
    if (!d.mult || d.seg !== s.target[p]) return;
    // Round the World: on 1-20 only the chosen ring counts (the final bull takes any part).
    const hit = s.opts.hit || 'any';
    if (d.seg !== 25 && hit !== 'any' && d.mult !== (hit === 'double' ? 2 : 3)) return;
    s.hits[p]++;
    if (d.seg === 25) { s.winner = p; return; }
    const step = hit === 'any' && s.opts.skip === 'yes' ? d.mult : 1;
    s.target[p] = s.target[p] + step > 20 ? 25 : s.target[p] + step;
  },

  summary(s, i) {
    const n = s.thrown[i];
    const rate = n ? `${Math.round(s.hits[i] / n * 100)}% hit · ${n} dart${n === 1 ? '' : 's'}` : '';
    return { big: s.winner === i ? '✓' : s.target[i] !== 25 && RING[s.opts.hit] ? `${s.opts.hit === 'double' ? 'D' : 'T'}${s.target[i]}` : name(s.target[i]), small: rate };
  },

  // The number needed, as the caller says it at the start of each visit and
  // after each hit.
  aim(s) { return s.winner == null ? aimAt(s, s.target[s.current]) : ''; },

  hint(s) { return s.turnOver ? '' : `Aim for ${aimAt(s, s.target[s.current])}`; },

  // Round the World lights the ring to hit; any part of the number lights nothing extra.
  target(s) {
    const t = s.target[s.current], m = RING[s.opts.hit];
    if (s.winner != null || !m) return null;
    return t === 25 ? { seg: 25, mult: 1 } : { seg: t, mult: m };
  },
};
