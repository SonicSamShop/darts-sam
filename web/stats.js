// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Deep stats, worked out on this device from the visit-by-visit history the server
// sends with a player's stats ("matches", see _history() in server/db.py).
//
// The X01 figures follow the ones the PDC publishes for its matches: three-dart
// and first-nine averages, checkout rate (checkouts per dart thrown at a
// double), highest and 100+ checkouts, 180s / 140+ / 100+, and legs won with
// and against the throw.
//
// Every figure is counted from a list of visits or legs, and that same list is
// what the stats screen shows when the figure is tapped, so the two can never
// disagree. Plain data in, plain data out: nothing here touches the page.
import { value, label } from './board.js';

const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
const most = (list, f) => list.reduce((m, x) => Math.max(m, f(x)), -Infinity);
const avg3 = (points, darts) => darts ? points / darts * 3 : null;
const one = n => n == null ? null : n.toFixed(1);

// A match's visits as objects, in the order thrown. The server sends each one as
// [player, round, ts, bust, darts] with a dart as seg * 10 + mult, or, for a
// visit typed in as one number, [player, round, ts, bust, null, total, darts used].
//   i      where the visit comes in the match (what a scoresheet highlights)
//   darts  [{seg, mult}], or null for a typed visit
//   n      darts thrown;  total: what they add up to (a bust still adds up)
export function visitsOf(m) {
  return m.visits.map(([p, round, ts, bust, darts, total, n], i) => {
    const thrown = darts?.map(c => ({ seg: Math.floor(c / 10), mult: c % 10 })) ?? null;
    return {
      m, i, p, round, ts: ts ?? m.started, bust: !!bust, darts: thrown,
      n: thrown ? thrown.length : n, total: thrown ? sum(thrown, value) : total,
    };
  });
}

// One X01 match played back and split into its legs (a match is one leg, or
// the first to a number of legs and sets). Each visit gains:
//   no        the player's 1st, 2nd, ... visit of the leg
//   before, score, after   what was left, what counted (0 for a bust), what remained
//   thrown    darts it counts as in the average: a bust uses up all three
//   atDouble  one {aim, hit} per dart thrown at a double to win (double out,
//             and only when the single darts are known). aim is the double's
//             number, 25 for the bull.
//   checkout  it won the leg
// A leg has n (1st, 2nd, ... of the match's `of` legs), when it began, who
// started it and who won it, everyone's visits, and one summary per player in
// sides. Its own mine (visits), darts, avg and so on are those of the player
// the history belongs to (m.me): first says they had the throw, won that they
// took the leg.
export function x01Legs(m) {
  const start = m.opts.start ?? 501, dbl = m.opts.out !== 'straight';
  const legs = [];
  let leg = null, left, no;
  for (const v of visitsOf(m)) {
    if (!leg) {
      leg = { m, n: legs.length + 1, start, dbl, when: v.ts, starter: v.p, winner: null, visits: [] };
      legs.push(leg);
      left = m.players.map(() => start);
      no = m.players.map(() => 0);
    }
    const before = left[v.p], atDouble = [];
    if (dbl && v.darts) {
      let r = before;
      v.darts.forEach((d, k) => {
        // On 2 to 40 and even, the dart is at that double. On 50 it is only
        // counted as a dart at the bull if it landed there or was the last of
        // the visit: with darts in hand most players set up a double instead.
        const aim = r === 50 ? (d.seg === 25 || k === 2 ? 25 : 0) : r >= 2 && r <= 40 && r % 2 === 0 ? r / 2 : 0;
        if (aim) atDouble.push({ aim, hit: d.mult === 2 && value(d) === r });
        r -= value(d);
      });
    }
    const score = v.bust ? 0 : v.total;
    left[v.p] = before - score;
    const checkout = !v.bust && left[v.p] === 0;
    leg.visits.push({
      ...v, leg: leg.n, no: ++no[v.p], before, score, after: left[v.p], thrown: v.bust ? 3 : v.n, atDouble, checkout,
    });
    if (checkout) { leg.winner = v.p; leg = null; }  // the next visit begins a new leg
  }
  return legs.map(l => {
    const sides = m.players.map((_, p) => {
      const own = l.visits.filter(v => v.p === p), nine = own.slice(0, 3);
      const darts = sum(own, v => v.thrown), points = sum(own, v => v.score);
      const ninePoints = sum(nine, v => v.score), nineDarts = sum(nine, v => v.thrown);
      return {
        mine: own, darts, points, avg: avg3(points, darts), ninePoints, nineDarts, first9: avg3(ninePoints, nineDarts),
        checkout: l.winner === p ? own.at(-1).score : null,
      };
    });
    return {
      ...l, of: legs.length, sides, ...sides[m.me],
      finished: l.winner != null, won: l.winner === m.me, first: l.starter === m.me, solo: m.players.length === 1,
    };
  });
}

// A player's X01 figures from their history, or null if they have thrown no X01.
//   legs     every leg they threw in (finished or not), oldest first
//   visits   every visit of theirs
//   doubles  [{aim, hit, darts}] per double thrown at, most thrown at first
export function x01Stats(matches) {
  const legs = matches.filter(m => m.game === 'x01').flatMap(x01Legs).filter(l => l.mine.length);
  if (!legs.length) return null;
  const visits = legs.flatMap(l => l.mine);
  const doubles = new Map();
  for (const v of visits) for (const a of v.atDouble) {
    const d = doubles.get(a.aim) ?? { aim: a.aim, hit: 0, darts: 0 };
    d.darts++;
    d.hit += a.hit;
    doubles.set(a.aim, d);
  }
  const list = [...doubles.values()].sort((a, b) => b.darts - a.darts);
  return {
    legs, visits, doubles: list,
    average: avg3(sum(legs, l => l.points), sum(legs, l => l.darts)),
    first9: avg3(sum(legs, l => l.ninePoints), sum(legs, l => l.nineDarts)),
    coHit: sum(list, d => d.hit), coDarts: sum(list, d => d.darts),
  };
}

// ---------- sets of darts side by side ----------
// A figure for one set is only shown once there are enough darts behind it: with
// fewer, a set can look better or worse than another by luck alone.
//   average   X01 darts (about 100 visits)
//   checkout  darts thrown at a double to win
//   trebles   single darts (typed visits have none), in any game
export const ENOUGH = { average: 300, checkout: 50, trebles: 300 };

// Each set's figures from a player's history (every match says the set they
// threw: m.darts, null if not said), as a Map from set id (or null) to:
//   x01Darts, average     X01 darts and the 3-dart average from them
//   coDarts, coHit        darts at a double to win, and those that won
//   singles, trebleHits   darts known one by one, and the trebles among them
//   need                  for each of average, checkout and trebles: how many more
//                         darts until it can be shown (0: it can)
// The average, checkout rate (%) and trebles (%) are null until there are ENOUGH.
// boardsSideBySide is the same, by the board each game was played on (m.board).
export const setsSideBySide = matches => sideBySide(matches, m => m.darts);
export const boardsSideBySide = matches => sideBySide(matches, m => m.board);
function sideBySide(matches, keyOf) {
  const groups = new Map();
  for (const m of matches) {
    const key = keyOf(m) ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const out = new Map();
  for (const [key, list] of groups) {
    const x = x01Stats(list);
    const x01Darts = x ? sum(x.legs, l => l.darts) : 0, coDarts = x?.coDarts ?? 0, coHit = x?.coHit ?? 0;
    let singles = 0, trebleHits = 0;
    for (const m of list) for (const v of visitsOf(m)) if (v.p === m.me && v.darts) {
      singles += v.darts.length;
      trebleHits += v.darts.filter(d => d.mult === 3).length;
    }
    const need = {
      average: Math.max(0, ENOUGH.average - x01Darts),
      checkout: Math.max(0, ENOUGH.checkout - coDarts),
      trebles: Math.max(0, ENOUGH.trebles - singles),
    };
    out.set(key, {
      x01Darts, coDarts, coHit, singles, trebleHits, need,
      average: need.average ? null : x.average,
      checkout: need.checkout ? null : coHit / coDarts * 100,
      trebles: need.trebles ? null : trebleHits / singles * 100,
    });
  }
  return out;
}

const scored = (lo, hi) => s => s.visits.filter(v => v.score >= lo && v.score <= hi);
const wonLegs = s => s.legs.filter(l => l.won);
const versus = first => s => s.legs.filter(l => l.finished && !l.solo && l.first === first);
const wonOf = (s, rows) => rows.length ? `${rows.filter(l => l.won).length}/${rows.length}` : null;
const quick = darts => s => wonLegs(s).filter(l => l.start === 501 && l.darts <= darts);

// The X01 tiles, in the order shown. Each one:
//   key, label, note (optional: more to say after the label, from the stats)
//   kind   what its list is made of: 'visits', 'legs' or 'doubles'
//   rows   the list it is counted from, which is what tapping it shows
//   value  what the tile says (left out: how many rows there are)
//   sort   how its list is first ordered (left out: newest first)
export const X01_TILES = [
  { group: 'scoring', tiles: [
    { key: 'average', label: '3-dart average', kind: 'legs', rows: s => s.legs, value: s => one(s.average) },
    { key: 'first9', label: 'First 9 average', kind: 'legs', rows: s => s.legs, value: s => one(s.first9), sort: { by: 'first9' } },
    { key: 'highest', label: 'Highest visit', kind: 'visits', rows: s => s.visits.filter(v => !v.bust),
      value: (s, rows) => rows.length ? most(rows, v => v.score) : null, sort: { by: 'score' } },
    { key: 't180', label: '180s', kind: 'visits', rows: scored(180, 180) },
    { key: 't140', label: '140+', kind: 'visits', rows: scored(140, 179) },
    { key: 't100', label: '100+', kind: 'visits', rows: scored(100, 139) },
    { key: 't60', label: '60+', kind: 'visits', rows: scored(60, 99) },
    { key: 'busts', label: 'Busts', kind: 'visits', rows: s => s.visits.filter(v => v.bust) },
  ] },
  { group: 'checkouts', tiles: [
    { key: 'checkout', label: 'Checkout rate', note: s => s.coDarts ? ` (${s.coHit} of ${s.coDarts} darts)` : '', kind: 'doubles',
      rows: s => s.doubles, value: s => s.coDarts ? (s.coHit / s.coDarts * 100).toFixed(1) + '%' : null },
    { key: 'bestCheckout', label: 'Highest checkout', kind: 'visits', rows: s => s.visits.filter(v => v.checkout),
      value: (s, rows) => rows.length ? most(rows, v => v.score) : null, sort: { by: 'score' } },
    { key: 'tonCheckouts', label: '100+ checkouts', kind: 'visits', rows: s => s.visits.filter(v => v.checkout && v.score >= 100) },
  ] },
  { group: 'legs', tiles: [
    { key: 'played', label: 'Legs played', kind: 'legs', rows: s => s.legs.filter(l => l.finished) },
    { key: 'won', label: 'Legs won', kind: 'legs', rows: wonLegs },
    { key: 'holds', label: 'Won with the throw', kind: 'legs', rows: versus(true), value: wonOf },
    { key: 'breaks', label: 'Won against the throw', kind: 'legs', rows: versus(false), value: wonOf },
    { key: 'bestLeg', label: 'Best leg (darts)', kind: 'legs', rows: wonLegs,
      value: (s, rows) => rows.length ? -most(rows, l => -l.darts) : null, sort: { by: 'darts', desc: false } },
    { key: 'perLeg', label: 'Darts per leg won', kind: 'legs', rows: wonLegs,
      value: (s, rows) => rows.length ? one(sum(rows, l => l.darts) / rows.length) : null, sort: { by: 'darts', desc: false } },
    { key: 'in15', label: '501 in 15 darts or fewer', kind: 'legs', rows: quick(15) },
    { key: 'in18', label: '501 in 18 darts or fewer', kind: 'legs', rows: quick(18) },
  ] },
];
export const x01Tile = key => X01_TILES.flatMap(g => g.tiles).find(t => t.key === key);

// Recent X01 legs for the 3-dart average trend chart (oldest first, up to `limit` legs).
export function x01Trend(s, limit = 20) {
  const legs = (s?.legs ?? []).filter(l => l.avg != null).slice(-limit);
  if (legs.length < 2) return null;
  const avgs = legs.map(l => l.avg);
  const mid = Math.floor(legs.length / 2);
  const mean = list => list.reduce((t, v) => t + v, 0) / list.length;
  const delta = mean(avgs.slice(mid)) - mean(avgs.slice(0, mid));
  return {
    legs,
    min: Math.min(...avgs),
    max: Math.max(...avgs),
    latest: avgs.at(-1),
    overall: s.average,
    delta,
  };
}

// Visit score distribution for X01 horizontal breakdown bars.
export function x01Brackets(s) {
  const visits = (s?.visits ?? []).filter(v => !v.bust);
  if (!visits.length) return [];
  const total = visits.length;
  const defs = [
    ['t180', '180', 180, 180, 'gold'],
    ['t140', '140+', 140, 179, 'accent'],
    ['t100', '100+', 100, 139, 'accent'],
    ['t60', '60+', 60, 99, 'mid'],
    [null, 'Under 60', 0, 59, 'muted'],
  ];
  const rows = defs.map(([key, label, lo, hi, tone]) => {
    const count = visits.filter(v => v.score >= lo && v.score <= hi).length;
    return { key, label, count, pct: count / total * 100, tone };
  });
  const peak = Math.max(1, ...rows.map(r => r.count));
  return rows.map(r => ({ ...r, width: r.count / peak * 100 }));
}

// Head-to-head rivalry records across finished 2-player matches, most-played rivals first.
export function headToHead(matches) {
  const map = new Map();
  for (const m of matches ?? []) {
    if (m.players?.length !== 2 || m.winner == null) continue;
    const me = m.me ?? 0, them = 1 - me, opp = m.players[them];
    const r = map.get(opp) ?? { opponent: opp, played: 0, won: 0, lost: 0, myPts: 0, myDarts: 0, oppPts: 0, oppDarts: 0, bestCo: 0 };
    r.played++;
    if (m.winner === me) r.won++; else r.lost++;
    if (m.game === 'x01') {
      for (const l of x01Legs(m)) {
        r.myPts += l.sides[me].points;
        r.myDarts += l.sides[me].darts;
        r.oppPts += l.sides[them].points;
        r.oppDarts += l.sides[them].darts;
        if (l.sides[me].checkout) r.bestCo = Math.max(r.bestCo, l.sides[me].checkout);
      }
    }
    map.set(opp, r);
  }
  return [...map.values()]
    .map(r => ({
      opponent: r.opponent,
      played: r.played,
      won: r.won,
      lost: r.lost,
      winPct: r.won / r.played * 100,
      myAvg: avg3(r.myPts, r.myDarts),
      oppAvg: avg3(r.oppPts, r.oppDarts),
      bestCheckout: r.bestCo || null,
    }))
    .sort((a, b) => b.played - a.played || b.won - a.won);
}

// How often each number was hit, from visits whose single darts are known:
// [{seg, by: [misses, singles, doubles, trebles], n, share}], most hit first.
// seg is 25 for the bull and 0 for a miss.
export function dartTable(visits) {
  const rows = new Map();
  let all = 0;
  for (const v of visits) for (const d of v.darts ?? []) {
    const seg = d.mult ? d.seg : 0;
    const r = rows.get(seg) ?? { seg, by: [0, 0, 0, 0], n: 0 };
    r.by[d.mult]++;
    r.n++;
    all++;
    rows.set(seg, r);
  }
  return [...rows.values()].map(r => ({ ...r, share: r.n / all })).sort((a, b) => b.n - a.n);
}
export const visitsWith = (visits, seg) => visits.filter(v => v.darts?.some(d => (d.mult ? d.seg : 0) === seg));

// ---------- one match, player by player ----------
// The summary shown when a game is over and at the top of its scoresheet: a line
// per figure with everyone's side by side, and for X01 every leg's averages.
//   rows   [{label, cells: [text per player], best: the player who did best, or null}]
//   legs   X01 only: [{n, set, winner, cells: [{avg, darts} per player]}]
// Trebles, doubles and bulls come from darts known one by one (a typed visit has
// none); a player with no such darts shows –.
export function matchSummary(m) {
  const n = m.players.length, all = visitsOf(m);
  const each = f => m.players.map((_, p) => f(p));
  const rows = [];
  // more: higher is better (false: lower is, null: neither); text: how a figure reads
  // (a figure is only marked best when at least two players have one, and no one ties for it)
  const row = (label, vals, { more = true, text = v => v == null ? '–' : String(v) } = {}) => {
    const known = vals.filter(v => v != null);
    const top = known.length > 1 && more != null ? (more ? Math.max(...known) : Math.min(...known)) : null;
    const best = top != null && vals.filter(v => v === top).length === 1 ? vals.indexOf(top) : null;
    rows.push({ label, cells: vals.map(text), best });
  };
  const darts = p => all.filter(v => v.p === p && v.darts).flatMap(v => v.darts);
  const count = f => each(p => darts(p).length ? darts(p).filter(f).length : null);
  let legs = null;
  if (m.game === 'x01') {
    const played = x01Legs(m), legsTo = m.opts.legs ?? 1, setsOn = (m.opts.sets ?? 1) > 1;
    const sets = m.players.map(() => 0), inSet = m.players.map(() => 0);
    let set = 1;
    legs = played.map(l => {
      const out = { n: l.n, set, winner: l.winner, cells: l.sides.map(s => ({ avg: one(s.avg), darts: s.darts })) };
      if (l.winner != null && ++inSet[l.winner] >= legsTo) { sets[l.winner]++; inSet.fill(0); set++; }
      return out;
    });
    const add = f => each(p => sum(played, l => f(l.sides[p], p, l)));
    const visits = p => played.flatMap(l => l.sides[p].mine);
    const thrown = add(s => s.darts);
    const scored = (lo, hi) => each(p => visits(p).filter(v => v.score >= lo && v.score <= hi).length);
    if (setsOn) row('Sets won', sets);
    if (played.length > 1 || setsOn) row('Legs won', add((s, p, l) => +(l.winner === p)));
    row('3-dart average', each(p => avg3(add(s => s.points)[p], thrown[p])), { text: v => one(v) ?? '–' });
    row('First 9 average', each(p => avg3(add(s => s.ninePoints)[p], add(s => s.nineDarts)[p])), { text: v => one(v) ?? '–' });
    row('Highest visit', each(p => visits(p).filter(v => !v.bust).reduce((t, v) => Math.max(t, v.score), 0) || null));
    row('180s', scored(180, 180));
    row('140+', scored(140, 179));
    row('100+', scored(100, 139));
    row('60+', scored(60, 99));
    const at = each(p => visits(p).flatMap(v => v.atDouble));
    row('Checkout rate', at.map(a => a.length ? a.filter(d => d.hit).length / a.length * 100 : null),
      { text: v => v == null ? '–' : `${v.toFixed(0)}%` });
    rows.at(-1).cells = rows.at(-1).cells.map((t, p) => at[p].length ? `${t} (${at[p].filter(d => d.hit).length}/${at[p].length})` : t);
    row('Highest checkout', each(p => played.reduce((t, l) => Math.max(t, l.sides[p].checkout ?? 0), 0) || null));
    row('Best leg (darts)', each(p => played.filter(l => l.winner === p).reduce((t, l) => Math.min(t, l.sides[p].darts), Infinity))
      .map(v => v === Infinity ? null : v), { more: false });
    row('Busts', each(p => visits(p).filter(v => v.bust).length), { more: false });
    row('Darts thrown', thrown, { more: null });
  } else {
    row('Darts thrown', each(p => sum(all.filter(v => v.p === p), v => v.n ?? 0)), { more: null });
  }
  row('Trebles', count(d => d.mult === 3));
  row('Doubles', count(d => d.mult === 2 && d.seg !== 25));
  row('Bulls (25 and 50)', count(d => d.mult && d.seg === 25));
  row('Misses', count(d => !d.mult), { more: false });
  return { rows, legs };
}

// ---------- CSV export ----------
// One row per visit thrown by the player across the given matches (RFC 4180 CSV).
const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function statsCsv(matches) {
  const header = ['Date', 'Match ID', 'Game', 'Players', 'Result', 'Leg', 'Round', 'Score', 'Bust', 'Darts Thrown', 'Darts', 'Left Before', 'Left After', 'Checkout'];
  const lines = [header.join(',')];
  for (const m of matches ?? []) {
    const result = m.winner == null ? 'Unfinished' : m.players.length === 1 ? 'Finished' : m.winner === m.me ? 'Won' : 'Lost';
    const players = m.players.join(' vs ');
    if (m.game === 'x01') {
      for (const leg of x01Legs(m)) {
        for (const v of leg.mine) {
          lines.push([
            new Date(v.ts).toISOString(), m.id, m.name ?? m.game, players, result, leg.n, v.round,
            v.score, v.bust ? 'Yes' : 'No', v.thrown, v.darts ? v.darts.map(label).join(' ') : 'typed',
            v.before, v.after, v.checkout ? 'Yes' : 'No',
          ].map(csvCell).join(','));
        }
      }
    } else {
      for (const v of visitsOf(m).filter(v => v.p === m.me)) {
        lines.push([
          new Date(v.ts).toISOString(), m.id, m.name ?? m.game, players, result, '', v.round,
          v.bust ? 0 : v.total, v.bust ? 'Yes' : 'No', v.n, v.darts ? v.darts.map(label).join(' ') : 'typed',
          '', '', '',
        ].map(csvCell).join(','));
      }
    }
  }
  return lines.join('\r\n') + '\r\n';
}
