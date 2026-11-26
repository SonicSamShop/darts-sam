// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Lightweight Web Audio sound effects & Career Mode pub/crowd atmosphere:
// crisp dart thuds, treble chimes, bust buzzes, big-score fanfares, background
// pub murmur with clinking glasses, mid-throw coughs, and crowd cheers/groans.
// Pure synthesis so it works offline with zero audio asset downloads and fails
// silently where Web Audio is unavailable.

export function createSfx() {
  let ctx = null;
  let noiseBuf = null;
  let amb = null;  // active background pub/crowd ambience node graph

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

  // Reusable 3-second pink-ish noise buffer for warm crowd/pub/cough synthesis.
  function noise(c) {
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    const len = Math.floor(c.sampleRate * 3);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.045;
      b6 = w * 0.115926;
    }
    noiseBuf = buf;
    return buf;
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

  // Bandpass-filtered noise burst: foundation for crowd roars, applause, groans, and coughs.
  function noiseBurst(c, {
    start = 0, dur = 0.5, freq = 600, toFreq = null, q = 1.2,
    attack = 0.06, gain = 0.16, filterType = 'bandpass',
  }) {
    const t0 = c.currentTime + start;
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(freq, t0);
    if (toFreq != null) filt.frequency.exponentialRampToValueAtTime(Math.max(60, toFreq), t0 + dur);
    filt.Q.setValueAtTime(q, t0);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(attack, dur * 0.45));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(c.destination);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.04);
  }

  function thud(c, freq = 145, gain = 0.22) {
    tone(c, { freq, to: 42, type: 'triangle', dur: 0.085, gain });
  }

  // Subtle pint-glass clink for pub-tier background ambience.
  function glassClink(c, vol = 0.025) {
    const base = 2400 + Math.random() * 900;
    tone(c, { freq: base, to: base * 0.99, type: 'sine', start: 0, dur: 0.14, gain: vol });
    tone(c, { freq: base * 1.49, type: 'sine', start: 0.008, dur: 0.09, gain: vol * 0.5 });
  }

  function stopAmbience() {
    if (!amb) return;
    const cur = amb;
    amb = null;
    clearInterval(cur.detailTimer);
    try {
      const now = cur.ctx.currentTime;
      cur.master.gain.cancelScheduledValues(now);
      cur.master.gain.setValueAtTime(Math.max(0.0001, cur.master.gain.value), now);
      cur.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      setTimeout(() => {
        try { cur.src.stop(); cur.lfo.stop(); cur.master.disconnect(); } catch { /* already stopped */ }
      }, 400);
    } catch { /* ignore */ }
  }

  function startAmbience(intensity = 0) {
    const lvl = Math.min(4, Math.max(0, intensity | 0));
    if (amb && amb.intensity === lvl) {
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    if (amb) stopAmbience();
    const c = audio();
    if (!c) return;
    try {
      const src = c.createBufferSource();
      src.buffer = noise(c);
      src.loop = true;

      // Two warm voice-formant bandpass filters give a cozy pub/crowd murmur rather than static.
      const fLow = c.createBiquadFilter();
      fLow.type = 'bandpass';
      fLow.frequency.value = 340 + lvl * 28;
      fLow.Q.value = 1.4;

      const fMid = c.createBiquadFilter();
      fMid.type = 'bandpass';
      fMid.frequency.value = 720 + lvl * 45;
      fMid.Q.value = 1.8;

      // Slow organic swell so the background crowd breathes like a real room.
      const lfo = c.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.14 + lvl * 0.03;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 55 + lvl * 15;
      lfo.connect(lfoGain);
      lfoGain.connect(fMid.frequency);

      const master = c.createGain();
      const targetVol = 0.075 + lvl * 0.022;  // gentle pub hum -> livelier tournament hall
      const now = c.currentTime;
      master.gain.setValueAtTime(0.0001, now);
      master.gain.linearRampToValueAtTime(targetVol, now + 0.7);

      src.connect(fLow);
      src.connect(fMid);
      fLow.connect(master);
      fMid.connect(master);
      master.connect(c.destination);

      src.start(now);
      lfo.start(now);

      // Periodic subtle pub/hall details (clinking glasses in pubs, distant murmur swells in arenas).
      const detailTimer = setInterval(() => {
        if (!amb || c.state !== 'running') return;
        const r = Math.random();
        if (lvl <= 2 && r < 0.35) {
          glassClink(c, 0.022 - lvl * 0.004);
        } else if (r < 0.55) {
          noiseBurst(c, {
            dur: 0.7 + Math.random() * 0.7,
            freq: 520 + Math.random() * 260,
            toFreq: 460 + Math.random() * 220,
            q: 2.2,
            attack: 0.25,
            gain: 0.025 + lvl * 0.008,
          });
        }
      }, 3400);

      amb = { ctx: c, src, lfo, master, detailTimer, intensity: lvl };
    } catch {
      amb = null;
    }
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
    // Background pub / venue murmur for Career Mode (intensity 0..4).
    ambienceStart(intensity = 0) { startAmbience(intensity); },
    ambienceStop() { stopAmbience(); },
    ambienceActive: () => !!amb,
    // Cheeky mid-throw cough / throat-clear to put the thrower off.
    cough(intensity = 0) {
      const c = audio();
      if (!c) return;
      const lvl = Math.min(4, Math.max(0, intensity | 0));
      const bursts = lvl >= 2 ? 2 : 1;
      for (let i = 0; i < bursts; i++) {
        const start = i * 0.19;
        const f = 540 + Math.random() * 140 + i * 60;
        // Chest thump + raspy vocal-tract burst
        tone(c, { freq: 150 + i * 18, to: 85, type: 'triangle', start, dur: 0.09, gain: 0.14 + lvl * 0.015 });
        noiseBurst(c, {
          start, dur: 0.13, freq: f, toFreq: f * 0.68, q: 2.6,
          attack: 0.015, gain: 0.24 + lvl * 0.025,
        });
        noiseBurst(c, {
          start: start + 0.01, dur: 0.11, freq: f * 2.1, toFreq: f * 1.4, q: 2.2,
          attack: 0.015, gain: 0.13 + lvl * 0.015,
        });
      }
    },
    // Crowd cheering & applause on good darts ('small'), big visits ('medium'), and 180s/checkouts ('big').
    cheer(size = 'medium', intensity = 2) {
      const c = audio();
      if (!c) return;
      const lvl = Math.min(4, Math.max(0, intensity | 0));
      const scale = 0.72 + lvl * 0.14;
      if (size === 'small') {
        // Brief appreciative "ooh / yeah!" + quick clap scatter
        noiseBurst(c, { start: 0.02, dur: 0.55, freq: 640, toFreq: 860, q: 1.8, attack: 0.08, gain: 0.13 * scale });
        noiseBurst(c, { start: 0.06, dur: 0.45, freq: 1450, toFreq: 1200, q: 1.4, attack: 0.05, gain: 0.07 * scale });
        return;
      }
      const big = size === 'big';
      const dur = big ? 2.1 : 1.15;
      // Layered crowd roar (low body + rising vocal cheer + bright applause shimmer)
      noiseBurst(c, { start: 0.02, dur, freq: 420, toFreq: 560, q: 1.2, attack: 0.14, gain: (big ? 0.24 : 0.16) * scale });
      noiseBurst(c, { start: 0.05, dur: dur * 0.92, freq: 820, toFreq: 1180, q: 1.5, attack: 0.18, gain: (big ? 0.20 : 0.13) * scale });
      noiseBurst(c, { start: 0.08, dur: dur * 0.85, freq: 2100, toFreq: 1650, q: 0.9, attack: 0.12, gain: (big ? 0.12 : 0.08) * scale });
      // Individual clap pops for texture
      const claps = big ? 10 : 5;
      for (let i = 0; i < claps; i++) {
        noiseBurst(c, {
          start: 0.12 + i * (big ? 0.14 : 0.15) + Math.random() * 0.06,
          dur: 0.045, freq: 1700 + Math.random() * 700, q: 1.5,
          attack: 0.005, gain: (0.06 + Math.random() * 0.04) * scale,
        });
      }
    },
    // Sympathetic / mocking crowd "oooh..." groan on bust, miss, or 26.
    groan(intensity = 1) {
      const c = audio();
      if (!c) return;
      const lvl = Math.min(4, Math.max(0, intensity | 0));
      const scale = 0.75 + lvl * 0.12;
      noiseBurst(c, { start: 0.04, dur: 0.75, freq: 620, toFreq: 310, q: 2.4, attack: 0.1, gain: 0.16 * scale });
      tone(c, { freq: 260, to: 175, type: 'sine', start: 0.05, dur: 0.55, gain: 0.045 * scale });
    },
  };
}
