// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Service worker: keeps a copy of the app's own files on the device so the
// app opens and runs with no Pi and no network at all.
// It still tries the Pi first, so editing files on the Pi updates the app; if
// the Pi doesn't answer quickly the saved copy is used instead.
// Browsers only run this over https or on localhost (see docs/setup.md).
const CACHE = 'dartssam-v18';
// Python for the browser, for the phone's camera (Beta): 27 MB that never
// change for a given version (tools/fetch_pyodide.py's VERSION), so they are
// kept apart, not thrown away with each new version of the app, and only
// fetched by phones that use the camera.
const VISION = 'dartssam-vision-314.0.7';
const DATA = 'dartssam-data';  // stats saved by app.js for showing offline
const WAIT = 2500;             // ms to give the Pi before using the saved copy

// Everything the app needs to start. Files not listed here (a new game module,
// say) are still saved the first time they are loaded.
const FILES = [
  './', 'index.html', 'version.json', 'app.js', 'api.js', 'account.js', 'track.js', 'update.js', 'sync.js', 'stats.js', 'engine.js', 'board.js', 'bot.js', 'install.js', 'voice.js', 'theme.js',
  'phoneui.js', 'phonecam.js', 'ask.js', 'phonecam.css',
  'games/index.js', 'games/x01.js', 'games/cricket.js', 'games/clock.js', 'games/bobs27.js', 'games/shanghai.js', 'games/bermuda.js', 'games/segment.js', 'games/rcheckout.js', 'games/countup.js', 'games/c121.js', 'games/random.js', 'games/killer.js', 'games/gotcha.js', 'games/free.js',
  'style.css', 'themes.css', 'manifest.json', 'privacy.html', 'faq.html', 'download.html', 'opensource.html', 'releases.html',
  'icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'fonts/anton-400.woff2', 'fonts/barlow-condensed-600.woff2', 'fonts/barlow-condensed-700.woff2',
  'fonts/bungee-400.woff2', 'fonts/playpen-sans-100-800.woff2',
  'fonts/rokkitt-500-800.woff2', 'fonts/russo-one-400.woff2', 'fonts/special-elite-400.woff2',
  'fonts/vt323-400.woff2',
];
const save = (cache, url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {});

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => Promise.all(FILES.map(f => save(c, f)))).then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  // drop caches left over from earlier versions and the app's earlier names
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DATA && k !== VISION).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

// The page sends the list of files it loaded before this worker took over.
// Before it reloads onto a new version it asks for the Pi to be tried first again.
self.addEventListener('message', e => {
  if (e.data?.fresh) slowUntil = 0;
  if (!Array.isArray(e.data?.cache)) return;
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(e.data.cache.map(u => save(c, u)))));
});

let slowUntil = 0;  // the Pi didn't answer in time: don't keep the app waiting for a while
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')
      || url.pathname.startsWith('/downloads/')) return;  // the apps to download are far too big to keep a copy of
  if (url.pathname.startsWith('/vision/pyodide/')) {  // fixed files: the saved copy first
    e.respondWith(caches.open(VISION).then(async c => (await c.match(e.request)) || fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    })));
    return;
  }
  const fresh = fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); return caches.open(CACHE).then(c => c.put(e.request, copy)).then(() => res); }
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));  // a slow answer is still saved for next time
  e.respondWith((async () => {
    const saved = await caches.match(e.request, { ignoreSearch: true });
    if (!saved) return fresh.catch(() => Response.error());
    if (Date.now() < slowUntil) return saved;
    const res = await Promise.race([fresh.catch(() => null), new Promise(done => setTimeout(done, WAIT, 'slow'))]);
    if (res === 'slow') slowUntil = Date.now() + 30000;
    return res && res !== 'slow' ? res : saved;
  })());
});
