// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// A newer desktop app, offered with what has changed in it (server/release.py),
// and Settings → About, which says which version this is.

import { renderSettings } from './settings.js';
import { SOURCE, api, appBuild, esc, match, pi, screen } from '../app.js';
import { COMPARE_CHECKED, compareTable } from './compare.js';

// ---------- a newer desktop app (server/release.py) ----------
// The desktop app asks the site once, when it starts, whether there is a newer
// version. If there is, this offers it with what has changed since this one.
// The Pi and the hosted version never have one to offer.
let release = null;  // {version, checked, available, download, page} from the server at home
let releaseAsk = null;
let releaseDismissed = false;
export async function loadRelease(tries = 0) {
  try { release = await api('/update', 'GET', undefined, 4000); } catch { return; }  // a Pi from before this
  if (screen === 'settings') renderSettings();  // the version shows there
  if (!release.checked && tries < 8) return setTimeout(() => loadRelease(tries + 1), 2500);
  if (release.available && !releaseDismissed && !(screen === 'game' && match)) showRelease();
}

// Settings → About: "Darts S.A.M version 1.2 (build 61, a140399)", and where the source is.
export const appRelease = () => appBuild?.release ?? release?.version ?? '';
export function aboutPanel() {
  const v = appRelease();
  const extra = [appBuild?.build != null && `build ${appBuild.build}`, appBuild?.commit].filter(Boolean).join(', ');
  return `<div class="settings">
    ${v ? `<p>Darts S.A.M version ${esc(v)}${extra ? ` <span class="muted">(${esc(extra)})</span>` : ''}</p>` : ''}
    <p class="muted small">Free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0</a>:
      <a href="${SOURCE}" target="_blank" rel="noopener">source code</a>.</p>
    <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p>
    <h3>How Darts S.A.M compares</h3>
    ${compareTable()}
    <p class="muted small">From Autodarts' and DartCounter's own websites on ${COMPARE_CHECKED}.
      <a href="compare.html" target="_blank" rel="noopener">The full comparison</a></p></div>`;
}
const MB = n => `${Math.round(n / 1e6)} MB`;
function releaseDone(d) {
  if (d.next === 'quit') return navigator.platform.startsWith('Mac')
    ? 'Downloaded. It is opening now: drag Darts S.A.M into Applications (choose Replace), then open it again. This one closes by itself.'
    : 'Downloaded. The new version is starting, and this one closes by itself.';
  return `Downloaded to ${esc(d.path)}. Unpack it and run <b>install.sh</b> in it, as the first time, then start Darts S.A.M again.`;
}
function showRelease() {
  const a = release.available, d = release.download || {};
  releaseAsk ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'report shareask releaseask' }));
  const busy = d.state === 'downloading' || d.state === 'ready';
  releaseAsk.innerHTML = `<div class="report-in">
    <h1>Darts S.A.M ${esc(a.version)} is ready</h1>
    <p class="muted">You have version ${esc(release.version)}.${a.size ? ` The download is ${MB(a.size)}.` : ''}</p>
    ${a.changes.map(v => `<h3>What's new in ${esc(v.version)}</h3>
      <ul>${v.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`).join('') || '<p>Fixes and improvements.</p>'}
    ${d.state === 'downloading' ? `<p>Downloading… ${d.total ? `${Math.floor(100 * d.done / d.total)}%` : MB(d.done)}</p>` : ''}
    ${d.state === 'ready' ? `<p>${releaseDone(d)}</p>` : ''}
    ${d.state === 'failed' ? `<p class="warn">The download didn't work (${esc(d.error || 'no answer')}).
      You can get the new version from ${release.page ? `<a href="${esc(release.page)}" target="_blank" rel="noopener">${esc(release.page)}</a>` : 'the Darts S.A.M site'} instead.</p>` : ''}
    <div class="row">${busy ? '' : `<button class="primary" data-release="update">${d.state === 'failed' ? 'Try again' : 'Update'}</button>`}
      ${d.state === 'ready' && d.next === 'quit' ? '' : `<button data-release="later">${d.state === 'ready' ? 'Close' : 'Not now'}</button>`}</div></div>`;
}
async function followDownload() {
  try { release = await api('/update', 'GET', undefined, 4000); } catch { /* asked again below */ }
  if (!releaseAsk) return;
  showRelease();
  if (release.download?.state === 'downloading') setTimeout(followDownload, 700);
}
document.addEventListener('click', async e => {
  const act = e.target.closest('.releaseask [data-release]')?.dataset.release;
  if (act === 'later') { releaseDismissed = true; releaseAsk?.remove(); releaseAsk = null; }
  if (act === 'update') {
    try { release = await api('/update', 'POST', undefined, 10000); } catch (err) {
      release.download = { state: 'failed', error: err.status ? err.message : `${pi()} did not answer` };
    }
    showRelease();
    followDownload();
  }
});
