import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker } from '../web/track.js';

function setup({ recording = true, sending = true } = {}) {
  const mem = new Map();
  const store = { get: (k, d) => mem.get(k) ?? d, set: (k, v) => mem.set(k, JSON.parse(JSON.stringify(v))) };
  const sent = [], state = { recording, sending, fail: false, t: 100 };
  const t = createTracker({
    store, now: () => state.t++,
    recording: () => state.recording, sending: () => state.sending,
    send: async batch => { if (state.fail) throw new Error('offline'); sent.push(batch); },
  });
  return { t, sent, state, queued: () => store.get('events', []) };
}
const cam = { t: 'dart', seg: 20, mult: 3, src: 'cam' }, tap = { t: 'dart', seg: 19, mult: 3, src: 'tap' };

test('a camera dart undone and entered by hand is a correction', () => {
  const { t, queued } = setup();
  t.undone('m1', cam);
  t.entered('m1', tap);
  assert.deepEqual(queued(), [{ kind: 'correction', ts: 100, detail: { match: 'm1', was: { seg: 20, mult: 3 }, now: { seg: 19, mult: 3, src: 'tap' } } }]);
  t.entered('m1', tap);  // the next dart is just a dart
  assert.equal(queued().length, 1);
});
test('the Miss button counts as entering by hand', () => {
  const { t, queued } = setup();
  t.undone('m1', cam);
  t.entered('m1', { t: 'dart', seg: 0, mult: 0, src: 'miss' });
  assert.equal(queued()[0].detail.now.src, 'miss');
});
test('undos that are not corrections', () => {
  const { t, queued } = setup();
  t.undone('m1', tap); t.entered('m1', tap);                 // a hand-entered dart undone
  t.undone('m1', cam); t.entered('m1', cam);                 // undone, then the cameras scored again
  t.undone('m1', cam); t.moved(); t.entered('m1', tap);      // undone, then on to the next player
  t.undone('m1', cam); t.undone('m1', tap); t.entered('m1', tap);  // a second undo, of a hand dart
  t.undone('m1', cam); t.entered('m2', tap);                 // another game
  t.undone('m1', undefined); t.entered('m1', tap);           // nothing to undo
  assert.deepEqual(queued(), []);
});
test('nothing is recorded when not the hosted version', () => {
  const { t, queued } = setup({ recording: false });
  t.track('open', {}); t.undone('m1', cam); t.entered('m1', tap);
  assert.deepEqual(queued(), []);
});
test('events wait while signed out or offline, then go once, in order, 50 at a time', async () => {
  const { t, sent, state, queued } = setup({ sending: false });
  for (let i = 0; i < 120; i++) t.track('open', { i });
  await t.flush();
  assert.equal(sent.length, 0);
  assert.equal(queued().length, 120);
  state.sending = true; state.fail = true;
  await t.flush();                                           // offline: kept
  assert.equal(queued().length, 120);
  state.fail = false;
  await t.flush();
  assert.deepEqual(sent.map(b => b.length), [50, 50, 20]);
  assert.deepEqual(sent.flat().map(e => e.detail.i), [...Array(120).keys()]);
  assert.deepEqual(queued(), []);
  await t.flush();                                           // nothing is sent twice
  assert.equal(sent.length, 3);
});
test('only the newest 200 are kept while waiting', () => {
  const { t, queued } = setup({ sending: false });
  for (let i = 0; i < 250; i++) t.track('open', { i });
  assert.equal(queued().length, 200);
  assert.equal(queued()[0].detail.i, 50);
});
test('an event recorded while a batch is being sent is not lost', async () => {
  const mem = new Map();
  const store = { get: (k, d) => mem.get(k) ?? d, set: (k, v) => mem.set(k, v) };
  let release, t;
  const sent = [];
  t = createTracker({ store, recording: () => true, sending: () => true,
    send: batch => new Promise(done => { sent.push(batch); release = done; }) });
  t.track('open', { n: 1 });
  const flushing = t.flush();
  await new Promise(r => setTimeout(r));
  t.track('report', { n: 2 });
  const second = t.flush();                                  // asked again meanwhile: does not send the same batch twice
  release();
  await new Promise(r => setTimeout(r));
  release();
  await Promise.all([flushing, second]);
  assert.deepEqual(sent.map(b => b.map(e => e.detail.n)), [[1], [2]]);
  assert.deepEqual(store.get('events', []), []);
});
