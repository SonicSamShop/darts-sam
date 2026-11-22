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

const $app = document.getElementById('app');
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
const phone = createPhoneUi({ onEvent: onBoardEvent, onChange: refreshStatus, store,
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
const Pi = () => account.hosted ? 'The server' : 'The Pi';

let match = store.get('match', null);
// The people who play: [{id, name}]. The computer's players are kept apart, so that no list of
// players has them in it: [{id, name, bot: its level}] (see "computer players" below).
let players = [], bots = [];
function loadPlayers() {
  const all = store.get('players', []);
  players = all.filter(p => !p.bot);
  bots = all.filter(p => p.bot);
}
loadPlayers();
let darts = store.get('darts', []);  // every player's sets of darts: [{id, player, name, grams, created, retired}]
// players: ids in throwing order. darts: {player id: the set of darts they are throwing}
let setup = store.get('setup', { gameId: 'x01', players: [], opts: {} });
// Sound starts off; once on, the visit's total is called, and each dart only if asked for.
let settings = store.get('settings', { voice: false });
// A phone or a tablet (anything held upright, narrow or worked by touch), as style.css has it:
// tabs along the bottom, and the settings as a list that opens a section at a time instead of tabs.
const STACKED = matchMedia('(orientation: portrait), (max-width: 800px), (pointer: coarse)');
// A tablet on its side has the room for both: the list down the left, the section beside it.
const SPLIT = matchMedia('(pointer: coarse) and (orientation: landscape) and (min-width: 900px)');
const listShown = () => STACKED.matches && (SPLIT.matches || !settingsOpen);  // is the settings' list on screen?
const sectShown = id => settingsTab === id && (!STACKED.matches || SPLIT.matches || settingsOpen);  // and this section of them?
let totals = store.get('totals', null);  // {darts, reports}: everything on the Pi, as it last said
let formError = '';   // shown under the "new player" box
let addingPlayer = false;  // home: the "new player" box is out of sight until asked for
// home, on a phone: the step that is open ('game', 'options' or 'players'), or null for none.
// Not chosen yet (undefined): none when somebody is down to play, so the menu opens as three
// lines and Start, and otherwise the players.
let homeStep;
let stepMoved = false;  // a step has just been opened: bring it into view
export let screen = match ? 'game' : 'home';
const MAX_PLAYERS = 6;

// ---------- themes ----------
// Each theme is a block of rules in themes.css under a .t-<id> class on <html>.
// The first is the one anybody who has not chosen gets (theme.js and manifest.json say the same).
const THEMES = [
  { id: 'chalk', name: 'Chalk & Oche', blurb: 'The pub chalkboard beside the board.', bar: '#2b1b11' },
  { id: 'stage', name: 'Stage Night', blurb: 'Big-stage TV graphics under a spotlight.', bar: '#0a0a0c' },
  { id: 'arcade', name: 'Soft-tip Arcade', blurb: 'Glowing displays and chunky buttons.', bar: '#1b1b1f' },
  { id: 'sheet', name: 'League Scoresheet', blurb: 'A printed league-night scoresheet. Light.', bar: '#eadfc4' },
  { id: 'classic', name: 'Classic', blurb: 'Plain and dark, in the board\'s own colours.', bar: '#111111' },
];
function applyTheme() {
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
const BOT = 0;  // (no player has this id: the Pi's start at 1, and one made offline is below zero)
const botAt = () => botLevel(setup.bot ?? 5);
const botsPlay = () => !!gameById(setup.gameId)?.bot;
// Who is down to play, in throwing order: the computer only in a game it can play.
const seats = () => (setup.players ?? []).filter(id => id !== BOT || botsPlay());
const nameOf = id => id === BOT ? `Bot ${botAt().level}` : (players.find(p => p.id === id) ?? bots.find(p => p.id === id))?.name ?? '?';
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
const BOT_WAIT = 2200, BOT_PACE = 1200;
const BOT_HOLD_MAX = 30, BOT_HOLD_USUAL = 8;  // seconds
function botHoldSecs() {
  const n = Math.round(Number(settings.botHold ?? BOT_HOLD_USUAL));
  return Number.isFinite(n) ? Math.min(BOT_HOLD_MAX, Math.max(0, n)) : BOT_HOLD_USUAL;
}
let botTimer = 0, botTick = 0;
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
const setsOf = (id, all = false) => darts.filter(d => d.player === id && (all || !d.retired));
const dartsName = id => darts.find(d => d.id === id)?.name ?? '?';
// The set a player is throwing: the one last chosen, or their first if that one is put away.
function dartsFor(id) {
  const mine = setsOf(id), chosen = setup.darts?.[id];
  return mine.some(d => d.id === chosen) ? chosen : mine[0]?.id ?? null;
}
const grams = g => g == null ? '' : `${+g.toFixed(1)}g`;

function cleanSetup() {
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
function saveSetup() { data.saveSetting('setup', setup); data.sync(); }
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
  for (const [old, id] of remapped) if (statsFor === old) statsFor = id;
  cleanSetup();
  // Someone who has just signed up has one player, themselves: ready to throw.
  if (newcomer && pulled && players.length === 1) {
    newcomer = false;
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
function redraw(draw) {
  const at = document.activeElement?.id, typed = at && document.activeElement.value;
  draw();
  const input = at && document.getElementById(at);
  if (input) { input.value = typed; input.focus(); }
}

// Stats are worked out on the Pi. Each answer is kept on this device, so the
// last known stats can still be shown when the Pi can't be reached.
const shelf = () => window.caches ? caches.open('dartssam-data') : Promise.reject();
const statsPath = (id, game, set) => `/players/${id}/stats${
  game || set ? `?${new URLSearchParams({ ...(game && { game }), ...(set && { darts: set }) })}` : ''}`;
async function freshStats(path, timeout) {
  const fresh = await api(path, 'GET', undefined, timeout);
  shelf().then(c => c.put('/api' + path, new Response(JSON.stringify({ ...fresh, saved: Date.now() })))).catch(() => {});
  return fresh;
}
async function loadStats(path, timeout) {
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

let connected = false;
export let cameraCount = 0;
let helperLinked = false;  // hosted: the person's cameras' computer is connected to the site

// ---------- new versions ----------
// When the app's files on the Pi change while the app is open, it reloads onto
// them, but never under a game: only on the menu, with no game in progress.
const updater = createUpdater({
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
let appBuild = null;  // {release, build, commit}: which code the server is running (server/build.py)
// The version this page's own files came with (from the saved copy when that is what loaded).
if (location.host) fetch('version.json').then(r => r.ok ? r.json() : null)
  .then(v => { appVersion = v?.version ?? null; appBuild = v?.release ? v : null; updater.running(v?.version); }).catch(() => {});

// ---------- a newer desktop app (server/release.py) ----------
// The desktop app asks the site once, when it starts, whether there is a newer
// version. If there is, this offers it with what has changed since this one.
// The Pi and the hosted version never have one to offer.
let release = null;  // {version, checked, available, download, page} from the server at home
let releaseAsk = null, releaseDismissed = false;
async function loadRelease(tries = 0) {
  try { release = await api('/update', 'GET', undefined, 4000); } catch { return; }  // a Pi from before this
  if (screen === 'settings') renderSettings();  // the version shows there
  if (!release.checked && tries < 8) return setTimeout(() => loadRelease(tries + 1), 2500);
  if (release.available && !releaseDismissed && !(screen === 'game' && match)) showRelease();
}
// Where anybody using the app can get its source (the AGPL asks for this).
const SOURCE = 'https://github.com/SonicSamShop/darts-sam';
// Settings → About: "Darts S.A.M version 1.2 (build 61, a140399)", and where the source is.
const appRelease = () => appBuild?.release ?? release?.version ?? '';
function aboutPanel() {
  const v = appRelease();
  const extra = [appBuild?.build != null && `build ${appBuild.build}`, appBuild?.commit].filter(Boolean).join(', ');
  return `<div class="settings">
    ${v ? `<p>Darts S.A.M version ${esc(v)}${extra ? ` <span class="muted">(${esc(extra)})</span>` : ''}</p>` : ''}
    <p class="muted small">Free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0</a>:
      <a href="${SOURCE}" target="_blank" rel="noopener">source code</a>.</p>
    <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p></div>`;
}
const MB = n => `${Math.round(n / 1e6)} MB`;
function releaseDone(d) {
  if (d.next === 'quit') return navigator.platform.startsWith('Mac')
    ? 'Downloaded. It is opening now: drag Darts S.A.M into Applications (choose Replace), then open it again. This one closes by itself.'
    : 'Downloaded. The new version is starting, and this one closes by itself.';
  return `Downloaded to ${esc(d.path)}. Unpack it and run <b>install.sh</b> in it, as the first time, then start Darts S.A.M again.`;
}
function showRelease() {
  const a = release.available, d = release.download || {};
  releaseAsk ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'report shareask releaseask' }));
  const busy = d.state === 'downloading' || d.state === 'ready';
  releaseAsk.innerHTML = `<div class="report-in">
    <h1>Darts S.A.M ${esc(a.version)} is ready</h1>
    <p class="muted">You have version ${esc(release.version)}.${a.size ? ` The download is ${MB(a.size)}.` : ''}</p>
    ${a.changes.map(v => `<h3>What's new in ${esc(v.version)}</h3>
      <ul>${v.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`).join('') || '<p>Fixes and improvements.</p>'}
    ${d.state === 'downloading' ? `<p>Downloading… ${d.total ? `${Math.floor(100 * d.done / d.total)}%` : MB(d.done)}</p>` : ''}
    ${d.state === 'ready' ? `<p>${releaseDone(d)}</p>` : ''}
    ${d.state === 'failed' ? `<p class="warn">The download didn't work (${esc(d.error || 'no answer')}).
      You can get the new version from ${release.page ? `<a href="${esc(release.page)}" target="_blank" rel="noopener">${esc(release.page)}</a>` : 'the Darts S.A.M site'} instead.</p>` : ''}
    <div class="row">${busy ? '' : `<button class="primary" data-release="update">${d.state === 'failed' ? 'Try again' : 'Update'}</button>`}
      ${d.state === 'ready' && d.next === 'quit' ? '' : `<button data-release="later">${d.state === 'ready' ? 'Close' : 'Not now'}</button>`}</div></div>`;
}
async function followDownload() {
  try { release = await api('/update', 'GET', undefined, 4000); } catch { /* asked again below */ }
  if (!releaseAsk) return;
  showRelease();
  if (release.download?.state === 'downloading') setTimeout(followDownload, 700);
}
document.addEventListener('click', async e => {
  const act = e.target.closest('.releaseask [data-release]')?.dataset.release;
  if (act === 'later') { releaseDismissed = true; releaseAsk?.remove(); releaseAsk = null; }
  if (act === 'update') {
    try { release = await api('/update', 'POST', undefined, 10000); } catch (err) {
      release.download = { state: 'failed', error: err.status ? err.message : `${pi()} did not answer` };
    }
    showRelease();
    followDownload();
  }
});

// ---------- link to the Pi ----------
let liveLine = null;
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
function refreshStatus() {
  document.querySelectorAll('.conn').forEach(n => {
    const cams = connected && cameraCount > 0, auto = cams || phone.scoring(), owed = data.waiting();
    const full = (startCal === 'busy' ? 'Finding the board again…'
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
const voice = createVoice({ chosen: store.get('voiceName', '') });
// How long the computer waits after a person's visit before it throws: a drop-down of seconds.
function botHoldPicker() {
  const now = botHoldSecs();
  return `<div class="picks"><label class="pick"><span>Bot waits before it throws</span><select data-bothold>
      ${Array.from({ length: BOT_HOLD_MAX + 1 }, (_, n) =>
    `<option value="${n}" ${n === now ? 'selected' : ''}>${n ? `${n} second${n > 1 ? 's' : ''}` : 'No wait'}${n === BOT_HOLD_USUAL ? ' Default' : ''}</option>`).join('')}</select></label></div>
    <p class="muted small">Against the computer, the time you have after your visit to undo a wrongly scored dart before it throws.</p>`;
}
// Voices can be listed a moment after the page loads: show them once they are.
globalThis.speechSynthesis?.addEventListener?.('voiceschanged', () => { if (screen === 'settings') renderSettings(); });
function say(text) {
  if (settings.voice) voice.say(text);
}
addEventListener('click', () => voice.unlock(), { capture: true, once: true });

// Which voice calls the scores: the device's voices to choose from, or a word
// on why it is quiet where the device has none.
function voicePicker() {
  if (voice.none()) return `<p class="muted small">This device has no voices of its own, so scores are not called aloud. Voices can be added in your device's speech settings.</p>`;
  const names = voice.voices();
  if (!names.length) return '';
  const chosen = store.get('voiceName', '');
  return `<div class="picks"><label class="pick"><span>Voice</span><select data-voicename>
      <option value="" ${chosen ? '' : 'selected'}>Best available (${esc(names[0])})</option>
      ${names.map(n => `<option value="${esc(n)}" ${n === chosen ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
    <p class="muted small">Missing a voice? Natural-sounding ones can be added in your device's speech settings.</p>`;
}

// ---------- one screen, no scrolling ----------
// Every view is laid out to fill the window. If one still doesn't fit (a small
// phone, six players of Cricket), it is shrunk until it does.
// Not the menu or the settings on a phone or a tablet, though: there the middle
// of the page scrolls instead (see STACKED and style.css), so nothing gets too
// small to read or to tap.
function fit() {
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
  slips = slips.filter(s => s.at <= match.log.length);
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
const achievementsOn = () => settings.achievements !== false;
const people = m => m.playerIds.filter((_, i) => m.bots?.[i] == null).length;
// Where in a game's visits the one still being thrown is, or -1 between visits: a visit's total is judged when it is over.
const openVisit = (s, sheet) => s.winner == null && s.turn.length && !s.turnOver ? sheet.visits.length - 1 : -1;
function forgetEnded(id) {
  const i = endedGames.findIndex(g => g.sheet.id === id);
  if (i >= 0) endedGames.splice(i, 1);
}
function endedHere() {
  forgetEnded(match.id);
  endedGames.push({ sheet: matchSheet(match), ids: match.playerIds });
  if (endedGames.length > 20) endedGames.shift();
}
// A player's games that are on this device and may not be in their history yet, as [{sheet, me}].
function gamesHere(id) {
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
const photoUrl = (id, visit) => `/api/matches/${id}/photos/${visit}`;
const photosOn = () => settings.photos ?? (account.hosted || phone.scoring() ? null : true);
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
function badge(a, size = 44, has = true, blank = false) {
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
    statsGame = statsDarts = null;
    statsTab = 'achievements';
    drill = [];
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
let depth = 0;  // how many history entries this screen is above the menu
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
    Object.assign(at, { statsFor, statsGame, statsDarts, statsTab, drill });
    // A scoresheet reached through the stats has the game's own address too.
    const top = drill.at(-1), m = top?.v === 'match' && statsData && deep(statsData).matches.find(m => m.id === top.id);
    url = m ? gameUrl(m.game, m.opts, m.id) : '#/stats';
  }
  if (screen === 'settings') { Object.assign(at, { settingsTab, settingsOpen, fromList }); url = '#/settings'; }
  if (screen === 'cameras') url = '#/cameras';
  return [at, '', url];
}
// Note where the app is now: as a new history entry (push), or in place of the current one.
function mark(push) {
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
  if (a === 'pair' && /^[A-Za-z0-9]{6}$/.test(b ?? '')) { pairCode = b.toUpperCase(); return { screen: 'cameras' }; }
  if (word.test(a ?? '') && word.test(b ?? '')) return { screen: 'game', id: b, name: a };
  return { screen: 'home' };
}
// Draw the screen a history entry (or an address) describes.
function show(at) {
  if (account.locked) return renderLanding();
  if (at.screen === 'game') return match?.id === at.id ? renderGame() : renderSheet(at.id, at.name);
  if (at.screen === 'players') {
    // (adding and editing players was once part of the stats: an entry from then finds them in the settings)
    if (at.editing || at.statsTab === 'edit') { settingsTab = 'players'; return renderSettings(true); }
    if ('statsFor' in at) ({ statsFor, statsGame, statsTab } = at);
    statsDarts = at.statsDarts ?? null;
    drill = (at.drill ?? []).map(level => ({ ...level }));
    return renderPlayers();
  }
  // (the cameras were once a tab of the settings: a history entry from then still finds them)
  if (at.screen === 'cameras' || (at.screen === 'settings' && at.settingsTab === 'cams')) return renderCameras();
  if (at.screen === 'settings') { settingsTab = at.settingsTab ?? settingsTab; settingsOpen = !!at.settingsOpen; fromList = !!at.fromList; return renderSettings(); }
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
  removeArmed = addingPlayer = false;
  formError = '';
  dartsForm = dartsError = null;
  closeFirst();
  closeQuit();
  if (bull) { clearTimeout(bull.timer); bull = null; }
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

// ---------- the welcome page ----------
// The hosted version with nobody signed in (account.locked): what the app is,
// and the buttons to sign in with. There is no sign-up form: the first sign-in
// makes the account, called by the person's first name, with a player of that name.
// It is a page of plain writing, in the README's words, with pictures of the app in it
// (web/shots: taken from the app itself, and one camera's picture of a real board).

// The two ways to play, where they differ: [what, tapping the board, with cameras].
// What it claims is what web/faq.html says: change one, change the other.
// A small number as it is written in a sentence: 8 -> "eight".
const inWords = n => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'][n] ?? String(n);
const WAYS = [
  ['What you need', 'A phone, tablet, TV or computer', 'Also a Mac, Windows or Linux PC and two or three webcams'],
  ['Scoring', 'Tap the board or type the visit', 'The cameras score each dart. Tap to put one right'],
  ['Without the internet', 'Once on your home screen', 'Needs the internet'],
];
const APPLE_LOGO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>';
const MAIL_LOGO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
const icon = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
// Getting about before signing in: the name leads back here, then the questions, the downloads,
// what is new and the source. The foot of the page has those and the rules of the games as well.
// The same lines are written out at the top and bottom of web/faq.html, web/rules.html, web/download.html,
// web/releases.html, web/opensource.html and web/privacy.html: change one, change them all.
const SITE_PLACES = [['faq.html', 'FAQ'], ['download.html', 'Download'], ['releases.html', "What's new"], ['opensource.html', 'Open source']];
const FOOT_PLACES = [SITE_PLACES[0], ['rules.html', 'How to play'], ...SITE_PLACES.slice(1)];
const BRAND = '<b class="wordmark">Darts S.A.M</b><span class="strap"><b>S</b>coring <b>A</b>ssisted <b>M</b>arker</span>';
const siteHead = () => `<header class="site-head"><a class="brand" href="./" data-act="land-home">${BRAND}</a>
      <nav class="site-nav" aria-label="Darts S.A.M">${SITE_PLACES.map(([href, name]) => `<a href="${href}">${name}</a>`).join('')}
        <a href="./" class="go" data-act="land-top">Sign in</a></nav></header>`;
const siteFoot = () => `<footer class="site-foot">
      <p>Darts S.A.M is free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0</a>.
        Copyright © 2026 Sam Cramphorn. <a href="${SOURCE}" target="_blank" rel="noopener">The source code is on GitHub</a>.</p>
      <p>${FOOT_PLACES.map(([href, name]) => `<a href="${href}">${name}</a>`).join(' · ')} · <a href="privacy.html">What is stored about you</a></p>
    </footer>`;
// Everyone's darts between them, as the site counts them (GET /api/tally). Asked for once,
// and written into the page already drawn: drawing it again would lose an address half typed.
let tally = null;
function showTally() {
  const el = document.getElementById('tally');
  if (!el || !tally?.darts) return;
  el.innerHTML = `<b>${tally.darts.toLocaleString()}</b> darts thrown on Darts S.A.M so far, in <b>${tally.games.toLocaleString()}</b> ${tally.games === 1 ? 'game' : 'games'}${tally.users ? `, by <b>${tally.users.toLocaleString()}</b> ${tally.users === 1 ? 'user' : 'users'} registered` : ''}`;
  el.hidden = false;
}
const askTally = () => tally ? showTally() : fetch('api/tally').then(r => r.ok ? r.json() : null)
  .then(t => { tally = t; showTally(); }, () => {});  // no answer: the page does without
let landNote = '';     // why the last try at signing in came to nothing
let mailStep = '';     // signing in by email: '' not begun, 'ask' for the address, 'sent' the code is on its way
let mailTo = '';       // the address it went to
let newcomer = false;  // they signed up just now (see synced())
function renderLanding() {
  screen = 'landing';
  const pic = (file, alt, w, h, lazy = true) =>
    `<img src="shots/${file}" alt="${alt}" width="${w}" height="${h}"${lazy ? ' loading="lazy"' : ''}>`;
  // The home page at an address of its own (account.front) has no signing in: it sends people to the app's.
  document.documentElement.toggleAttribute('data-front', account.front);  // no "Install" bar there either (style.css)
  if (account.front && location.hash === '#signin') return location.replace(account.app + '/#signin');
  const card = account.front ? `<div class="signin-box" id="signin">
      <h2>Play in your browser. It's free.</h2>
      <button class="primary start" data-act="land-top">Open the app</button>
      <p class="muted small">Signing in takes one tap: no forms to fill in.
        <a href="privacy.html" target="_blank" rel="noopener">What is stored about you</a></p>
    </div>`
    : `<div class="signin-box" id="signin">
      <h2>Sign in to play. It's free.</h2>
      <div class="signin">
        <div id="gbtn"></div>
        ${account.appleId ? `<button class="apple" data-act="apple">${APPLE_LOGO}<span>Continue with Apple</span></button>` : ''}
        ${!account.email ? '' : mailStep === 'ask' ? `<div class="mailbox">
            <input type="email" id="mail-addr" placeholder="Your email address" autocomplete="email" maxlength="254" value="${esc(mailTo)}">
            <button class="primary" data-act="mail-send">Email me a code</button></div>`
          : mailStep === 'sent' ? `<div class="mailbox">
            <p>We've emailed a code to <b>${esc(mailTo)}</b>. Type it here, or open the link in the email.</p>
            <input type="text" id="mail-code" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code" maxlength="7">
            <button class="primary" data-act="mail-code">Sign in</button>
            <button class="ghost" data-act="mail-back">Use a different address</button></div>`
          : `<button class="mail" data-act="mail">${MAIL_LOGO}<span>Continue with email</span></button>`}
      </div>
      ${landNote ? `<p class="warn">${esc(landNote)}</p>` : ''}
      <p class="muted small">No forms to fill in. Your games and stats, and any problem reports you choose to send,
        are stored for this trial. <a href="privacy.html" target="_blank" rel="noopener">What is stored about you</a></p>
    </div>`;
  // The app's own address, when the home page is elsewhere: signing in and nothing else.
  if (account.home && !account.front) {
    $app.innerHTML = `<div class="site door">
      <header class="site-head"><span class="brand">${BRAND}</span>
        <nav class="site-nav"><a href="${esc(account.home)}/">About Darts S.A.M</a></nav></header>
      <main><h1>Game on</h1>${card}</main>
    </div>`;
    googleButton();
    appleReady();
    return;
  }
  $app.innerHTML = `<div class="site">
    ${siteHead()}
    <main>
    <div class="intro">
      <div>
        <h1>A darts scoreboard that scores by itself</h1>
        <p class="lead">Point two or three webcams at the board and Darts S.A.M sees where each dart lands. No cameras? Tap the board instead.
          Either way it calls every dart, does the adding up and keeps your stats.</p>
        ${card}
      </div>
      <figure class="shot">${pic('game.webp', 'A game of 501 in Darts S.A.M: the scores beside the board', 1800, 1125, false)}
        <figcaption>A game of 501: the scores chalked up beside the board, and each dart marked where it landed.</figcaption></figure>
    </div>
    <a class="tally" id="tally" href="faq.html#numbers" hidden></a>
    <section class="intro">
      <div>
        <h2>Scoring by camera</h2>
        <p>USB webcams round the board watch for each dart, work out where it landed and move on to the next player when the darts are pulled out.
          There is nothing to stick on the board: each camera finds the wires by itself, once, when you set it up.</p>
        <p>The cameras plug into a Mac, Windows or Linux computer near the board, and every phone, tablet and TV you sign in on follows along.</p>
        <p class="acts"><button class="primary" data-act="download">Download for Mac, Windows or Linux</button>
          <a href="faq.html#connect">How to set it up</a></p>
      </div>
      <figure class="shot">${pic('camera.webp', 'A webcam\'s picture of a dartboard, with every wire and number drawn over it in green', 1280, 720)}
        <figcaption>What one camera sees: a real board, with its wires and numbers drawn where Darts S.A.M found them.</figcaption></figure>
    </section>
    <section>
      <h2>${inWords(GAMES.length).replace(/^./, c => c.toUpperCase())} games</h2>
      <p>Including X01, Cricket, Killer, Around the Clock and Bob's 27, for a match with friends or practice on your own.
        <a href="rules.html">See them all and how to play each one</a>.</p>
    </section>
    <section>
      <h2>Stats, the telly and your phone</h2>
      <div class="row3">
        <figure class="shot">${pic('stats.webp', 'Stats: averages, checkout rate and a heat map', 1800, 1125)}
          <figcaption><b>Stats for every player.</b> Three-dart and first-nine averages, checkout rate, highest checkout and 180s,
            and a heat map of where your darts land. Tap any number to see the legs behind it.</figcaption></figure>
        <figure class="shot">${pic('tv.webp', 'TV view: the board with the scores along the bottom', 1800, 1125)}
          <figcaption><b>TV view.</b> The board gets the screen and the scores run along the bottom, the way a match is shown on television.</figcaption></figure>
        <figure class="shot tall">${pic('game-phone.webp', 'The same game on a phone', 780, 1560)}
          <figcaption><b>On a phone.</b> At the oche, or added to your home screen.</figcaption></figure>
      </div>
      <p>Every dart is called aloud, with the visit's total and what you require for a finish. And there are ${inWords(THEMES.length)} themes to choose from,
        from the pub chalkboard to big-stage TV graphics.</p>
    </section>
    <section>
      <h2>With cameras or without</h2>
      <table class="ways">
        <thead><tr><td></td><th scope="col">Tapping the board</th><th scope="col">With cameras</th></tr></thead>
        <tbody>${WAYS.map(([what, ...ways]) => `<tr><th scope="row">${what}</th>${ways.map(w => `<td>${w}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p>Everything else is the same either way: the caller, all ${inWords(GAMES.length)} games, the stats, TV view and the themes.
        Both are free, with no adverts.</p>
      <p class="acts"><button class="primary" data-act="land-top">Sign in to play</button>
        <a href="faq.html">Questions first? How it connects, how it works and what is stored</a></p>
    </section>
    </main>
    ${siteFoot()}
  </div>`;
  if (!account.front) { googleButton(); appleReady(); }
  askTally();
  // "Sign in" on the questions and the downloads leads here (./#signin): straight to the buttons
  if (location.hash === '#signin') document.getElementById('signin').scrollIntoView({ block: 'center' });
}
// Google's and Apple's own sign-in code, fetched from them only when the welcome page is shown.
const scripts = {};
const script = src => scripts[src] ??= new Promise((done, fail) => {
  const tag = document.createElement('script');
  tag.src = src;
  tag.onload = done;
  tag.onerror = () => { delete scripts[src]; tag.remove(); fail(); };
  document.head.append(tag);
});
// Google draws its own button.
function googleButton() {
  const box = document.getElementById('gbtn');
  const offline = () => { if (box.isConnected) box.innerHTML = '<p class="muted">Signing in needs the internet.</p>'; };
  if (!account.clientId) return navigator.onLine ? null : offline();  // the server has not said yet: drawn again when it has
  script('https://accounts.google.com/gsi/client').then(() => {
    if (!box.isConnected) return;
    window.google.accounts.id.initialize({ client_id: account.clientId, callback: r => signIn('google', { credential: r.credential }) });
    window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'continue_with', width: 280 });
  }, offline);
}
// Apple's opens a window of its own when the button is pressed, so it has to be ready before then.
function appleReady() {
  if (!account.appleId) return;
  script('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js').then(() =>
    window.AppleID.auth.init({ clientId: account.appleId, scope: 'name', redirectURI: location.origin, usePopup: true }), () => {});
}
async function appleSignIn() {
  let r;
  try {
    r = await window.AppleID.auth.signIn();
  } catch (e) {
    if (e?.error === 'popup_closed_by_user') return;  // they changed their mind
    landNote = window.AppleID ? 'Apple sign-in did not finish. Try again.' : 'Signing in needs the internet.';
    return renderLanding();
  }
  // Apple says the person's name only the first time they sign in to a site, and only to the page.
  signIn('apple', { credential: r.authorization.id_token, name: r.user?.name?.firstName ?? null });
}
// By email: they give their address, are sent a code and a link, and type the
// code here (the link does the same on whatever device it is opened on: see the end of this file).
async function sendCode() {
  mailTo = document.getElementById('mail-addr').value.trim();
  if (!mailTo) return;
  landNote = '';
  document.querySelector('[data-act="mail-send"]').disabled = true;  // one press, one email
  try {
    await account.sendCode(mailTo);
    mailStep = 'sent';
  } catch (e) {
    landNote = e.status ? e.message : 'Could not reach the site. Try again.';
  }
  if (screen !== 'landing') return;
  renderLanding();
  document.getElementById(mailStep === 'sent' ? 'mail-code' : 'mail-addr')?.focus();
}
async function signIn(provider, details) {
  landNote = '';
  try {
    const had = store.get('owner', null);
    const how = await account.signIn(provider, details);
    newcomer = how !== 'in';
    mailStep = mailTo = '';  // the app opens: see createAccount above
    // New here: ask about a camera before the menu (see renderWelcome). Not when they came by
    // the link their cameras' computer showed: that has answered it, and opens the cameras.
    // Signed up without a name (by email): their name is asked first, whichever way they came.
    if (how === 'unnamed') store.set('unnamed', account.account.id);
    if (newcomer && !pairCode) store.set('newcomer', account.account.id);
    if (how === 'unnamed' || (newcomer && !pairCode)) renderWelcome();
    // someone else's games were cleared from this device: start again from what is saved
    if (had && had !== account.account.id) return location.reload();
    startCal = '';  // signed in: their cameras find the board again (calibrateOnStart)
    liveLine?.close();  // it reconnects, now as this person: their cameras' darts come down it
    data.sync(true);
    tracker.flush();
  } catch (e) {
    landNote = e.status || e.signedOut ? e.message : 'Could not reach the site. Try again.';  // refused, or not reached
    if (screen === 'landing') renderLanding();
  }
}
addEventListener('online', () => { if (screen === 'landing') account.load(); });  // the buttons can be drawn now

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
const pageHead = on => `<div class="row head"><h1>Darts S.A.M</h1><span class="spacer"></span><span class="conn muted"></span>${nav(on, 'top')}</div>`;
const pageFoot = on => nav(on, 'foot');
// One place to another. Only the first step away from the menu, or from deep
// in the stats, is a new step for Back: between the places themselves each
// takes the last one's, so Back from any of them is the menu.
function goTo(place) {
  if (place === 'home') return goHome();
  rulesOpen = false;  // back on the menu later, the games are there, not the rules last read
  const deep = screen === 'home' || screen === 'sheet' || (screen === 'players' && drill.length > 0);
  if (place === 'players') { drill = []; renderPlayers(); }
  if (place === 'cameras') { camAdding = false; camStep = camNote = ''; renderCameras(); }
  if (place === 'settings') { settingsOpen = fromList = false; renderSettings(); }
  mark(deep);
}

// ---------- home ----------
function renderHome() {
  if (account.locked) return renderLanding();
  screen = 'home';
  // A game that is over has been looked at for the last time.
  if (match && compute(match).winner != null) { match = null; store.set('match', null); }
  updater.check();  // back on the menu with no game going: the moment to load a new version
  const game = gameById(setup.gameId);
  for (const o of game.options) {
    const v = setup.opts[o.key];
    if (o.choices ? !o.choices.some(c => c[0] === v) : !(Number.isInteger(v) && v >= o.min && v <= o.max)) setup.opts[o.key] = o.default;
  }
  cleanSetup();
  followSuggestion();
  store.set('setup', setup);
  const enough = canStart(game, seats().length), people = seats().some(id => id !== BOT);
  // Why Start can't be pressed, said beside it: on a phone the players' step may be shut. (Nobody
  // picked at all needs no saying: that step's own line says it.)
  const why = needsMore(game, seats().length) ? `${game.name} needs two or more players.`
    : seats().length && !people ? 'Choose who plays the bot.' : '';
  const start = `${why ? `<p class="warn small startnote">${esc(why)}</p>` : ''}
    <button class="primary start" data-act="start" ${people && enough ? '' : 'disabled'}>Start ${game.name}</button>`;
  const scrolled = document.querySelector('.home-body')?.scrollTop ?? 0;  // a tap redraws the menu: stay where it was
  const steps = [['game', 'Game', esc(game.name)]];
  if (game.options.length) steps.push(['options', 'Options', esc(optsBrief(game))]);
  steps.push(['players', 'Players', playersBrief(), averagesLine()]);
  if (homeStep === undefined) homeStep = seats().length ? null : 'players';
  if (!steps.some(s => s[0] === homeStep)) homeStep = null;
  // One step of the menu. On a phone it is a numbered line saying what is chosen, which opens
  // to change it; on a computer every step is open under its heading (see style.css).
  const step = (id, body) => {
    const n = steps.findIndex(s => s[0] === id), [, name, brief, note] = steps[n], open = homeStep === id;
    return `<section class="step ${open ? 'open' : ''}" data-is="${id}">
      <button class="step-head" data-step="${id}" aria-expanded="${open}"><i>${n + 1}</i><span><small>${name}</small><b>${brief}</b>${
        note ? `<small>${note}</small>` : ''}</span><u>${open ? 'Done' : 'Change'}</u></button>
      <div class="step-body"><h2>${name}</h2>${body}</div></section>`;
  };
  const after = id => steps[steps.findIndex(s => s[0] === id) + 1];
  $app.innerHTML = `<div class="page">
    ${pageHead('home')}
    <div class="home-body">
    <div class="pick ${rulesOpen ? 'rules-on' : ''}">
    ${match ? '<h2>In progress</h2><button class="start" data-act="resume">Resume game in progress</button>' : ''}
    ${step('game', `${[['match', 'Matches'], ['training', 'Training']].map(([kind, title]) => `<h3 class="group">${title}</h3>
    <div class="games">${GAMES.filter(g => g.kind === kind).map(g => `<button class="game-card ${g.id === game.id ? 'on' : ''}" data-game="${g.id}">
      <b>${g.name}</b><span>${g.blurb}</span></button>`).join('')}</div>`).join('')}
    <p class="blurb muted small">${game.blurb}</p>
    ${howToPlay(game)}`)}
    </div>
    <div class="setup">
    ${game.options.length ? step('options', `${game.options.map(o => `<div class="opt"><span>${o.help ? optLabelHelp(o) : o.label}</span>${o.choices ? `<div class="choices">${o.choices.map(([v, l]) =>
      `<button class="${setup.opts[o.key] === v ? 'on' : ''}" data-opt="${o.key}" data-val="${esc(JSON.stringify(v))}"${
        o.help ? ` title="${esc(o.help(v, { ...setup.opts, [o.key]: v }))}"` : ''}>${l}</button>`).join('')}</div>`
      : stepper(o)}${o.help && optHelp === o.key ? `<p class="opt-help muted">${esc(o.help(setup.opts[o.key], setup.opts))}</p>` : ''}</div>`).join('')}
    <button class="step-next" data-step="${after('options')[0]}">Next: ${after('options')[1].toLowerCase()}</button>`) : ''}
    ${step('players', `${players.length ? `<div class="row">${players.map(p => {
      const n = seats().indexOf(p.id);
      return `<button class="chip ${n >= 0 ? 'on' : ''}" data-pick="${p.id}">${n >= 0 ? `<i>${n + 1}</i>` : ''}${esc(p.name)}</button>`;
    }).join('')}${game.bot ? botChip() : ''}${addingPlayer ? '' : '<button class="chip ghost" data-act="newplayer">+ New</button>'}</div>
    <p class="muted small">Tap who is playing, in throwing order. With two or more, Start asks who throws first: closest to the bull, or random.</p>
    ${averagesLine() ? `<p class="muted small averages">${averagesLine()}</p>` : ''}
    ${botRow()}${dartsRows()}`
      : '<p class="muted">Add a player to get started.</p>'}
    ${addingPlayer || !players.length ? newPlayerRow() : ''}`)}
    ${howToPlay(game, 'how-phone')}
    <span class="spacer"></span>
    ${start}
    </div>
    <p class="totals" id="totals"></p>
    </div>
    <div class="startbar">${start}</div>
    ${pageFoot('home')}
  </div>`;
  document.querySelector('.home-body').scrollTop = scrolled;
  if (stepMoved) document.querySelector('.step.open')?.scrollIntoView({ block: 'nearest' });
  // The rules open at the foot of a phone's menu, which may be off the screen: up to their heading.
  const how = rulesMoved && rulesOpen && document.querySelector('.how-phone');
  if (how?.offsetParent) how.scrollIntoView({ block: 'start' });
  stepMoved = rulesMoved = false;
  refreshStatus();
  showTotals();
  loadTotals();
  loadAverages();
  fit();
  if (addingPlayer) document.getElementById('newplayer')?.focus();
}
// The option whose "?" is open: its line saying what the chosen setting means shows under it.
let optHelp = null;
// "How to play" the chosen game, opened on the menu like an option's "?". The rules are
// web/rules.html's section for the game (its id), read once and kept, so the page and the
// menu say the same thing and it works offline (sw.js keeps the page).
let rulesOpen = false, rules = null;  // rules: {gameId: section html} once read, {} if it couldn't be
let rulesMoved = false;  // they have just been opened, or have just arrived: bring them into view
function loadRules() {
  if (rules) return;
  rules = fetch('rules.html').then(r => (r.ok ? r.text() : Promise.reject())).then(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html'), got = {};
    for (const sec of doc.querySelectorAll('main section[id]')) {
      sec.querySelector('h2')?.remove();  // the menu already names the game
      for (const a of sec.querySelectorAll('a')) a.replaceWith(...a.childNodes);  // nothing that leads off the menu
      got[sec.id] = sec.innerHTML;
    }
    return got;
  }, () => ({})).then(got => { rules = got; if (screen === 'home' && rulesOpen) { rulesMoved = true; renderHome(); } });
}
// On a computer it is under the game's blurb, and open it takes the place of the games (the menu
// there doesn't scroll, so they would squeeze it all smaller): the way back to them is beside its
// heading. On a phone, where the menu scrolls and the blurb is hidden, it is above Start.
function howToPlay(game, where = '') {
  const title = `How to play ${esc(game.name)}`;
  if (!rulesOpen) return `<div class="how ${where}"><button class="link" data-act="rules" aria-expanded="false">${title}</button></div>`;
  const body = rules instanceof Promise ? '<p class="muted">Loading the rules…</p>'
    : rules?.[game.id] ?? '<p class="muted">The rules couldn\'t be loaded. Try again when you are back online.</p>';
  return `<div class="how open ${where}"><div class="how-head"><h3>${title}</h3>
      <button class="link" data-act="rules" aria-expanded="true">${where ? 'Hide the rules' : 'Back to the games'}</button></div>
    <div class="rules-box">${body}</div></div>`;
}
// An option's name with its "?" after it, kept on a line with the name's last word.
function optLabelHelp(o) {
  const cut = o.label.lastIndexOf(' ') + 1;
  return `${o.label.slice(0, cut)}<span class="nowrap">${o.label.slice(cut)}<button class="opt-q"
    data-opthelp="${o.key}" aria-label="What does ${esc(o.label)} mean?" aria-expanded="${optHelp === o.key}">?</button></span>`;
}
// A step's line on a phone: what is chosen in it, in a few words.
// An option says its own with `brief` (nothing at all, to be left out); one that doesn't is
// its name and what is chosen.
function optsBrief(game) {
  return game.options.map(o => {
    const v = setup.opts[o.key];
    if (o.brief) return o.brief(v, setup.opts);
    return `${o.label}: ${o.choices ? o.choices.find(c => c[0] === v)[1] : v}`;
  }).filter(Boolean).join(' · ');
}
// Who is playing, in the order they will throw.
function playersBrief() {
  if (!seats().length) return players.length ? 'Choose who is playing' : 'Add a player';
  return esc(seats().map(nameOf).join(', '));
}
// The computer, among the players to tap (in a game it can play), and once it is playing, how good it is.
function botChip() {
  const n = seats().indexOf(BOT);
  return `<button class="chip ${n >= 0 ? 'on' : ''}" data-pick="${BOT}" title="Play against the computer">${n >= 0 ? `<i>${n + 1}</i>` : ''}Bot</button>`;
}
function botRow() {
  if (!seats().includes(BOT)) return '';
  const b = botAt();
  return `<div class="opt"><span>Bot level</span><div class="choices stepper">
      <button data-botlevel="-1" aria-label="Easier" ${b.level <= 1 ? 'disabled' : ''}>−</button>
      <b>${b.level}</b><button data-botlevel="1" aria-label="Harder" ${b.level >= LEVELS.length ? 'disabled' : ''}>+</button></div></div>
    <p class="muted small">Level ${b.level} of ${LEVELS.length}: the computer averages about ${b.average} and hits about ${
      Math.round(b.checkout * 100)}% of its darts at a double.${suggestionNote(b)}</p>`;
}
// Each player's own X01 average, on the menu while X01 is the game, so that they know it and so
// that the computer can be set to suit it. {player id: three-dart average, or null with no X01
// thrown}, from the same history and the same sum as the stats screen's figure (stats.js), asked
// for when the menu is drawn and again once a game has gone in. Kept only while the app is open:
// until the answer comes (from the device's own copy, with no link) there is nothing to show.
let averages = {};
const avgAsked = new Map();  // player id -> when theirs was last asked for
const AVG_FRESH = 60000;
const onX01 = () => setup.gameId === 'x01';
function loadAverages() {
  if (!onX01()) return;
  for (const id of seats()) {
    if (id <= 0 || Date.now() - (avgAsked.get(id) ?? 0) < AVG_FRESH) continue;  // (the bot, or a player made offline)
    avgAsked.set(id, Date.now());
    loadStats(statsPath(id, 'x01'), connected ? 10000 : 2500).then(st => {
      const average = x01Stats(st.matches ?? [])?.average ?? null;
      if (averages[id] === average) return;
      averages = { ...averages, [id]: average };
      if (screen === 'home') redraw(renderHome);
    }, () => { avgAsked.delete(id); });  // no answer and no copy: ask again the next time
  }
}
// The people down to play whose average is known: [[name, average]].
const averaged = () => onX01() ? seats().filter(id => id !== BOT && averages[id] != null).map(id => [nameOf(id), averages[id]]) : [];
// Said quietly under the players (and on a phone, on the players' line of the menu).
function averagesLine() {
  const got = averaged();
  if (!got.length) return '';
  return got.length === 1 ? `${esc(got[0][0])}'s X01 average: ${got[0][1].toFixed(1)}`
    : `X01 averages: ${got.map(([name, a]) => `${esc(name)} ${a.toFixed(1)}`).join(' · ')}`;
}
// The level that suits who is playing: {level, average, whose}, or null when nobody's average is
// known. With more than one person playing it goes by their averages taken together.
function botSuggestion() {
  const got = averaged();
  if (!got.length) return null;
  const average = got.reduce((t, [, a]) => t + a, 0) / got.length;
  return { level: levelFor(average).level, average, whose: got.length === 1 ? `${got[0][0]}'s average` : "the players' average" };
}
// The bot's level follows the suggestion (setup.botAuto) until the level is set by hand, and
// again once the suggestion is taken up. A level chosen before there were suggestions was
// chosen by hand; someone who has never set one starts off following.
const botFollows = () => setup.botAuto ?? setup.bot == null;
function followSuggestion() {
  const s = botSuggestion();
  if (s && botFollows()) { setup.bot = s.level; setup.botAuto = true; }
}
function suggestionNote(b) {
  const s = botSuggestion();
  if (!s) return '';
  const whose = `${esc(s.whose)} of ${s.average.toFixed(1)}`;
  if (s.level === b.level) return ` ${botFollows() ? 'Picked' : 'It is the level'} to suit ${whose}.`;
  return ` Level ${s.level} would suit ${whose}. <button class="link" data-act="botsuggest">Use level ${s.level}</button>`;
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
// Which darts each player is throwing: a line for each one playing who has more than one set
// (with one set, or none, there is nothing to choose). Then the way to the players' cards in
// the settings, where names and darts are changed.
function dartsRows() {
  return `${setup.players.filter(id => setsOf(id).length > 1).map(id => `<div class="opt"><span>${esc(nameOf(id))}'s darts</span>
    <div class="row">${setsOf(id).map(d => `<button class="chip ${dartsFor(id) === d.id ? 'on' : ''}" data-usedarts="${id}" data-set="${esc(d.id)}">${
      esc(d.name)}${d.grams != null ? ` <span class="muted">${grams(d.grams)}</span>` : ''}</button>`).join('')}</div></div>`).join('')}
    <p class="muted small"><button class="link" data-act="manageplayers">Edit players and darts</button></p>`;
}
// An option that is a number rather than one of a few choices: − and + either side of it.
function stepper(o) {
  const v = setup.opts[o.key];
  return `<div class="choices stepper"><button data-opt="${o.key}" data-step="-1" aria-label="Fewer" ${v <= o.min ? 'disabled' : ''}>−</button>
    <b>${v}</b><button data-opt="${o.key}" data-step="1" aria-label="More" ${v >= o.max ? 'disabled' : ''}>+</button></div>`;
}
// Only the chosen game's own options go into a match, not ones left over from another game.
const startOpts = () => Object.fromEntries(gameById(setup.gameId).options.map(o => [o.key, setup.opts[o.key]]));
// The corner of the menu, the way an app shows its version number: every dart on record, and how many
// problem reports have been saved (with what share of the darts that is).
function showTotals() {
  const box = document.getElementById('totals');
  if (!box || screen !== 'home') return;
  const n = v => v.toLocaleString();
  const { darts, reports } = totals ?? {};
  box.textContent = totals ? `${n(darts)} dart${darts === 1 ? '' : 's'} thrown · ${n(reports)} report${reports === 1 ? '' : 's'}${
    darts ? ` (${pct(reports, darts)})` : ''}` : '';
}
let totalsAsked = 0;
async function loadTotals() {
  const asked = ++totalsAsked;
  try {
    const t = await api('/totals', 'GET', undefined, 4000);
    if (asked !== totalsAsked) return;
    store.set('totals', totals = t);
    showTotals();
  } catch { /* no Pi: the last figures stay */ }
}
function newPlayerRow() {
  return `<div class="player-row"><input type="text" id="newplayer" placeholder="New player name" maxlength="16">
    <button data-act="addplayer">Add</button></div>
    ${formError && renameFailed == null ? `<p class="warn">${esc(formError)}</p>` : ''}`;
}
function addPlayer() {
  const input = document.getElementById('newplayer');
  renameFailed = null;
  const name = input.value.trim();
  if (!name) return input.focus();
  try {
    const p = data.addPlayer(name);
    loadPlayers();
    formError = '';
    addingPlayer = false;
    // Added on the menu, they are playing; added in the settings, they are only on the list
    // and their card opens, ready for their darts.
    if (screen === 'home' && setup.players.length < MAX_PLAYERS) { setup.players.push(p.id); saveSetup(); }
    if (screen === 'settings') { openPlayer = p.id; dartsForm = null; }
    data.sync();
  } catch (e) {
    formError = e.message;
  }
  if (screen === 'settings') return renderSettings();
  renderHome();
}

// ---------- stats ----------
// One player at a time, one tab at a time. Each game type has its own page of
// stats, next to one for all games together. Any figure with a › can be tapped
// to see what it was counted from (see "opening up the stats" below).
// A big screen has room for the stats and the board side by side (see .panes in style.css).
const BIG = matchMedia('(min-width: 1100px) and (min-height: 750px)');
const STAT_TABS = [['stats', 'Stats'], ['games', 'Games'], ['board', 'Board'], ['achievements', 'Achievements']];
let statsFor = null, statsData = null, statsFailed = false, statsTab = 'stats';
// (The list of players, to add to, rename and remove from, and their darts, is a tab of the settings: see playersPanel().)
let removeArmed = false;  // the id of the player whose Remove has been tapped once
let renameFailed = null;  // the id of the player whose new name was refused (formError says why)
let statsGame = null;  // a game id, or null for all games together
let statsDarts = null;  // one of the player's sets of darts, or null for all of them
// Each game's own figures, in the order shown: [label, field in the Pi's reply, unit].
// (X01's are worked out here instead, from the history the Pi sends: see stats.js.)
const GAME_TILES = {
  cricket: [['Marks per round', 'mpr'], ['Best round (marks)', 'best_round'], ['Rounds of 5+ marks', 'big_rounds'],
    ['Marks scored', 'marks']],
  clock: [['Hit rate', 'hit_rate', '%'], ['Average darts to finish', 'avg_finish'], ['Fewest darts to finish', 'best_finish'],
    ['Best run of hits', 'best_run']],
  countup: [['3-dart average', 'average'], ['Highest visit', 'highest'], ['Visits of 100+', 't100'],
    ['Average game total', 'avg_total'], ['Best game total', 'best_total']],
  bobs27: [['Average score', 'avg_score'], ['Best score', 'best_score'], ['Doubles hit', 'double_rate', '%'],
    ['Games above zero', 'above_zero']],
  shanghai: [['Average total', 'avg_total'], ['Best total', 'best_total'], ['Shanghais', 'shanghais'],
    ['Hit rate on the number', 'hit_rate', '%']],
  bermuda: [['Average total', 'avg_total'], ['Best total', 'best_total'], ['Rounds halved per game', 'avg_halved'],
    ['Hit rate', 'hit_rate', '%']],
  segment: [['Hit rate', 'hit_rate', '%'], ['Points per dart', 'points_per_dart'], ['Best session', 'best_points']],
  gotcha: [['Games won', 'won'], ['3-dart average', 'average']],
  rcheckout: [['Checkout rate', 'rate', '%'], ['Checkouts hit', 'made'], ['Average darts per checkout', 'avg_darts']],
  c121: [['Checkout rate', 'rate', '%'], ['Checkouts hit', 'made'], ['Highest checkout', 'highest'],
    ['Average darts per checkout', 'avg_darts']],
};
async function renderPlayers(id = statsFor) {
  if (account.locked) return renderLanding();
  screen = 'players';
  statsFor = players.some(p => p.id === id) ? id : players[0]?.id ?? null;
  achAll = null;  // (asked for again if the Achievements tab needs it)
  if (!setsOf(statsFor, true).some(d => d.id === statsDarts)) statsDarts = null;
  if (statsData?.player.id !== statsFor || statsData.game !== statsGame || (statsData.set ?? null) !== statsDarts) statsData = null;
  statsFailed = false;
  drawPlayers();
  if (statsFor == null) return;
  const wanted = statsFor, game = statsGame, set = statsDarts;
  let data = null;
  // A player made offline has no stats on the Pi yet. With no link to the Pi, don't wait long for it.
  if (wanted > 0) try {
    data = await loadStats(statsPath(wanted, game, set), connected ? 10000 : 2500);
  } catch { /* shown as unavailable */ }
  if (screen !== 'players' || statsFor !== wanted || statsGame !== game || statsDarts !== set) return;
  statsData = data;
  statsFailed = !data;
  drawPlayers();
  if (data) mark();  // a scoresheet's address can be told now (and never before the caller's own mark)
}
const pct = (n, of) => of ? (n / of * 100).toFixed(1) + '%' : '–';
// A tile with somewhere to go (`to`, a level of `drill`) can be tapped.
const opens = to => to ? ` data-drill="${esc(JSON.stringify(to))}"` : '';
const tile = (label, value, to) =>
  `<div class="tile ${to ? 'tap' : ''}"${opens(to)}><b>${value ?? '–'}</b><span>${label}</span></div>`;
const gameTiles = (id, d, to) => (GAME_TILES[id] ?? []).map(([name, key, unit = '']) =>
  tile(name, d[key] == null ? null : d[key] + unit, to)).join('');
// The X01 tiles: all of them under their headings, or just the ones named.
const X01_HEADLINES = ['average', 'first9', 'checkout', 'bestCheckout', 't180', 't140', 'won', 'bestLeg'];
function x01Tiles(s, only) {
  const draw = t => {
    const rows = t.rows(s);
    const note = t.note?.(s).trim();  // "(20 of 41 darts)": kept in one piece, so a narrow line breaks before it
    return tile(t.label + (note ? ` <span class="nb">${note}</span>` : ''), t.value ? t.value(s, rows) : rows.length,
      rows.length ? { v: 'tile', key: t.key, ...t.sort } : null);
  };
  if (only) return only.map(key => draw(x01Tile(key))).join('');
  return X01_TILES.map(g => `<h2>X01 ${g.group}</h2><div class="tiles">${g.tiles.map(draw).join('')}</div>`).join('');
}

// ---------- opening up the stats ----------
// Tapping a figure shows what it was counted from, and tapping a line of that
// goes further: 140+ -> every visit of 140 or more and when it was thrown ->
// the scoresheet of the leg it was thrown in. `drill` is how far down the
// screen is: one entry per level, the last one being what is shown.
//   {v: 'tile', key}       an X01 tile's visits, legs or doubles
//   {v: 'double', aim}     the visits with a dart at one double
//   {v: 'numbers'}         how often each number was hit
//   {v: 'number', seg}     the visits with a dart in one number
//   {v: 'matches', name}   the finished games of one game type
//   {v: 'match', id, at}   one game's scoresheet (at: the visit to point out)
// A list's entry also holds how it is sorted: {by: a column, desc}.
let drill = [];
const DEEP = new WeakMap();  // what is worked out from a reply of the Pi's, kept while that reply is
function deep(st) {
  if (!DEEP.has(st)) {
    const matches = st.matches ?? [];  // stats saved by an older version have no history
    DEEP.set(st, { matches, x01: x01Stats(matches), mine: matches.flatMap(m => visitsOf(m).filter(v => v.p === m.me)) });
  }
  return DEEP.get(st);
}
// When something happened: "19 Nov 26, 00:44". Where there is no room for it on one line (a list on a
// phone) it breaks after the day, never in the middle of it.
const when = ts => {
  const d = new Date(ts), nb = t => `<span class="nb">${t}</span>`;
  return `${nb(d.toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' }))}, ${
    nb(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}`;
};
const num = n => n == null ? '–' : n.toFixed(1);
const dartsText = v => v.darts ? v.darts.map(label).join(' ') : '<span class="muted">typed</span>';
const others = m => m.players.filter((_, i) => i !== m.me).map(esc).join(', ');
const against = m => m.players.length > 1 ? `v ${others(m)}` : 'solo';
const scoredText = (v, n) => v.bust ? '<span class="warn">Bust</span>' : `<b>${n}</b>`;
const toMatch = v => ({ v: 'match', id: v.m.id, at: v.i });
const myDarts = m => visitsOf(m).reduce((n, v) => n + (v.p === m.me ? v.n : 0), 0);
// What each kind of list shows: [column, heading, cell, value to sort by (if it can be), class].
// Columns marked 'wide' are left out on a narrow screen.
const LISTS = {
  visits: { open: toMatch, cols: [
    ['when', 'When', v => when(v.ts), v => v.ts],
    ['score', 'Scored', v => scoredText(v, v.score), v => v.score],
    ['darts', 'Darts', dartsText],
    ['left', 'Left', v => `${v.before} → ${v.after}`, v => v.before],
    ['leg', 'Leg', v => `${v.m.opts.start ?? 501} ${against(v.m)}`, null, 'wide'],
  ] },
  legs: { open: l => ({ v: 'match', id: l.m.id, leg: l.n }), cols: [
    ['when', 'When', l => when(l.when), l => l.when],
    ['game', 'Game', l => `${l.start} ${l.dbl ? 'double' : 'straight'} out${l.of > 1 ? ` · leg ${l.n} of ${l.of}` : ''}`, null, 'wide'],
    ['vs', 'Against', l => l.solo ? 'Solo' : others(l.m)],
    ['result', 'Result', l => !l.finished ? '<span class="muted">Not finished</span>' : l.won ? '<b>Won</b>' : 'Lost'],
    ['darts', 'Darts', l => l.darts, l => l.darts],
    ['avg', 'Average', l => num(l.avg), l => l.avg ?? -1],
    ['first9', 'First 9', l => num(l.first9), l => l.first9 ?? -1, 'wide'],
    ['checkout', 'Checkout', l => l.checkout ?? '–', l => l.checkout ?? -1],
  ] },
  doubles: { sort: 'darts', open: d => ({ v: 'double', aim: d.aim }), cols: [
    ['aim', 'Double', d => label({ seg: d.aim, mult: 2 }), d => d.aim],
    ['hit', 'Hit', d => d.hit, d => d.hit],
    ['darts', 'Darts at it', d => d.darts, d => d.darts],
    ['rate', 'Rate', d => pct(d.hit, d.darts), d => d.hit / d.darts],
  ] },
  numbers: { sort: 'n', open: r => ({ v: 'number', seg: r.seg }), cols: [
    ['seg', 'Number', r => r.seg === 25 ? 'Bull and 25' : r.seg || 'Miss', r => r.seg],
    ['s', 'Singles', r => r.seg ? r.by[1] : '–', r => r.by[1]],
    ['d', 'Doubles', r => r.seg ? r.by[2] : '–', r => r.by[2]],
    ['t', 'Trebles', r => r.seg && r.seg !== 25 ? r.by[3] : '–', r => r.by[3]],
    ['n', 'All darts', r => r.n, r => r.n],
    ['share', 'Share', r => (r.share * 100).toFixed(1) + '%', r => r.n],
  ] },
  throws: { open: toMatch, cols: [
    ['when', 'When', v => when(v.ts), v => v.ts],
    ['darts', 'Darts', dartsText],
    ['total', 'Scored', v => scoredText(v, v.total), v => v.total],
    ['game', 'Game', v => `${esc(v.m.name)} ${against(v.m)}`],
  ] },
  matches: { open: m => ({ v: 'match', id: m.id }), cols: [
    ['when', 'When', m => when(m.finished ?? m.started), m => m.finished ?? m.started],
    ['players', 'Players', m => m.players.map(esc).join(', ')],
    ['winner', 'Winner', m => m.players.length > 1 ? `<b>${esc(m.players[m.winner])}</b>` : '–'],
    ['darts', 'Your darts', myDarts, myDarts],
    ['time', 'Time', m => m.duration != null ? clock(m.duration) : '–', m => m.duration ?? -1],
  ] },
};
const MOST = 500;  // lines shown of a list
function listHtml(kind, rows, top) {
  const { cols, open, sort = 'when' } = LISTS[kind];
  const by = cols.find(c => c[0] === top.by && c[3]) ? top.by : sort, desc = top.desc ?? true;
  const order = id => { const f = cols.find(c => c[0] === id)[3]; return (a, b) => f(b) - f(a); };
  Object.assign(top, { by, desc });  // so that tapping a heading knows what it is changing
  rows = [...rows].sort(order(sort));  // lines that tie stay newest (or biggest) first
  if (by !== sort || !desc) rows.sort((a, b) => order(by)(a, b) * (desc ? 1 : -1));
  return `<table class="plain"><thead><tr>${cols.map(([id, name, , sorts, cls = '']) =>
    `<th class="${cls} ${id === by ? 'sorted' : ''}"${sorts ? ` data-sort="${id}"` : ''}>${name}${id === by ? (desc ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
    ${rows.slice(0, MOST).map(r => `<tr${opens(open(r))}>${cols.map(([, , cell, , cls = '']) =>
      `<td class="${cls}">${cell(r)}</td>`).join('')}</tr>`).join('')}</table>
    ${rows.length > MOST ? `<p class="muted small">The first ${MOST} of ${rows.length} are shown.</p>` : ''}`;
}
// One game, visit by visit: a line per round, everyone side by side. An X01
// match is shown leg by leg, with what each visit left. top: its level of
// `drill`, which may name a visit (at) or a leg to point out.
function matchHtml(m, top) {
  const legs = m.game === 'x01' ? x01Legs(m) : null, game = gameById(m.game), wide = legs ? 2 : 1;
  const facts = [when(m.started), ...(legs ? [`${m.opts.out === 'straight' ? 'straight' : 'double'} out`] : []),
    m.winner == null ? 'not finished' : m.players.length > 1 ? `${esc(m.players[m.winner])} won` : 'finished',
    ...(m.duration != null ? [clock(m.duration)] : [])];
  const cell = v => {
    if (!v) return `<td colspan="${wide}"></td>`;
    const cls = v.i === top.at ? 'at' : '';
    if (legs) return `<td class="${cls}">${scoredText(v, v.score)} <span class="muted small">${dartsText(v)}</span></td>
      <td class="${cls} ${v.checkout ? 'out' : ''}">${v.after}</td>`;
    const total = game?.showTotal === false ? '' : ` <span class="muted small">${v.bust ? 'bust' : `= ${v.total}`}</span>`;
    return `<td class="${cls}">${v.darts ? dartsText(v) + total : `<b>${v.total}</b> <span class="muted small">typed</span>`}</td>`;
  };
  const rounds = visits => [...new Set(visits.map(v => v.round))].map((round, n) =>
    `<tr><td class="muted">${n + 1}</td>${m.players.map((_, p) => cell(visits.find(v => v.round === round && v.p === p))).join('')}</tr>`).join('');
  const add = f => legs.reduce((t, l, i) => t + f(l, i), 0);
  // Each player's figures over the whole match.
  const side = p => {
    const darts = add(l => l.sides[p].darts), won = add(l => +(l.winner === p));
    const nine = avg3(add(l => l.sides[p].ninePoints), add(l => l.sides[p].nineDarts));
    return tile([`${esc(m.players[p])} · average`, darts ? `${darts} darts` : '', nine != null ? `first 9 ${num(nine)}` : '',
      legs.length > 1 ? `${won} ${won === 1 ? 'leg' : 'legs'}` : legs[0].sides[p].checkout != null ? `checkout ${legs[0].sides[p].checkout}` : '']
      .filter(Boolean).join(' · '), darts ? num(avg3(add(l => l.sides[p].points), darts)) : null);
  };
  return `<p class="muted facts">${facts.join(' · ')}</p>
    ${legs?.length ? `<div class="tiles">${m.players.map((_, p) => side(p)).join('')}</div>` : ''}
    <table class="plain sheet"><thead><tr><th>Round</th>${m.players.map(p => `<th colspan="${wide}">${esc(p)}</th>`).join('')}</tr></thead>
    ${!legs ? rounds(visitsOf(m)) : legs.map(l => `${legs.length > 1 ? `<tr class="legrow"><td colspan="${1 + 2 * m.players.length}" class="${
      l.n === top.leg && top.at == null ? 'at' : ''}">Leg ${l.n} · ${l.winner == null ? 'not finished'
      : `${esc(m.players[l.winner])} in ${l.sides[l.winner].darts} darts`}</td></tr>` : ''}${rounds(l.visits)}`).join('')}</table>`;
}
const avg3 = (points, darts) => darts ? points / darts * 3 : null;
// One level of `drill` as {title, html()}, or null if the stats no longer have it.
function drillView(st, top) {
  const d = deep(st), list = (title, kind, rows) => ({ title, html: () => listHtml(kind, rows, top) });
  const some = (title, kind, rows) => rows.length ? list(`${title} (${rows.length})`, kind, rows) : null;
  if (top.v === 'tile') {
    const t = x01Tile(top.key);
    if (!t || !d.x01) return null;
    const rows = t.rows(d.x01);
    return rows.length ? list(`X01 ${t.label.toLowerCase()} ${t.kind === 'doubles' ? 'by double' : `(${rows.length} ${
      rows.length === 1 ? t.kind.slice(0, -1) : t.kind})`}`, t.kind, rows) : null;
  }
  if (top.v === 'double') return d.x01 && some(`Visits with a dart at ${label({ seg: top.aim, mult: 2 })}`, 'visits',
    d.x01.visits.filter(v => v.atDouble.some(a => a.aim === top.aim)));
  if (top.v === 'numbers') return d.mine.some(v => v.darts) ? list('Darts by number', 'numbers', dartTable(d.mine)) : null;
  if (top.v === 'number') return some(top.seg === 25 ? 'Visits with a bull or 25' : top.seg ? `Visits with a ${top.seg}` : 'Visits with a miss',
    'throws', visitsWith(d.mine, top.seg));
  if (top.v === 'matches') return some(`${esc(top.name)} games`, 'matches', d.matches.filter(m => m.name === top.name && m.winner != null));
  if (top.v === 'achievement') return achievementView(top.id, d);
  const m = top.v === 'match' && d.matches.find(m => m.id === top.id);
  return m ? { title: matchTitle(m), html: () => matchHtml(m, top) } : null;
}

// ---------- the Achievements tab ----------
// Worked out from every game the player has on record, whatever game or set of darts the page is
// showing: so when the page's own stats are only part of that, the whole is asked for as well.
const ACH_SINCE = Date.UTC(2026, 10, 22);  // games from before achievements existed earn them too: the tab says so
let achAll = null;      // {id, st}: a player's stats for all games and darts (st: null if they can't be had)
let achLoading = null;  // the player they are being fetched for
const ACH = new WeakMap();  // what is worked out from a reply, kept while that reply is
function achStats() {
  if (statsFor != null && statsFor <= 0) {  // made offline: no games anywhere but here
    if (achAll?.id !== statsFor) achAll = { id: statsFor, st: { player: { id: statsFor }, matches: [] } };
    return achAll.st;
  }
  if (statsData && !statsData.game && !statsData.set && statsData.player.id === statsFor) return statsData;
  return achAll?.id === statsFor ? achAll.st : undefined;  // undefined: not asked for yet
}
async function loadAchAll() {
  const id = statsFor;
  if (id == null || achLoading === id) return;
  achLoading = id;
  let st = null;
  try { st = await loadStats(statsPath(id), connected ? 10000 : 2500); } catch { /* shown as unavailable */ }
  achLoading = null;
  achAll = { id, st };
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
function achievementsPane(game) {
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
function achievementView(id, d) {
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
const matchTitle = m => `${esc(m.name)}${m.game === 'x01' ? ` ${m.opts.start ?? 501}` : ''}`;
function drawDrill(st, old) {
  let views;
  // Whatever can no longer be found (the stats changed underneath) is left behind.
  while (drill.length && (views = drill.map(level => drillView(st, level))).some(v => !v)) drill.pop();
  if (!drill.length) return false;
  const game = statsGame && gameById(statsGame);
  $app.innerHTML = `<div class="page">
    ${pageHead('players')}
    <div class="row under"><button class="ghost" data-act="up">‹ Back</button><h1 class="sub">${views.at(-1).title}</h1></div>
    <p class="muted small crumbs">${[esc(nameOf(statsFor)), game ? game.name : 'All games',
      ...(statsDarts ? [esc(dartsName(statsDarts))] : []), ...views.slice(0, -1).map(v => v.title)].join(' › ')}
      ${['match', 'achievement'].includes(drill.at(-1).v) ? '' : ' · tap a line for more, a heading to sort'}</p>
    ${old}<div class="fill drill">${views.at(-1).html()}</div>
    ${pageFoot('players')}
  </div>`;
  document.querySelector('.drill .at')?.scrollIntoView({ block: 'center' });
  refreshStatus();
  return true;
}

function drawPlayers() {
  const st = statsData, x = st && deep(st).x01;
  const game = statsGame && gameById(statsGame);  // the one game this page is about, if any
  if (statsFor == null) return drawNoPlayers();
  const tab = statsTab;
  const wait = statsFailed ? `<p class="muted">No stats saved on this device${statsFor < 0 ? ' for this player' : ''} yet.
      Stats are worked out on ${pi()} and kept here once it has been reached.</p>`
    : !st ? '<p class="muted">Loading…</p>' : '';
  const none = wait || (st.darts || st.detail || x ? '' : `<p class="muted">No throws recorded yet${game ? ` in ${game.name}` : ''}.</p>`);
  const message = tab === 'games' || tab === 'achievements' ? wait : none;
  const owed = data.waitingGames();
  const old = st?.saved ? `<p class="muted small stale">${Pi()} can't be reached: these are the stats
    from ${new Date(st.saved).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${
    owed ? `, without the ${owed === 1 ? 'game' : `${owed} games`} waiting to sync` : ''}.</p>` : '';
  // Where a tile leads: the darts tiles to the numbers hit, a game's own tiles to its games.
  const numbers = st?.darts && deep(st).mine.some(v => v.darts) ? { v: 'numbers' } : null;
  const gamesOf = name => deep(st).matches.some(m => m.name === name && m.winner != null) ? { v: 'matches', name } : null;
  const panes = () => `<div class="p-stats">
    ${game?.id === 'x01' ? (x ? x01Tiles(x) : '')
      : game && st.detail ? `<h2>${game.name} averages</h2><div class="tiles">${gameTiles(game.id, st.detail, gamesOf(game.name))}</div>` : ''}
    <h2>${game ? `${game.name} darts` : 'All games'}${st.since ? ` · since ${new Date(st.since).toLocaleDateString()}` : ''}</h2>
    <div class="tiles">${tile('Darts thrown', st.darts, numbers)}${tile('Time played', st.played_ms ? timeSpent(st.played_ms) : null)}${tile('Trebles', pct(st.trebles, st.darts), numbers)}
      ${tile('Doubles', pct(st.doubles, st.darts), numbers)}${tile('Bulls and 25s', st.bulls, numbers)}${tile('Misses', pct(st.misses, st.darts), numbers)}
      ${tile('Most hit', st.segments.slice(0, 3).map(g => g.seg === 25 ? 'Bull' : g.seg).join(', ') || null, numbers)}</div>
    ${x && !game ? `<h2>X01</h2><div class="tiles">${x01Tiles(x, X01_HEADLINES)}</div>` : ''}</div>
    <div class="p-games">${st.games.length ? `<h2>Finished games</h2>
    <table class="plain"><tr><th>Game</th><th>Played</th><th>Won (2+ players)</th><th>Average time</th><th>Quickest</th><th class="wide">Total time</th></tr>${st.games.map(g =>
      `<tr${opens(gamesOf(g.game))}><td>${esc(g.game)}</td><td>${g.played}</td><td>${g.won}</td>
       <td>${g.avg_ms != null ? clock(g.avg_ms) : '–'}</td><td>${g.best_ms != null ? clock(g.best_ms) : '–'}</td>
       <td class="wide">${g.total_ms ? timeSpent(g.total_ms) : '–'}</td></tr>`).join('')}</table>`
      : '<p class="muted">No finished games yet.</p>'}${gearHtml(st, game)}</div>
    <div class="p-board">${st.recent.length ? `<h2>Heat map · ${game ? `${game.name}, ` : ''}${
      st.recent.length === 1 ? '1 dart' : `${st.recent.length < 5000 ? '' : 'last '}${st.recent.length} darts`}</h2>
    <div class="statboard"><svg id="statboard"></svg></div>
    <div class="heatkey"><span>Fewer darts</span><i></i><span>More</span></div>`
      : `<p class="muted">No dart positions recorded yet${game ? ` in ${game.name}` : ''}.</p>`}</div>
    ${tab === 'achievements' ? achievementsPane(game) : ''}`;
  const lit = id => id === tab || (id === 'stats' && tab === 'board' && BIG.matches);
  if (statsFailed) drill = [];
  if (drill.length && st && drawDrill(st, old)) return;  // (still loading: the opened-up figure is drawn once the stats are here)
  $app.innerHTML = `<div class="page">
    ${pageHead('players')}
    <div class="picks">
      <label class="pick"><span>Player</span><select data-choose="player">${players.map(p =>
        `<option value="${p.id}" ${p.id === statsFor ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="pick"><span>Game</span><select data-choose="game">${[{ id: '', name: 'All games' }, ...GAMES].map(g =>
        `<option value="${g.id}" ${g.id === (statsGame ?? '') ? 'selected' : ''}>${g.name}</option>`).join('')}</select></label>
      ${setsOf(statsFor, true).length ? `<label class="pick"><span>Darts</span><select data-choose="darts">${[{ id: '', name: 'All darts' },
        ...setsOf(statsFor, true)].map(d => `<option value="${esc(d.id)}" ${d.id === (statsDarts ?? '') ? 'selected' : ''}>${
        esc(d.name)}${d.retired ? ' (put away)' : ''}</option>`).join('')}</select></label>` : ''}</div>
    <div class="row tabs">${STAT_TABS.map(([id, name]) =>
      `<button class="${lit(id) ? 'on' : ''}" data-tab="${id}">${name}</button>`).join('')}</div>
    ${old}<div class="fill panes tab-${tab}">${message || panes()}</div>
    ${pageFoot('players')}
  </div>`;
  const svg = document.getElementById('statboard');
  if (svg) buildBoard(svg).showHeat(st.recent);
  refreshStatus();
}
// How much each set of darts has been thrown, like the miles on a runner's shoes.
// A line can be tapped to see the stats of that set alone.
function gearHtml(st, game) {
  const gear = (st.gear ?? []).filter(g => g.games || g.id);
  if (!gear.some(g => g.id)) return '';
  const day = ts => ts ? new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' }) : '–';
  return `<h2>Darts${game ? ` · ${game.name}` : ''}</h2>
    <table class="plain"><tr><th>Darts</th><th>Darts thrown</th><th>Games</th><th>Won (2+ players)</th><th class="wide">First used</th><th>Last used</th></tr>${gear.map(g =>
      `<tr${g.id ? ` data-gear="${esc(g.id)}"` : ''} class="${g.id === statsDarts ? 'at' : ''}"><td>${g.id ? `<b>${esc(g.name)}</b>${
        g.grams != null ? ` <span class="muted small">${grams(g.grams)}</span>` : ''}${g.retired ? ' <span class="muted small">put away</span>' : ''}`
        : '<span class="muted">Not named</span>'}</td><td>${g.darts.toLocaleString()}</td><td>${g.games}</td><td>${g.won}</td>
       <td class="wide">${day(g.first)}</td><td>${day(g.last)}</td></tr>`).join('')}</table>
    <p class="muted small">Every dart counts towards the darts thrown, typed scores too. Tap a set to see its stats on their own.</p>`;
}
// Nobody to show stats for yet: say where players are made.
function drawNoPlayers() {
  drill = [];
  $app.innerHTML = `<div class="page">
    ${pageHead('players')}
    <div class="fill noplayers"><p class="muted">No players yet. Add one and their stats will show here.</p>
      <button data-act="manageplayers">Add a player</button></div>
    ${pageFoot('players')}
  </div>`;
  refreshStatus();
}
// The settings' Players tab: a card for each player, saying who they are and what they throw.
// One card opens at a time, and everything about that player is in it: their name, their
// sets of darts (to name, weigh, put away and bring back) and removing them. A new player
// goes underneath.
let openPlayer = null;  // the id of the player whose card is open
let dartsForm = null;   // in that card: the id of the set being changed, 'new' for one being added, or null
let dartsError = null;  // {at: a set's id or a player's id (adding), text}
function playersPanel() {
  if (!players.some(p => p.id === openPlayer)) openPlayer = dartsForm = null;
  const said = d => `${esc(d.name)}${d.grams != null ? ` ${grams(d.grams)}` : ''}`;
  // A set's name and weight, to fill in: a new set (d not given) or one being changed.
  const form = (p, d) => `<div class="pform">
      <div class="player-row"><input type="text" id="dname" value="${esc(d?.name ?? '')}" placeholder="Name, e.g. Red tungsten" maxlength="24" aria-label="Name of the darts">
        <input type="number" inputmode="decimal" id="dgrams" value="${d?.grams ?? ''}" min="1" max="100" step="0.5" placeholder="Grams" aria-label="Weight in grams"></div>
      ${dartsError?.at === (d?.id ?? p.id) ? `<p class="warn">${esc(dartsError.text)}</p>` : ''}
      <div class="row"><button class="primary" data-act="${d ? 'savedarts' : 'adddarts'}" data-id="${d ? esc(d.id) : p.id}">${d ? 'Save' : 'Add'}</button>
        ${d ? `<button data-act="retiredarts" data-id="${esc(d.id)}" data-retired="${d.retired ? 'no' : 'yes'}">${d.retired ? 'Bring back' : 'Put away'}</button>` : ''}
        <button class="ghost" data-act="closedarts">Cancel</button></div>
      ${d && !d.retired ? '<p class="muted small">Put away darts you no longer throw: they leave the Play screen, and their stats are kept.</p>' : ''}</div>`;
  const body = p => {
    const sets = setsOf(p.id, true).sort((a, b) => a.retired - b.retired);
    return `<div class="who-body">
      <h3>Name</h3>
      <div class="player-row"><input type="text" id="pname" data-rename="${p.id}" value="${esc(p.name)}" maxlength="16" aria-label="Name of ${esc(p.name)}">
        <button data-act="rename" data-id="${p.id}">Save</button></div>
      ${formError && renameFailed === p.id ? `<p class="warn">${esc(formError)}</p>` : ''}
      <h3>Darts</h3>
      ${sets.length || dartsForm === 'new' ? '' : '<p class="muted small">Add the darts they throw to see stats for each set.</p>'}
      ${sets.map(d => dartsForm === d.id ? form(p, d) : `<button class="pline ${d.retired ? 'away' : ''}" data-act="editdarts" data-id="${esc(d.id)}">
        <span>${said(d)}${d.retired ? ' <small>· put away</small>' : ''}</span><u>Change</u></button>`).join('')}
      ${dartsForm === 'new' ? form(p) : '<button class="chip ghost" data-act="newdarts">+ Add darts</button>'}
      <div class="who-end"><button class="ghost danger" data-act="remove" data-id="${p.id}">${removeArmed === p.id ? 'Tap again to remove' : `Remove ${esc(p.name)}`}</button>
        ${removeArmed === p.id ? '<p class="muted small">They leave the lists. Their throws are kept, and adding the same name again brings them back.</p>' : ''}</div>
    </div>`;
  };
  return `<div class="editplayers">
      ${players.map(p => {
        const open = p.id === openPlayer;
        return `<section class="who ${open ? 'open' : ''}">
          <button class="who-head" data-act="openplayer" data-id="${p.id}" aria-expanded="${open}"><span><b>${esc(p.name)}</b>
            <small>${setsOf(p.id).map(said).join(' · ') || 'No darts added'}</small></span><u>${open ? 'Done' : 'Edit'}</u></button>
          ${open ? body(p) : ''}</section>`;
      }).join('')}
      ${addingPlayer || !players.length ? newPlayerRow() : '<button class="chip ghost" data-act="newplayer">+ Add a player</button>'}
    </div>`;
}
function renamePlayer(id) {
  const name = document.querySelector(`[data-rename="${id}"]`).value.trim();
  if (!name || name === nameOf(id)) return;
  try {
    data.renamePlayer(id, name);
    loadPlayers();
    formError = '';
    renameFailed = null;
    data.sync();
  } catch (e) {
    formError = e.message;
    renameFailed = id;
  }
  renderSettings();
}
function removePlayer(id) {
  if (removeArmed !== id) { removeArmed = id; return renderSettings(); }
  removeArmed = false;
  data.removePlayer(id);
  loadPlayers();
  cleanSetup();
  saveSetup();
  formError = '';
  renderSettings();
}
// A set of darts in the open card: added, changed, put away or brought back. Done, its form closes;
// refused (a name already taken, a weight no dart has), the form stays and says why.
const gramsIn = el => el?.value.trim() ? +el.value : null;
function dartsDone(fn, at) {
  try { fn(); darts = store.get('darts', []); dartsError = null; dartsForm = null; data.sync(); } catch (e) { dartsError = { at, text: e.message }; }
  renderSettings();
}
const dartsTyped = () => ({ name: document.getElementById('dname').value.trim(), grams: gramsIn(document.getElementById('dgrams')) });
function addDarts(player) {
  const { name, grams } = dartsTyped();
  if (!name) return document.getElementById('dname').focus();
  dartsDone(() => {
    const first = setsOf(player).length === 0, d = data.addDarts(player, name, grams);
    // Their first set: what they are throwing from now on.
    if (first) { setup.darts = { ...setup.darts, [player]: d.id }; saveSetup(); }
  }, player);
}
const saveDarts = id => dartsDone(() => data.changeDarts(id, dartsTyped()), id);
const changeDarts = (id, changes) => dartsDone(() => data.changeDarts(id, changes), id);

// ---------- one game's scoresheet ----------
// A game that is over, opened by its own address: by a link to it, or
// by back, forward or a reload landing on a game that has since finished. It
// is looked for among the games waiting here to be sent, then on the Pi, then
// in the stats kept on this device.
let sheet = null;  // {id, name: the first part of its address, m: the match once found, gone: why it wasn't}
async function renderSheet(id, name = 'game') {
  if (account.locked) return renderLanding();
  screen = 'sheet';
  if (sheet?.id !== id) sheet = { id, name, m: data.sheet(id) };
  const want = sheet;
  want.gone = null;
  drawSheet();
  if (want.m) return;
  try {
    want.m = await loadStats(`/matches/${encodeURIComponent(id)}`, connected ? 10000 : 2500);
  } catch (e) {
    want.m = e.status ? null : await shelved(id).catch(() => null);
    want.gone = e.status ? 'This game is no longer saved.'
      : `${Pi()} can't be reached, and this game isn't among the stats kept on this device.`;
  }
  if (screen !== 'sheet' || sheet !== want) return;
  drawSheet();
  mark();  // the address now says what kind of game it is
}
// A player's saved all-games stats list every game they played in.
async function shelved(id) {
  const kept = await shelf();
  for (const req of await kept.keys()) {
    if (!req.url.endsWith('/stats')) continue;
    const st = await (await kept.match(req)).json();
    const m = st.matches?.find(m => m.id === id);
    if (m) return { ...m, saved: st.saved };
  }
  return null;
}
function drawSheet() {
  const m = sheet.m;
  $app.innerHTML = `<div class="page">
    ${pageHead('players')}
    <div class="row under"><button class="ghost" data-act="up">‹ Back</button><h1 class="sub">${m ? matchTitle(m) : 'Game'}</h1></div>
    ${m?.saved ? `<p class="muted small stale">${Pi()} can't be reached: this is the copy
      from ${new Date(m.saved).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.</p>` : ''}
    <div class="fill drill">${m ? matchHtml(m, {}) : `<p class="muted">${sheet.gone ?? 'Loading…'}</p>`}</div>
    ${pageFoot('players')}
  </div>`;
  refreshStatus();
}

// ---------- number entry ----------
// Instead of tapping each dart on the board, the whole visit can be typed in
// as one number (games with visit() only: X01, Count Up and 121 Checkout).
let padValue = '', padAsk = null, padError = '';
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
  rulesOpen = false;  // the menu, when it is next seen, starts from its games
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

// ---------- settings ----------
// The settings are a handful of sections (SECTIONS below), all drawn every time;
// style.css shows what belongs (as with the app's four places, see nav()):
//  - on a computer, a row of tabs with one section on screen at a time;
//  - on a phone, a list of the sections, each line saying how it is set. A tap
//    opens that section by itself, with a way back to the list above it;
//  - on a tablet on its side, the list down the left and the section beside it.
// Every section is made of the same few parts: a line that opens something
// (setRow), a switch for on or off (switchRow) and one of several to choose
// (pickRow), each a whole line to tap.
let settingsTab = '';      // the section on screen; '' until opened, then the first
let settingsOpen = false;  // on a phone: a section is open, not the list
let fromList = false;      // and it was opened from the list, which is the history entry under this one
const chevron = icon('<path d="M9 5l7 7-7 7"/>'), tickMark = icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
const setRow = (id, name, value) => `<button class="srow ${settingsTab === id ? 'cur' : ''}" data-sopen="${id}">
    <span><b>${name}</b>${value ? `<small>${value}</small>` : ''}</span><u>${chevron}</u></button>`;
// attr: what a tap does (the data- attribute read by the click handler), written for the way it is not now.
export const switchRow = (name, on, attr, hint = '') => `<button class="srow switchrow" role="switch" aria-checked="${on}" ${attr}>
    <span><b>${name}</b>${hint ? `<small>${hint}</small>` : ''}</span><i class="switch"></i></button>`;
const pickRow = (name, on, attr, hint = '') => `<button class="srow pickrow ${on ? 'on' : ''}" role="radio" aria-checked="${on}" ${attr}>
    <span><b>${name}</b>${hint ? `<small>${hint}</small>` : ''}</span><u>${on ? tickMark : ''}</u></button>`;
const canFeedBack = () => account.hosted ? !!account.account : !!share?.on;
// jump: open the section asked for, for someone sent to it from elsewhere.
export function renderSettings(jump) {
  if (account.locked) return renderLanding();
  if (jump) { settingsOpen = true; fromList = false; }
  const was = screen === 'settings' ? document.querySelector('.setbody') : null;
  screen = 'settings';
  const theme = applyTheme();
  const look = `<div class="settings"><div class="rows" role="radiogroup" aria-label="Theme">${THEMES.map(t =>
    pickRow(t.name, t.id === theme.id, `data-theme="${t.id}"`, t.blurb)).join('')}</div></div>`;
  const hints = settings.checkouts !== false;
  const game = `<div class="settings"><div class="rows">
    ${switchRow('Sound', settings.voice, `data-voice="${settings.voice ? 'off' : 'on'}"`, 'Calls each visit\'s total, busts, what you require and game shot.')}
    ${settings.voice ? `${switchRow('Call each dart', !!settings.eachDart, `data-eachdart="${settings.eachDart ? 'off' : 'on'}"`, 'Say every dart as it lands too, not just the total. Cricket, Killer and the practice games call each dart anyway.')}
    ${voicePicker()}` : ''}
    ${switchRow('Checkout hints', hints, `data-checkouts="${hints ? 'off' : 'on'}"`, 'Switch off to practise working out your finishes yourself.')}
    ${switchRow('Show achievements as they are earned', achievementsOn(), `data-achievements="${achievementsOn() ? 'off' : 'on'}"`, 'A first 180, a big finish and the like are shown, and called, as they happen. Off, they are still kept on the Stats page.')}
    ${switchRow('Keep a picture of the board with an achievement', photosOn() === true, `data-photos="${photosOn() === true ? 'off' : 'on'}"`, 'When a camera scores the dart that earns one. Kept with your games and nowhere else, and deleted with the game.')}
    ${switchRow('Show the bot\'s darts landing', settings.flight !== false, `data-flight="${settings.flight !== false ? 'off' : 'on'}"`, 'Against the computer, each of its darts flies in to where it lands on the board.')}
    ${botHoldPicker()}
    </div></div>`;
  // [id, its name, its name on a tab, how it is set (the list says), the section]: in the list's groups
  const groups = [
    account.hosted && account.account ? [['acct', 'Account', 'Account', esc(account.account.nickname ?? ''), accountPanel()]] : [],
    [['players', 'Players and darts', 'Players', esc(players.map(p => p.name).join(', ')) || 'Nobody yet', playersPanel()]],
    [['look', 'Theme', 'Theme', theme.name, look],
      ['game', 'In game', 'In game', `${settings.voice && !voice.none() ? `Sound on${settings.eachDart ? ', each dart' : ''}` : 'Sound off'} · ${hints ? 'checkout hints on' : 'checkout hints off'}`, game]],
    [...(!account.hosted && share ? [['share', 'Sharing', 'Sharing', share.on ? 'On' : 'Off', sharePanel()]] : []),
      ...(canFeedBack() ? [['feedback', 'Send feedback', 'Feedback', '', `<div class="settings">${feedbackBox()}</div>`]] : []),
      ['about', 'About', 'About', appRelease() && `Version ${esc(appRelease())}`, aboutPanel()]],
  ].filter(g => g.length);
  const tabs = groups.flat();
  if (settingsTab === 'darts') settingsTab = 'players';  // once a tab of their own
  if (settingsTab === 'sound' || settingsTab === 'play') settingsTab = 'game';  // and these two, one each
  if (!tabs.some(t => t[0] === settingsTab)) { settingsTab = tabs[0][0]; settingsOpen = false; }
  const view = settingsOpen ? settingsTab : '';
  $app.innerHTML = `<div class="page setpage ${settingsOpen ? 'insect' : 'atlist'}">
    ${pageHead('settings')}
    <div class="row tabs stabs">${tabs.map(([id, , name]) =>
      `<button class="${settingsTab === id ? 'on' : ''}" data-stab="${id}">${name}</button>`).join('')}</div>
    <div class="sethead"><button class="ghost sback" data-act="sback">${icon('<path d="M15 5l-7 7 7 7"/>')}Settings</button></div>
    <div class="fill setbody" data-view="${view}">
      <nav class="setlist" aria-label="Settings">${groups.map(g =>
        `<div class="rows">${g.map(([id, name, , value]) => setRow(id, name, value)).join('')}</div>`).join('')}</nav>
      <div class="setsects">${tabs.map(([id, name, , , html]) =>
        `<section class="sect ${settingsTab === id ? 'on' : ''}"><h2>${name}</h2>${html}</section>`).join('')}</div>
    </div>
    ${pageFoot('settings')}
  </div>`;
  if (was?.dataset.view === view) document.querySelector('.setbody').scrollTop = was.scrollTop;  // a tap redraws: stay where it was
  refreshStatus();
  fit();
}
// A section opened from the list (on a phone, a step that Back undoes), and the way back to the list.
function openSection(id) {
  const step = STACKED.matches && !SPLIT.matches && !settingsOpen;
  settingsTab = id;
  settingsOpen = true;
  if (step) fromList = true;
  renderSettings();
  mark(step);
  if (step) document.querySelector('.sback')?.focus();
}
function closeSection() {
  if (fromList && depth) return history.back();
  settingsOpen = false;
  renderSettings();
  mark();
}

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
function renderWelcome() {
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
  camAdding = camFirst = camera; camStep = camNote = '';
  open({ screen: camera ? 'cameras' : 'home' });
}

// ---------- cameras & calibration ----------
// A screen of its own. One camera is shown at a time: its picture, and beside
// it the one thing that camera needs next (lining up with the board, a tap on
// the picture, nothing: it is ready). Adding a camera is a step aside from that.
let calib = {};  // camera id -> points tapped so far
let autoCal = null;  // camera id waiting for a tap on the 20, for auto-calibration
let calibBusy = false;  // the Pi is looking for the board in a camera's picture
let calibNote = '';  // how the last calibration went
let calibFailed = false;  // ...and whether that was badly
let startCal = '';  // finding the board again on opening the app: '' not yet, 'wait' (for the settings), 'busy', 'done'
let camShown = 0;  // the camera on screen
let camSearch = false;  // the Pi is looking for its cameras again
let camAdding = false;  // "Add a camera" is open
let camFirst = false;  // ...opened by the desktop app's first screens: asked as if there were no camera yet
let camNote = '';  // why the cameras could not be changed
let camStep = '';  // adding one: '' which kind, then 'usb' or 'phone'
let camStatus = null;  // what the Pi last said about its cameras
let camAddress = '';  // an address typed into "Add a phone", kept while it is refused
async function renderCameras() {
  if (account.locked) return renderLanding();
  screen = 'cameras';
  if (!document.querySelector('.camstage, .camsetup')) drawCameras(undefined);  // something to look at meanwhile
  if (account.hosted && account.account) await account.refresh().catch(() => {});  // are their cameras connected?
  if (!account.hosted) linkInfo = await api('/link', 'GET', undefined, 4000).catch(() => null);
  let status = null;
  try { status = await api('/status', 'GET', undefined, 6000); } catch { /* no Pi, or no cameras connected */ }
  if (account.hosted) await phone.offered();
  if (screen !== 'cameras') return;
  watchLink();
  drawCameras(status);
}
function drawCameras(status) {
  const cams = status?.cameras ?? [];
  const cam = cams.find(c => c.id === camShown) ?? cams[0];
  const wait = text => `<p class="dim camwait">${text}</p>`;
  if (status) camStatus = status;
  $app.innerHTML = `<div class="page">
    ${pageHead('cameras')}
    ${camSearch ? wait('Looking for cameras…')
      : status === undefined ? wait(`Looking for ${account.hosted ? 'your cameras' : 'cameras'}…`)
      : account.hosted && !status ? hostedCameras()
      : !status ? `${wait('The cameras aren\'t answering. You can still score by tapping the board.')}
    <div class="row"><button data-act="pair-retry">Try again</button></div>`
      : camAdding || !cam ? camSetup(status, cam) : camPanel(status, cams, cam)}
    ${pageFoot('cameras')}
  </div>`;
  refreshStatus();
  fit();
  watchUsb(status);
}

// One camera: which one, its picture, and what to do about it.
function camPanel(status, cams, cam) {
  const pts = calib[cam.id];
  const wantTwenty = autoCal === cam.id;
  const lined = !!cam.points;
  const another = cams.find(c => c.id !== cam.id && c.ok && !c.points);  // one still to be lined up
  const auto = (label, cls = '') => `<button class="${cls}" data-autocal="${cam.id}" ${lined ? 'data-has="1"' : ''}>${label}</button>`;
  const byHand = `<button data-calib="${cam.id}">Mark it by hand</button>`;
  // [how it looks, the headline, what to do, the buttons]: the first that applies
  const [look, head, text, acts] =
    !cam.ok ? ['bad', 'No picture', cam.kind === 'added'
        ? 'Can\'t reach this camera. Check the address and that the phone app is running.'
        : 'Check the camera is plugged in, then look again.',
      '<button class="primary" data-act="refreshcams">Look again</button>']
    : calibBusy ? ['', 'Looking for the board…', 'This takes a few seconds.', '']
    : wantTwenty ? ['now', 'Tap the 20', 'Tap anywhere inside the <b>20</b> segment on the picture. That shows which way up the board is.',
      `<button data-autocal="${cam.id}">Cancel</button>`]
    : pts ? ['now', `Point ${pts.length + 1} of 4`,
      `Tap the picture where the <b>outer double wire</b> meets the wire between <b>${esc(status.targets[pts.length])}</b>.`,
      `<button data-calib="${cam.id}">Cancel</button>`]
    : calibFailed ? ['bad', 'Couldn\'t find the board', `${esc(calibNote)} Check the whole board is in the picture and well lit, with no darts in it.`,
      auto('Try again', 'primary') + byHand]
    : !lined ? ['now', 'Line it up with the board', 'Point the camera so the whole board is in the picture. Take the darts out, then press <b>Find the board</b>.',
      auto('Find the board', 'primary') + byHand]
    : ['ok', 'Ready to score', 'The green lines should sit on the board\'s wires, with the green 20 in the 20. If they don\'t, find the board again.',
      (another ? `<button class="primary" data-showcam="${another.id}">Next camera</button>` : '<button class="primary" data-act="home">Done</button>')
        + auto('Find the board again') + byHand];
  const quiet = pts || wantTwenty || calibBusy;  // in the middle of lining up: nothing else to look at
  const extra = (text, buttons) => `<div class="camextra"><span class="dim">${text}</span>${buttons}</div>`;
  return `
    <div class="row camtabs">${cams.map(c => `<button class="${c.id === cam.id ? 'on' : ''}" data-showcam="${c.id}"
        title="${!c.ok ? 'No picture' : c.points ? 'Ready to score' : 'Not lined up yet'}"><span class="dot ${c.ok && c.points ? 'ok' : ''}"></span>${esc(c.label)}</button>`).join('')}
      ${status.fixed ? '' : '<button class="ghost camnew" data-act="camadd">+ Add a camera</button>'}</div>
    ${camNote ? `<p class="warn">${esc(camNote)}</p>` : ''}
    <div class="cambody fill">
      <div class="camstage">${cam.ok ? `<div class="camview ${pts || wantTwenty ? 'tapping' : ''}" data-cam="${cam.id}">
        <img src="/api/cameras/${cam.id}/snapshot.jpg?overlay=${pts || wantTwenty ? 0 : 1}&t=${Date.now()}" alt="">
        ${(pts ?? []).map(p => `<i style="left:${p.fx * 100}%;top:${p.fy * 100}%"></i>`).join('')}
      </div>` : '<span class="dim">No picture</span>'}</div>
      <div class="camside">
        <div class="camstate ${look}"><b>${head}</b><p>${text}</p>
          ${acts ? `<div class="row">${acts}</div>` : ''}
          ${calibNote && !calibFailed && look === 'ok' ? `<p class="dim">${esc(calibNote)}</p>` : ''}</div>
        ${quiet ? '' : `${lined && cam.ok ? extra('Scoring stuck, or darts missed? Take the darts out, then press:', '<button data-act="reset">Board is empty now</button>') : ''}
        ${status.fixed ? '' : extra(cam.kind === 'added' ? 'Not using this camera any more?' : 'Not for the board (a laptop\'s own webcam, say)?',
          `<button data-camoff="${esc(cam.name)}">Switch off</button>${cam.kind === 'added' ? `<button class="danger" data-camremove="${esc(cam.name)}">Remove</button>` : ''}`)}
        ${cams.some(c => c.points) ? `<div class="camextra">${switchRow('Auto-calibrate on start', settings.autoCal !== false,
          `data-autostart="${settings.autoCal !== false ? 'off' : 'on'}"`, 'Every camera finds the board again each time the app opens.')}</div>` : ''}
        ${linkRow()}${account.hosted && account.helper ? `<div class="camextra">${unpairButton()}</div>` : ''}`}
      </div>
    </div>`;
}

// No cameras yet, or "Add a camera": one question at a time. Which kind of
// camera; then for a USB one nothing to press (it is looked for until it turns
// up), and for a phone its address. Nothing can be added when the cameras were
// named on the command line.
function camSetup(status, cam) {
  if (camFirst) cam = null;
  const off = kind => (status.off ?? []).filter(o => (o.kind === 'added') === (kind === 'added'));
  const offRows = kind => off(kind).map(o => `<div class="camoff"><span><b>${esc(o.label)}</b> is switched off</span>
      <button class="primary" data-camon="${esc(o.name)}">Use this camera</button></div>`).join('');
  const back = camStep ? '<button class="ghost" data-act="cam-step">‹ Back</button>'
    : cam ? '<button class="ghost" data-act="camadd-done">‹ Back to the cameras</button>' : '';
  const note = camNote ? `<p class="warn">${esc(camNote)}</p>` : '';
  const step = camStep === 'usb' ? `<b class="camlead">Plug in your USB camera</b>
      <p class="dim">Plug it into ${account.hosted ? 'the computer by your board' : 'this computer'} and point it at the board.
        There is nothing to press: it shows up here by itself.</p>
      ${note}${offRows('usb')}
      <p class="camseek dim"><span class="dot"></span>Looking for ${off('usb').length ? 'another camera' : 'a camera'}…</p>`
    : camStep === 'phone' ? `<b class="camlead">Use a phone or network camera</b>
      <ol><li>On the phone, install an IP-webcam app and start it.</li>
        <li>Stand the phone where it sees the whole board.</li>
        <li>Type the address the app shows:</li></ol>
      <div class="row camadd"><input type="text" id="cam-address" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false"
        placeholder="http://192.168.1.50:8080/video" aria-label="The camera's address" value="${esc(camAddress)}">
        <button class="primary" data-act="addcam">Add camera</button></div>
      ${note}${offRows('added')}`
    : `<b class="camlead">${cam ? 'Add a camera' : 'Which camera will you use?'}</b>
      <p class="dim">${cam ? 'Which kind is it?' : 'Darts S.A.M scores by itself with a camera pointed at the board.'}</p>
      ${note}
      <div class="camkinds">
        <button class="game-card" data-act="cam-usb"><b>USB camera</b><span>A webcam plugged in by the board. What most people use.</span></button>
        ${status.fixed ? '' : '<button class="game-card" data-act="cam-phone"><b>Phone or network camera</b><span>A phone running an IP-webcam app, on the same Wi-Fi.</span></button>'}
      </div>
      ${cam ? '' : '<p class="camskip"><button class="ghost" data-act="home">No camera: score by tapping the board</button></p>'}
      ${!cam && account.hosted && account.helper ? `<div class="row camlink">${unpairButton()}</div>` : ''}`;
  return `<div class="camsetup fill">${back ? `<div class="row">${back}</div>` : ''}<div class="camwizard">${step}</div></div>`;
}
// The USB step with no camera running: look again every few seconds until one is there.
let usbWatch = null;
function watchUsb(status) {
  clearTimeout(usbWatch);
  const here = () => onCamerasTab() && camStep === 'usb' && !camSearch;
  if (!here() || !status || status.cameras.length) return;
  usbWatch = setTimeout(async () => {
    if (!here()) return;
    const now = await api('/cameras/refresh', 'POST', undefined, 30000).catch(() => null);
    if (!here()) return;
    if (now?.cameras.length) { cameraCount = now.scoring; camStep = ''; camAdding = false; camShown = now.cameras[0].id; return drawCameras(now); }
    if (now && JSON.stringify(now.off) !== JSON.stringify(status.off)) return drawCameras(now);
    watchUsb(now ?? status);
  }, 3000);
}
// "USB camera" chosen. With none running the step itself keeps looking; with
// some, look once and go back to them, saying so if there is nothing new.
async function usbChosen() {
  const had = camStatus?.cameras.length ?? 0;
  camNote = '';
  if (!had) { camStep = 'usb'; return renderCameras(); }
  // Asked first of all, with a camera here already: that may well be the one they mean. Show what there is.
  if (camFirst) { camFirst = false; return void changeCameras('/cameras/refresh'); }
  const now = await changeCameras('/cameras/refresh');
  if (now && now.cameras.length <= had && onCamerasTab()) {
    camNote = 'No new camera found. Check it is plugged in, then try Add a camera again.';
    drawCameras(now);
  }
}

// ---------- cameras and the hosted site ----------
// The cameras are plugged into a computer at home running this same server
// (the "helper"). It is paired once with the person's account by a code it
// shows, and from then on the hosted app reaches the cameras through the site.
let pairCode = '';        // hosted: the code being typed (or come with the link the helper showed)
let pairNote = '';        // hosted: what went wrong
let pairWaiting = false;  // hosted: code accepted, waiting for the helper to connect
let unpairAsk = false;    // hosted: "Disconnect cameras" pressed once
let linkInfo = null;      // the helper's own page: GET /api/link
let linkNote = '';
// Hosted, and the cameras can't be asked anything: say why, and what to do.
function hostedCameras() {
  const note = pairNote ? `<p class="warn">${esc(pairNote)}</p>` : '';
  if (!account.account) return `<p class="dim">${pairCode ? 'Sign in, then press Connect.' : 'Sign in to connect your cameras.'}</p>
    <div class="row"><button data-stab="acct">Sign in</button></div>`;
  if (pairWaiting) return '<p class="dim">Waiting for your cameras…</p>';
  // one step of the cameras' wizard, as camSetup()'s are: once connected, that asks which kind of camera
  if (!account.helper) return `<div class="camsetup fill"><div class="camwizard pairing">
    <b class="camlead">Connect your cameras</b>
    <p class="dim">The cameras plug into a computer by your board. Darts S.A.M runs on it and sends each dart here.</p>
    <ol><li>On that computer, start Darts S.A.M.
        <a href="download.html" target="_blank" rel="noopener">Download it for Mac, Windows or Linux</a></li>
      <li>In its window, open <b>Cameras</b> and press <b>Connect to your account</b>. It shows a 6-letter code.</li>
      <li>Type the code here:</li></ol>
    <div class="row camadd"><input type="text" id="pair-code" maxlength="12" autocapitalize="characters" autocomplete="off"
        spellcheck="false" placeholder="ABC234" aria-label="The code" value="${esc(pairCode)}"><button class="primary" data-act="pair">Connect</button></div>
    ${note}
    <p class="camskip"><button class="ghost" data-act="home">No camera: score by tapping the board</button></p></div>${phoneOffer()}</div>`;
  return `<p class="dim">${account.helper.connected ? 'Your cameras\' computer didn\'t answer.'
      : 'Your cameras\' computer isn\'t connected. Check it is switched on and Darts S.A.M is running.'}</p>
    ${note}<div class="row"><button data-act="pair-retry">Try again</button>${unpairButton()}</div>${phoneOffer()}`;
}
// This phone's own camera instead of a computer's (phoneui.js), where it can be used.
function phoneOffer() {
  if (!phone.offeredNow()) return '';
  return `<div class="camwizard phoneoffer"><b class="camlead">Or use this Device Camera <span class="beta">Beta</span></b>
    <p class="dim">${phone.on() ? esc(phone.statusText())
      : 'No computer needed: stand this device beside the board and it scores by itself. It is new, so it gets some darts wrong, and asks when it isn\'t sure.'}</p>
    <div class="row"><button class="primary" data-act="phonecam">${phone.on() ? 'Open the Device Camera' : 'Use this Device Camera'}</button></div></div>`;
}
function unpairButton() {
  if (!account.hosted || !account.helper) return '';
  return unpairAsk ? '<span class="dim">Disconnect them from your account?</span><button class="danger" data-act="unpair-yes">Disconnect</button><button data-act="unpair-no">Keep</button>'
    : '<button data-act="unpair" title="Stop using these cameras with your account">Disconnect cameras</button>';
}
async function pairCameras() {
  pairCode = document.getElementById('pair-code').value;
  pairNote = '';
  try {
    await call('/api/pair/claim', 'POST', { code: pairCode });
  } catch (e) {
    pairNote = e.signedOut ? 'You are no longer signed in.' : e.message;
    return renderCameras();
  }
  pairCode = '';
  pairWaiting = true;
  if (onCamerasTab()) drawCameras(null);
  // the helper asks the site every couple of seconds whether its code was typed, then connects
  for (let i = 0; i < 15 && !account.helper?.connected; i++) {
    await new Promise(done => setTimeout(done, 2000));
    await account.refresh().catch(() => {});
  }
  pairWaiting = false;
  if (onCamerasTab()) renderCameras();
}
async function unpairCameras() {
  unpairAsk = false;
  try { await call('/api/helper', 'DELETE'); } catch (e) { pairNote = e.message; }
  if (onCamerasTab()) renderCameras();
}
const onCamerasTab = () => screen === 'cameras';

// The helper's own page: use these cameras with an account on the hosted site.
function linkRow() {
  const l = linkInfo;
  if (account.hosted || !l?.host) return '';
  const site = esc(l.host.replace(/^https?:\/\//, ''));
  const note = linkNote ? `<span class="warn">${esc(linkNote)}</span>` : '';
  if (l.code) return `<div class="row camlink"><span>Code: <b class="paircode">${esc(l.code.slice(0, 3))} ${esc(l.code.slice(3))}</b></span>
      <span class="dim">Type this code at <a href="${esc(l.url)}" target="_blank" rel="noopener">${site}</a> → Cameras.
      It works for 10 minutes.</span></div>`;
  if (!l.paired) return `<div class="row camlink"><span class="dim">Use these cameras at ${site}</span>
      <button data-act="link-pair">Connect to your account</button>${note}</div>`;
  return `<div class="row camlink"><span class="dim">${l.connected ? 'Connected to your online account' : 'Paired with your online account · not connected right now'}</span>
      <button data-act="link-unpair">Disconnect</button>${note}</div>`;
}
async function linkDo(method, path) {
  linkNote = '';
  try { await api(path, method); } catch (e) { linkNote = e.message; }
  if (onCamerasTab()) renderCameras();
}
// While a code is waiting to be typed on the site, look every 2 s for it to have worked.
let linkWatch = null;
function watchLink() {
  clearTimeout(linkWatch);
  if (account.hosted || !(linkInfo?.code || (linkInfo?.paired && !linkInfo.connected))) return;
  linkWatch = setTimeout(async () => {
    if (!onCamerasTab()) return;
    const was = JSON.stringify(linkInfo);
    linkInfo = await api('/link', 'GET', undefined, 4000).catch(() => linkInfo);
    if (!onCamerasTab()) return;
    if (JSON.stringify(linkInfo) !== was && !Object.keys(calib).length && autoCal == null) return renderCameras();
    watchLink();
  }, 2000);
}

export const onAccountTab = () => screen === 'settings' && (sectShown('acct') || sectShown('share') || sectShown('feedback') || listShown());

// Have the Pi look for its cameras again, as restarting it would: for one plugged
// in late, or one that came back under another number. With a path and body,
// first change which cameras it uses (add, remove, switch off or on).
const refreshCameras = () => changeCameras('/cameras/refresh');
async function changeCameras(path, body) {
  if (camSearch) return;
  // camera numbers are about to change: drop anything that refers to them
  camSearch = true; calib = {}; autoCal = null; calibNote = camNote = ''; calibFailed = false; camShown = 0;
  camAddress = body?.address ?? '';
  drawCameras(null);
  let status = null;
  try {
    status = await api(path, 'POST', body, 30000);
    cameraCount = status.scoring;
    camAdding = false; camStep = '';
    if (body?.address) { camAddress = ''; camShown = status.cameras.at(-1)?.id ?? 0; }  // show the one just added
    else camShown = (status.cameras.find(c => c.ok && !c.points) ?? status.cameras[0])?.id ?? 0;  // or the first with something to do
  } catch (err) {
    camNote = err.message;
  }
  camSearch = false;
  if (screen !== 'cameras') return refreshStatus();
  status ? drawCameras(status) : renderCameras();
  return status;
}

function addCamera() {
  return changeCameras('/cameras', { address: document.getElementById('cam-address').value });
}

// Auto-calibrate one camera. `twenty` is a tapped pixel in the 20 segment; left
// out, the Pi uses the camera's existing calibration to know which way is up.
async function autoCalibrate(camId, twenty) {
  autoCal = null;
  calibBusy = true; calibNote = ''; calibFailed = false;
  drawCameras(await api('/status', 'GET', undefined, 4000).catch(() => null));
  try {
    const r = await api(`/cameras/${camId}/autocalibration`, 'POST', { twenty });
    calibNote = `Board found: ${r.joins} of 40 points, within ${r.rms_px} px.`;
    cameraCount = Math.max(cameraCount, 1);
    tracker.track('calibrated', { ok: true, how: 'auto', joins: r.joins, rms_px: r.rms_px, tapped: !!twenty });
  } catch (err) {
    calibNote = err.message; calibFailed = true;
    tracker.track('calibrated', { ok: false, how: 'auto', why: err.message, tapped: !!twenty });
  }
  calibBusy = false;
  if (onCamerasTab()) renderCameras();
}

// Each time the app is opened, or someone signs in: every camera that has been
// lined up before finds the board again, one after another, with nothing to
// press. A camera gets nudged between one evening and the next, and this saves
// going through them by hand. It is asked for on each hello from the cameras'
// computer and done once. A camera never lined up is left alone (it needs a tap
// on the 20 first), and one that can't find the board keeps the line-up it had.
// Not under a game: there may be darts in the board. Settings: autoCal.
async function calibrateOnStart() {
  if (startCal) return;
  if (account.hosted && !(account.account && helperLinked)) return;  // their cameras can't be reached yet
  startCal = 'wait';
  // the settings as they were last saved, from any device: is this switched off?
  await Promise.race([data.sync(true).catch(() => {}), new Promise(done => setTimeout(done, 5000))]);
  if (settings.autoCal === false || screen === 'game' || screen === 'bull') { startCal = 'done'; return; }
  startCal = 'busy';
  let todo = [];
  for (let tries = 0; tries < 5; tries++) {  // a camera just switched on has no picture for a moment
    const status = await api('/status', 'GET', undefined, 6000).catch(() => null);
    if (!status) { startCal = ''; return refreshStatus(); }  // not reached: the next hello asks again
    const lined = status.cameras.filter(c => c.points);
    todo = lined.filter(c => c.ok);
    if (todo.length === lined.length) break;
    await new Promise(done => setTimeout(done, 2000));
  }
  if (!todo.length) { startCal = 'done'; return refreshStatus(); }
  calibBusy = true; calibNote = ''; calibFailed = false;
  refreshStatus();
  if (onCamerasTab()) renderCameras();
  const missed = [];
  for (const cam of todo) {
    try {
      const r = await api(`/cameras/${cam.id}/autocalibration`, 'POST', { idle: true }, 30000);
      tracker.track('calibrated', { ok: true, how: 'start', joins: r.joins, rms_px: r.rms_px, tapped: false });
    } catch (err) {
      missed.push(cam.label);
      tracker.track('calibrated', { ok: false, how: 'start', why: err.message, tapped: false });
    }
  }
  calibBusy = false; startCal = 'done';
  const n = todo.length - missed.length;
  calibNote = !missed.length ? `Board found again on ${n === 1 ? 'the camera' : n === 2 ? 'both cameras' : `all ${n} cameras`} when the app opened.`
    : `Couldn't find the board again on ${missed.join(', ')} when the app opened, so ${missed.length > 1 ? 'they keep' : 'it keeps'} the line-up from before.`;
  refreshStatus();
  if (onCamerasTab()) renderCameras();
}

async function calibTap(camId, img, e) {
  const pts = calib[camId];
  const r = img.getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  if (autoCal === camId) return autoCalibrate(camId, [fx * img.naturalWidth, fy * img.naturalHeight]);
  if (!pts) return;
  pts.push({ fx, fy, x: fx * img.naturalWidth, y: fy * img.naturalHeight });
  if (pts.length === 4) {
    delete calib[camId];
    await fetch(`/api/cameras/${camId}/calibration`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: pts.map(p => [p.x, p.y]) }),
    });
    cameraCount = Math.max(cameraCount, 1);
    calibNote = ''; calibFailed = false;
    tracker.track('calibrated', { ok: true, how: 'manual' });
  }
  renderCameras();
}

// The tracker is told the board is empty as it stands: what it takes to be darts is forgotten.
async function resetDetection() {
  calibFailed = false;
  calibNote = await fetch('/api/reset', { method: 'POST' }).then(r => r.ok, () => false)
    ? 'Done: the board is taken as empty.' : 'That didn\'t reach the cameras. Try again.';
  if (onCamerasTab()) renderCameras();
}

// ---------- events ----------
$app.addEventListener('click', e => {
  const camview = e.target.closest('.camview');
  if (camview && e.target.tagName === 'IMG') return calibTap(+camview.dataset.cam, e.target, e);
  const b = e.target.closest('button, a[data-act], [data-drill], [data-sort], [data-sheet], [data-gear], [data-slip]');  // tiles and lines can be tapped too
  if (!b) return;
  if (b.tagName === 'A') e.preventDefault();  // a link that does something on this page instead (see siteHead)
  const d = b.dataset;
  if (d.act !== 'remove') removeArmed = false;
  if (d.act !== 'addplayer' && d.act !== 'rename' && d.act !== 'remove') formError = '';
  if (!/darts$/.test(d.act ?? '')) dartsError = null;
  if (d.act !== 'addplayer') addingPlayer = d.act === 'newplayer';
  if (d.game) {
    // chosen: on to the next step, or to the players when nobody is down to play
    setup.gameId = d.game;
    optHelp = null;  // the "?" that was open belonged to the last game's options
    homeStep = gameById(d.game).options.length ? 'options' : setup.players.length ? null : 'players';
    stepMoved = true;
    saveSetup();
    return renderHome();
  }
  if (d.act === 'rules') {
    rulesOpen = rulesMoved = !rulesOpen;
    if (rulesOpen) { if (rules && !(rules instanceof Promise) && !Object.keys(rules).length) rules = null; loadRules(); }
    return renderHome();
  }
  if (d.opthelp) { optHelp = optHelp === d.opthelp ? null : d.opthelp; return renderHome(); }
  if (d.step && !d.opt) { homeStep = homeStep === d.step ? null : d.step; stepMoved = true; return renderHome(); }
  if (d.step) {
    const o = gameById(setup.gameId).options.find(o => o.key === d.opt);
    setup.opts[d.opt] = Math.min(o.max, Math.max(o.min, setup.opts[d.opt] + +d.step));
    saveSetup();
    return renderHome();
  }
  if (d.opt) { setup.opts[d.opt] = JSON.parse(d.val); saveSetup(); return renderHome(); }
  if (d.usedarts) { setup.darts = { ...setup.darts, [d.usedarts]: d.set }; saveSetup(); return renderHome(); }
  if (d.gear !== undefined) { statsDarts = d.gear || null; drill = []; statsTab = 'stats'; renderPlayers(); return mark(); }
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
  if (d.tab) { statsTab = d.tab; drawPlayers(); return mark(); }
  if (d.slip !== undefined) return slipTapped();
  if (d.drill) { drill.push(JSON.parse(d.drill)); drawPlayers(); return mark(true); }
  if (d.sort) {
    const top = drill.at(-1);
    top.desc = top.by === d.sort ? !top.desc : true;
    top.by = d.sort;
    drawPlayers();
    return mark();
  }
  if (d.nav) return goTo(d.nav);
  if (d.stab) { settingsTab = d.stab; renderSettings(); return mark(); }
  if (d.sopen) return openSection(d.sopen);
  if (d.camremove) return changeCameras('/cameras/remove', { name: d.camremove });
  if (d.camoff) return changeCameras('/cameras/enabled', { name: d.camoff, on: false });
  if (d.camon) return changeCameras('/cameras/enabled', { name: d.camon, on: true });
  if (d.showcam) { camShown = +d.showcam; camAdding = false; calib = {}; autoCal = null; calibNote = camNote = ''; calibFailed = false; return renderCameras(); }
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
    if (calib[d.calib]) delete calib[d.calib]; else calib[d.calib] = [];
    autoCal = null; calibNote = ''; calibFailed = false;
    return renderCameras();
  }
  if (d.autocal) {
    const id = +d.autocal;
    delete calib[id];
    if (autoCal === id) { autoCal = null; return renderCameras(); }
    if (b.dataset.has) return autoCalibrate(id);
    autoCal = id; calibNote = ''; calibFailed = false;
    return renderCameras();
  }
  switch (d.act) {
    case 'addplayer': return addPlayer();
    case 'newplayer':
      if (screen !== 'settings') { homeStep = 'players'; return renderHome(); }
      openPlayer = dartsForm = null;
      renderSettings();
      return document.getElementById('newplayer')?.focus();
    case 'openplayer': openPlayer = openPlayer === +d.id ? null : +d.id; dartsForm = null; return renderSettings();
    case 'editdarts': dartsForm = d.id; dartsError = null; return renderSettings();
    case 'newdarts': dartsForm = 'new'; dartsError = null; renderSettings(); return document.getElementById('dname')?.focus();
    case 'closedarts': dartsForm = dartsError = null; return renderSettings();
    case 'rename': return renamePlayer(+d.id);
    case 'remove': return removePlayer(+d.id);
    // To the players' cards: with one player down to play theirs is open, and with nobody to list, the box for a name.
    case 'manageplayers':
      settingsTab = 'players';
      openPlayer = setup.players.length === 1 ? setup.players[0] : null;
      dartsForm = null;
      addingPlayer = !players.length;
      renderSettings(true);
      return mark(true);
    case 'adddarts': return addDarts(+d.id);
    case 'savedarts': return saveDarts(d.id);
    case 'retiredarts': return changeDarts(d.id, { retired: d.retired === 'yes' });
    case 'players': drill = []; renderPlayers(); return mark(true);
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
    case 'bull-random': { const { act } = bull; clearTimeout(bull.timer); bull = null; return startMatch(act, randomOrder()); }
    case 'bull-start': return bullStart();
    case 'resume': renderGame(); return mark(true);
    case 'quit': return askQuit();
    case 'home': return goHome();
    case 'settings': settingsOpen = fromList = false; renderSettings(); return mark(true);
    case 'cameras': camAdding = false; camStep = camNote = ''; renderCameras(); return mark(true);
    case 'camadd': camAdding = true; camFirst = false; camStep = camNote = ''; return renderCameras();
    case 'camadd-done': camAdding = false; camStep = camNote = ''; return renderCameras();
    case 'cam-step': camStep = camNote = ''; return renderCameras();
    case 'cam-usb': return usbChosen();
    case 'welcome-name': return welcomeNamed();
    case 'welcome-back': welcomeStep = welcomeNote = ''; return renderWelcome();
    case 'welcome-cam': return finishWelcome(true);
    case 'welcome-nocam': return finishWelcome(false);
    case 'cam-phone': camStep = 'phone'; camNote = ''; renderCameras().then(() => document.getElementById('cam-address')?.focus()); return;
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
    case 'pair-retry': pairNote = ''; return renderCameras();
    case 'phonecam': return phone.open();
    case 'unpair': unpairAsk = true; return renderCameras();
    case 'unpair-no': unpairAsk = false; return renderCameras();
    case 'unpair-yes': return unpairCameras();
    case 'link-pair': return linkDo('POST', '/link/pair');
    case 'link-unpair': return linkDo('DELETE', '/link');
    case 'feedback': return sendFeedback();
    case 'apple': return appleSignIn();
    case 'download': return location.assign('download.html');
    case 'land-home': return document.querySelector('.site').scrollTo({ top: 0, behavior: 'smooth' });
    case 'land-top': if (account.front) return location.assign(account.app);  // signing in is at the app's address
      return document.getElementById('signin').scrollIntoView({ behavior: 'smooth', block: 'center' });
    case 'mail': mailStep = 'ask'; landNote = ''; renderLanding(); return document.getElementById('mail-addr').focus();
    case 'mail-send': return sendCode();
    case 'mail-code': return signIn('email', { email: mailTo, code: document.getElementById('mail-code').value });
    case 'mail-back': mailStep = 'ask'; landNote = ''; renderLanding(); return document.getElementById('mail-addr').focus();
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
  drill = [];
  if (choose === 'game') statsGame = e.target.value || null;
  if (choose === 'darts') statsDarts = e.target.value || null;
  if (choose === 'player') statsDarts = null;  // sets belong to one player
  renderPlayers(choose === 'player' ? +e.target.value : statsFor);
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
