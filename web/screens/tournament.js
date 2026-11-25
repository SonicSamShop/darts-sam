// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The Tournament screen: setting one up (name, players and bots, the game, how
// long each round's matches are), then the bracket, with the next match to play
// on the board, and when its final is won the winner's screen. Under either, the
// tournaments that are over. The rules of the bracket are in ../tournament.js; this screen only
// decides what to show and when to save. A match of the bracket is an ordinary
// match carrying opts.tournament = {id, slot}: the game screen tells this one when
// it is won, undone or quit (onMatchWon, onMatchUndone, onMatchQuit).

import { compute, gameById } from '../engine.js';
import { LEVELS } from '../bot.js';
import {
  boardSlots, botSlots, clearResult, defaultRounds, dropMatch, freeLevel, makeDraw, nextSlot, playedMatch, reconcile,
  remapIds, roundName, seenResults, simulateMatch, startSlot, suggestName
} from '../tournament.js';
import { animate, drawBracket, showSlot, sizeBracket } from './bracket.js';
import { renderLanding } from './landing.js';
import { askFirst } from './start.js';
import {
  $app, account, bots, botPlayer, data, esc, fit, mark, match, pageFoot, pageHead, players, redraw, refreshStatus,
  say, screen, setMatch, setScreen, store
} from '../app.js';

// What the screen shows. id: the tournament on screen (null: the one going, or a new one to set up).
// setup: the new tournament being set up, kept while the app is open:
//   {name, ids: people's ids, bots: [level], start, out, rounds: [{legs}], draw: the drawn record or null}.
// abandoning: "Abandon tournament" has been pressed once and is asking.
// past: the one on screen is over and was opened from the list of past tournaments: Back is the way out.
// wait: Start, or a match's start, has just been put off because new players are still being saved: the
//   players it was for (see waitNote). null otherwise.
export const tourView = { id: null, setup: null, abandoning: false, past: false, wait: null };

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
// Every match that can be played on the board now, in bracket order: the main button
// plays the first, and a tap on any of them in the bracket plays that one instead.
export const tourPlayable = t => (t.finished || t.abandoned ? [] : boardSlots(t, isBotIn(t)));
// The slot of t whose match is being played on this device, if one is and the bracket
// still waits for it (not one decided since on another screen, or of a tournament abandoned).
function slotInPlay(t) {
  const at = match && compute(match).winner == null ? match.opts?.tournament : null;
  return at?.id === t.id && tourPlayable(t).includes(at.slot) ? at.slot : null;
}
// The match the bracket marks, the main button is for and the menu names: the one being played
// here, or else the next to play. null when there is none (and for a tournament over or abandoned).
export const tourMarked = t => slotInPlay(t) ?? tourPlayable(t)[0] ?? null;
// Whether a match asked for a while ago (start.js: "Who throws first?" and the bull are
// screens to sit on) is still the bracket's to play: its place still ready, for the same
// two. `play` is what tour-play asked for.
export function playStands(play) {
  const { id, slot } = play.tournament, t = data.tournament(id), s = t?.data.slots[slot];
  return !!s && tourPlayable(t).includes(slot) && [s.a, s.b].every(x => play.ids.includes(x));
}
// What a tap on a match of t's bracket does, by slot, as bracket.js makes buttons of
// them ({label, ...data- attributes for the app's click handling}): a ready match is
// played, and one that was played or simulated opens its scorecard, as a game in the
// stats does. A bye, bot against bot, and a match still waiting for a player have none.
// One match at a time on the board: while one is being played here it is the only ready
// one that is a button, the way back to it, so that a tap can't start another in its
// place. From the tournament's own record, so one that is over or abandoned still opens
// its matches.
export function tourTaps(t) {
  const taps = {}, playing = slotInPlay(t);
  if (playing != null) taps[playing] = { label: `Back to ${slotTitle(t, playing)}`, act: 'resume' };
  else for (const i of tourPlayable(t)) taps[i] = { label: `Play ${slotTitle(t, i)}`, act: 'tour-play', i };
  t.data.slots.forEach((s, i) => {
    const id = playedMatch(t, i);
    if (id != null) taps[i] = { label: `${tourName(t, s.a)} ${s.legs?.[0] ?? 0}, ${tourName(t, s.b)} ${s.legs?.[1] ?? 0}: see the scorecard`, sheet: id };
  });
  return taps;
}

// A saved match by id: the one in progress, or one still waiting here to be sent.
const matchById = id => (match?.id === id ? match : store.get('pending', {})[id]?.m ?? null);
const save = t => { data.saveTournament(t); return data.tournament(t.id); };

// A player made on this device (a new bot, a new person) is given a number by the Pi in the first sync
// after. From that moment the saved lists, and any tournament they are in, go by the new number, but
// the app's own lists go by the old one until that sync is over (app.js, synced). In between, neither
// Start nor a match's start can be trusted with them, and both are put off (start, below; start.js).
// The player of that number, if it is caught in that moment (known to one list and not the other), or null.
function beingNumbered(id) {
  const saved = store.get('players', []).find(p => p.id === id), here = players.find(p => p.id === id) ?? bots.find(p => p.id === id);
  return !saved === !here ? null : saved ?? here;
}
// What the screen's status line says while something is put off for that (tourView.wait), or ''. It is
// worked out again each time the screen is drawn, so it goes when the sync is over: the button is then pressed again.
function waitNote() {
  const who = (tourView.wait ?? []).map(beingNumbered).filter(Boolean);
  if (!who.length) return '';
  return `One moment: saving the new ${who.every(p => p.bot) ? 'bots' : 'players'}.`;
}
// A match of the bracket that start.js was asked for and would not start (the bracket has moved on, or its
// players are being numbered): back to the bracket, which says so when it is the second.
export function playBounced(play) {
  openTournament(play.tournament.id, false, play.ids);
}

// ---------- the game screen tells us ----------
// Each finds the match's tournament and slot, and does nothing if the tournament has
// gone, is over, or has moved on from that slot (changed on another screen, say).
// A finished tournament still hears from its final's own match: its winning dart
// can be undone, and the final won again.
function slotOf(m) {
  const at = m?.opts?.tournament, t = at && data.tournament(at.id);
  if (!t || t.abandoned) return null;
  const s = t.data.slots[at.slot];
  if (!s || ![s.a, s.b].every(id => m.playerIds?.includes(id))) return null;
  if (t.finished && s.match !== m.id) return null;
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

// On opening a tournament: results of saved matches the bracket never heard of.
// (Bot against bot is played out on the bracket, where it can be watched: playOut.)
function catchUp(t) {
  const out = reconcile(t, matchById);
  if (out === t) return t;
  const saved = save(out);
  data.sync();
  return saved;
}
// The matches of t for the bracket to play out by itself: bot against bot, ready, in bracket order.
const tourBotSlots = t => (t.finished || t.abandoned ? [] : botSlots(t, isBotIn(t)));
// Slot i, bot against bot, played out and saved like any match. t: the tournament as it
// is saved at this moment (see playOut).
function simulateSlot(t, i) {
  const s = t.data.slots[i], ids = [s.a, s.b], levels = ids.map(id => entrant(t, id).bot);
  const m = {
    ...simulateMatch(t, i, ids, levels),
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    playerIds: ids, bots: levels, seq: 1, board: data.wallBoard(),
  };
  data.saveMatch(m);
  save(reconcile(startSlot(t, i, m.id), id => (id === m.id ? m : null)));
  data.sync();
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

// The draw with the numbers its players go by now: a bot made at Draw may since have
// been numbered by the Pi (it is found again by its level). null if one of its people
// or bots has gone since (removed on another screen, say): the draw is out of date.
function currentDraw(d) {
  if (!d) return null;
  let out = d;
  for (const e of d.data.entrants) {
    const id = e.bot != null ? bots.find(b => b.bot === e.bot)?.id : players.find(p => p.id === e.id)?.id;
    if (id == null) return null;
    if (id !== e.id) out = remapIds(out, e.id, id);
  }
  return out;
}
// People who have gone since they were picked are dropped, and the draw with them.
function freshen(st) {
  st.ids = st.ids.filter(id => players.some(p => p.id === id));
  st.draw = currentDraw(st.draw);
}
// After a sync, players made offline go by the Pi's numbers (app.js passes [[old, new]]). The app's own lists
// have just caught up with them, so whatever was put off for that can go ahead: the screen stops saying
// "One moment" (waitNote). It is drawn again here, since the app does not do it for a bot's number alone.
export function tourRemapped(remapped) {
  const st = tourView.setup;
  for (const [old, id] of st ? remapped : []) {
    st.ids = st.ids.map(x => (x === old ? id : x));
    if (st.draw) st.draw = remapIds(st.draw, old, id);
  }
  if (tourView.wait && screen === 'tournament' && !waitNote()) redraw(renderTournament);
}

function setupHtml(st) {
  freshen(st);
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
    <p class="muted small">${n} player${n === 1 ? '' : 's'}${byes ? `: ${byes} bye${byes === 1 ? '' : 's'} in the first round` : ''}.
      Two bots drawn against each other play their match out by themselves. New players are added in Settings.</p>
    <h3 class="group">Game</h3>
    <div class="opt"><span>Start</span>${choices('start', x01().options.find(o => o.key === 'start').choices)}</div>
    <div class="opt"><span>Out</span>${choices('out', [['double', 'Double out'], ['straight', 'Straight out']])}</div>
    <h3 class="group">Matches: first to how many legs</h3>
    ${rounds}
    ${why ? `<p class="warn small">${esc(why)}</p>` : ''}
    ${st.draw && !why ? bracketHtml() : ''}
    <div class="row tour-buttons"><button class="${st.draw ? '' : 'primary'}" data-act="tour-draw" ${why ? 'disabled' : ''}>${st.draw ? 'Redraw' : 'Draw'}</button>
      ${st.draw && !why ? '<button class="primary" data-act="tour-start">Start</button>' : ''}${statusHtml()}</div>`;
}

// Anything changed after the draw makes it out of date.
function changed() { tourView.setup.draw = null; tourView.wait = null; renderTournament(); }
function draw() {
  const st = tourView.setup;
  tourView.wait = null;
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
  shown.reveal = true;  // the draw is under the form: it and Start are brought into view
  renderTournament();
}
function start() {
  const st = tourView.setup;
  if (st) freshen(st);
  if (!st?.draw || notReady(st)) return renderTournament();
  // Someone in the draw the Pi numbered a moment ago, in a sync still running: the saved
  // lists go by the new number, this screen by the old one until the sync is over (app.js,
  // synced; tourRemapped). Started now, the old number would be saved, which nobody has any
  // more. Not yet: the screen says so (waitNote), and Start is there to press again.
  const saved = store.get('players', []);
  if (!st.draw.data.entrants.every(e => saved.some(p => p.id === e.id))) {
    tourView.wait = st.draw.data.entrants.map(e => e.id);
    return renderTournament();
  }
  tourView.wait = null;
  const t = { ...st.draw, name: cleanTourName(st.name), created: Date.now() };
  save(t);
  setSeen(t.id, []);
  data.sync();
  tourView.id = t.id;
  tourView.setup = null;
  renderTournament();
}

// ---------- the bracket ----------
// Drawn by bracket.js into this, once the screen is up (mountBracket).
const bracketHtml = () => '<div class="bracket"><svg role="group" aria-label="The tournament draw"></svg></div>';
// The screen's status line: what the bracket is doing by itself ("Simulating Bot 5 v Bot 9…", playOut), or
// why a button did nothing just now (waitNote). Empty, it takes no room.
const statusHtml = () => `<span class="tour-status" aria-live="polite">${esc(waitNote())}</span>`;

// Results already shown moving on, on this device: {[tournament id]: [slot index]}.
const seenOf = id => store.get('tourSeen', {})[id];
function setSeen(id, slots) {
  const all = store.get('tourSeen', {}), kept = {};
  for (const t of data.tournaments()) if (all[t.id]) kept[t.id] = all[t.id];
  store.set('tourSeen', { ...kept, [id]: slots });
}
// Results still to be shown moving on, in bracket order (seenResults has the rules). A
// tournament first opened on this device has none, however far it has got: only what is
// decided after that is shown. (The device it is started on begins with an empty list.)
function unseen(t) {
  if (t.abandoned) return [];
  const was = seenOf(t.id), now = seenResults(t, was);
  if (now.seen.length !== was?.length) setSeen(t.id, now.seen);  // (a result taken back is to be shown again)
  return now.unseen;
}

// The final's place in the bracket, and whether its result has been shown moving into the
// Winner's box on this device: only then is the winner's screen up (goingHtml, playOut).
const finalOf = t => t.data.slots.length - 1;
const finalSeen = t => !seenResults(t, seenOf(t.id)).unseen.includes(finalOf(t));

const wait = (ms, skip) => new Promise(done => {
  const end = Date.now() + ms, tick = () => (skip() || Date.now() >= end ? done() : setTimeout(tick, 50));
  tick();
});
// The bracket on screen. drawn: which drawing is the latest. watch: what resizes it.
// run: results being shown moving on (playOut), null with the bracket at rest;
// its skip is set by a tap on the bracket, to go straight to the end. quiet: until when
// (ms) the bracket takes no tap on a match, after a run that was skipped.
const bracketView = { drawn: 0, watch: null, run: null, quiet: 0 };
const QUIET = 400;  // ms: a tap that skips is often the first of two
// The match of t to have in sight where the bracket is wider than its box (a phone): the
// one marked, or once it is won the final, with the Winner's box beside it. `next`: the one marked.
const inSight = (t, next) => next ?? (t.finished ? finalOf(t) : null);
// Tournament t's bracket as it stands, nothing moving: the match to play marked, and
// (unless taps is false) its matches there to be tapped. Gives back the slot to have in sight.
function drawAtRest(svg, t, taps = true) {
  const next = tourMarked(t);
  drawBracket(svg, t, { next, playing: slotInPlay(t) != null, taps: taps ? tourTaps(t) : {}, nameOf: id => tourName(t, id) });
  return inSight(t, next);
}
// The bracket on the screen just drawn: the draw being set up, or tournament t, with
// its results not yet seen here moving on one by one (playOut).
function mountBracket(t) {
  const view = bracketView;
  view.watch?.disconnect();
  view.watch = view.run = null;
  const me = ++view.drawn, box = $app.querySelector('.bracket'), svg = box?.querySelector('svg');
  if (!svg) return;
  const fill = box.closest('.going') != null, nameOf = id => tourName(t, id);
  const live = () => me === view.drawn && svg.isConnected;
  const hidden = fill ? unseen(t) : [];
  const next = fill ? tourMarked(t) : null;
  drawBracket(svg, t, { hide: new Set(hidden), next: hidden.length ? null : next, playing: fill && slotInPlay(t) != null, nameOf });
  sizeBracket(box, svg, { fill });
  showSlot(box, svg, t, hidden[0] ?? (fill ? inSight(t, next) : null));
  view.watch = new ResizeObserver(() => sizeBracket(box, svg, { fill }));
  view.watch.observe(box);
  // A long name is cut to fit as it measures, and until the theme's lettering has arrived
  // that is in a stand-in face: drawn again once it has, unless a result is moving on
  // (which is drawn again when it gets there anyway). As it is by then, not as it was (t).
  if (document.fonts?.status === 'loading') {
    document.fonts.ready.then(() => {
      if (!live() || view.run) return;
      const now = fill ? data.tournament(t.id) : tourView.setup?.draw;
      if (!now) return;
      if (fill) drawAtRest(svg, now); else drawBracket(svg, now, { nameOf: id => tourName(now, id) });
    });
  }
  if (fill) playOut(t.id, box, svg, live);
}
// Shows each result not yet seen moving on, in bracket order; plays out any bot
// against bot ("Simulating Bot 5 v Bot 9…", then its result moves on); then draws
// the bracket as it stands. When one of those results is the final's, the winner's
// screen comes up after it, and score calling says who won: once, here, since the
// device has then seen it (a redraw, a reload or another day finds nothing left to show).
// Until then a tap anywhere on the bracket skips to the end
// (the box's own data-act, tour-skip) and does nothing else: its matches are not drawn
// as buttons until it is at rest, nor for a moment after a tap that skipped (QUIET), so
// that the second tap of two does not land on a match. Stops if the screen is drawn
// again (live() false).
// The tournament is read again after every wait, and never used from before one: it
// can change while this waits. The sync that Start sets going gives its new bots the
// Pi's numbers while "Simulating…" is up (sync.js, remap), and a copy from before that,
// saved back with a result, would put back numbers that no player has any more.
async function playOut(id, box, svg, live) {
  const view = bracketView, run = view.run = { skip: false }, skip = () => run.skip;
  const now = () => (live() ? data.tournament(id) : null);
  let simulated = false, won = false, t;
  box.dataset.act = 'tour-skip';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const status = $app.querySelector('.tour-status');
  for (;;) {
    t = now();
    if (!t) return;
    const nameOf = x => tourName(t, x), hidden = unseen(t);
    if (hidden.length) {
      drawBracket(svg, t, { hide: new Set(hidden), next: null, nameOf });
      showSlot(box, svg, t, hidden[0]);
      await animate(svg, t, hidden[0], { nameOf, reduced, skip });
      if (!live()) return;
      setSeen(id, [...(seenOf(id) ?? []), hidden[0]]);
      won ||= hidden[0] === finalOf(t);
      continue;
    }
    const bb = tourBotSlots(t)[0];
    if (bb == null) break;
    status.textContent = `Simulating ${slotTitle(t, bb)}…`;
    await wait(reduced ? 0 : 700, skip);
    t = now();
    if (!t) return;
    status.textContent = waitNote();
    // (only if it is still theirs to play: not decided meanwhile, on another screen say)
    if (tourBotSlots(t).includes(bb)) { simulateSlot(t, bb); simulated = true; }
  }
  if (run.skip) view.quiet = Date.now() + QUIET;
  if (won && t.finished) say(`${tourName(t, t.winner)} wins ${t.name}`);
  // what the bots decided can change the next match, and so the buttons; and the final,
  // now shown, brings up the winner's screen
  if (simulated || won) return renderTournament();
  if (view.quiet > Date.now()) {
    showSlot(box, svg, t, drawAtRest(svg, t, false));
    await wait(view.quiet - Date.now(), () => false);
    t = now();
    if (!t) return;
  }
  view.run = null;
  delete box.dataset.act;
  showSlot(box, svg, t, drawAtRest(svg, t));
}
const optsLine = t => `${t.data.opts.start} · ${t.data.opts.out === 'straight' ? 'straight' : 'double'} out`;

// The winner's screen is the finished tournament's own, headed with who won it: their name,
// "wins Christmas 2026", and the final's score (its two players in the bracket's order).
function winnerHtml(t) {
  const s = t.data.slots[finalOf(t)], name = id => esc(tourName(t, id));
  return `<h1 class="tour-champ">${name(t.winner)}</h1><p class="tour-wins">wins ${esc(t.name)}</p>
    ${s.legs ? `<p class="muted tour-final">Final: ${name(s.a)} ${s.legs[0]} – ${s.legs[1]} ${name(s.b)}</p>` : ''}`;
}

// listed: the list of past tournaments is under this one's screen.
function goingHtml(t, listed) {
  // The main button: back to the match being played here, whichever it is, or else the next one to play.
  const playing = slotInPlay(t) != null, next = tourMarked(t);
  // Under one that is over, the way on. Opened from the list of past ones, that is Back. Otherwise
  // a new one (or, come back to through the history while another is going, that one).
  const going = currentTournament();
  const away = `<div class="row tour-buttons">${tourView.past ? '<button class="primary" data-act="up">Back</button>'
    : going ? `<button class="primary" data-act="tour-current">Back to ${esc(going.name)}</button>`
    : '<button class="primary" data-act="tour-new">New tournament</button>'}<button data-act="home">Menu</button></div>`;
  // Its name and its game on one line; while there is something to say (statusHtml) that is said in the game's place.
  let head = `<h1 class="sub">${esc(t.name)}</h1><p class="tour-meta"><span class="muted tour-opts">${optsLine(t)}</span>${statusHtml()}</p>`;
  let buttons = '', won = false;
  // Won, but the final's result is still to be shown moving on: who won is not said before it has (playOut).
  if (t.finished && !finalSeen(t)) buttons = '';
  else if (t.finished) { head = `${winnerHtml(t)}${statusHtml()}`; buttons = away; won = true; }
  else if (t.abandoned) buttons = `<p class="muted">Abandoned.</p>${away}`;
  else if (tourView.abandoning) buttons = `<p>Abandon ${esc(t.name)}? The matches already played stay in the stats.</p>
    <div class="row tour-buttons"><button class="danger" data-act="tour-abandon-yes">Abandon tournament</button>
      <button class="primary" data-act="tour-abandon-no">Keep playing</button></div>`;
  else buttons = `<div class="row tour-buttons">
      ${next == null ? '' : playing ? `<button class="primary" data-act="resume">Back to ${esc(slotTitle(t, next))}</button>`
        : `<button class="primary" data-act="tour-play" data-i="${next}">Play ${esc(slotTitle(t, next))}</button>`}
      <span class="spacer"></span><button data-act="tour-abandon">Abandon tournament</button></div>`;
  // The heading, then what can be pressed, then the bracket: on a wide screen the first two are one line over
  // the bracket, which has the rest of the screen; on a phone the buttons go under it (style.css, .tour-bar).
  // On that line too, where it is one, the way to the list of past ones: a phone shows the list's heading at
  // the foot of the screen instead, and a wide screen gives those lines to the bracket.
  const toPast = listed ? '<button class="link tour-pastlink" data-act="tour-past">Past tournaments</button>' : '';
  return `<div class="tour-bar"><div class="tour-head ${won ? 'won' : ''}">${head}</div>${toPast}<div class="tour-foot">${buttons}</div></div>
    ${bracketHtml()}`;
}

// ---------- past tournaments ----------
// The day one was played, as the stats write a day: "24 Dec 26".
const dayOf = ts => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' });
// Under the screen, the tournaments that are over, newest first, a line each: its name, the
// day, and who won it or "abandoned". A line opens that tournament's bracket. `on`: the one
// on screen, which is not in its own list. Nothing at all when there are none.
function pastHtml(on) {
  const past = data.tournaments().filter(t => (t.finished || t.abandoned) && t.id !== on?.id);
  if (!past.length) return '';
  return `<h3 class="group tour-pasthead">Past tournaments</h3><div class="tour-past">${past.map(t => {
    const day = dayOf(t.finished || t.created), winner = t.finished ? tourName(t, t.winner) : null;
    return `<button class="tourline" data-act="tour-open" data-id="${esc(t.id)}" aria-label="${esc(`${t.name}, ${day}, ${winner ? `won by ${winner}` : 'abandoned'}: see the bracket`)}">
      <b>${esc(t.name)}</b><span class="nb">${day}</span><span>${winner ? esc(winner) : 'abandoned'}</span></button>`;
  }).join('')}</div>`;
}

// ---------- the screen ----------
// What the screen was last drawn for ('setup', or a tournament's id), to know whether it is being drawn again
// or is another screen now. reveal: a draw has just been made, and is to be brought into view.
const shown = { key: null, reveal: false };
export function renderTournament() {
  if (account.locked) return renderLanding();
  setScreen('tournament');
  // A match that is over has been looked at for the last time: its result stands.
  if (match && compute(match).winner != null) { setMatch(null); store.set('match', null); }
  let t = tourView.id ? data.tournament(tourView.id) : currentTournament();
  if (t && !t.finished && !t.abandoned) t = catchUp(t);
  if (!t) tourView.setup ??= newSetup();
  tourView.id = t?.id ?? null;
  const over = !!t && (!!t.finished || !!t.abandoned);
  if (!t || over) tourView.abandoning = false;
  tourView.past &&= over;
  // One opened from the list is looked up, not watched: whatever of it was never shown moving on
  // here is not shown now, and its win is not called.
  if (tourView.past && seenResults(t, seenOf(t.id)).unseen.length) setSeen(t.id, seenResults(t).seen);
  // The list of past ones is under the screen it is opened from, not under one opened from it. Under
  // a bracket (which fills the screen) only its heading shows until the screen is scrolled (.peek).
  const past = tourView.past ? '' : pastHtml(t);
  if (tourView.wait && !waitNote()) tourView.wait = null;  // (whatever was waiting to be saved has been)
  // A tap, or a sync, draws the screen again: it stays where it was scrolled to (down the form, or at the
  // list of past ones), as the menu does. Another tournament, or the form after one, starts at its top.
  const key = t ? t.id : 'setup', was = shown.key === key ? $app.querySelector('.tour-body')?.scrollTop ?? 0 : 0;
  shown.key = key;
  $app.innerHTML = `<div class="page tourpage ${t ? 'wide' : ''}">
    ${pageHead('home')}
    <div class="tour-body fill ${t ? 'going' : ''}">${t ? `<div class="tour-main ${past ? 'peek' : ''}">${goingHtml(t, !!past)}</div>` : setupHtml(tourView.setup)}${past}</div>
    ${pageFoot('home')}
  </div>`;
  mountBracket(t ?? tourView.setup.draw);
  refreshStatus();
  fit();
  // (once everything has its size: the bracket is part of what scrolls, and on a phone the line saying how the
  // board is linked, which refreshStatus writes under the app's name, takes its height from the screen's)
  const body = $app.querySelector('.tour-body');
  if (body && was) body.scrollTop = was;
  // A draw just made is under the form, with Redraw and Start under it: scrolled to, so far as it has to be.
  if (shown.reveal && !t) $app.querySelector('.tour-buttons')?.scrollIntoView?.({ block: 'nearest' });
  shown.reveal = false;
}
// The way in: tournament `id` (from one of its matches), or from the menu (no id) the
// tournament going, or setting up a new one. past: `id` is one that is over, opened
// from the list of past tournaments (or come back to, having been). wait: the players of
// a match that was not started just now, for the screen to say why if it knows (playBounced).
export function openTournament(id = null, past = false, wait = null) {
  tourView.id = id;
  tourView.past = past && id != null;
  tourView.abandoning = false;
  tourView.wait = wait;
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
    case 'tour-start': start(); return mark();  // (the screen's place in the history is this tournament's now)
    // The main button, for the next match, or a tap on any ready match of the bracket.
    case 'tour-play': {
      if (!t) return renderTournament();
      const i = +d.i, s = t.data.slots[i];
      // (it changed under the button: no longer ready, or a match of the bracket is being played here, which this would replace)
      if (!tourPlayable(t).includes(i) || slotInPlay(t) != null) return renderTournament();
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
    case 'tour-new': tourView.id = null; tourView.past = false; tourView.wait = null; tourView.setup = newSetup(); renderTournament(); return mark();
    // From one that is over, come back to while another is going: to the one going.
    case 'tour-current': openTournament(); return mark();
    // A line of "Past tournaments": that tournament's bracket, a step on from this screen, which Back
    // comes back to. (One that has gone since the list was drawn: the screen as it now is.)
    case 'tour-open':
      if (!data.tournament(d.id)) return renderTournament();
      openTournament(d.id, true);
      return mark(true);
    // "Past tournaments", over a bracket: down to their list, which is under it.
    case 'tour-past':
      return $app.querySelector('.tour-pasthead')?.scrollIntoView?.({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    // A tap on the bracket while results are moving on it.
    case 'tour-skip': if (bracketView.run) bracketView.run.skip = true; return;
  }
}

// A match of the bracket that is a button (bracket.js) is pressed from the keyboard as
// any button is, by Enter, or by Space as it comes up: it becomes a tap, for the app's
// own click handling.
const pressed = e => (screen === 'tournament' && (e.key === 'Enter' || e.key === ' ') ? e.target.closest?.('.bracket [role=button]') : null);
const tap = b => b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
document.addEventListener('keydown', e => {
  const b = pressed(e);
  if (!b) return;
  e.preventDefault();  // (Space would scroll the bracket instead)
  if (e.key === 'Enter' && !e.repeat) tap(b);
});
document.addEventListener('keyup', e => {
  const b = e.key === ' ' && pressed(e);
  if (b) tap(b);
});

// The name, as it is typed: kept without drawing the screen again, unless that changes
// whether Draw can be pressed.
document.addEventListener('input', e => {
  if (e.target.id !== 'tour-name' || screen !== 'tournament' || !tourView.setup) return;
  const before = notReady(tourView.setup);
  tourView.setup.name = e.target.value;
  if (notReady(tourView.setup) !== before) redraw(renderTournament);
});
