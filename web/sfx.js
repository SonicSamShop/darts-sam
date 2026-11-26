// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Lightweight Web Audio sound effects: crisp dart thuds, treble chimes, bust
// buzzes, and big-score fanfares (100+, 140+, 180, checkout). Pure synthesis
// so it works offline with zero audio asset downloads and fails silently where
// Web Audio is unavailable.

export function createSfx() {
  let ctx = null;
  function audio() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    return ctx;
  }

  function tone(c, { freq, to, type = 'sine', start = 0, dur = 0.12, gain = 0.16 }) {
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function thud(c, freq = 145, gain = 0.22) {
    tone(c, { freq, to: 42, type: 'triangle', dur: 0.085, gain });
  }

  return {
    unlock() { audio(); },
    // A single dart landing: dull tap on miss, sisal thud on single, bright pop on double/treble/bull.
    dart(d) {
      const c = audio();
      if (!c) return;
      if (!d || !d.mult) return thud(c, 95, 0.14);
      thud(c, 155, 0.22);
      if (d.seg === 25 && d.mult === 2) {
        tone(c, { freq: 587.3, type: 'triangle', start: 0.02, dur: 0.16, gain: 0.14 });
        tone(c, { freq: 880, type: 'sine', start: 0.05, dur: 0.2, gain: 0.12 });
      } else if (d.mult === 3) {
        tone(c, { freq: 659.3, type: 'triangle', start: 0.015, dur: 0.14, gain: 0.12 });
      } else if (d.mult === 2 || d.seg === 25) {
        tone(c, { freq: 523.3, type: 'sine', start: 0.015, dur: 0.11, gain: 0.09 });
      }
    },
    // Big visit celebration: 100+, 140+, and 180 Maximum.
    ton(score) {
      const c = audio();
      if (!c) return;
      const notes = score >= 180 ? [523.3, 659.3, 784, 1046.5]
        : score >= 140 ? [440, 554.4, 659.3]
        : [440, 554.4];
      notes.forEach((freq, i) => tone(c, {
        freq, type: score >= 180 ? 'triangle' : 'sine',
        start: i * 0.065, dur: i === notes.length - 1 ? 0.34 : 0.14, gain: score >= 180 ? 0.16 : 0.12,
      }));
    },
    bust() {
      const c = audio();
      if (!c) return;
      tone(c, { freq: 210, to: 150, type: 'sawtooth', start: 0, dur: 0.16, gain: 0.09 });
      tone(c, { freq: 150, to: 105, type: 'sawtooth', start: 0.14, dur: 0.24, gain: 0.09 });
    },
    win() {
      const c = audio();
      if (!c) return;
      [523.3, 659.3, 784, 1046.5].forEach((freq, i) => tone(c, {
        freq, type: 'triangle', start: i * 0.08, dur: i === 3 ? 0.45 : 0.16, gain: 0.16,
      }));
    },
  };
}
