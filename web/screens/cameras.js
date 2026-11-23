// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The Cameras screen: the cameras at home (adding, removing, calibrating) and,
// on the hosted site, pairing with the computer they are plugged into.

import {
  $app, account, api, call, cameraCount, data, esc, fit, helperLinked, pageFoot, pageHead, phone, refreshStatus,
  screen, setCameraCount, setScreen, settings, tracker
} from '../app.js';
import { switchRow } from './settings.js';
import { renderLanding } from './landing.js';

// ---------- cameras & calibration ----------
// A screen of its own. First every camera side by side, each picture with its
// green lines, which camera goes in each place, and the settings they share
// (picture size, frames a second, standby). A tap on a picture opens that one
// by itself: its picture large, and beside it the one thing it needs next
// (lining up with the board, a tap on the picture, nothing: it is ready).
// Adding a camera is a step aside from both.
export const camScreen = {
  calib: {},  // camera id -> points tapped so far
  autoCal: null,  // camera id waiting for a tap on the 20, for auto-calibration
  number: 20,  // ...or on this number, when that camera can't see the 20
  calibNote: '',  // how the last calibration went
  calibFailed: false,  // ...and whether that was badly
  startCal: '',  // finding the board again on opening the app: '' not yet, 'wait' (for the settings), 'busy', 'done'
  shown: 0,  // the camera on screen
  one: false,  // that camera by itself; false: all of them side by side
  finding: null,  // the camera id finding the board, side by side
  adding: false,  // "Add a camera" is open
  first: false,  // ...opened by the desktop app's first screens: asked as if there were no camera yet
  note: '',  // why the cameras could not be changed
  step: '',  // adding one: '' which kind, then 'usb' or 'phone'
};
let calibBusy = false;  // the Pi is looking for the board in a camera's picture
let camSearch = false;  // the Pi is looking for its cameras again
export let camStatus = null;  // what the Pi last said about its cameras
let camAddress = '';  // an address typed into "Add a phone", kept while it is refused
export async function renderCameras() {
  if (account.locked) return renderLanding();
  setScreen('cameras');
  if (!document.querySelector('.camstage, .camsetup')) drawCameras(undefined);  // something to look at meanwhile
  if (account.hosted && account.account) await account.refresh().catch(() => {});  // are their cameras connected?
  if (!account.hosted) linkInfo = await api('/link', 'GET', undefined, 4000).catch(() => null);
  let status = null;
  try { status = await api('/status', 'GET', undefined, 6000); } catch { /* no Pi, or no cameras connected */ }
  if (account.hosted) await phone.offered();
  if (screen !== 'cameras') return;
  watchLink();
  drawCameras(status);
}
export function drawCameras(status) {
  const cams = status?.cameras ?? [];
  const cam = cams.find(c => c.id === camScreen.shown) ?? cams[0];
  const wait = text => `<p class="dim camwait">${text}</p>`;
  if (status) camStatus = status;
  $app.innerHTML = `<div class="page">
    ${pageHead('cameras')}
    ${camSearch ? wait('Looking for cameras…')
      : status === undefined ? wait(`Looking for ${account.hosted ? 'your cameras' : 'cameras'}…`)
      : account.hosted && !status ? hostedCameras()
      : !status ? `${wait('The cameras aren\'t answering. You can still score by tapping the board.')}
    <div class="row"><button data-act="pair-retry">Try again</button></div>`
      : camScreen.adding || !cam ? camSetup(status, cam) : camScreen.one ? camPanel(status, cams, cam) : camGrid(status, cams)}
    ${pageFoot('cameras')}
  </div>`;
  refreshStatus();
  fit();
  watchUsb(status);
  liveTiles();
}

// Side by side: every camera's picture, kept fresh while it shows.
function camGrid(status, cams) {
  const all = [...cams.map(c => ({ name: c.name, label: c.label })), ...(status.off ?? [])];
  const place = c => status.fixed ? `<b>${esc(c.label)}</b>`
    : `<label class="pick"><select class="plain" data-place="${c.id}" aria-label="Camera in this place">
      ${all.map(o => `<option value="${esc(o.name)}" ${o.name === c.name ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      <option value="">None (switch it off)</option></select></label>`;
  const tile = c => {
    const busy = camScreen.finding === c.id;
    const [look, text] = !c.ok ? ['bad', status.resting ? 'Resting. Waking up…' : 'No picture. Check it is plugged in.']
      : busy ? ['', 'Looking for the board…']
      : c.points ? ['ok', 'Ready to score'] : ['now', 'Not lined up yet: tap the picture'];
    return `<div class="camtile ${look}">
      <button class="camshot" data-showcam="${c.id}" title="Open this camera by itself">${c.ok
        ? `<img data-live="${c.id}" src="/api/cameras/${c.id}/snapshot.jpg?overlay=1&t=${Date.now()}" alt="${esc(c.label)}">`
        : '<span class="dim">No picture</span>'}</button>
      <div class="camtilebar">${place(c)}${c.ok && !calibBusy ? `<button data-autocal="${c.id}" ${c.points ? 'data-has="1"' : ''}>Find the board</button>` : ''}</div>
      <p class="dim">${text}</p></div>`;
  };
  const set = status.settings, ch = status.choices;
  const pick = (label, key, options) => `<label class="pick"><span>${label}</span><select data-camset="${key}">${options}</select></label>`;
  const opt = (value, text, on) => `<option value="${value}" ${on ? 'selected' : ''}>${text}</option>`;
  const settingsRow = !set ? '' : `<div class="picks camset">
      ${pick('Picture size', 'size', ch.sizes.map(([w, h]) => opt(`${w}x${h}`, `${w} × ${h}`, w === set.width && h === set.height)).join(''))}
      ${pick('Frames a second', 'fps', ch.rates.map(r => opt(r, r, r === set.fps)).join(''))}
      ${pick('Rest the cameras after', 'standby', ch.standby.map(m => opt(m, m ? `${m} minutes unused` : 'Never', m === set.standby)).join(''))}
    </div>`;
  const lined = cams.filter(c => c.ok && c.points).length;
  return `
    ${camScreen.note ? `<p class="warn">${esc(camScreen.note)}</p>` : ''}
    <div class="camgrid">${cams.map(tile).join('')}</div>
    ${camScreen.calibNote ? `<p class="${camScreen.calibFailed ? 'warn' : 'dim'} camgridnote">${esc(camScreen.calibNote)}</p>` : ''}
    ${settingsRow}
    <div class="row camgridacts">
      ${lined > 1 ? `<button class="primary" data-act="findall" ${calibBusy ? 'disabled' : ''}>Find the board on all</button>` : ''}
      ${cams.some(c => c.points) && cams.some(c => c.ok) ? '<button data-act="reset">Board is empty now</button>' : ''}
      ${status.fixed ? '' : '<button class="ghost camnew" data-act="camadd">+ Add a camera</button>'}
    </div>
    ${cams.some(c => c.points) ? `<div class="camextra">${switchRow('Auto-calibrate on start', settings.autoCal !== false,
      `data-autostart="${settings.autoCal !== false ? 'off' : 'on'}"`, 'Every camera finds the board again each time the app opens.')}</div>` : ''}
    ${linkRow()}${account.hosted && account.helper ? `<div class="camextra">${unpairButton()}</div>` : ''}`;
}
// Each picture side by side is fetched again about once a second, the new one
// swapped in once it has loaded so nothing flickers.
let liveTimer = null;
function liveTiles() {
  clearTimeout(liveTimer);
  if (!document.querySelector('img[data-live]')) return;
  liveTimer = setTimeout(() => {
    if (!onCamerasTab()) return;
    for (const img of document.querySelectorAll('img[data-live]')) {
      const next = new Image();
      next.onload = () => { if (img.isConnected) img.src = next.src; };
      next.src = `/api/cameras/${img.dataset.live}/snapshot.jpg?overlay=1&t=${Date.now()}`;
    }
    liveTiles();
  }, 1000);
}
// "Find the board on all": each camera that has been lined up finds it again,
// one after another (one never lined up needs a tap on its 20 first).
export async function findAll() {
  const todo = (camStatus?.cameras ?? []).filter(c => c.ok && c.points);
  if (calibBusy || !todo.length) return;
  calibBusy = true; camScreen.calibNote = ''; camScreen.calibFailed = false;
  const missed = [];
  for (const cam of todo) {
    camScreen.finding = cam.id;
    if (onCamerasTab()) drawCameras(camStatus);
    try {
      const r = await api(`/cameras/${cam.id}/autocalibration`, 'POST', {}, 30000);
      tracker.track('calibrated', { ok: true, how: 'all', joins: r.joins, rms_px: r.rms_px, tapped: false });
    } catch (err) {
      missed.push(cam.label);
      tracker.track('calibrated', { ok: false, how: 'all', why: err.message, tapped: false });
    }
  }
  calibBusy = false; camScreen.finding = null;
  const n = todo.length - missed.length;
  camScreen.calibFailed = missed.length > 0;
  camScreen.calibNote = !missed.length ? `Board found on ${n === 2 ? 'both cameras' : `all ${n} cameras`}.`
    : `Couldn't find the board on ${missed.join(', ')}, so ${missed.length > 1 ? 'they keep' : 'it keeps'} the line-up from before. Open it to try again or mark it by hand.`;
  if (onCamerasTab()) renderCameras();
}
// A camera chosen for a place side by side, or the picture size, rate or standby changed.
export function placeCamera(place, name) {
  return changeCameras('/cameras/place', { place, name: name || null });
}
export function cameraSettings() {
  const v = key => document.querySelector(`select[data-camset="${key}"]`)?.value;
  const [width, height] = (v('size') ?? '1280x720').split('x').map(Number);
  return changeCameras('/cameras/settings', { width, height, fps: +v('fps'), standby: +v('standby') });
}

// One camera: which one, its picture, and what to do about it.
function camPanel(status, cams, cam) {
  const pts = camScreen.calib[cam.id];
  const wantTwenty = camScreen.autoCal === cam.id;
  const lined = !!cam.points;
  const another = cams.find(c => c.id !== cam.id && c.ok && !c.points);  // one still to be lined up
  const auto = (label, cls = '') => `<button class="${cls}" data-autocal="${cam.id}" ${lined ? 'data-has="1"' : ''}>${label}</button>`;
  const byHand = `<button data-calib="${cam.id}">Mark it by hand</button>`;
  // [how it looks, the headline, what to do, the buttons]: the first that applies
  const [look, head, text, acts] =
    !cam.ok ? ['bad', 'No picture', cam.kind === 'added'
        ? 'Can\'t reach this camera. Check the address and that the phone app is running.'
        : 'Check the camera is plugged in, then look again.',
      '<button class="primary" data-act="refreshcams">Look again</button>']
    : calibBusy ? ['', 'Looking for the board…', 'This takes a few seconds.', '']
    : wantTwenty ? ['now', `Tap the ${camScreen.number}`, `Tap anywhere inside the <b>${camScreen.number}</b> segment on the picture. That shows which way up the board is.
        <label class="pick tapnumber"><span>Can't see the 20? Tap another number</span><select data-tapnumber>
        ${[20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5].map(n =>
          `<option value="${n}" ${n === camScreen.number ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`,
      `<button data-autocal="${cam.id}">Cancel</button>`]
    : pts ? ['now', `Point ${pts.length + 1} of 4`,
      `Tap the picture where the <b>outer double wire</b> meets the wire between <b>${esc(status.targets[pts.length])}</b>.`,
      `<button data-calib="${cam.id}">Cancel</button>`]
    : camScreen.calibFailed ? ['bad', 'Couldn\'t find the board', `${esc(camScreen.calibNote)} Check the whole board is in the picture and well lit, with no darts in it.`,
      auto('Try again', 'primary') + byHand]
    : !lined ? ['now', 'Line it up with the board', 'Point the camera so the whole board is in the picture. Take the darts out, then press <b>Find the board</b>.',
      auto('Find the board', 'primary') + byHand]
    : ['ok', 'Ready to score', 'The green lines should sit on the board\'s wires, with the green 20 in the 20. If they don\'t, find the board again.',
      (another ? `<button class="primary" data-showcam="${another.id}">Next camera</button>` : '<button class="primary" data-act="home">Done</button>')
        + auto('Find the board again') + byHand];
  const quiet = pts || wantTwenty || calibBusy;  // in the middle of lining up: nothing else to look at
  const extra = (text, buttons) => `<div class="camextra"><span class="dim">${text}</span>${buttons}</div>`;
  return `
    <div class="row camtabs"><button class="ghost" data-act="camgrid">‹ All cameras</button>${cams.map(c => `<button class="${c.id === cam.id ? 'on' : ''}" data-showcam="${c.id}"
        title="${!c.ok ? 'No picture' : c.points ? 'Ready to score' : 'Not lined up yet'}"><span class="dot ${c.ok && c.points ? 'ok' : ''}"></span>${esc(c.label)}</button>`).join('')}
      ${status.fixed ? '' : '<button class="ghost camnew" data-act="camadd">+ Add a camera</button>'}</div>
    ${camScreen.note ? `<p class="warn">${esc(camScreen.note)}</p>` : ''}
    <div class="cambody fill">
      <div class="camstage">${cam.ok ? `<div class="camview ${pts || wantTwenty ? 'tapping' : ''}" data-cam="${cam.id}">
        <img src="/api/cameras/${cam.id}/snapshot.jpg?overlay=${pts || wantTwenty ? 0 : 1}&t=${Date.now()}" alt="">
        ${(pts ?? []).map(p => `<i style="left:${p.fx * 100}%;top:${p.fy * 100}%"></i>`).join('')}
      </div>` : '<span class="dim">No picture</span>'}</div>
      <div class="camside">
        <div class="camstate ${look}"><b>${head}</b><p>${text}</p>
          ${acts ? `<div class="row">${acts}</div>` : ''}
          ${camScreen.calibNote && !camScreen.calibFailed && look === 'ok' ? `<p class="dim">${esc(camScreen.calibNote)}</p>` : ''}</div>
        ${quiet ? '' : `${lined && cam.ok ? extra('Scoring stuck, or darts missed? Take the darts out, then press:', '<button data-act="reset">Board is empty now</button>') : ''}
        ${status.fixed ? '' : extra(cam.kind === 'added' ? 'Not using this camera any more?' : 'Not for the board (a laptop\'s own webcam, say)?',
          `<button data-camoff="${esc(cam.name)}">Switch off</button>${cam.kind === 'added' ? `<button class="danger" data-camremove="${esc(cam.name)}">Remove</button>` : ''}`)}
        ${cams.some(c => c.points) ? `<div class="camextra">${switchRow('Auto-calibrate on start', settings.autoCal !== false,
          `data-autostart="${settings.autoCal !== false ? 'off' : 'on'}"`, 'Every camera finds the board again each time the app opens.')}</div>` : ''}
        ${linkRow()}${account.hosted && account.helper ? `<div class="camextra">${unpairButton()}</div>` : ''}`}
      </div>
    </div>`;
}

// No cameras yet, or "Add a camera": one question at a time. Which kind of
// camera; then for a USB one nothing to press (it is looked for until it turns
// up), and for a phone its address. Nothing can be added when the cameras were
// named on the command line.
function camSetup(status, cam) {
  if (camScreen.first) cam = null;
  const off = kind => (status.off ?? []).filter(o => (o.kind === 'added') === (kind === 'added'));
  const offRows = kind => off(kind).map(o => `<div class="camoff"><span><b>${esc(o.label)}</b> is switched off</span>
      <button class="primary" data-camon="${esc(o.name)}">Use this camera</button></div>`).join('');
  const back = camScreen.step ? '<button class="ghost" data-act="cam-step">‹ Back</button>'
    : cam ? '<button class="ghost" data-act="camadd-done">‹ Back to the cameras</button>' : '';
  const note = camScreen.note ? `<p class="warn">${esc(camScreen.note)}</p>` : '';
  const step = camScreen.step === 'usb' ? `<b class="camlead">Plug in your USB camera</b>
      <p class="dim">Plug it into ${account.hosted ? 'the computer by your board' : 'this computer'} and point it at the board.
        There is nothing to press: it shows up here by itself.</p>
      ${note}${offRows('usb')}
      <p class="camseek dim"><span class="dot"></span>Looking for ${off('usb').length ? 'another camera' : 'a camera'}…</p>`
    : camScreen.step === 'phone' ? `<b class="camlead">Use a phone or network camera</b>
      <ol><li>On the phone, install an IP-webcam app and start it.</li>
        <li>Stand the phone where it sees the whole board.</li>
        <li>Type the address the app shows:</li></ol>
      <div class="row camadd"><input type="text" id="cam-address" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false"
        placeholder="http://192.168.1.50:8080/video" aria-label="The camera's address" value="${esc(camAddress)}">
        <button class="primary" data-act="addcam">Add camera</button></div>
      ${note}${offRows('added')}`
    : `<b class="camlead">${cam ? 'Add a camera' : 'Which camera will you use?'}</b>
      <p class="dim">${cam ? 'Which kind is it?' : 'Darts S.A.M scores by itself with a camera pointed at the board.'}</p>
      ${note}
      <div class="camkinds">
        <button class="game-card" data-act="cam-usb"><b>USB camera</b><span>A webcam plugged in by the board. What most people use.</span></button>
        ${status.fixed ? '' : '<button class="game-card" data-act="cam-phone"><b>Phone or network camera</b><span>A phone running an IP-webcam app, on the same Wi-Fi.</span></button>'}
      </div>
      ${cam ? `${offRows('usb')}${offRows('added')}` : ''}
      ${cam ? '' : '<p class="camskip"><button class="ghost" data-act="home">No camera: score by tapping the board</button></p>'}
      ${!cam && account.hosted && account.helper ? `<div class="row camlink">${unpairButton()}</div>` : ''}`;
  return `<div class="camsetup fill">${back ? `<div class="row">${back}</div>` : ''}<div class="camwizard">${step}</div></div>`;
}
// The USB step with no camera running: look again every few seconds until one is there.
let usbWatch = null;
function watchUsb(status) {
  clearTimeout(usbWatch);
  const here = () => onCamerasTab() && camScreen.step === 'usb' && !camSearch;
  if (!here() || !status || status.cameras.length) return;
  usbWatch = setTimeout(async () => {
    if (!here()) return;
    const now = await api('/cameras/refresh', 'POST', undefined, 30000).catch(() => null);
    if (!here()) return;
    if (now?.cameras.length) { setCameraCount(now.scoring); camScreen.step = ''; camScreen.adding = false; camScreen.shown = now.cameras[0].id; return drawCameras(now); }
    if (now && JSON.stringify(now.off) !== JSON.stringify(status.off)) return drawCameras(now);
    watchUsb(now ?? status);
  }, 3000);
}
// "USB camera" chosen. With none running the step itself keeps looking; with
// some, look once and go back to them, saying so if there is nothing new.
export async function usbChosen() {
  const had = camStatus?.cameras.length ?? 0;
  camScreen.note = '';
  if (!had) { camScreen.step = 'usb'; return renderCameras(); }
  // Asked first of all, with a camera here already: that may well be the one they mean. Show what there is.
  if (camScreen.first) { camScreen.first = false; return void changeCameras('/cameras/refresh'); }
  const now = await changeCameras('/cameras/refresh');
  if (now && now.cameras.length <= had && onCamerasTab()) {
    // A camera that was switched off isn't new: stay on Add a camera, which lists them to switch back on.
    const off = (now.off ?? []).some(o => o.kind !== 'added');
    camScreen.adding = off;
    camScreen.note = off ? 'No new camera found. Is it one you switched off? Press Use this camera to have it back.'
      : 'No new camera found. Check it is plugged in, then try Add a camera again.';
    drawCameras(now);
  }
}

// ---------- cameras and the hosted site ----------
// The cameras are plugged into a computer at home running this same server
// (the "helper"). It is paired once with the person's account by a code it
// shows, and from then on the hosted app reaches the cameras through the site.
export const pairing = {
  code: '',  // hosted: the code being typed (or come with the link the helper showed)
  note: '',  // hosted: what went wrong
  unpairAsk: false,  // hosted: "Disconnect cameras" pressed once
};
let pairWaiting = false;  // hosted: code accepted, waiting for the helper to connect
let linkInfo = null;      // the helper's own page: GET /api/link
let linkNote = '';
// Hosted, and the cameras can't be asked anything: say why, and what to do.
function hostedCameras() {
  const note = pairing.note ? `<p class="warn">${esc(pairing.note)}</p>` : '';
  if (!account.account) return `<p class="dim">${pairing.code ? 'Sign in, then press Connect.' : 'Sign in to connect your cameras.'}</p>
    <div class="row"><button data-stab="acct">Sign in</button></div>`;
  if (pairWaiting) return '<p class="dim">Waiting for your cameras…</p>';
  // one step of the cameras' wizard, as camSetup()'s are: once connected, that asks which kind of camera
  if (!account.helper) return `<div class="camsetup fill"><div class="camwizard pairing">
    <b class="camlead">Connect your cameras</b>
    <p class="dim">The cameras plug into a computer by your board. Darts S.A.M runs on it and sends each dart here.</p>
    <ol><li>On that computer, start Darts S.A.M.
        <a href="download.html" target="_blank" rel="noopener">Download it for Mac, Windows or Linux</a></li>
      <li>In its window, open <b>Cameras</b> and press <b>Connect to your account</b>. It shows a 6-letter code.</li>
      <li>Type the code here:</li></ol>
    <div class="row camadd"><input type="text" id="pair-code" maxlength="12" autocapitalize="characters" autocomplete="off"
        spellcheck="false" placeholder="ABC234" aria-label="The code" value="${esc(pairing.code)}"><button class="primary" data-act="pair">Connect</button></div>
    ${note}
    <p class="camskip"><button class="ghost" data-act="home">No camera: score by tapping the board</button></p></div>${phoneOffer()}</div>`;
  return `<p class="dim">${account.helper.connected ? 'Your cameras\' computer didn\'t answer.'
      : 'Your cameras\' computer isn\'t connected. Check it is switched on and Darts S.A.M is running.'}</p>
    ${note}<div class="row"><button data-act="pair-retry">Try again</button>${unpairButton()}</div>${phoneOffer()}`;
}
// This phone's own camera instead of a computer's (phoneui.js), where it can be used.
function phoneOffer() {
  if (!phone.offeredNow()) return '';
  return `<div class="camwizard phoneoffer"><b class="camlead">Or use this Device Camera <span class="beta">Beta</span></b>
    <p class="dim">${phone.on() ? esc(phone.statusText())
      : 'No computer needed: stand this device beside the board and it scores by itself. It is new, so it gets some darts wrong, and asks when it isn\'t sure.'}</p>
    <div class="row"><button class="primary" data-act="phonecam">${phone.on() ? 'Open the Device Camera' : 'Use this Device Camera'}</button></div></div>`;
}
function unpairButton() {
  if (!account.hosted || !account.helper) return '';
  return pairing.unpairAsk ? '<span class="dim">Disconnect them from your account?</span><button class="danger" data-act="unpair-yes">Disconnect</button><button data-act="unpair-no">Keep</button>'
    : '<button data-act="unpair" title="Stop using these cameras with your account">Disconnect cameras</button>';
}
export async function pairCameras() {
  pairing.code = document.getElementById('pair-code').value;
  pairing.note = '';
  try {
    await call('/api/pair/claim', 'POST', { code: pairing.code });
  } catch (e) {
    pairing.note = e.signedOut ? 'You are no longer signed in.' : e.message;
    return renderCameras();
  }
  pairing.code = '';
  pairWaiting = true;
  if (onCamerasTab()) drawCameras(null);
  // the helper asks the site every couple of seconds whether its code was typed, then connects
  for (let i = 0; i < 15 && !account.helper?.connected; i++) {
    await new Promise(done => setTimeout(done, 2000));
    await account.refresh().catch(() => {});
  }
  pairWaiting = false;
  if (onCamerasTab()) renderCameras();
}
export async function unpairCameras() {
  pairing.unpairAsk = false;
  try { await call('/api/helper', 'DELETE'); } catch (e) { pairing.note = e.message; }
  if (onCamerasTab()) renderCameras();
}
const onCamerasTab = () => screen === 'cameras';

// The helper's own page: use these cameras with an account on the hosted site.
function linkRow() {
  const l = linkInfo;
  if (account.hosted || !l?.host) return '';
  const site = esc(l.host.replace(/^https?:\/\//, ''));
  const note = linkNote ? `<span class="warn">${esc(linkNote)}</span>` : '';
  if (l.code) return `<div class="row camlink"><span>Code: <b class="paircode">${esc(l.code.slice(0, 3))} ${esc(l.code.slice(3))}</b></span>
      <span class="dim">Type this code at <a href="${esc(l.url)}" target="_blank" rel="noopener">${site}</a> → Cameras.
      It works for 10 minutes.</span></div>`;
  if (!l.paired) return `<div class="row camlink"><span class="dim">Use these cameras at ${site}</span>
      <button data-act="link-pair">Connect to your account</button>${note}</div>`;
  return `<div class="row camlink"><span class="dim">${l.connected ? 'Connected to your online account' : 'Paired with your online account · not connected right now'}</span>
      <button data-act="link-unpair">Disconnect</button>${note}</div>`;
}
export async function linkDo(method, path) {
  linkNote = '';
  try { await api(path, method); } catch (e) { linkNote = e.message; }
  if (onCamerasTab()) renderCameras();
}
// While a code is waiting to be typed on the site, look every 2 s for it to have worked.
let linkWatch = null;
function watchLink() {
  clearTimeout(linkWatch);
  if (account.hosted || !(linkInfo?.code || (linkInfo?.paired && !linkInfo.connected))) return;
  linkWatch = setTimeout(async () => {
    if (!onCamerasTab()) return;
    const was = JSON.stringify(linkInfo);
    linkInfo = await api('/link', 'GET', undefined, 4000).catch(() => linkInfo);
    if (!onCamerasTab()) return;
    if (JSON.stringify(linkInfo) !== was && !Object.keys(camScreen.calib).length && camScreen.autoCal == null) return renderCameras();
    watchLink();
  }, 2000);
}

// Have the Pi look for its cameras again, as restarting it would: for one plugged
// in late, or one that came back under another number. With a path and body,
// first change which cameras it uses (add, remove, switch off or on).
export const refreshCameras = () => changeCameras('/cameras/refresh');
export async function changeCameras(path, body) {
  if (camSearch) return;
  // camera numbers are about to change: drop anything that refers to them
  camSearch = true; camScreen.calib = {}; camScreen.autoCal = null; camScreen.calibNote = camScreen.note = ''; camScreen.calibFailed = false; camScreen.shown = 0;
  camAddress = body?.address ?? '';
  drawCameras(null);
  let status = null;
  try {
    status = await api(path, 'POST', body, 30000);
    setCameraCount(status.scoring);
    camScreen.adding = false; camScreen.step = '';
    if (body?.address) { camAddress = ''; camScreen.shown = status.cameras.at(-1)?.id ?? 0; }  // show the one just added
    else camScreen.shown = (status.cameras.find(c => c.ok && !c.points) ?? status.cameras[0])?.id ?? 0;  // or the first with something to do
  } catch (err) {
    camScreen.note = err.message;
  }
  camSearch = false;
  if (screen !== 'cameras') return refreshStatus();
  status ? drawCameras(status) : renderCameras();
  return status;
}

export function addCamera() {
  return changeCameras('/cameras', { address: document.getElementById('cam-address').value });
}

// Auto-calibrate one camera. `twenty` is a tapped pixel in the 20 segment; left
// out, the Pi uses the camera's existing calibration to know which way is up.
export async function autoCalibrate(camId, twenty) {
  camScreen.autoCal = null; camScreen.finding = camId;
  calibBusy = true; camScreen.calibNote = ''; camScreen.calibFailed = false;
  drawCameras(await api('/status', 'GET', undefined, 4000).catch(() => null));
  try {
    const r = await api(`/cameras/${camId}/autocalibration`, 'POST', twenty ? { twenty, number: camScreen.number } : {});
    camScreen.calibNote = `Board found: ${r.joins} of 40 points, within ${r.rms_px} px.`;
    setCameraCount(Math.max(cameraCount, 1));
    tracker.track('calibrated', { ok: true, how: 'auto', joins: r.joins, rms_px: r.rms_px, tapped: !!twenty });
  } catch (err) {
    camScreen.calibNote = err.message; camScreen.calibFailed = true;
    tracker.track('calibrated', { ok: false, how: 'auto', why: err.message, tapped: !!twenty });
  }
  calibBusy = false; camScreen.finding = null;
  if (onCamerasTab()) renderCameras();
}

// Each time the app is opened, or someone signs in: every camera that has been
// lined up before finds the board again, one after another, with nothing to
// press. A camera gets nudged between one evening and the next, and this saves
// going through them by hand. It is asked for on each hello from the cameras'
// computer and done once. A camera never lined up is left alone (it needs a tap
// on the 20 first), and one that can't find the board keeps the line-up it had.
// Not under a game: there may be darts in the board. Settings: autoCal.
export async function calibrateOnStart() {
  if (camScreen.startCal) return;
  if (account.hosted && !(account.account && helperLinked)) return;  // their cameras can't be reached yet
  camScreen.startCal = 'wait';
  // the settings as they were last saved, from any device: is this switched off?
  await Promise.race([data.sync(true).catch(() => {}), new Promise(done => setTimeout(done, 5000))]);
  if (settings.autoCal === false || screen === 'game' || screen === 'bull') { camScreen.startCal = 'done'; return; }
  camScreen.startCal = 'busy';
  let todo = [];
  for (let tries = 0; tries < 5; tries++) {  // a camera just switched on has no picture for a moment
    const status = await api('/status', 'GET', undefined, 6000).catch(() => null);
    if (!status) { camScreen.startCal = ''; return refreshStatus(); }  // not reached: the next hello asks again
    const lined = status.cameras.filter(c => c.points);
    todo = lined.filter(c => c.ok);
    if (todo.length === lined.length) break;
    await new Promise(done => setTimeout(done, 2000));
  }
  if (!todo.length) { camScreen.startCal = 'done'; return refreshStatus(); }
  calibBusy = true; camScreen.calibNote = ''; camScreen.calibFailed = false;
  refreshStatus();
  if (onCamerasTab()) renderCameras();
  const missed = [];
  for (const cam of todo) {
    try {
      const r = await api(`/cameras/${cam.id}/autocalibration`, 'POST', { idle: true }, 30000);
      tracker.track('calibrated', { ok: true, how: 'start', joins: r.joins, rms_px: r.rms_px, tapped: false });
    } catch (err) {
      missed.push(cam.label);
      tracker.track('calibrated', { ok: false, how: 'start', why: err.message, tapped: false });
    }
  }
  calibBusy = false; camScreen.startCal = 'done';
  const n = todo.length - missed.length;
  camScreen.calibNote = !missed.length ? `Board found again on ${n === 1 ? 'the camera' : n === 2 ? 'both cameras' : `all ${n} cameras`} when the app opened.`
    : `Couldn't find the board again on ${missed.join(', ')} when the app opened, so ${missed.length > 1 ? 'they keep' : 'it keeps'} the line-up from before.`;
  refreshStatus();
  if (onCamerasTab()) renderCameras();
}

export async function calibTap(camId, img, e) {
  const pts = camScreen.calib[camId];
  const r = img.getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  if (camScreen.autoCal === camId) return autoCalibrate(camId, [fx * img.naturalWidth, fy * img.naturalHeight]);
  if (!pts) return;
  pts.push({ fx, fy, x: fx * img.naturalWidth, y: fy * img.naturalHeight });
  if (pts.length === 4) {
    delete camScreen.calib[camId];
    await fetch(`/api/cameras/${camId}/calibration`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: pts.map(p => [p.x, p.y]) }),
    });
    setCameraCount(Math.max(cameraCount, 1));
    camScreen.calibNote = ''; camScreen.calibFailed = false;
    tracker.track('calibrated', { ok: true, how: 'manual' });
  }
  renderCameras();
}

// The tracker is told the board is empty as it stands: what it takes to be darts is forgotten.
export async function resetDetection() {
  camScreen.calibFailed = false;
  camScreen.calibNote = await fetch('/api/reset', { method: 'POST' }).then(r => r.ok, () => false)
    ? 'Done: the board is taken as empty.' : 'That didn\'t reach the cameras. Try again.';
  if (onCamerasTab()) renderCameras();
}
