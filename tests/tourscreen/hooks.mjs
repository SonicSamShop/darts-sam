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
// landing page and the stats screen. Asked for as home.js?tournament-on-menu or
// ?tournament-off-menu it is a copy of its own with the TOURNAMENT_ON_MENU constant set
// that way (load, below), so both menus are tried whichever way the file has it.
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
// home.js?tournament-on-menu and home.js?tournament-off-menu: a copy with the constant
// set that way, whichever way the file itself has it.
const SET = /const TOURNAMENT_ON_MENU = (true|false);/;
export async function load(url, ctx, next) {
  const way = url.match(/\/web\/screens\/home\.js\?tournament-(on|off)-menu$/)?.[1];
  if (!way) return next(url, ctx);
  const got = await next(url, ctx), source = String(got.source);
  if (!SET.test(source)) throw new Error('home.js has no TOURNAMENT_ON_MENU constant to set');
  return { ...got, source: source.replace(SET, `const TOURNAMENT_ON_MENU = ${way === 'on'};`) };
}
