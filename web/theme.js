// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The look, before the first paint. Every page has this at the top of its <head>,
// ahead of its stylesheets. It puts the saved theme's class on <html> (app.js
// keeps it up to date from then on), and asks for that theme's lettering straight
// away instead of when the stylesheet first needs it, so the page spends as
// little time as it can drawn in a stand-in face.
// Only the files every screen of a theme uses are asked for here: themes.css
// names them all, and the rest are fetched when something is drawn in them.
(() => {
  const FONTS = {
    chalk: ['playpen-sans-100-800'],
    stage: ['barlow-condensed-600', 'barlow-condensed-700', 'anton-400'],
    arcade: ['russo-one-400'],
    sheet: ['rokkitt-500-800'],
    classic: [],  // the device's own lettering
  };
  let theme = 'chalk';
  try { theme = JSON.parse(localStorage.getItem('settings')).theme || theme; } catch { /* nothing saved: the usual look */ }
  if (!FONTS[theme]) theme = 'chalk';
  document.documentElement.className = 't-' + theme;
  for (const name of FONTS[theme]) {
    document.head.append(Object.assign(document.createElement('link'),
      { rel: 'preload', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous', href: `fonts/${name}.woff2` }));
  }
})();
