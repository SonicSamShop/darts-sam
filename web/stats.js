// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Deep stats, worked out on this device from the visit-by-visit history the Pi
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
import { value } from './board.js';

const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
const most = (list, f) => list.reduce((m, x) => Math.max(m, f(x)), -Infinity);
const avg3 = (points, darts) => darts ? points / darts * 3 : null;
const one = n => n == null ? null : n.toFixed(1);

// A match's visits as objects, in the order thrown. The Pi sends each one as
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
export function setsSideBySide(matches) {
  const groups = new Map();
  for (const m of matches) {
    const key = m.darts ?? null;
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
