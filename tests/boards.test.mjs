// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// How a board is named and described (web/boards.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardName, boardState, dayStart } from '../web/boards.js';

const b = (id, more = {}) => ({ id, brand: null, model: null, bought: null, notes: null, up: null, down: 0, created: id.charCodeAt(0), ...more });

test('a board is called by its brand and model, or by its place in the list', () => {
  const all = [b('a', { brand: 'Winmau', model: 'Blade 6' }), b('b'), b('c', { model: 'Pro' }), b('d')];
  assert.deepEqual(all.map(x => boardName(x, all)), ['Winmau Blade 6', 'Board 2', 'Pro', 'Board 4']);
});

test('two boards that read the same are told apart by the year bought, then by number', () => {
  const all = [b('a', { brand: 'Winmau', bought: 2020 }), b('b', { brand: 'Winmau', bought: 2024 }), b('c', { brand: 'Winmau', bought: 2024 })];
  assert.deepEqual(all.map(x => boardName(x, all)), ['Winmau (2020)', 'Winmau (2024)', 'Winmau (2024, 2)']);
  const plain = [b('a', { brand: 'Target' }), b('b', { brand: 'target' })];
  assert.deepEqual(plain.map(x => boardName(x, plain)), ['Target', 'target (2)']);
});

test('what a board is doing: on the wall, taken down, played on until, or not up yet', () => {
  const day = ts => `d${ts}`;
  assert.equal(boardState(b('a', { up: 5, down: null }), day), 'On the wall · up since d5');
  assert.equal(boardState(b('a', { up: null, down: null }), day), 'On the wall');
  assert.equal(boardState(b('a', { up: 5, down: 9 }), day), 'Taken down · d5 to d9');
  assert.equal(boardState(b('a', { up: null, down: 9 }), day), 'Played on until d9');
  assert.equal(boardState(b('a'), day), 'Not put up yet');
});

test('a date picked is the start of that day here', () => {
  const t = dayStart('2026-03-03');
  const d = new Date(t);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 2, 3, 0, 0]);
  assert.equal(dayStart(''), null);
});
