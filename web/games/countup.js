// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import { value } from '../board.js';

function finish(s) {
  const best = Math.max(...s.total);
  s.winner = s.total.indexOf(best);
}

export default {
  id: 'countup',
  name: 'Count Up',
  blurb: 'Highest total after a set number of rounds. Good solo practice.',
  options: [
    { key: 'rounds', label: 'Rounds', choices: [[5, '5'], [8, '8'], [10, '10']], default: 8, brief: v => `${v} rounds` },
  ],

  init(n) { return { total: Array(n).fill(0) }; },

  turnStart(s) { if (s.round > s.opts.rounds) finish(s); },

  dart(s, d) {
    s.total[s.current] += value(d);
    const lastTurn = s.round === s.opts.rounds && s.current === s.players.length - 1;
    if (lastTurn && s.turn.length === 3) finish(s);
  },

  visit(s, total) {
    s.total[s.current] += total;
    if (s.round === s.opts.rounds && s.current === s.players.length - 1) finish(s);
  },

  summary(s, i) {
    return { big: s.total[i], small: `round ${Math.min(s.round, s.opts.rounds)}/${s.opts.rounds}` };
  },
};
