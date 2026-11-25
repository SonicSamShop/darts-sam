// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Stand-in for web/app.js, enough for the Tournament screen: the real data layer
// (web/sync.js) on a store in memory, and a Pi that numbers new players.
import { createSync } from '../../web/sync.js';

const mem = {};
export const store = { get: (k, f) => (k in mem ? structuredClone(mem[k]) : f), set: (k, v) => { mem[k] = structuredClone(v); } };
let nextId = 100;
export const api = async (path, method, body) => {
  if (path === '/players' && method === 'POST') return { id: nextId++, ...body };
  if (!method || method === 'GET') throw new Error('not reached');  // (no pull: the store stays as the test made it)
  return {};
};
export const data = createSync({ store, api });
export let players = [], bots = [];
export function loadPlayers() {
  const all = store.get('players', []);
  players = all.filter(p => !p.bot);
  bots = all.filter(p => p.bot);
}
export function botPlayer(level) {
  const old = bots.find(b => b.bot === level);
  if (old) return old.id;
  const p = data.addPlayer(`Bot ${level}`, level);
  loadPlayers();
  return p.id;
}
export const $app = { innerHTML: '', querySelector: () => null };
export const account = { locked: false };
export const esc = s => String(s), fit = () => {}, pageFoot = () => '', pageHead = () => '';
export const redraw = f => f(), refreshStatus = () => {}, mark = () => {};
export let match = null, screen = 'tournament';
export const setMatch = m => { match = m; }, setScreen = s => { screen = s; };
