// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import { label, value } from '../board.js';
import { checkout } from './x01.js';

const esc = t => String(t).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

// 121 Checkout, the practice game as DartCounter plays it. Check out the
// target (double out) within the dart limit: succeed and the target goes up,
// fail and it comes down by the chosen amount, never below the starting score
// (or, if so chosen, drops straight back to it). Alone, you play through your
// own targets and the highest checkout wins. With two or more players it is
// head to head on the same target: the first to check it out wins the leg
// (1–0, 2–0, …) and the target moves up; if nobody makes it within the dart
// limit, the target drops down and play moves on to the next leg.

// Can `left` still be checked out with `darts` more darts at it? Only the last
// visit at a target is looked at: with more than three to come there is always
// time to set something up.
const canFinish = (left, darts) => darts > 3 || (darts > 0 && !!checkout(left, darts, true));

function bestPlayer(s) {
  const rank = i => (s.players.length > 1 ? s.legs[i] * 1000000 : 0) + s.highest[i] * 1000 + s.checks[i];
  return s.players.reduce((best, _, i) => (rank(i) > rank(best) ? i : best), 0);
}

// The current player's attempt at their target has just ended, checked out or not.
function settle(s, ok, co = 0) {
  const p = s.current, t = s.target[p];
  if (s.players.length > 1) {
    if (ok) {
      s.legs[p]++;
      s.checks[p]++;
      s.streak[p]++;
      s.bestStreak[p] = Math.max(s.bestStreak[p], s.streak[p]);
      s.highest[p] = Math.max(s.highest[p], co);
    }
    for (let j = 0; j < s.players.length; j++) {
      if (!ok || j !== p) s.streak[j] = 0;
      s.results[j].push({ target: t, ok: ok && j === p, darts: s.used[j] });
    }
    s.legsPlayed++;
    s.lastLeg = { target: t, winner: ok ? p : null, darts: ok ? s.used[p] : 0 };
    const nextTarget = ok
      ? t + s.opts.inc
      : (s.opts.dec ? Math.max(s.opts.start, t - s.opts.dec) : s.opts.start);
    if (s.legsPlayed >= s.opts.rounds) {
      s.winner = bestPlayer(s);
    } else {
      s.target.fill(nextTarget);
      s.left.fill(nextTarget);
      s.used.fill(0);
      s.legDone.fill(false);
      s.newLeg = { starter: s.legsPlayed % s.players.length, set: false, ...(ok ? { winner: p } : { draw: true }) };
    }
    return;
  }

  s.results[p].push({ target: t, ok, darts: s.used[p] });
  if (ok) {
    s.checks[p]++;
    s.streak[p]++;
    s.bestStreak[p] = Math.max(s.bestStreak[p], s.streak[p]);
    s.highest[p] = Math.max(s.highest[p], co);
    s.target[p] = t + s.opts.inc;
  } else {
    s.streak[p] = 0;
    // No `dec` (matches from before the option existed) or 0: back to the start.
    s.target[p] = s.opts.dec ? Math.max(s.opts.start, t - s.opts.dec) : s.opts.start;
  }
  s.left[p] = s.target[p];
  s.used[p] = 0;
  // Over once everyone has had all their rounds. The highest finish wins, then
  // the most finishes, then whoever threw first.
  if (s.results.every(r => r.length >= s.opts.rounds)) s.winner = bestPlayer(s);
}

// After a dart or visit that did not check out: is the attempt over? It is
// once the darts are gone, or once those left cannot finish what remains (one
// dart and an odd number, say).
function stillOn(s) {
  const p = s.current;
  if (canFinish(s.left[p], s.opts.darts - s.used[p])) return true;
  s.used[p] = Math.ceil(s.used[p] / 3) * 3;  // like a bust, it uses up the whole visit
  if (s.players.length > 1) {
    s.legDone[p] = true;
    if (s.legDone.every(Boolean)) settle(s, false);
    return false;
  }
  settle(s, false);
  return false;
}

export default {
  id: 'c121',
  kind: 'training',
  name: '121 Checkout',
  blurb: 'Check out 121 in nine darts. Hit it and the target goes up; miss and it comes back down, never below the start.',
  options: [
    { key: 'start', label: 'Start', choices: [[81, '81'], [101, '101'], [121, '121']], default: 121, brief: v => `From ${v}`,
      help: v => `The first target is ${v}, and however many you miss the target never drops below it.` },
    { key: 'darts', label: 'Darts per target', choices: [[3, '3'], [6, '6'], [9, '9'], [12, '12'], [15, '15']], default: 9, brief: v => `${v} darts`,
      help: v => v === 3 ? 'One visit of three darts to check each target out.' : `Up to ${v} darts to check each target out, which is ${v / 3} visits.` },
    { key: 'inc', label: 'Increase on success', choices: [[1, '+1'], [2, '+2'], [5, '+5']], default: 1, brief: v => `+${v}`,
      help: v => `Check a target out and the next one is ${v} higher.` },
    { key: 'dec', label: 'Decrease on failure', choices: [[1, '−1'], [2, '−2'], [5, '−5'], [10, '−10'], [0, 'Back to start']], default: 1, brief: v => v ? `−${v}` : 'back to start',
      help: v => v ? `Miss a target and the next one is ${v} lower, but never below the start.` : 'Miss a target and the next one goes straight back to the start.' },
    { key: 'rounds', label: 'Rounds', choices: [[10, '10'], [20, '20'], [30, '30']], default: 10, brief: v => `${v} rounds`,
      help: v => `${v} targets. Alone, the highest checkout wins; with two or more players, first to the double wins each leg and the most legs wins.` },
  ],

  // Everything is kept per player.
  init(n, opts) {
    const each = v => Array.from({ length: n }, () => (Array.isArray(v) ? [] : v));
    return {
      target: each(opts.start), left: each(opts.start), turnStartLeft: opts.start,
      used: each(0),          // darts gone on this target
      results: each([]),      // one per finished target: {target, ok, darts}
      checks: each(0), streak: each(0), bestStreak: each(0), highest: each(0),
      legs: each(0), legDone: each(false), legsPlayed: 0, lastLeg: null,
    };
  },

  // A player who has used their darts for the current leg (or finished all rounds) is passed over.
  out(s, i) {
    if (s.players.length > 1) return s.winner == null && s.legDone[i];
    return s.results[i].length >= s.opts.rounds;
  },

  turnStart(s) {
    if (s.winner != null) return;
    const p = s.current;
    s.used[p] = Math.ceil(s.used[p] / 3) * 3;  // darts left unthrown in the last visit are gone
    s.turnStartLeft = s.left[p];
  },

  dart(s, d) {
    const p = s.current, left = s.left[p] - value(d);
    s.used[p]++;
    if (left < 0 || left === 1 || (left === 0 && d.mult !== 2)) {
      s.used[p] += 3 - s.turn.length;  // a bust uses up the whole visit
      s.left[p] = s.turnStartLeft;
      s.note = 'BUST';
      stillOn(s);
      return;
    }
    s.left[p] = left;
    if (left === 0) {
      settle(s, true, s.turnStartLeft);
      if (s.winner == null && s.players.length === 1) s.turnOver = true;  // pull the darts before the next target
    } else if (!stillOn(s) && s.turn.length < 3) {
      s.note = 'NO_OUT';  // no way out with the darts in hand: the visit ends here (not a bust: they scored)
    }
  },

  canBust(s) { return s.left[s.current] <= (3 - s.turn.length) * 60; },

  bust(s) {
    const p = s.current;
    s.used[p] += 3 - s.turn.length;  // a bust uses up the whole visit
    s.left[p] = s.turnStartLeft;
    s.note = 'BUST';
    stillOn(s);
  },

  // A whole visit typed in as one number, for playing without a camera.
  // Visits always start on a multiple of three darts, so there are three to throw.
  visit(s, total, n) {
    const p = s.current, left = s.left[p] - total;
    if (left < 0 || left === 1) {
      s.used[p] += 3;
      s.note = 'BUST';
      stillOn(s);
      return;
    }
    s.left[p] = left;
    s.used[p] += n;
    if (left === 0) settle(s, true, total);
    else stillOn(s);
  },

  // If `total` would check out: how many darts that could have taken.
  visitDarts(s, total) {
    const left = s.left[s.current];
    if (total !== left) return null;
    return [1, 2, 3].filter(d => checkout(left, d, true));
  },

  summary(s, i) {
    const h2h = s.players.length > 1;
    return {
      big: s.left[i],
      small: h2h ? `legs ${s.legs[i]} · target ${s.target[i]}` : `target ${s.target[i]}`,
      out: s.winner == null && this.out(s, i),
    };
  },

  panel(s) {
    const h2h = s.players.length > 1;
    const col = i => {
      const tries = s.results[i].length;
      // Every dart counted so far, over all targets including the current one.
      const darts = s.results[i].reduce((n, r) => n + r.darts, 0) + s.used[i];
      const rows = [
        `${Math.min((h2h ? s.legsPlayed : tries) + 1, s.opts.rounds)} / ${s.opts.rounds}`,
        `${s.used[i]} / ${s.opts.darts}`,
        s.highest[i] || '–',
        tries ? `${s.checks[i]} / ${tries} (${Math.round(s.checks[i] / tries * 100)}%)${h2h ? '' : ` · ${darts} darts`}` : '–',
        `${s.streak[i]} (best ${s.bestStreak[i]})`,
      ];
      return h2h ? [s.legs[i], ...rows] : rows;
    };
    const cols = s.players.map((_, i) => col(i));
    const head = h2h
      ? `<tr><th></th>${s.players.map((p, i) => `<th class="${i === s.current && s.winner == null ? 'cur' : ''}">${esc(p)}</th>`).join('')}</tr>` : '';
    const labels = [...(h2h ? ['Legs'] : []), 'Round', 'Darts used', 'Highest checkout', 'Checked out', 'Streak'];
    return `<table class="cricket">${head}${labels.map((k, r) =>
      `<tr><td>${k}</td>${cols.map(c => `<td>${c[r]}</td>`).join('')}</tr>`).join('')}</table>`;
  },

  // Called out by the app, as in X01.
  left(s) { return s.left[s.current]; },

  // Shown and spoken when the last round is done, instead of "X wins".
  result(s) {
    const w = s.winner ?? 0;
    const line = `Highest checkout: ${s.highest[w] || 'none'}. Checked out ${s.checks[w]} of ${s.results[w].length}`;
    if (s.players.length < 2) return line;
    if (!s.legs.some(Boolean)) return 'Nobody checked out';
    const score = s.players.length === 2 ? `${s.legs[w]}–${s.legs[1 - w]}` : `${s.legs[w]} legs`;
    return `${s.players[w]} wins ${score}. Highest checkout: ${s.highest[w] || 'none'}`;
  },

  hint(s, { checkouts = true } = {}) {
    const p = s.current;
    let news = '';
    if (s.players.length > 1) {
      const fresh = s.lastLeg && s.used.every(u => u === 0) && !s.turn.length;
      if (fresh) {
        news = (s.lastLeg.winner != null
          ? `${s.players[s.lastLeg.winner]} checked out ${s.lastLeg.target} in ${s.lastLeg.darts}`
          : `Missed ${s.lastLeg.target}`) + `, now ${s.target[p]}`;
      }
    } else {
      const last = s.results[p].at(-1);
      // Until the first dart at a new target, say how the last one went.
      const fresh = last && s.used[p] === 0 && (s.turnOver || !s.turn.length);
      news = fresh ? (last.ok ? `Checked out ${last.target} in ${last.darts}` : `Missed ${last.target}`) + `, now ${s.target[p]}` : '';
    }
    if (s.turnOver || !checkouts) return news;
    const route = checkout(s.left[p], Math.min(3 - s.turn.length, s.opts.darts - s.used[p]), true);
    return [news, route ? 'Checkout: ' + route.map(label).join('  ') : ''].filter(Boolean).join(' · ');
  },
};
