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
