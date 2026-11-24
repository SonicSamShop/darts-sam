// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// The drawn bracket (web/screens/bracket.js): where its boxes and lines go.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layout, wirePath } from '../web/screens/bracket.js';
import { makeDraw } from '../web/tournament.js';

const people = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}` }));
const draw = n => makeDraw({ id: 't1', name: 'Test', entrants: people(n), opts: { start: 501, out: 'double' }, now: 1 }, () => 0.5);

test('bracket: each box sits midway between the two that feed it', () => {
  const L = layout(draw(8));
  assert.equal(L.ys.length, 4, 'three rounds and the Winner');
  assert.equal(L.ys[0].length, 8);
  assert.equal(L.ys[1][0], (L.ys[0][0] + L.ys[0][1]) / 2);
  assert.equal(L.ys[2][1], (L.ys[1][2] + L.ys[1][3]) / 2);
  assert.equal(L.ys[3][0], (L.ys[0][0] + L.ys[0][7]) / 2, 'the Winner box is the middle of round 1');
});

test('bracket: four columns of 156 with 40 between them, for 8 players', () => {
  const L = layout(draw(8));
  assert.equal(L.w, 4 * 156 + 3 * 40);
  assert.equal(L.x(0), 0);
  assert.equal(L.x(1), 156 + 40);
  assert.equal(L.h, 44 + 8 * 46 - (46 - 34) + 4);
});

test('bracket: 3 players draw a bracket of 4, 16 one of 16', () => {
  assert.equal(layout(draw(3)).ys[0].length, 4);
  assert.equal(layout(draw(16)).ys.length, 5);
});

test('bracket: a line runs from a box, round the corner, to the box it plays for', () => {
  const L = layout(draw(8));
  const d = wirePath(L, 0, 1);
  assert.ok(d.startsWith(`M${156} ${L.ys[0][1] + 17} `), d);
  const end = d.match(/H(-?[\d.]+)$/);
  assert.equal(+end[1], L.x(1));
  assert.ok(d.includes(`V${L.ys[1][0] + 17} `), d);
});
