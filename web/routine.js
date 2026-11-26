// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Guided 10-minute Daily Warm-up routine (chaining 3 solo drills) and daily
// practice streak tracking.

export const WARMUP_STEPS = [
  { gameId: 'clock', label: 'Around the Clock', short: 'Clock', opts: {} },
  { gameId: 'bobs27', label: "Bob's 27", short: "Bob's 27", opts: {} },
  { gameId: 'c121', label: '121 Checkout', short: '121', opts: {} },
];

export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function recordPracticeDay(store, now = new Date()) {
  const today = dayKey(now);
  const prev = store.get('practiceDays', []);
  if (prev.includes(today)) return prev;
  const next = [...prev, today].sort().slice(-365);
  store.set('practiceDays', next);
  return next;
}

export function practiceStreak(store, now = new Date()) {
  const set = new Set(store.get('practiceDays', []));
  const today = dayKey(now);
  const doneToday = set.has(today);
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!doneToday) cursor.setDate(cursor.getDate() - 1);
  let days = 0;
  while (set.has(dayKey(cursor))) {
    days++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { days, doneToday };
}

// ---------- pre-match warm-up darts ----------
// Optional 9 warm-up darts per human player before leg 1 starts. Kept separate
// from match.log so warm-up throws never affect stats, averages, or achievements.
export const WARMUP_DARTS = 9;

export function createWarmup(bots, darts = WARMUP_DARTS) {
  const thrown = bots.map(b => (b ? darts : 0));
  const first = thrown.findIndex(n => n < darts);
  if (first < 0) return null;
  return { darts, thrown, turn: [], log: [], current: first, done: false };
}

function nextWarmupPlayer(w) {
  const n = w.thrown.length;
  for (let k = 1; k <= n; k++) {
    const i = (w.current + k) % n;
    if (w.thrown[i] < w.darts) return i;
  }
  return -1;
}

export function warmupDart(w, dart) {
  if (!w || w.done) return { done: true, changed: false };
  const p = w.current;
  w.log.push({ player: p, dart });
  w.turn.push(dart);
  w.thrown[p]++;
  if (w.turn.length >= 3 || w.thrown[p] >= w.darts) {
    const next = nextWarmupPlayer(w);
    if (next < 0) { w.done = true; return { done: true, changed: true }; }
    const changed = next !== p;
    w.current = next;
    w.turn = [];
    return { done: false, changed };
  }
  return { done: false, changed: false };
}

export function warmupNext(w) {
  if (!w || w.done) return { done: true, changed: false };
  const p = w.current;
  const rem = Math.min(3 - w.turn.length, w.darts - w.thrown[p]);
  if (rem > 0) {
    for (let i = 0; i < rem; i++) {
      const miss = { seg: 0, mult: 0, src: 'miss' };
      w.log.push({ player: p, dart: miss });
      w.thrown[p]++;
    }
  }
  const next = nextWarmupPlayer(w);
  if (next < 0) { w.done = true; return { done: true, changed: true }; }
  const changed = next !== p;
  w.current = next;
  w.turn = [];
  return { done: false, changed };
}

export function warmupUndo(w) {
  if (!w || !w.log.length) return false;
  const last = w.log.pop();
  w.done = false;
  w.thrown[last.player] = Math.max(0, w.thrown[last.player] - 1);
  w.current = last.player;
  const turnLen = w.thrown[last.player] % 3;
  w.turn = turnLen ? w.log.slice(-turnLen).filter(e => e.player === last.player).map(e => e.dart) : [];
  return true;
}
