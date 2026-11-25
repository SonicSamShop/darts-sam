// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// The drawn bracket (web/screens/bracket.js): where its boxes and lines go.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawBracket, layout, wirePath } from '../web/screens/bracket.js';
import { makeDraw, recordResult, startSlot } from '../web/tournament.js';

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

// Enough of a page for drawBracket to draw into: elements that keep what they are given.
class El {
  constructor(tag) { Object.assign(this, { tag, attrs: {}, children: [], textContent: '' }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren() { this.children = []; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
}
function drawn(t, opts) {
  globalThis.document = { createElementNS: (_, tag) => new El(tag) };
  const svg = new El('svg');
  drawBracket(svg, t, { nameOf: id => `P${id}`, ...opts });
  return svg;
}
const boxesIn = g => g.all().filter(e => e.attrs['data-box']).map(e => e.attrs['data-box']);

test('bracket: a match that can be tapped is one button over both its boxes', () => {
  const { a, b } = draw(4).data.slots[0];
  const t = recordResult(startSlot(draw(4), 0, 'm1'), 0, a, [2, 0], 'played');
  const svg = drawn(t, { taps: {
    0: { label: `P${a} 2, P${b} 0: see the scorecard`, sheet: 'm1' },
    1: { label: 'Play the other two', act: 'tour-play', i: 1 },
  } });
  const buttons = svg.all().filter(e => e.attrs.role === 'button');
  assert.equal(buttons.length, 2, 'one for each match, not one for each box');
  const [played, ready] = buttons;
  assert.deepEqual(boxesIn(played), ['0:0', '0:1']);
  assert.equal(played.attrs['data-sheet'], 'm1');
  assert.equal(played.attrs['aria-label'], `P${a} 2, P${b} 0: see the scorecard`);
  assert.equal(played.attrs.tabindex, '0', 'reached with Tab');
  assert.deepEqual(boxesIn(ready), ['0:2', '0:3']);
  assert.equal(ready.attrs['data-act'], 'tour-play');
  assert.equal(ready.attrs['data-i'], '1');
  assert.equal(ready.attrs['aria-label'], 'Play the other two');
  // The final is not ready: its boxes are drawn, and are no button.
  const all = svg.all();
  assert.ok(all.some(e => e.attrs['data-box'] === '1:0') && all.some(e => e.attrs['data-box'] === '2:0'));
  assert.ok(!buttons.some(g => boxesIn(g).includes('1:0')));
});

test('bracket: a tap is taken by a match\'s two boxes, not by the space between them', () => {
  const t = draw(8), L = layout(t);
  const svg = drawn(t, { taps: { 0: { label: 'A first-round match', act: 'tour-play', i: 0 }, 4: { label: 'A semi-final', act: 'tour-play', i: 4 }, 6: { label: 'The final', act: 'tour-play', i: 6 } } });
  const [first, semi, final] = svg.all().filter(e => e.attrs.role === 'button');
  const hits = g => g.children.filter(e => e.attrs.class === 'hit').map(e => [+e.attrs.x, +e.attrs.y, +e.attrs.width, +e.attrs.height]);
  // Round 1's two boxes are a pair, 12 apart: one area over both, as they are drawn.
  assert.deepEqual(hits(first), [[0, L.ys[0][0], 156, 46 + 34]]);
  // A later round's are far apart, with other matches' lines between them: each box takes its own taps.
  assert.deepEqual(hits(semi), [[L.x(1), L.ys[1][0], 156, 34], [L.x(1), L.ys[1][1], 156, 34]]);
  assert.deepEqual(hits(final), [[L.x(2), L.ys[2][0], 156, 34], [L.x(2), L.ys[2][1], 156, 34]]);
  assert.ok(L.ys[2][1] - L.ys[2][0] > 150, 'the finalists\' boxes are a long way apart');
  // Still one button a match: one stop for Tab, one name.
  assert.deepEqual([first, semi, final].map(g => [g.attrs.tabindex, g.attrs['aria-label'], boxesIn(g).length]),
    [['0', 'A first-round match', 2], ['0', 'A semi-final', 2], ['0', 'The final', 2]]);
});

test('bracket: with nothing to tap, no box is a button or takes the keyboard', () => {
  const all = drawn(draw(8), {}).all();
  assert.equal(all.filter(e => e.attrs['data-box']).length, 8 + 4 + 2 + 1);
  assert.ok(!all.some(e => 'role' in e.attrs || 'tabindex' in e.attrs || 'data-act' in e.attrs || 'data-sheet' in e.attrs));
});
