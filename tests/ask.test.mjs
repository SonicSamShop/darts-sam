// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_BELOW, best, choices, createQueue, needsAsk, question } from '../web/ask.js';

const odds = (...o) => o.map(([seg, mult, p]) => ({ seg, mult, p }));
const dart = (...o) => ({ type: 'dart', seg: o[0][0], mult: o[0][1], x: 1, y: 2, odds: odds(...o) });

test('it asks when the likeliest bed is under 80%', () => {
  assert.equal(ASK_BELOW, 0.8);
  assert.equal(needsAsk(dart([20, 3, 0.8], [20, 1, 0.2])), false);
  assert.equal(needsAsk(dart([20, 3, 0.79], [20, 1, 0.21])), true);
  assert.equal(needsAsk({ type: 'dart', seg: 20, mult: 1 }), false, 'cameras that crossed lines carry no odds');
  assert.equal(needsAsk({ type: 'takeout' }), false);
});

test('the choices are the beds worth offering, likeliest first', () => {
  const c = choices(dart([20, 3, 0.71], [20, 1, 0.25], [5, 3, 0.03]));
  assert.deepEqual(c.map(x => x.label), ['T20', '20']);
  assert.deepEqual(c.map(x => x.pct), [71, 25]);
  assert.deepEqual(c.map(x => [x.seg, x.mult]), [[20, 3], [20, 1]]);
});

test('a dart not asked about is scored in its likeliest bed', () => {
  const ev = { ...dart([20, 1, 0.85], [20, 3, 0.15]), seg: 20, mult: 3 };  // the tip itself was just inside the treble
  assert.deepEqual([best(ev).seg, best(ev).mult], [20, 1]);
  assert.equal(best({ type: 'takeout' }).type, 'takeout');
});

test('the question as the caller says it', () => {
  assert.equal(question(dart([20, 3, 0.6], [20, 1, 0.4])), 'Treble 20 or 20?');
  assert.equal(question(dart([25, 2, 0.5], [25, 1, 0.45], [0, 0, 0.05])), 'Bullseye or 25?');
});

test('sure darts go straight through', () => {
  const passed = [], asked = [];
  const q = createQueue({ onPass: e => passed.push(e), onAsk: e => asked.push(e) });
  q.add(dart([20, 1, 0.95]));
  q.add({ type: 'takeout' });
  assert.equal(passed.length, 2);
  assert.equal(asked.length, 0);
});

test('a dart thrown while a question is open waits its turn', () => {
  const passed = [], asked = [];
  const q = createQueue({ onPass: e => passed.push(e), onAsk: e => asked.push(e) });
  const a = dart([20, 3, 0.6], [20, 1, 0.4]), b = dart([1, 1, 0.99]), c = dart([5, 3, 0.5], [5, 1, 0.5]);
  q.add(a); q.add(b); q.add(c); q.add({ type: 'takeout' });
  assert.equal(q.current(), a);
  assert.equal(q.size(), 4);
  assert.equal(passed.length, 0, 'nothing goes into the game ahead of the dart being asked about');
  q.settle({ seg: 20, mult: 1 });
  assert.deepEqual(passed.map(e => [e.seg, e.mult]), [[20, 1], [1, 1]]);
  assert.equal(q.current(), c, 'the next unsure dart is asked about next');
  q.settle(null);  // "somewhere else": the player taps it in
  assert.deepEqual(passed.map(e => e.type), ['dart', 'dart', 'takeout']);
  assert.equal(q.current(), null);
  assert.equal(q.size(), 0);
});

test('clearing forgets the question and what waited behind it', () => {
  const passed = [];
  const q = createQueue({ onPass: e => passed.push(e), onAsk: () => {} });
  q.add(dart([20, 3, 0.6], [20, 1, 0.4])); q.add(dart([1, 1, 0.99]));
  q.clear();
  assert.equal(q.current(), null);
  assert.equal(q.size(), 0);
  assert.equal(passed.length, 0);
});

test('a dart the player wants to change is asked about however sure the camera was', () => {
  assert.equal(needsAsk({ ...dart([20, 1, 0.95]), ask: true }), true);
});

test('an answered dart says it was asked about', () => {
  const passed = [];
  const q = createQueue({ onPass: e => passed.push(e), onAsk: () => {} });
  q.add(dart([20, 3, 0.6], [20, 1, 0.4]));
  q.settle({ seg: 20, mult: 3, asked: true });
  assert.equal(passed[0].asked, true);
});
