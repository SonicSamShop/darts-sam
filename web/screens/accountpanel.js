// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Settings → Account (the hosted version only, see account.js): signing out,
// deleting the account, and the feedback box.

import { account, appVersion, call, cameraCount, data, esc, onAccountTab, renderSettings } from '../app.js';

// ---------- account (the hosted version only, see account.js) ----------
export const acct = {
  note: '',  // what went wrong last
  signingOut: false,  // "Sign out" pressed once: asking if they are sure
  deleting: false,  // "Delete my account" pressed once: asking if they are sure
};
let fbNote = '';          // how sending feedback went
export async function sendFeedback() {
  const box = document.getElementById('fb-text'), text = box.value;
  try {
    await call(account.hosted ? '/api/feedback' : '/api/share/feedback', 'POST', { text, app: {
      version: appVersion, browser: navigator.userAgent, w: innerWidth, h: innerHeight, cameras: cameraCount,
    } });
    fbNote = 'Thanks, sent.';
  } catch (e) {
    fbNote = e.signedOut ? 'You are no longer signed in.' : e.status ? e.message : 'Not sent: no connection. Try again.';
    if (onAccountTab()) { renderSettings(); document.getElementById('fb-text').value = text; }  // keep what they typed
    return;
  }
  if (onAccountTab()) renderSettings();
}
export function accountPanel() {
  const note = acct.note ? `<p class="warn">${esc(acct.note)}</p>` : '';
  if (!account.account) return '';  // signed out is the welcome page's business
  return `<div class="settings">
    ${note}
    ${acct.signingOut ? `<p>Are you sure you want to sign out?</p>
    <div class="row"><button data-act="acct-signout-yes">Sign out</button><button data-act="acct-signout-no">Stay signed in</button></div>`
    : acct.deleting ? '' : '<div class="rows"><button class="srow" data-act="acct-signout"><span><b>Sign out</b></span></button></div>'}
    <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">What is stored about you</a>${
      account.account.admin ? ' · <a href="/admin">The trial\'s admin pages</a>' : ''}</p>
    <div class="setend">${acct.deleting ? `<p>This deletes your account, games and stats for good.</p>
    <div class="row"><button class="danger" data-act="acct-delete-yes">Delete</button><button data-act="acct-delete-no">Keep</button></div>`
    : '<button class="ghost danger" data-act="acct-delete">Delete my account</button>'}</div></div>`;
}

export const feedbackBox = () => `<div class="feedback"><label for="fb-text">Tell us what you think: what works, what doesn't, what's missing.</label>
      <textarea id="fb-text" rows="3" maxlength="2000"></textarea>
      <div class="row"><button data-act="feedback">Send feedback</button><span class="muted">${esc(fbNote)}</span></div></div>`;

export async function accountDo(what) {
  acct.note = '';
  try {
    if (what === 'signout') {
      // Signing out empties this device, so anything not yet saved to the account would be lost.
      if (data.waiting() && !(await data.sync()) || data.waiting()) {
        throw new Error(`${data.waiting()} change${data.waiting() === 1 ? ' hasn\'t' : 's haven\'t'} been saved yet. Connect to the internet and try again.`);
      }
      await account.signOut();
    }
    if (what === 'delete') await account.remove();
    // this device's copy is gone: start again clean rather than show what is still in memory
    if (what !== 'rename') {
      await window.caches?.delete('dartssam-data').catch(() => {});  // their stats, kept for offline
      return location.reload();
    }
  } catch (e) {
    acct.note = e.signedOut ? 'You are no longer signed in.' : e.message;
  }
  acct.deleting = acct.signingOut = false;
  if (onAccountTab()) renderSettings();
}
