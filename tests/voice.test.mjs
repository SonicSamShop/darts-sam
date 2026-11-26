// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoice, rank, starterCall } from '../web/voice.js';

// Stand-ins for the browser's speech.
function fakes({ voices = [] } = {}) {
  const spoken = [];
  const synth = { getVoices: () => voices, speak: u => spoken.push(u), cancel() {} };
  class Utterance { constructor(text) { this.text = text; } }
  return { synth, Utterance, spoken };
}

test('a device with a voice of its own uses it', () => {
  const f = fakes({ voices: [{ name: 'Daniel' }] });
  const voice = createVoice(f);
  voice.say('Treble 20');
  assert.deepEqual(f.spoken.map(u => u.text), ['Treble 20']);
  assert.equal(voice.none(), false);
});

test('a device with no voice stays quiet', () => {
  const f = fakes();
  const voice = createVoice(f);
  assert.equal(voice.none(), true);
  voice.say('Treble 20');
  assert.equal(f.spoken.length, 0);
});

test('a browser with no speech at all does not break', () => {
  const voice = createVoice({ synth: undefined, Utterance: undefined });
  voice.unlock();
  voice.say(26);
  assert.equal(voice.none(), true);
});

test('a device voice that breaks is not asked again', () => {
  const f = fakes({ voices: [{ name: 'Broken' }] });
  const voice = createVoice(f);
  voice.say('Bust');
  f.spoken[0].onerror({ error: 'interrupted' });  // only cut off: still usable
  voice.say('Bust');
  assert.equal(f.spoken.length, 2);
  f.spoken[1].onerror({ error: 'synthesis-failed' });
  voice.say('Bust');
  assert.equal(f.spoken.length, 2);
  assert.equal(voice.none(), true);
});

test('the most natural-sounding English voice is picked, not the first listed', () => {
  const voices = [
    { name: 'Albert', lang: 'en-US', default: true },
    { name: 'Thomas', lang: 'fr-FR' },
    { name: 'Microsoft Hazel - English (United Kingdom)', lang: 'en-GB' },
    { name: 'Google UK English Male', lang: 'en-GB' },
    { name: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', lang: 'en-GB' },
    { name: 'eSpeak English', lang: 'en' },
  ];
  assert.deepEqual(rank(voices).map(v => v.name), [
    'Microsoft Ryan Online (Natural) - English (United Kingdom)',
    'Google UK English Male',
    'Microsoft Hazel - English (United Kingdom)',
    'Albert',
    'eSpeak English',
  ]);
  assert.equal(rank([{ name: 'Samantha', lang: 'en-US' }, { name: 'Daniel', lang: 'en_GB' }])[0].name, 'Daniel');
});

test('calls are spoken with the best voice, or the one chosen', async () => {
  const voices = [{ name: 'Albert', lang: 'en-US' }, { name: 'Daniel', lang: 'en-GB' }, { name: 'Karen', lang: 'en-AU' }];
  const f = fakes({ voices });
  const voice = createVoice(f);
  voice.say('Bust');
  assert.equal(f.spoken[0].voice.name, 'Daniel');
  assert.equal(f.spoken[0].lang, 'en-GB');
  voice.choose('Karen');
  voice.say('Bust');
  assert.equal(f.spoken[1].voice.name, 'Karen');
  voice.choose('Gone');  // a voice the device no longer has
  voice.say('Bust');
  assert.equal(f.spoken[2].voice.name, 'Daniel');
  assert.deepEqual(voice.voices(), ['Daniel', 'Karen', 'Albert']);
});

test('an online voice that cannot be reached hands over to the next best', async () => {
  const voices = [{ name: 'Google UK English Male', lang: 'en-GB' }, { name: 'Daniel', lang: 'en-GB' }];
  const f = fakes({ voices });
  const voice = createVoice(f);
  voice.say('Bust');
  f.spoken[0].onerror({ error: 'network' });
  assert.equal(f.spoken[1].voice.name, 'Daniel');
  assert.equal(voice.voice(), 'Daniel');
});

test('caller announces who throws first at match start and on each new leg or set', () => {
  assert.equal(starterCall(['Sam'], 0), 'Game on');
  assert.equal(starterCall(['Sam', 'Alex'], 0), 'Game on. Sam to throw first');
  assert.equal(starterCall(['Sam', 'Alex'], 1, { aim: 'Treble 20' }), 'Game on. Alex, aim for Treble 20');
  assert.equal(starterCall(['Sam'], 0, { aim: '1' }), 'Game on. Aim for 1');
  assert.equal(starterCall(['Sam', 'Alex'], 1, { leg: true }), 'Next leg, Alex to throw first');
  assert.equal(starterCall(['Sam', 'Alex'], 0, { leg: true, set: true }), 'Next set, Sam to throw first');
  assert.equal(starterCall(['Sam'], 0, { leg: true }), 'Next leg');
  assert.equal(starterCall(['Sam'], 0, { leg: true, set: true }), 'Next set');
});
