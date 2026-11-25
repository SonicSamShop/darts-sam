// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Stand-in for web/screens/stats.js: the one thing the menu takes from it.
export const pct = (n, of) => (of ? `${(n / of * 100).toFixed(1)}%` : '–');
