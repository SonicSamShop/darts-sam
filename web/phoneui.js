// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The phone camera's own screen (Beta): its picture, lining it up with the
// board, and what it is doing. It is a sheet over the app rather than one of
// app.js's screens, because the camera's <video> has to stay alive while the
// game is played on the screens underneath (a video taken out of the page
// stops). The scoring itself is phonecam.js.

import { createPhoneCam, screenPoint, videoPoint } from './phonecam.js';
import { choices, createQueue, question } from './ask.js';

const KEY = 'phonecam';  // this phone's calibration: kept on this device only, as another device's camera is elsewhere

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// [headline, words, buttons] for each state. Buttons: [action, label, primary?]
const SAY = {
  loading: d => ['Getting ready…', `Loading the vision code (step ${d.step || 1} of 3). The first time this downloads about 27 MB; after that it starts in a few seconds.`, [['off', 'Stop using the phone camera']]],
  denied: () => ['The camera isn\'t allowed', 'Allow this site to use the camera in the browser\'s settings, then try again.', [['retry', 'Try again', true], ['off', 'Stop using the phone camera']]],
  'no-camera': () => ['No camera found', 'The browser can\'t find a camera on this device.', [['retry', 'Try again', true], ['off', 'Stop using the phone camera']]],
  busy: () => ['The camera is busy', 'Another app is using the camera. Close it, then try again.', [['retry', 'Try again', true], ['off', 'Stop using the phone camera']]],
  lost: () => ['The camera stopped', 'The phone stopped the camera, perhaps while the app was in the background. Press Try again to start it.', [['retry', 'Try again', true], ['off', 'Stop using the phone camera']]],
  error: d => ['Something went wrong', `${esc(d.reason)} You can still score by tapping the board.`, [['retry', 'Try again', true], ['off', 'Stop using the phone camera']]],
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

// onEvent(ev): a dart, takeout or removed, ready for the game. onChange(): its
// state changed (for the status line). store: app.js's {get, set}. inGame():
// is a game being played here (so a dart is worth asking about)? say(text):
// the caller, if sound is on. note(kind, detail): the trial's notes
// (track.js). undoLast(): take the game's last dart back out. dartCount(): how
// many darts the game has, to see when one is tapped in by hand.
export function createPhoneUi({ onEvent = () => {}, onChange = () => {}, store, inGame = () => false, say = () => {},
  note = () => {}, undoLast = () => {}, dartCount = () => 0, doc = globalThis.document, fetchFn = globalThis.fetch }) {
  let cam = null, sheet = null, video = null, canvas = null, panel = null, toastTimer = 0, watchGame = 0, waitTap = 0;
  let state = 'off', detail = {}, lines = null, offered = null;
  const STOPPED = ['denied', 'no-camera', 'busy'];  // never got going: as good as off
  // One saved before the board's picture was kept with it (anchor) can't be
  // lined up with, so a phone shaken on its stand would score in the wrong
  // place: the board is found again, once.
  let calibration = store.get(KEY, null)?.calibration ?? null;
  if (calibration && !calibration.anchor) calibration = null;

  const set = (s, d = {}) => {
    state = s; detail = d;
    if (s === 'knocked') show();  // say so where it will be seen
    draw();
    onChange();
  };

  function build() {
    sheet = doc.createElement('div');
    sheet.className = 'phonesheet tucked';
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

  // ---------- asking which bed ----------
  const queue = createQueue({ onPass: passed, onAsk: ask });

  // What the camera saw. Outside a game nothing is asked (the bull-off goes by
  // where the dart is, not which bed).
  function seen(ev) {
    if (!queue.holding()) hideToast();
    if (!inGame()) { queue.clear(); hidePanel(); return onEvent(ev); }
    queue.add(ev);
  }

  function passed(ev) {
    onEvent(ev);
    if (ev.type === 'dart' && ev.odds && !ev.asked) showToast(ev);
  }

  function ask(ev) {
    if (!panel) {
      panel = doc.createElement('div');
      panel.className = 'askpanel';
      doc.body.appendChild(panel);
      panel.addEventListener('click', e => {
        const b = e.target.closest('[data-pick]');
        if (b) picked(b.dataset.pick === 'else' ? null : choices(queue.current())[+b.dataset.pick]);
      });
    }
    panel.innerHTML = `<b class="ps-head">Which bed?</b>
      <p class="dim">The phone camera <span class="beta">Beta</span> isn't sure where that dart landed.</p>
      <div class="row">${choices(ev).map((c, i) => `<button class="${i ? '' : 'primary'}" data-pick="${i}">${c.label}<span class="pct">${c.pct}%</span></button>`).join('')}
        <button class="ghost" data-pick="else">Somewhere else</button></div>`;
    panel.hidden = false;
    say(question(ev));
    // Left the game with the question open: forget it.
    clearInterval(watchGame);
    watchGame = setInterval(() => { if (!inGame()) { queue.clear(); hidePanel(); } }, 1000);
  }

  function picked(choice) {
    const ev = queue.current();
    if (!ev) return hidePanel();
    note('asked', { odds: ev.odds, chose: choice && { seg: choice.seg, mult: choice.mult }, changed: !!ev.ask });
    hidePanel();
    if (choice) return queue.settle({ seg: choice.seg, mult: choice.mult, asked: true });
    // "Somewhere else": tapped in on the board, as without a camera. Darts the
    // camera saw after it wait until it is in, so the game keeps them in order.
    const had = dartCount();
    queue.settle(null);
    hint('Tap the board where that dart landed.');
    clearInterval(waitTap);
    waitTap = setInterval(() => {
      if (!inGame()) { clearInterval(waitTap); hideToast(); return queue.clear(); }
      if (dartCount() > had) { clearInterval(waitTap); hideToast(); queue.release(); }
    }, 250);
  }

  function hidePanel() {
    clearInterval(watchGame);
    if (panel) panel.hidden = true;
  }

  // A dart it was sure of, for a few seconds: what it scored, and a way to change it.
  function showToast(ev) {
    let t = doc.querySelector('.asktoast');
    if (!t) {
      t = doc.createElement('div');
      t.className = 'asktoast';
      doc.body.appendChild(t);
      t.addEventListener('click', e => {
        if (!e.target.closest('[data-change]') || !t.dart) return;
        const d = t.dart;
        hideToast();
        undoLast();
        queue.add({ ...d, ask: true });
      });
    }
    t.dart = ev;
    t.hidden = false;
    if (!ev) return;
    const top = choices(ev)[0];
    t.innerHTML = `<span class="beta">Beta</span><span>${top.label}<span class="pct">${top.pct}%</span></span><button data-change>Change</button>`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }
  // Words in the toast's place, with nothing to press, until hideToast().
  function hint(text) {
    showToast(null);
    const t = doc.querySelector('.asktoast');
    t.innerHTML = `<span class="beta">Beta</span><span>${esc(text)}</span>`;
    clearTimeout(toastTimer);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    const t = doc.querySelector('.asktoast');
    if (t) { t.hidden = true; t.dart = null; }
  }

  async function begin() {
    if (!cam) cam = createPhoneCam({ onEvent: seen, onStatus: status });
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
    if (['loading', 'denied', 'no-camera', 'busy', 'unsettled', 'knocked', 'lost', 'error'].includes(s)) set(s, d);
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

  // Out of the way, not display:none: some phones stop a video that isn't drawn.
  function tuck() { sheet?.classList.add('tucked'); }

  function show() {
    if (!sheet) build();
    sheet.classList.remove('tucked');
    draw();
  }

  function act(a) {
    if (a === 'close') return tuck();
    if (a === 'retry') { set('loading', { step: 1 }); return begin(); }
    if (a === 'find') { cam?.pause(); return set('twenty'); }  // nothing scored while the board is found again
    if (a === 'aim') return calibration ? watch(calibration) : set('aim');
    if (a === 'off') {
      cam?.stop();
      lines = null;
      tuck();
      set('off');
    }
  }

  // ---------- reporting a dart it got wrong ----------
  function reportBox(app) {
    const box = doc.body.appendChild(doc.createElement('div'));
    box.className = 'report';
    const show = html => { box.innerHTML = `<div class="report-in">${html}</div>`; };
    const close = '<div class="row"><button data-rep="close">Close</button></div>';
    show(`<h1>Report a wrong score <span class="beta">Beta</span></h1>
      <p class="dim">This sends the phone camera's last few pictures of the board to your account, to help put it right.</p>
      <label>What should it have been? <input type="text" id="rep-expected" placeholder="T20, or: second dart not seen" autocomplete="off"></label>
      <div class="row"><button class="primary" data-rep="send">Send report</button><button data-rep="close">Cancel</button></div>`);
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-rep]');
      if (!b) return;
      if (b.dataset.rep === 'close') return box.remove();
      const expected = box.querySelector('#rep-expected')?.value || '';
      show('<p class="dim">Sending…</p>');
      try {
        const made = await cam.report(app, expected);
        const r = await fetchFn(new URL(`./api/phone/reports/${encodeURIComponent(made.id)}`, import.meta.url), {
          method: 'POST', body: made.zip, credentials: 'same-origin', headers: { 'Content-Type': 'application/zip' } });
        if (!r.ok) throw new Error(r.status === 413 ? 'There is no room left for reports.' : `the site said ${r.status}`);
        note('report', { phone: true });
        show(`<h1>Report sent</h1><p class="dim">Thank you: it helps make the phone camera better.</p>${close}`);
      } catch (err) {
        show(`<p class="warn">The report could not be sent: ${esc(err?.message || err)}.</p>${close}`);
      }
    });
    box.querySelector('#rep-expected')?.focus();
  }

  return {
    // The camera's picture as it is now, while it is scoring: for a picture of the board
    // kept with an achievement (app.js). null when this phone's camera is not in use.
    video: () => (cam?.watching() && video?.videoWidth ? video : null),

    // A dart was scored wrongly: report what the camera saw (app: about the game).
    report: app => (cam?.watching() ? reportBox(app) : undefined),

    // Whether to offer it here: a browser that gives pages the camera, on a
    // secure page, with the vision code on the server (tools/fetch_pyodide.py).
    async offered() {
      if (offered !== null) return offered;
      if (!createPhoneCam().supported()) return (offered = false);
      const url = new URL('./vision/pyodide/pyodide.mjs', import.meta.url);
      try { offered = (await fetchFn(url, { method: 'HEAD' })).ok; } catch { offered = false; }
      // Offline, but loaded before: the service worker kept it (sw.js).
      if (!offered) offered = !!(await globalThis.caches?.match(url).catch(() => null));
      return offered;
    },
    offeredNow: () => offered === true,

    // Open its screen, starting the camera the first time.
    open() {
      show();
      if (state === 'off' || STOPPED.includes(state) || state === 'lost' || state === 'error') { set('loading', { step: 1 }); begin(); }
    },

    on: () => state !== 'off' && !STOPPED.includes(state),
    scoring: () => state === 'watching' || state === 'unsettled',

    // For the status line, with the Beta label; '' when it isn't on.
    statusText() {
      if (state === 'off') return '';
      if (state === 'watching') return 'Auto-scoring · phone camera (Beta)';
      if (state === 'unsettled') return 'Phone camera (Beta) · picture won\'t settle';
      if (state === 'knocked') return 'Phone camera (Beta) · find the board again';
      if (state === 'lost' || state === 'error') return 'Phone camera (Beta) · stopped: open it to start again';
      return 'Phone camera (Beta) · not lined up';
    },
  };
}
