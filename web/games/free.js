// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import { value } from '../board.js';

// Free Mode: just throw. Every dart is called out, then the visit's total.
// Nothing is added up from one visit to the next, so there is no score to
// reach and no winner: it goes on until the game is quit.
export default {
  id: 'free',
  name: 'Free Mode',
  blurb: 'Just throw. Each dart is called out, then the total of the three. No running score and no end.',
  options: [],

  init(n) { return { visit: Array(n).fill(null) }; },  // each player's latest visit total

  dart(s, d) {
    const p = s.current;
    s.visit[p] = (s.turn.length === 1 ? 0 : s.visit[p]) + value(d);
  },

  summary(s, i) {
    if (s.visit[i] == null) return { big: '–', small: '' };
    return { big: s.visit[i], small: i === s.current && s.turn.length ? 'this visit' : 'last visit' };
  },
};
