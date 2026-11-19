// node --test tests/
// Reloading onto a new version (web/update.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdater } from '../web/update.js';

function rig() {
  const r = { reloads: 0, idle: true, kept: null };
  r.up = createUpdater({
    reload: () => r.reloads++,
    idle: () => r.idle,
    memory: { get: () => r.kept, set: v => { r.kept = v; } },
  });
  return r;
}

test('same version: no reload', () => {
  const r = rig();
  r.up.running('a');
  r.up.seen('a');
  r.up.seen('a');
  assert.equal(r.reloads, 0);
});

test('new version while idle: reloads at once', () => {
  const r = rig();
  r.up.running('a');
  r.up.seen('b');
  assert.equal(r.reloads, 1);
});

test('new version mid-game: waits until idle', () => {
  const r = rig();
  r.up.running('a');
  r.idle = false;
  r.up.seen('b');
  r.up.check();
  assert.equal(r.reloads, 0);
  r.idle = true;
  r.up.check();
  assert.equal(r.reloads, 1);
});

test('the Pi heard from first stands in until the page\'s own version is known', () => {
  const r = rig();
  r.up.seen('b');            // the link came up before version.json was read
  assert.equal(r.reloads, 0);
  r.up.running('a');         // the page turns out to be an older saved copy
  assert.equal(r.reloads, 1);
});

test('no version of its own (served by something else): the first one heard is kept', () => {
  const r = rig();
  r.up.seen('a');
  r.up.seen('a');
  assert.equal(r.reloads, 0);
  r.up.seen('b');
  assert.equal(r.reloads, 1);
});

test('a reload that came back with old files is not repeated', () => {
  const r = rig();
  r.kept = 'b';              // already reloaded for b before this page opened
  r.up.running('a');
  r.up.seen('b');
  assert.equal(r.reloads, 0);
  r.up.seen('c');            // a later version is a new reason
  assert.equal(r.reloads, 1);
});

test('an old Pi that sends no version changes nothing', () => {
  const r = rig();
  r.up.running('a');
  r.up.seen(undefined);
  assert.equal(r.reloads, 0);
});
