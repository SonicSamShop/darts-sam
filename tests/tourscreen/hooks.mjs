// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Loads web/screens/tournament.js without a browser: its imports of the app, the
// start screen and the landing page are swapped for the small stand-ins beside this file.
// And web/screens/start.js (starting a game: the question, the bull) the same way, over
// the real Tournament screen: the app, the menu, the game screen and the drawn board.
// And web/screens/playerspanel.js (the players' cards, for removing a player): the app,
// the menu and the settings it is drawn in.
const here = new URL('./', import.meta.url).href;
const swap = {
  'tournament.js': { '../app.js': 'app.mjs', './start.js': 'start.mjs', './landing.js': 'landing.mjs' },
  'start.js': { '../app.js': 'app.mjs', './home.js': 'home.mjs', './game.js': 'game.mjs', '../board.js': 'board.mjs' },
  'playerspanel.js': { '../app.js': 'app.mjs', './home.js': 'home.mjs', './settings.js': 'settings.mjs' },
};
export async function resolve(spec, ctx, next) {
  const file = ctx.parentURL?.match(/\/web\/screens\/(\w+\.js)$/)?.[1], to = swap[file]?.[spec];
  return to ? { url: here + to, shortCircuit: true } : next(spec, ctx);
}
