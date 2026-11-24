// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The Tournament screen: setting one up (name, players and bots, the game, how
// long each round's matches are), then the bracket, with the next match to play
// on the board. The rules of the bracket are in ../tournament.js; this screen only
// decides what to show and when to save. A match of the bracket is an ordinary
// match carrying opts.tournament = {id, slot}: the game screen tells this one when
// it is won, undone or quit (onMatchWon, onMatchUndone, onMatchQuit).

import { compute, gameById } from '../engine.js';
import { LEVELS } from '../bot.js';
import {
  botSlots, clearResult, defaultRounds, dropMatch, freeLevel, makeDraw, nextSlot, reconcile, roundName,
  simulateMatch, startSlot, suggestName
} from '../tournament.js';
import { renderLanding } from './landing.js';
import { askFirst } from './start.js';
import {
  $app, account, bots, botPlayer, data, esc, fit, match, pageFoot, pageHead, players, redraw, refreshStatus,
  screen, setMatch, setScreen, store
} from '../app.js';

// What the screen shows. id: the tournament on screen (null: the one going, or a new one to set up).
// setup: the new tournament being set up, kept while the app is open:
//   {name, ids: people's ids, bots: [level], start, out, rounds: [{legs}], draw: the drawn record or null}.
// abandoning: "Abandon tournament" has been pressed once and is asking.
export const tourView = { id: null, setup: null, abandoning: false };

const MIN = 3, MAX = 16;
const x01 = () => gameById('x01');
const legsOpt = () => x01().options.find(o => o.key === 'legs');

// The tournament going: the newest that is neither finished nor abandoned.
export const currentTournament = () => data.tournaments().find(t => !t.finished && !t.abandoned) ?? null;

// A player of tournament t, by the name they go by now (or the one kept, for someone removed since).
const entrant = (t, id) => t.data.entrants.find(e => e.id === id);
export function tourName(t, id) {
  if (id === 'bye') return 'bye';
  const p = players.find(p => p.id === id) ?? bots.find(p => p.id === id);
  return p?.name ?? entrant(t, id)?.name ?? '?';
}
const isBotIn = t => id => entrant(t, id)?.bot != null;
// "Sam v Jake": slot i's two players.
export const slotTitle = (t, i) => `${tourName(t, t.data.slots[i].a)} v ${tourName(t, t.data.slots[i].b)}`;
// The next match to play on the board, or null.
export const tourNext = t => nextSlot(t, isBotIn(t));

// A saved match by id: the one in progress, or one still waiting here to be sent.
const matchById = id => (match?.id === id ? match : store.get('pending', {})[id]?.m ?? null);
const save = t => { data.saveTournament(t); return data.tournament(t.id); };

// ---------- the game screen tells us ----------
// Each finds the match's tournament and slot, and does nothing if the tournament has
// gone, is over, or has moved on from that slot (changed on another screen, say).
function slotOf(m) {
  const at = m?.opts?.tournament, t = at && data.tournament(at.id);
  if (!t || t.finished || t.abandoned) return null;
  const s = t.data.slots[at.slot];
  if (!s || ![s.a, s.b].every(id => m.playerIds?.includes(id))) return null;
  return { t, i: at.slot, s };
}
// A match of the bracket has started: the slot knows its match, so its result can be
// found again from the match alone (reconcile).
export function onMatchStarted(m) {
  const at = slotOf(m);
  if (at && at.s.winner == null) { save(startSlot(at.t, at.i, m.id)); data.sync(); }
}
// The winning dart: the result goes into the bracket at once, not when the screen is left.
export function onMatchWon(m) {
  const at = slotOf(m);
  if (!at || at.s.winner != null) return;
  save(reconcile(startSlot(at.t, at.i, m.id), id => (id === m.id ? m : null)));
  data.sync();
}
// The winning dart undone, still on that match's screen: the result is taken back.
export function onMatchUndone(m) {
  const at = slotOf(m);
  if (!at || at.s.match !== m.id) return;
  const t = clearResult(at.t, at.i);
  if (t !== at.t) { save(t); data.sync(); }
}
// Quit: the match is to be played again.
export function onMatchQuit(m) {
  const at = slotOf(m);
  if (!at || at.s.winner != null || at.s.match !== m.id) return;
  save(dropMatch(at.t, at.i));
  data.sync();
}

// On opening a tournament: results of saved matches the bracket never heard of, then
// any bot against bot made ready, played out one at a time, saved as they go.
function catchUp(t) {
  let out = reconcile(t, matchById);
  if (out !== t) out = save(out);
  for (let i; !out.finished && (i = botSlots(out, isBotIn(out))[0]) != null;) {
    const s = out.data.slots[i], ids = [s.a, s.b], levels = ids.map(id => entrant(out, id).bot);
    const m = {
      ...simulateMatch(out, i, ids, levels),
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      playerIds: ids, bots: levels, seq: 1, board: data.wallBoard(),
    };
    data.saveMatch(m);
    out = save(reconcile(startSlot(out, i, m.id), id => (id === m.id ? m : null)));
  }
  if (out !== t) data.sync();
  return out;
}

// ---------- setting one up ----------
const newSetup = () => ({ name: suggestName(new Date()), ids: [], bots: [], start: 501, out: 'double', rounds: defaultRounds(0), draw: null });
const cleanTourName = name => String(name).trim().split(/\s+/).join(' ');
const count = st => st.ids.length + st.bots.length;
// Why Draw can't be pressed, or ''.
function notReady(st) {
  if (!cleanTourName(st.name)) return 'Give the tournament a name.';
  if (count(st) < MIN) return `A tournament needs ${MIN} or more players.`;
  if (count(st) > MAX) return `${MAX} players at most.`;
  return '';
}
// Round lengths start again when the number of players changes the number of rounds.
function fitRounds(st) {
  const want = defaultRounds(Math.max(count(st), 2));
  if (st.rounds.length !== want.length) st.rounds = want;
}
// Bot k's − or +: the next level down or up that no other bot has, or null.
function levelStep(levels, k, by) {
  for (let l = levels[k] + by; l >= 1 && l <= LEVELS.length; l += by) if (!levels.includes(l)) return l;
  return null;
}
// A bracket of `n` rounds, for naming rounds before there is one.
const shape = n => ({ data: { slots: { length: 2 ** n - 1 } } });
const sizeOf = n => 2 ** Math.max(1, Math.ceil(Math.log2(n)));

function setupHtml(st) {
  st.ids = st.ids.filter(id => players.some(p => p.id === id));
  fitRounds(st);
  const n = count(st), why = notReady(st), byes = n >= MIN && n <= MAX ? sizeOf(n) - n : 0;
  const full = st.bots.length >= LEVELS.length || n >= MAX;
  const chips = players.map(p => `<button class="chip ${st.ids.includes(p.id) ? 'on' : ''}" data-act="tour-pick" data-id="${p.id}">${esc(p.name)}</button>`)
    .concat(st.bots.map((level, k) => `<button class="chip on" data-act="tour-botdrop" data-i="${k}" title="Take this bot out">Bot ${level}</button>`))
    .concat(`<button class="chip ghost" data-act="tour-bot" ${full ? 'disabled' : ''}>+ Bot</button>`).join('');
  const stepTo = (k, d) => levelStep(st.bots, k, d);
  const botRows = st.bots.map((level, k) => `<div class="opt"><span>Bot level</span><div class="choices stepper">
      <button data-act="tour-botlevel" data-i="${k}" data-by="-1" aria-label="Easier" ${stepTo(k, -1) == null ? 'disabled' : ''}>−</button>
      <b>${level}</b><button data-act="tour-botlevel" data-i="${k}" data-by="1" aria-label="Harder" ${stepTo(k, 1) == null ? 'disabled' : ''}>+</button></div></div>`).join('');
  const choices = (key, list) => `<div class="choices">${list.map(([v, label]) =>
    `<button class="${st[key] === v ? 'on' : ''}" data-act="tour-opt" data-field="${key}" data-val="${v}">${label}</button>`).join('')}</div>`;
  const lo = legsOpt();
  const rounds = st.rounds.map((r, k) => `<div class="opt"><span>${roundName(shape(st.rounds.length), k)}</span><div class="choices stepper">
      <button data-act="tour-legs" data-i="${k}" data-by="-1" aria-label="Fewer" ${r.legs <= lo.min ? 'disabled' : ''}>−</button>
      <b>${r.legs}</b><button data-act="tour-legs" data-i="${k}" data-by="1" aria-label="More" ${r.legs >= lo.max ? 'disabled' : ''}>+</button></div></div>`).join('');
  return `<h1 class="sub">New tournament</h1>
    <div class="opt"><span>Name</span><input type="text" id="tour-name" maxlength="40" value="${esc(st.name)}"></div>
    <div class="opt"><span>Players</span><div class="row">${chips}</div></div>
    ${botRows}
    <p class="muted small">${n} player${n === 1 ? '' : 's'}${byes ? `: ${byes} bye${byes === 1 ? '' : 's'} in round 1` : ''}.
      Two bots drawn against each other play their match out by themselves. New players are added in Settings.</p>
    <h3 class="group">Game</h3>
    <div class="opt"><span>Start</span>${choices('start', x01().options.find(o => o.key === 'start').choices)}</div>
    <div class="opt"><span>Out</span>${choices('out', [['double', 'Double out'], ['straight', 'Straight out']])}</div>
    <h3 class="group">Matches: first to how many legs</h3>
    ${rounds}
    ${why ? `<p class="warn small">${esc(why)}</p>` : ''}
    <div class="row tour-buttons"><button class="${st.draw ? '' : 'primary'}" data-act="tour-draw" ${why ? 'disabled' : ''}>${st.draw ? 'Redraw' : 'Draw'}</button>
      ${st.draw && !why ? '<button class="primary" data-act="tour-start">Start</button>' : ''}</div>
    ${st.draw && !why ? bracketHtml(st.draw, null) : ''}`;
}

// Anything changed after the draw makes it out of date.
function changed() { tourView.setup.draw = null; renderTournament(); }
function draw() {
  const st = tourView.setup;
  if (notReady(st)) return renderTournament();
  const people = st.ids.map(id => ({ id, name: players.find(p => p.id === id).name }));
  const robots = st.bots.map(level => {
    const id = botPlayer(level);
    return { id, name: bots.find(b => b.id === id)?.name ?? `Bot ${level}`, bot: level };
  }).filter(e => e.id != null);
  st.draw = makeDraw({
    id: st.draw?.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: cleanTourName(st.name), entrants: [...people, ...robots],
    opts: { start: st.start, out: st.out }, rounds: st.rounds.map(r => ({ ...r })),
  });
  renderTournament();
}
function start() {
  const st = tourView.setup;
  if (!st?.draw || notReady(st)) return renderTournament();
  const t = { ...st.draw, name: cleanTourName(st.name), created: Date.now() };
  save(t);
  data.sync();
  tourView.id = t.id;
  tourView.setup = null;
  renderTournament();
}

// ---------- the bracket ----------
// (Drawn as a list for now: rounds in order, a line per match.)
function bracketHtml(t, next) {
  const rounds = t.data.rounds.map((r, k) => {
    const lines = t.data.slots.map((s, i) => [s, i]).filter(([s]) => s.round === k).map(([s, i]) => {
      const side = (id, n) => {
        if (id == null) return '<span class="muted">–</span>';
        const lost = s.winner != null && s.winner !== id;
        return `<span class="${lost ? 'muted' : s.winner === id ? 'won' : ''}">${esc(tourName(t, id))}${s.legs ? ` <b>${s.legs[n]}</b>` : ''}</span>`;
      };
      const tag = i === next ? 'next' : s.how === 'simulated' ? 'simulated' : '';
      if (s.how === 'bye') return `<li>${side(s.a === 'bye' ? s.b : s.a, 0)} <span class="muted">bye</span></li>`;
      return `<li>${tag ? `<small class="tag">${tag}</small> ` : ''}${side(s.a, 0)} v ${side(s.b, 1)}</li>`;
    }).join('');
    return `<h3 class="group">${roundName(t, k)} <span class="muted small">· first to ${r.legs}</span></h3><ol class="tlist">${lines}</ol>`;
  }).join('');
  return `<div class="tbracket">${rounds}</div>`;
}
const optsLine = t => `${t.data.opts.start} · ${t.data.opts.out === 'straight' ? 'straight' : 'double'} out`;

function goingHtml(t) {
  const next = t.finished || t.abandoned ? null : tourNext(t);
  const playing = next != null && match && compute(match).winner == null && match.opts?.tournament?.id === t.id
    && match.opts.tournament.slot === next;
  let buttons = '';
  if (t.finished) buttons = `<p class="tour-won">${esc(tourName(t, t.winner))} wins ${esc(t.name)}</p>
    <div class="row tour-buttons"><button class="primary" data-act="tour-new">New tournament</button></div>`;
  else if (t.abandoned) buttons = `<p class="muted">Abandoned.</p>
    <div class="row tour-buttons"><button class="primary" data-act="tour-new">New tournament</button></div>`;
  else if (tourView.abandoning) buttons = `<p>Abandon ${esc(t.name)}? The matches already played stay in the stats.</p>
    <div class="row tour-buttons"><button class="danger" data-act="tour-abandon-yes">Abandon tournament</button>
      <button class="primary" data-act="tour-abandon-no">Keep playing</button></div>`;
  else buttons = `<div class="row tour-buttons">
      ${next == null ? '' : playing ? `<button class="primary" data-act="resume">Back to ${esc(slotTitle(t, next))}</button>`
        : `<button class="primary" data-act="tour-play" data-i="${next}">Play ${esc(slotTitle(t, next))}</button>`}
      <span class="spacer"></span><button data-act="tour-abandon">Abandon tournament</button></div>`;
  return `<h1 class="sub">${esc(t.name)}</h1><p class="muted">${optsLine(t)}</p>${buttons}${bracketHtml(t, next)}`;
}

// ---------- the screen ----------
export function renderTournament() {
  if (account.locked) return renderLanding();
  setScreen('tournament');
  // A match that is over has been looked at for the last time: its result stands.
  if (match && compute(match).winner != null) { setMatch(null); store.set('match', null); }
  let t = tourView.id ? data.tournament(tourView.id) : currentTournament();
  if (t && !t.finished && !t.abandoned) t = catchUp(t);
  if (!t) tourView.setup ??= newSetup();
  tourView.id = t?.id ?? null;
  if (!t || t.finished || t.abandoned) tourView.abandoning = false;
  $app.innerHTML = `<div class="page tourpage">
    ${pageHead('home')}
    <div class="tour-body fill">${t ? goingHtml(t) : setupHtml(tourView.setup)}</div>
    ${pageFoot('home')}
  </div>`;
  refreshStatus();
  fit();
}
// The way in: tournament `id` (from one of its matches), or from the menu (no id) the
// tournament going, or setting up a new one.
export function openTournament(id = null) {
  tourView.id = id;
  tourView.abandoning = false;
  renderTournament();
}

// The screen's buttons (app.js passes on every data-act that starts "tour-").
export function tourAct(act, d) {
  const st = tourView.setup, t = tourView.id && data.tournament(tourView.id);
  switch (act) {
    case 'tour-pick': {
      const id = +d.id;
      st.ids = st.ids.includes(id) ? st.ids.filter(x => x !== id) : [...st.ids, id];
      return changed();
    }
    case 'tour-bot': {
      const level = freeLevel(st.bots.at(-1) ?? 5, st.bots);
      if (level != null && count(st) < MAX) st.bots = [...st.bots, level];
      return changed();
    }
    case 'tour-botdrop': st.bots = st.bots.filter((_, k) => k !== +d.i); return changed();
    case 'tour-botlevel': {
      const k = +d.i, level = levelStep(st.bots, k, +d.by);
      if (level != null) st.bots = st.bots.map((b, j) => (j === k ? level : b));
      return changed();
    }
    case 'tour-opt': st[d.field] = d.field === 'start' ? +d.val : d.val; return changed();
    case 'tour-legs': {
      const lo = legsOpt(), r = st.rounds[+d.i];
      r.legs = Math.min(lo.max, Math.max(lo.min, r.legs + +d.by));
      return changed();
    }
    case 'tour-draw': return draw();
    case 'tour-start': return start();
    case 'tour-play': {
      if (!t) return renderTournament();
      const i = +d.i, s = t.data.slots[i];
      if (i !== tourNext(t)) return renderTournament();  // (it changed under the button)
      return askFirst('start', {
        gameId: 'x01', ids: [s.a, s.b],
        opts: { start: t.data.opts.start, out: t.data.opts.out, legs: t.data.rounds[s.round].legs, sets: 1 },
        tournament: { id: t.id, slot: i },
      });
    }
    case 'tour-abandon': tourView.abandoning = true; return renderTournament();
    case 'tour-abandon-no': tourView.abandoning = false; return renderTournament();
    case 'tour-abandon-yes':
      if (t) { save({ ...t, abandoned: true }); data.sync(); }
      tourView.abandoning = false;
      return renderTournament();
    case 'tour-new': tourView.id = null; tourView.setup = newSetup(); return renderTournament();
  }
}

// The name, as it is typed: kept without drawing the screen again, unless that changes
// whether Draw can be pressed.
document.addEventListener('input', e => {
  if (e.target.id !== 'tour-name' || screen !== 'tournament' || !tourView.setup) return;
  const before = notReady(tourView.setup);
  tourView.setup.name = e.target.value;
  if (notReady(tourView.setup) !== before) redraw(renderTournament);
});
