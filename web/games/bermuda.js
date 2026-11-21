// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Bermuda. Thirteen rounds, each with its own target: 12, 13, 14, any double,
// 15, 16, 17, any treble, 18, 19, 20, the outer bull, then the bull. Every dart
// that hits the target adds what it scores; a visit with no hit at all halves
// your total (rounded down). Everyone keeps their own total, and the highest
// total after the last round wins.

import { value } from '../board.js';

export const ROUNDS = [12, 13, 14, 'D', 15, 16, 17, 'T', 18, 19, 20, 25, 50];

const hits = (t, d) =>
  t === 'D' ? d.mult === 2
  : t === 'T' ? d.mult === 3
  : t === 50 ? d.seg === 25 && d.mult === 2
  : d.seg === t;  // a number, or 25 for the outer or the bull

const said = t => (t === 'D' ? 'Any double' : t === 'T' ? 'Any treble' : t === 25 ? 'Outer bull' : t === 50 ? 'Bull' : String(t));
const shown = t => (t === 'D' ? 'Dbl' : t === 'T' ? 'Trb' : t === 25 ? 'Outer' : t === 50 ? 'Bull' : String(t));

function finish(s) {
  const best = Math.max(...s.total);
  s.winner = s.total.indexOf(best);
}

export default {
  id: 'bermuda',
  kind: 'training',
  name: 'Bermuda',
  blurb: 'Thirteen rounds, a new target each: 12 to 14, any double, 15 to 17, any treble, 18 to 20, then the bull. Hit it and score; a visit with no hit halves your total.',
  showTotal: false,  // the three-dart sum includes darts that did not score
  options: [],

  init(n) { return { total: Array(n).fill(0), halved: Array(n).fill(0) }; },

  turnStart(s) { if (s.round > ROUNDS.length) finish(s); },

  dart(s, d) {
    const p = s.current, t = ROUNDS[s.round - 1];
    if (hits(t, d)) s.total[p] += value(d);
    if (s.turn.length < 3) return;
    // The third dart ends the visit ("Next" fills in the misses first).
    if (!s.turn.some(x => hits(t, x))) {
      s.total[p] = Math.floor(s.total[p] / 2);
      s.halved[p]++;
    }
    if (s.round === ROUNDS.length && p === s.players.length - 1) finish(s);
  },

  summary(s, i) {
    return { big: s.total[i], small: `round ${Math.min(s.round, ROUNDS.length)}/${ROUNDS.length}` };
  },

  result(s) {
    const w = s.winner;
    return s.players.length > 1 ? `${s.players[w]} wins with ${s.total[w]}.` : `You finished on ${s.total[w]}.`;
  },

  // The bed to light up: the number or the bull. Doubles and trebles can be anywhere.
  target(s) {
    if (s.winner != null) return null;
    const t = ROUNDS[s.round - 1];
    if (t === 'D' || t === 'T') return null;
    return t === 25 ? { seg: 25, mult: 1 } : t === 50 ? { seg: 25, mult: 2 } : { seg: t, mult: 1 };
  },

  aim(s) { return s.winner == null ? said(ROUNDS[s.round - 1]) : ''; },

  panel(s) {
    const r = Math.min(s.round, ROUNDS.length);
    const cells = ROUNDS.map((t, i) => `<th${i + 1 === r && s.winner == null ? ' class="cur"' : ''}>${shown(t)}</th>`);
    return `<table class="cricket"><tr>${cells.slice(0, 7).join('')}</tr><tr>${cells.slice(7).join('')}</tr></table>`;
  },

  hint(s) { return s.turnOver || s.winner != null ? '' : `Aim for ${said(ROUNDS[s.round - 1]).toLowerCase()}; a visit with no hit halves your total`; },
};
