// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// A game being played: the board and the scores (or the number pad, or the TV
// view), every dart and Undo, the computer's throws, and quitting.

import { clock, compute, elapsed, gameById, previousVisit } from '../engine.js';
import { buildBoard, label, spoken, value } from '../board.js';
import { matchSheet } from '../sync.js';
import { botLevel } from '../bot.js';
import { renderLanding } from './landing.js';
import { menu } from './home.js';
import { onMatchQuit, onMatchUndone, onMatchWon, openTournament, quitTerms } from './tournament.js';
import {
  achieved, achievementsOn, askPhotos, bases, dropPictures, dropSlips, earnedLine, endedHere, forgetEnded,
  loadBases, photoAsk, photosOn, slipHtml
} from './earned.js';
import {
  $app, account, cameraCount, connected, dartsName, data, esc, fit, goHome, mark, match, phone, queueSync,
  refreshStatus, say, screen, setMatch, setScreen, setsOf, settings, store, tracker
} from '../app.js';

// The level of the computer player whose throw it is in the game in progress, or null.
export const botUp = (s = compute(match)) => s.winner == null ? match.bots?.[s.current] ?? null : null;
// The computer throws by itself, a dart at a time, whenever the game is on screen and it is its
// turn: renderGame() asks for the next dart each time it draws. Straight after a person's visit
// it holds off for a while, counting down on screen, so a wrongly scored dart can be put right
// (Undo) before it starts; "Throw now" skips the wait. The countdown is kept while the screen
// redraws, and starts again only when something new goes into the game.
// How long it holds off is a setting (Settings > In a game): 0 to 30 seconds, 8 unless
// changed. At 0 there is no wait and no countdown: it throws as it does after its own dart.
export const BOT_WAIT = 2200;
const BOT_PACE = 1200;
export const BOT_HOLD_MAX = 30;  // seconds
export const BOT_HOLD_USUAL = 8;
export function botHoldSecs() {
  const n = Math.round(Number(settings.botHold ?? BOT_HOLD_USUAL));
  return Number.isFinite(n) ? Math.min(BOT_HOLD_MAX, Math.max(0, n)) : BOT_HOLD_USUAL;
}
export let botTimer = 0;
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
export function botThrow() {
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

// ---------- the visit's score, large ----------
// When a visit is over, what it scored (or Bust) takes over the players' scores for a couple of
// seconds, large, before they come back: easy to read from the oche when the voice can't be
// heard (a noisy pub). The player cards give way to one panel saying who threw and what it
// scored; in the TV view, the thrower's score on the scoreboard shows it instead. Games with no
// total (Cricket, Killer and the like) and the end of a game, which has its banner, don't.
// A setting (Settings > In a game), on unless switched off.
export const FLASH_MS = 2200;
let flash = null;  // {player, text, bust, until} while it is showing
let flashTimer = 0;
export const flashOn = () => settings.visitFlash !== false;
function visitFlash(game, before, after) {
  if (!flashOn() || game.showTotal === false || after.winner != null) return null;
  if (after.bust != null) return { player: after.bust, text: 'Bust', bust: true };
  if (after.noOut != null) return { player: after.noOut, text: "Can't check out", bust: true, noOut: true };
  if (after.lastVisit) return { player: after.lastVisit.player, text: after.lastVisit.total };
  if (after.turnOver && !before.turnOver) return { player: after.current, text: after.turn.reduce((t, d) => t + value(d), 0) };
  return null;
}
// What player i's score on the TV scoreboard shows just now: the visit's flash, or their score as usual.
const bigOf = (i, usual) => flash?.player === i
  ? `<span class="flash${flash.bust ? ' bust' : ''}${flash.noOut ? ' noout' : ''}">${flash.text}</span>` : usual;
// The panel that stands in for the player cards while the flash is on.
const flashHtml = s => `<div class="vflash${flash.bust ? ' bust' : ''}${flash.noOut ? ' noout' : ''}" role="status">
  ${s.players.length > 1 ? `<div class="name">${esc(s.players[flash.player])}</div>` : ''}
  <div class="big">${flash.text}</div><div class="small">${flash.noOut ? 'Not enough darts left' : flash.bust ? 'Scores nothing' : 'Scored this visit'}</div></div>`;

// ---------- match actions ----------
export function push(ev) {
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
  if (after.winner != null && match.opts?.tournament) onMatchWon(match);  // the result counts from the winning dart
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
  } else if (after.noOut != null) {
    rest = ["Can't check out", require];
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
  const f = visitFlash(game, before, after);
  if (f) flash = { ...f, until: Date.now() + FLASH_MS };
  else if (ev.t === 'dart' || ev.t === 'visit') flash = null;  // the next visit has begun
  renderGame();
}
export function undo() {
  // Undo is for the people playing: the computer's darts since go with the dart being undone
  // (it throws again when its turn comes back round).
  const won = compute(match).winner != null;
  while (match.log.at(-1)?.src === 'bot') match.log.pop();
  const gone = match.log.pop();
  flash = null;
  tracker.undone(match.id, gone?.t === 'dart' ? gone : undefined);  // a camera dart undone may be about to be put right
  // Whatever those darts earned goes with them: it is worked out again from the darts that are left.
  dropSlips();
  forgetEnded(match.id);
  dropPictures();
  store.set('match', match);
  queueSync();
  if (won && match.opts?.tournament) onMatchUndone(match);  // the winning dart undone: so is the result
  renderGame();
}

// Quit the game in progress, once the player has said they are sure. Its results
// are saved unless they untick the box: the darts thrown so far stay in the stats,
// as an unfinished game. Unticked (or with nothing thrown yet), nothing from it is
// kept, here or on the server.
let quitAsk = null;  // the question, while it is on screen
const thrown = m => m.log.some(e => e.t === 'dart' || e.t === 'visit');
// A match of a tournament's bracket is given up, not quit: whoever quits is out, and the
// other goes through (tournament.js, forfeit). Each person in it has a button saying so.
function forfeitHtml(terms) {
  const [a, b] = terms.seats, other = p => (p === a ? b : a);
  const quitters = terms.seats.filter(p => !p.bot);
  const line = p => `${esc(other(p).name)} goes through ${terms.full}–${Math.min(p.legs, terms.full - 1)}`;
  return `<h1>Give up the match?</h1>
    <p class="muted">${quitters.length > 1 ? 'Whoever gives up is' : `${esc(quitters[0].name)} is`} out of ${esc(terms.name)}${quitters.length > 1 ? ', and the other goes through' : `, and ${line(quitters[0])}`}.</p>
    ${thrown(match) ? `<label class="tick"><input type="checkbox" checked> Save your results?</label>
      <p class="muted small">Saved, the darts thrown in this game count in your stats. Unticked, they are thrown away.</p>` : ''}
    <div class="row">${quitters.map(p => `<button class="danger" data-quit="yes" data-loser="${p.id}" title="${line(p)}">${esc(p.name)} gives up</button>`).join('')}
      <button class="primary" data-quit="no">Keep playing</button></div>`;
}
export function askQuit() {
  closeQuit();
  const terms = match.opts?.tournament ? quitTerms(match) : null;
  quitAsk = document.body.appendChild(document.createElement('div'));
  quitAsk.className = 'report shareask quitask';
  quitAsk.innerHTML = `<div class="report-in">${terms ? forfeitHtml(terms) : `
    <h1>Are you sure?</h1>
    <p class="muted">This game ends here and can't be picked up again.</p>
    ${thrown(match) ? `<label class="tick"><input type="checkbox" checked> Save your results?</label>
      <p class="muted small">Saved, the darts thrown in this game count in your stats. Unticked, the game is thrown away, darts and all.</p>` : ''}
    <div class="row"><button class="danger" data-quit="yes">Quit game</button>
      <button class="primary" data-quit="no">Keep playing</button></div>`}</div>`;
  quitAsk.querySelector('.primary').focus();
}
export function closeQuit() { quitAsk?.remove(); quitAsk = null; }
document.addEventListener('click', e => {
  const button = e.target.closest('.quitask [data-quit]'), answer = button?.dataset.quit;
  if (!answer) return;
  const save = !!quitAsk.querySelector('input')?.checked;
  closeQuit();
  if (answer === 'yes' && match) quitGame(save, button.dataset.loser ?? null);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQuit(); });
function quitGame(save, loser = null) {
  if (save) data.saveMatch(match);  // as it stands: every dart of it is already queued
  else data.quitMatch(match);
  const ofTournament = match.opts?.tournament?.id;
  if (ofTournament) onMatchQuit(match, loser, save);  // given up: the other goes through
  setMatch(null);
  store.set('match', null);
  numPad.value = ''; numPad.ask = null; numPad.error = '';
  data.sync();
  if (!ofTournament) return goHome();
  openTournament(ofTournament);
  mark();
}

// ---------- number entry ----------
// Instead of tapping each dart on the board, the whole visit can be typed in
// as one number (games with visit() only: X01, Count Up and 121 Checkout).
export const numPad = {
  value: '',
  ask: null,
  error: '',
};
const usingPad = game => !!game.visit && settings.entry === 'pad';
export function padKey(key) {
  if (botUp()) return;
  numPad.error = '';
  if (key === 'back') numPad.value = numPad.value.slice(0, -1);
  else if (key === 'enter') return padEnter();
  else if (numPad.value.length < 3) numPad.value = String(+(numPad.value + key));
  renderGame();
}
function padEnter() {
  const game = gameById(match.gameId), s = compute(match), total = +numPad.value;
  const finish = game.visitDarts?.(s, total);  // null unless this total wins the leg
  if (total > 180) numPad.error = '180 is the most three darts can score';
  else if (finish && !finish.length) numPad.error = `${total} can't be finished from here`;
  else if (finish && finish.length > 1) numPad.ask = { total, darts: finish };
  else return padCommit(total, finish ? finish[0] : 3);
  renderGame();
}
export function padCommit(total, darts) {
  numPad.value = ''; numPad.ask = null; numPad.error = '';
  push({ t: 'visit', total, darts });
}
function padHtml(s) {
  const midVisit = s.turn.length && !s.turnOver;
  const bot = botUp(s);
  const msg = numPad.error || (bot ? `${esc(s.players[s.current])} is throwing` : midVisit ? 'Finish this visit on the board, or undo those darts'
    : numPad.ask ? `${numPad.ask.total} to finish. How many darts?`
    : s.legWon ? `${esc(s.players[s.legWon.player])} won the ${s.legWon.set ? 'set' : 'leg'}`
    : s.lastVisit ? `${esc(s.players[s.lastVisit.player])} scored ${s.lastVisit.total}` : 'Type the visit total');
  const off = bot || midVisit || s.winner != null ? 'disabled' : '';
  const keys = numPad.ask
    ? numPad.ask.darts.map(n => `<button class="primary" data-fin="${n}">${n} dart${n > 1 ? 's' : ''}</button>`).join('')
      + '<button class="wide" data-key="cancel">Cancel</button>'
    : [7, 8, 9, 4, 5, 6, 1, 2, 3].map(n => `<button data-key="${n}" ${off}>${n}</button>`).join('')
      + `<button data-key="back" ${off} aria-label="Delete">⌫</button><button data-key="0" ${off}>0</button>
         <button class="primary" data-key="enter" ${off}>Enter</button>`;
  return `<div class="pad-out ${numPad.error ? 'bad' : ''}">${numPad.ask ? numPad.ask.total : numPad.value || '0'}</div>
    <div class="pad-msg ${numPad.error ? 'warn' : ''}">${msg}</div><div class="pad-keys">${keys}</div>`;
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
      <td class="name">${esc(r.p)}</td>${sets ? `<td>${r.sets}</td>` : ''}<td>${r.legs}</td><td class="score">${bigOf(r.i, r.score)}</td>
      <td class="gap"></td><td>${r.t100}</td><td>${r.t140}</td><td>${r.t180}</td><td class="avg">${r.average}</td></tr>`).join('')}
  </table>`;
}

// ---------- game ----------
export const gameBoard = {
  ui: null,
};
// The darts a player is throwing in this game, said beside their name once they have more than one set.
function playingWith(i) {
  const set = match.darts?.[i], id = match.playerIds?.[i];
  return set && setsOf(id, true).length > 1 ? ` <span class="muted small">· ${esc(dartsName(set))}</span>` : '';
}
// What the last render showed, so that what changed since can move: a dart that has just come
// into its slot, a score counting down, the next player's card coming up (moved() below).
const seen = { id: null, len: 0, turn: 0, current: null, bigs: [] };
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function renderGame() {
  if (account.locked) return renderLanding();
  menu.rulesOpen = false;  // the menu, when it is next seen, starts from its games
  if (screen !== 'game' || !document.querySelector('.game')) {
    setScreen('game');
    $app.innerHTML = `<div class="game"><div class="side"></div>
      <div class="boardwrap"><svg id="board"></svg><div class="pad"></div></div><div class="tvbar"></div></div>`;
    gameBoard.ui = buildBoard(document.getElementById('board'), d => { if (!botUp()) push({ t: 'dart', ...d, src: 'tap' }); });
  }
  const game = gameById(match.gameId);
  const s = compute(match);
  loadBases();  // (once a game: what everyone held before it)
  if (s.winner != null && photoAsk && photosOn() === null) askPhotos();
  if (flash && Date.now() >= flash.until) flash = null;
  clearTimeout(flashTimer);
  if (flash) flashTimer = setTimeout(() => { if (screen === 'game' && match) renderGame(); }, flash.until - Date.now());
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
  const same = seen.id === match.id, grew = same && match.log.length > seen.len, shrank = same && match.log.length < seen.len;
  // a dart that has just come into its slot drops in; one an Undo has given back fades back in
  const came = i => (grew || shrank) && i >= seen.turn ? (grew ? ' pop' : ' back') : '';
  const slots = [0, 1, 2].map(i => s.turn[i]
    ? `<div class="slot${came(i)}"><b>${label(s.turn[i])}</b><small>Dart ${i + 1}</small></div>`
    : `<div class="slot empty${i === s.turn.length && s.winner == null && !s.turnOver ? ' next' : ''}"><b>–</b><small>Dart ${i + 1}</small></div>`).join('');
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
  else if (s.noOut != null) banner = `<div class="banner bust">Can't check out!${s.players.length > 1
    ? ` ${esc(s.players[s.current])} to throw` : ''}</div>`;

  // The moment a visit ends: a bust goes red on the card of the player who bust, a leg or the
  // match won goes gold, and the next player's card comes up.
  const ended = grew && s.bust != null ? s.bust : null;
  const won = grew ? s.winner ?? s.legWon?.player ?? null : null;
  const arrive = same && seen.current != null && s.current !== seen.current && s.winner == null;
  const moved = i => i === won ? ' checkout' : i === ended ? ' busted' : arrive && i === s.current ? ' arrive' : '';
  // the rest of the game's controls, out of the way under the buttons that score
  const tools = [
    canTv(game, s) && `<button class="ghost" data-act="tv">${tv ? 'Card view' : 'TV view'}</button>`,
    game.visit && `<button class="ghost" data-act="entry">${pad ? 'Use board' : 'Type scores'}</button>`,
    ((connected && cameraCount > 0) || phone.scoring()) && '<button class="ghost" data-act="report" title="A dart was scored wrongly: save what the cameras saw">Report a dart</button>',
    s.winner == null && '<button class="ghost" data-act="quit">Quit game</button>',
  ].filter(Boolean).join('');
  const left = s.winner != null || s.turnOver ? '' : `${3 - s.turn.length} dart${s.turn.length === 2 ? '' : 's'} to throw`;
  const visit = `<div class="visit${grew && s.bust != null ? ' busted' : ''}">
      ${pad && !s.turn.length ? '' : `<div class="visit-head"><span>${s.players.length > 1 && s.winner == null ? `${esc(s.players[s.current])}'s visit` : 'This visit'}</span><span class="muted">${left}</span></div>
      <div class="turn">${slots}<div class="slot total ${s.note ? 'bust' : ''}"><b>${s.note || (game.showTotal === false ? '' : total)}</b><small>${s.note ? '' : 'Total'}</small></div></div>`}
      ${last}</div>`;
  document.querySelector('.side').innerHTML = `
    <div class="top"><button class="ghost" data-act="home">‹ Menu</button>
      <span class="title"><b>${game.name}</b> <span class="clock" title="Match time">${clock(elapsed(match, s))}</span></span>
      <span class="spacer"></span><span class="conn brief muted"></span></div>
    ${tv ? '' : flash ? `<div class="players">${flashHtml(s)}</div>` : `<div class="players">${s.players.map((p, i) => {
      const v = game.summary(s, i);
      return `<div class="pcard ${s.winner === i ? 'win' : s.winner == null && i === s.current ? 'cur' : ''}${v.out ? ' out' : ''}${moved(i)}">
        <div class="name">${esc(p)}${playingWith(i)}</div><div class="big">${v.big}</div><div class="small">${v.small}</div></div>`;
    }).join('')}</div>`}
    ${game.panel ? game.panel(s) : ''}
    ${visit}
    ${game.hint ? `<div class="hint">${s.winner == null ? esc(game.hint(s, { checkouts: settings.checkouts !== false })) : ''}</div>` : ''}
    ${slipHtml()}
    ${banner}${s.winner != null ? earnedLine() : ''}
    ${botHolds(s) ? `<div class="botwait"><span>${esc(s.players[s.current])} throws in <b>${botHold?.at === match.log.length ? botHoldLeft() : botHoldSecs()}</b>s. Score wrong? Undo it now.</span>
      <button data-act="botgo">Throw now</button></div>` : ''}
    <div class="actions ${pad && s.winner == null ? 'solo' : ''}">
      <button data-act="undo" ${match.log.length ? '' : 'disabled'}>Undo</button>
      ${s.winner != null
        ? `<button data-act="home">Menu</button>${match.opts?.tournament
          ? '<button class="primary" data-act="tour-back">Back to the tournament</button>'
          : '<button class="primary" data-act="rematch">Play again</button>'}`
        : pad ? '' : `<button data-act="miss" ${botUp(s) ? 'disabled' : ''}>Miss</button>
           <button class="primary end${s.turnOver ? ' ready' : ''}" data-act="next" ${botUp(s) ? 'disabled' : ''}>End turn</button>`}
    </div>
    ${tools ? `<div class="tools">${tools}</div>` : ''}`;
  // A score that has changed counts down (or up) to its new figure.
  const cards = [...document.querySelectorAll('.side .pcard .big')];
  if (cards.length) {
    const now = cards.map(el => el.textContent.trim());
    cards.forEach((el, i) => {
      const from = same ? seen.bigs[i] : undefined, to = now[i];
      if (still() || from == null || from === to || !/^\d+$/.test(from) || !/^\d+$/.test(to)) return;
      const a = +from, b = +to, t0 = performance.now(), MS = 450;
      el.textContent = a;
      const step = now => {
        const k = Math.min(1, (now - t0) / MS), e = 1 - (1 - k) ** 3;
        if (!el.isConnected) return;
        el.textContent = k < 1 ? Math.round(a + (b - a) * e) : to;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    seen.bigs = now;
  }
  const fresh = grew && match.log.at(-1)?.t === 'dart';
  Object.assign(seen, { id: match.id, len: match.log.length, turn: s.turn.length, current: s.current });
  gameBoard.ui.showDarts(shown, 5, botFlight && settings.flight !== false && !pad, fresh && !pad);
  gameBoard.ui.showTarget(game.target?.(s) ?? null);
  refreshStatus();
  fit();
  botSoon();
}

// The match clock in the top bar ticks between renders.
setInterval(() => {
  const el = screen === 'game' && match && document.querySelector('.clock');
  if (el) el.textContent = clock(elapsed(match));
}, 1000);
