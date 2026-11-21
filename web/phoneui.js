// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The phone camera's own screen (Beta): its picture, lining it up with the
// board, and what it is doing. It is a sheet over the app rather than one of
// app.js's screens, because the camera's <video> has to stay alive while the
// game is played on the screens underneath (a video taken out of the page
// stops). The scoring itself is phonecam.js.

import { createPhoneCam, screenPoint, videoPoint } from './phonecam.js';

const KEY = 'phonecam';  // this phone's calibration: kept on this device only, as another device's camera is elsewhere

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// [headline, words, buttons] for each state. Buttons: [action, label, primary?]
const SAY = {
  loading: d => ['Getting ready…', `Loading the vision code (step ${d.step || 1} of 3). The first time this downloads about 27 MB; after that it starts in a few seconds.`, []],
  denied: () => ['The camera isn\'t allowed', 'Allow this site to use the camera in the browser\'s settings, then try again.', [['retry', 'Try again', true]]],
  'no-camera': () => ['No camera found', 'The browser can\'t find a camera on this device.', [['retry', 'Try again', true]]],
  error: d => ['Something went wrong', `${d.reason || ''} You can still score by tapping the board.`, [['retry', 'Try again', true]]],
  aim: () => ['Line it up with the board',
    'Stand the phone to one side of the board, about level with it, with the whole board in the picture. Straight in front hides the dart\'s point behind its flight. Take the darts out, then press <b>Find the board</b>.',
    [['find', 'Find the board', true], ['off', 'Stop using the phone camera']]],
  twenty: () => ['Tap the 20', 'Tap anywhere inside the <b>20</b> segment on the picture. That shows which way up the board is.', [['aim', 'Cancel']]],
  finding: () => ['Looking for the board…', 'This takes a few seconds.', []],
  failed: d => ['Couldn\'t find the board', `${esc(d.reason)} Check the whole board is in the picture and well lit, with no darts in it.`,
    [['find', 'Try again', true], ['off', 'Stop using the phone camera']]],
  watching: () => ['Ready to score',
    'The green lines should sit on the board\'s wires. If they don\'t, or the phone gets moved, find the board again. When it isn\'t sure of a dart it asks you.',
    [['close', 'Done', true], ['find', 'Find the board again'], ['off', 'Stop using the phone camera']]],
  unsettled: () => ['The picture won\'t settle',
    'Something in the picture keeps changing: a flickering light, the camera refocusing, or the phone moving. Steady the phone and check the light.',
    [['close', 'Done', true], ['find', 'Find the board again'], ['off', 'Stop using the phone camera']]],
  knocked: () => ['The phone has moved', 'The board isn\'t where it was in the picture. Take the darts out and find the board again.',
    [['find', 'Find the board again', true], ['off', 'Stop using the phone camera']]],
};

// onEvent(ev): a dart, takeout or removed from the camera. onChange(): its
// state changed (for the status line). store: app.js's {get, set}.
export function createPhoneUi({ onEvent = () => {}, onChange = () => {}, store, doc = globalThis.document, fetchFn = globalThis.fetch }) {
  let cam = null, sheet = null, video = null, canvas = null;
  let state = 'off', detail = {}, lines = null, offered = null;
  let calibration = store.get(KEY, null)?.calibration ?? null;

  const set = (s, d = {}) => {
    state = s; detail = d;
    if (s === 'knocked') show();  // say so where it will be seen
    draw();
    onChange();
  };

  function build() {
    sheet = doc.createElement('div');
    sheet.className = 'phonesheet';
    sheet.hidden = true;
    sheet.innerHTML = `<div class="ps-top"><b>Phone camera</b><span class="beta" title="Still being tried out: it will get some darts wrong">Beta</span>
        <button class="ghost" data-ps="close">Close</button></div>
      <div class="ps-view"><video playsinline muted autoplay></video><canvas></canvas></div>
      <div class="ps-say"></div>`;
    doc.body.appendChild(sheet);
    video = sheet.querySelector('video');
    canvas = sheet.querySelector('canvas');
    sheet.addEventListener('click', e => {
      const b = e.target.closest('[data-ps]');
      if (b) return act(b.dataset.ps);
      if (state === 'twenty' && e.target === canvas) tapped(e.clientX, e.clientY);
    });
    globalThis.addEventListener?.('resize', drawLines);
    video.addEventListener('loadedmetadata', drawLines);
  }

  function draw() {
    if (!sheet) return;
    const [head, text, acts] = (SAY[state] || SAY.aim)(detail);
    sheet.querySelector('.ps-say').innerHTML = `<b class="ps-head">${head}</b><p class="dim">${text}</p>
      <div class="row">${acts.map(([a, l, p]) => `<button class="${p ? 'primary' : ''}" data-ps="${a}">${l}</button>`).join('')}</div>`;
    sheet.classList.toggle('tapping', state === 'twenty');
    drawLines();
  }

  // The found board's rings and wires over the picture, in green.
  function drawLines() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lines || !calibration || !video.videoWidth || !['watching', 'unsettled'].includes(state)) return;
    const [cw] = calibration.size, k = video.videoWidth / cw;
    const box = { left: 0, top: 0, width: rect.width, height: rect.height };
    ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 1.5 * dpr;
    for (const line of lines) {
      ctx.beginPath();
      line.forEach(([x, y], i) => {
        const [sx, sy] = screenPoint(box, video.videoWidth, video.videoHeight, x * k, y * k);
        ctx[i ? 'lineTo' : 'moveTo'](sx * dpr, sy * dpr);
      });
      ctx.stroke();
    }
  }

  async function begin() {
    if (!cam) cam = createPhoneCam({ onEvent, onStatus: status });
    try {
      await cam.open(video);
    } catch (e) {
      if (state !== 'denied' && state !== 'no-camera') set('error', { reason: String(e?.message || e) });
      return;
    }
    if (calibration) return watch(calibration);
    set('aim');
  }

  async function watch(cal) {
    try {
      await cam.start(cal);
      lines = await cam.outline(cal);
      set('watching');
    } catch (e) { set('error', { reason: String(e?.message || e) }); }
  }

  function status(s, d) {
    if (['loading', 'denied', 'no-camera', 'unsettled', 'knocked'].includes(s)) set(s, d);
    else if (s === 'watching' && ['unsettled', 'watching'].includes(state)) set('watching');
  }

  async function tapped(x, y) {
    const pt = videoPoint(canvas.getBoundingClientRect(), video.videoWidth, video.videoHeight, x, y);
    if (!pt) return;
    set('finding');
    let r;
    try { r = await cam.calibrate(pt); } catch (e) { r = { ok: false, reason: String(e?.message || e) }; }
    if (!r?.ok) return set('failed', { reason: r?.reason });
    calibration = r.calibration;
    store.set(KEY, { calibration, savedAt: Date.now() });
    watch(calibration);
  }

  function show() {
    if (!sheet) build();
    sheet.hidden = false;
    draw();
  }

  function act(a) {
    if (a === 'close') { sheet.hidden = true; return; }
    if (a === 'retry') { set('loading', { step: 1 }); return begin(); }
    if (a === 'find') return set('twenty');
    if (a === 'aim') return set(calibration && cam?.watching() ? 'watching' : 'aim');
    if (a === 'off') {
      cam?.stop();
      lines = null;
      sheet.hidden = true;
      set('off');
    }
  }

  return {
    // Whether to offer it here: a browser that gives pages the camera, on a
    // secure page, with the vision code on the server (tools/fetch_pyodide.py).
    async offered() {
      if (offered !== null) return offered;
      if (!createPhoneCam().supported()) return (offered = false);
      try { offered = (await fetchFn(new URL('./vision/pyodide/pyodide.mjs', import.meta.url), { method: 'HEAD' })).ok; } catch { offered = false; }
      return offered;
    },
    offeredNow: () => offered === true,

    // Open its screen, starting the camera the first time.
    open() {
      show();
      if (state === 'off') { set('loading', { step: 1 }); begin(); }
    },

    on: () => state !== 'off',
    scoring: () => state === 'watching' || state === 'unsettled',

    // For the status line, with the Beta label; '' when it isn't on.
    statusText() {
      if (state === 'off') return '';
      if (state === 'watching') return 'Auto-scoring · phone camera (Beta)';
      if (state === 'unsettled') return 'Phone camera (Beta) · picture won\'t settle';
      if (state === 'knocked') return 'Phone camera (Beta) · find the board again';
      return 'Phone camera (Beta) · not lined up';
    },
  };
}
