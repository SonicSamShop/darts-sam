// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROS, TIERS, canPromote, newCareer, nextCareerMatch, orderOfMerit, recommendedTier,
  recordCareerResult, seasonComplete, startNextSeason
} from '../web/career.js';

const seeded = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

test('career: recommendedTier maps X01 average to the right starting tier', () => {
  assert.equal(recommendedTier(0), 0);
  assert.equal(recommendedTier(28), 0);
  assert.equal(recommendedTier(50), 1);
  assert.equal(recommendedTier(70), 2);
  assert.equal(recommendedTier(90), 3);
  assert.equal(recommendedTier(105), 4);
});

test('career: league fixtures lead into a knockout cup, trophy, and tier promotion', () => {
  const rand = seeded(42);
  let c = newCareer(1, { startTier: 0, random: rand });
  assert.equal(c.tier, 0);
  assert.equal(c.stage, 'league');
  assert.equal(c.fixtures.length, TIERS[0].leagueCount);
  assert.equal(PROS.length, 30);

  // Win all 3 Pub League fixtures
  for (let i = 0; i < 3; i++) {
    const up = nextCareerMatch(c);
    assert.equal(up.kind, 'league');
    c = recordCareerResult(c, { won: true, legs: [2, 0], avg: 52.4, now: 1000 + i, random: rand });
  }
  assert.equal(c.stage, 'cup');
  assert.ok(c.cup);
  assert.equal(c.cup.size, 4);

  // Win Semi-final and Final of Pub League Cup
  const sf = nextCareerMatch(c);
  assert.equal(sf.kind, 'cup');
  c = recordCareerResult(c, { won: true, legs: [2, 1], avg: 55.0, now: 2000, random: rand });
  const fin = nextCareerMatch(c);
  assert.equal(fin.kind, 'cup');
  assert.equal(fin.opts.legs, TIERS[0].finalOpts.legs);
  c = recordCareerResult(c, { won: true, legs: [3, 1], avg: 61.2, now: 3000, random: rand });

  assert.equal(seasonComplete(c), true);
  assert.equal(canPromote(c), true);
  assert.equal(c.unlockedTier, 1);
  assert.equal(c.trophies.length, 1);
  assert.equal(c.trophies[0].name, 'Pub League Cup');
  assert.equal(c.stats.won, 5);
  assert.equal(c.stats.bestAvg, 61.2);

  // Promote to Season 2 in County Circuit
  const s2 = startNextSeason(c, { tierIndex: 1, random: rand });
  assert.equal(s2.season, 2);
  assert.equal(s2.tier, 1);
  assert.equal(s2.stage, 'league');
  assert.equal(s2.cup, null);
  assert.equal(s2.trophies.length, 1);
});

test('career: losing in the cup simulates the rest of the bracket and completes the season', () => {
  const rand = seeded(99);
  let c = newCareer(1, { startTier: 0, random: rand });
  for (let i = 0; i < 3; i++) c = recordCareerResult(c, { won: false, legs: [0, 2], avg: 30, now: i, random: rand });
  assert.equal(c.stage, 'cup');
  c = recordCareerResult(c, { won: false, legs: [0, 2], avg: 28, now: 10, random: rand });
  assert.equal(seasonComplete(c), true);
  assert.ok(c.cup.winner && c.cup.winner !== 'YOU');
  assert.equal(c.trophies.length, 0);
});

test('career: orderOfMerit ranks all 30 pros plus the player by points', () => {
  const c = newCareer(1, { startTier: 2, random: seeded(7) });
  const table = orderOfMerit(c, 'Sam', '🏴󠁧󠁢󠁥󠁮󠁧󠁿');
  assert.equal(table.length, 31);
  assert.equal(table[0].rank, 1);
  assert.equal(table.at(-1).rank, 31);
  const me = table.find(r => r.isYou);
  assert.ok(me);
  assert.equal(me.name, 'Sam');
  assert.equal(me.points, TIERS[2].startPts);
  for (let i = 1; i < table.length; i++) assert.ok(table[i - 1].points >= table[i].points);
});
