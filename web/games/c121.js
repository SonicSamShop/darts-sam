import { label, value } from '../board.js';
import { checkout } from './x01.js';

const esc = t => String(t).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

// 121 Checkout, the practice game as DartCounter plays it. Check out the
// target (double out) within the dart limit: succeed and the target goes up,
// fail and it comes down by the chosen amount, never below the starting score
// (or, if so chosen, drops straight back to it). With several players each has
// their own target, darts and results, and the highest checkout wins.

// Can `left` still be checked out with `darts` more darts at it? Only the last
// visit at a target is looked at: with more than three to come there is always
// time to set something up.
const canFinish = (left, darts) => darts > 3 || (darts > 0 && !!checkout(left, darts, true));

// The current player's attempt at their target has just ended, checked out or not.
function settle(s, ok) {
  const p = s.current, t = s.target[p];
  s.results[p].push({ target: t, ok, darts: s.used[p] });
  if (ok) {
    s.checks[p]++;
    s.streak[p]++;
    s.bestStreak[p] = Math.max(s.bestStreak[p], s.streak[p]);
    s.highest[p] = Math.max(s.highest[p], t);
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
  if (s.results.every(r => r.length >= s.opts.rounds)) {
    const rank = i => s.highest[i] * 1000 + s.checks[i];
    s.winner = s.players.reduce((best, _, i) => (rank(i) > rank(best) ? i : best), 0);
  }
}

// After a dart or visit that did not check out: is the attempt over? It is
// once the darts are gone, or once those left cannot finish what remains (one
// dart and an odd number, say).
function stillOn(s) {
  const p = s.current;
  if (canFinish(s.left[p], s.opts.darts - s.used[p])) return true;
  s.used[p] = Math.ceil(s.used[p] / 3) * 3;  // like a bust, it uses up the whole visit
  settle(s, false);
  return false;
}

export default {
  id: 'c121',
  name: '121 Checkout',
  blurb: 'Check out 121 in nine darts. Hit it and the target goes up; miss and it comes back down, never below the start.',
  options: [
    { key: 'start', label: 'Start', choices: [[81, '81'], [101, '101'], [121, '121']], default: 121 },
    { key: 'darts', label: 'Darts per target', choices: [[3, '3'], [6, '6'], [9, '9'], [12, '12'], [15, '15']], default: 9 },
    { key: 'inc', label: 'Increase on success', choices: [[1, '+1'], [2, '+2'], [5, '+5']], default: 1 },
    { key: 'dec', label: 'Decrease on failure', choices: [[1, '−1'], [2, '−2'], [5, '−5'], [10, '−10'], [0, 'Back to start']], default: 1 },
    { key: 'rounds', label: 'Rounds', choices: [[10, '10'], [20, '20'], [30, '30']], default: 10 },
  ],

  // Everything is kept per player.
  init(n, opts) {
    const each = v => Array.from({ length: n }, () => (Array.isArray(v) ? [] : v));
    return {
      target: each(opts.start), left: each(opts.start), turnStartLeft: opts.start,
      used: each(0),          // darts gone on this target
      results: each([]),      // one per finished target: {target, ok, darts}
      checks: each(0), streak: each(0), bestStreak: each(0), highest: each(0),
    };
  },

  // A player who has had all their rounds is passed over while the others finish.
  out(s, i) { return s.results[i].length >= s.opts.rounds; },

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
      settle(s, true);
      if (s.winner == null) s.turnOver = true;  // pull the darts before the next target
    } else if (!stillOn(s) && s.turn.length < 3) {
      s.note = 'BUST';  // no way out with the darts in hand: the visit ends here
    }
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
    if (left === 0) settle(s, true);
    else stillOn(s);
  },

  // If `total` would check out: how many darts that could have taken.
  visitDarts(s, total) {
    const left = s.left[s.current];
    if (total !== left) return null;
    return [1, 2, 3].filter(d => checkout(left, d, true));
  },

  summary(s, i) {
    return { big: s.left[i], small: `target ${s.target[i]}`, out: s.winner == null && this.out(s, i) };
  },

  panel(s) {
    const col = i => {
      const tries = s.results[i].length;
      // Every dart counted so far, over all targets including the current one.
      const darts = s.results[i].reduce((n, r) => n + r.darts, 0) + s.used[i];
      return [
        `${Math.min(tries + 1, s.opts.rounds)} / ${s.opts.rounds}`,
        `${s.used[i]} / ${s.opts.darts}`,
        s.highest[i] || '–',
        tries ? `${s.checks[i]} / ${tries} (${Math.round(s.checks[i] / tries * 100)}%)${s.players.length > 1 ? '' : ` · ${darts} darts`}` : '–',
        `${s.streak[i]} (best ${s.bestStreak[i]})`,
      ];
    };
    const cols = s.players.map((_, i) => col(i));
    const head = s.players.length > 1
      ? `<tr><th></th>${s.players.map((p, i) => `<th class="${i === s.current && s.winner == null ? 'cur' : ''}">${esc(p)}</th>`).join('')}</tr>` : '';
    return `<table class="cricket">${head}${['Round', 'Darts used', 'Highest checkout', 'Checked out', 'Streak'].map((k, r) =>
      `<tr><td>${k}</td>${cols.map(c => `<td>${c[r]}</td>`).join('')}</tr>`).join('')}</table>`;
  },

  // Called out by the app, as in X01.
  left(s) { return s.left[s.current]; },

  // Shown and spoken when the last round is done, instead of "X wins".
  result(s) {
    const w = s.winner ?? 0;
    const line = `Highest checkout: ${s.highest[w] || 'none'}. Checked out ${s.checks[w]} of ${s.results[w].length}`;
    if (s.players.length < 2) return line;
    return s.highest[w] ? `${s.players[w]} wins. ${line}` : 'Nobody checked out';
  },

  hint(s, { checkouts = true } = {}) {
    const p = s.current, last = s.results[p].at(-1);
    // Until the first dart at a new target, say how the last one went.
    const fresh = last && s.used[p] === 0 && (s.turnOver || !s.turn.length);
    const news = fresh ? (last.ok ? `Checked out ${last.target} in ${last.darts}` : `Missed ${last.target}`) + `, now ${s.target[p]}` : '';
    if (s.turnOver || !checkouts) return news;
    const route = checkout(s.left[p], Math.min(3 - s.turn.length, s.opts.darts - s.used[p]), true);
    return [news, route ? 'Checkout: ' + route.map(label).join('  ') : ''].filter(Boolean).join(' · ');
  },
};
