// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Shanghai. In round 1 only the 1s score, in round 2 only the 2s, and so on up
// the board. Everyone throws one visit a round and keeps their own total. Put a
// single, a double and a treble of the round's number in one visit (a Shanghai)
// and you win on the spot; otherwise the highest total after the last round wins.

import { value } from '../board.js';

const rounds = s => s.opts.rounds ?? 7;  // the app always sends the options; a bare {} gets the default

function finish(s) {
  const best = Math.max(...s.total);
  s.winner = s.total.indexOf(best);
}

export default {
  id: 'shanghai',
  kind: 'training',
  name: 'Shanghai',
  blurb: 'One number a round, 1 upwards: only that number scores. A single, double and treble of it in one visit wins on the spot.',
  showTotal: false,  // the three-dart sum includes darts that did not score
  options: [
    { key: 'rounds', label: 'Rounds', choices: [[7, '7'], [10, '10'], [20, '20']], default: 7, brief: v => `${v} rounds` },
    { key: 'shanghai', label: 'A Shanghai wins', choices: [['yes', 'Yes'], ['no', 'No, just points']], default: 'yes', brief: v => v === 'no' ? 'Points only' : 'Shanghai wins' },
  ],

  init(n) { return { total: Array(n).fill(0), shanghais: Array(n).fill(0) }; },

  turnStart(s) { if (s.round > rounds(s)) finish(s); },

  dart(s, d) {
    const p = s.current;
    if (d.seg === s.round) s.total[p] += value(d);
    if (s.turn.length < 3) return;
    // The third dart ends the visit ("Next" fills in the misses first).
    const n = s.round;
    if ([1, 2, 3].every(m => s.turn.some(x => x.seg === n && x.mult === m))) {
      s.shanghais[p]++;
      if (s.opts.shanghai !== 'no') { s.winner = p; return; }
    }
    if (n === rounds(s) && p === s.players.length - 1) finish(s);
  },

  summary(s, i) {
    return { big: s.total[i], small: `round ${Math.min(s.round, rounds(s))}/${rounds(s)}` };
  },

  result(s) {
    const w = s.winner, t = s.total[w];
    // with the rule on, a Shanghai ends the game on the spot, so one for the winner is how it ended
    const shanghai = s.shanghais[w] && s.opts.shanghai !== 'no';
    if (s.players.length > 1) return shanghai ? `Shanghai! ${s.players[w]} wins` : `${s.players[w]} wins with ${t}.`;
    return shanghai ? `Shanghai! You finished on ${t}.` : `You finished on ${t}.`;
  },

  target(s) { return s.winner == null ? { seg: s.round, mult: 1 } : null; },

  aim(s) { return s.winner == null ? String(s.round) : ''; },

  hint(s) { return s.turnOver || s.winner != null ? '' : `Only the ${s.round}s score this round`; },
};
