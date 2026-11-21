// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneCam, settleState, videoPoint } from '../web/phonecam.js';

// Stand-ins for the browser: a worker that answers when told to, a camera,
// a page that can be hidden, and a clock.
function fakes({ camera = 'ok' } = {}) {
  const posted = [], statuses = [], events = [], listeners = {};
  let clock = 0;
  const worker = {
    postMessage(m) { posted.push(m); },
    reply(m) { this.onmessage({ data: m }); },
    // answer the last request of this kind
    answer(cmd, m) { const req = [...posted].reverse().find(p => p.cmd === cmd); this.reply({ id: req.id, ...m }); },
  };
  const track = { stop() { this.stopped = true; }, getCapabilities: () => ({}), applyConstraints: async () => {} };
  const nav = {
    mediaDevices: {
      getUserMedia: async () => {
        if (camera === 'denied') throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
        if (camera === 'none') throw Object.assign(new Error('no'), { name: 'NotFoundError' });
        return { getTracks: () => [track], getVideoTracks: () => [track] };
      },
    },
    wakeLock: { request: async () => ({ release: async () => {} }) },
  };
  const doc = { visibilityState: 'visible', addEventListener: (n, f) => { listeners[n] = f; } };
  const cam = createPhoneCam({
    onEvent: e => events.push(e), onStatus: s => statuses.push(s),
    nav, doc, secure: true, worker: () => worker, now: () => clock,
    grab: () => ({ frame: new ArrayBuffer(16), w: 2, h: 2 }), schedule: () => {},
  });
  const video = { play: async () => {} };
  return { cam, worker, posted, statuses, events, track, doc, listeners, video, tick: ms => { clock += ms; } };
}

async function watching(f) {
  const opening = f.cam.open(f.video);
  await new Promise(r => setTimeout(r));
  f.worker.answer('load', { type: 'ready' });
  await opening;
  const starting = f.cam.start({ points: [] });
  f.worker.answer('start', { type: 'started' });
  await starting;
}

test('a picture that never settles is said to be unsettled after 10 s', () => {
  assert.equal(settleState(9_000, 0), 'watching');
  assert.equal(settleState(10_001, 0), 'unsettled');
});

test('the camera needs a secure page and a browser that has one', () => {
  assert.equal(createPhoneCam({ nav: {}, secure: true }).supported(), false);
  assert.equal(createPhoneCam({ nav: { mediaDevices: { getUserMedia() {} } }, secure: false }).supported(), false);
  assert.equal(createPhoneCam({ nav: { mediaDevices: { getUserMedia() {} } }, secure: true }).supported(), true);
});

test('a refused camera says so, and nothing is loaded', async () => {
  const f = fakes({ camera: 'denied' });
  await assert.rejects(f.cam.open(f.video));
  assert.equal(f.statuses.at(-1), 'denied');
  assert.equal(f.posted.length, 0);
});

test('no camera says so', async () => {
  const f = fakes({ camera: 'none' });
  await assert.rejects(f.cam.open(f.video));
  assert.equal(f.statuses.at(-1), 'no-camera');
});

test('one picture at a time: the next waits for the answer', async () => {
  const f = fakes();
  await watching(f);
  f.cam.tick(); f.cam.tick();
  assert.equal(f.posted.filter(p => p.cmd === 'frame').length, 1);
  f.worker.answer('frame', { type: 'events', events: [] });
  await new Promise(r => setTimeout(r));
  f.cam.tick();
  assert.equal(f.posted.filter(p => p.cmd === 'frame').length, 2);
});

test('darts are passed on and "still" is not', async () => {
  const f = fakes();
  await watching(f);
  f.cam.tick();
  f.worker.answer('frame', { type: 'events', events: [{ type: 'still' }, { type: 'dart', seg: 20, mult: 3 }] });
  await new Promise(r => setTimeout(r));
  assert.deepEqual(f.events, [{ type: 'dart', seg: 20, mult: 3 }]);
});

test('a picture that keeps moving is reported, and settling clears it', async () => {
  const f = fakes();
  await watching(f);
  f.tick(11_000);
  f.cam.tick();
  f.worker.answer('frame', { type: 'events', events: [] });
  await new Promise(r => setTimeout(r));
  assert.equal(f.statuses.at(-1), 'unsettled');
  f.cam.tick();
  f.worker.answer('frame', { type: 'events', events: [{ type: 'still' }] });
  await new Promise(r => setTimeout(r));
  assert.equal(f.statuses.at(-1), 'watching');
});

test('hidden, it stops; back, it starts again from a fresh empty board', async () => {
  const f = fakes();
  await watching(f);
  f.doc.visibilityState = 'hidden'; f.listeners.visibilitychange();
  f.cam.tick();
  assert.equal(f.posted.filter(p => p.cmd === 'frame').length, 0);
  f.doc.visibilityState = 'visible'; f.listeners.visibilitychange();
  assert.ok(f.posted.some(p => p.cmd === 'restart'));
});

test('a knocked phone stops scoring and says so', async () => {
  const f = fakes();
  await watching(f);
  f.tick(61_000);
  f.cam.tick();
  const check = f.posted.find(p => p.cmd === 'check');
  assert.ok(check, 'a minute with the board empty: look whether it has moved');
  f.worker.answer('check', { type: 'checked', ok: false });
  await new Promise(r => setTimeout(r));
  assert.equal(f.statuses.at(-1), 'knocked');
  f.cam.tick();
  assert.equal(f.posted.filter(p => p.cmd === 'frame').length, 0);
});

test('no knock check while darts are in the board', async () => {
  const f = fakes();
  await watching(f);
  f.cam.tick();
  f.worker.answer('frame', { type: 'events', events: [{ type: 'dart', seg: 1, mult: 1 }] });
  await new Promise(r => setTimeout(r));
  f.tick(61_000);
  f.cam.tick();
  assert.equal(f.posted.filter(p => p.cmd === 'check').length, 0);
});

test('a tap on the shown picture is turned into the camera picture\'s pixels', () => {
  // a 1280x720 picture shown "contain" in a 640x480 box: 640x360, 60 px bars above and below
  const rect = { left: 0, top: 0, width: 640, height: 480 };
  assert.deepEqual(videoPoint(rect, 1280, 720, 320, 240), [640, 360]);
  assert.deepEqual(videoPoint(rect, 1280, 720, 0, 60), [0, 0]);
  assert.equal(videoPoint(rect, 1280, 720, 320, 30), null, 'a tap on the bars is not on the picture');
});
