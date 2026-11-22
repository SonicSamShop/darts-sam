// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The Achievements tab of a player's stats: what they have earned and what is
// next, worked out by achievements.js from their games.

import { ACHIEVEMENTS, GROUPS, byId, timeline, totalOf, visitOf } from '../achievements.js';
import {
  badge, connected, drawPlayers, esc, gamesHere, loadStats, nameOf, opens, photoUrl, pi, screen, statsData,
  statsFor, statsPath, statsTab
} from '../app.js';

// ---------- the Achievements tab ----------
// Worked out from every game the player has on record, whatever game or set of darts the page is
// showing: so when the page's own stats are only part of that, the whole is asked for as well.
const ACH_SINCE = Date.UTC(2026, 10, 22);  // games from before achievements existed earn them too: the tab says so
export const achTab = {
  all: null,  // {id, st}: a player's stats for all games and darts (st: null if they can't be had)
};
let achLoading = null;  // the player they are being fetched for
const ACH = new WeakMap();  // what is worked out from a reply, kept while that reply is
function achStats() {
  if (statsFor != null && statsFor <= 0) {  // made offline: no games anywhere but here
    if (achTab.all?.id !== statsFor) achTab.all = { id: statsFor, st: { player: { id: statsFor }, matches: [] } };
    return achTab.all.st;
  }
  if (statsData && !statsData.game && !statsData.set && statsData.player.id === statsFor) return statsData;
  return achTab.all?.id === statsFor ? achTab.all.st : undefined;  // undefined: not asked for yet
}
async function loadAchAll() {
  const id = statsFor;
  if (id == null || achLoading === id) return;
  achLoading = id;
  let st = null;
  try { st = await loadStats(statsPath(id), connected ? 10000 : 2500); } catch { /* shown as unavailable */ }
  achLoading = null;
  achTab.all = { id, st };
  if (screen === 'players' && statsFor === id && statsTab === 'achievements') drawPlayers();
}
// {entries, got, total}: the player's games oldest first, and what they earn (timeline() in achievements.js).
function achievementsOf(st) {
  const here = gamesHere(st.player.id), key = here.map(g => `${g.sheet.id}:${g.sheet.visits.length}:${g.sheet.winner}`).join();
  if (ACH.get(st)?.key !== key) {
    const ids = new Set(here.map(g => g.sheet.id));
    const entries = [...(st.matches ?? []).filter(m => !ids.has(m.id)).map(m => ({ sheet: m, me: m.me })), ...here];
    ACH.set(st, { key, entries, ...timeline(entries) });
  }
  return ACH.get(st);
}
const dayOf = ts => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
export function achievementsPane(game) {
  const st = achStats();
  if (st === undefined) { loadAchAll(); return '<div class="p-achievements"><p class="muted">Loading…</p></div>'; }
  if (!st) return `<div class="p-achievements"><p class="muted">Achievements are worked out from every game on record, and those
    aren't on this device yet. They will be here once ${pi()} has been reached.</p></div>`;
  const { got, total } = achievementsOf(st);
  const list = ACHIEVEMENTS.filter(a => !game || a.game === game.id);
  const line = a => {
    const g = got.get(a.id), steps = a.steps && ACHIEVEMENTS.filter(b => b.base === a.base);
    if (!g && steps && a !== steps.find(b => !got.has(b.id))) return '';  // of the steps not reached, only the next one
    const hidden = a.secret && !g;
    const far = !g && a.need > 1 ? ` · ${a.value(total).toLocaleString()} of ${a.need.toLocaleString()}` : '';
    return `<li class="${g ? 'held' : 'not'}"${g ? opens({ v: 'achievement', id: a.id }) : ''}>${badge(a, 44, !!g, hidden)}
      <span><b>${hidden ? 'A surprise' : esc(a.name)}</b><small>${hidden ? 'You will know it when you throw it' : esc(a.how) + far}</small></span>
      ${g ? `<time>${dayOf(g.at)}</time>` : ''}</li>`;
  };
  const groups = GROUPS.map(name => {
    const rows = list.filter(a => a.group === name).sort((a, b) => got.has(b.id) - got.has(a.id)).map(line).join('');
    return rows ? `<h2>${name}</h2><ul class="alist">${rows}</ul>` : '';
  }).join('');
  const old = [...got.values()].some(g => g.at < ACH_SINCE);
  return `<div class="p-achievements">
    <h2 class="count">${game ? `${game.name} achievements` : 'Achievements'} · ${list.filter(a => got.has(a.id)).length} of ${list.length}</h2>
    ${old ? '<p class="muted small">These come from every game on record, so some are from before achievements existed.</p>' : ''}
    ${groups || '<p class="muted">This game has none of its own.</p>'}</div>`;
}
// One achievement that is held: its badge, when it was earned, and the way to the game it was earned in.
export function achievementView(id, d) {
  const a = byId(id), st = achStats();
  const all = a && st ? achievementsOf(st) : null, g = all?.got.get(id);
  if (!g) return null;
  return { title: esc(a.name), html: () => {
    const at = all.entries.findIndex(e => e.sheet.id === g.match), e = all.entries[at];
    const visit = visitOf(a, totalOf(all.entries.slice(0, at)), e.sheet, e.me);
    const there = d.matches.some(m => m.id === g.match);  // (a game not sent yet has no scoresheet here)
    return `<div class="achievement">${badge(a, 120)}<p>${esc(a.how)}</p><p class="muted">${esc(nameOf(statsFor))} · ${dayOf(g.at)}</p>
      ${visit != null ? `<img class="shot" src="${photoUrl(g.match, visit)}" alt="The board when it was earned">` : ''}
      ${there ? `<button${opens({ v: 'match', id: g.match, ...(visit != null && { at: visit }) })}>Open the game</button>` : ''}</div>`;
  } };
}
