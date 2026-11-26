// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import { label, rng, value } from '../board.js';
import { checkout } from './x01.js';

const esc = t => String(t).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

// Random Checkout. The app picks a list of finishes and everyone works down
// the same list, each at their own pace: check the score out (double out)
// within the darts allowed and it counts, then on to the next one either way.
// A bust puts the score back to where the visit started and uses the visit up,
// as in 121. The most checkouts wins; level on those, the fewer darts it took.

const RANGES = { low: [2, 40], mid: [41, 100], high: [101, 170], all: [2, 170] };
const SPAN = r => RANGES[r].join('–');  // "41–100"

// The list of targets: scores in the range that three darts can check out,
// picked from the match's seed (engine.js puts one in the options of a
// `seeded` game) so that replaying the log always gives the same ones. The
// same score never comes up twice running. server/db.py (_rc_targets) makes
// the same list from the same seed for the stats, so change both together.
export function targets(seed, range, count) {
  const [lo, hi] = RANGES[range] ?? RANGES.low;
  const pool = [];
  for (let t = lo; t <= hi; t++) if (checkout(t, 3, true)) pool.push(t);
  const next = rng(seed), list = [];
  while (list.length < count) {
    const t = pool[Math.floor(next() * pool.length)];
    if (t !== list.at(-1)) list.push(t);
  }
  return list;
}

// The current player's attempt at their target has just ended, checked out or not.
function settle(s, ok) {
  const p = s.current;
  s.tried[p]++;
  if (ok) { s.made[p]++; s.dartsMade[p] += s.used[p]; }
  s.last[p] = { target: s.target[p], ok, darts: s.used[p] };
  s.target[p] = s.left[p] = s.list[s.tried[p]] ?? 0;
  s.used[p] = 0;
  // Over once everyone has had every target. The most checkouts wins, then
  // the fewest darts at them, then whoever threw first.
  if (s.tried.every(n => n >= s.opts.count)) {
    const better = (i, j) => s.made[i] > s.made[j] || (s.made[i] === s.made[j] && s.dartsMade[i] < s.dartsMade[j]);
    s.winner = s.players.reduce((best, _, i) => (better(i, best) ? i : best), 0);
  }
}

export default {
  id: 'rcheckout',
  kind: 'training',
  name: 'Random Checkout',
  blurb: 'A list of random finishes, the same for everyone. Check each one out on a double within the darts allowed, then on to the next. Most checkouts wins.',
  seeded: true,
  options: [
    { key: 'range', label: 'Scores', choices: Object.keys(RANGES).map(r => [r, SPAN(r)]), default: 'low', brief: v => `Scores ${SPAN(v)}`,
      help: v => `Every finish is a score from ${RANGES[v][0]} to ${RANGES[v][1]} that three darts can check out.` },
    { key: 'darts', label: 'Darts per finish', choices: [[3, '3'], [6, '6'], [9, '9']], default: 6, brief: v => `${v} darts`,
      help: v => v === 3 ? 'One visit of three darts at each finish.' : `Up to ${v} darts at each finish, which is ${v / 3} visits.` },
    { key: 'count', label: 'Finishes', choices: [[10, '10'], [20, '20']], default: 10, brief: v => `${v} finishes`,
      help: v => `${v} finishes each, the same list for everyone.` },
  ],

  init(n, opts) {
    const list = targets(opts.seed ?? 1, opts.range, opts.count);
    const each = v => Array(n).fill(v);
    return {
      list, target: each(list[0]), left: each(list[0]), turnStartLeft: list[0],
      used: each(0),       // darts gone at this target
      made: each(0), tried: each(0),
      dartsMade: each(0),  // darts thrown at the targets that were checked out
      last: each(null),    // how the last target went: {target, ok, darts}
    };
  },

  // A player who has had every target is passed over while the others finish.
  out(s, i) { return s.tried[i] >= s.opts.count; },

  turnStart(s) {
    if (s.winner == null) s.turnStartLeft = s.left[s.current];
  },

  // Visits always start on a multiple of three darts and the darts allowed are
  // a multiple of three, so an attempt only runs out at the end of a visit.
  dart(s, d) {
    const p = s.current, left = s.left[p] - value(d);
    s.used[p]++;
    if (left < 0 || left === 1 || (left === 0 && d.mult !== 2)) {
      s.used[p] += 3 - s.turn.length;  // a bust uses up the whole visit
      s.left[p] = s.turnStartLeft;
      s.note = 'BUST';
      if (s.used[p] >= s.opts.darts) settle(s, false);
      return;
    }
    s.left[p] = left;
    if (left === 0) {
      settle(s, true);
      if (s.winner == null) s.turnOver = true;  // pull the darts before the next target
    } else if (s.used[p] >= s.opts.darts) {
      settle(s, false);
    }
  },

  canBust(s) { return s.left[s.current] <= (3 - s.turn.length) * 60; },

  bust(s) {
    const p = s.current;
    s.used[p] += 3 - s.turn.length;  // a bust uses up the whole visit
    s.left[p] = s.turnStartLeft;
    s.note = 'BUST';
    if (s.used[p] >= s.opts.darts) settle(s, false);
  },

  summary(s, i) {
    const done = s.winner == null && this.out(s, i);
    return { big: done ? s.made[i] : s.left[i], small: `${s.made[i]} of ${s.tried[i]} out`, out: done };
  },

  panel(s) {
    const col = i => [
      `${Math.min(s.tried[i] + 1, s.opts.count)} / ${s.opts.count}`,
      `${s.used[i]} / ${s.opts.darts}`,
      s.tried[i] ? `${s.made[i]} / ${s.tried[i]} (${Math.round(s.made[i] / s.tried[i] * 100)}%)` : '–',
      s.made[i] ? (s.dartsMade[i] / s.made[i]).toFixed(1) : '–',
    ];
    const cols = s.players.map((_, i) => col(i));
    const head = s.players.length > 1
      ? `<tr><th></th>${s.players.map((p, i) => `<th class="${i === s.current && s.winner == null ? 'cur' : ''}">${esc(p)}</th>`).join('')}</tr>` : '';
    return `<table class="cricket">${head}${['Finish', 'Darts used', 'Checked out', 'Darts per checkout'].map((k, r) =>
      `<tr><td>${k}</td>${cols.map(c => `<td>${c[r]}</td>`).join('')}</tr>`).join('')}</table>`;
  },

  // Called out by the app, as in X01: "You require 36".
  left(s) { return s.left[s.current]; },

  // Shown and spoken when the last target is done, instead of "X wins".
  result(s) {
    const w = s.winner ?? 0;
    const line = `Checked out ${s.made[w]} of ${s.tried[w]}` + (s.made[w] ? ` in ${s.dartsMade[w]} darts` : '');
    if (s.players.length < 2) return line;
    return s.made[w] ? `${s.players[w]} wins. ${line}` : 'Nobody checked out';
  },

  hint(s, { checkouts = true } = {}) {
    if (s.winner != null) return '';
    const p = s.current, last = s.last[p];
    // Until the first dart at a new target, say how the last one went.
    const fresh = last && s.used[p] === 0 && (s.turnOver || !s.turn.length);
    const news = fresh ? (last.ok ? `Checked out ${last.target} in ${last.darts}` : `Missed ${last.target}`) + `, now ${s.target[p]}` : '';
    if (s.turnOver || !checkouts) return news;
    const route = checkout(s.left[p], Math.min(3 - s.turn.length, s.opts.darts - s.used[p]), true);
    return [news, route ? 'Checkout: ' + route.map(label).join('  ') : ''].filter(Boolean).join(' · ');
  },
};
