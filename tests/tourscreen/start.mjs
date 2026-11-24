// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Stand-in for web/screens/start.js: the last match asked for is kept, not started.
export let asked = null;
export const askFirst = (act, play) => { asked = { act, play }; };
