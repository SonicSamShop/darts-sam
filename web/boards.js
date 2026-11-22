// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// How a board is named and described: in Settings (screens/boardspanel.js) and on Stats.
// A board has no name of its own. It is called by its brand and model ("Winmau Blade 6"), or
// by its place in the list ("Board 2") when neither was given. Two that read the same are
// told apart by the year each was bought, then by number.

const label = (b, all) => [b.brand, b.model].filter(Boolean).join(' ') || `Board ${all.findIndex(o => o.id === b.id) + 1}`;

// all: every board, in the order they were added.
export function boardName(b, all) {
  if (!b) return '?';
  const name = label(b, all), same = o => label(o, all).toLowerCase() === name.toLowerCase();
  const twins = all.filter(same);
  if (twins.length < 2) return name;
  const alike = twins.filter(o => o.bought === b.bought);  // (bought the same year, or neither said)
  const n = alike.findIndex(o => o.id === b.id) + 1;
  const extra = [b.bought, n > 1 ? n : null].filter(v => v != null);
  return extra.length ? `${name} (${extra.join(', ')})` : name;
}

// What a board is doing, in a line: day(ts) writes a date.
export function boardState(b, day) {
  if (b.down == null) return b.up != null ? `On the wall · up since ${day(b.up)}` : 'On the wall';
  if (b.up != null) return `Taken down · ${day(b.up)} to ${day(b.down)}`;
  if (b.down) return `Played on until ${day(b.down)}`;
  return 'Not put up yet';
}

// The start of a day picked in a date box ("2026-03-03"), on this device's clock, in ms; null if none.
export const dayStart = value => value ? new Date(`${value}T00:00`).getTime() : null;
