// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Web Audio sound effects & Career Mode pub/crowd atmosphere:
// crisp synthesized dart thuds, treble chimes, bust buzzes, and big-score
// fanfares, paired with Public Domain recordings (web/audio/*.mp3) for real
// pub background chatter, crowd cheering, and mid-throw coughing. Fails
// silently where Web Audio is unavailable.

const PUB_CLIPS = [
  'audio/pub.mp3',
  'audio/pub-cafe.mp3',
  'audio/pub-lively.mp3',
  'audio/pub-crowd.mp3',
];
const CHEER_CLIPS = [
  'audio/cheer.mp3',
  'audio/cheer-2.mp3',
];
const CLIPS = {
  pub: PUB_CLIPS[0],
  cheer: CHEER_CLIPS[0],
  cough: 'audio/cough.mp3',
};

export function createSfx() {
  let ctx = null;
  let noiseBuf = null;
  let amb = null;       // active background pub/crowd ambience node graph
  let ambWant = null;   // { intensity, url } while ambience is requested (even while loading)
  let lastPubUrl = '';
  let lastCheerIdx = -1;
  const matchPub = new Map();  // matchKey -> chosen pub URL for that match
  const buffers = new Map();   // key -> AudioBuffer
  const loading = new Map();   // key -> Promise<AudioBuffer|null>

  function pickPubUrl(intensity, matchKey) {
    if (matchKey && matchPub.has(matchKey)) return matchPub.get(matchKey);
    // All 4 tracks are in the pool, weighted slightly by venue intensity and avoiding immediate repeats.
    const pool = intensity >= 3
      ? [PUB_CLIPS[2], PUB_CLIPS[3], PUB_CLIPS[0]]
      : intensity <= 1
        ? [PUB_CLIPS[0], PUB_CLIPS[1], PUB_CLIPS[2]]
        : PUB_CLIPS;
    const choices = pool.length > 1 && lastPubUrl ? pool.filter(u => u !== lastPubUrl) : pool;
    const url = choices[Math.floor(Math.random() * choices.length)] ?? PUB_CLIPS[0];
    lastPubUrl = url;
    if (matchKey) {
      if (matchPub.size > 20) matchPub.clear();
      matchPub.set(matchKey, url);
    }
    return url;
  }

  function audio() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Fetch & decode a bundled MP3 clip once, caching the AudioBuffer.
  function loadClip(c, key, explicitUrl = null) {
    if (buffers.has(key)) return Promise.resolve(buffers.get(key));
    if (loading.has(key)) return loading.get(key);
    const url = explicitUrl || CLIPS[key];
    if (!url || typeof fetch !== 'function') return Promise.resolve(null);
    const p = fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(ab => (ab ? c.decodeAudioData(ab) : null))
      .then(buf => { if (buf) buffers.set(key, buf); return buf; })
      .catch(() => null)
      .finally(() => loading.delete(key));
    loading.set(key, p);
    return p;
  }

  // Reusable 3-second normalized pink-noise buffer (used for groans and fallback).
  function noise(c) {
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    const len = Math.floor(c.sampleRate * 3);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      data[i] = v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    const norm = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < len; i++) data[i] *= norm;
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

  function noiseBurst(c, {
    start = 0, dur = 0.5, freq = 600, toFreq = null, q = 1.1,
    attack = 0.06, gain = 0.3, filterType = 'bandpass',
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

  function playBuffer(c, buf, { gain = 0.7, rate = 1, dur = null, fadeOut = 0.25 } = {}) {
    const now = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    const playDur = dur ? Math.min(dur, buf.duration / rate) : buf.duration / rate;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.03);
    if (fadeOut > 0 && playDur > fadeOut) {
      g.gain.setValueAtTime(gain, now + playDur - fadeOut);
      g.gain.exponentialRampToValueAtTime(0.0001, now + playDur);
    }
    src.connect(g);
    g.connect(c.destination);
    src.start(now);
    src.stop(now + playDur + 0.05);
  }

  function thud(c, freq = 145, gain = 0.22) {
    tone(c, { freq, to: 42, type: 'triangle', dur: 0.085, gain });
  }

  function stopAmbience() {
    ambWant = null;
    if (!amb) return;
    const cur = amb;
    amb = null;
    try {
      const now = cur.ctx.currentTime;
      cur.master.gain.cancelScheduledValues(now);
      cur.master.gain.setValueAtTime(Math.max(0.0001, cur.master.gain.value), now);
      cur.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      setTimeout(() => {
        try { cur.src.stop(); cur.master.disconnect(); } catch { /* already stopped */ }
      }, 450);
    } catch { /* ignore */ }
  }

  function startAmbience(intensity = 0, matchKey = '') {
    const lvl = Math.min(4, Math.max(0, intensity | 0));
    const url = pickPubUrl(lvl, matchKey);
    const prevUrl = amb?.url || ambWant?.url;
    if (amb && prevUrl !== url) stopAmbience();
    ambWant = { intensity: lvl, url };
    const c = audio();
    if (!c) return;
    const targetVol = 0.24 + lvl * 0.075;  // cozy pub chatter -> lively tournament crowd
    if (amb) {
      if (amb.intensity !== lvl) {
        amb.intensity = lvl;
        const now = c.currentTime;
        amb.master.gain.cancelScheduledValues(now);
        amb.master.gain.linearRampToValueAtTime(targetVol, now + 0.5);
      }
      if (c.state === 'suspended') c.resume().catch(() => {});
      return;
    }
    // Preload cheer & cough clips quietly too so they fire with zero latency.
    CHEER_CLIPS.forEach(u => loadClip(c, u, u));
    loadClip(c, 'cough');
    loadClip(c, url, url).then(buf => {
      if (!buf || !ambWant || ambWant.url !== url || amb) return;
      try {
        const src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = buf.duration;
        const master = c.createGain();
        const now = c.currentTime;
        const vol = 0.24 + ambWant.intensity * 0.075;
        master.gain.setValueAtTime(0.0001, now);
        master.gain.linearRampToValueAtTime(vol, now + 0.8);
        src.connect(master);
        master.connect(c.destination);
        src.start(now);
        amb = { ctx: c, src, master, intensity: ambWant.intensity, url };
      } catch {
        amb = null;
      }
    });
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
    // Real public-domain pub / crowd background chatter for Career Mode (intensity 0..4, randomized per match).
    ambienceStart(intensity = 0, matchKey = '') { startAmbience(intensity, matchKey); },
    ambienceStop() { stopAmbience(); },
    ambienceActive: () => !!(amb || ambWant),
    // Real human cough clip to put the thrower off mid-visit.
    cough(intensity = 0) {
      const c = audio();
      if (!c) return;
      const lvl = Math.min(4, Math.max(0, intensity | 0));
      loadClip(c, 'cough').then(buf => {
        if (buf) {
          playBuffer(c, buf, {
            gain: 0.55 + lvl * 0.09,
            rate: 0.94 + Math.random() * 0.12,
            fadeOut: 0.08,
          });
        } else {
          // Synthesized fallback if offline and clip wasn't cached yet
          tone(c, { freq: 155, to: 82, type: 'triangle', start: 0, dur: 0.1, gain: 0.25 });
          noiseBurst(c, { start: 0, dur: 0.14, freq: 580, toFreq: 380, q: 1.6, attack: 0.015, gain: 0.5 });
        }
      });
    },
    // Real crowd cheering & applause on good darts ('small'), big visits ('medium'), and 180s/checkouts ('big').
    cheer(size = 'medium', intensity = 2) {
      const c = audio();
      if (!c) return;
      const lvl = Math.min(4, Math.max(0, intensity | 0));
      const scale = 0.78 + lvl * 0.08;
      const idx = CHEER_CLIPS.length > 1 && lastCheerIdx >= 0
        ? (lastCheerIdx + 1 + Math.floor(Math.random() * (CHEER_CLIPS.length - 1))) % CHEER_CLIPS.length
        : Math.floor(Math.random() * CHEER_CLIPS.length);
      lastCheerIdx = idx;
      const url = CHEER_CLIPS[idx];
      loadClip(c, url, url).then(buf => {
        if (buf) {
          if (size === 'small') playBuffer(c, buf, { gain: 0.36 * scale, dur: 1.2, fadeOut: 0.45, rate: 1.04 });
          else if (size === 'big') playBuffer(c, buf, { gain: 0.8 * scale, dur: 3.8, fadeOut: 0.9, rate: 0.98 });
          else playBuffer(c, buf, { gain: 0.56 * scale, dur: 2.3, fadeOut: 0.7, rate: 1.0 });
        } else {
          noiseBurst(c, { start: 0.02, dur: size === 'big' ? 1.8 : 0.9, freq: 640, toFreq: 980, q: 1.1, attack: 0.1, gain: 0.4 * scale });
        }
      });
    },
    // Play a pre-generated voice/banter MP3 clip. Resolves true if played, false to fall back to browser TTS.
    async playClip(url, { gain = 0.92, rate = 1 } = {}) {
      const c = audio();
      if (!c || !url) return false;
      const buf = await loadClip(c, url, url);
      if (!buf) return false;
      playBuffer(c, buf, { gain, rate, fadeOut: 0.04 });
      return true;
    },
    // Sympathetic / mocking crowd "oooh..." groan on bust, miss, or 26.
    groan(intensity = 1) {
      const c = audio();
      if (!c) return;
      const lvl = Math.min(4, Math.max(0, intensity | 0));
      const scale = 0.78 + lvl * 0.11;
      noiseBurst(c, { start: 0.04, dur: 0.8, freq: 620, toFreq: 300, q: 1.8, attack: 0.09, gain: 0.42 * scale });
      tone(c, { freq: 260, to: 170, type: 'sine', start: 0.05, dur: 0.6, gain: 0.12 * scale });
    },
  };
}
