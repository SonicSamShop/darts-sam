// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const state = {
  match: null,
  screen: 'game',
  settings: { voice: false, sfx: false, entry: 'board' },
  storeData: new Map(),
};

globalThis.__turnDelayState = state;
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 0;
globalThis.setInterval = () => 0;  // game.js has a top-level match clock interval that would keep Node from exiting
const fakeEl = () => ({ innerHTML: '', textContent: '', hidden: false, classList: { toggle() {}, add() {}, remove() {} }, toggleAttribute() {}, addEventListener() {}, setAttribute() {} });
globalThis.document = {
  addEventListener: () => {},
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  getElementById: () => fakeEl(),
};

const loader = `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const REAL = new Set(['../engine.js', '../tv-camera.js', '../voice.js', '../speech.js', '../sync.js', '../bot.js', '../banter.js', '../routine.js']);
export async function resolve(spec, ctx, next) {
  const parent = ctx.parentURL ?? '';
  if (/\\/web\\/screens\\/game\\.js$/.test(parent) && !REAL.has(spec)) {
    return { url: 'turndelay-stub:///' + encodeURIComponent(spec) + '?from=' + encodeURIComponent(parent), shortCircuit: true };
  }
  if (/\\/tests\\/turndelay\\.test\\.mjs$/.test(parent) && spec === '../web/app.js') {
    const gameUrl = new URL('../web/screens/game.js', parent).href;
    return { url: 'turndelay-stub:///' + encodeURIComponent('../app.js') + '?from=' + encodeURIComponent(gameUrl), shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (!url.startsWith('turndelay-stub:///')) return next(url, ctx);
  const u = new URL(url);
  const spec = decodeURIComponent(u.pathname.slice(1));
  const from = fileURLToPath(u.searchParams.get('from'));
  const src = readFileSync(from, 'utf8');
  const m = [...src.matchAll(/^import\\s*\\{([^}]*)\\}\\s*from\\s*'([^']+)';/gm)].find(x => x[2] === spec);
  const names = m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
  if (spec === '../board.js') {
    const realBoard = new URL('../board.js', u.searchParams.get('from')).href;
    return {
      format: 'module',
      source: 'export { label, spoken, value } from ' + JSON.stringify(realBoard) + '; export const buildBoard = () => ({ showDarts() {}, showTarget() {}, viewBox: () => [0, 0, 100, 100] });',
      shortCircuit: true,
    };
  }
  if (spec === '../app.js') {
    const map = {
      $app: '{ innerHTML: "" }',
      account: '{}',
      atmosphereOn: '() => false',
      cameraCount: '0',
      careerOpt: '() => false',
      connected: 'false',
      dartsName: '() => ""',
      data: '{ saveMatch() {} }',
      esc: 's => String(s)',
      fit: '() => {}',
      flagHtml: '() => ""',
      goHome: '() => {}',
      icon: '() => ""',
      mark: '() => {}',
      match: 'undefined',
      phone: '{ scoring: () => false }',
      queueSync: '() => {}',
      refreshStatus: '() => {}',
      say: '() => {}',
      sayBanter: '() => {}',
      screen: '"game"',
      setMatch: 'm => { globalThis.__turnDelayState.match = m; }',
      setScreen: 's => { globalThis.__turnDelayState.screen = s; }',
      setsOf: '() => []',
      settings: 'globalThis.__turnDelayState.settings',
      sfx: '{ dart() {}, win() {}, bust() {}, ton() {}, ambienceStop() {} }',
      sfxOn: '() => false',
      speech: '{ active: () => false, supported: () => false, stop() {} }',
      store: '{ get: (k, d) => globalThis.__turnDelayState.storeData.get(k) ?? d, set: (k, v) => globalThis.__turnDelayState.storeData.set(k, v) }',
      tracker: '{ entered() {}, moved() {}, undone() {} }',
    };
    const code = names.map(n => n === 'match'
      ? 'export let match = null; export function __setMatch(m) { match = m; }'
      : 'export const ' + n + ' = ' + (map[n] ?? '(() => {})') + ';').join('\\n');
    return { format: 'module', source: code, shortCircuit: true };
  }
  const code = names.map(n => {
    if (n === 'WARMUP_STEPS') return 'export const WARMUP_STEPS = [];';
    if (n === 'menu') return 'export const menu = {};';
    if (n === 'bases') return 'export const bases = null;';
    if (n === 'photoAsk') return 'export const photoAsk = null;';
    if (n === 'achievementsOn' || n === 'photosOn') return 'export const ' + n + ' = () => false;';
    if (n === 'earnedLine' || n === 'slipHtml' || n === 'summaryHtml' || n === 'quitTerms') return 'export const ' + n + ' = () => "";';
    return 'export const ' + n + ' = () => {};';
  }).join('\\n');
  return { format: 'module', source: code, shortCircuit: true };
}
`;

register('data:text/javascript,' + encodeURIComponent(loader));

const appStub = await import('../web/app.js');
const { newMatch, compute } = await import('../web/engine.js');
const game = await import('../web/screens/game.js');

let nextId = 1;
function setCurrentMatch(m) {
  m.id ??= `m${nextId++}`;
  state.match = m;
  appStub.__setMatch(m);
  game.gameBoard.ui = { showDarts() {}, showTarget() {}, viewBox: () => [0, 0, 100, 100] };
}

test('two or more players: 4s delay between visits blocks double counting, clears after 4s or on undo', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
  const m = newMatch('x01', ['Sam', 'Alex'], { start: 501, out: 'double' });
  setCurrentMatch(m);

  // Player 1 throws 3 darts
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'cam' });
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'cam' });
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'cam' });
  assert.equal(m.log.length, 3);
  assert.equal(compute(m).current, 1);

  // Immediately (and at 3999ms), next player's throws are blocked
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'cam' });
  game.padQuick(60);
  game.noScore();
  assert.equal(m.log.length, 3);

  t.mock.timers.tick(3999);
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 3);

  // At 4000ms, the delay expires and the next player's throw counts
  t.mock.timers.tick(1);
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 4);

  // Undo during the 4s delay clears the delay immediately
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 6);
  assert.equal(compute(m).current, 0);
  game.push({ t: 'dart', seg: 5, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 6); // blocked

  game.undo();
  assert.equal(m.log.length, 5);
  game.push({ t: 'dart', seg: 19, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 6); // accepted immediately after undo
  t.mock.timers.reset();
});

test('single player: no 4s delay between visits', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
  const m = newMatch('x01', ['Sam'], { start: 501, out: 'double' });
  setCurrentMatch(m);

  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 3);

  // Next visit's first dart is accepted immediately
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 4);
  t.mock.timers.reset();
});

test('two or more players: turnHold setting configures or disables the delay', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
  const m = newMatch('x01', ['Sam', 'Alex'], { start: 501, out: 'double' });
  setCurrentMatch(m);

  // Custom 6s delay
  state.settings.turnHold = 6;
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  t.mock.timers.tick(5000);
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 3); // still blocked at 5s
  t.mock.timers.tick(1000);
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 4); // accepted at 6s

  // 0 disables the delay
  state.settings.turnHold = 0;
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 6);
  game.push({ t: 'dart', seg: 20, mult: 1, src: 'tap' });
  assert.equal(m.log.length, 7); // accepted immediately

  delete state.settings.turnHold;
  t.mock.timers.reset();
});
