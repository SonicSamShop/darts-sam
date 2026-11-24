// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Starting a game: with two or more playing, who throws first (at random, or by
// throwing for the bull, a screen of its own), and then the new match.
// Who plays is given as a "play": {gameId, ids, opts, tournament?: {id, slot}}. The menu
// passes its own (homePlay); a tournament passes a match of its bracket, and leaves setup alone.

import { compute, gameById, newMatch } from '../engine.js';
import { buildBoard, bullMm, bullUp, label } from '../board.js';
import { botLevel, throwAt } from '../bot.js';
import { renderHome, startOpts } from './home.js';
import { BOT_WAIT, gameBoard, renderGame } from './game.js';
import { onMatchStarted, openTournament } from './tournament.js';
import {
  $app, BOT, botAt, botPlayer, bots, dartsFor, data, esc, fit, isBotId, levelOf, mark, match, nameOf, players,
  randomOrder, refreshStatus, saveSetup, say, screen, seats, setMatch, setScreen, setup, store
} from '../app.js';

// The menu's game: its players (BOT for the computer, made its level's player at the start), game and options.
export const homePlay = () => ({ gameId: setup.gameId, ids: seats(), opts: startOpts() });

// With two or more playing, Start (and Play again) asks how to settle who throws first:
// a dart each at the bull (see renderBull), or at random. The last answer is kept
// (setup.first) and is the one lit the next time.
let firstAsk = null;  // the question, while it is on screen
let firstPlay = null;  // who it is for
export function askFirst(act, play) {
  closeFirst();
  firstPlay = play;
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
export function closeFirst() { firstAsk?.remove(); firstAsk = null; firstPlay = null; }
document.addEventListener('click', e => {
  const first = e.target.closest('.firstask [data-first]')?.dataset.first;
  if (!first) return;
  const act = firstAsk.dataset.act, play = firstPlay;
  closeFirst();
  if (first === 'cancel') return;
  setup.first = first;
  saveSetup();
  if (first === 'bull') return openBull(act, play);
  startMatch(act, play, randomOrder(play.ids));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFirst(); });

// Throwing for the bull: the players throw one dart each, in the order they were picked,
// on the board (tapped, or seen by the cameras) and the game then starts in the order
// that gives (bullUp in board.js has the rules). It has no address of its own: going back
// leaves it, for the menu or the game just finished.
export let bull = null;  // {act: 'start' or 'rematch', play, ids: the players, darts: each dart thrown, timer: the game about to start}
const BULL_PAUSE = 4000;  // ms the result stays up before the game starts by itself
export function openBull(act, play) {
  bull = { act, play, ids: play.ids, darts: [], timer: 0, botTimer: 0 };
  say(`Closest to the bull. ${nameOf(bull.ids[0])} to throw`);
  renderBull();
}
export function closeBull() {
  if (!bull) return;
  clearTimeout(bull.timer);
  clearTimeout(bull.botTimer);
  const { act, play } = bull;
  bull = null;
  if (screen !== 'bull') return;
  if (act === 'rematch' && match) renderGame();
  else if (play.tournament) openTournament(play.tournament.id);
  else renderHome();
}
// Left by Back: no game starts from it.
export function dropBull() { if (bull) { clearTimeout(bull.timer); bull = null; } }
// "Random instead": the game starts at once, in a random order.
export function bullRandom() { const { act, play } = bull; clearTimeout(bull.timer); bull = null; return startMatch(act, play, randomOrder(play.ids)); }
// bot: the dart is the computer's own. While it is the computer's throw, no other dart counts.
export function bullDart(d, bot = false) {
  const now = bullUp(bull.ids, bull.darts);
  if (now.order) return;  // settled: a dart now is not part of it
  if (isBotId(now.next) !== bot) return;
  bull.darts.push(bot ? { ...d, bot } : d);
  const b = bullUp(bull.ids, bull.darts);
  if (b.order) {
    say(`${nameOf(b.order[0])} is closest`);
    bull.timer = setTimeout(bullStart, BULL_PAUSE);
  } else if (b.again && !b.thrown) say(`Level. ${b.round.map(nameOf).join(' and ')} throw again. ${nameOf(b.next)} to throw`);
  else say(`${nameOf(b.next)} to throw`);
  renderBull();
}
export function bullStart() {
  if (screen !== 'bull' || !bull) return;
  const { act, play, ids, darts } = bull, { order } = bullUp(ids, darts);
  if (!order) return;
  clearTimeout(bull.timer);
  bull = null;
  startMatch(act, play, order);
}
// The computer's dart at the bull, a moment after its turn comes, at that seat's own level.
function bullBot() {
  const mine = bull, next = bullUp(mine.ids, mine.darts).next;
  clearTimeout(mine.botTimer);
  if (!isBotId(next)) return;
  mine.botTimer = setTimeout(() => {
    if (bull === mine && screen === 'bull') bullDart(throwAt({ seg: 25, mult: 2 }, botLevel(levelOf(next)).finish), true);
  }, BOT_WAIT);
}
const nth = n => `${n}${['th', 'st', 'nd', 'rd'][n % 10 < 4 && (n % 100 - n % 10 !== 10) ? n % 10 : 0]}`;
export function renderBull() {
  if (screen !== 'bull' || !document.querySelector('.bullup')) {
    setScreen('bull');
    $app.innerHTML = `<div class="game bullup"><div class="side"></div><div class="boardwrap"><svg id="board"></svg></div></div>`;
    gameBoard.ui = buildBoard(document.getElementById('board'), d => bullDart(d));
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
  gameBoard.ui.showDarts(b.thrown ? bull.darts.slice(-b.thrown) : bull.darts.slice(-b.round.length));
  gameBoard.ui.showTarget(null);
  refreshStatus();
  fit();
  bullBot();
}
// A new game with the players in `play`, throwing in `order` (as given, when there is none): from Start on the
// menu, "Play again" at the end of a game (which takes that game's place in the history), or a tournament's match.
export function startMatch(act, play, order) {
  // (the order settled a moment ago, less anyone removed since, on another device say)
  const here = id => id === BOT || players.some(p => p.id === id) || bots.some(b => b.id === id);
  const seated = (order ?? play.ids).filter(id => play.ids.includes(id) && here(id));
  // A tournament's match is played by both its players or not at all: back to the bracket.
  if (play.tournament && seated.length !== play.ids.length) return openTournament(play.tournament.id);
  if (!seated.some(id => !isBotId(id))) return renderHome();
  // The computer takes its seat as the player its level's games are kept under.
  const level = botAt().level;
  const ids = seated.map(id => id === BOT ? botPlayer(level) : id).filter(id => id != null);
  const opts = play.tournament ? { ...play.opts, tournament: play.tournament } : play.opts;
  setMatch({
    ...newMatch(play.gameId, ids.map(nameOf), opts),
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    playerIds: ids, darts: ids.map(dartsFor), board: data.wallBoard(), bots: ids.map(levelOf), seq: 0,
  });
  store.set('match', match);
  if (play.tournament) onMatchStarted(match);
  const opening = compute(match), aim = gameById(match.gameId).aim?.(opening);  // the first thing to aim at (Random Targets, Around the Clock)
  const who = opening.players.length > 1 ? opening.players[opening.current] : '';  // who throws first, when there is more than one
  const opener = aim ? (who ? `${who}, aim for ${aim}` : `Aim for ${aim}`) : who && `${who} to throw first`;
  say(opener ? `Game on. ${opener}` : 'Game on');
  renderGame();
  mark(act === 'start');
}
