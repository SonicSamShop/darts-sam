// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import { GAMES } from './games/index.js';
import { gameById, canStart, needsMore, newMatch, compute, elapsed, clock, timeSpent, previousVisit } from './engine.js';
import { buildBoard, label, spoken, value, bullUp, bullMm } from './board.js';
import { createSync, matchSheet } from './sync.js';
import { createUpdater } from './update.js';
import { request } from './api.js';
import { createAccount } from './account.js';
import { createTracker } from './track.js';
import { createVoice } from './voice.js';
import { LEVELS, botLevel, levelFor, throwAt } from './bot.js';
import { createPhoneUi } from './phoneui.js';
import { X01_TILES, x01Tile, x01Stats, x01Legs, visitsOf, dartTable, visitsWith } from './stats.js';
import { ACHIEVEMENTS, GROUPS, byId, held, newly, chief, add, tally as gameTally, totalOf, timeline, visitOf, standing, earnedBy } from './achievements.js';
import {
  deleteShared, loadShare, openDetail, setShare, share, shareAsk, sharePanel, sharing
} from './screens/sharing.js';
import { accountDo, accountPanel, acct, feedbackBox, sendFeedback } from './screens/accountpanel.js';
import {
  addCamera, autoCalibrate, calibTap, calibrateOnStart, camScreen, camStatus, changeCameras, drawCameras, linkDo,
  pairCameras, pairing, refreshCameras, renderCameras, resetDetection, unpairCameras, usbChosen
} from './screens/cameras.js';
import { appleSignIn, landing, mailTo, renderLanding, sendCode, signIn } from './screens/landing.js';
import { achTab, achievementView, achievementsPane } from './screens/achievements.js';
import {
  addDarts, addPlayer, changeDarts, newPlayerRow, playersPanel, removePlayer, renamePlayer, roster, saveDarts
} from './screens/playerspanel.js';
import { closeSection, listShown, openSection, renderSettings, sectShown, settingsView } from './screens/settings.js';
import { loadRelease } from './screens/release.js';
import { deep, drawPlayers, pct, renderPlayers, renderSheet, sheet, statsData, statsView } from './screens/stats.js';
import {
  avgAsked, followSuggestion, loadAverages, loadRules, loadTotals, menu, renderHome, startOpts
} from './screens/home.js';

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
export const setMatch = v => { match = v; };  // for screens/home.js
// The people who play: [{id, name}]. The computer's players are kept apart, so that no list of
// players has them in it: [{id, name, bot: its level}] (see "computer players" below).
export let players = [];
let bots = [];
export function loadPlayers() {
  const all = store.get('players', []);
  players = all.filter(p => !p.bot);
  bots = all.filter(p => p.bot);
}
loadPlayers();
export let darts = store.get('darts', []);  // every player's sets of darts: [{id, player, name, grams, created, retired}]
export const setDarts = v => { darts = v; };  // for screens/playerspanel.js
// players: ids in throwing order. darts: {player id: the set of darts they are throwing}
export let setup = store.get('setup', { gameId: 'x01', players: [], opts: {} });
// Sound starts off; once on, the visit's total is called, and each dart only if asked for.
export let settings = store.get('settings', { voice: false });
export let totals = store.get('totals', null);  // {darts, reports}: everything on the Pi, as it last said
export const setTotals = v => { totals = v; };  // for screens/home.js
export let screen = match ? 'game' : 'home';
export const setScreen = v => { screen = v; };  // for screens/cameras.js, screens/landing.js, screens/settings.js, screens/stats.js, screens/home.js
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
// The player that the computer's games at this level are kept under, made if this is its first.
function botPlayer(level) {
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
// The level of the computer player whose throw it is in the game in progress, or null.
const botUp = (s = compute(match)) => s.winner == null ? match.bots?.[s.current] ?? null : null;
// The computer throws by itself, a dart at a time, whenever the game is on screen and it is its
// turn: renderGame() asks for the next dart each time it draws. Straight after a person's visit
// it holds off for a while, counting down on screen, so a wrongly scored dart can be put right
// (Undo) before it starts; "Throw now" skips the wait. The countdown is kept while the screen
// redraws, and starts again only when something new goes into the game.
// How long it holds off is a setting (Settings > In a game): 0 to 30 seconds, 8 unless
// changed. At 0 there is no wait and no countdown: it throws as it does after its own dart.
const BOT_WAIT = 2200;
const BOT_PACE = 1200;
export const BOT_HOLD_MAX = 30;  // seconds
export const BOT_HOLD_USUAL = 8;
export function botHoldSecs() {
  const n = Math.round(Number(settings.botHold ?? BOT_HOLD_USUAL));
  return Number.isFinite(n) ? Math.min(BOT_HOLD_MAX, Math.max(0, n)) : BOT_HOLD_USUAL;
}
let botTimer = 0;
let botTick = 0;
let botHold = null;  // {at: match.log.length, due: time} while waiting after a person's visit
let botFlight = false;  // the dart about to be drawn is the computer's: show it landing
function botSoon() {
  clearTimeout(botTimer);
  clearInterval(botTick);
  if (screen !== 'game' || !match) return;
  const s = compute(match);
  if (!botUp(s)) { botHold = null; return; }
  if (!botHolds(s)) {
    botHold = null;
    botTimer = setTimeout(botThrow, s.turn.length ? BOT_PACE : BOT_WAIT);
    return;
  }
  if (botHold?.at !== match.log.length) botHold = { at: match.log.length, due: Date.now() + botHoldSecs() * 1000 };
  botTimer = setTimeout(botThrow, Math.max(0, botHold.due - Date.now()));
  botTick = setInterval(showBotHold, 250);
  showBotHold();
}
// Whether the computer's next dart waits on a person's visit just gone in.
const botHolds = s => botHoldSecs() > 0 && !!botUp(s) && !s.turn.length && match.log.length > 0 && match.log.at(-1).src !== 'bot';
const botHoldLeft = () => botHold ? Math.max(1, Math.ceil((botHold.due - Date.now()) / 1000)) : 0;
function showBotHold() {
  const el = document.querySelector('.botwait b');
  if (el) el.textContent = botHoldLeft();
}
function botThrow() {
  clearInterval(botTick);
  botHold = null;
  if (screen !== 'game' || !match) return;
  if (quitAsk) return botSoon();  // being asked whether to quit: wait for the answer
  const s = compute(match), level = botUp(s), game = gameById(match.gameId);
  if (!level || !game.bot) return;
  botFlight = true;
  push({ t: 'dart', ...game.bot(s, botLevel(level), Math.random), src: 'bot' });
  botFlight = false;
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
// The players in the order they will throw: the order they were tapped in,
// turned round to begin with any one of them (Random, when Start asks who throws first).
function randomOrder() {
  const ids = seats(), at = Math.floor(Math.random() * ids.length);
  return [...ids.slice(at), ...ids.slice(0, at)];
}
export const data = createSync({ store, api, changed: synced });
export function saveSetup() { data.saveSetting('setup', setup); data.sync(); }
function saveSettings() { data.saveSetting('settings', settings); data.sync(); }
// Every change to a match is queued as a full copy of the match.
function queueSync() {
  if (!match?.id) return;
  match.seq = (match.seq || 0) + 1;
  store.set('match', match);
  data.saveMatch(match);
  data.sync();
}
// After each sync: pick up what it changed (the Pi's numbers for players made
// offline, the Pi's lists) and redraw if anything on screen is different.
let warmed = 0;
function synced({ remapped, pulled, sent }) {
  tracker.flush();  // the site was just reached: send the trial's notes too
  const shown = () => JSON.stringify([players, darts, setup, settings]);
  const before = shown();
  loadPlayers();
  darts = store.get('darts', []);
  setup = store.get('setup', setup);
  settings = store.get('settings', settings);
  match = store.get('match', null);
  for (const [old, id] of remapped) if (statsView.player === old) statsView.player = id;
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
  if (shown() === before) return;
  if (screen === 'home') redraw(renderHome);
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
export const statsPath = (id, game, set) => `/players/${id}/stats${
  game || set ? `?${new URLSearchParams({ ...(game && { game }), ...(set && { darts: set }) })}` : ''}`;
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
function say(text) {
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

// ---------- match actions ----------
function push(ev) {
  const before = compute(match);
  if (before.winner != null) return;
  const sheetBefore = achievementsOn() && bases?.id === match.id ? matchSheet(match) : null;
  if (ev.t === 'dart') tracker.entered(match.id, ev); else tracker.moved();
  match.log.push({ ...ev, ts: Date.now() });
  const after = compute(match);
  const earned = sheetBefore ? achieved(before, sheetBefore, after, ev.src === 'cam') : [];  // said after the score: "Sam, Maximum"
  if (after.winner != null) endedHere();
  store.set('match', match);
  queueSync();
  // What the next thrower has left, once they are on a finish (X01, 170 or
  // below). Called once, at the start of the visit ("Sam, you require 121"),
  // not again after each dart.
  const left = gameById(match.gameId).left?.(after);
  // Each dart is called as it lands, ahead of anything else there is to say
  // (the visit's total, a bust, game shot), when that is asked for in the
  // settings. Games with no total to call (Cricket, Killer and the like) call
  // every dart regardless: there the dart is the score.
  const game = gameById(match.gameId);
  const dart = ev.t === 'dart' && (settings.eachDart || game.showTotal === false) ? spoken(ev) : '';
  const require = left && !after.turn.length
    ? (after.players.length > 1 ? `${after.players[after.current]}, you require ${left}` : `You require ${left}`) : '';
  let rest = [];
  if (after.winner != null) {
    const result = game.result?.(after);  // practice games have a result, not a winner
    rest = [result ? `Game over. ${result}` : `Game shot. ${after.players[after.winner]} wins`];
  } else if (after.legWon) {
    // Play has already moved on to whoever throws first in the next leg.
    rest = [`Game shot, and the ${after.legWon.set ? 'set' : 'leg'}, ${after.players[after.legWon.player]}`, require];
  } else if (after.bust != null) {
    rest = ['Bust', require];  // play has already moved on
  } else if (after.lastVisit) {
    // Play has already moved on. Games where the sum means nothing skip the total.
    rest = [game.showTotal === false ? '' : after.lastVisit.total, require];
  } else if (after.turnOver && !before.turnOver) {
    rest = [game.showTotal === false ? '' : after.turn.reduce((t, d) => t + value(d), 0)];
  } else rest = [require];
  // What the dart did, in games that have something to say about it (Killer).
  const call = ev.t === 'dart' ? game.call?.(after) ?? '' : '';
  // With two or more playing, whoever is up is called by name as their visit
  // begins. "You require" above already names them.
  const began = after.winner == null && !after.turn.length && !after.turnOver
    && (after.throws.length !== before.throws.length || after.current !== before.current || after.round !== before.round);
  const name = began && after.players.length > 1 && !require ? after.players[after.current] : '';
  // What to aim at (Random Targets, Around the Clock) is called out last, when
  // it changes and at the start of every visit: "Next, Treble 16", or "Sam,
  // Treble 16" for the next thrower. Alone and still on the same one: "Aim for 5".
  const aimAt = t => (t.winner == null ? game.aim?.(t) ?? '' : '');
  const changed = aimAt(after) !== aimAt(before);
  const aim = began || changed ? aimAt(after) : '';
  const next = name ? (aim ? `${name}, ${aim}` : name) : aim && `${changed ? 'Next,' : 'Aim for'} ${aim}`;
  const said = [dart, call, ...rest, ...earned, next].filter(x => x !== '');
  if (said.length) say(said.join('. '));
  renderGame();
}
function undo() {
  // Undo is for the people playing: the computer's darts since go with the dart being undone
  // (it throws again when its turn comes back round).
  while (match.log.at(-1)?.src === 'bot') match.log.pop();
  const gone = match.log.pop();
  tracker.undone(match.id, gone?.t === 'dart' ? gone : undefined);  // a camera dart undone may be about to be put right
  // Whatever those darts earned goes with them: it is worked out again from the darts that are left.
  dropSlips();
  forgetEnded(match.id);
  dropPictures();
  store.set('match', match);
  queueSync();
  renderGame();
}

// ---------- achievements (achievements.js) ----------
// None is stored: what a player holds is worked out from their games. For the game in progress the
// app keeps each person's total as it stood when the game began, and after every dart asks what
// the game has added to it. Whatever is new is shown on a slip, and called.
let bases = null;   // {id: the match's, of: [a total per seat: null for the computer, and while there is no history to go on]}
let slips = [];     // earned and not yet shown: [{seat, top, also, at: the log's length when it was earned, since}]
let slipTimer = 0;
const SLIP_MS = 6000;
const endedGames = [];  // games ended on this device since it was opened, as [{sheet, ids}]: the kept stats may not have them yet
export const achievementsOn = () => settings.achievements !== false;
const people = m => m.playerIds.filter((_, i) => m.bots?.[i] == null).length;
// Where in a game's visits the one still being thrown is, or -1 between visits: a visit's total is judged when it is over.
const openVisit = (s, sheet) => s.winner == null && s.turn.length && !s.turnOver ? sheet.visits.length - 1 : -1;
function forgetEnded(id) {
  const i = endedGames.findIndex(g => g.sheet.id === id);
  if (i >= 0) endedGames.splice(i, 1);
}
// After Undo: the slips for darts no longer in the game.
function dropSlips() { slips = slips.filter(s => s.at <= match.log.length); }
function endedHere() {
  forgetEnded(match.id);
  endedGames.push({ sheet: matchSheet(match), ids: match.playerIds });
  if (endedGames.length > 20) endedGames.shift();
}
// A player's games that are on this device and may not be in their history yet, as [{sheet, me}].
export function gamesHere(id) {
  const seen = new Set();
  return [...data.waitingSheets(), ...endedGames]
    .filter(g => g.ids?.includes(id) && !seen.has(g.sheet.id) && seen.add(g.sheet.id))
    .map(g => ({ sheet: g.sheet, me: g.ids.indexOf(id) }));
}
// Each person's total before this game, from the stats kept on this device (asked for again if the
// Pi answers quickly). Until it is here, and for anyone with nothing to go on, nothing is shown:
// better no slip than a "first" for something they already hold.
async function loadBases() {
  if (!match || bases?.id === match.id) return;
  const m = match, mine = bases = { id: m.id, of: m.playerIds.map(() => null) };
  slips = [];
  await Promise.all(m.playerIds.map(async (id, i) => {
    if (m.bots?.[i] != null) return;
    let history = [];  // a player made offline has no games anywhere but here
    if (id > 0) try { history = (await loadStats(statsPath(id), 2500)).matches ?? null; } catch { history = null; }
    if (bases === mine) mine.of[i] = standing(history, gamesHere(id), m.id);
  }));
}
// What the dart just entered earned everyone playing (a game that ends is a game finished for all
// of them). Each gets one slip, however many it was; the caller's words for them are returned.
// byCamera: the cameras scored it, so the darts are in the board: a picture of it is kept (see below).
function achieved(before, sheetBefore, after, byCamera) {
  const sheet = matchSheet(match), said = [], shown = slips.length;
  const openBefore = openVisit(before, sheetBefore), openAfter = openVisit(after, sheet);
  match.playerIds.forEach((id, i) => {
    const fresh = earnedBy(bases.of[i], sheetBefore, openBefore, sheet, openAfter, i);
    if (!fresh.length) return;
    const top = chief(fresh);
    slips.push({ seat: i, top, also: fresh.filter(a => a !== top), at: match.log.length });
    said.push(people(match) > 1 ? `${after.players[i]}, ${top.name}` : top.name);
  });
  if (byCamera && slips.length > shown) {
    const on = photosOn();
    if (on) keepPicture(slips.slice(shown), match.id, sheet.visits.length - 1, match.log.length);
    else if (on === null) photoAsk = true;  // asked when the game is over, never mid-visit
  }
  return said;
}

// A picture of the board with an achievement (server/photos.py): taken when the cameras scored the
// dart that earned it, kept with the game under where in the game's visits that dart was, and
// thrown away with the game or when the dart is undone. It is on from the start at home. Where it
// would leave the room (the hosted site) or the phone (its own camera scoring) the player is asked
// first, once: until then photosOn() is null and none is taken.
const PHOTO_WIDE = 1280, PHOTO_MOST = 400000, PHOTO_WAIT = 2000;
export const photoUrl = (id, visit) => `/api/matches/${id}/photos/${visit}`;
export const photosOn = () => settings.photos ?? (account.hosted || phone.scoring() ? null : true);
const taken = new Map();  // pictures kept in this game: its address -> the log's length when it was taken
let photoAsk = false;     // a picture would have been kept, had they been asked
let photoBox = null;      // the question, while it is on screen
async function jpegOf(source, w, h) {
  const k = Math.min(1, PHOTO_WIDE / w);
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.8, 0.6, 0.4]) {
    const blob = await new Promise(done => canvas.toBlob(done, 'image/jpeg', quality));
    if (blob && blob.size <= PHOTO_MOST) return blob;
  }
  return null;
}
// The board as one camera sees it now: this phone's own if it is the one scoring, otherwise the
// first of the cameras by the board that is lined up.
async function boardPicture() {
  const video = phone.video();
  if (video) return jpegOf(video, video.videoWidth, video.videoHeight);
  const status = await api('/status', 'GET', undefined, PHOTO_WAIT);
  const cam = status.cameras.find(c => c.ok && c.points) ?? status.cameras.find(c => c.ok);
  if (!cam) return null;
  const r = await fetch(`/api/cameras/${cam.id}/snapshot.jpg?t=${Date.now()}`, { signal: AbortSignal.timeout?.(PHOTO_WAIT) });
  if (!r.ok) return null;
  const picture = await createImageBitmap(await r.blob());
  return jpegOf(picture, picture.width, picture.height);
}
// Never in the way of the game: if the camera or the Pi doesn't answer, there is no picture.
async function keepPicture(forSlips, id, visit, at) {
  try {
    const blob = await boardPicture();
    if (!blob || match?.id !== id || match.log.length < at) return;  // (undone meanwhile)
    for (let tries = 0; tries < 2; tries++) {
      const r = await fetch(photoUrl(id, visit), { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      if (r.ok) {
        taken.set(photoUrl(id, visit), at);
        if (match?.id === id && match.log.length < at) return dropPictures();  // undone while it was on its way
        for (const s of forSlips) s.photo = `${photoUrl(id, visit)}?t=${at}`;
        if (screen === 'game' && forSlips.includes(slips[0])) renderGame();
        return;
      }
      if (r.status !== 404) return;
      await new Promise(done => setTimeout(done, 1500));  // the game itself may not have reached the Pi yet
    }
  } catch { /* no picture */ }
}
// After Undo: the pictures taken of darts that are no longer in the game.
function dropPictures() {
  for (const [url, at] of taken) if (!url.startsWith(photoUrl(match.id, '')) || at > match.log.length) {
    if (url.startsWith(photoUrl(match.id, ''))) fetch(url, { method: 'DELETE' }).catch(() => {});
    taken.delete(url);
  }
}
function askPhotos() {
  if (photoBox) return;
  photoBox = document.body.appendChild(document.createElement('div'));
  photoBox.className = 'report shareask photoask';
  photoBox.innerHTML = `<div class="report-in">
    <h1>Keep a picture with your achievements?</h1>
    <p class="muted">When your camera scores a dart that earns an achievement, the app can keep that picture of the board,
      darts and all, to look back at. It is kept with your games${account.hosted ? ' on the site' : ''} and nowhere else, and is
      deleted with the game. You can change this under Settings › In a game.</p>
    <div class="row"><button class="primary" data-keepphotos="yes">Keep pictures</button>
      <button data-keepphotos="no">No thanks</button></div></div>`;
  photoBox.querySelector('.primary').focus();
}
document.addEventListener('click', e => {
  const answer = e.target.closest('.photoask [data-keepphotos]')?.dataset.keepphotos;
  if (!answer) return;
  photoBox?.remove(); photoBox = null; photoAsk = false;
  settings.photos = answer === 'yes';
  saveSettings();
});
// A picture that isn't there (none was taken, or its game was thrown away) leaves no gap.
document.addEventListener('error', e => { if (e.target.matches?.('img.shot')) e.target.remove(); }, true);
// An achievement's badge: a round pin with its mark lettered on it, as a league's 180 badge is.
// Not held: the outline only. blank: one kept as a surprise.
export function badge(a, size = 44, has = true, blank = false) {
  const m = blank ? '?' : a.mark, fs = m.length >= 4 ? 13 : m.length === 3 ? 16 : 20;
  return `<svg class="pin${has ? '' : ' not'}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="21"/><circle class="in" cx="24" cy="24" r="17"/>
    <text x="24" y="24.5" text-anchor="middle" dominant-baseline="central" font-size="${fs}">${esc(m)}</text></svg>`;
}
// The slip on show, in the game's own column where a bust is shown, so it covers nothing.
// It goes by itself; a tap sends it sooner.
function slipHtml() {
  const s = achievementsOn() ? slips[0] : null;
  if (!s) return '';
  const fresh = !s.since;
  if (fresh) {
    s.since = Date.now();
    clearTimeout(slipTimer);
    slipTimer = setTimeout(() => { slips.shift(); if (screen === 'game' && match) renderGame(); }, SLIP_MS);
  }
  return `<div class="banner slip${fresh ? ' new' : ''}" role="status" data-slip>${badge(s.top, 48)}
    <span><b>${people(match) > 1 ? `${esc(match.players[s.seat])} · ` : ''}${esc(s.top.name)}</b><small>${esc(s.top.how)}</small>
    ${s.also.length ? `<small>Also: ${s.also.map(a => esc(a.name)).join(', ')}</small>` : ''}</span>
    ${s.photo ? `<img class="shot" src="${s.photo}" alt="The board">` : ''}</div>`;
}
// During a game a tap only closes it. Once the game is over it opens that player's achievements.
function slipTapped() {
  const s = slips.shift();
  clearTimeout(slipTimer);
  if (s && compute(match).winner != null && players.some(p => p.id === match.playerIds[s.seat])) {
    statsView.game = statsView.darts = null;
    statsView.tab = 'achievements';
    statsView.drill = [];
    renderPlayers(match.playerIds[s.seat]);
    return mark(true);
  }
  renderGame();
}
// Under the result: everything earned in this game, for whoever was at the oche when a slip showed.
function earnedLine() {
  if (!achievementsOn() || bases?.id !== match.id) return '';
  const sheet = matchSheet(match), named = people(match) > 1;
  const lines = match.playerIds.flatMap((id, i) => !bases.of[i] ? []
    : newly(held(bases.of[i]), held(add(bases.of[i], gameTally(sheet, i))))
      .map(a => `${named ? `${esc(match.players[i])}, ` : ''}<b>${esc(a.name)}</b>`));
  return lines.length ? `<div class="earned">Achievements this game: ${lines.join(' · ')}</div>` : '';
}

// Quit the game in progress, once the player has said they are sure. Its results
// are saved unless they untick the box: the darts thrown so far stay in the stats,
// as an unfinished game. Unticked (or with nothing thrown yet), nothing from it is
// kept, here or on the Pi.
let quitAsk = null;  // the question, while it is on screen
const thrown = m => m.log.some(e => e.t === 'dart' || e.t === 'visit');
function askQuit() {
  closeQuit();
  quitAsk = document.body.appendChild(document.createElement('div'));
  quitAsk.className = 'report shareask quitask';
  quitAsk.innerHTML = `<div class="report-in">
    <h1>Are you sure?</h1>
    <p class="muted">This game ends here and can't be picked up again.</p>
    ${thrown(match) ? `<label class="tick"><input type="checkbox" checked> Save your results?</label>
      <p class="muted small">Saved, the darts thrown in this game count in your stats. Unticked, the game is thrown away, darts and all.</p>` : ''}
    <div class="row"><button class="danger" data-quit="yes">Quit game</button>
      <button class="primary" data-quit="no">Keep playing</button></div></div>`;
  quitAsk.querySelector('.primary').focus();
}
function closeQuit() { quitAsk?.remove(); quitAsk = null; }
document.addEventListener('click', e => {
  const answer = e.target.closest('.quitask [data-quit]')?.dataset.quit;
  if (!answer) return;
  const save = !!quitAsk.querySelector('input')?.checked;
  closeQuit();
  if (answer === 'yes' && match) quitGame(save);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQuit(); });
function quitGame(save) {
  if (save) data.saveMatch(match);  // as it stands: every dart of it is already queued
  else data.quitMatch(match);
  match = null;
  store.set('match', null);
  padValue = ''; padAsk = null; padError = '';
  data.sync();
  goHome();
}

// ---------- addresses and the back button ----------
// Each screen has an address, so the browser's (or the phone's) back button
// goes back a screen instead of out of the app, and a reload stays put:
//   #/                 the menu
//   #/501/<match id>   one game: being played if it is the one in progress,
//                      otherwise its scoresheet. The first part only says what
//                      kind of game it is (an X01 game by its start score, the
//                      others by their id); the match id alone finds the game.
//   #/stats  #/cameras  #/settings
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
    Object.assign(at, { statsFor: statsView.player, statsGame: statsView.game, statsDarts: statsView.darts, statsTab: statsView.tab, drill: statsView.drill });
    // A scoresheet reached through the stats has the game's own address too.
    const top = statsView.drill.at(-1), m = top?.v === 'match' && statsData && deep(statsData).matches.find(m => m.id === top.id);
    url = m ? gameUrl(m.game, m.opts, m.id) : '#/stats';
  }
  if (screen === 'settings') { Object.assign(at, { settingsTab: settingsView.tab, settingsOpen: settingsView.open, fromList: settingsView.fromList }); url = '#/settings'; }
  if (screen === 'cameras') url = '#/cameras';
  return [at, '', url];
}
// Note where the app is now: as a new history entry (push), or in place of the current one.
export function mark(push) {
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
    statsView.drill = (at.drill ?? []).map(level => ({ ...level }));
    return renderPlayers();
  }
  // (the cameras were once a tab of the settings: a history entry from then still finds them)
  if (at.screen === 'cameras' || (at.screen === 'settings' && at.settingsTab === 'cams')) return renderCameras();
  if (at.screen === 'settings') { settingsView.tab = at.settingsTab ?? settingsView.tab; settingsView.open = !!at.settingsOpen; settingsView.fromList = !!at.fromList; return renderSettings(); }
  return renderHome();
}
// The app's own Menu and Back buttons take the same steps as the browser's.
function goHome() {
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
function begin() {
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
function open(want) {
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

// With two or more playing, Start (and Play again) asks how to settle who throws first:
// a dart each at the bull (see renderBull), or at random. The last answer is kept
// (setup.first) and is the one lit the next time.
let firstAsk = null;  // the question, while it is on screen
function askFirst(act) {
  closeFirst();
  firstAsk = document.body.appendChild(document.createElement('div'));
  firstAsk.className = 'report shareask firstask';
  firstAsk.dataset.act = act;
  firstAsk.innerHTML = `<div class="report-in">
    <h1>Who throws first?</h1>
    <div class="row"><button class="${setup.first === 'random' ? '' : 'primary'}" data-first="bull">Closest to bull</button>
      <button class="${setup.first === 'random' ? 'primary' : ''}" data-first="random">Random</button>
      <button data-first="cancel">Cancel</button></div>
    <p class="muted small"><b>Closest to bull:</b> everyone throws one dart at the bull, taking it out before the next player throws.
      The nearest throws first and the rest follow, nearest first.<br><b>Random:</b> one of you is picked to throw first,
      and the rest follow in the order they were picked on the menu.</p></div>`;
  firstAsk.querySelector('.primary').focus();
}
function closeFirst() { firstAsk?.remove(); firstAsk = null; }
document.addEventListener('click', e => {
  const first = e.target.closest('.firstask [data-first]')?.dataset.first;
  if (!first) return;
  const act = firstAsk.dataset.act;
  closeFirst();
  if (first === 'cancel') return;
  setup.first = first;
  saveSetup();
  if (first === 'bull') return openBull(act);
  startMatch(act, randomOrder());
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFirst(); });

// Throwing for the bull: the players throw one dart each, in the order they were picked,
// on the board (tapped, or seen by the cameras) and the game then starts in the order
// that gives (bullUp in board.js has the rules). It has no address of its own: going back
// leaves it, for the menu or the game just finished.
let bull = null;  // {act: 'start' or 'rematch', ids: the players, darts: each dart thrown, timer: the game about to start}
const BULL_PAUSE = 4000;  // ms the result stays up before the game starts by itself
function openBull(act) {
  bull = { act, ids: seats(), darts: [], timer: 0, botTimer: 0 };
  say(`Closest to the bull. ${nameOf(bull.ids[0])} to throw`);
  renderBull();
}
function closeBull() {
  if (!bull) return;
  clearTimeout(bull.timer);
  clearTimeout(bull.botTimer);
  const { act } = bull;
  bull = null;
  if (screen !== 'bull') return;
  if (act === 'rematch' && match) renderGame(); else renderHome();
}
// Left by Back: no game starts from it.
function dropBull() { if (bull) { clearTimeout(bull.timer); bull = null; } }
// "Random instead": the game starts at once, in a random order.
function bullRandom() { const { act } = bull; clearTimeout(bull.timer); bull = null; return startMatch(act, randomOrder()); }
// bot: the dart is the computer's own. While it is the computer's throw, no other dart counts.
function bullDart(d, bot = false) {
  const now = bullUp(bull.ids, bull.darts);
  if (now.order) return;  // settled: a dart now is not part of it
  if ((now.next === BOT) !== bot) return;
  bull.darts.push(bot ? { ...d, bot } : d);
  const b = bullUp(bull.ids, bull.darts);
  if (b.order) {
    say(`${nameOf(b.order[0])} is closest`);
    bull.timer = setTimeout(bullStart, BULL_PAUSE);
  } else if (b.again && !b.thrown) say(`Level. ${b.round.map(nameOf).join(' and ')} throw again. ${nameOf(b.next)} to throw`);
  else say(`${nameOf(b.next)} to throw`);
  renderBull();
}
function bullStart() {
  if (screen !== 'bull' || !bull) return;
  const { act, ids, darts } = bull, { order } = bullUp(ids, darts);
  if (!order) return;
  clearTimeout(bull.timer);
  bull = null;
  startMatch(act, order);
}
// The computer's dart at the bull, a moment after its turn comes.
function bullBot() {
  const mine = bull;
  clearTimeout(mine.botTimer);
  if (bullUp(mine.ids, mine.darts).next !== BOT) return;
  mine.botTimer = setTimeout(() => {
    if (bull === mine && screen === 'bull') bullDart(throwAt({ seg: 25, mult: 2 }, botAt().finish), true);
  }, BOT_WAIT);
}
const nth = n => `${n}${['th', 'st', 'nd', 'rd'][n % 10 < 4 && (n % 100 - n % 10 !== 10) ? n % 10 : 0]}`;
function renderBull() {
  if (screen !== 'bull' || !document.querySelector('.bullup')) {
    screen = 'bull';
    $app.innerHTML = `<div class="game bullup"><div class="side"></div><div class="boardwrap"><svg id="board"></svg></div></div>`;
    boardUI = buildBoard(document.getElementById('board'), d => bullDart(d));
  }
  const b = bullUp(bull.ids, bull.darts), name = id => esc(nameOf(id));
  const far = d => !d ? '–' : d.seg === 25 ? label(d) : bullMm(d) === Infinity ? 'Miss' : `${bullMm(d)}<small> mm</small>`;
  const place = id => {
    const at = (b.order ?? [...b.round, ...b.tail]).indexOf(id);
    if (b.order || !b.round.includes(id)) return `throws ${nth(at + 1)}`;
    if (id === b.next) return b.again ? 'to throw again' : 'to throw';
    return b.round.indexOf(id) < b.thrown ? 'thrown' : b.again ? 'level: throws again' : '';
  };
  const banner = b.order ? `<div class="banner win">${name(b.order[0])} is closest and throws first</div>`
    : `<div class="banner">${b.again && !b.thrown ? `Level! ${b.round.map(name).join(' and ')} throw again. ` : ''}${
      name(b.next)}: one dart at the bull${bull.darts.length ? ', once the last dart is out' : ''}</div>`;
  document.querySelector('.side').innerHTML = `
    <div class="top"><button class="ghost" data-act="bull-cancel">‹ Back</button><b>Closest to the bull</b>
      <span class="spacer"></span><span class="conn brief muted"></span></div>
    <div class="players">${bull.ids.map(id => `<div class="pcard ${b.order?.[0] === id ? 'win' : id === b.next ? 'cur' : ''}">
      <div class="name">${name(id)}</div><div class="big">${far(b.last[id])}</div><div class="small">${place(id)}</div></div>`).join('')}</div>
    ${banner}
    <div class="actions">
      <button data-act="bull-undo" ${bull.darts.length ? '' : 'disabled'}>Undo</button>
      <button data-act="bull-random">Random instead</button>
      <button class="primary" data-act="bull-start" ${b.order ? '' : 'disabled'}>Start game</button>
    </div>`;
  // the darts of the round being thrown stay marked, though they are out of the board
  boardUI.showDarts(b.thrown ? bull.darts.slice(-b.thrown) : bull.darts.slice(-b.round.length));
  boardUI.showTarget(null);
  refreshStatus();
  fit();
  bullBot();
}
// A new game with the players chosen, throwing in `order` (as picked, when there is none): from Start on the
// menu, or "Play again" at the end of a game (which takes that game's place in the history).
function startMatch(act, order) {
  cleanSetup();
  if (!seats().some(id => id !== BOT)) return renderHome();
  // (the order settled a moment ago, less anyone removed since, on another device say)
  // The computer takes its seat as the player its level's games are kept under.
  const level = botAt().level;
  const ids = (order ? order.filter(id => seats().includes(id)) : seats())
    .map(id => id === BOT ? botPlayer(level) : id).filter(id => id != null);
  match = {
    ...newMatch(setup.gameId, ids.map(nameOf), startOpts()),
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    playerIds: ids, darts: ids.map(dartsFor), bots: ids.map(id => bots.find(b => b.id === id)?.bot ?? null), seq: 0,
  };
  store.set('match', match);
  const opening = compute(match), aim = gameById(match.gameId).aim?.(opening);  // the first thing to aim at (Random Targets, Around the Clock)
  const who = opening.players.length > 1 ? opening.players[opening.current] : '';  // who throws first, when there is more than one
  const opener = aim ? (who ? `${who}, aim for ${aim}` : `Aim for ${aim}`) : who && `${who} to throw first`;
  say(opener ? `Game on. ${opener}` : 'Game on');
  renderGame();
  mark(act === 'start');
}
// ---------- number entry ----------
// Instead of tapping each dart on the board, the whole visit can be typed in
// as one number (games with visit() only: X01, Count Up and 121 Checkout).
let padValue = '';
let padAsk = null;
let padError = '';
const usingPad = game => !!game.visit && settings.entry === 'pad';
function padKey(key) {
  if (botUp()) return;
  padError = '';
  if (key === 'back') padValue = padValue.slice(0, -1);
  else if (key === 'enter') return padEnter();
  else if (padValue.length < 3) padValue = String(+(padValue + key));
  renderGame();
}
function padEnter() {
  const game = gameById(match.gameId), s = compute(match), total = +padValue;
  const finish = game.visitDarts?.(s, total);  // null unless this total wins the leg
  if (total > 180) padError = '180 is the most three darts can score';
  else if (finish && !finish.length) padError = `${total} can't be finished from here`;
  else if (finish && finish.length > 1) padAsk = { total, darts: finish };
  else return padCommit(total, finish ? finish[0] : 3);
  renderGame();
}
function padCommit(total, darts) {
  padValue = ''; padAsk = null; padError = '';
  push({ t: 'visit', total, darts });
}
function padHtml(s) {
  const midVisit = s.turn.length && !s.turnOver;
  const bot = botUp(s);
  const msg = padError || (bot ? `${esc(s.players[s.current])} is throwing` : midVisit ? 'Finish this visit on the board, or undo those darts'
    : padAsk ? `${padAsk.total} to finish. How many darts?`
    : s.legWon ? `${esc(s.players[s.legWon.player])} won the ${s.legWon.set ? 'set' : 'leg'}`
    : s.lastVisit ? `${esc(s.players[s.lastVisit.player])} scored ${s.lastVisit.total}` : 'Type the visit total');
  const off = bot || midVisit || s.winner != null ? 'disabled' : '';
  const keys = padAsk
    ? padAsk.darts.map(n => `<button class="primary" data-fin="${n}">${n} dart${n > 1 ? 's' : ''}</button>`).join('')
      + '<button class="wide" data-key="cancel">Cancel</button>'
    : [7, 8, 9, 4, 5, 6, 1, 2, 3].map(n => `<button data-key="${n}" ${off}>${n}</button>`).join('')
      + `<button data-key="back" ${off} aria-label="Delete">⌫</button><button data-key="0" ${off}>0</button>
         <button class="primary" data-key="enter" ${off}>Enter</button>`;
  return `<div class="pad-out ${padError ? 'bad' : ''}">${padAsk ? padAsk.total : padValue || '0'}</div>
    <div class="pad-msg ${padError ? 'warn' : ''}">${msg}</div><div class="pad-keys">${keys}</div>`;
}

// ---------- TV view ----------
// Another way to see a game (games with tv() only: X01), for one or two
// players: the board gets the screen and the scores go in one scoreboard along
// the bottom, a line per player, the way a match is shown on television.
const canTv = (game, s) => !!game.tv && s.players.length <= 2;
const usingTv = (game, s) => canTv(game, s) && settings.view === 'tv';
function tvHtml(game, s) {
  const rows = s.players.map((p, i) => ({ p, i, ...game.tv(s, i) }));
  const sets = rows[0].sets != null;
  return `<table class="tv"><thead><tr><th class="title">${esc(game.tvTitle(s))}</th>
    ${sets ? '<th>Sets</th>' : ''}<th>Legs</th><th>Score</th><td class="gap"></td>
    <th>100+</th><th>140+</th><th>180s</th><th>Average</th></tr></thead>
    ${rows.map(r => `<tr class="${s.winner === r.i ? 'win' : s.winner == null && r.i === s.current ? 'cur' : ''}">
      <td class="name">${esc(r.p)}</td>${sets ? `<td>${r.sets}</td>` : ''}<td>${r.legs}</td><td class="score">${r.score}</td>
      <td class="gap"></td><td>${r.t100}</td><td>${r.t140}</td><td>${r.t180}</td><td class="avg">${r.average}</td></tr>`).join('')}
  </table>`;
}

// ---------- game ----------
let boardUI = null;
// The darts a player is throwing in this game, said beside their name once they have more than one set.
function playingWith(i) {
  const set = match.darts?.[i], id = match.playerIds?.[i];
  return set && setsOf(id, true).length > 1 ? ` <span class="muted small">· ${esc(dartsName(set))}</span>` : '';
}
function renderGame() {
  if (account.locked) return renderLanding();
  menu.rulesOpen = false;  // the menu, when it is next seen, starts from its games
  if (screen !== 'game' || !document.querySelector('.game')) {
    screen = 'game';
    $app.innerHTML = `<div class="game"><div class="side"></div>
      <div class="boardwrap"><svg id="board"></svg><div class="pad"></div></div><div class="tvbar"></div></div>`;
    boardUI = buildBoard(document.getElementById('board'), d => { if (!botUp()) push({ t: 'dart', ...d, src: 'tap' }); });
  }
  const game = gameById(match.gameId);
  const s = compute(match);
  loadBases();  // (once a game: what everyone held before it)
  if (s.winner != null && photoAsk && photosOn() === null) askPhotos();
  const pad = usingPad(game);
  // The TV view: the player cards give way to one scoreboard along the bottom.
  const tv = usingTv(game, s);
  document.querySelector('.game').classList.toggle('tv', tv);
  const tvBar = document.querySelector('.tvbar');
  tvBar.toggleAttribute('hidden', !tv);
  tvBar.innerHTML = tv ? tvHtml(game, s) : '';
  document.getElementById('board').toggleAttribute('hidden', pad);
  const padBox = document.querySelector('.pad');
  padBox.toggleAttribute('hidden', !pad);
  padBox.innerHTML = pad ? padHtml(s) : '';
  // Play moves on with the third dart. The dart slots start again empty for the
  // new visit; the board keeps the old darts marked until the next one lands,
  // and the old visit is listed in small print under the slots.
  const shown = s.turn.length ? s.turn : s.lastVisit?.darts ?? s.turn;
  const total = s.turn.reduce((t, d) => t + value(d), 0);
  const slots = [0, 1, 2].map(i => s.turn[i]
    ? `<div class="slot">${label(s.turn[i])}</div>` : '<div class="slot empty">–</div>').join('');
  const prev = previousVisit(s);
  // A typed visit has no single darts to list (the number pad says what it scored).
  const last = prev && !prev.typed ? `<div class="lastvisit">Last ${prev.darts.length === 1 ? 'dart' : `${prev.darts.length} darts`}${
    s.players.length > 1 ? ` (${esc(s.players[prev.player])})` : ''}: <b>${prev.darts.map(label).join(' · ')}</b>${
    prev.bust ? ' <span class="warn">bust</span>'
      : game.showTotal === false ? '' : ` = ${prev.darts.reduce((t, d) => t + value(d), 0)}`}</div>` : '';
  let banner = '';
  if (s.winner != null) banner = `<div class="banner win">${esc(game.result?.(s) ?? `${s.players[s.winner]} wins!`)}</div>`;
  else if (s.legWon) banner = `<div class="banner win">${s.legWon.set ? 'Set' : 'Leg'} to ${esc(s.players[s.legWon.player])}!${
    s.players.length > 1 ? ` ${esc(s.players[s.current])} throws first` : ''}</div>`;
  else if (s.bust != null) banner = `<div class="banner bust">Bust!${s.players.length > 1
    ? ` ${esc(s.players[s.current])} to throw` : ''}</div>`;

  document.querySelector('.side').innerHTML = `
    <div class="top"><button class="ghost" data-act="home">‹ Menu</button><b>${game.name}</b>
      <span class="clock" title="Match time">${clock(elapsed(match, s))}</span>
      <span class="spacer"></span><span class="conn brief muted"></span>
      ${(connected && cameraCount > 0) || phone.scoring() ? '<button data-act="report" title="A dart was scored wrongly: save what the cameras saw">Report</button>' : ''}
      ${canTv(game, s) ? `<button data-act="tv">${tv ? 'Card view' : 'TV view'}</button>` : ''}
      ${game.visit ? `<button data-act="entry">${pad ? 'Use board' : 'Type scores'}</button>` : ''}
      ${s.winner == null ? `<button class="danger" data-act="quit">Quit game</button>` : ''}</div>
    ${tv ? '' : `<div class="players">${s.players.map((p, i) => {
      const v = game.summary(s, i);
      return `<div class="pcard ${s.winner === i ? 'win' : s.winner == null && i === s.current ? 'cur' : ''}${v.out ? ' out' : ''}">
        <div class="name">${esc(p)}${playingWith(i)}</div><div class="big">${v.big}</div><div class="small">${v.small}</div></div>`;
    }).join('')}</div>`}
    ${game.panel ? game.panel(s) : ''}
    ${pad && !s.turn.length ? '' : `<div class="turn">${slots}<div class="slot total ${s.note ? 'bust' : ''}">${s.note || (game.showTotal === false ? '' : total)}</div></div>`}
    ${last}
    ${game.hint ? `<div class="hint">${s.winner == null ? esc(game.hint(s, { checkouts: settings.checkouts !== false })) : ''}</div>` : ''}
    ${slipHtml()}
    ${banner}${s.winner != null ? earnedLine() : ''}
    ${botHolds(s) ? `<div class="botwait"><span>${esc(s.players[s.current])} throws in <b>${botHold?.at === match.log.length ? botHoldLeft() : botHoldSecs()}</b>s. Score wrong? Undo it now.</span>
      <button data-act="botgo">Throw now</button></div>` : ''}
    <div class="actions ${pad && s.winner == null ? 'solo' : ''}">
      <button data-act="undo" ${match.log.length ? '' : 'disabled'}>Undo</button>
      ${s.winner != null
        ? '<button data-act="home">Menu</button><button class="primary" data-act="rematch">Play again</button>'
        : pad ? '' : `<button data-act="miss" ${botUp(s) ? 'disabled' : ''}>Miss</button>
           <button class="${s.turnOver ? 'primary' : ''}" data-act="next" ${botUp(s) ? 'disabled' : ''}>Next player ›</button>`}
    </div>`;
  boardUI.showDarts(shown, 5, botFlight && settings.flight !== false && !pad);
  boardUI.showTarget(game.target?.(s) ?? null);
  refreshStatus();
  fit();
  botSoon();
}

// The match clock in the top bar ticks between renders.
setInterval(() => {
  const el = screen === 'game' && match && document.querySelector('.clock');
  if (el) el.textContent = clock(elapsed(match));
}, 1000);

// ---------- problem reports ----------
// A dart scored wrongly, or not seen at all: the Pi saves what its cameras saw
// over the last few darts and says what it made of them (server/report.py).
// It is asked for straight away, while the darts are still in the board; what
// really happened is typed in afterwards and added to the saved report.
// The report lies over the game, which carries on underneath.
let reportBox = null;
function closeReport() { reportBox?.remove(); reportBox = null; }
async function reportProblem() {
  closeReport();
  if (phone.scoring() && !(connected && cameraCount > 0)) {  // this phone's own camera: it makes and sends the report itself
    const s = compute(match);
    return phone.report({ match: match.id, game: match.gameId, opts: match.opts, players: s.players, throwing: s.current, log: match.log.slice(-9) });
  }
  const box = reportBox = document.body.appendChild(document.createElement('div'));
  box.className = 'report';
  const show = html => { box.innerHTML = `<div class="report-in">${html}</div>`; };
  show('<p class="muted">Saving what the cameras saw…</p>');
  const s = compute(match), prev = previousVisit(s);
  const named = d => ({ ...d, label: label(d) });
  let r;
  try {
    r = await api('/reports', 'POST', { app: {
      match: match.id, game: match.gameId, opts: match.opts, players: s.players, throwing: s.current,
      visit: s.turn.map(named),
      lastVisit: prev && !prev.typed ? { player: prev.player, bust: !!prev.bust, darts: prev.darts.map(named) } : null,
      log: match.log.slice(-9),
    } }, 30000);
  } catch (err) {
    if (reportBox !== box) return;
    return show(`<p class="warn">The report could not be saved: ${esc(err.status ? err.message : `${pi()} did not answer`)}.</p>
      <div class="row"><button data-rep="close">Close</button></div>`);
  }
  if (reportBox !== box) return;
  const part = p => `<h3>${esc(p.summary)}</h3><div class="pics">${Object.values(p.cameras).map((c, i) =>
    `<figure><img src="/api/reports/${r.id}/${c.seen}" alt=""><figcaption>${esc(p.lines[i])}</figcaption></figure>`).join('')}</div>`;
  show(`<div class="row"><h1>Report saved</h1><span class="spacer"></span><span class="muted">data/reports/${esc(r.id)}</span></div>
    <label>What should it have been? <input type="text" id="rep-expected" placeholder="T20, or: second dart not seen" autocomplete="off"></label>
    <label>Anything else? <input type="text" id="rep-note" placeholder="lights changed, dart hanging, hit another dart…" autocomplete="off"></label>
    <div class="row"><button class="primary" data-rep="save">Save and close</button><button data-rep="close">Close</button>
      <span class="warn" id="rep-error"></span></div>
    ${account.hosted || !share || share.paired ? '' : `<p class="muted">${share.on
      ? 'This report, with its pictures, is sent to Darts S.A.M once you save it here (or after two minutes).'
      : 'This report stays on this computer. To send reports to Darts S.A.M, switch on Settings → Sharing.'}</p>`}
    <p class="muted">Red is what changed in the picture, green is the board as the calibration has it, yellow the
      line of the dart, the cyan ring that camera's tip, and the magenta cross what was scored. Newest first.</p>
    ${r.looks.length ? '' : '<h3>The cameras have not seen anything change since they were started.</h3>'}
    ${[...r.looks].reverse().map(part).join('')}
    ${Object.keys(r.now.cameras).length ? part(r.now) : ''}`);
  box.dataset.id = r.id;
  tracker.track('report', { id: r.id, game: match.gameId });
  tracker.flush();
}
async function saveReport() {
  const val = id => reportBox.querySelector(id).value;
  try {
    await api(`/reports/${reportBox.dataset.id}`, 'PATCH', { expected: val('#rep-expected'), note: val('#rep-note') });
    closeReport();
  } catch {
    reportBox.querySelector('#rep-error').textContent = `Not saved: ${pi()} did not answer.`;
  }
}
document.addEventListener('click', e => {
  const rep = e.target.closest('.report [data-rep]')?.dataset.rep;
  if (rep === 'close') closeReport();
  if (rep === 'save') saveReport();
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.report input')) saveReport(); });

// ---------- the first time the desktop app is opened ----------
// After the question about sharing (askShare(), which lies over this until it
// is answered), one question to a screen: their name, which makes the first
// player, then whether they have a camera. With one they go on to choose which
// kind (the cameras' own first step); without, to the menu.
// The hosted site asks the second question only, of someone who has just signed
// up (signing up gave their name and made their player): with a camera they go
// on to connect the computer it is plugged into (hostedCameras()), and from
// there to the same choice of which kind. Until it is answered it is asked
// again each time the app is opened on this device. Signing up by email gives
// no name: then their name is asked first (nameDue), and the account and its
// player take it.
const welcomeDue = () => account.hosted && !!account.account && store.get('newcomer', null) === account.account.id;
const nameDue = () => account.hosted && !!account.account && store.get('unnamed', null) === account.account.id;
let welcomeName = '';  // their name, once given
let welcomeNote = '';  // why it was refused
let welcomeStep = '';  // '' their name, then 'camera'
export function renderWelcome() {
  screen = 'welcome';
  const hosted = welcomeDue();
  const step = !nameDue() && (hosted || welcomeStep === 'camera') ? `<b class="camlead">${hosted ? 'Welcome to Darts S.A.M' : 'Will you use a camera?'}</b>
    ${hosted ? '<p>Will you use a camera?</p>' : ''}
    <p class="dim">Darts S.A.M scores by itself with a camera pointed at the board.</p>
    ${welcomeNote ? `<p class="warn">${esc(welcomeNote)}</p>` : ''}
    <div class="camkinds">
      <button class="game-card" data-act="welcome-cam"><b>Yes, set one up</b></button>
      <button class="game-card" data-act="welcome-nocam"><b>No, I'll tap the board</b></button>
    </div>`
    : `<b class="camlead">Welcome to Darts S.A.M</b>
    <p class="dim"><label for="welcome-name">What's your name?</label></p>
    <div class="row camadd"><input type="text" id="welcome-name" maxlength="16" autocomplete="off" value="${esc(welcomeName)}">
      <button class="primary" data-act="welcome-name">Continue</button></div>
    ${welcomeNote ? `<p class="warn">${esc(welcomeNote)}</p>` : ''}`;
  $app.innerHTML = `<div class="page"><div class="camsetup fill">
    ${welcomeStep && !hosted ? '<div class="row"><button class="ghost" data-act="welcome-back">‹ Back</button></div>' : ''}
    <div class="camwizard">${step}</div></div></div>`;
  fit();
  if (!shareAsk) document.getElementById('welcome-name')?.focus();
}
function welcomeNamed() {
  welcomeName = document.getElementById('welcome-name').value.trim();
  welcomeNote = welcomeName ? '' : 'Type your name first.';
  if (welcomeName && nameDue()) return nameAccount();
  if (welcomeName) welcomeStep = 'camera';
  renderWelcome();
}
// Hosted, signed up by email: the account and its player take the name given.
async function nameAccount() {
  document.querySelector('[data-act="welcome-name"]').disabled = true;
  try {
    await account.rename(welcomeName, true);
  } catch (e) {
    welcomeNote = e.status ? e.message : 'Could not reach the site. Try again.';
    return renderWelcome();
  }
  store.set('unnamed', null);
  welcomeName = '';
  data.sync(true);  // their player's new name comes down
  begin();          // the camera question, or the cameras when they came by their link
}
function finishWelcome(camera) {
  if (welcomeDue()) store.set('newcomer', null);  // answered; their player came with the account (see synced())
  else try {
    const p = data.addPlayer(welcomeName);
    loadPlayers();
    setup.players = [p.id];  // ready to throw
    saveSetup();
  } catch (e) {
    welcomeNote = e.message;
    return renderWelcome();
  }
  if (!account.hosted) store.set('welcomed', { camera });
  // Which kind of camera is asked first, even when one (a laptop's own, say) has been found already.
  camScreen.adding = camScreen.first = camera; camScreen.step = camScreen.note = '';
  open({ screen: camera ? 'cameras' : 'home' });
}


// ---------- events ----------
$app.addEventListener('click', e => {
  const camview = e.target.closest('.camview');
  if (camview && e.target.tagName === 'IMG') return calibTap(+camview.dataset.cam, e.target, e);
  const b = e.target.closest('button, a[data-act], [data-drill], [data-sort], [data-sheet], [data-gear], [data-slip]');  // tiles and lines can be tapped too
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
  if (d.showcam) { camScreen.shown = +d.showcam; camScreen.adding = false; camScreen.calib = {}; camScreen.autoCal = null; camScreen.calibNote = camScreen.note = ''; camScreen.calibFailed = false; return renderCameras(); }
  if (d.key === 'cancel') { padAsk = null; padValue = ''; return renderGame(); }
  if (d.key) return padKey(d.key);
  if (d.fin) return padCommit(padAsk.total, +d.fin);
  if (d.theme) { settings.theme = d.theme; saveSettings(); applyTheme(); renderSettings(); return mark(); }
  if (d.checkouts) { settings.checkouts = d.checkouts === 'on'; saveSettings(); return renderSettings(); }
  if (d.achievements) { settings.achievements = d.achievements === 'on'; saveSettings(); return renderSettings(); }
  if (d.photos) { settings.photos = d.photos === 'on'; saveSettings(); return renderSettings(); }
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
    if (b.dataset.has) return autoCalibrate(id);
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
      if (seats().length > 1) return askFirst(d.act);
      return startMatch(d.act);
    case 'bull-cancel': return closeBull();
    case 'bull-undo':
      clearTimeout(bull.timer);
      while (bull.darts.at(-1)?.bot) bull.darts.pop();  // the computer's dart goes with the one before it
      bull.darts.pop();
      return renderBull();
    case 'bull-random': return bullRandom();
    case 'bull-start': return bullStart();
    case 'resume': renderGame(); return mark(true);
    case 'quit': return askQuit();
    case 'home': return goHome();
    case 'settings': settingsView.open = settingsView.fromList = false; renderSettings(); return mark(true);
    case 'cameras': camScreen.adding = false; camScreen.step = camScreen.note = ''; renderCameras(); return mark(true);
    case 'camadd': camScreen.adding = true; camScreen.first = false; camScreen.step = camScreen.note = ''; return renderCameras();
    case 'camadd-done': camScreen.adding = false; camScreen.step = camScreen.note = ''; return renderCameras();
    case 'cam-step': camScreen.step = camScreen.note = ''; return renderCameras();
    case 'cam-usb': return usbChosen();
    case 'welcome-name': return welcomeNamed();
    case 'welcome-back': welcomeStep = welcomeNote = ''; return renderWelcome();
    case 'welcome-cam': return finishWelcome(true);
    case 'welcome-nocam': return finishWelcome(false);
    case 'cam-phone': camScreen.step = 'phone'; camScreen.note = ''; renderCameras().then(() => document.getElementById('cam-address')?.focus()); return;
    case 'undo': padValue = ''; padAsk = null; padError = ''; return undo();
    case 'entry':
      settings.entry = settings.entry === 'pad' ? 'board' : 'pad';
      padValue = ''; padAsk = null; padError = '';
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
  const choose = e.target.dataset?.choose;
  if (!choose) return;
  statsView.drill = [];
  if (choose === 'game') statsView.game = e.target.value || null;
  if (choose === 'darts') statsView.darts = e.target.value || null;
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
  if (e.target.id === 'dname' || e.target.id === 'dgrams') e.target.closest('.pform').querySelector('.primary').click();
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
