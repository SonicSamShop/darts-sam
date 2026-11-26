// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// A newer desktop app, offered with what has changed in it (server/release.py),
// and Settings → About, which says which version this is.

import { renderSettings } from './settings.js';
import { SOURCE, api, appBuild, esc, idle, match, machine, saveSettings, screen, settings } from '../app.js';
import { switchRow } from './settings.js';

// ---------- a newer desktop app (server/release.py) ----------
// The desktop app asks the site once, when it starts, whether there is a newer
// version, and if there is it downloads it and puts it in place of itself, for
// next start ("installed"). With "Restart for updates between games" on, this
// restarts it onto the new one as soon as no game is going. Only where it can't
// replace itself ("downloaded", or it went wrong) is it offered here, with what
// has changed since this one. The server and the hosted version never have one.
let release = null;  // {version, new, checked, available, download, page} from the server at home
let releaseAsk = null;
let releaseDismissed = false;
let restartTimer = null;
export async function loadRelease(tries = 0) {
  try { release = await api('/update', 'GET', undefined, 4000); } catch { return; }  // a server from before this
  if (screen === 'settings') renderSettings();  // the version shows there, and the update's state
  if (tries === 0) showUpdated();
  const d = release.download?.state;
  // not asked yet, or (from the start) still downloading: look again in a while
  if ((!release.checked || (release.available && (d === 'idle' || d === 'downloading'))) && tries < 400) {
    return setTimeout(() => loadRelease(tries + 1), release.checked ? 3000 : 2500);
  }
  if (d === 'installed') return restartWhenFree();
  if (release.available && !releaseDismissed && !(screen === 'game' && match)) showRelease();
}

// Once the new version is in place: onto it, between games, if the player said so.
function restartWhenFree() {
  clearTimeout(restartTimer);
  if (!settings.restartForUpdate || release?.download?.state !== 'installed') return;
  if (!idle()) { restartTimer = setTimeout(restartWhenFree, 5000); return; }
  api('/update/restart', 'POST', undefined, 4000).catch(() => {});
}
export function setRestartForUpdate(on) {
  settings.restartForUpdate = on;
  saveSettings();
  restartWhenFree();
}

// After an update: what is new in the version that has just started, once.
function showUpdated() {
  const v = release?.version;
  if (!v) return;
  let before = null;
  try { before = localStorage.getItem('releaseSeen'); localStorage.setItem('releaseSeen', v); } catch { return; }
  if (!before || before === v || !release.new?.length) return;
  releaseAsk ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'report shareask releaseask' }));
  releaseAsk.innerHTML = `<div class="report-in">
    <h1>Darts S.A.M is now version ${esc(v)}</h1>
    <h3>What's new</h3>
    <ul>${release.new.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <div class="row"><button class="primary" data-release="later">OK</button></div></div>`;
}

// Settings → About: "Darts S.A.M version 1.2 (build 61, a140399)", and where the source is.
export const appRelease = () => appBuild?.release ?? release?.version ?? '';
export function aboutPanel() {
  const v = appRelease();
  const installed = release?.download?.state === 'installed' && release.available;
  const extra = [appBuild?.build != null && `build ${appBuild.build}`, appBuild?.commit].filter(Boolean).join(', ');
  return `<div class="settings">
    ${v ? `<p>Darts S.A.M version ${esc(v)}${extra ? ` <span class="muted">(${esc(extra)})</span>` : ''}</p>` : ''}
    ${installed ? `<p>Version ${esc(release.available.version)} is installed and starts the next time you open Darts S.A.M.</p>
      <div class="row"><button class="primary" data-release="restart">Restart now</button></div>` : ''}
    ${release?.checked ? switchRow('Restart for updates between games', !!settings.restartForUpdate,
      `data-release="${settings.restartForUpdate ? 'restartoff' : 'restarton'}"`,
      'New versions are always installed by themselves. On, Darts S.A.M also restarts onto one straight away, when no game is going; off, it waits until you next open it.') : ''}
    <p class="muted small">Free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0</a>:
      <a href="${SOURCE}" target="_blank" rel="noopener">source code</a>.</p>
    <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p></div>`;
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
  const busy = d.state === 'downloading' || d.state === 'ready' || d.state === 'installed';
  releaseAsk.innerHTML = `<div class="report-in">
    <h1>Darts S.A.M ${esc(a.version)} is ready</h1>
    <p class="muted">You have version ${esc(release.version)}.${a.size ? ` The download is ${MB(a.size)}.` : ''}</p>
    ${a.changes.map(v => `<h3>What's new in ${esc(v.version)}</h3>
      <ul>${v.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`).join('') || '<p>Fixes and improvements.</p>'}
    ${d.state === 'downloading' ? `<p>Downloading… ${d.total ? `${Math.floor(100 * d.done / d.total)}%` : MB(d.done)}</p>` : ''}
    ${d.state === 'ready' ? `<p>${releaseDone(d)}</p>` : ''}
    ${d.state === 'installed' ? '<p>Installed. It starts the next time you open Darts S.A.M.</p>' : ''}
    ${d.state === 'failed' ? `<p class="warn">The download didn't work (${esc(d.error || 'no answer')}).
      You can get the new version from ${release.page ? `<a href="${esc(release.page)}" target="_blank" rel="noopener">${esc(release.page)}</a>` : 'the Darts S.A.M site'} instead.</p>` : ''}
    <div class="row">${busy ? '' : `<button class="primary" data-release="update">${d.state === 'failed' ? 'Try again' : 'Update'}</button>`}
      ${d.state === 'installed' ? '<button class="primary" data-release="restart">Restart now</button>' : ''}
      ${d.state === 'ready' && d.next === 'quit' ? '' : `<button data-release="later">${d.state === 'ready' ? 'Close' : 'Not now'}</button>`}</div></div>`;
}
async function followDownload() {
  try { release = await api('/update', 'GET', undefined, 4000); } catch { /* asked again below */ }
  if (!releaseAsk) return;
  showRelease();
  if (release.download?.state === 'downloading') setTimeout(followDownload, 700);
}
document.addEventListener('click', async e => {
  const set = e.target.closest('.settings [data-release]')?.dataset.release;
  if (set === 'restarton' || set === 'restartoff') { setRestartForUpdate(set === 'restarton'); return renderSettings(); }
  if (set === 'restart') { api('/update/restart', 'POST', undefined, 4000).catch(() => {}); return; }
  const act = e.target.closest('.releaseask [data-release]')?.dataset.release;
  if (act === 'restart') { api('/update/restart', 'POST', undefined, 4000).catch(() => {}); return; }
  if (act === 'later') { releaseDismissed = true; releaseAsk?.remove(); releaseAsk = null; }
  if (act === 'update') {
    try { release = await api('/update', 'POST', undefined, 10000); } catch (err) {
      release.download = { state: 'failed', error: err.status ? err.message : `${machine()} did not answer` };
    }
    showRelease();
    followDownload();
  }
});
