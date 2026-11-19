// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// "Add to Home Screen": offers to install the app when it is opened in a
// browser tab, and registers the service worker (sw.js) where the browser allows it.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(reg => {
    const own = performance.getEntriesByType('resource').map(r => r.name)
      .filter(u => u.startsWith(location.origin) && !new URL(u).pathname.startsWith('/api/'));
    reg.active?.postMessage({ cache: [location.href, ...own] });
  });
}

const ua = navigator.userAgent;
const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);  // iPads say "Macintosh"
const android = /Android/.test(ua);
const installed = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
const dismissed = () => { try { return !!localStorage.getItem('installDismissed'); } catch { return false; } };

const SHARE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 15V3M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>`;

let bar = null, ask = null;  // ask: the browser's own install prompt, when it offers one
function show() {
  if (installed || dismissed()) return;
  bar ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'install' }));
  bar.innerHTML = `<img src="icon-192.png" alt="">
    <div><b>Install Darts S.A.M</b><span>${
      ask ? 'Add it to your home screen to play full screen.'
      : ios ? `Tap ${SHARE} then <b>Add to Home Screen</b>.`
      : 'Open the browser menu <b>⋮</b> then tap <b>Add to Home screen</b>.'}</span></div>
    ${ask ? '<button class="primary" data-install="yes">Install</button>' : ''}
    <button class="ghost" data-install="no" aria-label="Dismiss">✕</button>`;
  refit();
}
// The bar can take room from the app (see .install in style.css): have app.js fit its screen again.
const refit = () => dispatchEvent(new Event('resize'));
function hide(forget) {
  bar?.remove(); bar = null;
  refit();
  if (forget) try { localStorage.setItem('installDismissed', '1'); } catch { /* private mode */ }
}

document.addEventListener('click', async e => {
  const choice = e.target.closest('[data-install]')?.dataset.install;
  if (choice === 'no') hide(true);
  if (choice === 'yes' && ask) {
    ask.prompt();
    const { outcome } = await ask.userChoice;
    ask = null;
    hide(outcome !== 'accepted');
  }
});
addEventListener('beforeinstallprompt', e => { e.preventDefault(); ask = e; show(); });
addEventListener('appinstalled', () => hide(false));

if (ios || android) show();
