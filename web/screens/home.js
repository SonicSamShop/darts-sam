// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The menu (Play): the game, its options and who is playing, a step each, with
// How to play, the computer's level and everyone's X01 average.

import { GAMES } from '../games/index.js';
import { canStart, compute, gameById, needsMore } from '../engine.js';
import { LEVELS, levelFor } from '../bot.js';
import { x01Stats } from '../stats.js';
import { renderLanding } from './landing.js';
import { newPlayerRow, roster } from './playerspanel.js';
import { pct } from './stats.js';
import { currentTournament, onMatchWon, slotTitle, tourMarked } from './tournament.js';
import { WARMUP_STEPS, practiceStreak } from '../routine.js';
import {
  $app, BOT, account, api, botAt, cleanSetup, connected, dartsFor, esc, fit, grams, loadStats, match, nameOf,
  pageFoot, pageHead, players, redraw, refreshStatus, screen, seats, setMatch, setScreen, setTotals, setsOf,
  setup, statsPath, store, totals, updater
} from '../app.js';

// Whether "Tournament" is on the menu (a computer's line and a phone's). On since 1.8.
const TOURNAMENT_ON_MENU = true;

// What is open on the menu. step: on a phone, the step that is open ('game', 'options' or
// 'players'), or null for none. Not chosen yet (undefined): none when somebody is down to
// play, so the menu opens as three lines and Start, and otherwise the players.
export const menu = {
  step: undefined,
  stepMoved: false,  // a step has just been opened: bring it into view
  optHelp: null,  // the option whose "?" is open: its line saying what the chosen setting means shows under it
  rulesOpen: false,  // How to play (see loadRules)
  rules: null,  // rules: {gameId: section html} once read, {} if it couldn't be
  rulesMoved: false,  // they have just been opened, or have just arrived: bring them into view
};

// ---------- home ----------
export function renderHome() {
  if (account.locked) return renderLanding();
  setScreen('home');
  // A game that is over has been looked at for the last time. (A tournament's match first gives its
  // bracket the result, if the bracket never heard of it: the app closed on the winning dart, say, and once
  // the game has been sent this is the only copy of it here. Otherwise that changes nothing.)
  if (match && compute(match).winner != null) {
    if (match.opts?.tournament) onMatchWon(match);
    setMatch(null);
    store.set('match', null);
  }
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
  if (menu.step === undefined) menu.step = seats().length ? null : 'players';
  if (!steps.some(s => s[0] === menu.step)) menu.step = null;
  // One step of the menu. On a phone it is a numbered line saying what is chosen, which opens
  // to change it; on a computer every step is open under its heading (see style.css).
  const step = (id, body) => {
    const n = steps.findIndex(s => s[0] === id), [, name, brief, note] = steps[n], open = menu.step === id;
    return `<section class="step ${open ? 'open' : ''}" data-is="${id}">
      <button class="step-head" data-step="${id}" aria-expanded="${open}"><i>${n + 1}</i><span><small>${name}</small><b>${brief}</b>${
        note ? `<small>${note}</small>` : ''}</span><u>${open ? 'Done' : 'Change'}</u></button>
      <div class="step-body"><h2>${name}</h2>${body}</div></section>`;
  };
  const after = id => steps[steps.findIndex(s => s[0] === id) + 1];
  // A tournament going: the way back to it, with the match being played, or else its next one.
  const cup = currentTournament(), cupNext = cup && tourMarked(cup);
  const going = [
    match ? '<button class="start" data-act="resume">Resume game in progress</button>' : '',
    cup ? `<button class="start" data-act="tournament">Back to the tournament: ${esc(cup.name)}${cupNext != null ? `, ${esc(slotTitle(cup, cupNext))}` : ''}</button>` : '',
  ].join('');
  $app.innerHTML = `<div class="page">
    ${pageHead('home')}
    <div class="home-body">
    <div class="pick ${menu.rulesOpen ? 'rules-on' : ''}">
    ${going ? `<h2>In progress</h2><div class="inprogress">${going}</div>` : ''}
    ${step('game', `${[['match', 'Matches'], ['training', 'Training']].map(([kind, title]) => `<h3 class="group">${title}</h3>${kind === 'match' ? tourLine('link') : warmupLine()}
    <div class="games">${GAMES.filter(g => g.kind === kind).map(g => `<button class="game-card ${g.id === game.id ? 'on' : ''}" data-game="${g.id}">
      <b>${g.name}</b><span>${g.blurb}</span></button>`).join('')}</div>`).join('')}
    <p class="blurb muted small">${game.blurb}</p>
    ${howToPlay(game)}`)}
    
    </div>
    <div class="setup">
    ${game.options.length ? step('options', `${game.options.map(o => `<div class="opt"><span>${o.help ? optLabelHelp(o) : o.label}</span>${o.choices ? `<div class="choices">${o.choices.map(([v, l]) =>
      `<button class="${setup.opts[o.key] === v ? 'on' : ''}" data-opt="${o.key}" data-val="${esc(JSON.stringify(v))}"${
        o.help ? ` title="${esc(o.help(v, { ...setup.opts, [o.key]: v }))}"` : ''}>${l}</button>`).join('')}</div>`
      : stepper(o)}${o.help && menu.optHelp === o.key ? `<p class="opt-help muted">${esc(o.help(setup.opts[o.key], setup.opts))}</p>` : ''}</div>`).join('')}
    <button class="step-next" data-step="${after('options')[0]}">Next: ${after('options')[1].toLowerCase()}</button>`) : ''}
    ${step('players', `${players.length ? `<div class="row">${players.map(p => {
      const n = seats().indexOf(p.id);
      return `<button class="chip ${n >= 0 ? 'on' : ''}" data-pick="${p.id}">${n >= 0 ? `<i>${n + 1}</i>` : ''}${esc(p.name)}</button>`;
    }).join('')}${game.bot ? botChip() : ''}${roster.adding ? '' : '<button class="chip ghost" data-act="newplayer">+ New</button>'}</div>
    <p class="muted small">Tap who is playing, in throwing order. With two or more, Start asks who throws first: closest to the bull, or random.</p>
    ${averagesLine() ? `<p class="muted small averages">${averagesLine()}</p>` : ''}
    ${botRow()}${dartsRows()}`
      : '<p class="muted">Add a player to get started.</p>'}
    ${roster.adding || !players.length ? newPlayerRow() : ''}`)}
    ${howToPlay(game, 'how-phone')}
    ${tourLine('tour-phone')}
    ${warmupHtml()}
    ${quickStartsHtml()}
    <span class="spacer"></span>
    ${start}
    </div>
    <p class="totals" id="totals"></p>
    </div>
    <div class="startbar">${start}</div>
    ${pageFoot('home')}
  </div>`;
  document.querySelector('.home-body').scrollTop = scrolled;
  if (menu.stepMoved) document.querySelector('.step.open')?.scrollIntoView({ block: 'nearest' });
  // The rules open at the foot of a phone's menu, which may be off the screen: up to their heading.
  const how = menu.rulesMoved && menu.rulesOpen && document.querySelector('.how-phone');
  if (how?.offsetParent) how.scrollIntoView({ block: 'start' });
  menu.stepMoved = menu.rulesMoved = false;
  refreshStatus();
  showTotals();
  loadTotals();
  loadAverages();
  fit();
  if (roster.adding) document.getElementById('newplayer')?.focus();
}
// "How to play" the chosen game, opened on the menu like an option's "?". The rules are
// web/rules.html's section for the game (its id), read once and kept, so the page and the
// menu say the same thing and it works offline (sw.js keeps the page).
export function loadRules() {
  if (menu.rules) return;
  menu.rules = fetch('rules.html').then(r => (r.ok ? r.text() : Promise.reject())).then(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html'), got = {};
    for (const sec of doc.querySelectorAll('main section[id]')) {
      sec.querySelector('h2')?.remove();  // the menu already names the game
      for (const a of sec.querySelectorAll('a')) a.replaceWith(...a.childNodes);  // nothing that leads off the menu
      got[sec.id] = sec.innerHTML;
    }
    return got;
  }, () => ({})).then(got => { menu.rules = got; if (screen === 'home' && menu.rulesOpen) { menu.rulesMoved = true; renderHome(); } });
}
// On a computer it is under the game's blurb, and open it takes the place of the games (the menu
// there doesn't scroll, so they would squeeze it all smaller): the way back to them is beside its
// heading. On a phone, where the menu scrolls and the blurb is hidden, it is above Start.
function howToPlay(game, where = '') {
  const title = `How to play ${esc(game.name)}`;
  if (!menu.rulesOpen) return `<div class="how ${where}"><button class="link" data-act="rules" aria-expanded="false">${title}</button></div>`;
  const body = menu.rules instanceof Promise ? '<p class="muted">Loading the rules…</p>'
    : menu.rules?.[game.id] ?? '<p class="muted">The rules couldn\'t be loaded. Try again when you are back online.</p>';
  return `<div class="how open ${where}"><div class="how-head"><h3>${title}</h3>
      <button class="link" data-act="rules" aria-expanded="true">${where ? 'Hide the rules' : 'Back to the games'}</button></div>
    <div class="rules-box">${body}</div></div>`;
}
// Tournament, which is not one of the games. On a computer it is at the end of the "Matches" line, in the room
// beside that heading: the menu there is laid out to fit one screen, and a line of its own would squeeze it all
// smaller (style.css, .pick .tourline). On a phone (where: 'tour-phone'), where the menu scrolls, it is a line
// of its own under the steps. Neither is drawn while TOURNAMENT_ON_MENU is off.
const tourLine = (where = '') => (TOURNAMENT_ON_MENU ? `<button class="tourline ${where}" data-act="tournament"><b>Tournament</b>
  <span>A knockout for 3 to 16 players, people and bots</span></button>` : '');
// One-tap recent setups on phones, filling the empty space below the 3 steps.
export function quickPresets() {
  const valid = r => {
    const g = gameById(r.gameId);
    if (!g) return false;
    const ps = (r.players ?? []).filter(id => id === BOT ? !!g.bot : players.some(p => p.id === id));
    return ps.some(id => id !== BOT) && canStart(g, ps.length);
  };
  const saved = store.get('recents', []).filter(valid);
  if (saved.length) return saved;
  if (!players.length) return [];
  const p = players[0].id;
  return [
    { gameId: 'x01', opts: { start: 501, legs: 1, sets: 1 }, players: [p, BOT], bot: setup.bot ?? 5 },
    { gameId: 'clock', opts: {}, players: [p], bot: setup.bot ?? 5 },
  ];
}
function quickStartsHtml() {
  const list = quickPresets();
  if (!list.length) return '';
  const describe = r => {
    const g = gameById(r.gameId);
    const title = r.gameId === 'x01' ? `${r.opts?.start ?? 501}${r.opts?.legs > 1 ? ` · ${r.opts.legs} legs` : ''}` : g.name;
    const who = r.players.map(id => id === BOT ? `Bot ${r.bot ?? 5}` : nameOf(id)).join(', ');
    return { title, who };
  };
  return `<div class="quickstarts"><h3>Quick start</h3><div class="qlist">${list.map((r, i) => {
    const { title, who } = describe(r);
    return `<button class="qcard" data-quickstart="${i}"><b>${esc(title)}</b><span>${esc(who)}</span></button>`;
  }).join('')}</div></div>`;
}
function warmupLine() {
  if (!players.length) return '';
  const { days, doneToday } = practiceStreak(store);
  const tag = days ? `${days}-day streak${doneToday ? ' ✓' : ''}` : 'Clock → Bob\'s 27 → 121';
  return `<button class="tourline link" data-act="warmup"><b>Daily warm-up</b> <span>${tag}</span></button>`;
}
function warmupHtml() {
  if (!players.length) return '';
  const { days, doneToday } = practiceStreak(store);
  const badge = days ? `${days}-day streak${doneToday ? ' ✓' : ''}` : 'Start your streak';
  const chain = WARMUP_STEPS.map(s => s.short).join(' → ');
  return `<button class="warmup warmup-phone" data-act="warmup">
    <span><b>Daily warm-up</b><small>${chain}</small></span>
    <span class="streak ${days ? 'lit' : ''}">${badge}</span>
  </button>`;
}
// An option's name with its "?" after it, kept on a line with the name's last word.
function optLabelHelp(o) {
  const cut = o.label.lastIndexOf(' ') + 1;
  return `${o.label.slice(0, cut)}<span class="nowrap">${o.label.slice(cut)}<button class="opt-q"
    data-opthelp="${o.key}" aria-label="What does ${esc(o.label)} mean?" aria-expanded="${menu.optHelp === o.key}">?</button></span>`;
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
export const avgAsked = new Map();  // player id -> when theirs was last asked for
const AVG_FRESH = 60000;
const onX01 = () => setup.gameId === 'x01';
export function loadAverages() {
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
export function followSuggestion() {
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
export const startOpts = () => Object.fromEntries(gameById(setup.gameId).options.map(o => [o.key, setup.opts[o.key]]));
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
export async function loadTotals() {
  const asked = ++totalsAsked;
  try {
    const t = await api('/totals', 'GET', undefined, 4000);
    if (asked !== totalsAsked) return;
    setTotals(t);
    store.set('totals', totals);
    showTotals();
  } catch { /* no server: the last figures stay */ }
}
