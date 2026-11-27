// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Stand-in for web/screens/game.js: the game is only said to be on screen.
import { setScreen } from './app.mjs';
export const BOT_WAIT = 2200, gameBoard = {}, renderGame = () => setScreen('game'), confirmNewGame = fn => fn();
