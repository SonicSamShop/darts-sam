// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import { value } from '../board.js';

// Gotcha: everyone counts up from nothing towards the target. Land on exactly
// the score someone else has and they are sent back to zero. Go past the
// target and the visit is a bust: you are back where the visit began. Reach
// the target exactly to win.

const target = s => s.opts.target ?? 301;

export default {
  id: 'gotcha',
  kind: 'match',
  name: 'Gotcha',
  minPlayers: 2,
  blurb: 'Count up from zero to exactly 301 or 501. Land on another player\'s score and they go back to zero. Go over and the visit is a bust.',
  options: [
    { key: 'target', label: 'Target', choices: [[301, '301'], [501, '501']], default: 301, brief: v => `to ${v}` },
  ],

  init(n) { return { score: Array(n).fill(0), visitStart: 0, event: '' }; },

  turnStart(s) { s.visitStart = s.score[s.current]; },

  dart(s, d) {
    const p = s.current, v = value(d);
    s.event = '';
    if (s.score[p] + v > target(s)) {
      s.score[p] = s.visitStart;
      s.note = 'BUST';
      s.turnOver = true;
      return;
    }
    s.score[p] += v;
    if (s.score[p] === target(s)) { s.winner = p; return; }
    if (!v) return;  // a miss matches nobody, even another player on nothing
    const sent = s.players.map((_, i) => i).filter(i => i !== p && s.score[i] === s.score[p]);
    for (const i of sent) s.score[i] = 0;
    if (sent.length) s.event = `Gotcha! ${sent.map(i => s.players[i]).join(' and ')} back to zero`;
  },

  summary(s, i) {
    return { big: s.score[i], small: `${target(s) - s.score[i]} to go` };
  },

  call(s) { return s.event; },

  hint(s) {
    const left = target(s) - s.score[s.current];
    const hits = s.players.map((n, i) => i !== s.current && s.score[i] > s.score[s.current] ? [s.score[i] - s.score[s.current], n] : null)
      .filter(Boolean).filter(([need]) => need <= 60).sort((a, b) => a[0] - b[0]);
    const tip = hits.length ? `${hits[0][0]} sends ${hits[0][1]} back to zero` : '';
    return [`${left} to go`, tip].filter(Boolean).join(' · ');
  },
};
