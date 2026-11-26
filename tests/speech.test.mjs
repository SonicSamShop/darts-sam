// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech, parseNumber, parseSpeech } from '../web/speech.js';

test('parseNumber handles digits, English words, and darts slang up to 180', () => {
  assert.equal(parseNumber('0'), 0);
  assert.equal(parseNumber('60'), 60);
  assert.equal(parseNumber('180'), 180);
  assert.equal(parseNumber('181'), null);
  assert.equal(parseNumber('twenty six'), 26);
  assert.equal(parseNumber('one hundred and forty'), 140);
  assert.equal(parseNumber('one hundred and eighty'), 180);
  assert.equal(parseNumber('one eighty'), 180);
  assert.equal(parseNumber('one forty five'), 145);
  assert.equal(parseNumber('ton'), 100);
  assert.equal(parseNumber('ton forty'), 140);
  assert.equal(parseNumber('ton twenty one'), 121);
  assert.equal(parseNumber('maximum'), 180);
  assert.equal(parseNumber('bed and breakfast'), 26);
  assert.equal(parseNumber('hello world'), null);
});

test('parseSpeech in keypad mode parses visit totals, commands, and checkout dart counts', () => {
  assert.deepEqual(parseSpeech('60', { mode: 'pad' }), { kind: 'visit', total: 60 });
  assert.deepEqual(parseSpeech('one hundred and twenty one', { mode: 'pad' }), { kind: 'visit', total: 121 });
  assert.deepEqual(parseSpeech('no score', { mode: 'pad' }), { kind: 'cmd', cmd: 'noscore' });
  assert.deepEqual(parseSpeech('miss', { mode: 'pad' }), { kind: 'cmd', cmd: 'noscore' });
  assert.deepEqual(parseSpeech('bust', { mode: 'pad' }), { kind: 'cmd', cmd: 'bust' });
  assert.deepEqual(parseSpeech('undo', { mode: 'pad' }), { kind: 'cmd', cmd: 'undo' });
  assert.deepEqual(parseSpeech('two darts', { mode: 'pad', askingFinish: true }), { kind: 'fin', darts: 2 });
  assert.deepEqual(parseSpeech('1', { mode: 'pad', askingFinish: true }), { kind: 'fin', darts: 1 });
  assert.equal(parseSpeech('200', { mode: 'pad' }), null);
});

test('parseSpeech in board mode parses single beds, slang, multi-dart phrases, and commands', () => {
  assert.deepEqual(parseSpeech('treble 20', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 20, mult: 3 }] });
  assert.deepEqual(parseSpeech('triple twenty', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 20, mult: 3 }] });
  assert.deepEqual(parseSpeech('double 16', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 16, mult: 2 }] });
  assert.deepEqual(parseSpeech('tops', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 20, mult: 2 }] });
  assert.deepEqual(parseSpeech('double tops', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 20, mult: 2 }] });
  assert.deepEqual(parseSpeech('madhouse', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 1, mult: 2 }] });
  assert.deepEqual(parseSpeech('bullseye', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 25, mult: 2 }] });
  assert.deepEqual(parseSpeech('outer bull', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 25, mult: 1 }] });
  assert.deepEqual(parseSpeech('single 5', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 5, mult: 1 }] });
  assert.deepEqual(parseSpeech('miss', { mode: 'board' }), { kind: 'darts', darts: [{ seg: 0, mult: 0 }] });
  assert.deepEqual(parseSpeech('T20 T20 D10', { mode: 'board' }), {
    kind: 'darts', darts: [{ seg: 20, mult: 3 }, { seg: 20, mult: 3 }, { seg: 10, mult: 2 }],
  });
  assert.deepEqual(parseSpeech('end turn', { mode: 'board' }), { kind: 'cmd', cmd: 'next' });
  assert.equal(parseSpeech('42', { mode: 'board' }), null);  // not a valid single bed
  assert.equal(parseSpeech('treble 25', { mode: 'board' }), null);  // no treble bull
});

test('createSpeech manages continuous listening and pauses while caller speaks', async () => {
  const instances = [];
  class FakeRec {
    constructor() { instances.push(this); this.aborted = false; }
    start() { this.onstart?.(); }
    abort() { this.aborted = true; }
  }
  const heard = [];
  const speech = createSpeech({ Recognition: FakeRec, onResult: a => heard.push(a), resumeDelay: 10 });
  assert.equal(speech.supported(), true);
  assert.equal(speech.active(), false);

  speech.start();
  assert.equal(speech.active(), true);
  assert.equal(speech.listening(), true);
  assert.equal(instances.length, 1);

  // Deliver a final result
  instances[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'treble 20' }], { isFinal: true })] });
  assert.deepEqual(heard, [['treble 20']]);

  // Caller starts speaking -> mic pauses and aborts current session
  speech.setMuted(true);
  assert.equal(speech.active(), true);
  assert.equal(speech.listening(), false);
  assert.equal(instances[0].aborted, true);

  // Caller finishes -> resumes after short echo guard delay
  speech.setMuted(false);
  await new Promise(r => setTimeout(r, 25));
  assert.equal(speech.listening(), true);
  assert.equal(instances.length, 2);

  // Stop turns it off cleanly
  speech.stop();
  assert.equal(speech.active(), false);
  assert.equal(speech.listening(), false);
});
