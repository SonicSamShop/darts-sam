// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// Computer players (web/bot.js, and the X01 game's bot()).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, botLevel, levelFor, aimPoint, throwAt } from '../web/bot.js';
import { newMatch, compute, gameById } from '../web/engine.js';
import { scoreAt } from '../web/board.js';

// Random numbers that come out the same every run.
function seeded(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const x01 = gameById('x01');

// Legs of 501 thrown alone by a bot, through the engine as the app plays them:
// its three-dart average, and the darts the longest leg took.
function legs(skill, n, random) {
  let points = 0, thrown = 0, longest = 0;
  for (let i = 0; i < n; i++) {
    const m = newMatch('x01', ['Bot'], { start: 501 });
    let s = compute(m);
    while (s.winner == null) {
      m.log.push({ t: 'dart', ...x01.bot(s, skill, random), src: 'bot' });
      s = compute(m);
    }
    points += s.points[0];
    thrown += s.thrown[0];
    longest = Math.max(longest, s.thrown[0]);
  }
  return { average: points / thrown * 3, longest };
}

test('bots: fifteen levels, each better than the last', () => {
  assert.equal(LEVELS.length, 15);
  assert.deepEqual(LEVELS.map(l => l.level), LEVELS.map((_, i) => i + 1));
  assert.deepEqual([LEVELS[0].average, LEVELS[0].checkout], [18, 0.08]);
  assert.deepEqual([LEVELS[14].average, LEVELS[14].checkout], [110, 0.8]);
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1], b = LEVELS[i];
    assert.ok(b.average > a.average && b.checkout > a.checkout && b.spread < a.spread && b.finish < a.finish, `level ${b.level}`);
  }
  assert.equal(botLevel(7).level, 7);
  assert.deepEqual([0, 99, 'x', undefined].map(n => botLevel(n).level), [1, 15, 1, 1]);
});

test('bots: a dart lands near where it is aimed and is scored where it lands', () => {
  for (const bed of [{ seg: 20, mult: 3 }, { seg: 16, mult: 2 }, { seg: 3, mult: 1 }, { seg: 25, mult: 2 }]) {
    assert.deepEqual(scoreAt(...aimPoint(bed)), bed);
  }
  assert.deepEqual(scoreAt(...aimPoint({ seg: 25, mult: 1 })), { seg: 25, mult: 2 });  // the 25 is aimed at the bull
  const random = seeded(5);
  for (let i = 0; i < 200; i++) {
    const d = throwAt({ seg: 20, mult: 3 }, 30, random);
    assert.deepEqual({ seg: d.seg, mult: d.mult }, scoreAt(d.x, d.y));
  }
  assert.deepEqual(throwAt({ seg: 20, mult: 3 }, 0, random), { seg: 20, mult: 3, x: 0, y: 103 });
});

test('bots: each level hits its doubles as often as it says', () => {
  for (const l of LEVELS) {
    const random = seeded(l.level), n = 20000;
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const d = throwAt({ seg: 16, mult: 2 }, l.finish, random);
      if (d.seg === 16 && d.mult === 2) hit++;
    }
    assert.ok(Math.abs(hit / n - l.checkout) < 0.02, `level ${l.level}: ${(hit / n).toFixed(3)} for ${l.checkout}`);
  }
});

test('bots: X01 legs come out at the level\'s average', () => {
  for (const [level, n] of [[1, 60], [5, 120], [10, 200], [15, 300]]) {
    const l = botLevel(level), got = legs(l, n, seeded(level));
    assert.ok(Math.abs(got.average - l.average) < l.average * 0.08, `level ${level}: ${got.average.toFixed(1)} for ${l.average}`);
  }
  assert.ok(legs(botLevel(15), 300, seeded(9)).longest <= 30);
});

test('bots: X01 aims by the checkout chart', () => {
  const perfect = { spread: 0, finish: 0 }, random = seeded(1);
  const at = (score, thrown = []) => {
    const s = compute({ ...newMatch('x01', ['Bot'], { start: score }), log: thrown.map(d => ({ t: 'dart', ...d })) });
    const d = x01.bot(s, perfect, random);
    return [d.seg, d.mult];
  };
  assert.deepEqual(at(501), [20, 3]);
  assert.deepEqual(at(170), [20, 3]);
  assert.deepEqual(at(121), [20, 3]);
  assert.deepEqual(at(40), [20, 2]);
  assert.deepEqual(at(50), [10, 1]);                              // 10, D20
  assert.deepEqual(at(301, [{ seg: 20, mult: 3 }, { seg: 20, mult: 3 }]), [20, 3]);  // 181 left, one dart
  assert.deepEqual(at(170, [{ seg: 20, mult: 3 }, { seg: 20, mult: 3 }]), [25, 2]);  // 50 left, one dart: the bull
  assert.deepEqual(at(101, [{ seg: 1, mult: 1 }, { seg: 20, mult: 3 }]), [20, 2]);   // 40 left
  assert.deepEqual(at(95, [{ seg: 20, mult: 3 }, { seg: 0, mult: 0 }]), [3, 1]);     // 35 left, one dart: sets up D16
  // A perfect bot takes out 501 in nine darts.
  assert.equal(legs(perfect, 1, random).longest, 9);
});

test('the level suggested for a player is the first that averages as much as they do, or more', () => {
  assert.equal(levelFor(40).average, 44);    // between 38 and 44: the one just above
  assert.equal(levelFor(38).average, 38);    // level with a level: that one
  assert.equal(levelFor(38.1).average, 44);
  assert.equal(levelFor(5).level, 1);        // below them all
  assert.equal(levelFor(125).level, LEVELS.length);  // above them all
});
