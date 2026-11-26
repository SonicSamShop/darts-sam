// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Stand-in for web/app.js, enough for the Tournament screen: the real data layer
// (web/sync.js) on a store in memory, and a server that numbers new players.
import { createSync } from '../../web/sync.js';

const mem = {};
export const store = { get: (k, f) => (k in mem ? structuredClone(mem[k]) : f), set: (k, v) => { mem[k] = structuredClone(v); } };
let nextId = 100;
export const sent = [];  // everything put on the server: [path, body]
export const api = async (path, method, body) => {
  if (path === '/players' && method === 'POST') return { id: nextId++, ...body };
  if (!method || method === 'GET') throw new Error('not reached');  // (no pull: the store stays as the test made it)
  sent.push([path, structuredClone(body)]);
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
// (nothing is on the page, so no bracket is drawn, unless a test puts page.mjs's stand-in there)
export const $app = { innerHTML: '', querySelector: () => null };
export const account = { locked: false };
export const esc = s => String(s), fit = () => {}, pageFoot = () => '', pageHead = () => '';
export const redraw = f => f(), refreshStatus = () => {};
// The screen's place in the history, each time it was noted: true for a new step on (Back comes back from it), false in place of the last.
export const marks = [];
export const mark = push => { marks.push(!!push); };
export let match = null, screen = 'tournament';
export const setMatch = m => { match = m; }, setScreen = s => { screen = s; };
// What starting a game asks of the app as well (web/screens/start.js).
export const BOT = 0, botAt = () => ({ level: 5 }), setup = { first: null, gameId: 'x01', opts: {}, players: [] };
export const isBotId = id => id === BOT || bots.some(b => b.id === id);
export const levelOf = id => (id === BOT ? botAt().level : bots.find(b => b.id === id)?.bot ?? null);
export const nameOf = id => (players.find(p => p.id === id) ?? bots.find(p => p.id === id))?.name ?? '?';
export const dartsFor = () => null, randomOrder = ids => ids, saveSetup = () => {}, seats = () => [];
// What score calling was asked to say, in order.
export const said = [];
export const say = text => { said.push(text); };
// What the players' cards ask of the app as well (web/screens/playerspanel.js).
export const MAX_PLAYERS = 8, cleanSetup = () => {}, grams = g => `${g} g`, setDarts = () => {}, setsOf = () => [];
export const COUNTRIES = [], flagCode = () => '', flagOf = () => '', flagHtml = () => '', setPlayerFlag = () => {};
// What the menu asks of the app as well (web/screens/home.js): nothing is fetched, and no new version looked for.
export const connected = false, totals = null, setTotals = () => {}, statsPath = () => '', loadStats = async () => ({});
export const updater = { check() {} };
