// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Work out the computer players' levels (the LEVELS table in web/bot.js).
//
//   node tools/bot_levels.mjs
//
// Each level is set by two targets: its three-dart average over a leg of 501
// (double out), and its checkout rate (the share of darts thrown at a double
// that hit it). Both rise evenly from the first level to the last: change
// FIRST, LAST or COUNT below to move them. For each level this finds the two
// spreads (in mm, see bot.js) that give those figures, by playing a great many
// legs with the game's own rules, and prints the table to paste into bot.js
// with the figures each level came out at.
import x01 from '../web/games/x01.js';
import { throwAt } from '../web/bot.js';

const COUNT = 15;
const FIRST = { average: 18, checkout: 0.08 };  // level 1: a beginner, a double about 1 dart in 12
const LAST = { average: 110, checkout: 0.80 };  // the top level
const LEGS = 2500, DARTS = 300000;              // how much is played to measure a spread

// Random numbers that come out the same every run, so the search is steady.
function seeded(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// The share of darts aimed at a double that hit it.
export function doubleRate(finish, darts = DARTS, random = seeded(1)) {
  let hit = 0;
  for (let i = 0; i < darts; i++) {
    const d = throwAt({ seg: 20, mult: 2 }, finish, random);
    if (d.seg === 20 && d.mult === 2) hit++;
  }
  return hit / darts;
}

// The three-dart average over `legs` legs of 501 thrown alone, as the game counts it.
export function average(skill, legs = LEGS, random = seeded(2)) {
  let points = 0, thrown = 0;
  for (let i = 0; i < legs; i++) {
    const opts = { start: 501 };
    const s = { opts, players: ['bot'], current: 0, turn: [], note: '', winner: null, ...x01.init(1, opts) };
    x01.turnStart(s);
    while (s.winner == null) {
      const d = x01.bot(s, skill, random);
      s.turn.push(d);
      x01.dart(s, d);
      if (s.note === 'BUST' || s.turn.length === 3) { s.note = ''; s.turnOver = false; s.turn = []; x01.turnStart(s); }
    }
    points += s.points[0];
    thrown += s.thrown[0];
  }
  return points / thrown * 3;
}

// The spread at which `measure` (which falls as the spread grows) gives `target`.
function solve(measure, target, lo, hi) {
  for (let i = 0; i < 13; i++) {
    const mid = (lo + hi) / 2;
    if (measure(mid) > target) lo = mid; else hi = mid;
  }
  return +((lo + hi) / 2).toFixed(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = (key, i) => FIRST[key] + (LAST[key] - FIRST[key]) * i / (COUNT - 1);
  console.log('//                      level, average, checkout, spread, finish');
  const rows = [];
  for (let i = 0; i < COUNT; i++) {
    const want = { average: Math.round(at('average', i)), checkout: +at('checkout', i).toFixed(2) };
    const finish = solve(mm => doubleRate(mm), want.checkout, 1, 100);
    const spread = solve(mm => average({ spread: mm, finish }), want.average, 1, 250);
    rows.push({ level: i + 1, ...want, spread, finish });
    console.log(`  [${i + 1}, ${want.average}, ${want.checkout.toFixed(2)}, ${spread}, ${finish}],`);
  }
  console.log('\nlevel  average (wanted)  checkout (wanted)');
  for (const r of rows) {
    const got = average(r, LEGS, seeded(3)), rate = doubleRate(r.finish, DARTS, seeded(4));
    console.log(`${String(r.level).padStart(5)}  ${got.toFixed(1).padStart(7)} (${r.average})  ${(rate * 100).toFixed(1).padStart(8)}% (${Math.round(r.checkout * 100)}%)`);
  }
}
