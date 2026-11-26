// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { ATMOSPHERE, careerIntensity, coughPlan, pickBanter, tierAtmosphere } from '../web/banter.js';
import { createSfx } from '../web/sfx.js';

const seeded = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

test('banter: tierAtmosphere escalates across all 5 career tiers and clamps out-of-range', () => {
  assert.equal(ATMOSPHERE.length, 5);
  for (let i = 1; i < ATMOSPHERE.length; i++) {
    assert.ok(ATMOSPHERE[i].crowd > ATMOSPHERE[i - 1].crowd);
    assert.ok(ATMOSPHERE[i].heat.length > ATMOSPHERE[i - 1].heat.length);
  }
  assert.equal(tierAtmosphere(-2).tier, 0);
  assert.equal(tierAtmosphere(99).tier, 4);
});

test('banter: careerIntensity scales with tier, cup finals, and proLevel fallback', () => {
  assert.equal(careerIntensity({ tier: 0 }), 0);
  assert.equal(careerIntensity({ tier: 0, isFinal: true }), 1);
  assert.equal(careerIntensity({ tier: 4, isFinal: true }), 4);
  assert.equal(careerIntensity({ proLevel: 1 }), 0);
  assert.equal(careerIntensity({ proLevel: 15 }), 4);
});

test('banter: pickBanter returns non-empty lines for every event and intensity, avoiding immediate repeats', () => {
  const kinds = [
    'intro', 'cough', 'playerMiss', 'playerBust', 'playerGood',
    'playerOnFinish', 'playerCheckout', 'botBig', 'botLeg', 'matchWin', 'matchLoss',
  ];
  const rand = seeded(123);
  for (const kind of kinds) {
    for (let lvl = 0; lvl <= 4; lvl++) {
      const a = pickBanter(kind, lvl, { random: rand });
      assert.ok(typeof a === 'string' && a.length > 0, `expected line for ${kind} at intensity ${lvl}`);
      const b = pickBanter(kind, lvl, { lastText: a, random: rand });
      assert.notEqual(b, a, `expected non-repeating line for ${kind} at intensity ${lvl}`);
    }
  }
  assert.equal(pickBanter('nonexistent', 0), '');
});

test('banter: coughPlan becomes more likely and faster at higher intensities and on a finish', () => {
  const p0 = coughPlan(0, { onFinish: false, random: () => 0.5 });
  const p4 = coughPlan(4, { onFinish: false, random: () => 0.5 });
  const p4Fin = coughPlan(4, { onFinish: true, random: () => 0.5 });
  assert.ok(p4.prob > p0.prob);
  assert.ok(p4Fin.prob > p4.prob);
  assert.ok(p4.delayMs < p0.delayMs);
  assert.equal(coughPlan(0, { random: () => 0.99 }).willCough, false);
  assert.equal(coughPlan(4, { onFinish: true, random: () => 0.01 }).willCough, true);
});

test('sfx: ambience, cough, cheer and groan fail silently when Web Audio is unavailable', () => {
  const sfx = createSfx();
  assert.equal(sfx.ambienceActive(), false);
  assert.doesNotThrow(() => {
    sfx.ambienceStart(2);
    sfx.cough(3);
    sfx.cheer('small', 1);
    sfx.cheer('medium', 2);
    sfx.cheer('big', 4);
    sfx.groan(2);
    sfx.ambienceStop();
  });
  assert.equal(sfx.ambienceActive(), false);
});
