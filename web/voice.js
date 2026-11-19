// The caller's voice: the device's own, picking its most natural-sounding
// English voice rather than whatever comes first. A device with no voices of
// its own (a Pi, most Linux PCs) stays quiet; the scores are still on screen.

// The device's voice broke, rather than being cut off or not yet allowed to speak.
const BROKEN = ['synthesis-unavailable', 'synthesis-failed', 'voice-unavailable', 'language-unavailable'];

// Voices that sound like a robot (eSpeak, old Mac voices) or are a joke (Zarvox,
// Bubbles). A browser often lists one of these first, and left to itself uses it.
const ROBOTIC = /espeak|\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|eddy|flo|fred|good news|grandma|grandpa|hysterical|jester|junior|kathy|organ|pipe organ|princess|ralph|reed|rocko|sandy|shelley|superstar|trinoids|whisper|wobble|zarvox)\b/i;
// The device voices worth having, best first: the new natural-sounding kinds
// (Microsoft's "Natural" ones, Apple's "Premium"/"Enhanced" downloads, Siri,
// Google's in Chrome), then good older ones. A British voice, for a darts caller.
const NATURAL = [[/natural|neural/i, 60], [/premium/i, 55], [/siri/i, 50], [/enhanced/i, 45], [/\bonline\b/i, 40], [/google/i, 35],
  [/\b(daniel|serena|kate|oliver|arthur|martha|stephen|jamie|libby|sonia|ryan|samantha|karen|moira|tessa)\b/i, 15]];

// How good a voice sounds for calling darts; below zero is not worth using.
export function score(v) {
  const lang = String(v.lang || '').replace('_', '-').toLowerCase();
  const name = String(v.name || '');
  if (lang && !lang.startsWith('en')) return -100;
  let n = ROBOTIC.test(name) ? -50 : 0;
  for (const [re, add] of NATURAL) if (re.test(name)) { n += add; break; }
  if (lang === 'en-gb') n += 10;
  else if (lang === 'en-ie' || lang === 'en-au' || lang === 'en-nz') n += 6;
  else if (lang === 'en-us') n += 4;
  if (v.default) n += 1;
  return n;
}

// The English voices the device has, best-sounding first.
export function rank(voices) {
  return [...voices].filter(v => score(v) > -100).sort((a, b) => score(b) - score(a));
}

export function createVoice({
  synth = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  chosen = '',          // the name of the device voice picked in the settings; '' for the best one
} = {}) {
  let uttering = null;  // what the device is saying now; also keeps it from being dropped half-way
  let broken = false;   // the device has voices but couldn't speak with them
  const failed = new Set();  // device voices that couldn't speak (an online one, offline)
  synth?.getVoices();   // some browsers only start listing their voices once asked
  const all = () => (synth && Utterance && !broken ? synth.getVoices() : []).filter(v => !failed.has(v.name));
  const hasOwn = () => all().length > 0;
  // The voice to speak with: the one picked, else the best-sounding. A device
  // with no English voice is left to choose for itself.
  function pick() {
    const voices = all();
    return voices.find(v => v.name === chosen) ?? rank(voices)[0] ?? null;
  }

  function device(text) {
    // Cut off a call still being spoken. Not done when nothing is: some browsers
    // lose a call made straight after a cancel.
    if (uttering) synth.cancel();
    const u = uttering = new Utterance(text);
    const v = pick();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.onend = () => { if (uttering === u) uttering = null; };
    u.onerror = e => {
      if (uttering === u) uttering = null;
      if (e?.error === 'network' && v) { failed.add(v.name); if (hasOwn()) device(text); return; }
      if (BROKEN.includes(e?.error)) broken = true;
    };
    synth.speak(u);
  }

  return {
    say(text) { if (hasOwn()) device(String(text)); },
    // Browsers only let a page speak once it has made a sound in answer to a
    // tap. A dart the cameras saw is not a tap, so the first tap anywhere says
    // nothing, aloud.
    unlock() {
      if (!synth || !Utterance) return;
      const quiet = new Utterance(' ');
      quiet.volume = 0;
      synth.speak(quiet);
    },
    none: () => !hasOwn(),  // the device has no voice to call scores with
    voices: () => rank(all()).map(v => v.name),  // the device's English voices, best first
    voice: () => pick()?.name ?? '',             // the one the next call would use
    choose(name) { chosen = name || ''; },        // '' goes back to the best one
  };
}
