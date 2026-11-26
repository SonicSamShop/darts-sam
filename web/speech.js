// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Speech-to-score: hands-free voice entry from the oche using the browser's
// Web Speech API (SpeechRecognition). Pure transcript parsing in parseSpeech(),
// continuous mic management with caller echo-avoidance in createSpeech().

const ONES = {
  zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5,
  six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

// Parse an English spoken number (0..180), including digits and darts slang ("ton", "ton forty", "maximum").
// Returns null if the phrase isn't a valid number in 0..180.
export function parseNumber(raw) {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = +s;
    return n >= 0 && n <= 180 ? n : null;
  }
  if (s === 'maximum' || s === 'max' || s === 'one eighty' || s === '180' || s === 'ton eighty') return 180;
  if (s === 'ton' || s === 'a ton') return 100;
  if (s === 'bed and breakfast' || s === 'bag of nails') return 26;
  const words = s.split(' ').filter(w => w !== 'and' && w !== 'a');
  if (!words.length) return null;
  // "ton forty" / "ton 40" / "ton twenty one"
  if (words[0] === 'ton' && words.length > 1) {
    const rest = parseNumber(words.slice(1).join(' '));
    return rest != null && rest >= 1 && rest <= 80 ? 100 + rest : null;
  }
  // "one eighty", "one forty five", "one 40"
  if ((words[0] === 'one' || words[0] === '1') && words.length >= 2 && words[1] !== 'hundred') {
    const rest = parseNumber(words.slice(1).join(' '));
    if (rest != null && rest >= 10 && rest <= 80) return 100 + rest;
  }
  let total = 0, i = 0;
  if ((words[0] === 'one' || words[0] === '1') && words[1] === 'hundred') {
    total = 100;
    i = 2;
  } else if (words[0] === 'hundred') {
    total = 100;
    i = 1;
  }
  if (i < words.length) {
    const w = words[i];
    if (/^\d+$/.test(w) && i === words.length - 1) {
      total += +w;
      i++;
    } else if (w in TENS) {
      total += TENS[w];
      i++;
      if (i < words.length && words[i] in ONES && ONES[words[i]] >= 1 && ONES[words[i]] <= 9) {
        total += ONES[words[i]];
        i++;
      }
    } else if (w in ONES) {
      total += ONES[w];
      i++;
    } else {
      return null;
    }
  }
  if (i !== words.length) return null;
  return total >= 0 && total <= 180 ? total : null;
}

// Parse one or more dart beds from a normalized token list (e.g. "treble 20 double 16 bull").
// Returns an array of up to 3 {seg, mult} darts, or null if tokens don't cleanly parse as darts.
function parseDarts(text) {
  // Expand shorthand like "t20", "d16", "s5" -> "t 20", "d 16", "s 5"
  const norm = text
    .replace(/\bbull'?s?\s*eye\b/g, 'bullseye')
    .replace(/\binner\s+bull\b/g, 'bullseye')
    .replace(/\bouter\s+bull\b/g, 'outerbull')
    .replace(/\b([tds])(\d{1,2})\b/g, '$1 $2');
  const tokens = norm.split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const darts = [];
  let i = 0;
  while (i < tokens.length && darts.length < 3) {
    const t = tokens[i];
    if (t === 'and' || t === 'then') { i++; continue; }
    if (t === 'miss' || t === 'missed' || t === 'zero') {
      darts.push({ seg: 0, mult: 0 });
      i++;
      continue;
    }
    if (t === 'bullseye' || t === 'bull') {
      darts.push({ seg: 25, mult: 2 });
      i++;
      continue;
    }
    if (t === 'outerbull' || t === 'outer') {
      darts.push({ seg: 25, mult: 1 });
      i++;
      continue;
    }
    if (t === 'tops') {
      darts.push({ seg: 20, mult: 2 });
      i++;
      continue;
    }
    if (t === 'madhouse') {
      darts.push({ seg: 1, mult: 2 });
      i++;
      continue;
    }
    let mult = 1;
    let explicit = false;
    if (t === 'treble' || t === 'triple' || t === 't') { mult = 3; explicit = true; i++; }
    else if (t === 'double' || t === 'd') { mult = 2; explicit = true; i++; }
    else if (t === 'single' || t === 's') { mult = 1; explicit = true; i++; }
    if (i >= tokens.length) return null;
    // Allow "double tops" / "double bull"
    if (explicit && mult === 2 && tokens[i] === 'tops') { darts.push({ seg: 20, mult: 2 }); i++; continue; }
    if (explicit && mult === 2 && (tokens[i] === 'bull' || tokens[i] === 'bullseye')) { darts.push({ seg: 25, mult: 2 }); i++; continue; }
    // Try two-word number ("twenty five") before one-word ("twenty" or "20")
    let seg = null, step = 1;
    if (i + 1 < tokens.length && tokens[i] === 'twenty' && tokens[i + 1] === 'five') {
      seg = 25; step = 2;
    } else if (/^\d+$/.test(tokens[i])) {
      seg = +tokens[i];
    } else if (tokens[i] === 'twenty') {
      seg = 20;
    } else if (tokens[i] === 'fifty') {
      seg = 50;
    } else if (tokens[i] in ONES) {
      seg = ONES[tokens[i]];
    }
    if (seg == null) return null;
    if (!explicit && seg === 50) { darts.push({ seg: 25, mult: 2 }); i += step; continue; }
    if (!explicit && seg === 25) { darts.push({ seg: 25, mult: 1 }); i += step; continue; }
    if (seg === 25 && mult <= 2) { darts.push({ seg: 25, mult }); i += step; continue; }
    if (seg >= 1 && seg <= 20) { darts.push({ seg, mult }); i += step; continue; }
    return null;
  }
  return i === tokens.length && darts.length ? darts : null;
}

// Parse a speech transcript into a game action:
//   { kind: 'cmd', cmd: 'undo' | 'bust' | 'noscore' | 'next' }
//   { kind: 'fin', darts: 1 | 2 | 3 }     (answering "How many darts?" on checkout)
//   { kind: 'visit', total: 0..180 }     (in keypad mode)
//   { kind: 'darts', darts: [{seg, mult}, ...] } (in board mode)
// Returns null if the phrase is not a recognized darts command or score.
export function parseSpeech(transcript, { mode = 'board', askingFinish = false } = {}) {
  const s = String(transcript || '').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^(undo|take back|go back|cancel)$/.test(s)) return { kind: 'cmd', cmd: 'undo' };
  if (askingFinish) {
    if (/^(1|one|first)(\s+dart)?$/.test(s)) return { kind: 'fin', darts: 1 };
    if (/^(2|two|to|too|second)(\s+darts?)?$/.test(s)) return { kind: 'fin', darts: 2 };
    if (/^(3|three|third)(\s+darts?)?$/.test(s)) return { kind: 'fin', darts: 3 };
    return null;
  }
  if (/^(bust|busted)$/.test(s)) return { kind: 'cmd', cmd: 'bust' };
  if (/^(no score|noscore|nothing|none)$/.test(s)) return { kind: 'cmd', cmd: 'noscore' };
  if (/^(end turn|next|next player|done)$/.test(s)) return { kind: 'cmd', cmd: 'next' };
  if (mode === 'pad') {
    if (s === 'miss' || s === 'missed') return { kind: 'cmd', cmd: 'noscore' };
    const n = parseNumber(s);
    if (n != null) return { kind: 'visit', total: n };
    return null;
  }
  const darts = parseDarts(s);
  if (darts) return { kind: 'darts', darts };
  return null;
}

// Browser Web Speech API wrapper with continuous listening and caller echo-avoidance.
export function createSpeech({
  Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
  onResult = () => {},
  onState = () => {},
  lang = 'en-GB',
  resumeDelay = 350,
} = {}) {
  let active = false;
  let muted = false;
  let running = false;
  let rec = null;
  let restartTimer = 0;
  let lastError = '';

  const supported = () => typeof Recognition === 'function';
  const emit = () => onState({ active, listening: active && !muted && running, muted, error: lastError });

  function launch() {
    clearTimeout(restartTimer);
    if (!active || muted || running || !supported()) return;
    try {
      rec = new Recognition();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 3;
      rec.onstart = () => { running = true; lastError = ''; emit(); };
      rec.onresult = e => {
        if (!active || muted) return;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (!res.isFinal) continue;
          const alts = [];
          for (let j = 0; j < res.length; j++) alts.push(res[j].transcript);
          onResult(alts);
        }
      };
      rec.onerror = e => {
        const err = e?.error || '';
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          lastError = 'Microphone permission denied';
          active = false;
          running = false;
          emit();
        } else if (err === 'audio-capture') {
          lastError = 'No microphone found';
          active = false;
          running = false;
          emit();
        }
      };
      rec.onend = () => {
        running = false;
        emit();
        if (active && !muted) restartTimer = setTimeout(launch, 250);
      };
      rec.start();
    } catch {
      running = false;
      emit();
    }
  }

  function halt() {
    clearTimeout(restartTimer);
    if (rec) {
      const r = rec;
      rec = null;
      try { r.abort(); } catch { /* already stopped */ }
    }
    running = false;
    emit();
  }

  return {
    supported,
    active: () => active,
    listening: () => active && !muted && running,
    error: () => lastError,
    start() {
      if (!supported()) return false;
      lastError = '';
      active = true;
      if (!muted) launch();
      emit();
      return true;
    },
    stop() {
      active = false;
      lastError = '';
      halt();
    },
    toggle() {
      if (active) { this.stop(); return false; }
      return this.start();
    },
    // Called by voice.js while the caller is speaking so the mic doesn't hear itself.
    setMuted(busy) {
      if (muted === !!busy) return;
      muted = !!busy;
      if (muted) {
        halt();
      } else if (active) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(launch, resumeDelay);
        emit();
      }
    },
  };
}
