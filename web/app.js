// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import { GAMES } from './games/index.js';
import { gameById, compute } from './engine.js';
import { createSync } from './sync.js';
import { createUpdater } from './update.js';
import { request } from './api.js';
import { createAccount } from './account.js';
import { createTracker } from './track.js';
import { createVoice } from './voice.js';
import { botLevel } from './bot.js';
import { createPhoneUi } from './phoneui.js';
import { deleteShared, loadShare, openDetail, setShare, share, sharing } from './screens/sharing.js';
import { accountDo, acct, sendFeedback } from './screens/accountpanel.js';
import {
  addCamera, autoCalibrate, calibTap, calibrateOnStart, camScreen, camStatus, changeCameras, drawCameras, linkDo,
  cameraSettings, findAll, pairCameras, pairing, placeCamera, refreshCameras, renderCameras, resetDetection, unpairCameras, usbChosen
} from './screens/cameras.js';
import { appleSignIn, landing, mailTo, renderLanding, sendCode, signIn } from './screens/landing.js';
import {
  addDarts, addPlayer, changeDarts, removePlayer, renamePlayer, roster, saveDarts
} from './screens/playerspanel.js';
import { closeSection, listShown, openSection, renderSettings, sectShown, settingsView } from './screens/settings.js';
import { boardAct } from './screens/boardspanel.js';
import { loadRelease } from './screens/release.js';
import { deep, drawPlayers, renderPlayers, renderSheet, sheet, statsData, statsView } from './screens/stats.js';
import { avgAsked, followSuggestion, loadAverages, loadRules, loadTotals, menu, renderHome } from './screens/home.js';
import { slipTapped } from './screens/earned.js';
import {
  askQuit, botThrow, botTimer, botUp, closeQuit, numPad, padCommit, padKey, push, renderGame, undo
} from './screens/game.js';
import {
  askFirst, bull, bullDart, bullRandom, bullStart, closeBull, closeFirst, dropBull, homePlay, playRemapped, renderBull, startMatch
} from './screens/start.js';
import { reportProblem } from './screens/report.js';
import { openTournament, renderTournament, tourAct, tourRemapped, tourView } from './screens/tournament.js';
import { finishWelcome, nameDue, renderWelcome, welcomeDue, welcomeForm, welcomeNamed } from './screens/welcome.js';

export const $app = document.getElementById('app');
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Saved on this device. If the browser refuses to store something (storage
// full, private mode) it is kept in memory so the app carries on until closed.
const unsaved = new Map();
export const store = {
  get: (k, d) => { try { return JSON.parse(unsaved.get(k) ?? localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => {
    const text = JSON.stringify(v);
    try { localStorage.setItem(k, text); unsaved.delete(k); } catch { unsaved.set(k, text); }
  },
};
navigator.storage?.persist?.().catch(() => {});  // ask the browser not to clear it when space runs short
// Scoring with this phone's own camera (Beta): its screen is a sheet of its own (phoneui.js).
export const phone = createPhoneUi({ onEvent: onBoardEvent, onChange: refreshStatus, store,
  inGame: () => screen === 'game' && !!match && !botUp(), say: text => say(text),
  note: (kind, detail) => tracker.track(kind, { match: match?.id, ...detail }), undoLast: () => undo(),
  dartCount: () => (match ? match.log.filter(e => e.t === 'dart').length : 0) });
phone.offered();  // is it offered here? (asked once, before the Cameras screen needs to know)


// ---------- saved data ----------
// Players, settings, finished games and every throw live in a database on the
// Pi (server/db.py), but the app never waits for it: every change is saved on
// this device first and sent to the Pi when it can be reached (see sync.js).
// So the whole app works with no Pi and no network, and catches up later.
// (api.js says what a refusal means to the queue of changes waiting to be sent.)
export const call = (url, method, body, timeout) => request((u, o) => fetch(u, o), url, method, body, timeout)
  .catch(e => { if (e.signedOut) account.expired(); throw e; });
export async function api(path, method = 'GET', body, timeout = 10000) {
  // Hosted and not signed in: there is no account to send to yet. Fail the way
  // an unreachable server does, so everything waits on this device.
  if (account.hosted && !account.account) throw Object.assign(new Error('Sign in first.'), { signedOut: true });
  return call('/api' + path, method, body, timeout);
}
// The hosted version only (see account.js): who is signed in.
// Signed out there, the welcome page takes over; signed in from it, the app opens.
export const account = createAccount({ request: call, store, onChange: () => {
  if (account.locked) redraw(renderLanding); else if (screen === 'landing') begin();
  refreshStatus();
} });
// The trial's notes on how the app is used (see track.js): the hosted version's
// go to the account, the server at home's are passed on by it while sharing is on.
export const tracker = createTracker({
  store, recording: () => account.hosted || !!share?.on, sending: () => account.hosted ? !!account.account : !!share?.on,
  send: batch => call(account.hosted ? '/api/events' : '/api/share/events', 'POST', { events: batch }),
});
setInterval(() => tracker.flush(), 60000);
// What the app calls the machine it talks to: at home a Raspberry Pi, hosted just "the server".
export const pi = () => account.hosted ? 'the server' : 'the Pi';
export const Pi = () => account.hosted ? 'The server' : 'The Pi';

export let match = store.get('match', null);
export const setMatch = v => { match = v; };  // for screens/home.js, screens/game.js, screens/start.js
// The people who play: [{id, name}]. The computer's players are kept apart, so that no list of
// players has them in it: [{id, name, bot: its level}] (see "computer players" below).
export let players = [];
export let bots = [];
export function loadPlayers() {
  const all = store.get('players', []);
  players = all.filter(p => !p.bot);
  bots = all.filter(p => p.bot);
}
loadPlayers();
let darts = store.get('darts', []);  // every player's sets of darts: [{id, player, name, grams, created, retired}]
export const setDarts = v => { darts = v; };  // for screens/playerspanel.js
// The household's boards (see sync.js and screens/boardspanel.js), in the order they were added.
export let boards = store.get('boards', []);
export const loadBoards = () => { boards = store.get('boards', []); };
// players: ids in throwing order. darts: {player id: the set of darts they are throwing}
export let setup = store.get('setup', { gameId: 'x01', players: [], opts: {} });
// Sound starts off; once on, the visit's total is called, and each dart only if asked for.
export let settings = store.get('settings', { voice: false });
delete settings.board;  // (the one board there was, before boards had a list of their own: the server has made it the first)
export let totals = store.get('totals', null);  // {darts, reports}: everything on the Pi, as it last said
export const setTotals = v => { totals = v; };  // for screens/home.js
export let screen = match ? 'game' : 'home';
export const setScreen = v => { screen = v; counted(); wakeCameras(); };  // for screens/*.js: each sets its own
// The cameras rest after a while unused (standby, on the Cameras screen). A game,
// or the Cameras screen, keeps them awake, and wakes them if they are resting.
let woke = 0;
function wakeCameras() {
  if (!['game', 'bull', 'cameras'].includes(screen) || Date.now() - woke < 50000) return;
  woke = Date.now();
  api('/cameras/wake', 'POST', undefined, 5000).catch(() => {});
}
setInterval(wakeCameras, 60000);
// Tell the hosted site's Google Analytics which screen is showing (web/consent.js,
// which counts it only for people who allowed it; elsewhere there is no such thing).
// Only what kind of screen it is: never whose stats or which game. It is told
// once the screen is drawn (a section is picked as Settings opens, say).
let toCount = null;
function counted() {
  if (!window.dartsCount || toCount) return;
  toCount = setTimeout(() => {
    toCount = null;
    const tab = (prefix, t, first) => t && t !== first ? `${prefix}/${t}` : prefix;
    try {
      window.dartsCount(screen === 'game' ? `/game/${match ? routeName(match.gameId, match.opts) : ''}`
        : screen === 'players' ? tab('/stats', statsView.tab, 'stats')
        : screen === 'settings' ? tab('/settings', settingsView.tab)
        : ({ landing: '/', welcome: '/first-time', home: '/menu', sheet: '/scoresheet' })[screen] ?? `/${screen}`);
    } catch { /* counting never gets in the way */ }
  });
}
export const MAX_PLAYERS = 6;

// ---------- themes ----------
// Each theme is a block of rules in themes.css under a .t-<id> class on <html>.
// The first is the one anybody who has not chosen gets (theme.js and manifest.json say the same).
export const THEMES = [
  { id: 'chalk', name: 'Chalk & Oche', blurb: 'The pub chalkboard beside the board.', bar: '#2b1b11' },
  { id: 'stage', name: 'Stage Night', blurb: 'Big-stage TV graphics under a spotlight.', bar: '#0a0a0c' },
  { id: 'arcade', name: 'Soft-tip Arcade', blurb: 'Glowing displays and chunky buttons.', bar: '#1b1b1f' },
  { id: 'sheet', name: 'League Scoresheet', blurb: 'A printed league-night scoresheet. Light.', bar: '#eadfc4' },
  { id: 'classic', name: 'Classic', blurb: 'Plain and dark, in the board\'s own colours.', bar: '#111111' },
];
export function applyTheme() {
  const theme = THEMES.find(t => t.id === settings.theme) ?? THEMES[0];
  document.documentElement.className = 't-' + theme.id;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme.bar);
  return theme;
}
// ---------- computer players ----------
// A game that has a bot() can be played against the computer (bot.js has its levels and how it
// throws). On the menu the computer is one more player to tap, BOT in setup.players, at the level
// in setup.bot. A game needs a real player to keep its darts under, so each level is a player of
// its own on the Pi ("Bot 7"), made the first time that level is played and never listed with the
// people. In a game, match.bots says which seats the computer has: its level, or null for a person.
export const BOT = 0;  // (no player has this id: the Pi's start at 1, and one made offline is below zero)
export const botAt = () => botLevel(setup.bot ?? 5);
const botsPlay = () => !!gameById(setup.gameId)?.bot;
// Who is down to play, in throwing order: the computer only in a game it can play.
export const seats = () => (setup.players ?? []).filter(id => id !== BOT || botsPlay());
export const nameOf = id => id === BOT ? `Bot ${botAt().level}` : (players.find(p => p.id === id) ?? bots.find(p => p.id === id))?.name ?? '?';
// Whether the computer throws for this seat: BOT on the menu, or a level's own player (a tournament's bots).
export const isBotId = id => id === BOT || bots.some(b => b.id === id);
// The level the computer throws at for this seat, or null for a person.
export const levelOf = id => id === BOT ? botAt().level : bots.find(b => b.id === id)?.bot ?? null;
// The player that the computer's games at this level are kept under, made if this is its first.
export function botPlayer(level) {
  const old = bots.find(b => b.bot === level);
  if (old) return old.id;
  for (const name of [`Bot ${level}`, `Computer ${level}`, `CPU level ${level}`]) {  // (a person may have the name)
    try {
      const p = data.addPlayer(name, level);
      loadPlayers();
      return p.id;
    } catch { /* taken: the next name */ }
  }
  return null;
}
// ---------- darts ----------
// Each player can keep several sets of darts and say which they are throwing,
// the way a running app keeps a runner's shoes: every game remembers each
// player's set, and the stats can be seen set by set (and how much each is used).
export const setsOf = (id, all = false) => darts.filter(d => d.player === id && (all || !d.retired));
export const dartsName = id => darts.find(d => d.id === id)?.name ?? '?';
// The set a player is throwing: the one last chosen, or their first if that one is put away.
export function dartsFor(id) {
  const mine = setsOf(id), chosen = setup.darts?.[id];
  return mine.some(d => d.id === chosen) ? chosen : mine[0]?.id ?? null;
}
export const grams = g => g == null ? '' : `${+g.toFixed(1)}g`;

export function cleanSetup() {
  setup.players = (setup.players ?? []).filter(id => id === BOT || players.some(p => p.id === id));
  if (setup.first !== 'random' && setup.first !== 'bull') setup.first = null;  // (it was once a player)
}
// The players in the order they will throw: the order given (on the menu, the order they were tapped in),
// turned round to begin with any one of them (Random, when Start asks who throws first).
export function randomOrder(ids) {
  const at = Math.floor(Math.random() * ids.length);
  return [...ids.slice(at), ...ids.slice(0, at)];
}
// (renumbered: the game in progress is saved whole after every dart, queueSync below. When the Pi numbers one of
// its players, the saved copy has the new number at once and this one is picked up from it there and then, not
// when the sync is over: a dart thrown in between would save the old number back, and the game could never be sent.)
export const data = createSync({ store, api, changed: synced, renumbered: () => { match = store.get('match', null); } });
export function saveSetup() { data.saveSetting('setup', setup); data.sync(); }
export function saveSettings() { data.saveSetting('settings', settings); data.sync(); }
// Every change to a match is queued as a full copy of the match.
export function queueSync() {
  if (!match?.id) return;
  match.seq = (match.seq || 0) + 1;
  store.set('match', match);
  data.saveMatch(match);
  data.sync();
}
// After each sync: pick up what it changed (the Pi's numbers for players made
// offline, the Pi's lists) and redraw if anything on screen is different.
let warmed = 0;
function synced({ remapped, pulled, sent, tournaments }) {
  tracker.flush();  // the site was just reached: send the trial's notes too
  // (tournaments are read from the saved copy wherever they are drawn, and the sync has written that
  // already: it says itself whether one changed, as started or played on another screen)
  const shown = () => JSON.stringify([players, darts, boards, setup, settings]);
  const before = shown();
  loadPlayers();
  darts = store.get('darts', []);
  loadBoards();
  setup = store.get('setup', setup);
  settings = store.get('settings', settings);
  delete settings.board;
  match = store.get('match', null);
  for (const [old, id] of remapped) if (statsView.player === old) statsView.player = id;
  tourRemapped(remapped);
  playRemapped(remapped);
  cleanSetup();
  // Someone who has just signed up has one player, themselves: ready to throw.
  if (landing.newcomer && pulled && players.length === 1) {
    landing.newcomer = false;
    setup.players = [players[0].id];
    data.saveSetting('setup', setup);
  }
  applyTheme();
  refreshStatus();
  if (pulled) loadTotals();
  if (pulled && (sent || Date.now() - warmed > 600000)) warmStats();
  if (sent) { avgAsked.clear(); if (screen === 'home') loadAverages(); }  // a game just went in: the averages may have moved
  const moved = shown() !== before;
  if (!moved && !tournaments) return;
  if (screen === 'home') redraw(renderHome);  // (its line about the tournament going, too)
  if (screen === 'tournament') redraw(renderTournament);
  if (!moved) return;  // a tournament alone is on no other screen
  if (screen === 'players') redraw(renderPlayers);
  if (screen === 'settings' && (sectShown('players') || listShown())) redraw(renderSettings);
}
// Redraw without losing what is being typed.
export function redraw(draw) {
  const at = document.activeElement?.id, typed = at && document.activeElement.value;
  draw();
  const input = at && document.getElementById(at);
  if (input) { input.value = typed; input.focus(); }
}

// Stats are worked out on the Pi. Each answer is kept on this device, so the
// last known stats can still be shown when the Pi can't be reached.
export const shelf = () => window.caches ? caches.open('dartssam-data') : Promise.reject();
export const statsPath = (id, game, set, board) => `/players/${id}/stats${
  game || set || board ? `?${new URLSearchParams({ ...(game && { game }), ...(set && { darts: set }), ...(board && { board }) })}` : ''}`;
async function freshStats(path, timeout) {
  const fresh = await api(path, 'GET', undefined, timeout);
  shelf().then(c => c.put('/api' + path, new Response(JSON.stringify({ ...fresh, saved: Date.now() })))).catch(() => {});
  return fresh;
}
export async function loadStats(path, timeout) {
  try { return await freshStats(path, timeout); } catch (e) {
    const kept = e.status ? null : await shelf().then(c => c.match('/api' + path)).catch(() => null);
    if (!kept) throw e;
    return kept.json();  // has .saved: when it was fetched
  }
}
// Fetch every player's stats pages in the background, ready for offline.
let warming = false;
async function warmStats() {
  if (warming || !window.caches) return;
  warming = true;
  warmed = Date.now();
  try {
    for (const p of players) for (const g of [null, ...GAMES]) if (p.id > 0) await freshStats(statsPath(p.id, g?.id));
  } catch { warmed = 0; }  // the Pi went away: try again after the next sync
  warming = false;
}

export let connected = false;
export let cameraCount = 0;
export const setCameraCount = v => { cameraCount = v; };  // for screens/cameras.js
export let helperLinked = false;  // hosted: the person's cameras' computer is connected to the site

// ---------- new versions ----------
// When the app's files on the Pi change while the app is open, it reloads onto
// them, but never under a game: only on the menu, with no game in progress.
export const updater = createUpdater({
  reload: () => {
    navigator.serviceWorker?.controller?.postMessage({ fresh: true });  // sw.js: ask the Pi, not the saved copy
    location.reload();
  },
  idle: () => screen === 'landing' || (screen === 'home' && !match),
  memory: {
    get: () => { try { return sessionStorage.getItem('reloadedFor'); } catch { return null; } },
    set: v => { try { sessionStorage.setItem('reloadedFor', v); } catch { /* private mode */ } },
  },
});
export let appVersion = null;
export let appBuild = null;  // {release, build, commit}: which code the server is running (server/build.py)
// The version this page's own files came with (from the saved copy when that is what loaded).
if (location.host) fetch('version.json').then(r => r.ok ? r.json() : null)
  .then(v => { appVersion = v?.version ?? null; appBuild = v?.release ? v : null; updater.running(v?.version); }).catch(() => {});

// Where anybody using the app can get its source (the AGPL asks for this).
export const SOURCE = 'https://github.com/SonicSamShop/darts-sam';

// ---------- link to the Pi ----------
export let liveLine = null;
function connect() {
  if (!location.host) return;
  const ws = liveLine = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  let ping;
  ws.onopen = () => { connected = true; ping = setInterval(() => ws.send('ping'), 20000); refreshStatus(); data.sync(true); };
  ws.onclose = () => { connected = false; clearInterval(ping); refreshStatus(); setTimeout(connect, 3000); };
  ws.onmessage = e => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'hello') { cameraCount = ev.cameras; helperLinked = !!ev.helper; refreshStatus(); calibrateOnStart(); return updater.seen(ev.version); }
    onBoardEvent(ev);
  };
}
// What the cameras saw: from the cameras' computer (/ws) or this phone's own camera (phoneui.js).
function onBoardEvent(ev) {
  if (screen === 'bull' && bull) { if (ev.type === 'dart') bullDart({ seg: ev.seg, mult: ev.mult, x: ev.x, y: ev.y }); return; }
  if (screen !== 'game' || !match) return;
  if (botUp()) return;  // the computer is throwing: nothing at the board is part of the game
  if (ev.type === 'dart') push({ t: 'dart', seg: ev.seg, mult: ev.mult, x: ev.x, y: ev.y, src: 'cam' });
  // A takeout with no darts thrown is just someone touching the board.
  const s = compute(match);
  if (ev.type === 'takeout' && (s.turn.length || s.turnOver)) push({ t: 'next' });
}
export function refreshStatus() {
  document.querySelectorAll('.conn').forEach(n => {
    const cams = connected && cameraCount > 0, auto = cams || phone.scoring(), owed = data.waiting();
    const full = (camScreen.startCal === 'busy' ? 'Finding the board again…'
      : cams ? `Auto-scoring · ${cameraCount} cam${cameraCount > 1 ? 's' : ''}`
      : phone.on() ? phone.statusText()
      : !connected ? 'Offline · manual scoring'
      : account.hosted ? (helperLinked ? 'Cameras linked · not calibrated' : 'Signed in · scoring by hand')
      : 'No camera lined up · scoring by hand')
      + (!owed ? '' : connected ? ' · syncing' : ` · ${owed} to sync`)
      + (unsaved.size ? ' · this device\'s storage is full' : '');
    // The game's top bar is short of room: it gets fewer words (the full ones are the tooltip).
    const brief = n.classList.contains('brief') && !auto;
    n.title = full;
    n.innerHTML = `<span class="dot ${auto ? 'ok' : ''}"></span>${brief ? (phone.on() ? 'Phone camera (Beta)' : !connected ? 'Offline' : 'No cameras') : full}`;
  });
  fit();  // the new wording can wrap onto another line
}

// ---------- voice ----------
// The device's own voice, or the app's built-in one where it has none (voice.js).
// Which of the device's voices to use is kept on this device, not with the
// other settings: another device won't have the same voices.
export const voice = createVoice({ chosen: store.get('voiceName', '') });
export function say(text) {
  if (settings.voice) voice.say(text);
}
addEventListener('click', () => voice.unlock(), { capture: true, once: true });

// ---------- one screen, no scrolling ----------
// Every view is laid out to fill the window. If one still doesn't fit (a small
// phone, six players of Cricket), it is shrunk until it does.
// Not the menu or the settings on a phone or a tablet, though: there the middle
// of the page scrolls instead (see STACKED and style.css), so nothing gets too
// small to read or to tap.
export function fit() {
  for (const el of $app.querySelectorAll('.page, .side, .tvbar')) {
    el.style.zoom = '';
    const spills = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    for (let z = 0.95; z >= 0.4 && spills(); z -= 0.05) el.style.zoom = z.toFixed(2);
  }
  fitCam();
}
// The camera picture in Settings: as big as the room left for it, in proportion.
function fitCam() {
  const img = document.querySelector('.camview img'), box = img?.closest('.camstage');
  if (!img?.naturalWidth) return;
  const k = Math.min(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
  img.style.width = `${img.naturalWidth * k}px`;
  img.style.height = `${img.naturalHeight * k}px`;
}
addEventListener('resize', fit);
document.fonts?.addEventListener('loadingdone', fit);  // a theme's lettering arrives after the first paint

// ---------- addresses and the back button ----------
// Each screen has an address, so the browser's (or the phone's) back button
// goes back a screen instead of out of the app, and a reload stays put:
//   #/                 the menu
//   #/501/<match id>   one game: being played if it is the one in progress,
//                      otherwise its scoresheet. The first part only says what
//                      kind of game it is (an X01 game by its start score, the
//                      others by their id); the match id alone finds the game.
//   #/stats  #/cameras  #/settings  #/tournament
//   #/start            what the program on the cameras' computer opens: see begin()
// The detail of a screen (whose stats, how far a figure is opened up) is not
// in the address. It rides along in the browser's history entry instead (see
// place()), which is what back, forward and reload bring back.
export let depth = 0;  // how many history entries this screen is above the menu
const word = /^[\w-]+$/;
const routeName = (gameId, opts) => gameId === 'x01' ? String(opts?.start ?? 501) : gameId;
const gameUrl = (gameId, opts, id) => `#/${routeName(gameId, opts)}/${id}`;
// What is on screen now, as [what rides along, '', address] for the browser's history.
function place() {
  const at = { screen, depth };
  let url = '#/';
  if (screen === 'game') { at.id = match.id; url = gameUrl(match.gameId, match.opts, match.id); }
  if (screen === 'sheet') {
    Object.assign(at, { screen: 'game', id: sheet.id, name: sheet.name });
    url = sheet.m ? gameUrl(sheet.m.game, sheet.m.opts, sheet.id) : `#/${sheet.name}/${sheet.id}`;
  }
  if (screen === 'players') {
    Object.assign(at, { statsFor: statsView.player, statsGame: statsView.game, statsDarts: statsView.darts, statsBoard: statsView.board, statsTab: statsView.tab, drill: statsView.drill });
    // A scoresheet reached through the stats has the game's own address too.
    const top = statsView.drill.at(-1), m = top?.v === 'match' && statsData && deep(statsData).matches.find(m => m.id === top.id);
    url = m ? gameUrl(m.game, m.opts, m.id) : '#/stats';
  }
  if (screen === 'settings') { Object.assign(at, { settingsTab: settingsView.tab, settingsOpen: settingsView.open, fromList: settingsView.fromList }); url = '#/settings'; }
  if (screen === 'cameras') url = '#/cameras';
  if (screen === 'tournament') { at.tourId = tourView.id; at.tourPast = tourView.past; url = '#/tournament'; }
  return [at, '', url];
}
// Note where the app is now: as a new history entry (push), or in place of the current one.
export function mark(push) {
  counted();  // a tab changed within the screen, say
  if (screen === 'landing') return;  // the welcome page has no address: the one asked for is kept for after signing in
  if (screen === 'welcome') return;  // nor has the desktop app's first screen: opened again, it asks again
  if (push) depth++;
  try { history[push ? 'pushState' : 'replaceState'](...place()); } catch { if (push) depth--; }  // refused: carry on without
}
// What an address on its own asks for.
function fromHash() {
  const [a, b] = location.hash.slice(1).split('/').filter(Boolean);
  if (a === 'stats' && !b) return { screen: 'players' };
  if (a === 'settings' && !b) return { screen: 'settings' };
  if (a === 'cameras' && !b) return { screen: 'cameras' };
  if (a === 'tournament' && !b) return { screen: 'tournament' };
  if (a === 'start' && !b) return { screen: 'start' };
  // the link the cameras' computer shows when pairing: Cameras with its code filled in
  if (a === 'pair' && /^[A-Za-z0-9]{6}$/.test(b ?? '')) { pairing.code = b.toUpperCase(); return { screen: 'cameras' }; }
  if (word.test(a ?? '') && word.test(b ?? '')) return { screen: 'game', id: b, name: a };
  return { screen: 'home' };
}
// Draw the screen a history entry (or an address) describes.
function show(at) {
  if (account.locked) return renderLanding();
  if (at.screen === 'game') return match?.id === at.id ? renderGame() : renderSheet(at.id, at.name);
  if (at.screen === 'players') {
    // (adding and editing players was once part of the stats: an entry from then finds them in the settings)
    if (at.editing || at.statsTab === 'edit') { settingsView.tab = 'players'; return renderSettings(true); }
    if ('statsFor' in at) { statsView.player = at.statsFor; statsView.game = at.statsGame; statsView.tab = at.statsTab; }
    statsView.darts = at.statsDarts ?? null;
    statsView.board = at.statsBoard ?? null;
    statsView.drill = (at.drill ?? []).map(level => ({ ...level }));
    return renderPlayers();
  }
  // (the cameras were once a tab of the settings: a history entry from then still finds them)
  if (at.screen === 'cameras' || (at.screen === 'settings' && at.settingsTab === 'cams')) return renderCameras();
  if (at.screen === 'tournament') return openTournament(at.tourId ?? null, !!at.tourPast);
  if (at.screen === 'settings') { settingsView.tab = at.settingsTab ?? settingsView.tab; settingsView.open = !!at.settingsOpen; settingsView.fromList = !!at.fromList; return renderSettings(); }
  return renderHome();
}
// The app's own Menu and Back buttons take the same steps as the browser's.
export function goHome() {
  if (depth) return history.go(-depth);
  renderHome();
  mark();
}
function goBack() {
  if (depth) history.back(); else goHome();
}
addEventListener('popstate', e => {
  roster.removeArmed = roster.adding = false;
  roster.formError = '';
  roster.dartsForm = roster.dartsError = null;
  closeFirst();
  closeQuit();
  dropBull();
  if (e.state?.screen) { depth = e.state.depth ?? 0; return show(e.state); }
  depth++;  // an address typed in by hand: a new entry with nothing riding along
  show(fromHash());
  mark();
});
// Starting up: carry on from the history entry if there is one (a reload).
// Opened afresh, the menu goes underneath whatever the address asks for, and
// with no address a game in progress is opened straight away.
// The program on the cameras' computer opens #/start: the cameras if none of
// them is lined up and ready to score, and otherwise as with no address.
// The first time, that program's owner is asked who they are and whether they
// have a camera (see "the first time the desktop app is opened"). Someone who
// has just signed up on the hosted site is asked about the camera too.
export function begin() {
  if (account.locked) return renderLanding();
  if (welcomeDue() || nameDue()) return renderWelcome();
  if (history.state?.screen) { depth = history.state.depth ?? 0; return show(history.state); }
  const want = fromHash();
  if (want.screen !== 'start') return open(want);
  beginDesktop();
}
async function beginDesktop() {
  // Has anyone played here, and has sharing been asked about? Wait for the answers, though not for long.
  await Promise.race([Promise.all([asked, data.sync(true)]).catch(() => {}), new Promise(done => setTimeout(done, 5000))]);
  if (account.locked) return renderLanding();
  if (!account.hosted && !players.length && !store.get('welcomed', null)) return renderWelcome();
  // Someone who said they have no camera is not sent to the cameras each time.
  if (store.get('welcomed', null)?.camera === false) return open({ screen: 'home' });
  camerasReady().then(ready => open({ screen: ready ? 'home' : 'cameras' }));
}
const camerasReady = () => account.hosted ? Promise.resolve(true)
  : api('/status', 'GET', undefined, 3000).then(s => s.cameras.some(c => c.points), () => true);
export function open(want) {
  if (account.locked) return renderLanding();
  if (want.screen === 'home' && match) want = { screen: 'game', id: match.id };
  screen = 'home';
  mark();
  if (want.screen === 'home') return renderHome();
  show(want);
  mark(true);
}

export function icon(d) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
// ---------- getting about ----------
// The app's four places, a tap away from every screen but the game itself (and
// the pages before the app: signing in, the desktop app's first questions).
// They are drawn twice, and style.css shows one: along the top beside the name
// on a computer, as a bar of tabs along the bottom on a phone or tablet.
const PLACES = [  // [where, its name, its name where room is short, its picture]
  ['home', 'Play', 'Play', icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>')],
  ['players', 'Stats', 'Stats', icon('<path d="M5 20V10M12 20V4M19 20v-7"/>')],
  ['cameras', 'Cameras', 'Cameras', icon('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>')],
  ['settings', 'Settings', 'Settings', icon('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>')],
];
const nav = (on, where) => `<nav class="nav ${where}" aria-label="Darts S.A.M">${PLACES.map(([id, name, short, pic]) =>
  `<button class="${id === on ? 'on' : ''}" data-nav="${id}"${id === on ? ' aria-current="page"' : ''}>${pic}<span class="long">${name}</span><span class="short">${short}</span></button>`).join('')}</nav>`;
// The top and the bottom of a screen: `on` is the place it belongs to.
export const pageHead = on => `<div class="row head"><h1>Darts S.A.M</h1><span class="spacer"></span><span class="conn muted"></span>${nav(on, 'top')}</div>`;
export const pageFoot = on => nav(on, 'foot');
// One place to another. Only the first step away from the menu, or from deep
// in the stats, is a new step for Back: between the places themselves each
// takes the last one's, so Back from any of them is the menu.
function goTo(place) {
  if (place === 'home') return goHome();
  menu.rulesOpen = false;  // back on the menu later, the games are there, not the rules last read
  const deep = screen === 'home' || screen === 'sheet' || (screen === 'players' && statsView.drill.length > 0);
  if (place === 'players') { statsView.drill = []; renderPlayers(); }
  if (place === 'cameras') { camScreen.adding = false; camScreen.step = camScreen.note = ''; renderCameras(); }
  if (place === 'settings') { settingsView.open = settingsView.fromList = false; renderSettings(); }
  mark(deep);
}

// ---------- events ----------
$app.addEventListener('click', e => {
  const camview = e.target.closest('.camview');
  if (camview && e.target.tagName === 'IMG') return calibTap(+camview.dataset.cam, e.target, e);
  // tiles and lines can be tapped too, and so can the tournament's bracket and its matches
  const b = e.target.closest('button, a[data-act], .bracket [data-act], .bracket[data-act], [data-drill], [data-sort], [data-sheet], [data-gear], [data-onboard], [data-slip]');
  if (!b) return;
  if (b.tagName === 'A') e.preventDefault();  // a link that does something on this page instead (see siteHead)
  const d = b.dataset;
  if (d.act !== 'remove') roster.removeArmed = false;
  if (d.act !== 'addplayer' && d.act !== 'rename' && d.act !== 'remove') roster.formError = '';
  if (!/darts$/.test(d.act ?? '')) roster.dartsError = null;
  if (d.act !== 'addplayer') roster.adding = d.act === 'newplayer';
  if (d.game) {
    // chosen: on to the next step, or to the players when nobody is down to play
    setup.gameId = d.game;
    menu.optHelp = null;  // the "?" that was open belonged to the last game's options
    menu.step = gameById(d.game).options.length ? 'options' : setup.players.length ? null : 'players';
    menu.stepMoved = true;
    saveSetup();
    return renderHome();
  }
  if (d.act === 'rules') {
    menu.rulesOpen = menu.rulesMoved = !menu.rulesOpen;
    if (menu.rulesOpen) { if (menu.rules && !(menu.rules instanceof Promise) && !Object.keys(menu.rules).length) menu.rules = null; loadRules(); }
    return renderHome();
  }
  if (d.opthelp) { menu.optHelp = menu.optHelp === d.opthelp ? null : d.opthelp; return renderHome(); }
  if (d.step && !d.opt) { menu.step = menu.step === d.step ? null : d.step; menu.stepMoved = true; return renderHome(); }
  if (d.step) {
    const o = gameById(setup.gameId).options.find(o => o.key === d.opt);
    setup.opts[d.opt] = Math.min(o.max, Math.max(o.min, setup.opts[d.opt] + +d.step));
    saveSetup();
    return renderHome();
  }
  if (d.opt) { setup.opts[d.opt] = JSON.parse(d.val); saveSetup(); return renderHome(); }
  if (d.usedarts) { setup.darts = { ...setup.darts, [d.usedarts]: d.set }; saveSetup(); return renderHome(); }
  if (d.gear !== undefined) { statsView.darts = d.gear || null; statsView.drill = []; statsView.tab = 'stats'; renderPlayers(); return mark(); }
  if (d.onboard !== undefined) { statsView.board = d.onboard || null; statsView.drill = []; statsView.tab = 'stats'; renderPlayers(); return mark(); }
  if (d.pick) {
    const id = +d.pick, at = setup.players.indexOf(id);
    if (at >= 0) setup.players.splice(at, 1);
    else if (setup.players.length < MAX_PLAYERS) setup.players.push(id);
    saveSetup();
    return renderHome();
  }
  // Going somewhere new adds a history entry (mark(true)); changing what a
  // screen shows only updates the entry it has.
  if (d.sheet) { renderSheet(d.sheet); return mark(true); }
  if (d.tab) { statsView.tab = d.tab; drawPlayers(); return mark(); }
  if (d.slip !== undefined) return slipTapped();
  if (d.drill) { statsView.drill.push(JSON.parse(d.drill)); drawPlayers(); return mark(true); }
  if (d.sort) {
    const top = statsView.drill.at(-1);
    top.desc = top.by === d.sort ? !top.desc : true;
    top.by = d.sort;
    drawPlayers();
    return mark();
  }
  if (d.nav) return goTo(d.nav);
  if (d.stab) { settingsView.tab = d.stab; renderSettings(); return mark(); }
  if (d.sopen) return openSection(d.sopen);
  if (d.camremove) return changeCameras('/cameras/remove', { name: d.camremove });
  if (d.camoff) return changeCameras('/cameras/enabled', { name: d.camoff, on: false });
  if (d.camon) return changeCameras('/cameras/enabled', { name: d.camon, on: true });
  if (d.showcam) { camScreen.shown = +d.showcam; camScreen.one = true; camScreen.adding = false; camScreen.calib = {}; camScreen.autoCal = null; camScreen.calibNote = camScreen.note = ''; camScreen.calibFailed = false; return renderCameras(); }
  if (d.key === 'cancel') { numPad.ask = null; numPad.value = ''; return renderGame(); }
  if (d.key) return padKey(d.key);
  if (d.fin) return padCommit(numPad.ask.total, +d.fin);
  if (d.theme) { settings.theme = d.theme; saveSettings(); applyTheme(); renderSettings(); return mark(); }
  if (d.checkouts) { settings.checkouts = d.checkouts === 'on'; saveSettings(); return renderSettings(); }
  if (d.achievements) { settings.achievements = d.achievements === 'on'; saveSettings(); return renderSettings(); }
  if (d.photos) { settings.photos = d.photos === 'on'; saveSettings(); return renderSettings(); }
  if (d.visitflash) { settings.visitFlash = d.visitflash === 'on'; saveSettings(); return renderSettings(); }
  if (d.flight) { settings.flight = d.flight === 'on'; saveSettings(); return renderSettings(); }
  if (d.autostart) { settings.autoCal = d.autostart === 'on'; saveSettings(); return drawCameras(camStatus); }
  if (d.botlevel) { setup.bot = botLevel(botAt().level + +d.botlevel).level; setup.botAuto = false; saveSetup(); return renderHome(); }
  if (d.act === 'botsuggest') { setup.botAuto = true; followSuggestion(); saveSetup(); return renderHome(); }
  if (d.voice) {
    settings.voice = d.voice === 'on';
    saveSettings();
    say('One hundred and eighty');  // so the voice can be heard, and checked, from here
    return renderSettings();
  }
  if (d.eachdart) {
    settings.eachDart = d.eachdart === 'on';
    saveSettings();
    say(settings.eachDart ? 'Treble 20. Treble 20. Treble 20. One hundred and eighty' : 'One hundred and eighty');
    return renderSettings();
  }
  if (d.calib) {
    if (camScreen.calib[d.calib]) delete camScreen.calib[d.calib]; else camScreen.calib[d.calib] = [];
    camScreen.autoCal = null; camScreen.calibNote = ''; camScreen.calibFailed = false;
    return renderCameras();
  }
  if (d.autocal) {
    const id = +d.autocal;
    delete camScreen.calib[id];
    if (camScreen.autoCal === id) { camScreen.autoCal = null; return renderCameras(); }
    camScreen.shown = id;
    // A tap on its 20 first, on the picture large, even for a camera lined up before: found
    // without one, the old line-up says where the 20 is, and a wrong one would never come right.
    // (Finding the board on all, and as the app opens, go by the old line-up.)
    camScreen.one = true;
    camScreen.number = 20;  // "another number" is for one camera that can't see the 20, not the next
    camScreen.autoCal = id; camScreen.calibNote = ''; camScreen.calibFailed = false;
    return renderCameras();
  }
  switch (d.act) {
    case 'addplayer': return addPlayer();
    case 'newplayer':
      if (screen !== 'settings') { menu.step = 'players'; return renderHome(); }
      roster.open = roster.dartsForm = null;
      renderSettings();
      return document.getElementById('newplayer')?.focus();
    case 'openplayer': roster.open = roster.open === +d.id ? null : +d.id; roster.dartsForm = null; return renderSettings();
    case 'editdarts': roster.dartsForm = d.id; roster.dartsError = null; return renderSettings();
    case 'newdarts': roster.dartsForm = 'new'; roster.dartsError = null; renderSettings(); return document.getElementById('dname')?.focus();
    case 'closedarts': roster.dartsForm = roster.dartsError = null; return renderSettings();
    case 'rename': return renamePlayer(+d.id);
    case 'remove': return removePlayer(+d.id);
    // To the players' cards: with one player down to play theirs is open, and with nobody to list, the box for a name.
    case 'manageplayers':
      settingsView.tab = 'players';
      roster.open = setup.players.length === 1 ? setup.players[0] : null;
      roster.dartsForm = null;
      roster.adding = !players.length;
      renderSettings(true);
      return mark(true);
    case 'adddarts': return addDarts(+d.id);
    case 'savedarts': return saveDarts(d.id);
    case 'retiredarts': return changeDarts(d.id, { retired: d.retired === 'yes' });
    case 'players': statsView.drill = []; renderPlayers(); return mark(true);
    case 'up': return goBack();
    case 'start':
    case 'rematch':
      cleanSetup();
      if (seats().length > 1) return askFirst(d.act, homePlay());
      return startMatch(d.act, homePlay());
    case 'bull-cancel': return closeBull();
    case 'bull-undo':
      clearTimeout(bull.timer);
      while (bull.darts.at(-1)?.bot) bull.darts.pop();  // the computer's dart goes with the one before it
      bull.darts.pop();
      return renderBull();
    case 'bull-random': return bullRandom();
    case 'bull-start': return bullStart();
    case 'resume': renderGame(); return mark(true);
    case 'tournament': openTournament(); return mark(true);
    // A tournament's match is won: to its bracket, in place of the game (the result is in already).
    case 'tour-back': openTournament(match?.opts?.tournament?.id ?? null); return mark();
    case 'quit': return askQuit();
    case 'home': return goHome();
    case 'settings': settingsView.open = settingsView.fromList = false; renderSettings(); return mark(true);
    case 'cameras': camScreen.adding = false; camScreen.step = camScreen.note = ''; renderCameras(); return mark(true);
    case 'camadd': camScreen.adding = true; camScreen.first = false; camScreen.step = camScreen.note = ''; return renderCameras();
    case 'camadd-done': camScreen.adding = false; camScreen.step = camScreen.note = ''; return renderCameras();
    case 'cam-step': camScreen.step = camScreen.note = ''; return renderCameras();
    case 'cam-usb': return usbChosen();
    case 'camgrid': camScreen.one = false; camScreen.calib = {}; camScreen.autoCal = null; camScreen.calibNote = camScreen.note = ''; camScreen.calibFailed = false; return renderCameras();
    case 'findall': return findAll();
    case 'welcome-name': return welcomeNamed();
    case 'welcome-back': welcomeForm.step = welcomeForm.note = ''; return renderWelcome();
    case 'welcome-cam': return finishWelcome(true);
    case 'welcome-nocam': return finishWelcome(false);
    case 'cam-phone': camScreen.step = 'phone'; camScreen.note = ''; renderCameras().then(() => document.getElementById('cam-address')?.focus()); return;
    case 'undo': numPad.value = ''; numPad.ask = null; numPad.error = ''; return undo();
    case 'entry':
      settings.entry = settings.entry === 'pad' ? 'board' : 'pad';
      numPad.value = ''; numPad.ask = null; numPad.error = '';
      saveSettings();
      return renderGame();
    case 'tv': settings.view = settings.view === 'tv' ? 'cards' : 'tv'; saveSettings(); return renderGame();
    case 'miss': return botUp() ? undefined : push({ t: 'dart', seg: 0, mult: 0, src: 'miss' });
    case 'botgo': return botUp() ? (clearTimeout(botTimer), botThrow()) : undefined;
    case 'next':
      if (compute(match).lastVisit?.auto || botUp()) return;  // the third dart already moved play on, or the computer is up
      return push({ t: 'next' });
    case 'reset': return resetDetection();
    case 'refreshcams': return refreshCameras();
    case 'addcam': return addCamera();
    case 'report': return reportProblem();
    case 'pair': return pairCameras();
    case 'pair-retry': pairing.note = ''; return renderCameras();
    case 'phonecam': return phone.open();
    case 'unpair': pairing.unpairAsk = true; return renderCameras();
    case 'unpair-no': pairing.unpairAsk = false; return renderCameras();
    case 'unpair-yes': return unpairCameras();
    case 'link-pair': return linkDo('POST', '/link/pair');
    case 'link-unpair': return linkDo('DELETE', '/link');
    case 'feedback': return sendFeedback();
    case 'apple': return appleSignIn();
    case 'download': return location.assign('download.html');
    case 'land-home': return document.querySelector('.site').scrollTo({ top: 0, behavior: 'smooth' });
    case 'land-top': if (account.front) return location.assign(account.app);  // signing in is at the app's address
      return document.getElementById('signin').scrollIntoView({ behavior: 'smooth', block: 'center' });
    case 'mail': landing.mailStep = 'ask'; landing.note = ''; renderLanding(); return document.getElementById('mail-addr').focus();
    case 'mail-send': return sendCode();
    case 'mail-code': return signIn('email', { email: mailTo, code: document.getElementById('mail-code').value });
    case 'mail-back': landing.mailStep = 'ask'; landing.note = ''; renderLanding(); return document.getElementById('mail-addr').focus();
    case 'sback': return closeSection();
    case 'openboard': case 'newboard': case 'closeboard': case 'askputup': case 'askbefore': case 'closeask':
    case 'saveboard': case 'putup': case 'playedbefore': case 'removeboard': return boardAct(d.act, d.id);
    case 'acct-signout': acct.signingOut = true; acct.note = ''; return renderSettings();
    case 'acct-signout-no': acct.signingOut = false; return renderSettings();
    case 'acct-signout-yes': return accountDo('signout');
    case 'acct-delete': acct.deleting = true; acct.signingOut = false; acct.note = ''; return renderSettings();
    case 'acct-delete-no': acct.deleting = false; return renderSettings();
    case 'acct-delete-yes': return accountDo('delete');
    case 'share-on': return setShare(true);
    case 'share-off': return setShare(false);
    case 'share-delete': sharing.deleting = true; sharing.note = ''; return renderSettings();
    case 'share-delete-no': sharing.deleting = false; return renderSettings();
    case 'share-delete-yes': return deleteShared();
  }
  if (d.act?.startsWith('tour-')) return tourAct(d.act, d);
});
// The stats screen's drop-downs: whose stats, for which game, and with which darts.
$app.addEventListener('change', e => {
  if (e.target.dataset?.voicename !== undefined) {
    store.set('voiceName', e.target.value);
    voice.choose(e.target.value);
    say('One hundred and eighty');  // so it can be heard
    return;
  }
  if (e.target.dataset?.bothold !== undefined) {
    settings.botHold = +e.target.value;
    saveSettings();
    return;
  }
  if (e.target.dataset?.tapnumber !== undefined) { camScreen.number = +e.target.value; return renderCameras(); }
  if (e.target.dataset?.place !== undefined) return placeCamera(+e.target.dataset.place, e.target.value);
  if (e.target.dataset?.camset !== undefined) return cameraSettings();
  const choose = e.target.dataset?.choose;
  if (!choose) return;
  statsView.drill = [];
  if (choose === 'game') statsView.game = e.target.value || null;
  if (choose === 'darts') statsView.darts = e.target.value || null;
  if (choose === 'board') statsView.board = e.target.value || null;
  if (choose === 'player') statsView.darts = null;  // sets belong to one player
  renderPlayers(choose === 'player' ? +e.target.value : statsView.player);
  mark();
});
// The camera picture is sized once it has loaded ('load' doesn't bubble, hence the capture).
$app.addEventListener('load', e => { if (e.target.matches?.('.camview img')) fitCam(); }, true);
$app.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'newplayer') addPlayer();
  if (e.target.dataset.rename) renamePlayer(+e.target.dataset.rename);
  if (['dname', 'dgrams', 'dbrand', 'dnotes'].includes(e.target.id)) e.target.closest('.pform').querySelector('.primary').click();
  if (['bbrand', 'bmodel', 'bnotes'].includes(e.target.id)) boardAct('saveboard');
  if (e.target.id === 'cam-address') addCamera();
  if (e.target.id === 'welcome-name') welcomeNamed();
  if (e.target.id === 'pair-code') pairCameras();
  if (e.target.id === 'mail-addr') sendCode();
  if (e.target.id === 'mail-code') signIn('email', { email: mailTo, code: e.target.value });
});

applyTheme();
cleanSetup();
connect();
// Opened by the link in a sign-in email (#/in/<what the link carries>): it is
// used once the server has said nobody is signed in here, and is not left in the address.
const mailLink = location.hash.match(/^#\/in\/([\w-]+)$/)?.[1];
if (mailLink) try { history.replaceState(null, '', '#/'); } catch { location.hash = '#/'; }
// Is this the hosted version, and is anyone signed in? (The server at home has no such thing.)
const asked = account.load().then(() => {
  if (!account.hosted) { loadRelease(); return loadShare(); }
  tracker.track('open', openDetail());
  tracker.flush();
  if (account.account) data.sync(true);
  if (screen === 'settings') renderSettings();  // the Account tab appears
  if (screen === 'cameras') renderCameras();   // theirs are reached through the site
  if (mailLink && !account.account) signIn('email/link', { token: mailLink });
});
// The very first time at an address there is nothing to say whether it opens on
// the welcome page or the menu: wait for the answer, though not for long.
if (account.undecided) Promise.race([asked, new Promise(done => setTimeout(done, 1500))]).then(begin);
else begin();

// Sync on opening, whenever the Pi or the network comes back, and when the
// app is brought to the front. Anything still queued is retried every so often.
data.sync(true);
addEventListener('online', () => data.sync(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) data.sync(true); });

// ---------- keep the screen on ----------
// A phone or tablet scoring a game shouldn't dim and lock between throws. The
// browser lets go of this whenever the app is hidden (switched away from, the
// phone locked by hand), so ask again each time it is back. Safari may want a
// tap first, so a tap asks too. Where the browser can't, the screen sleeps as usual.
let wakeLock = null;
async function keepScreenOn() {
  if (wakeLock || document.hidden || !navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }  // low battery mode, or not allowed yet: the next tap or return tries again
}
keepScreenOn();
document.addEventListener('visibilitychange', keepScreenOn);
addEventListener('click', keepScreenOn, { capture: true });
setInterval(() => { if (data.waiting()) data.sync(); }, 30000);
