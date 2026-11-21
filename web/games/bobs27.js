// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Bob's 27, the doubles practice game. Start on 27 and take one visit at each
// double in turn, D1 up to D20 and then the bull. Every double you hit adds its
// value; a visit that hits none takes that double's value away. Each player has
// their own score, double and fate. The best score wins.

const name = t => (t === 25 ? 'Bull' : `Double ${t}`);
const short = t => (t === 25 ? 'Bull' : `D${t}`);
const last = s => (s.opts.bull === 'no' ? 20 : 25);

export default {
  id: 'bobs27',
  kind: 'training',
  name: "Bob's 27",
  blurb: 'Start on 27 and work round the doubles, one visit each. Hit a double and its value is added; miss all three darts and it is taken away.',
  showTotal: false,  // the three-dart sum means nothing in this game
  options: [
    { key: 'bull', label: 'Finish on the bull', choices: [['yes', 'Yes'], ['no', 'No, stop at D20']], default: 'yes', brief: v => v === 'no' ? 'Stop at D20' : 'Finish on the bull',
      help: v => v === 'no' ? 'The game ends with the visit at double 20.'
        : 'After double 20 there is one more visit, at the bull: 50 for each dart in it, and 50 off if all three miss.' },
    { key: 'zero', label: 'At zero', choices: [['stop', 'Out of the game'], ['on', 'Play on']], default: 'stop', brief: v => v === 'on' ? 'Play on at zero' : 'Out at zero',
      help: v => v === 'on' ? 'Your score can go below zero, and you carry on to the last double.'
        : 'Fall to zero or below and you are out of the game.' },
  ],

  init(n) {
    // end: null while playing, then 'out' (fell to zero) or 'done' (past the last double)
    return { score: Array(n).fill(27), target: Array(n).fill(1), hits: Array(n).fill(0), end: Array(n).fill(null) };
  },

  out(s, i) { return s.end[i] != null; },

  dart(s, d) {
    const p = s.current, t = s.target[p];
    const hit = d.mult === 2 && d.seg === t;
    if (hit) { s.score[p] += d.seg * 2; s.hits[p]++; }
    if (s.turn.length < 3) return;
    // The third dart ends the visit ("Next" fills in the misses first).
    if (!s.turn.some(x => x.mult === 2 && x.seg === t)) {
      s.score[p] -= t * 2;
      if (s.opts.zero !== 'on' && s.score[p] <= 0) s.end[p] = 'out';
    }
    if (s.end[p] == null) {
      if (t >= last(s)) s.end[p] = 'done';
      else s.target[p] = t === 20 ? 25 : t + 1;
    }
    if (s.end.every(e => e != null)) {
      const best = Math.max(...s.score);
      s.winner = s.score.indexOf(best);
    }
  },

  summary(s, i) {
    const e = s.end[i];
    return { big: s.score[i], small: e === 'out' ? `out at ${short(s.target[i])}` : e === 'done' ? 'done' : short(s.target[i]), out: e === 'out' };
  },

  result(s) {
    const w = s.winner;
    return s.players.length > 1 ? `${s.players[w]} wins with ${s.score[w]}.` : `You finished on ${s.score[w]}.`;
  },

  target(s) {
    return s.winner == null && s.end[s.current] == null ? { seg: s.target[s.current], mult: 2 } : null;
  },

  aim(s) { return s.winner == null && s.end[s.current] == null ? name(s.target[s.current]) : ''; },

  hint(s) { return s.turnOver || s.winner != null ? '' : `Aim for ${name(s.target[s.current])}`; },
};
