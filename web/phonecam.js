// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Scoring with this phone's own camera (Beta). The camera's pictures go to a
// worker running the same Python vision code as the cameras' computer
// (vision-worker.js, server/phonevision.py), and what it sees comes back as
// the events /ws sends: dart, takeout, removed. Nothing leaves the phone.
//
// Browsers only give a page the camera over https (or on localhost).

const WIDTH = 1280;          // px across the picture the vision code is given
const EVERY_MS = 125;        // at most 8 pictures a second: enough, and kinder to the battery
export const SETTLE_MS = 10_000;  // no still picture for this long: something keeps it moving
const CHECK_MS = 60_000;     // with the board empty, look this often whether the phone was knocked

// The picture has been moving for too long (autofocus hunting, a flickering light).
export function settleState(nowMs, lastStillMs) {
  return nowMs - lastStillMs > SETTLE_MS ? 'unsettled' : 'watching';
}

// Where a tap on the shown picture (object-fit: contain) is in the camera's
// own picture, in its pixels; null on the bars beside it.
export function videoPoint(rect, vw, vh, clientX, clientY) {
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const left = rect.left + (rect.width - vw * scale) / 2, top = rect.top + (rect.height - vh * scale) / 2;
  const x = (clientX - left) / scale, y = (clientY - top) / scale;
  if (x < 0 || y < 0 || x > vw || y > vh) return null;
  return [Math.round(x), Math.round(y)];
}

// The other way: where a point in the camera's picture shows on screen.
export function screenPoint(rect, vw, vh, x, y) {
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const left = rect.left + (rect.width - vw * scale) / 2, top = rect.top + (rect.height - vh * scale) / 2;
  return [left + x * scale, top + y * scale];
}

function canvasGrab(video) {
  let canvas, ctx;
  return () => {
    if (!video?.videoWidth) return null;
    const w = WIDTH, h = Math.round(video.videoHeight * WIDTH / video.videoWidth);
    if (!canvas) {
      // OffscreenCanvas on the page itself needs iOS 16.4 or later; a plain canvas does the same job.
      canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(globalThis.document.createElement('canvas'), { width: w, height: h });
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(video, 0, 0, w, h);
    return { frame: ctx.getImageData(0, 0, w, h).data.buffer, w, h };
  };
}

// onEvent(ev): a dart, takeout or removed. onStatus(status, detail): one of
// loading (detail {step, of}), no-camera, denied, busy (another app has the
// camera), watching, unsettled, knocked, lost (the camera stopped), error
// (detail {reason}), stopped. The rest are stand-ins for the browser, for the tests.
export function createPhoneCam({
  onEvent = () => {}, onStatus = () => {},
  nav = globalThis.navigator, doc = globalThis.document, secure = globalThis.isSecureContext,
  worker = () => new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' }),
  now = () => Date.now(), grab = null, schedule = f => setTimeout(f, EVERY_MS),
} = {}) {
  let w = null, stream = null, video = null, grabber = grab, lock = null;
  let watching = false, busy = false, status = '', lastStill = 0, lastCheck = 0, darts = 0, seq = 0;
  let loaded = false, looping = false;
  const pending = new Map();

  const say = (s, detail) => { if (s !== status || detail) { status = s; onStatus(s, detail); } };

  function call(cmd, data = {}, transfer = []) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      if (!w) return reject(new Error('The vision code has stopped.'));
      pending.set(id, { resolve, reject });
      w.postMessage({ id, cmd, ...data }, transfer);
    });
  }
  function answer(m) {
    if (m.type === 'progress') return say('loading', { step: m.step, of: m.of });
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
  }

  // The worker died (out of memory, or its files couldn't be loaded): say so,
  // rather than wait for answers that will never come. open() starts another.
  function died(e) {
    e?.preventDefault?.();
    const err = new Error(e?.message || 'The vision code stopped.');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    w = null; loaded = false; watching = false; busy = false;
    say('error', { reason: err.message });
  }

  // The camera itself stopped (the phone took it back while the app was in the background).
  function lost() {
    if (!watching) return;
    watching = false;
    say('lost');
  }

  async function wake() {
    try { lock = await nav.wakeLock?.request('screen'); } catch { lock = null; }
  }

  // Auto exposure and focus keep changing the picture, which looks like
  // movement. Once the board is found, hold them where they are, where the
  // browser lets a page.
  async function holdPicture() {
    const track = stream?.getVideoTracks?.()[0];
    const can = track?.getCapabilities?.() || {};
    const hold = {};
    for (const k of ['exposureMode', 'focusMode', 'whiteBalanceMode']) if (can[k]?.includes('manual')) hold[k] = 'manual';
    if (Object.keys(hold).length) await track.applyConstraints({ advanced: [hold] }).catch(() => {});
  }

  function onFrame(m) {
    const t = now(), before = darts;
    for (const ev of m.events || []) {
      lastStill = t;
      if (ev.type === 'still') continue;
      if (ev.type === 'dart') darts++;
      else if (ev.type === 'removed') darts = Math.max(0, darts - 1);
      else if (ev.type === 'takeout') darts = 0;
      onEvent(ev);
    }
    // The tracker's own count wins: it can start again by itself without saying so.
    if (typeof m.darts === 'number') darts = m.darts;
    if (before > 0 && darts === 0) lastCheck = -Infinity;  // the board just emptied: look at once whether the phone moved
    if (watching) say(settleState(t, lastStill));
  }

  function tick() {
    if (!watching || busy || doc?.visibilityState === 'hidden') return;
    const shot = grabber();
    if (!shot) return;
    busy = true;
    const t = now();
    if (darts === 0 && t - lastCheck > CHECK_MS) {
      lastCheck = t;
      call('check', shot, [shot.frame]).then(m => {
        if (m.ok === false) { watching = false; say('knocked'); }
      }).catch(() => {}).finally(() => { busy = false; });
      return;
    }
    call('frame', shot, [shot.frame]).then(onFrame).catch(() => {}).finally(() => { busy = false; });
  }

  // One loop at a time, however often start() is called; it ends when watching stops.
  function loop() {
    if (!watching) { looping = false; return; }
    try { tick(); } finally { schedule(loop); }
  }
  function startLoop() {
    if (looping) return;
    looping = true;
    schedule(loop);
  }

  doc?.addEventListener?.('visibilitychange', () => {
    if (!watching) return;
    if (doc.visibilityState === 'hidden') { lock?.release?.().catch?.(() => {}); lock = null; return; }
    const track = stream?.getVideoTracks?.()[0];
    if (!track || track.readyState === 'ended') return lost();
    // The camera stopped while hidden; the board may have changed meanwhile.
    lastStill = lastCheck = now();
    darts = 0;
    call('restart').catch(() => {});
    wake();
  });

  return {
    supported: () => !!(secure && nav?.mediaDevices?.getUserMedia),

    // Ask for the back camera and show it in `videoEl`, then load the vision
    // code (about 27 MB the first time, kept for next time).
    async open(videoEl) {
      video = videoEl;
      for (const t of stream?.getTracks?.() || []) t.stop();  // trying again: let go of the last one first
      try {
        stream = await nav.mediaDevices.getUserMedia({
          audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (e) {
        say(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : e?.name === 'NotReadableError' ? 'busy' : 'no-camera');
        throw e;
      }
      stream.getVideoTracks?.()[0]?.addEventListener?.('ended', lost);
      if (video) { video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play?.(); }
      grabber ||= canvasGrab(video);
      if (!w) {
        w = worker();
        w.onmessage = e => answer(e.data);
        w.onerror = died;
        w.onmessageerror = died;
      }
      if (!loaded) {
        say('loading', { step: 0, of: 3 });
        await call('load');
        loaded = true;
      }
    },

    // Find the board in the picture now. twenty: [x, y] in the camera's
    // picture (see videoPoint), anywhere in the 20.
    async calibrate(twenty) {
      const shot = grabber();
      if (!shot) return { ok: false, reason: 'The camera has no picture yet.' };
      const scale = shot.w / (video?.videoWidth || shot.w);
      const m = await call('calibrate', { ...shot, twenty: twenty && twenty.map(v => v * scale) }, [shot.frame]);
      return m.result;
    },

    // Where the found board's rings and wires are in the pictures the vision
    // code is given (the calibration's own size), to draw over the picture.
    async outline(calibration) {
      return (await call('outline', { calibration })).lines;
    },

    // A problem report of what it saw: {id, zip}, packed as the site takes them.
    async report(app, expected) {
      const m = await call('report', { app, expected });
      return { id: m.reportId, zip: m.zip };
    },

    async start(calibration) {
      await call('start', { calibration });
      await holdPicture();
      watching = true;
      darts = 0;
      lastStill = lastCheck = now();
      say('watching');
      wake();
      startLoop();
    },

    // Stop scoring for a moment (while the board is found again), keeping the camera.
    pause() { watching = false; },

    stop() {
      watching = false;
      for (const t of stream?.getTracks?.() || []) t.stop();
      stream = null;
      if (video) video.srcObject = null;
      lock?.release?.().catch?.(() => {});
      lock = null;
      if (w) call('stop').catch(() => {});
      say('stopped');
    },

    tick,
    watching: () => watching,
  };
}
