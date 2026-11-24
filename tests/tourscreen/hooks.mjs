// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Loads web/screens/tournament.js without a browser: its imports of the app, the
// start screen and the landing page are swapped for the small stand-ins beside this file.
const here = new URL('./', import.meta.url).href;
const swap = { '../app.js': 'app.mjs', './start.js': 'start.mjs', './landing.js': 'landing.mjs' };
export async function resolve(spec, ctx, next) {
  if (ctx.parentURL?.endsWith('/web/screens/tournament.js') && swap[spec]) return { url: here + swap[spec], shortCircuit: true };
  return next(spec, ctx);
}
