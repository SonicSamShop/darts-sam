// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Stand-in for web/screens/settings.js: the settings are only said to be drawn again.
export const drawn = { times: 0 };
export const renderSettings = () => { drawn.times++; };
