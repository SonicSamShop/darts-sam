// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

const name = t => (t === 25 ? 'Bull' : String(t));

export default {
  id: 'clock',
  name: 'Around the Clock',
  blurb: 'Hit 1 through 20 in order, then the bull. First to finish wins.',
  showTotal: false,  // the three-dart sum means nothing in this game
  options: [
    { key: 'skip', label: 'Doubles & trebles', choices: [['no', 'Count as one'], ['yes', 'Jump ahead 2 / 3']], default: 'no' },
  ],

  init(n) {
    return { target: Array(n).fill(1), hits: Array(n).fill(0), thrown: Array(n).fill(0) };
  },

  dart(s, d) {
    const p = s.current;
    s.thrown[p]++;
    if (!d.mult || d.seg !== s.target[p]) return;
    s.hits[p]++;
    if (d.seg === 25) { s.winner = p; return; }
    const step = s.opts.skip === 'yes' ? d.mult : 1;
    s.target[p] = s.target[p] + step > 20 ? 25 : s.target[p] + step;
  },

  summary(s, i) {
    const n = s.thrown[i];
    const rate = n ? `${Math.round(s.hits[i] / n * 100)}% hit · ${n} dart${n === 1 ? '' : 's'}` : '';
    return { big: s.winner === i ? '✓' : name(s.target[i]), small: rate };
  },

  hint(s) { return s.turnOver ? '' : `Aim for ${name(s.target[s.current])}`; },
};
