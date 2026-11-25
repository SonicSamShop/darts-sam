// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// What web/app.js is given in place of everything it imports but its own rules and the
// data layer (hooks.mjs). A name written out here is that; any other is made up as it
// is asked for: something that can be called, does nothing, and notes that it was.

// Everything a stand-in was asked to do, in order: [its name, ...what it was given].
export const calls = [];
// Those of them by one name: what each was given.
export const asked = name => calls.filter(c => c[0] === name).map(c => c.slice(1));
const kept = {};
export const made = name => (kept[name] ??= (...args) => { calls.push([name, ...args]); });

// ---------- the server ----------
// answer(path, method, body): what the server says. A test puts its own in; `down`, nothing is reached.
export const server = { down: false, answer: () => { throw new Error('no server'); }, calls: [] };
// (web/api.js) The app asks for '/api' + path.
export async function request(fetchFn, url, method = 'GET', body) {
  if (server.down) throw new TypeError('Failed to fetch');
  server.calls.push(`${method} ${url}`);
  return server.answer(url.replace(/^\/api/, ''), method, body);
}

// ---------- the app's other parts ----------
export const createAccount = () => ({ hosted: false, account: null, locked: false, undecided: false, load: async () => {}, expired() {} });
export const createTracker = () => ({ track() {}, flush() {} });
export const createUpdater = () => ({ running() {}, seen() {}, check() {} });
export const said = [];
export const createVoice = () => ({ say: text => { said.push(text); }, unlock() {}, choose() {} });
export const createPhoneUi = () => ({ offered() {}, on: () => false, scoring: () => false, statusText: () => '' });

// ---------- what the screens keep, where the app reads or writes it ----------
export const statsView = { player: null, game: null, darts: null, board: null, tab: 'stats', drill: [] };
export const settingsView = { tab: 'players', open: false, fromList: false };
export const menu = {}, roster = {}, camScreen = {}, pairing = {}, sharing = {}, numPad = {};
export const landing = { newcomer: false };
export const avgAsked = new Set();
export const tourView = { id: null, setup: null, abandoning: false, past: false, wait: null };
