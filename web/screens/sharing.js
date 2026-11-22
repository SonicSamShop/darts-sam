// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Sharing without an account: the server at home only (see server/share.py).
// The question asked the first time the app is opened, and Settings → Sharing.

import { api, appVersion, esc, onAccountTab, pi, renderSettings, screen, store, switchRow, tracker } from '../app.js';

// The server at home only: has its owner agreed to send what it records to Darts
// Sam, with no account? {asked, on, paired, site}, or null until it has said
// (see "sharing without an account" below, and server/share.py).
export let share = null;

// ---------- sharing without an account (the server at home only, see server/share.py) ----------
// Someone using the desktop app by itself has no account, so nothing it records
// reaches Darts S.A.M. They are asked once, the first time the app is opened,
// whether it may be sent; yes or no, it can be changed in Settings → Sharing.
const SHARED = `<ul>
      <li><b>Your games and scores:</b> every game and each dart in it. Players go as "Player 1", "Player 2": their names are not sent.</li>
      <li><b>How the cameras did:</b> how many there are, whether calibrating worked, and when a dart they scored was put right by hand.</li>
      <li><b>Problem reports,</b> when you press Report in a game: the cameras' pictures of the last few darts and what you type about them.</li>
      <li><b>Feedback</b> you choose to write.</li></ul>`;
export const openDetail = () => ({
  version: appVersion, browser: navigator.userAgent, w: innerWidth, h: innerHeight, touch: navigator.maxTouchPoints > 0,
  installed: matchMedia('(display-mode: standalone)').matches || !!navigator.standalone,
});
export const sharing = {
  note: '',  // what went wrong last
  deleting: false,  // "Delete what has been sent" pressed once: asking if they are sure
};
export let shareAsk = null;       // the question, while it is on screen
export async function loadShare() {
  try { share = await api('/share', 'GET', undefined, 4000); } catch { return; }  // no Pi, or one from before this
  if (share.on) { tracker.track('open', openDetail()); tracker.flush(); }
  // Paired with an online account, what the cameras record goes with that account already.
  if (!share.asked && !share.paired) askShare();
  if (screen === 'settings') renderSettings();  // the Sharing tab appears
}
function askShare() {
  if (shareAsk) return;
  shareAsk = document.body.appendChild(document.createElement('div'));
  shareAsk.className = 'report shareask';
  shareAsk.innerHTML = `<div class="report-in">
    <h1>Help make Darts S.A.M better?</h1>
    <p>Darts S.A.M is new, and its camera scoring improves by seeing where it goes wrong.
      If you say yes, this computer sends to Darts S.A.M:</p>
    ${SHARED}
    <p>You are not asked for an account, a name or an email address. Say no and everything stays on this computer;
      the app works just the same. You can change your mind at any time in <b>Settings → Sharing</b>,
      and delete what has been sent from there.</p>
    <div class="row"><button class="primary" data-share="yes">Yes, send it</button><button data-share="no">No thanks</button>
      <span class="warn" id="share-error"></span></div>
    <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">What is sent, and what is done with it</a></p></div>`;
}
// Yes or no, from the question or from Settings.
export async function setShare(on) {
  sharing.note = '';
  try {
    share = await api('/share', 'PUT', { on });
    shareAsk?.remove(); shareAsk = null;
    if (screen === 'welcome') document.getElementById('welcome-name')?.focus();  // the next question
    if (share.on) { tracker.track('open', openDetail()); tracker.flush(); }
  } catch (e) {
    sharing.note = e.status ? e.message : `Not saved: ${pi()} did not answer.`;
    const line = shareAsk?.querySelector('#share-error');
    if (line) line.textContent = sharing.note;
  }
  sharing.deleting = false;
  if (onAccountTab()) renderSettings();
}
export async function deleteShared() {
  sharing.note = '';
  try {
    share = await api('/share', 'DELETE', undefined, 30000);
    store.set('events', []);  // notes not yet sent
    sharing.note = 'Deleted. Nothing more is sent.';
  } catch (e) {
    sharing.note = e.status ? e.message : `Nothing was deleted: ${pi()} did not answer.`;
  }
  sharing.deleting = false;
  if (onAccountTab()) renderSettings();
}
export function sharePanel() {
  if (!share) return '<p class="muted">Not connected to the Pi.</p>';
  return `<div class="settings">
    <div class="rows">${switchRow('Send to Darts S.A.M', share.on, `data-act="share-${share.on ? 'off' : 'on'}"`)}</div>
    ${sharing.note ? `<p class="warn">${esc(sharing.note)}</p>` : ''}
    <p class="muted small">${share.on ? 'This computer sends to Darts S.A.M, to help improve the camera scoring:'
      : 'Off: everything stays on this computer. Switched on, this computer sends to Darts S.A.M, to help improve the camera scoring:'}</p>
    <div class="muted small">${SHARED}</div>
    <p class="muted small">No account, name or email address is asked for or sent.${share.paired
      ? ' These cameras are paired with an online account, so problem reports go to that account.' : ''}</p>
    <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">What is sent, and what is done with it</a></p>
    <div class="setend">${sharing.deleting ? `<p>This stops sharing and deletes from Darts S.A.M everything this computer has sent. Your games here are not touched.</p>
    <div class="row"><button class="danger" data-act="share-delete-yes">Delete</button><button data-act="share-delete-no">Keep</button></div>`
    : '<button class="ghost danger" data-act="share-delete">Delete what has been sent</button>'}</div></div>`;
}
document.addEventListener('click', e => {
  const answer = e.target.closest('.shareask [data-share]')?.dataset.share;
  if (answer) setShare(answer === 'yes');
});
