// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The first time the desktop app is opened (their name, then whether they have a
// camera), and the hosted site's camera question for someone who has just signed up.

import { shareAsk } from './sharing.js';
import { camScreen } from './cameras.js';
import { $app, COUNTRIES, THEMES, account, applyTheme, begin, data, esc, fit, loadPlayers, open, saveSetup, setPlayerFlag, setScreen, setup, store } from '../app.js';

// Visual swatch colours for the live theme picker on the welcome screen.
const SWATCH = {
  chalk: ['#1e2623', '#f2d16b', '#efeadb'],
  stage: ['#0a0a0c', '#d3252b', '#ffd21f'],
  classic: ['#111111', '#23804a', '#e9dfc3'],
  arcade: ['#050505', '#38f26b', '#ffb21a'],
  sheet: ['#eadfc4', '#17693b', '#17130f'],
};
function themePickerHtml() {
  const cur = applyTheme().id;
  return `<div class="wthemes" role="radiogroup" aria-label="Choose a look">
    <p class="dim">Pick your look (change any time in Settings)</p>
    <div class="wtheme-row">${THEMES.map(t => {
      const [bg, ac, tx] = SWATCH[t.id] ?? ['#111', '#fff', '#fff'];
      const on = t.id === cur;
      return `<button class="wtheme ${on ? 'on' : ''}" data-wtheme="${t.id}" role="radio" aria-checked="${on}">
        <span class="wswatch" style="--sw-bg:${bg};--sw-ac:${ac};--sw-tx:${tx}"><i></i><b></b></span>
        <span>${esc(t.name)}</span>
      </button>`;
    }).join('')}</div></div>`;
}

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
  flag: '',  // their country code
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
    <p class="dim"><label for="welcome-name">What's your name and country?</label></p>
    <div class="row camadd"><input type="text" id="welcome-name" placeholder="Your name" maxlength="16" autocomplete="off" value="${esc(welcomeForm.name)}">
      <select class="plain" id="welcome-flag" aria-label="Country">
        <option value="">Country…</option>
        ${COUNTRIES.map(([code, flag, name]) => `<option value="${code}" ${code === welcomeForm.flag ? 'selected' : ''}>${flag} ${name}</option>`).join('')}
      </select>
      <button class="primary" data-act="welcome-name">Continue</button></div>
    ${welcomeForm.note ? `<p class="warn">${esc(welcomeForm.note)}</p>` : ''}`;
  $app.innerHTML = `<div class="page"><div class="camsetup fill">
    ${welcomeForm.step && !hosted ? '<div class="row"><button class="ghost" data-act="welcome-back">‹ Back</button></div>' : ''}
    <div class="camwizard">${step}${themePickerHtml()}</div></div></div>`;
  fit();
  if (!shareAsk) document.getElementById('welcome-name')?.focus();
}
export function welcomeNamed() {
  welcomeForm.name = document.getElementById('welcome-name').value.trim();
  welcomeForm.flag = document.getElementById('welcome-flag')?.value ?? '';
  if (!welcomeForm.name) { welcomeForm.note = 'Type your name first.'; return renderWelcome(); }
  if (!welcomeForm.flag) {
    welcomeForm.note = 'Pick your country.';
    renderWelcome();
    document.getElementById('welcome-flag')?.focus();
    return;
  }
  welcomeForm.note = '';
  if (nameDue()) return nameAccount();
  welcomeForm.step = 'camera';
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
    if (welcomeForm.flag) setPlayerFlag(p.id, welcomeForm.flag);
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
