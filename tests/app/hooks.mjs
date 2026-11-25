// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Loads the app itself (web/app.js) without a browser, for testing how it joins its
// parts up: what it does when a sync is over, where it keeps its place in the history,
// which screen a button opens. The rules it goes by are its own (the engine, the games,
// the bots, and the data layer, web/sync.js); everything else it imports, every screen
// among them, is a stand-in that draws nothing and notes what it was asked: see
// standins.mjs, where a name app.js imports is either written out or made up as it is
// asked for.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = new URL('./', import.meta.url).href;
const REAL = ['./engine.js', './games/index.js', './bot.js', './sync.js'];
const isApp = url => /\/web\/app\.js$/.test(url ?? '');

export async function resolve(spec, ctx, next) {
  if (!isApp(ctx.parentURL) || REAL.includes(spec)) return next(spec, ctx);
  return { url: `${here}standin.mjs?of=${encodeURIComponent(spec)}&app=${encodeURIComponent(ctx.parentURL)}`, shortCircuit: true };
}

// The names app.js takes from `spec`, as its own import of it lists them.
function namesFrom(app, spec) {
  const source = readFileSync(fileURLToPath(app), 'utf8');
  const found = [...source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm)].find(m => m[2] === spec);
  if (!found) throw new Error(`app.js has no import of ${spec} that can be read`);
  return found[1].split(',').map(n => n.trim()).filter(Boolean);
}

export async function load(url, ctx, next) {
  const at = new URL(url);
  if (!at.pathname.endsWith('/tests/app/standin.mjs')) return next(url, ctx);
  const names = namesFrom(at.searchParams.get('app'), at.searchParams.get('of'));
  const source = `import * as own from '${here}standins.mjs';\n`
    + names.map(n => `export const ${n} = own.${n} ?? own.made('${n}');`).join('\n');
  return { format: 'module', source, shortCircuit: true };
}
