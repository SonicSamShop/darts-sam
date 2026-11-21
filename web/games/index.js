// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// To add a game: create a module next to this file and add it to the list.
import x01 from './x01.js';
import cricket from './cricket.js';
import clock from './clock.js';
import bobs27 from './bobs27.js';
import shanghai from './shanghai.js';
import countup from './countup.js';
import c121 from './c121.js';
import killer from './killer.js';
import random from './random.js';
import free from './free.js';

export const GAMES = [x01, cricket, killer, clock, bobs27, shanghai, c121, countup, random, free];
