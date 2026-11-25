// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Loads web/screens/tournament.js without a browser: its imports of the app, the
// start screen and the landing page are swapped for the small stand-ins beside this file.
// And web/screens/start.js (starting a game: the question, the bull) the same way, over
// the real Tournament screen: the app, the menu, the game screen and the drawn board.
// And web/screens/playerspanel.js (the players' cards, for removing a player): the app,
// the menu and the settings it is drawn in.
// And web/screens/home.js (the menu itself, for its lines about tournaments): the app, the
// landing page and the stats screen. Asked for as home.js?tournament-on-menu it is a copy
// of its own with the TOURNAMENT_ON_MENU constant turned on (load, below): the file itself
// is committed with it off.
const here = new URL('./', import.meta.url).href;
const swap = {
  'tournament.js': { '../app.js': 'app.mjs', './start.js': 'start.mjs', './landing.js': 'landing.mjs' },
  'start.js': { '../app.js': 'app.mjs', './home.js': 'home.mjs', './game.js': 'game.mjs', '../board.js': 'board.mjs' },
  'playerspanel.js': { '../app.js': 'app.mjs', './home.js': 'home.mjs', './settings.js': 'settings.mjs' },
  'home.js': { '../app.js': 'app.mjs', './landing.js': 'landing.mjs', './stats.js': 'stats.mjs' },
};
export async function resolve(spec, ctx, next) {
  const file = ctx.parentURL?.match(/\/web\/screens\/(\w+\.js)(\?.*)?$/)?.[1], to = swap[file]?.[spec];
  return to ? { url: here + to, shortCircuit: true } : next(spec, ctx);
}
const OFF = 'const TOURNAMENT_ON_MENU = false;';
export async function load(url, ctx, next) {
  if (!url.endsWith('/web/screens/home.js?tournament-on-menu')) return next(url, ctx);
  const got = await next(url, ctx), source = String(got.source);
  if (!source.includes(OFF)) throw new Error(`home.js has no "${OFF}" to turn on`);
  return { ...got, source: source.replace(OFF, OFF.replace('false', 'true')) };
}
