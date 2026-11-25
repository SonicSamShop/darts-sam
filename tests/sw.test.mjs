// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// node --test tests/
// The service worker's list of files to keep (web/sw.js, FILES): every module the app
// loads as it starts has to be in it, or an installed app opened with no network, before
// it has ever loaded that module, has a hole in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const read = f => readFileSync(join(web, f), 'utf8');
// What a module imports as it loads: import ... from './x.js', import './x.js', export ... from './x.js'.
const imports = src => [...src.matchAll(/^\s*(?:import|export)\s+(?:[\w*{}\s,$]+\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm)].map(m => m[1]);

// Every module reached from the page's own scripts (index.html), by path from web/.
function loaded() {
  const todo = [...read('index.html').matchAll(/<script[^>]*\ssrc="([^"]+\.js)"/g)].map(m => m[1]), seen = new Set();
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of imports(read(f))) todo.push(relative(web, resolve(web, dirname(f), spec)));
  }
  return [...seen].sort();
}

test('service worker: every module the app starts with is kept for when there is no network', () => {
  const kept = new Set([...read('sw.js').match(/const FILES = \[([^]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
  const all = loaded();
  assert.ok(all.includes('screens/tournament.js') && all.includes('games/x01.js'), 'the walk finds the app\'s modules');
  assert.deepEqual(all.filter(f => !kept.has(f)), []);
});
