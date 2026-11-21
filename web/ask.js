// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// When the phone's camera isn't sure of a dart, ask the player which bed it
// is in. A camera that saw a dart alone (one phone) sends how likely each bed
// is (server/detect.py's bed_odds); cameras that crossed lines send no odds
// and are never asked about.

import { label, spoken } from './board.js';

export const ASK_BELOW = 0.8;   // the likeliest bed under this: ask
const OFFER_FROM = 0.05;        // beds less likely than this aren't offered

export const needsAsk = ev => ev?.type === 'dart' && Array.isArray(ev.odds) && ev.odds.length > 0 && (ev.ask === true || ev.odds[0].p < ASK_BELOW);

// The beds to offer, likeliest first: {seg, mult, label, pct}.
export function choices(ev) {
  return (ev.odds || []).filter((o, i) => i === 0 || o.p >= OFFER_FROM)
    .map(o => ({ seg: o.seg, mult: o.mult, label: label(o), pct: Math.round(o.p * 100) }));
}

// A dart not asked about goes in as its likeliest bed: the score then matches
// the confidence shown (the tip itself can sit just over a wire from it).
export const best = ev => (ev?.type === 'dart' && ev.odds?.length ? { ...ev, seg: ev.odds[0].seg, mult: ev.odds[0].mult } : ev);

// "Treble 20 or 20?", for the caller.
export const question = ev => `${choices(ev).slice(0, 2).map(c => spoken(c)).join(' or ')}?`;

// What the camera says, in order. While a question is open, everything after
// it waits, so the game's darts stay in the order they were thrown.
// onPass(ev): put it in the game. onAsk(ev): ask about it.
export function createQueue({ onPass, onAsk }) {
  let asking = null, held = false;
  const waiting = [];

  function next() {
    while (!asking && !held && waiting.length) {
      const ev = waiting.shift();
      if (needsAsk(ev)) { asking = ev; onAsk(ev); } else onPass(best(ev));
    }
  }

  return {
    add(ev) { waiting.push(ev); next(); },
    // The player's answer: {seg, mult}, or null for "somewhere else": they tap
    // it in on the board, and until then (release()) the darts behind it wait,
    // or they would go into the game ahead of it.
    settle(choice) {
      if (!asking) return;
      const ev = asking;
      asking = null;
      if (choice) onPass({ ...ev, ...choice }); else held = true;
      next();
    },
    release() { held = false; next(); },
    holding: () => held,
    current: () => asking,
    size: () => (asking ? 1 : 0) + waiting.length,
    clear() { asking = null; held = false; waiting.length = 0; },
  };
}
