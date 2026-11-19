import { GAMES } from './games/index.js';
import { gameById, newMatch, compute, elapsed, clock, previousVisit } from './engine.js';
import { buildBoard, label, spoken, value } from './board.js';
import { createSync } from './sync.js';
import { createUpdater } from './update.js';
import { request } from './api.js';
import { createAccount } from './account.js';
import { createTracker } from './track.js';
import { createVoice } from './voice.js';
import { X01_TILES, x01Tile, x01Stats, x01Legs, visitsOf, dartTable, visitsWith } from './stats.js';

const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Saved on this device. If the browser refuses to store something (storage
// full, private mode) it is kept in memory so the app carries on until closed.
const unsaved = new Map();
const store = {
  get: (k, d) => { try { return JSON.parse(unsaved.get(k) ?? localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => {
    const text = JSON.stringify(v);
    try { localStorage.setItem(k, text); unsaved.delete(k); } catch { unsaved.set(k, text); }
  },
};
navigator.storage?.persist?.().catch(() => {});  // ask the browser not to clear it when space runs short


// ---------- saved data ----------
// Players, settings, finished games and every throw live in a database on the
// Pi (server/db.py), but the app never waits for it: every change is saved on
// this device first and sent to the Pi when it can be reached (see sync.js).
// So the whole app works with no Pi and no network, and catches up later.
// (api.js says what a refusal means to the queue of changes waiting to be sent.)
const call = (url, method, body, timeout) => request((u, o) => fetch(u, o), url, method, body, timeout)
  .catch(e => { if (e.signedOut) account.expired(); throw e; });
async function api(path, method = 'GET', body, timeout = 10000) {
  // Hosted and not signed in: there is no account to send to yet. Fail the way
  // an unreachable server does, so everything waits on this device.
  if (account.hosted && !account.account) throw Object.assign(new Error('Sign in first.'), { signedOut: true });
  return call('/api' + path, method, body, timeout);
}
// The hosted version only (see account.js): who is signed in.
// Signed out there, the welcome page takes over; signed in from it, the app opens.
const account = createAccount({ request: call, store, onChange: () => {
  if (account.locked) redraw(renderLanding); else if (screen === 'landing') begin();
  refreshStatus();
} });
// The server at home only: has its owner agreed to send what it records to Darts
// Sam, with no account? {asked, on, paired, site}, or null until it has said
// (see "sharing without an account" below, and server/share.py).
let share = null;
// The trial's notes on how the app is used (see track.js): the hosted version's
// go to the account, the server at home's are passed on by it while sharing is on.
const tracker = createTracker({
  store, recording: () => account.hosted || !!share?.on, sending: () => account.hosted ? !!account.account : !!share?.on,
  send: batch => call(account.hosted ? '/api/events' : '/api/share/events', 'POST', { events: batch }),
});
setInterval(() => tracker.flush(), 60000);
// What the app calls the machine it talks to: at home a Raspberry Pi, hosted just "the server".
const pi = () => account.hosted ? 'the server' : 'the Pi';
const Pi = () => account.hosted ? 'The server' : 'The Pi';

let match = store.get('match', null);
let players = store.get('players', []);  // [{id, name}]
let darts = store.get('darts', []);  // every player's sets of darts: [{id, player, name, grams, created, retired}]
// players: ids in throwing order. darts: {player id: the set of darts they are throwing}
let setup = store.get('setup', { gameId: 'x01', players: [], opts: {} });
let settings = store.get('settings', { voice: true });
// A phone or a tablet (anything held upright, narrow or worked by touch), as style.css has it:
// tabs along the bottom, and the settings as one page of sections instead of a tab at a time.
const STACKED = matchMedia('(orientation: portrait), (max-width: 800px), (pointer: coarse)');
const sectShown = id => STACKED.matches || settingsTab === id;  // is this section of the settings on screen?
let totals = store.get('totals', null);  // {darts, reports}: everything on the Pi, as it last said
let formError = '';   // shown under the "new player" box
let addingPlayer = false;  // home: the "new player" box is out of sight until asked for
let screen = match ? 'game' : 'home';
const MAX_PLAYERS = 6;

// ---------- themes ----------
// Each theme is a block of rules in themes.css under a .t-<id> class on <html>.
// The first is the one anybody who has not chosen gets (index.html and manifest.json say the same).
const THEMES = [
  { id: 'chalk', name: 'Chalk & Oche', blurb: 'The pub chalkboard beside the board.', bar: '#2b1b11' },
  { id: 'stage', name: 'Stage Night', blurb: 'Big-stage TV graphics under a spotlight.', bar: '#0a0a0c' },
  { id: 'arcade', name: 'Soft-tip Arcade', blurb: 'Glowing displays and chunky buttons.', bar: '#1b1b1f' },
  { id: 'sheet', name: 'League Scoresheet', blurb: 'A printed league-night scoresheet. Light.', bar: '#eadfc4' },
  { id: 'classic', name: 'Classic', blurb: 'The original plain dark look.', bar: '#101418' },
];
function applyTheme() {
  const theme = THEMES.find(t => t.id === settings.theme) ?? THEMES[0];
  document.documentElement.className = 't-' + theme.id;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme.bar);
  return theme;
}
const nameOf = id => players.find(p => p.id === id)?.name ?? '?';
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
  setup.players = (setup.players ?? []).filter(id => players.some(p => p.id === id));
  if (setup.first !== 'random' && !setup.players.includes(setup.first)) setup.first = null;
}
// The players in the order they will throw: the order they were tapped in,
// turned round to begin with whoever was chosen to throw first (or anyone, for Random).
function throwingOrder() {
  const ids = setup.players;
  const at = setup.first === 'random' ? Math.floor(Math.random() * ids.length) : Math.max(0, ids.indexOf(setup.first));
  return [...ids.slice(at), ...ids.slice(0, at)];
}
const data = createSync({ store, api, changed: synced });
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
  players = store.get('players', []);
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
  if (shown() === before) return;
  if (screen === 'home') redraw(renderHome);
  if (screen === 'players') redraw(renderPlayers);
  if (screen === 'settings' && sectShown('players')) redraw(renderSettings);
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

let connected = false, cameraCount = 0;
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
let appVersion = null;
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
// Settings → Games: "Darts S.A.M version 1.2 (build 61, a140399)", and where the source is.
function versionLine() {
  const v = appBuild?.release ?? release?.version;
  if (!v) return '';
  const extra = [appBuild?.build != null && `build ${appBuild.build}`, appBuild?.commit].filter(Boolean).join(', ');
  return `<p class="muted small">Darts S.A.M version ${esc(v)}${extra ? ` (${esc(extra)})` : ''}.
    Free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0</a>:
    <a href="${SOURCE}" target="_blank" rel="noopener">source code</a>.</p>`;
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
    if (ev.type === 'hello') { cameraCount = ev.cameras; helperLinked = !!ev.helper; refreshStatus(); return updater.seen(ev.version); }
    if (screen !== 'game' || !match) return;
    if (ev.type === 'dart') push({ t: 'dart', seg: ev.seg, mult: ev.mult, x: ev.x, y: ev.y, src: 'cam' });
    // A takeout with no darts thrown is just someone touching the board.
    const s = compute(match);
    if (ev.type === 'takeout' && (s.turn.length || s.turnOver)) push({ t: 'next' });
  };
}
function refreshStatus() {
  document.querySelectorAll('.conn').forEach(n => {
    const auto = connected && cameraCount > 0, owed = data.waiting();
    const full = (auto ? `Auto-scoring · ${cameraCount} cam${cameraCount > 1 ? 's' : ''}`
      : !connected ? 'Offline · manual scoring'
      : account.hosted ? (helperLinked ? 'Cameras linked · not calibrated' : 'Signed in · scoring by hand')
      : 'No camera lined up · scoring by hand')
      + (!owed ? '' : connected ? ' · syncing' : ` · ${owed} to sync`)
      + (unsaved.size ? ' · this device\'s storage is full' : '');
    // The game's top bar is short of room: it gets fewer words (the full ones are the tooltip).
    const brief = n.classList.contains('brief') && !auto;
    n.title = full;
    n.innerHTML = `<span class="dot ${auto ? 'ok' : ''}"></span>${brief ? (!connected ? 'Offline' : 'No cameras') : full}`;
  });
  fit();  // the new wording can wrap onto another line
}

// ---------- voice ----------
// The device's own voice, or the app's built-in one where it has none (voice.js).
// Which of the device's voices to use is kept on this device, not with the
// other settings: another device won't have the same voices.
const voice = createVoice({ chosen: store.get('voiceName', '') });
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
  if (ev.t === 'dart') tracker.entered(match.id, ev); else tracker.moved();
  match.log.push({ ...ev, ts: Date.now() });
  const after = compute(match);
  store.set('match', match);
  queueSync();
  // What the next thrower has left, once they are on a finish (X01, 170 or
  // below). Called once, at the start of the visit ("Sam, you require 121"),
  // not again after each dart.
  const left = gameById(match.gameId).left?.(after);
  // Every dart is called as it lands, in every game, ahead of anything else
  // there is to say (the visit's total, a bust, game shot).
  const game = gameById(match.gameId);
  const dart = ev.t === 'dart' ? spoken(ev) : '';
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
  const said = [dart, call, ...rest].filter(x => x !== '');
  if (said.length) say(said.join('. '));
  renderGame();
}
function undo() {
  const gone = match.log.pop();
  tracker.undone(match.id, gone?.t === 'dart' ? gone : undefined);  // a camera dart undone may be about to be put right
  store.set('match', match);
  queueSync();
  renderGame();
}

// Quit the game in progress: nothing from it is kept, here or on the Pi, so it
// never reaches the stats.
let quitArmed = false;
function quitGame() {
  if (!quitArmed) { quitArmed = true; return renderGame(); }
  quitArmed = false;
  data.quitMatch(match);
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
  if (screen === 'settings') { at.settingsTab = settingsTab; url = '#/settings'; }
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
    if (at.editing || at.statsTab === 'edit') { settingsTab = 'players'; return renderSettings(); }
    if ('statsFor' in at) ({ statsFor, statsGame, statsTab } = at);
    statsDarts = at.statsDarts ?? null;
    drill = (at.drill ?? []).map(level => ({ ...level }));
    return renderPlayers();
  }
  // (the cameras were once a tab of the settings: a history entry from then still finds them)
  if (at.screen === 'cameras' || (at.screen === 'settings' && at.settingsTab === 'cams')) return renderCameras();
  if (at.screen === 'settings') { settingsTab = at.settingsTab ?? settingsTab; return renderSettings(); }
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
  quitArmed = removeArmed = addingPlayer = false;
  formError = '';
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
// The walk through the app: a picture of it (web/shots, taken from the app itself) and what it shows.
const TOUR = [
  ['tv', 'On the big screen', 'Put it on the telly',
    'TV view gives the board the screen and runs the scores along the bottom, the way you see it on the big stage. Legs, 100+, 140+, 180s and averages keep themselves up to date.'],
  ['stats', 'Stats for every player', 'Know your game',
    'Three-dart and first-nine averages, checkout rate, highest checkout and 180s, and a heat map of where your darts really land. Tap any number to see the legs behind it.'],
];
const EXTRAS = [
  ['Every dart called', 'The caller reads out each dart, the visit\'s total and what you require for the finish.'],
  ['Any screen', 'A phone at the oche, a tablet on the wall or the big TV. Add it to your home screen and it runs like an app.'],
  ['Your look', 'Five themes, from big-stage TV graphics to the pub chalkboard.'],
];
const APPLE_LOGO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>';
const MAIL_LOGO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
const icon = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
// Getting about before signing in: this page, the questions and the downloads (the same bar is
// written out in web/faq.html and web/download.html). Drawn twice, like the app's own (see nav()).
const LAND_PLACES = [  // [its address, what it does here instead of going there, its name, its picture, its class]
  ['./', 'land-home', 'Home', icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'), 'on'],
  ['faq.html', '', 'FAQ', icon('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 17h.01"/>'), ''],
  ['download.html', '', 'Download', icon('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'), ''],
  ['./', 'land-top', 'Sign in', icon('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'), 'go'],
];
const landNav = where => `<nav class="land-nav ${where}" aria-label="Darts S.A.M">${LAND_PLACES.map(([href, act, name, pic, cls]) =>
  `<a href="${href}"${act ? ` data-act="${act}"` : ''}${cls ? ` class="${cls}"` : ''}${cls === 'on' ? ' aria-current="page"' : ''}>${pic}<span>${name}</span></a>`).join('')}</nav>`;
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
  const shot = (name, alt, w = 1800, h = 1125, lazy = true) =>
    `<img src="shots/${name}.webp" alt="${alt}" width="${w}" height="${h}" ${lazy ? 'loading="lazy"' : ''}>`;
  // The home page at an address of its own (account.front) has no signing in: it sends people to the app's.
  document.documentElement.toggleAttribute('data-front', account.front);  // no "Install" bar there either (style.css)
  if (account.front && location.hash === '#signin') return location.replace(account.app + '/#signin');
  const brand = '<span class="brand"><b class="wordmark">Darts S.A.M</b><span class="strap"><b>S</b>coring <b>A</b>ssisted <b>M</b>arker</span></span>';
  const card = account.front ? `<div class="signin-card" id="signin">
      <h2>Play in your browser. It's free.</h2>
      <button class="primary start" data-act="land-top">Open the app</button>
      <p class="muted small">Signing in takes one tap: no forms to fill in.
        <a href="privacy.html" target="_blank" rel="noopener">What is stored about you</a></p>
    </div>`
    : `<div class="signin-card" id="signin">
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
    $app.innerHTML = `<div class="landing door">
      <div class="land-top">${brand}<a href="${esc(account.home)}/">About Darts S.A.M</a></div>
      <div class="door-card"><h1>Game on.</h1>${card}</div>
    </div>`;
    googleButton();
    appleReady();
    return;
  }
  $app.innerHTML = `<div class="landing">
    <div class="land-top">${brand}${landNav('top')}</div>
    <div class="hero">
      <div class="hero-text">
        <p class="eyebrow">Darts scorer for phone, tablet and TV</p>
        <h1>Game on.</h1>
        <p class="lead">Darts S.A.M keeps the score, calls every dart and remembers every leg. Autoscore is built in: add cameras and the darts score themselves.</p>
        ${card}
      </div>
      <div class="hero-shots">
        <div class="shot">${shot('game', 'A game of 501 in Darts S.A.M: the scores beside the board', 1800, 1125, false)}</div>
        <div class="shot phone">${shot('game-phone', 'The same game on a phone', 780, 1560, false)}</div>
      </div>
    </div>
    <div class="facts">
      <div><b>${GAMES.length}</b><span>games</span></div>
      <div><b>180!</b><span>every dart called</span></div>
      <div><b>${THEMES.length}</b><span>themes</span></div>
      <div><b>Auto</b><span>scoring built in</span></div>
    </div>
    <a class="tally" id="tally" href="faq.html#numbers" hidden></a>
    <div class="autoscore">
      <div>
        <p class="eyebrow">Autoscore built in</p>
        <h2>Throw. It scores.</h2>
        <p>Point cameras at your board and Darts S.A.M sees where each dart lands and scores it for you: no tapping, no adding up.
          The cameras plug into a Mac, Windows or Linux PC near the board, and every phone, tablet and TV you sign in on follows along.</p>
      </div>
      <div class="autoscore-get">
        <button class="primary" data-act="download">Download for Mac</button>
        <button data-act="download">Download for Windows</button>
        <button data-act="download">Download for Linux</button>
        <p class="muted small">No cameras? Sign in and score by tapping the board.</p>
      </div>
    </div>
    ${TOUR.map(([name, eyebrow, title, text]) => `<div class="feature">
      <div class="shot">${shot(name, title)}</div>
      <div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p>${text}</p></div></div>`).join('')}
    <div class="land-games">
      <p class="eyebrow">${GAMES.length} games in the box</p>
      <h2>More than 501</h2>
      <div class="tour">${GAMES.map(g => `<div class="tour-card"><b>${g.name}</b><span>${g.blurb}</span></div>`).join('')}</div>
    </div>
    <div class="land-games">
      <p class="eyebrow">And the rest</p>
      <h2>Built for the oche</h2>
      <div class="tour">${EXTRAS.map(([title, text]) => `<div class="tour-card"><b>${title}</b><span>${text}</span></div>`).join('')}</div>
    </div>
    <div class="land-end">
      <h2>Ready when you are.</h2>
      <button class="primary start" data-act="land-top">Sign in to play</button>
      <p class="more">Questions first? <a href="faq.html">How it connects, how it works and what is stored</a></p>
    </div>
  </div>${landNav('foot')}`;
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
  const deep = screen === 'home' || screen === 'sheet' || (screen === 'players' && drill.length > 0);
  if (place === 'players') { drill = []; renderPlayers(); }
  if (place === 'cameras') { camAdding = false; camStep = camNote = ''; renderCameras(); }
  if (place === 'settings') renderSettings();
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
  store.set('setup', setup);
  const start = `<button class="primary start" data-act="start" ${setup.players.length ? '' : 'disabled'}>Start ${game.name}</button>`;
  const scrolled = document.querySelector('.home-body')?.scrollTop ?? 0;  // a tap redraws the menu: stay where it was
  $app.innerHTML = `<div class="page">
    ${pageHead('home')}
    <div class="home-body">
    <div class="pick">
    ${match ? '<h2>In progress</h2><button class="start" data-act="resume">Resume game in progress</button>' : ''}
    <h2>Game</h2>
    <div class="games">${GAMES.map(g => `<button class="game-card ${g.id === game.id ? 'on' : ''}" data-game="${g.id}">
      <b>${g.name}</b></button>`).join('')}</div>
    <p class="blurb muted small">${game.blurb}</p>
    </div>
    <div class="setup">
    ${game.options.length ? '<h2>Options</h2>' : ''}
    ${game.options.map(o => `<div class="opt"><span>${o.label}</span>${o.choices ? `<div class="choices">${o.choices.map(([v, l]) =>
      `<button class="${setup.opts[o.key] === v ? 'on' : ''}" data-opt="${o.key}" data-val="${esc(JSON.stringify(v))}">${l}</button>`).join('')}</div>`
      : stepper(o)}</div>`).join('')}
    <h2>Players</h2>
    ${players.length ? `<div class="row">${players.map(p => {
      const n = setup.players.indexOf(p.id);
      return `<button class="chip ${n >= 0 ? 'on' : ''}" data-pick="${p.id}">${n >= 0 ? `<i>${n + 1}</i>` : ''}${esc(p.name)}</button>`;
    }).join('')}${addingPlayer ? '' : '<button class="chip ghost" data-act="newplayer">+ New</button>'}</div>
    <p class="muted small">Tap who is playing, in throwing order.</p>
    ${setup.players.length > 1 ? `<div class="opt"><span>Throws first</span><div class="row">${setup.players.map((id, n) =>
      `<button class="chip ${(setup.first ?? setup.players[0]) === id ? 'on' : ''}" data-first="${id}">${esc(nameOf(id))}</button>`).join('')}
      <button class="chip ${setup.first === 'random' ? 'on' : ''}" data-first="random">Random</button></div></div>` : ''}
    ${dartsRows()}`
      : '<p class="muted">Add a player to get started.</p>'}
    ${addingPlayer || !players.length ? newPlayerRow() : ''}
    <span class="spacer"></span>
    ${start}
    </div>
    <p class="totals" id="totals"></p>
    </div>
    <div class="startbar">${start}</div>
    ${pageFoot('home')}
  </div>`;
  document.querySelector('.home-body').scrollTop = scrolled;
  refreshStatus();
  showTotals();
  loadTotals();
  fit();
  if (addingPlayer) document.getElementById('newplayer')?.focus();
}
// Which darts each player is throwing: a line for each one playing who has more than one set.
// Nobody playing has any: a word on where to add them.
function dartsRows() {
  const ids = setup.players;
  if (!ids.length) return '';
  if (!ids.some(id => setsOf(id).length)) return `<p class="muted small">Track which darts you throw:
    <button class="link" data-act="managedarts">add your darts</button>.</p>`;
  return ids.filter(id => setsOf(id).length > 1).map(id => `<div class="opt"><span>${esc(nameOf(id))}'s darts</span>
    <div class="row">${setsOf(id).map(d => `<button class="chip ${dartsFor(id) === d.id ? 'on' : ''}" data-usedarts="${id}" data-set="${esc(d.id)}">${
      esc(d.name)}${d.grams != null ? ` <span class="muted">${grams(d.grams)}</span>` : ''}</button>`).join('')}</div></div>`).join('');
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
    players = store.get('players', []);
    formError = '';
    addingPlayer = false;
    // Added on the menu, they are playing; added in the settings, they are only on the list.
    if (screen === 'home' && setup.players.length < MAX_PLAYERS) { setup.players.push(p.id); saveSetup(); }
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
const STAT_TABS = [['stats', 'Stats'], ['games', 'Games'], ['board', 'Board']];
let statsFor = null, statsData = null, statsFailed = false, statsTab = 'stats';
// (The list of players, to add to, rename and remove from, is a tab of the settings: see playersPanel().)
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
  c121: [['Checkout rate', 'rate', '%'], ['Checkouts hit', 'made'], ['Highest checkout', 'highest'],
    ['Average darts per checkout', 'avg_darts']],
};
async function renderPlayers(id = statsFor) {
  if (account.locked) return renderLanding();
  screen = 'players';
  statsFor = players.some(p => p.id === id) ? id : players[0]?.id ?? null;
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
    return tile(t.label + (t.note?.(s) ?? ''), t.value ? t.value(s, rows) : rows.length,
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
const when = ts => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
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
  const m = top.v === 'match' && d.matches.find(m => m.id === top.id);
  return m ? { title: matchTitle(m), html: () => matchHtml(m, top) } : null;
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
      ${drill.at(-1).v === 'match' ? '' : ' · tap a line for more, a heading to sort'}</p>
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
  const message = tab === 'games' ? wait : none;
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
    <div class="tiles">${tile('Darts thrown', st.darts, numbers)}${tile('Trebles', pct(st.trebles, st.darts), numbers)}
      ${tile('Doubles', pct(st.doubles, st.darts), numbers)}${tile('Bulls and 25s', st.bulls, numbers)}${tile('Misses', pct(st.misses, st.darts), numbers)}
      ${tile('Most hit', st.segments.slice(0, 3).map(g => g.seg === 25 ? 'Bull' : g.seg).join(', ') || null, numbers)}</div>
    ${x && !game ? `<h2>X01</h2><div class="tiles">${x01Tiles(x, X01_HEADLINES)}</div>` : ''}</div>
    <div class="p-games">${st.games.length ? `<h2>Finished games</h2>
    <table class="plain"><tr><th>Game</th><th>Played</th><th>Won (2+ players)</th><th>Average time</th><th>Quickest</th></tr>${st.games.map(g =>
      `<tr${opens(gamesOf(g.game))}><td>${esc(g.game)}</td><td>${g.played}</td><td>${g.won}</td>
       <td>${g.avg_ms != null ? clock(g.avg_ms) : '–'}</td><td>${g.best_ms != null ? clock(g.best_ms) : '–'}</td></tr>`).join('')}</table>`
      : '<p class="muted">No finished games yet.</p>'}${gearHtml(st, game)}</div>
    <div class="p-board">${st.recent.length ? `<h2>Heat map · ${game ? `${game.name}, ` : ''}${
      st.recent.length === 1 ? '1 dart' : `${st.recent.length < 5000 ? '' : 'last '}${st.recent.length} darts`}</h2>
    <div class="statboard"><svg id="statboard"></svg></div>
    <div class="heatkey"><span>Fewer darts</span><i></i><span>More</span></div>`
      : `<p class="muted">No dart positions recorded yet${game ? ` in ${game.name}` : ''}.</p>`}</div>`;
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
// The settings' Players tab. Everyone on one page: each player on a line of their own,
// then a new name underneath.
function playersPanel() {
  const failed = id => formError && renameFailed === id ? `<p class="warn">${esc(formError)}</p>` : '';
  return `<div class="editplayers">
      ${players.map(p => `<div class="player-row">
        <input type="text" data-rename="${p.id}" value="${esc(p.name)}" maxlength="16" aria-label="Name of ${esc(p.name)}">
        <button class="ghost" data-act="rename" data-id="${p.id}">Rename</button>
        <button class="ghost danger" data-act="remove" data-id="${p.id}">${removeArmed === p.id ? 'Tap again' : 'Remove'}</button></div>${failed(p.id)}`).join('')}
      <h2>Add a player</h2>
      ${newPlayerRow()}
      ${players.length ? `<p class="muted small">Removing a player hides them from the lists. Their throws are kept, and adding the
        same name again brings them back.</p>` : ''}
    </div>`;
}
function renamePlayer(id) {
  const name = document.querySelector(`[data-rename="${id}"]`).value.trim();
  if (!name || name === nameOf(id)) return;
  try {
    data.renamePlayer(id, name);
    players = store.get('players', []);
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
  players = store.get('players', []);
  cleanSetup();
  saveSetup();
  formError = '';
  renderSettings();
}

// The settings' Darts tab: each player's sets, to name, weigh, put away and bring back.
let dartsError = null;  // {at: a set's id or a player's id (adding), text}
function dartsPanel() {
  if (!players.length) return '<p class="muted">Add a player first, then their darts.</p>';
  const failed = at => dartsError?.at === at ? `<p class="warn">${esc(dartsError.text)}</p>` : '';
  const row = d => `<div class="player-row darts-row ${d.retired ? 'away' : ''}">
    <input type="text" data-dname="${esc(d.id)}" value="${esc(d.name)}" maxlength="24" aria-label="Name of ${esc(d.name)}">
    <input type="number" inputmode="decimal" data-dgrams="${esc(d.id)}" value="${d.grams ?? ''}" min="1" max="100" step="0.5" placeholder="g" aria-label="Weight in grams">
    <button class="ghost" data-act="savedarts" data-id="${esc(d.id)}">Save</button>
    <button class="ghost" data-act="retiredarts" data-id="${esc(d.id)}" data-retired="${d.retired ? 'no' : 'yes'}">${d.retired ? 'Bring back' : 'Put away'}</button></div>${failed(d.id)}`;
  return `<div class="editplayers editdarts">${players.map(p => `<h3>${esc(p.name)}</h3>
    ${setsOf(p.id, true).sort((a, b) => a.retired - b.retired).map(row).join('')}
    <div class="player-row darts-row"><input type="text" id="newdarts-${p.id}" data-newdarts="${p.id}" placeholder="New darts, e.g. Red 23g" maxlength="24">
      <input type="number" inputmode="decimal" id="newgrams-${p.id}" data-newdarts="${p.id}" min="1" max="100" step="0.5" placeholder="g" aria-label="Weight in grams">
      <button data-act="adddarts" data-id="${p.id}">Add</button></div>${failed(p.id)}`).join('')}
    <p class="muted small">Pick which darts you're throwing on the Play screen; the stats can then be seen set by set.
      Put away darts you no longer use: they leave the Play screen, and their stats are kept.</p>
  </div>`;
}
const gramsIn = el => el?.value.trim() ? +el.value : null;
function dartsDone(fn, at) {
  try { fn(); darts = store.get('darts', []); dartsError = null; data.sync(); } catch (e) { dartsError = { at, text: e.message }; }
  renderSettings();
}
function addDarts(player) {
  const name = document.getElementById(`newdarts-${player}`).value.trim();
  if (!name) return document.getElementById(`newdarts-${player}`).focus();
  dartsDone(() => {
    const d = data.addDarts(player, name, gramsIn(document.getElementById(`newgrams-${player}`)));
    // Their first set: what they are throwing from now on.
    if (setsOf(player).length === 0) { setup.darts = { ...setup.darts, [player]: d.id }; saveSetup(); }
  }, player);
}
function saveDarts(id) {
  const name = document.querySelector(`[data-dname="${CSS.escape(id)}"]`).value;
  dartsDone(() => data.changeDarts(id, { name, grams: gramsIn(document.querySelector(`[data-dgrams="${CSS.escape(id)}"]`)) }), id);
}
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
  const msg = padError || (midVisit ? 'Finish this visit on the board, or undo those darts'
    : padAsk ? `${padAsk.total} to finish. How many darts?`
    : s.legWon ? `${esc(s.players[s.legWon.player])} won the ${s.legWon.set ? 'set' : 'leg'}`
    : s.lastVisit ? `${esc(s.players[s.lastVisit.player])} scored ${s.lastVisit.total}` : 'Type the visit total');
  const off = midVisit || s.winner != null ? 'disabled' : '';
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
  if (screen !== 'game' || !document.querySelector('.game')) {
    screen = 'game';
    $app.innerHTML = `<div class="game"><div class="side"></div>
      <div class="boardwrap"><svg id="board"></svg><div class="pad"></div></div><div class="tvbar"></div></div>`;
    boardUI = buildBoard(document.getElementById('board'), d => push({ t: 'dart', ...d, src: 'tap' }));
  }
  const game = gameById(match.gameId);
  const s = compute(match);
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
      ${connected && cameraCount > 0 ? '<button data-act="report" title="A dart was scored wrongly: save what the cameras saw">Report</button>' : ''}
      ${canTv(game, s) ? `<button data-act="tv">${tv ? 'Card view' : 'TV view'}</button>` : ''}
      ${game.visit ? `<button data-act="entry">${pad ? 'Use board' : 'Type scores'}</button>` : ''}
      ${s.winner == null ? `<button class="danger swap" data-act="quit"><span${quitArmed ? ' class="hid" aria-hidden="true"' : ''}>Quit game</span><span${quitArmed ? '' : ' class="hid" aria-hidden="true"'}>Tap again</span></button>` : ''}</div>
    ${tv ? '' : `<div class="players">${s.players.map((p, i) => {
      const v = game.summary(s, i);
      return `<div class="pcard ${s.winner === i ? 'win' : s.winner == null && i === s.current ? 'cur' : ''}${v.out ? ' out' : ''}">
        <div class="name">${esc(p)}${playingWith(i)}</div><div class="big">${v.big}</div><div class="small">${v.small}</div></div>`;
    }).join('')}</div>`}
    ${game.panel ? game.panel(s) : ''}
    ${pad && !s.turn.length ? '' : `<div class="turn">${slots}<div class="slot total ${s.note ? 'bust' : ''}">${s.note || (game.showTotal === false ? '' : total)}</div></div>`}
    ${last}
    ${game.hint ? `<div class="hint">${s.winner == null ? esc(game.hint(s, { checkouts: settings.checkouts !== false })) : ''}</div>` : ''}
    ${banner}
    <div class="actions ${pad && s.winner == null ? 'solo' : ''}">
      <button data-act="undo" ${match.log.length ? '' : 'disabled'}>Undo</button>
      ${s.winner != null
        ? '<button data-act="home">Menu</button><button class="primary" data-act="rematch">Play again</button>'
        : pad ? '' : `<button data-act="miss">Miss</button>
           <button class="${s.turnOver ? 'primary' : ''}" data-act="next">Next player ›</button>`}
    </div>`;
  boardUI.showDarts(shown);
  boardUI.showTarget(game.target?.(s) ?? null);
  refreshStatus();
  fit();
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
// On a computer, a row of tabs with one of them on screen at a time. On a phone
// or a tablet there are no tabs: every section is on the one page, each under
// its name, and the page scrolls. All of them are drawn either way and
// style.css shows what belongs (as with the app's four places, see nav()).
let settingsTab = '';  // the tab on screen; '' until opened, then the first
// jump: bring the section asked for into view, for someone sent to it from elsewhere.
function renderSettings(jump) {
  if (account.locked) return renderLanding();
  const scrolled = screen === 'settings' ? document.querySelector('.setbody')?.scrollTop ?? 0 : 0;  // a tap redraws: stay where it was
  screen = 'settings';
  const look = `<div class="settings">
    <div class="opt solo"><span>Theme</span><div><div class="choices themes">${THEMES.map(t =>
      `<button class="${t.id === applyTheme().id ? 'on' : ''}" data-theme="${t.id}">${t.name}</button>`).join('')}</div>
      <p class="muted small">${applyTheme().blurb}</p></div></div>
    </div>`;
  const sound = `<div class="settings">
    <div class="opt"><span>Call scores aloud</span><div class="choices">
      <button class="${settings.voice ? 'on' : ''}" data-voice="on">On</button>
      <button class="${settings.voice ? '' : 'on'}" data-voice="off">Off</button></div></div>
    ${voicePicker()}
    </div>`;
  const play = `<div class="settings">
    <div class="opt"><span>Checkout hints</span><div class="choices">
      <button class="${settings.checkouts !== false ? 'on' : ''}" data-checkouts="on">Show</button>
      <button class="${settings.checkouts !== false ? '' : 'on'}" data-checkouts="off">Hide</button></div></div>
    <p class="muted small">Hide them to practise working out your finishes yourself.</p>
    ${versionLine()}
    </div>`;
  // two lots: side by side on a tablet on its side, one under the other on anything narrower
  const cols = [
    [...(account.hosted ? [['acct', 'Account', accountPanel()]] : []), ['look', 'Theme', look], ['sound', 'Sound', sound], ['play', 'Games', play]],
    [['players', 'Players', playersPanel()], ['darts', 'Darts', dartsPanel()], ...(!account.hosted && share ? [['share', 'Sharing', sharePanel()]] : [])],
  ];
  const tabs = cols.flat();
  if (!tabs.some(t => t[0] === settingsTab)) settingsTab = tabs[0][0];
  $app.innerHTML = `<div class="page">
    ${pageHead('settings')}
    ${tabs.length > 1 ? `<div class="row tabs stabs">${tabs.map(([id, name]) =>
      `<button class="${settingsTab === id ? 'on' : ''}" data-stab="${id}">${name}</button>`).join('')}</div>` : ''}
    <div class="fill setbody">${cols.map(col => `<div class="setcol">${col.map(([id, name, html]) =>
      html ? `<section class="sect ${settingsTab === id ? 'on' : ''}"><h2>${name}</h2>${html}</section>` : '').join('')}</div>`).join('')}</div>
    ${pageFoot('settings')}
  </div>`;
  const body = document.querySelector('.setbody');
  body.scrollTop = scrolled;
  if (jump && STACKED.matches) body.querySelector('.sect.on')?.scrollIntoView();
  refreshStatus();
  fit();
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
    players = store.get('players', []);
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
    <p class="camskip"><button class="ghost" data-act="home">No camera: score by tapping the board</button></p></div></div>`;
  return `<p class="dim">${account.helper.connected ? 'Your cameras\' computer didn\'t answer.'
      : 'Your cameras\' computer isn\'t connected. Check it is switched on and Darts S.A.M is running.'}</p>
    ${note}<div class="row"><button data-act="pair-retry">Try again</button>${unpairButton()}</div>`;
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

// ---------- account (the hosted version only, see account.js) ----------
let acctNote = '';        // what went wrong last
let acctSigningOut = false; // "Sign out" pressed once: asking if they are sure
let acctDeleting = false; // "Delete my account" pressed once: asking if they are sure
let fbNote = '';          // how sending feedback went
async function sendFeedback() {
  const box = document.getElementById('fb-text'), text = box.value;
  try {
    await call(account.hosted ? '/api/feedback' : '/api/share/feedback', 'POST', { text, app: {
      version: appVersion, browser: navigator.userAgent, w: innerWidth, h: innerHeight, cameras: cameraCount,
    } });
    fbNote = 'Thanks, sent.';
  } catch (e) {
    fbNote = e.signedOut ? 'You are no longer signed in.' : e.status ? e.message : 'Not sent: no connection. Try again.';
    if (onAccountTab()) { renderSettings(); document.getElementById('fb-text').value = text; }  // keep what they typed
    return;
  }
  if (onAccountTab()) renderSettings();
}
function accountPanel() {
  const note = acctNote ? `<p class="warn">${esc(acctNote)}</p>` : '';
  if (!account.account) return '';  // signed out is the welcome page's business
  return `<div class="settings">
    ${note}
    ${acctDeleting ? `<p>This deletes your games and stats for good.</p>
    <div class="row"><button class="danger" data-act="acct-delete-yes">Delete</button><button data-act="acct-delete-no">Keep</button></div>`
    : acctSigningOut ? `<p>Are you sure you want to sign out?</p>
    <div class="row"><button data-act="acct-signout-yes">Sign out</button><button data-act="acct-signout-no">Stay signed in</button></div>`
    : `<div class="row"><button data-act="acct-signout">Sign out</button>
      <button class="danger" data-act="acct-delete">Delete my account</button></div>`}
    ${feedbackBox()}
    <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">What is stored about you</a>${
      account.account.admin ? ' · <a href="/admin">The trial\'s admin pages</a>' : ''}</p></div>`;
}
const onAccountTab = () => screen === 'settings' && (sectShown('acct') || sectShown('share'));
const feedbackBox = () => `<div class="feedback"><label for="fb-text">Tell us what you think: what works, what doesn't, what's missing.</label>
      <textarea id="fb-text" rows="3" maxlength="2000"></textarea>
      <div class="row"><button data-act="feedback">Send feedback</button><span class="muted">${esc(fbNote)}</span></div></div>`;

// ---------- sharing without an account (the server at home only, see server/share.py) ----------
// Someone using the desktop app by itself has no account, so nothing it records
// reaches Darts S.A.M. They are asked once, the first time the app is opened,
// whether it may be sent; yes or no, it can be changed in Settings → Sharing.
const SHARED = `<ul>
      <li><b>Your games and scores:</b> every game and each dart in it. Players go as "Player 1", "Player 2": their names are not sent.</li>
      <li><b>How the cameras did:</b> how many there are, whether calibrating worked, and when a dart they scored was put right by hand.</li>
      <li><b>Problem reports,</b> when you press Report in a game: the cameras' pictures of the last few darts and what you type about them.</li>
      <li><b>Feedback</b> you choose to write.</li></ul>`;
const openDetail = () => ({
  version: appVersion, browser: navigator.userAgent, w: innerWidth, h: innerHeight, touch: navigator.maxTouchPoints > 0,
  installed: matchMedia('(display-mode: standalone)').matches || !!navigator.standalone,
});
let shareNote = '';        // what went wrong last
let shareDeleting = false; // "Delete what has been sent" pressed once: asking if they are sure
let shareAsk = null;       // the question, while it is on screen
async function loadShare() {
  try { share = await api('/share', 'GET', undefined, 4000); } catch { return; }  // no Pi, or one from before this
  if (share.on) { tracker.track('open', openDetail()); tracker.flush(); }
  // Paired with an online account, what the cameras record goes with that account already.
  if (!share.asked && !share.paired) askShare();
  if (screen === 'settings') renderSettings();  // the Sharing tab appears
}
function askShare() {
  if (shareAsk) return;
  shareAsk = document.body.appendChild(document.createElement('div'));
  shareAsk.className = 'report shareask';
  shareAsk.innerHTML = `<div class="report-in">
    <h1>Help make Darts S.A.M better?</h1>
    <p>Darts S.A.M is new, and its camera scoring improves by seeing where it goes wrong.
      If you say yes, this computer sends to Darts S.A.M:</p>
    ${SHARED}
    <p>You are not asked for an account, a name or an email address. Say no and everything stays on this computer;
      the app works just the same. You can change your mind at any time in <b>Settings → Sharing</b>,
      and delete what has been sent from there.</p>
    <div class="row"><button class="primary" data-share="yes">Yes, send it</button><button data-share="no">No thanks</button>
      <span class="warn" id="share-error"></span></div>
    <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">What is sent, and what is done with it</a></p></div>`;
}
// Yes or no, from the question or from Settings.
async function setShare(on) {
  shareNote = '';
  try {
    share = await api('/share', 'PUT', { on });
    shareAsk?.remove(); shareAsk = null;
    if (screen === 'welcome') document.getElementById('welcome-name')?.focus();  // the next question
    if (share.on) { tracker.track('open', openDetail()); tracker.flush(); }
  } catch (e) {
    shareNote = e.status ? e.message : `Not saved: ${pi()} did not answer.`;
    const line = shareAsk?.querySelector('#share-error');
    if (line) line.textContent = shareNote;
  }
  shareDeleting = false;
  if (onAccountTab()) renderSettings();
}
async function deleteShared() {
  shareNote = '';
  try {
    share = await api('/share', 'DELETE', undefined, 30000);
    store.set('events', []);  // notes not yet sent
    shareNote = 'Deleted. Nothing more is sent.';
  } catch (e) {
    shareNote = e.status ? e.message : `Nothing was deleted: ${pi()} did not answer.`;
  }
  shareDeleting = false;
  if (onAccountTab()) renderSettings();
}
function sharePanel() {
  if (!share) return '<p class="muted">Not connected to the Pi.</p>';
  return `<div class="settings">
    <div class="opt"><span>Send to Darts S.A.M</span><div class="choices">
      <button class="${share.on ? 'on' : ''}" data-act="share-on">On</button>
      <button class="${share.on ? '' : 'on'}" data-act="share-off">Off</button></div></div>
    ${shareNote ? `<p class="warn">${esc(shareNote)}</p>` : ''}
    <p class="muted small">${share.on ? 'This computer sends to Darts S.A.M, to help improve the camera scoring:'
      : 'Off: everything stays on this computer. Switched on, this computer sends to Darts S.A.M, to help improve the camera scoring:'}</p>
    <div class="muted small">${SHARED}</div>
    <p class="muted small">No account, name or email address is asked for or sent.${share.paired
      ? ' These cameras are paired with an online account, so problem reports go to that account.' : ''}</p>
    ${share.on ? feedbackBox() : ''}
    ${shareDeleting ? `<p>This stops sharing and deletes from Darts S.A.M everything this computer has sent. Your games here are not touched.</p>
    <div class="row"><button class="danger" data-act="share-delete-yes">Delete</button><button data-act="share-delete-no">Keep</button></div>`
    : '<div class="row"><button data-act="share-delete">Delete what has been sent</button></div>'}
    <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">What is sent, and what is done with it</a></p></div>`;
}
document.addEventListener('click', e => {
  const answer = e.target.closest('.shareask [data-share]')?.dataset.share;
  if (answer) setShare(answer === 'yes');
});
async function accountDo(what) {
  acctNote = '';
  try {
    if (what === 'signout') {
      // Signing out empties this device, so anything not yet saved to the account would be lost.
      if (data.waiting() && !(await data.sync()) || data.waiting()) {
        throw new Error(`${data.waiting()} change${data.waiting() === 1 ? ' hasn\'t' : 's haven\'t'} been saved yet. Connect to the internet and try again.`);
      }
      await account.signOut();
    }
    if (what === 'delete') await account.remove();
    // this device's copy is gone: start again clean rather than show what is still in memory
    if (what !== 'rename') {
      await window.caches?.delete('dartssam-data').catch(() => {});  // their stats, kept for offline
      return location.reload();
    }
  } catch (e) {
    acctNote = e.signedOut ? 'You are no longer signed in.' : e.message;
  }
  acctDeleting = acctSigningOut = false;
  if (onAccountTab()) renderSettings();
}

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
  const b = e.target.closest('button, a[data-act], [data-drill], [data-sort], [data-sheet], [data-gear]');  // tiles and lines can be tapped too
  if (!b) return;
  if (b.tagName === 'A') e.preventDefault();  // a link that does something on this page instead (see landNav)
  const d = b.dataset;
  if (d.act !== 'remove') removeArmed = false;
  if (d.act !== 'quit') quitArmed = false;
  if (d.act !== 'addplayer' && d.act !== 'rename' && d.act !== 'remove') formError = '';
  if (!/darts$/.test(d.act ?? '')) dartsError = null;
  if (d.act !== 'addplayer') addingPlayer = d.act === 'newplayer';
  if (d.game) { setup.gameId = d.game; saveSetup(); return renderHome(); }
  if (d.step) {
    const o = gameById(setup.gameId).options.find(o => o.key === d.opt);
    setup.opts[d.opt] = Math.min(o.max, Math.max(o.min, setup.opts[d.opt] + +d.step));
    saveSetup();
    return renderHome();
  }
  if (d.opt) { setup.opts[d.opt] = JSON.parse(d.val); saveSetup(); return renderHome(); }
  if (d.usedarts) { setup.darts = { ...setup.darts, [d.usedarts]: d.set }; saveSetup(); return renderHome(); }
  if (d.gear !== undefined) { statsDarts = d.gear || null; drill = []; statsTab = 'stats'; renderPlayers(); return mark(); }
  if (d.first) { setup.first = d.first === 'random' ? 'random' : +d.first; saveSetup(); return renderHome(); }
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
  if (d.drill) { drill.push(JSON.parse(d.drill)); drawPlayers(); return mark(true); }
  if (d.sort) {
    const top = drill.at(-1);
    top.desc = top.by === d.sort ? !top.desc : true;
    top.by = d.sort;
    drawPlayers();
    return mark();
  }
  if (d.nav) return goTo(d.nav);
  if (d.stab) { settingsTab = d.stab; renderSettings(true); return mark(); }
  if (d.camremove) return changeCameras('/cameras/remove', { name: d.camremove });
  if (d.camoff) return changeCameras('/cameras/enabled', { name: d.camoff, on: false });
  if (d.camon) return changeCameras('/cameras/enabled', { name: d.camon, on: true });
  if (d.showcam) { camShown = +d.showcam; camAdding = false; calib = {}; autoCal = null; calibNote = camNote = ''; calibFailed = false; return renderCameras(); }
  if (d.key === 'cancel') { padAsk = null; padValue = ''; return renderGame(); }
  if (d.key) return padKey(d.key);
  if (d.fin) return padCommit(padAsk.total, +d.fin);
  if (d.theme) { settings.theme = d.theme; saveSettings(); applyTheme(); renderSettings(); return mark(); }
  if (d.checkouts) { settings.checkouts = d.checkouts === 'on'; saveSettings(); return renderSettings(); }
  if (d.voice) {
    settings.voice = d.voice === 'on';
    saveSettings();
    say('One hundred and eighty');  // so the voice can be heard, and checked, from here
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
    case 'newplayer': return renderHome();
    case 'rename': return renamePlayer(+d.id);
    case 'remove': return removePlayer(+d.id);
    case 'manageplayers': settingsTab = 'players'; renderSettings(true); return mark(true);
    case 'managedarts': settingsTab = 'darts'; renderSettings(true); return mark(true);
    case 'adddarts': return addDarts(+d.id);
    case 'savedarts': return saveDarts(d.id);
    case 'retiredarts': return changeDarts(d.id, { retired: d.retired === 'yes' });
    case 'players': drill = []; renderPlayers(); return mark(true);
    case 'up': return goBack();
    case 'start':
    case 'rematch':
      cleanSetup();
      if (!setup.players.length) return renderHome();
      const ids = throwingOrder();
      match = {
        ...newMatch(setup.gameId, ids.map(nameOf), startOpts()),
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        playerIds: ids, darts: ids.map(dartsFor), seq: 0,
      };
      store.set('match', match);
      say('Game on');
      renderGame();
      return mark(d.act === 'start');  // playing again takes the place of the game just finished
    case 'resume': renderGame(); return mark(true);
    case 'quit': return quitGame();
    case 'home': return goHome();
    case 'settings': renderSettings(); return mark(true);
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
    case 'miss': return push({ t: 'dart', seg: 0, mult: 0, src: 'miss' });
    case 'next':
      if (compute(match).lastVisit?.auto) return;  // the third dart already moved play on
      return push({ t: 'next' });
    case 'reset': return resetDetection();
    case 'refreshcams': return refreshCameras();
    case 'addcam': return addCamera();
    case 'report': return reportProblem();
    case 'pair': return pairCameras();
    case 'pair-retry': pairNote = ''; return renderCameras();
    case 'unpair': unpairAsk = true; return renderCameras();
    case 'unpair-no': unpairAsk = false; return renderCameras();
    case 'unpair-yes': return unpairCameras();
    case 'link-pair': return linkDo('POST', '/link/pair');
    case 'link-unpair': return linkDo('DELETE', '/link');
    case 'feedback': return sendFeedback();
    case 'apple': return appleSignIn();
    case 'download': return location.assign('download.html');
    case 'land-home': return document.querySelector('.landing').scrollTo({ top: 0, behavior: 'smooth' });
    case 'land-top': if (account.front) return location.assign(account.app);  // signing in is at the app's address
      return document.getElementById('signin').scrollIntoView({ behavior: 'smooth', block: 'center' });
    case 'mail': mailStep = 'ask'; landNote = ''; renderLanding(); return document.getElementById('mail-addr').focus();
    case 'mail-send': return sendCode();
    case 'mail-code': return signIn('email', { email: mailTo, code: document.getElementById('mail-code').value });
    case 'mail-back': mailStep = 'ask'; landNote = ''; renderLanding(); return document.getElementById('mail-addr').focus();
    case 'acct-signout': acctSigningOut = true; acctNote = ''; return renderSettings();
    case 'acct-signout-no': acctSigningOut = false; return renderSettings();
    case 'acct-signout-yes': return accountDo('signout');
    case 'acct-delete': acctDeleting = true; acctSigningOut = false; acctNote = ''; return renderSettings();
    case 'acct-delete-no': acctDeleting = false; return renderSettings();
    case 'acct-delete-yes': return accountDo('delete');
    case 'share-on': return setShare(true);
    case 'share-off': return setShare(false);
    case 'share-delete': shareDeleting = true; shareNote = ''; return renderSettings();
    case 'share-delete-no': shareDeleting = false; return renderSettings();
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
  if (e.target.dataset.newdarts) addDarts(+e.target.dataset.newdarts);
  if (e.target.dataset.dname || e.target.dataset.dgrams) saveDarts(e.target.dataset.dname || e.target.dataset.dgrams);
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
