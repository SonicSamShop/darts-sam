// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Achievements as they are earned in a game: worked out after every dart from
// what each player held before it, shown on a slip and called, with a picture of
// the board when the cameras scored the dart.

import { compute } from '../engine.js';
import { matchSheet } from '../sync.js';
import { add, chief, earnedBy, held, newly, standing, tally as gameTally } from '../achievements.js';
import { renderPlayers, statsView } from './stats.js';
import {
  account, api, data, esc, loadStats, mark, match, phone, players, renderGame, saveSettings, screen, settings,
  statsPath
} from '../app.js';

// ---------- achievements (achievements.js) ----------
// None is stored: what a player holds is worked out from their games. For the game in progress the
// app keeps each person's total as it stood when the game began, and after every dart asks what
// the game has added to it. Whatever is new is shown on a slip, and called.
export let bases = null;   // {id: the match's, of: [a total per seat: null for the computer, and while there is no history to go on]}
let slips = [];     // earned and not yet shown: [{seat, top, also, at: the log's length when it was earned, since}]
let slipTimer = 0;
const SLIP_MS = 6000;
const endedGames = [];  // games ended on this device since it was opened, as [{sheet, ids}]: the kept stats may not have them yet
export const achievementsOn = () => settings.achievements !== false;
const people = m => m.playerIds.filter((_, i) => m.bots?.[i] == null).length;
// Where in a game's visits the one still being thrown is, or -1 between visits: a visit's total is judged when it is over.
const openVisit = (s, sheet) => s.winner == null && s.turn.length && !s.turnOver ? sheet.visits.length - 1 : -1;
export function forgetEnded(id) {
  const i = endedGames.findIndex(g => g.sheet.id === id);
  if (i >= 0) endedGames.splice(i, 1);
}
// After Undo: the slips for darts no longer in the game.
export function dropSlips() { slips = slips.filter(s => s.at <= match.log.length); }
export function endedHere() {
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
export async function loadBases() {
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
export function achieved(before, sheetBefore, after, byCamera) {
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
export let photoAsk = false;     // a picture would have been kept, had they been asked
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
export function dropPictures() {
  for (const [url, at] of taken) if (!url.startsWith(photoUrl(match.id, '')) || at > match.log.length) {
    if (url.startsWith(photoUrl(match.id, ''))) fetch(url, { method: 'DELETE' }).catch(() => {});
    taken.delete(url);
  }
}
export function askPhotos() {
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
export function slipHtml() {
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
export function slipTapped() {
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
export function earnedLine() {
  if (!achievementsOn() || bases?.id !== match.id) return '';
  const sheet = matchSheet(match), named = people(match) > 1;
  const lines = match.playerIds.flatMap((id, i) => !bases.of[i] ? []
    : newly(held(bases.of[i]), held(add(bases.of[i], gameTally(sheet, i))))
      .map(a => `${named ? `${esc(match.players[i])}, ` : ''}<b>${esc(a.name)}</b>`));
  return lines.length ? `<div class="earned">Achievements this game: ${lines.join(' · ')}</div>` : '';
}
