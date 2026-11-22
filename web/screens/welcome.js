// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The first time the desktop app is opened (their name, then whether they have a
// camera), and the hosted site's camera question for someone who has just signed up.

import { shareAsk } from './sharing.js';
import { camScreen } from './cameras.js';
import {
  $app, account, begin, data, esc, fit, loadPlayers, open, saveSetup, screen, setScreen, setup, store
} from '../app.js';

// ---------- the first time the desktop app is opened ----------
// After the question about sharing (askShare(), which lies over this until it
// is answered), one question to a screen: their name, which makes the first
// player, then whether they have a camera. With one they go on to choose which
// kind (the cameras' own first step); without, to the menu.
// The hosted site asks the second question only, of someone who has just signed
// up (signing up gave their name and made their player): with a camera they go
// on to connect the computer it is plugged into (hostedCameras()), and from
// there to the same choice of which kind. Until it is answered it is asked
// again each time the app is opened on this device. Signing up by email gives
// no name: then their name is asked first (nameDue), and the account and its
// player take it.
export const welcomeDue = () => account.hosted && !!account.account && store.get('newcomer', null) === account.account.id;
export const nameDue = () => account.hosted && !!account.account && store.get('unnamed', null) === account.account.id;
export const welcomeForm = {
  name: '',  // their name, once given
  note: '',  // why it was refused
  step: '',  // '' their name, then 'camera'
};
export function renderWelcome() {
  setScreen('welcome');
  const hosted = welcomeDue();
  const step = !nameDue() && (hosted || welcomeForm.step === 'camera') ? `<b class="camlead">${hosted ? 'Welcome to Darts S.A.M' : 'Will you use a camera?'}</b>
    ${hosted ? '<p>Will you use a camera?</p>' : ''}
    <p class="dim">Darts S.A.M scores by itself with a camera pointed at the board.</p>
    ${welcomeForm.note ? `<p class="warn">${esc(welcomeForm.note)}</p>` : ''}
    <div class="camkinds">
      <button class="game-card" data-act="welcome-cam"><b>Yes, set one up</b></button>
      <button class="game-card" data-act="welcome-nocam"><b>No, I'll tap the board</b></button>
    </div>`
    : `<b class="camlead">Welcome to Darts S.A.M</b>
    <p class="dim"><label for="welcome-name">What's your name?</label></p>
    <div class="row camadd"><input type="text" id="welcome-name" maxlength="16" autocomplete="off" value="${esc(welcomeForm.name)}">
      <button class="primary" data-act="welcome-name">Continue</button></div>
    ${welcomeForm.note ? `<p class="warn">${esc(welcomeForm.note)}</p>` : ''}`;
  $app.innerHTML = `<div class="page"><div class="camsetup fill">
    ${welcomeForm.step && !hosted ? '<div class="row"><button class="ghost" data-act="welcome-back">‹ Back</button></div>' : ''}
    <div class="camwizard">${step}</div></div></div>`;
  fit();
  if (!shareAsk) document.getElementById('welcome-name')?.focus();
}
export function welcomeNamed() {
  welcomeForm.name = document.getElementById('welcome-name').value.trim();
  welcomeForm.note = welcomeForm.name ? '' : 'Type your name first.';
  if (welcomeForm.name && nameDue()) return nameAccount();
  if (welcomeForm.name) welcomeForm.step = 'camera';
  renderWelcome();
}
// Hosted, signed up by email: the account and its player take the name given.
async function nameAccount() {
  document.querySelector('[data-act="welcome-name"]').disabled = true;
  try {
    await account.rename(welcomeForm.name, true);
  } catch (e) {
    welcomeForm.note = e.status ? e.message : 'Could not reach the site. Try again.';
    return renderWelcome();
  }
  store.set('unnamed', null);
  welcomeForm.name = '';
  data.sync(true);  // their player's new name comes down
  begin();          // the camera question, or the cameras when they came by their link
}
export function finishWelcome(camera) {
  if (welcomeDue()) store.set('newcomer', null);  // answered; their player came with the account (see synced())
  else try {
    const p = data.addPlayer(welcomeForm.name);
    loadPlayers();
    setup.players = [p.id];  // ready to throw
    saveSetup();
  } catch (e) {
    welcomeForm.note = e.message;
    return renderWelcome();
  }
  if (!account.hosted) store.set('welcomed', { camera });
  // Which kind of camera is asked first, even when one (a laptop's own, say) has been found already.
  camScreen.adding = camScreen.first = camera; camScreen.step = camScreen.note = '';
  open({ screen: camera ? 'cameras' : 'home' });
}
