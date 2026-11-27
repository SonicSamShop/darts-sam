// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// A game being played: the board and the scores (or the number pad, or the TV
// view), every dart and Undo, the computer's throws, and quitting.

import { clock, compute, elapsed, gameById, previousVisit } from '../engine.js';
import { buildBoard, label, spoken, value } from '../board.js';
import { cameraForDart, dartInView } from '../tv-camera.js';
import { starterCall } from '../voice.js';
import { parseSpeech } from '../speech.js';
import { matchSheet } from '../sync.js';
import { botLevel } from '../bot.js';
import { renderLanding } from './landing.js';
import { menu } from './home.js';
import { summaryHtml } from './stats.js';
import { onMatchQuit, onMatchUndone, onMatchWon, openTournament, quitTerms } from './tournament.js';
import { onCareerUndone, onCareerWon, openCareer } from './career.js';
import { accentFor, banterClipUrl, careerIntensity, coughPlan, pickBanterEntry, tierAtmosphere } from '../banter.js';
import { WARMUP_STEPS, recordPracticeDay, warmupDart, warmupNext, warmupUndo } from '../routine.js';
import {
  achieved, achievementsOn, askPhotos, bases, dropPictures, dropSlips, earnedLine, endedHere, forgetEnded,
  loadBases, photoAsk, photosOn, slipHtml
} from './earned.js';
import {
  $app, account, atmosphereOn, cameraCount, careerOpt, connected, dartsName, data, esc, fit, flagHtml, goHome, icon, mark, match, phone, queueSync,
  refreshStatus, say, sayBanter, screen, setMatch, setScreen, setsOf, settings, sfx, sfxOn, speech, store, tracker
} from '../app.js';

// The level of the computer player whose throw it is in the game in progress, or null.
export const warmupActive = (m = match) => !!m?.warmup && !m.warmup.done;
export const botUp = (s = compute(match)) => warmupActive() ? null : s.winner == null ? match.bots?.[s.current] ?? null : null;
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
const flashHtml = s => {
  const n = typeof flash.text === 'number' ? flash.text : 0;
  const cls = flash.bust ? `bust${flash.noOut ? ' noout' : ''}` : n >= 180 ? 'max' : n >= 100 ? 'ton' : '';
  const sub = flash.noOut ? 'Not enough darts left' : flash.bust ? 'Scores nothing'
    : n >= 180 ? 'Maximum!' : n >= 140 ? 'Ton forty!' : n >= 100 ? 'Ton+!' : n === 0 ? 'No score' : 'Scored this visit';
  return `<div class="vflash ${cls}" role="status">
  ${s.players.length > 1 ? `<div class="name">${playerFlag(flash.player)}${esc(s.players[flash.player])}</div>` : ''}
  <div class="big">${flash.text}</div><div class="small">${sub}</div></div>`;
};

// ---------- a visit kept up ----------
// After a person's visit, their darts can stay in the dart slots (and on the board) for a few
// seconds, counting down, so a wrongly scored dart is easy to see and put right with Undo before
// the next visit starts. Play has already moved on underneath: the next dart thrown, an Undo or
// "Carry on" ends it early. The large score (above) stays up for as long, when it is on.
// Not after the computer's darts, nor the last visit of a game (its banner stays anyway).
// A setting (Settings > In a game): 0 to 15 seconds, 0 unless changed (moves on at once).
export const VISIT_HOLD_MAX = 15;  // seconds
export function visitHoldSecs() {
  const n = Math.round(Number(settings.visitHold ?? 0));
  return Number.isFinite(n) ? Math.min(VISIT_HOLD_MAX, Math.max(0, n)) : 0;
}
let held = null;  // {at: match.log.length, player, darts, total, bust, until} while it is up
let heldTick = 0;
const holding = () => !!held && held.at === match?.log.length && Date.now() < held.until;
const heldLeft = () => Math.max(1, Math.ceil((held.until - Date.now()) / 1000));
export function endHold() { held = null; if (flash) flash.until = Math.min(flash.until, Date.now()); renderGame(); }
function holdVisit(before, after, ev) {
  held = null;
  const secs = visitHoldSecs();
  if (!secs || ev.t !== 'dart' || ev.src === 'bot' || after.winner != null) return;
  if (!after.lastVisit?.darts && after.bust == null && after.noOut == null) return;  // the visit isn't over
  const darts = [...before.turn, ev];
  held = { at: match.log.length, player: before.current, darts, total: darts.reduce((t, d) => t + value(d), 0),
    bust: after.bust != null || after.noOut != null, until: Date.now() + secs * 1000 };
}

// ---------- Career Mode atmosphere, banter & coughing ----------
let banter = null;      // { matchId, text, kind, intensity, seq }
let banterSpeakTimer = 0;
let coughTimer = 0;
let coughKey = '';      // visit key so we schedule at most one cough per human visit

const careerActive = (m = match) => !!m?.opts?.career && atmosphereOn();
const careerLvl = (m = match) => careerIntensity(m?.opts?.career);

function setBanter(kind, intensity, m = match, { delayMs = 0 } = {}) {
  if (!careerActive(m) || !careerOpt('banter')) return;
  const { text, idx } = pickBanterEntry(kind, intensity, { lastText: banter?.text || '' });
  if (!text) return;
  banter = { matchId: m.id, text, kind, intensity, seq: (banter?.seq ?? 0) + 1 };
  const c = m.opts.career || {};
  const proId = c.proId || '';
  const accent = accentFor(c.proCountry, proId);
  const clipUrl = banterClipUrl(accent, kind, intensity, idx);
  clearTimeout(banterSpeakTimer);
  if (delayMs > 0) {
    const mid = m.id;
    banterSpeakTimer = setTimeout(() => {
      if (screen === 'game' && match?.id === mid && careerActive(match)) {
        sayBanter(text, { intensity, proId, clipUrl });
      }
    }, delayMs);
  } else {
    sayBanter(text, { intensity, proId, clipUrl });
  }
}

function clearCough() {
  clearTimeout(coughTimer);
  coughTimer = 0;
}

function syncAtmosphere(s) {
  if (screen !== 'game' || !match || !careerActive(match)) {
    clearCough();
    coughKey = '';
    sfx.ambienceStop();
    return;
  }
  const lvl = careerLvl(match);
  if (s.winner == null && sfxOn() && careerOpt('pubNoise')) sfx.ambienceStart(lvl, match.id);
  else sfx.ambienceStop();

  // Mid-throw coughing gamesmanship during the human player's visit.
  if (!careerOpt('coughing') || s.winner != null || warmupActive(match) || botUp(s) || quitAsk || s.turnOver) {
    clearCough();
    coughKey = '';
    return;
  }
  const key = `${match.id}:${s.throws.length}:${s.current}`;
  if (coughKey === key) return;
  clearCough();
  coughKey = key;
  const onFinish = !!gameById(match.gameId).left?.(s);
  const plan = coughPlan(lvl, { onFinish });
  if (!plan.willCough) return;
  const targetMatchId = match.id;
  coughTimer = setTimeout(() => {
    coughTimer = 0;
    if (screen !== 'game' || !match || match.id !== targetMatchId || quitAsk || !careerActive(match) || !careerOpt('coughing')) return;
    const cur = compute(match);
    if (cur.winner != null || botUp(cur) || cur.turnOver) return;
    if (sfxOn()) sfx.cough(lvl);
    setBanter('cough', lvl, match, { delayMs: 360 });
    renderGame();
  }, plan.delayMs);
}

function banterHtml() {
  if (!careerActive(match) || !careerOpt('banter') || !banter || banter.matchId !== match.id) return '';
  const c = match.opts.career;
  const atm = tierAtmosphere(banter.intensity);
  const cls = banter.kind === 'cough' ? ' cough' : banter.intensity >= 3 ? ' hot' : '';
  return `<div class="banter${cls}" data-seq="${banter.seq}" role="status">
    <div class="banter-head"><span>${c.proFlag ? `<span class="flag">${c.proFlag}</span>` : ''}<b>${esc(c.proName)}</b></span>
      <span class="banter-heat" title="${esc(atm.venue)}">${atm.heat} ${esc(atm.vibe)}</span></div>
    <div class="banter-text">“${esc(banter.text)}”</div>
  </div>`;
}

// ---------- match actions ----------
export function finishWarmup() {
  if (!match || !match.warmup) return;
  match.warmup = null;
  match.started = Date.now();
  store.set('match', match);
  const opening = compute(match), aim = gameById(match.gameId).aim?.(opening);
  say(starterCall(opening.players, opening.current, { aim }));
  renderGame();
}
export function push(ev) {
  if (warmupActive(match)) {
    const w = match.warmup;
    if (ev.t === 'dart') {
      if (sfxOn()) sfx.dart(ev);
      const res = warmupDart(w, ev);
      if (res.done) return finishWarmup();
      const parts = [settings.eachDart ? spoken(ev) : '', res.changed && match.players.length > 1 ? match.players[w.current] : ''].filter(Boolean);
      if (parts.length) say(parts.join('. '));
      store.set('match', match);
      return renderGame();
    }
    if (ev.t === 'next') {
      const res = warmupNext(w);
      if (res.done) return finishWarmup();
      if (res.changed && match.players.length > 1) say(match.players[w.current]);
      store.set('match', match);
      return renderGame();
    }
    return;
  }
  const before = compute(match);
  if (before.winner != null) return;
  const sheetBefore = achievementsOn() && bases?.id === match.id ? matchSheet(match) : null;
  if (ev.t === 'dart') tracker.entered(match.id, ev); else tracker.moved();
  match.log.push({ ...ev, ts: Date.now() });
  const after = compute(match);
  const earned = sheetBefore ? achieved(before, sheetBefore, after, ev.src === 'cam') : [];  // said after the score: "Sam, Maximum"
  if (after.winner != null) { endedHere(); recordPracticeDay(store); }
  store.set('match', match);
  queueSync();
  if (after.winner != null && match.opts?.tournament) onMatchWon(match);  // the result counts from the winning dart
  if (after.winner != null && match.opts?.career) onCareerWon(match);
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
    rest = [after.capWin
      ? `Max darts hit. ${after.players[after.winner]} wins`
      : result ? `Game over. ${result}` : `Game shot. ${after.players[after.winner]} wins`];
  } else if (after.legWon) {
    // Play has already moved on to whoever throws first in the next leg.
    const lead = after.legWon.cap ? 'Max darts hit,' : 'Game shot, and';
    rest = [`${lead} the ${after.legWon.set ? 'set' : 'leg'}, ${after.players[after.legWon.player]}`, require];
  } else if (after.bust != null) {
    rest = ['Bust', require];  // play has already moved on
  } else if (after.noOut != null) {
    rest = ["Can't check out", require];
  } else if (after.lastVisit) {
    // Play has already moved on. Games where the sum means nothing skip the total.
    rest = [game.showTotal === false ? '' : after.lastVisit.total === 0 ? 'No score' : after.lastVisit.total, require];
  } else if (after.turnOver && !before.turnOver) {
    const sum = after.turn.reduce((t, d) => t + value(d), 0);
    rest = [game.showTotal === false ? '' : sum === 0 ? 'No score' : sum];
  } else rest = [require];
  // What the dart did, in games that have something to say about it (Killer).
  const call = ev.t === 'dart' ? game.call?.(after) ?? '' : '';
  // With two or more playing, whoever is up is called by name as their visit
  // begins. "You require" above already names them; a new leg announces who throws first.
  const legStart = after.legWon ? starterCall(after.players, after.current, { leg: true, set: after.legWon.set }) : '';
  const began = after.winner == null && !after.turn.length && !after.turnOver
    && (after.throws.length !== before.throws.length || after.current !== before.current || after.round !== before.round);
  const name = began && after.players.length > 1 && !require && !legStart ? after.players[after.current] : '';
  // What to aim at (Random Targets, Around the Clock) is called out last, when
  // it changes and at the start of every visit: "Next, Treble 16", or "Sam,
  // Treble 16" for the next thrower. Alone and still on the same one: "Aim for 5".
  const aimAt = t => (t.winner == null ? game.aim?.(t) ?? '' : '');
  const changed = aimAt(after) !== aimAt(before);
  const aim = began || changed ? aimAt(after) : '';
  const next = legStart || (name ? (aim ? `${name}, ${aim}` : name) : aim && `${changed ? 'Next,' : 'Aim for'} ${aim}`);
  const said = [dart, call, ...rest, ...earned, next].filter(x => x !== '');
  if (said.length) say(said.join('. '));
  if (sfxOn()) {
    const scored = after.lastVisit ? after.lastVisit.total
      : after.turnOver && !before.turnOver ? after.turn.reduce((t, d) => t + value(d), 0) : 0;
    if (after.winner != null || after.legWon) sfx.win();
    else if (after.bust != null || after.noOut != null) sfx.bust();
    else if (game.showTotal !== false && scored >= 100) sfx.ton(scored);
    else if (ev.t === 'dart') sfx.dart(ev);
    else if (ev.t === 'visit') sfx.dart(ev.total === 0 ? { seg: 0, mult: 0 } : { seg: 20, mult: ev.total >= 60 ? 3 : 1 });
    else if (ev.t === 'next' && ev.force) sfx.dart({ seg: 0, mult: 0 });
  }
  if (careerActive(match)) {
    const lvl = careerLvl(match);
    const byBot = ev.src === 'bot';
    const crowdOn = sfxOn() && careerOpt('crowdCheers');
    if (after.winner != null) {
      if (crowdOn) { if (after.winner === 0) sfx.cheer('big', lvl); else sfx.groan(lvl); }
      setBanter(after.winner === 0 ? 'matchWin' : 'matchLoss', lvl);
    } else if (after.legWon) {
      if (crowdOn) { if (after.legWon.player === 0) sfx.cheer('big', lvl); else sfx.groan(lvl); }
      setBanter(after.legWon.player === 0 ? 'playerCheckout' : 'botLeg', lvl);
    } else if (after.bust === 0 || after.noOut === 0) {
      if (crowdOn) sfx.groan(lvl);
      setBanter('playerBust', lvl);
    } else if (after.lastVisit) {
      const { player, total } = after.lastVisit;
      if (player === 0) {
        if (total >= 180) { if (crowdOn) sfx.cheer('big', lvl); setBanter('playerGood', lvl); }
        else if (total >= 100) { if (crowdOn) sfx.cheer('medium', lvl); setBanter('playerGood', lvl); }
        else if (total <= 26) { if (crowdOn && (total === 0 || total === 26)) sfx.groan(lvl); setBanter('playerMiss', lvl); }
      } else if (player === 1) {
        if (total >= 100) setBanter('botBig', lvl);
        else if (left && after.current === 0) setBanter('playerOnFinish', lvl);
      }
    } else if (ev.t === 'dart' && !byBot) {
      if ((ev.seg === 25 && ev.mult === 2) || (ev.mult === 3 && ev.seg >= 15)) {
        if (crowdOn) sfx.cheer('small', lvl);
        if (Math.random() < 0.55) setBanter('playerGood', lvl);
      } else if (!ev.mult) {
        if (crowdOn) sfx.groan(Math.max(0, lvl - 1));
      }
    }
  }
  holdVisit(before, after, ev);
  const f = visitFlash(game, before, after);
  if (f) flash = { ...f, until: Date.now() + Math.max(FLASH_MS, held ? held.until - Date.now() : 0) };
  else if (ev.t === 'dart' || ev.t === 'visit') flash = null;  // the next visit has begun
  renderGame();
}
export function undo() {
  if (warmupActive(match)) {
    if (warmupUndo(match.warmup)) { store.set('match', match); renderGame(); }
    return;
  }
  // Undo is for the people playing: the computer's darts since go with the dart being undone
  // (it throws again when its turn comes back round).
  const won = compute(match).winner != null;
  while (match.log.at(-1)?.src === 'bot') match.log.pop();
  const gone = match.log.pop();
  flash = null;
  held = null;
  tracker.undone(match.id, gone?.t === 'dart' ? gone : undefined);  // a camera dart undone may be about to be put right
  // Whatever those darts earned goes with them: it is worked out again from the darts that are left.
  dropSlips();
  forgetEnded(match.id);
  dropPictures();
  store.set('match', match);
  queueSync();
  if (won && match.opts?.tournament) onMatchUndone(match);  // the winning dart undone: so is the result
  if (won && match.opts?.career) onCareerUndone(match);
  renderGame();
}

// Quit the game in progress, once the player has said they are sure. Its results
// are saved unless they untick the box: the darts thrown so far stay in the stats,
// as an unfinished game. Unticked (or with nothing thrown yet), nothing from it is
// kept, here or on the server.
let quitAsk = null;  // the question, while it is on screen
const thrown = m => m.log.some(e => e.t === 'dart' || e.t === 'visit' || e.t === 'bust' || (e.t === 'next' && e.force));
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
  const ofCareer = match.opts?.career?.playerId;
  if (ofTournament) onMatchQuit(match, loser, save);  // given up: the other goes through
  setMatch(null);
  store.set('match', null);
  clearCough();
  clearTimeout(banterSpeakTimer);
  coughKey = '';
  banter = null;
  sfx.ambienceStop();
  speech.stop();
  numPad.value = ''; numPad.ask = null; numPad.error = '';
  data.sync();
  if (ofCareer != null) { openCareer(ofCareer); return mark(); }
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
export function padQuick(total) {
  if (botUp()) return;
  numPad.error = '';
  numPad.value = String(total);
  padEnter();
}
const QUICK_SCORES = [26, 41, 45, 60, 81, 85, 100];
export function padCommit(total, darts) {
  numPad.value = ''; numPad.ask = null; numPad.error = '';
  push({ t: 'visit', total, darts });
}
export function noScore() {
  if (!match) return;
  const game = gameById(match.gameId), s = compute(match);
  if (s.winner != null || botUp(s) || s.turn.length || s.turnOver) return;
  if (usingPad(game)) {
    if (numPad.ask) return;
    return padCommit(0, 3);
  }
  push({ t: 'next', force: true });
}
export function bustVisit() {
  if (!match) return;
  const game = gameById(match.gameId), s = compute(match);
  if (s.winner != null || botUp(s) || s.turnOver || !game.bust || !game.canBust?.(s)) return;
  if (usingPad(game) && (s.turn.length || numPad.ask)) return;
  numPad.value = ''; numPad.ask = null; numPad.error = '';
  push({ t: 'bust' });
}

// ---------- speech-to-score (voice input) ----------
let micToast = null;  // {text, bad, until}
let micToastTimer = 0;
function showMicToast(text, bad = false) {
  micToast = { text, bad, until: Date.now() + 2600 };
  clearTimeout(micToastTimer);
  micToastTimer = setTimeout(() => {
    if (micToast && Date.now() >= micToast.until) micToast = null;
    if (screen === 'game' && match) renderGame();
  }, 2650);
  if (screen === 'game' && match) renderGame();
}
export function micState(st) {
  if (st.error) showMicToast(st.error, true);
  else if (screen === 'game' && match) renderGame();
}
export function handleVoice(alts) {
  if (screen !== 'game' || !match) return;
  if (document.querySelector('.quitask, .firstask')) return;
  const game = gameById(match.gameId), s = compute(match), pad = usingPad(game);
  const opts = { mode: pad ? 'pad' : 'board', askingFinish: pad && !!numPad.ask };
  let parsed = null, heard = alts[0] ?? '';
  for (const alt of alts) {
    const p = parseSpeech(alt, opts);
    if (p) { parsed = p; heard = alt.trim(); break; }
  }
  if (!parsed) {
    if (heard.trim()) showMicToast(`Didn't catch "${heard.trim()}"`, true);
    return;
  }
  if (parsed.kind === 'cmd' && parsed.cmd === 'undo') {
    if (!match.log.length) return;
    numPad.value = ''; numPad.ask = null; numPad.error = '';
    undo();
    return showMicToast(`"${heard}" → Undo`);
  }
  if (s.winner != null || botUp(s)) return;
  if (parsed.kind === 'cmd') {
    if (parsed.cmd === 'bust') { bustVisit(); return showMicToast(`"${heard}" → Bust`); }
    if (parsed.cmd === 'noscore') { noScore(); return showMicToast(`"${heard}" → No score`); }
    if (parsed.cmd === 'next' && !pad && !s.lastVisit?.auto) { push({ t: 'next' }); return showMicToast(`"${heard}" → End turn`); }
    return;
  }
  if (parsed.kind === 'fin' && pad && numPad.ask) {
    if (!numPad.ask.darts.includes(parsed.darts)) return showMicToast(`Can't finish in ${parsed.darts}`, true);
    padCommit(numPad.ask.total, parsed.darts);
    return showMicToast(`"${heard}" → ${parsed.darts} dart${parsed.darts > 1 ? 's' : ''}`);
  }
  if (parsed.kind === 'visit' && pad) {
    padQuick(parsed.total);
    return showMicToast(`"${heard}" → ${parsed.total}`);
  }
  if (parsed.kind === 'darts' && !pad) {
    const entered = [];
    for (const d of parsed.darts) {
      const cur = compute(match);
      if (cur.winner != null || botUp(cur)) break;
      push({ t: 'dart', ...d, src: 'voice' });
      entered.push(label(d));
    }
    if (entered.length) showMicToast(`"${heard}" → ${entered.join(' ')}`);
  }
}
function padHtml(s) {
  const game = gameById(match.gameId);
  const midVisit = s.turn.length && !s.turnOver;
  const bot = botUp(s);
  const msg = numPad.error || (bot ? `${esc(s.players[s.current])} is throwing` : midVisit ? 'Finish this visit on the board, or undo those darts'
    : numPad.ask ? `${numPad.ask.total} to finish. How many darts?`
    : s.legWon ? `${esc(s.players[s.legWon.player])} won the ${s.legWon.set ? 'set' : 'leg'}`
    : s.bust != null ? `${esc(s.players[s.bust])} busted`
    : s.lastVisit ? `${esc(s.players[s.lastVisit.player])} scored ${s.lastVisit.total}` : 'Type the visit total');
  const off = bot || midVisit || s.winner != null ? 'disabled' : '';
  const bustOff = off || !game.canBust?.(s) ? 'disabled' : '';
  const quick = numPad.ask ? ''
    : `<div class="pad-quick">${QUICK_SCORES.map(n => `<button data-quick="${n}" ${off}>${n}</button>`).join('')}</div>
       <div class="pad-fast${game.bust ? '' : ' solo'}"><button data-act="noscore" ${off}>No score</button>${
         game.bust ? `<button class="bust-btn" data-act="bust" ${bustOff}>Bust</button>` : ''}</div>`;
  const keys = numPad.ask
    ? numPad.ask.darts.map(n => `<button class="primary" data-fin="${n}">${n} dart${n > 1 ? 's' : ''}</button>`).join('')
      + '<button class="wide" data-key="cancel">Cancel</button>'
    : [7, 8, 9, 4, 5, 6, 1, 2, 3].map(n => `<button data-key="${n}" ${off}>${n}</button>`).join('')
      + `<button data-key="back" ${off} aria-label="Delete">⌫</button><button data-key="0" ${off}>0</button>
         <button class="primary" data-key="enter" ${off}>Enter</button>`;
  return `<div class="pad-out ${numPad.error ? 'bad' : ''}">${numPad.ask ? numPad.ask.total : numPad.value || '0'}</div>
    <div class="pad-msg ${numPad.error ? 'warn' : ''}">${msg}</div>${quick}<div class="pad-keys">${keys}</div>`;
}

// ---------- TV view ----------
// Another way to see a game (games with tv() only: X01), for one or two
// players: the board gets the screen and the scores go in one scoreboard along
// the bottom, a line per player, the way a match is shown on television.
const canTv = (game, s) => !!game.tv && s.players.length <= 2;
const usingTv = (game, s) => canTv(game, s) && settings.view === 'tv';
const tvCamOn = () => settings.tvCam !== false;
const TV_PEEK_MS = 900;
let tvPeek = null;  // {at: match.log.length, cam, until} briefly follows a dart outside the current frame
let tvPeekTimer = 0;
let lastTvCam = null;  // the TV camera shot on screen before the latest dart landed
let tvPanned = false;  // true while the player has manually dragged the zoomed-in board
let lastAutoCamKey = '';
function tvHtml(game, s) {
  const rows = s.players.map((p, i) => ({ p, i, ...game.tv(s, i) }));
  const sets = rows[0].sets != null;
  return `<table class="tv"><thead><tr><th class="title">${esc(game.tvTitle(s))}</th>
    ${sets ? '<th>Sets</th>' : ''}<th>Legs</th><th>Score</th><td class="gap"></td>
    <th>100+</th><th>140+</th><th>180s</th><th>Average</th></tr></thead>
    ${rows.map(r => `<tr class="${s.winner === r.i ? 'win' : s.winner == null && r.i === s.current ? 'cur' : ''}">
      <td class="name">${playerFlag(r.i)}${esc(r.p)}</td>${sets ? `<td>${r.sets}</td>` : ''}<td>${r.legs}</td><td class="score">${bigOf(r.i, r.score)}</td>
      <td class="gap"></td><td>${r.t100}</td><td>${r.t140}</td><td>${r.t180}</td><td class="avg">${r.average}</td></tr>`).join('')}
  </table>`;
}

// ---------- game ----------
export const gameBoard = {
  ui: null,
  boardBack: null,  // the id of a won game whose board has been asked back in place of its match stats
};
// Once a game is won its match stats take the board's place, until the board is asked back.
const statsUp = s => s.winner != null && gameBoard.boardBack !== match.id;
export function toggleMatchStats() {
  gameBoard.boardBack = gameBoard.boardBack === match.id ? null : match.id;
  renderGame();
}
// The country flag for player i, if set on their profile (or for a Career Mode AI pro).
const playerFlag = i => {
  const cf = match?.opts?.career?.proFlag;
  if (cf && i === 1) return `<span class="flag" aria-hidden="true">${cf}</span>`;
  return flagHtml(match?.playerIds?.[i]);
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
      <div class="boardwrap"><div class="tvcam-tag" hidden></div><svg id="board"></svg><div class="pad"></div><div class="matchstats" hidden></div></div><div class="tvbar"></div></div>`;
    const onPan = () => {
      tvPanned = true;
      tvPeek = null;
      clearTimeout(tvPeekTimer);
      const tag = document.querySelector('.tvcam-tag');
      if (tag && !tag.hidden) {
        tag.classList.add('panned');
        tag.innerHTML = '<span class="dot"></span><b>Manual view</b><span class="muted"> · Reset</span>';
      }
    };
    document.querySelector('.tvcam-tag')?.addEventListener('click', () => {
      if (!tvPanned) return;
      tvPanned = false;
      renderGame();
    });
    gameBoard.ui = buildBoard(document.getElementById('board'), d => { if (!botUp()) push({ t: 'dart', ...d, src: 'tap' }); }, { onPan });
  }
  const game = gameById(match.gameId);
  const s = compute(match);
  if (careerActive(match) && banter?.matchId !== match.id) setBanter('intro', careerLvl(match), match);
  loadBases();  // (once a game: what everyone held before it)
  if (s.winner != null && photoAsk && photosOn() === null) askPhotos();
  if (flash && Date.now() >= flash.until) flash = null;
  clearTimeout(flashTimer);
  if (flash) flashTimer = setTimeout(() => { if (screen === 'game' && match) renderGame(); }, flash.until - Date.now());
  if (held && !holding()) held = null;
  clearInterval(heldTick);
  if (held) heldTick = setInterval(() => {
    if (screen !== 'game' || !match || !holding()) { clearInterval(heldTick); if (screen === 'game' && match) renderGame(); return; }
    const el = document.querySelector('.visithold b');
    if (el) el.textContent = heldLeft();
  }, 250);
  const warming = warmupActive(match);
  const w = warming ? match.warmup : null;
  const pad = !warming && usingPad(game);
  // The TV view: the player cards give way to one scoreboard along the bottom.
  const tv = !warming && usingTv(game, s);
  document.querySelector('.game').classList.toggle('tv', tv);
  const tvBar = document.querySelector('.tvbar');
  tvBar.toggleAttribute('hidden', !tv);
  tvBar.innerHTML = tv ? tvHtml(game, s) : '';
  const summary = statsUp(s);
  document.getElementById('board').toggleAttribute('hidden', pad || summary);
  const padBox = document.querySelector('.pad');
  padBox.toggleAttribute('hidden', !pad || summary);
  padBox.innerHTML = pad && !summary ? padHtml(s) : '';
  const statsBox = document.querySelector('.matchstats');
  statsBox.toggleAttribute('hidden', !summary);
  statsBox.innerHTML = summary ? `<h2>Match stats</h2>${summaryHtml(matchSheet(match))}` : '';
  // Play moves on with the third dart. The dart slots start again empty for the
  // new visit; the board keeps the old darts marked until the next one lands,
  // and the old visit is listed in small print under the slots.
  // While a visit is kept up (above), its darts stay in the slots instead.
  const prev = previousVisit(s);
  const inSlots = warming ? w.turn : held ? held.darts : s.turn;
  const shown = warming ? w.turn : held ? held.darts : s.turn.length ? s.turn : s.lastVisit?.darts ?? (s.bust != null ? prev?.darts : null) ?? s.turn;
  const total = inSlots.reduce((t, d) => t + value(d), 0);
  const same = seen.id === match.id, grew = same && match.log.length > seen.len, shrank = same && match.log.length < seen.len;
  // a dart that has just come into its slot drops in; one an Undo has given back fades back in
  const came = i => (grew || shrank) && i >= seen.turn ? (grew ? ' pop' : ' back') : '';
  const slots = [0, 1, 2].map(i => inSlots[i]
    ? `<div class="slot${held ? '' : came(i)}"><b>${label(inSlots[i])}</b><small>Dart ${i + 1}</small></div>`
    : `<div class="slot empty${!held && i === s.turn.length && s.winner == null && !s.turnOver ? ' next' : ''}"><b>–</b><small>Dart ${i + 1}</small></div>`).join('');
  // A typed visit has no single darts to list (the number pad says what it scored).
  // The last visit: who threw it and its darts, small, on the left; what it scored, large, on the right.
  // A bust says so in place of the score; a game that keeps no totals has no score.
  const lastDarts = prev && prev.darts.map(label).join('<i> · </i>');
  const lastScore = prev && (prev.bust ? '<b class="warn">Bust</b>'
    : game.showTotal === false ? '' : `<b>${prev.darts.reduce((t, d) => t + value(d), 0)}</b>`);
  const last = prev && !prev.typed && !held ? `<div class="lastvisit"><div><span>Last visit${
    s.players.length > 1 ? ` · ${esc(s.players[prev.player])}` : ''}</span><span class="lastdarts">${lastDarts}</span></div>${lastScore}</div>` : '';
  const routine = match.opts?.routine;
  const nextWarmup = routine && WARMUP_STEPS[routine.step + 1];
  const routineTag = routine ? ` <span class="rtag">Warm-up ${routine.step + 1}/${WARMUP_STEPS.length}</span>` : '';
  let banner = '';
  if (warming) banner = `<div class="banner">Warm-up · ${esc(s.players[w.current])} · ${w.darts - w.thrown[w.current]} dart${w.darts - w.thrown[w.current] === 1 ? '' : 's'} left</div>`;
  else if (s.winner != null) banner = `<div class="banner win">${routine && !nextWarmup ? 'Warm-up complete! ' : ''}${esc(s.capWin ? `Max darts hit — ${s.players[s.winner]} wins!` : game.result?.(s) ?? `${s.players[s.winner]} wins!`)}</div>`;
  else if (s.legWon) banner = `<div class="banner win">${s.legWon.cap ? 'Max darts hit — ' : ''}${s.legWon.set ? 'Set' : 'Leg'} to ${esc(s.players[s.legWon.player])}!${
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
    s.winner != null && `<button class="ghost" data-act="matchstats">${statsUp(s) ? 'Show the board' : 'Match stats'}</button>`,
    s.winner != null && '<button class="ghost" data-act="sharecard">Share card</button>',
    canTv(game, s) && `<button class="ghost" data-act="tv">${tv ? 'Card view' : 'TV view'}</button>`,
    tv && !pad && !summary && game.tvCamera && `<button class="ghost" data-act="tvcam">${tvCamOn() ? 'Full board' : 'TV camera'}</button>`,
    game.visit && `<button class="ghost" data-act="entry">${pad ? 'Use board' : 'Type scores'}</button>`,
    ((connected && cameraCount > 0) || phone.scoring()) && '<button class="ghost" data-act="report" title="A dart was scored wrongly: save what the cameras saw">Report a dart</button>',
    s.winner == null && '<button class="ghost" data-act="quit">Quit game</button>',
  ].filter(Boolean).join('');
  const left = held || s.winner != null || s.turnOver ? '' : `${3 - s.turn.length} dart${s.turn.length === 2 ? '' : 's'} to throw`;
  const visit = `<div class="visit${grew && s.bust != null ? ' busted' : ''}">
      ${pad && !s.turn.length && !held ? '' : `<div class="visit-head"><span>${s.players.length > 1 && s.winner == null ? `${esc(s.players[held ? held.player : s.current])}'s visit` : 'This visit'}</span><span class="muted">${left}</span></div>
      <div class="turn">${slots}<div class="slot total ${held?.bust || !held && s.note ? 'bust' : ''}"><b>${held ? (held.bust ? 'Bust' : game.showTotal === false ? '' : total)
        : s.note || (game.showTotal === false ? '' : total)}</b><small>${!held && s.note || held?.bust ? '' : 'Total'}</small></div></div>`}
      ${last}</div>`;
  const sfxIcon = sfxOn()
    ? icon('<path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/>')
    : icon('<path d="M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/>');
  const micOn = speech.active();
  if (s.winner != null && micOn) speech.stop();
  const micIcon = icon('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/>');
  const micBtn = speech.supported() && s.winner == null
    ? `<button class="micbtn ${micOn ? 'on' : ''}" data-act="mic-toggle" title="${micOn ? 'Stop voice scoring (V)' : 'Hands-free voice scoring (V)'}" aria-label="${micOn ? 'Stop voice scoring' : 'Start voice scoring'}" aria-pressed="${micOn}">${micOn ? '<i class="micdot"></i>' : ''}${micIcon}<span>${micOn ? (speech.listening() ? 'Listening' : 'Paused') : 'Voice'}</span></button>` : '';
  if (micToast && Date.now() >= micToast.until) micToast = null;
  const micBar = micToast
    ? `<div class="micbar ${micToast.bad ? 'bad' : 'ok'}" role="status">${esc(micToast.text)}</div>`
    : micOn ? `<div class="micbar live" role="status"><i class="micdot"></i>${speech.listening() ? (pad ? 'Listening… say a score, "no score", "bust" or "undo"' : 'Listening… say a bed (e.g. "treble 20"), "miss", "bust" or "undo"') : 'Paused while caller speaks…'}</div>` : '';
  document.querySelector('.side').innerHTML = `
    <div class="top"><button class="ghost" data-act="home">‹ Menu</button>
      <span class="title"><b>${game.name}</b>${routineTag} <span class="clock" title="Match time">${clock(elapsed(match, s))}</span></span>
      <span class="spacer"></span><span class="conn brief muted"></span>
      ${micBtn}
      <button class="ghost soundbtn ${sfxOn() ? 'on' : ''}" data-act="sfx-toggle" title="${sfxOn() ? 'Mute sound effects' : 'Turn on sound effects'}" aria-label="${sfxOn() ? 'Mute sound effects' : 'Turn on sound effects'}">${sfxIcon}</button></div>
    ${micBar}
    ${tv ? '' : flash ? `<div class="players">${flashHtml(s)}</div>` : `<div class="players">${s.players.map((p, i) => {
      const v = warming
        ? { big: w.thrown[i] >= w.darts ? 'Ready' : w.darts - w.thrown[i], small: w.thrown[i] >= w.darts ? 'warm-up done' : 'warm-up darts left' }
        : game.summary(s, i);
      const cur = warming ? i === w.current : s.winner == null && i === s.current;
      return `<div class="pcard ${!warming && s.winner === i ? 'win' : cur ? 'cur' : ''}${v.out ? ' out' : ''}${warming ? '' : moved(i)}">
        <div class="name">${playerFlag(i)}${esc(p)}${playingWith(i)}</div><div class="big">${v.big}</div><div class="small">${v.small}</div></div>`;
    }).join('')}</div>`}
    ${banterHtml()}
    ${game.panel ? game.panel(s) : ''}
    ${visit}
    ${game.hint ? `<div class="hint">${s.winner == null ? esc(game.hint(s, { checkouts: settings.checkouts !== false })) : ''}</div>` : ''}
    ${slipHtml()}
    ${banner}${s.winner != null ? earnedLine() : ''}
    ${held ? `<div class="botwait visithold"><span>${s.players.length > 1 ? `${esc(s.players[held.player])}'s darts` : 'Your darts'} stay up for <b>${heldLeft()}</b>s. Score wrong? Undo it now.</span>
      <button data-act="holdgo">Carry on</button></div>` : ''}
    ${botHolds(s) ? `<div class="botwait"><span>${esc(s.players[s.current])} throws in <b>${botHold?.at === match.log.length ? botHoldLeft() : botHoldSecs()}</b>s. Score wrong? Undo it now.</span>
      <button data-act="botgo">Throw now</button></div>` : ''}
    <div class="actions ${pad && s.winner == null ? 'solo' : ''}">
      <button data-act="undo" ${(warming ? w.log.length : match.log.length) ? '' : 'disabled'}>Undo</button>
      ${warming
        ? '<button data-act="miss">Miss</button><button class="primary" data-act="warmup-skip">Start match</button>'
        : s.winner != null
          ? `<button data-act="home">Menu</button>${match.opts?.tournament
            ? '<button class="primary" data-act="tour-back">Back to the tournament</button>'
            : match.opts?.career
              ? '<button class="primary" data-act="career-back">Back to Career</button>'
              : nextWarmup
                ? `<button class="primary" data-act="warmup-next">Next: ${esc(nextWarmup.short)} ›</button>`
                : '<button class="primary" data-act="rematch">Play again</button>'}`
          : pad ? '' : `<button data-act="miss" ${botUp(s) ? 'disabled' : ''}>Miss</button>
             <button class="primary end${s.turnOver ? ' ready' : ''}" data-act="next" ${botUp(s) ? 'disabled' : ''}>End turn</button>`}
    </div>
    ${!warming && s.winner == null && !pad ? `<div class="quick-acts${game.bust ? '' : ' solo'}">
      <button data-act="noscore" ${botUp(s) || s.turn.length || s.turnOver ? 'disabled' : ''}>No score</button>${
      game.bust ? `<button class="bust-btn" data-act="bust" ${botUp(s) || s.turnOver || !game.canBust?.(s) ? 'disabled' : ''}>Bust</button>` : ''}
    </div>` : ''}
    ${tools ? `<div class="tools">${tools}</div>` : ''}
    ${s.winner == null ? `<div class="kbd-hint">${pad ? `Keys: 0–9 type · Enter submit · N no score${game.bust ? ' · B bust' : ''} · P board · Z undo${speech.supported() ? ' · V voice' : ''}` : `Keys: M miss · N no score${game.bust ? ' · B bust' : ''} · Space end turn · Z undo · T TV · P keypad${speech.supported() ? ' · V voice' : ''}`}</div>` : ''}`;
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
  const target = game.target?.(s) ?? null;
  const coOn = settings.checkouts !== false && settings.checkoutHighlight !== false;
  const coTarget = !target && !botUp(s) ? game.checkoutTarget?.(s, { checkouts: coOn }) ?? null : null;
  let tvCam = tv && !pad && !summary && tvCamOn() && !target ? game.tvCamera?.(s) ?? null : null;
  const autoCamKey = tvCam ? tvCam.viewBox.map(n => Math.round(n)).join(',') : '';
  if (!tvCam || s.winner != null || arrive || ((grew || shrank) && !s.turn.length) || autoCamKey !== lastAutoCamKey) tvPanned = false;
  lastAutoCamKey = autoCamKey;
  if (tvPeek && (tvPeek.at !== match.log.length || Date.now() >= tvPeek.until || !tvCam)) {
    tvPeek = null;
    clearTimeout(tvPeekTimer);
  }
  if (fresh && tvCam && s.winner == null) {
    const lastDart = match.log.at(-1);
    const seenBox = tvPanned ? (gameBoard.ui.viewBox?.() ?? tvCam.viewBox) : (lastTvCam?.viewBox ?? tvCam.viewBox);
    const bullHit = lastDart?.seg === 25 && tvCam.mode !== 'bull';
    const outOfSeen = lastDart && !dartInView(lastDart, seenBox);
    // If a visit just ended (Dart 3 or Bust) and the camera is about to pan away
    // from where the missed dart went (e.g. missed D16 or Bull), hold briefly to show it.
    const leavingDart = !s.turn.length && lastDart && !dartInView(lastDart, tvCam.viewBox);
    if (lastDart && ((!tvPanned && bullHit) || outOfSeen || leavingDart)) {
      const cam = (bullHit || outOfSeen) ? cameraForDart(lastDart) : (lastTvCam ?? cameraForDart(lastDart));
      tvPeek = { at: match.log.length, cam, until: Date.now() + TV_PEEK_MS };
      clearTimeout(tvPeekTimer);
      tvPeekTimer = setTimeout(() => {
        tvPeek = null;
        if (screen === 'game' && match) renderGame();
      }, TV_PEEK_MS);
    }
  }
  if (tvPeek && tvCam) tvCam = tvPeek.cam;
  lastTvCam = tvCam;
  const camTag = document.querySelector('.tvcam-tag');
  if (camTag) {
    camTag.toggleAttribute('hidden', !tvCam);
    camTag.classList.toggle('panned', !!tvCam && tvPanned);
    camTag.classList.toggle('finish', !!tvCam && !tvPanned && !!tvCam.finishing);
    camTag.innerHTML = !tvCam ? ''
      : tvPanned ? '<span class="dot"></span><b>Manual view</b><span class="muted"> · Reset</span>'
      : `<span class="dot"></span><b>${esc(tvCam.camTag)}</b>${tvCam.subtitle ? `<span class="muted"> · ${esc(tvCam.subtitle)}</span>` : ''}`;
  }
  const activeView = tvPanned && tvCam ? (gameBoard.ui.viewBox?.() ?? tvCam.viewBox) : (tvCam?.viewBox ?? null);
  gameBoard.ui.showTarget(target ?? coTarget, { zoom: !!target, viewBox: activeView, glideMs: tvPeek ? 260 : tvCam?.finishing ? 520 : 340 });
  refreshStatus();
  fit();
  botSoon();
  syncAtmosphere(s);
}

// The match clock in the top bar ticks between renders.
setInterval(() => {
  const el = screen === 'game' && match && document.querySelector('.clock');
  if (el) el.textContent = clock(elapsed(match));
}, 1000);
