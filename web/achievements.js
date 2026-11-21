// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Achievements: what a player has done at the board, named in darts' own
// words (Maximum, Big fish, Madhouse).
//
// None is stored. Each is worked out from the player's games, the way the deep
// stats are (stats.js), so games from before achievements existed count, Undo
// takes one back, and an achievement and the stats page can never disagree.
//
//   tally(sheet, me)   what one player did in one game, as counts. A sheet is
//                      a game in the shape of a history entry (_history() in
//                      server/db.py; matchSheet() in sync.js makes the same
//                      from a game on this device).
//   add(a, b)          counts add up: a player's total is the sum over their games
//   ACHIEVEMENTS       each one is a line drawn on a count
//   held(total)        the ones a total has reached
//
// In a game the app asks, after each dart, what is held now that wasn't before
// the dart (earnedBy). Plain data in, plain data out: nothing here touches the
// page, the store or the network.
import { visitsOf, x01Legs } from './stats.js';
import { compute } from './engine.js';
import { GAMES } from './games/index.js';
import { LEVELS } from './bot.js';

const TOP_BOT = LEVELS.at(-1).level;
const ADDS_UP = new Set(['countup', 'gotcha']);  // besides X01: games where a visit's total is its score
const ENDS = new Set(['clock', 'bobs27', 'bermuda', 'killer', 'c121', 'rcheckout']);  // read from the engine's end state

const dayOf = ts => { const d = new Date(ts); return `day:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const all3 = (v, f) => v.darts?.length === 3 && v.darts.every(f);
const isBull = d => d.seg === 25 && d.mult === 2;
const sameBed = v => all3(v, d => d.mult >= 2 && d.seg === v.darts[0].seg && d.mult === v.darts[0].mult);
const shanghai = v => all3(v, d => d.seg === v.darts[0].seg && d.seg !== 25) && [1, 2, 3].every(m => v.darts.some(d => d.mult === m));
const breakfast = v => v.darts?.length === 3 && [20, 5, 1].every(n => v.darts.some(d => d.seg === n && d.mult === 1));

// A sheet's visits turned back into the engine's log, and the state the engine
// ends in: how a game's own facts (lives left, rounds halved) are read without
// writing its rules a second time.
export function logOf(sheet) {
  return visitsOf(sheet).flatMap(v => v.darts
    ? v.darts.map(d => ({ t: 'dart', seg: d.mult ? d.seg : 0, mult: d.mult }))
    : [{ t: 'visit', total: v.total, darts: v.n }]);
}
export const endOf = sheet => compute({ gameId: sheet.game, players: sheet.players, opts: sheet.opts, log: logOf(sheet) });

// What player `me` (an index into the sheet's players) did in one game: a flat
// {key: count}. `open` is where in the sheet's visits the one still being
// thrown is, if any: a visit's total is judged when the visit is over, so that
// a 180 is not called a Ton after its second dart.
export function tally(sheet, me, open = -1) {
  const t = {}, count = (key, n = 1) => { if (n) t[key] = (t[key] ?? 0) + n; };
  const mine = visitsOf(sheet).filter(v => v.p === me), good = mine.filter(v => !v.bust);
  const finished = sheet.winner != null, won = finished && sheet.winner === me && sheet.players.length > 1;

  count('darts', mine.reduce((n, v) => n + (v.darts ? v.n : 0), 0));
  for (const v of mine) t[dayOf(v.ts)] = 1;
  count('bull', good.reduce((n, v) => n + (v.darts ?? []).filter(isBull).length, 0));
  count('hat', good.filter(v => all3(v, isBull)).length);
  count('bed', good.filter(sameBed).length);
  count('shanghai', good.filter(shanghai).length);
  count('breakfast', good.filter(breakfast).length);

  // What a visit scored: in X01 what counted (stats.js), elsewhere its total.
  let scores = [];
  if (sheet.game === 'x01') {
    const legs = x01Legs({ ...sheet, me }), own = legs.flatMap(l => l.mine);
    scores = own.filter(v => !v.bust && v.i !== open).map(v => v.score);
    const outs = own.filter(v => v.checkout && sheet.opts.out !== 'straight'), last = v => v.darts?.at(-1);
    count('out', outs.length);
    count('out100', outs.filter(v => v.score >= 100).length);
    count('out170', outs.filter(v => v.score === 170).length);
    count('outBull', outs.filter(v => last(v) && isBull(last(v))).length);
    count('outD1', outs.filter(v => last(v)?.seg === 1 && last(v).mult === 2).length);
    for (const n of [18, 15, 12, 9]) count('in' + n, legs.filter(l => l.won && l.start === 501 && l.darts <= n).length);
    const done = legs.filter(l => l.finished);
    count('whitewash', +(won && done.length >= 3 && done.every(l => l.won)));
  } else if (ADDS_UP.has(sheet.game)) {
    scores = good.filter(v => v.i !== open).map(v => v.total);
  }
  count('t100', scores.filter(n => n >= 100).length);
  count('t140', scores.filter(n => n >= 140).length);
  count('t180', scores.filter(n => n === 180).length);

  if (sheet.game === 'cricket') count('nine', good.filter(v => all3(v, d => d.mult === 3 && d.seg >= 15 && d.seg <= 20)).length);
  if (ENDS.has(sheet.game)) {
    const s = endOf(sheet), over = s.winner != null;
    if (sheet.game === 'clock') count('clock30', +(s.winner === me && s.thrown[me] <= 30));
    if (sheet.game === 'bobs27') { count('bobUp', +(over && s.score[me] > 0)); count('bobProfit', +(over && s.score[me] > 27)); }
    if (sheet.game === 'bermuda') count('unhalved', +(over && s.halved[me] === 0));
    if (sheet.game === 'killer') { count('killer', +(s.winner === me)); count('untouched', +(s.winner === me && s.lives[me] === (sheet.opts.lives ?? 5))); }
    if (sheet.game === 'c121') count('c121', s.results[me].filter(r => r.ok && r.target >= 121).length);
    if (sheet.game === 'rcheckout') count('rcAll', +(over && s.tried[me] > 0 && s.made[me] === s.tried[me]));
  }

  if (finished) { count('games'); count('g:' + sheet.game); }
  count('wins', +won);
  const rivals = (sheet.bots ?? []).filter((b, i) => i !== me && b != null);
  count('botWins', +(won && rivals.length > 0));
  count('topWins', +(won && rivals.includes(TOP_BOT)));
  return t;
}

export function add(a, b) {
  const t = { ...a };
  for (const k of Object.keys(b)) t[k] = k.startsWith('day:') ? 1 : (t[k] ?? 0) + b[k];
  return t;
}

const days = t => Object.keys(t).filter(k => k.startsWith('day:')).length;
const every = t => GAMES.filter(g => t['g:' + g.id]).length;
// A game's mark: a number in its name whole, otherwise initials ("ATC"), or the start of a lone word ("Kil").
function initials(name) {
  const words = name.split(/\s+/), m = words.map(w => /\d/.test(w) ? w.replace(/\D*$/, '') : w[0].toUpperCase()).join('');
  return m.length > 1 ? m.slice(0, 4) : name.slice(0, 3);
}
const short = n => n >= 1000 ? `${n / 1000}k` : String(n);

// [group, id, mark, name, how, what is counted, {steps, names, secret, game, family: [name, rank]}]
// steps: earned again at each number. A family is shown by its greatest member
// when several are earned by one dart (a first 180 is Maximum, not also Ton).
const LIST = [
  ...GAMES.map(g => ['First games', 'first:' + g.id, initials(g.name), `First game of ${g.name}`, `Finish a game of ${g.name}`, 'g:' + g.id, { game: g.id }]),
  ['First games', 'round', String(GAMES.length), 'Been round the board', 'Finish a game of every one', every, { need: GAMES.length }],

  ['Scoring', 'ton', '100', 'Ton', '100 or more in a visit', 't100', { family: ['ton', 1] }],
  ['Scoring', 'ton40', '140', 'Ton forty', '140 or more in a visit', 't140', { family: ['ton', 2] }],
  ['Scoring', 'max', '180', 'Maximum', '180 in a visit', 't180', { steps: [1, 10, 50, 100], family: ['ton', 3] }],
  ['Scoring', 'bull', '50', 'Bullseye', 'Hit the bull', 'bull', { family: ['bull', 1] }],
  ['Scoring', 'hat', '3B', 'Hat trick', 'Three bulls in a visit', 'hat', { family: ['bull', 2] }],
  ['Scoring', 'bed', '3×', 'Three in a bed', 'Three darts in the same double or treble', 'bed'],
  ['Scoring', 'shanghai', 'SDT', 'Shanghai', 'Single, double and treble of one number in a visit', 'shanghai'],
  ['Scoring', 'breakfast', '26', 'Bed and breakfast', '20, 5 and 1 in a visit', 'breakfast', { secret: true }],

  ['Finishing', 'out', 'D', 'Game shot', 'Check out a leg of X01 on a double', 'out', { game: 'x01', family: ['out', 1] }],
  ['Finishing', 'out100', '100+', 'Ton-plus finish', 'Check out 100 or more', 'out100', { game: 'x01', steps: [1, 10, 50], family: ['out', 2] }],
  ['Finishing', 'out170', '170', 'Big fish', 'Check out 170', 'out170', { game: 'x01', family: ['out', 3] }],
  ['Finishing', 'outBull', 'DB', 'Bull finish', 'Check out on the bull', 'outBull', { game: 'x01' }],
  ['Finishing', 'outD1', 'D1', 'Madhouse', 'Check out on double 1', 'outD1', { game: 'x01', secret: true }],
  ['Finishing', 'in18', '18', '18-darter', 'Win a 501 leg in 18 darts or fewer', 'in18', { game: 'x01', family: ['leg', 1] }],
  ['Finishing', 'in15', '15', '15-darter', 'Win a 501 leg in 15 darts or fewer', 'in15', { game: 'x01', family: ['leg', 2] }],
  ['Finishing', 'in12', '12', '12-darter', 'Win a 501 leg in 12 darts or fewer', 'in12', { game: 'x01', family: ['leg', 3] }],
  ['Finishing', 'in9', '9', 'Nine-darter', 'Win a 501 leg in 9 darts', 'in9', { game: 'x01', family: ['leg', 4] }],

  ['Matches', 'wins', 'W', 'Wins', 'Win a game against someone', 'wins', { steps: [1, 10, 50, 100], names: { 1: 'First win' } }],
  ['Matches', 'bot', 'PC', 'Beat the computer', 'Win against a computer player', 'botWins', { family: ['bot', 1] }],
  ['Matches', 'topbot', String(TOP_BOT), 'Beat the best', `Win against the computer at level ${TOP_BOT}`, 'topWins', { family: ['bot', 2] }],
  ['Matches', 'whitewash', '0', 'Whitewash', 'Win an X01 match of three or more legs without losing one', 'whitewash', { game: 'x01' }],

  ['Other games', 'nine', '9M', 'Nine marks', 'Cricket: three trebles on scoring numbers in a visit', 'nine', { game: 'cricket' }],
  ['Other games', 'clock30', 'ATC', 'Clockwork', 'Around the Clock: finish in 30 darts or fewer', 'clock30', { game: 'clock' }],
  ['Other games', 'bobUp', '27', 'Still standing', "Bob's 27: finish above zero", 'bobUp', { game: 'bobs27', family: ['bob', 1] }],
  ['Other games', 'bobProfit', '27+', 'In profit', "Bob's 27: finish above the 27 you started on", 'bobProfit', { game: 'bobs27', family: ['bob', 2] }],
  ['Other games', 'unhalved', '½', 'Never halved', 'Bermuda: finish without being halved', 'unhalved', { game: 'bermuda' }],
  ['Other games', 'killer', 'K', 'Last one standing', 'Killer: win', 'killer', { game: 'killer', family: ['killer', 1] }],
  ['Other games', 'untouched', 'K♥', 'Untouched', 'Killer: win without losing a life', 'untouched', { game: 'killer', family: ['killer', 2] }],
  ['Other games', 'c121', '121', 'One-two-one', '121 Checkout: check out 121 or more', 'c121', { game: 'c121' }],
  ['Other games', 'rcAll', 'RC', 'Clean sheet', 'Random Checkout: check out every target in a game', 'rcAll', { game: 'rcheckout' }],

  ['Long service', 'darts', '', 'darts thrown', 'Darts on record, one at a time', 'darts', { steps: [1000, 10000, 50000, 100000] }],
  ['Long service', 'played', '', 'games finished', 'Finished games', 'games', { steps: [10, 50, 100, 500] }],
  ['Long service', 'days', '', 'days at the board', 'Different days with a dart thrown. Not days in a row.', days, { steps: [7, 30, 100] }],
];

// One entry per thing that can be held, so a stepped one gives an entry per step:
//   id ('max', 'max:10'), base (what its steps share), group, mark, name, how,
//   need, value(total) (the count the need is of), steps (all of its steps, or
//   null), secret, game (the one game it belongs to, if any), family
export const ACHIEVEMENTS = LIST.flatMap(([group, base, mark, name, how, key, more = {}]) => {
  const value = typeof key === 'function' ? key : t => t[key] ?? 0, steps = more.steps ?? null;
  return (steps ?? [more.need ?? 1]).map(need => ({
    group, base, id: steps && need !== steps[0] ? `${base}:${need}` : base, need, value, how, steps,
    mark: mark || short(need),
    name: more.names?.[need] ?? (!mark ? `${need.toLocaleString('en-GB')} ${name}` : steps && need > 1 ? `${name} ×${need}` : name),
    secret: !!more.secret, game: more.game ?? null, family: more.family ?? null,
  }));
});
export const byId = id => ACHIEVEMENTS.find(a => a.id === id);
export const GROUPS = [...new Set(ACHIEVEMENTS.map(a => a.group))];

export const held = total => new Set(total ? ACHIEVEMENTS.filter(a => a.value(total) >= a.need).map(a => a.id) : []);
// What is in `after` and not in `before`, greatest of each family only.
export function newly(before, after) {
  const fresh = ACHIEVEMENTS.filter(a => after.has(a.id) && !before.has(a.id));
  return fresh.filter(a => !a.family || !fresh.some(b => b.family?.[0] === a.family[0] && b.family[1] > a.family[1]));
}
// The one to show first of several earned together: the greatest of a family, else the first.
export const chief = list => list.reduce((m, a) => (a.family?.[1] ?? 0) > (m.family?.[1] ?? 0) ? a : m);

// A player's games, oldest first, as [{sheet, me, open?}], added up.
export const totalOf = entries => entries.reduce((t, e) => add(t, tally(e.sheet, e.me, e.open ?? -1)), {});

// Every achievement those games earn, in the order earned:
// Map id -> {at (ms), match (the game's id), me}. The game is the first one after which it is held.
export function timeline(entries) {
  const got = new Map();
  let total = {};
  for (const e of entries) {
    total = add(total, tally(e.sheet, e.me, e.open ?? -1));
    for (const id of held(total)) if (!got.has(id)) {
      const s = e.sheet;
      got.set(id, { at: s.finished ?? s.visits.at(-1)?.[2] ?? s.started, match: s.id, me: e.me });
    }
  }
  return { got, total };
}

// Where in a game an achievement was earned: the index of the visit after
// which it is first held, given the player's total before the game. null: not in this game.
export function visitOf(a, base, sheet, me) {
  for (let n = 1; n <= sheet.visits.length; n++) {
    const part = n === sheet.visits.length ? sheet : { ...sheet, visits: sheet.visits.slice(0, n), winner: null, finished: null };
    if (a.value(add(base, tally(part, me))) >= a.need) return n - 1;
  }
  return null;
}

// A player's total as a match starts: the history kept on this device (their
// stats reply's "matches"; each entry says which player they are, `me`), plus
// games waiting to be sent that the history hasn't got yet ([{sheet, me}]).
// The game in progress (`live`, its id) is left out: it is added dart by dart.
// null when there is no history to go on, so that no "first" is shown that
// they may already hold.
export function standing(history, waiting = [], live = null) {
  if (!history) return null;
  const newer = new Map(waiting.filter(w => w.sheet.id !== live).map(w => [w.sheet.id, w]));
  const kept = history.filter(m => m.id !== live && !newer.has(m.id)).map(m => ({ sheet: m, me: m.me }));
  return totalOf([...kept, ...newer.values()]);
}

// What one dart earned player `me`: the live game before and after it, each
// with where its unfinished visit is (-1: none).
export function earnedBy(base, before, openBefore, after, openAfter, me) {
  if (!base) return [];
  return newly(held(add(base, tally(before, me, openBefore))), held(add(base, tally(after, me, openAfter))));
}
