// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Computer players ("bots"): how good each level is, and how one throws.
//
// A bot throws the way a person does: it picks a bed to aim at, and the dart
// lands somewhere near the middle of it. How near is the level's skill, given
// as a spread in mm (the standard deviation of where its darts land, the same
// in every direction). Where the dart lands is scored like any other dart, so
// a bot's darts show on the board and count in the game as a player's would.
//
// A level has two spreads, because its two published figures are set apart:
//   spread  for scoring and setting up, tuned to give the level's `average`
//           (three-dart average over a leg of 501, double out)
//   finish  for a dart that would win the leg, tuned to give its `checkout`
//           rate (the share of darts thrown at a double that hit it)
// The averages rise evenly from 18 at level 1 to 110 at level 15, and the
// checkout rates from 8% (about 1 in 12) to 80%. The spreads are worked out
// from those by tools/bot_levels.mjs: change the targets there, run it, and
// paste what it prints here.
//
// Which bed to aim at is the game's business: a game that bots can play has a
// bot(state, skill, random) of its own (see engine.js), which calls throwAt().
import { scoreAt, SEGMENTS } from './board.js';

//                      level, average, checkout, spread, finish
export const LEVELS = [
  [1, 18, 0.08, 77.8, 26.8],
  [2, 25, 0.13, 58.4, 19.8],
  [3, 31, 0.18, 42, 15.8],
  [4, 38, 0.23, 28.6, 13],
  [5, 44, 0.29, 23.2, 10.6],
  [6, 51, 0.34, 18.8, 9.1],
  [7, 57, 0.39, 16.6, 7.8],
  [8, 64, 0.44, 14.3, 6.9],
  [9, 71, 0.49, 12.6, 6.1],
  [10, 77, 0.54, 11.4, 5.4],
  [11, 84, 0.59, 10, 4.8],
  [12, 90, 0.65, 9, 4.3],
  [13, 97, 0.70, 7.9, 3.8],
  [14, 103, 0.75, 7, 3.5],
  [15, 110, 0.80, 6.2, 3.1],
].map(([level, average, checkout, spread, finish]) => ({ level, average, checkout, spread, finish }));

// The skill of level n (1 to LEVELS.length); anything else is taken as the nearest there is.
export const botLevel = n => LEVELS[Math.min(LEVELS.length, Math.max(1, Math.round(n) || 1)) - 1];

// The middle of a bed {seg, mult}, in mm from the bull (+y up): where a player
// aims for it. A single is its big outer half, between the treble and the
// double; the 25 ring has no middle of its own, so that is the bull.
const AIM = { 1: 134.5, 2: 166, 3: 103 };
export function aimPoint({ seg, mult }) {
  if (seg === 25) return [0, 0];
  const a = SEGMENTS.indexOf(seg) * 18 * Math.PI / 180;
  return [AIM[mult] * Math.sin(a), AIM[mult] * Math.cos(a)];
}

// One dart aimed at `bed` by a thrower whose darts land `spread` mm around
// where they aim: {seg, mult, x, y}, as a tap on the board gives.
// random: a function giving numbers from 0 up to 1 (a seeded one, for tests).
export function throwAt(bed, spread, random = Math.random) {
  const [ax, ay] = aimPoint(bed);
  const far = spread * Math.sqrt(-2 * Math.log(1 - random())), turn = 2 * Math.PI * random();
  const x = +(ax + far * Math.cos(turn)).toFixed(1), y = +(ay + far * Math.sin(turn)).toFixed(1);
  return { ...scoreAt(x, y), x, y };
}
