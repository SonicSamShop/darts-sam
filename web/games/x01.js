// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

import { value, label } from '../board.js';
import { throwAt } from '../bot.js';

// Every dart worth throwing, best setup darts first.
const SETUP = [];
for (let n = 20; n >= 1; n--) SETUP.push({ seg: n, mult: 3 });
SETUP.push({ seg: 25, mult: 2 });
for (let n = 20; n >= 1; n--) SETUP.push({ seg: n, mult: 1 });
SETUP.push({ seg: 25, mult: 1 });
for (let n = 20; n >= 1; n--) SETUP.push({ seg: n, mult: 2 });
// Finishing doubles, the ones players like to leave first.
const DOUBLES = [20, 16, 18, 12, 8, 10, 14, 6, 4, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1]
  .map(seg => ({ seg, mult: 2 })).concat({ seg: 25, mult: 2 });

// The standard double-out chart: the route most published charts agree on for
// each score, with three darts in hand. Sources: dartbase.com out charts, the
// Berman "How the Pros Do It" table, Darts501 and William Hill charts.
// T = treble, D = double, 25 = outer bull, Bull = bullseye.
const THREE = chart(`
170:T20 T20 Bull;167:T20 T19 Bull;164:T20 T18 Bull;161:T20 T17 Bull;160:T20 T20 D20;158:T20 T20 D19;157:T20
T19 D20;156:T20 T20 D18;155:T20 T19 D19;154:T20 T18 D20;153:T20 T19 D18;152:T20 T20 D16;151:T20 T17
D20;150:T20 T18 D18;149:T20 T19 D16;148:T20 T20 D14;147:T20 T17 D18;146:T20 T18 D16;145:T20 T15 D20;144:T20
T20 D12;143:T20 T17 D16;142:T20 T14 D20;141:T20 T19 D12;140:T20 T20 D10;139:T19 T14 D20;138:T20 T18
D12;137:T20 T19 D10;136:T20 T20 D8;135:T20 T17 D12;134:T20 T14 D16;133:T20 T19 D8;132:T20 T16 D12;131:T20
T13 D16;130:T20 T20 D5;129:T19 T16 D12;128:T18 T14 D16;127:T20 T17 D8;126:T19 T19 D6;125:25 T20 D20;124:T20
T14 D11;123:T19 T16 D9;122:T18 T18 D7;121:T20 T11 D14;120:T20 20 D20;119:T19 T12 D13;118:T20 18 D20;117:T20
17 D20;116:T20 16 D20;115:T19 18 D20;114:T20 14 D20;113:T19 16 D20;112:T20 12 D20;111:T19 14 D20;110:T20 18
D16;109:T19 20 D16;108:T20 16 D16;107:T20 15 D16;106:T20 14 D16;105:T20 13 D16;104:T18 18 D16;103:T20 11
D16;102:T20 10 D16;101:T20 9 D16;100:T20 D20;99:T19 10 D16;98:T20 D19;97:T19 D20;96:T20 D18;95:T19
D19;94:T18 D20;93:T19 D18;92:T20 D16;91:T17 D20;90:T20 D15;89:T19 D16;88:T20 D14;87:T17 D18;86:T18
D16;85:T15 D20;84:T20 D12;83:T17 D16;82:Bull D16;81:T19 D12;80:T20 D10;79:T19 D11;78:T18 D12;77:T19
D10;76:T20 D8;75:T17 D12;74:T14 D16;73:T19 D8;72:T16 D12;71:T13 D16;70:T10 D20;69:T19 D6;68:T20 D4;67:T17
D8;66:T10 D18;65:25 D20;64:T16 D8;63:T13 D12;62:T10 D16;61:T15 D8;60:20 D20;59:19 D20;58:18 D20;57:17
D20;56:16 D20;55:15 D20;54:14 D20;53:13 D20;52:12 D20;51:11 D20;50:10 D20;49:9 D20;48:16 D16;47:7 D20;46:6
D20;45:13 D16;44:12 D16;43:3 D20;42:10 D16;41:9 D16;40:D20;39:7 D16;38:D19;37:5 D16;36:D18;35:3
D16;34:D17;33:1 D16;32:D16;31:15 D8;30:D15;29:13 D8;28:D14;27:11 D8;26:D13;25:9 D8;24:D12;23:7
D8;22:D11;21:5 D8;20:D10;19:3 D8;18:D9;17:1 D8;16:D8;15:7 D4;14:D7;13:5 D4;12:D6;11:3 D4;10:D5;9:1
D4;8:D4;7:3 D2;6:D3;5:1 D2;4:D2;3:1 D1;2:D1`);
// With only two darts in hand the best route sometimes changes (for example
// 101 becomes T17 Bull, and 61-70 go for the treble whose single leaves Bull).
// Only the scores that differ from the chart above are listed.
const TWO = chart(`
110:T20 Bull;107:T19 Bull;104:T18 Bull;101:T17 Bull;90:T18 D18;82:T14 D20;70:T20 D5;68:T18 D7;66:T16
D9;65:T15 D10;64:T14 D11;62:T12 D13;61:T11 D14`);

function chart(text) {
  const routes = {};
  for (const entry of text.split(';')) {
    const [score, route] = entry.split(':');
    routes[+score] = route.trim().split(/\s+/).map(t =>
      t === 'Bull' ? { seg: 25, mult: 2 }
        : t[0] === 'T' ? { seg: +t.slice(1), mult: 3 }
        : t[0] === 'D' ? { seg: +t.slice(1), mult: 2 }
        : { seg: +t, mult: 1 });
  }
  return routes;
}

// The route to show for `score` with `darts` left in this visit, or null if
// it can't be finished. Double out uses the standard chart; straight out (and
// anything the chart doesn't cover) is worked out by search.
export function checkout(score, darts, doubleOut) {
  if (doubleOut) {
    if (darts >= 3 && THREE[score]) return THREE[score];
    if (darts === 2 && TWO[score]) return TWO[score];
    if (darts === 2 && THREE[score]?.length <= 2) return THREE[score];
    if (darts === 1 && score === 50) return [{ seg: 25, mult: 2 }];
    if (darts === 1 && score <= 40 && score % 2 === 0) return [{ seg: score / 2, mult: 2 }];
  }
  return search(score, darts, doubleOut);
}

function search(score, darts, doubleOut) {
  const lasts = doubleOut ? DOUBLES : SETUP;
  for (let n = 1; n <= darts; n++) {
    for (const last of lasts) {
      const rest = score - value(last);
      if (rest < 0) continue;
      if (n === 1) { if (rest === 0) return [last]; continue; }
      for (const a of SETUP) {
        const r2 = rest - value(a);
        if (r2 < 0) continue;
        if (n === 2) { if (r2 === 0) return [a, last]; continue; }
        const b = SETUP.find(b => value(b) === r2);
        if (b) return [a, b, last];
      }
    }
  }
  return null;
}

// Matches saved before there were legs and sets have neither option: one leg.
const legsTo = s => s.opts.legs ?? 1, setsTo = s => s.opts.sets ?? 1;
const sum = list => list.reduce((t, n) => t + n, 0);

// Player p has just finished a leg. That may win a set, and the match. If the
// match goes on, everyone starts again and the engine is told who throws first.
function wonLeg(s, p) {
  s.legs[p]++;
  const set = s.legs[p] >= legsTo(s);
  if (set) s.sets[p]++;
  if (set && s.sets[p] >= setsTo(s)) { s.winner = p; return; }
  if (set) s.legs.fill(0);
  s.score.fill(s.opts.start);
  // The throw passes round with each leg, and with each set: the player who
  // threw first in one set throws second in the next, however many legs it took.
  s.newLeg = { starter: (sum(s.sets) + sum(s.legs)) % s.players.length, set };
}

export default {
  id: 'x01',
  kind: 'match',
  name: 'X01',
  blurb: 'Race from 501 (or 301 / 701) down to exactly zero. One leg, or first to a number of legs and sets.',
  options: [
    { key: 'start', label: 'Start', choices: [[301, '301'], [501, '501'], [701, '701']], default: 501, brief: v => `${v}`,
      help: v => `Everyone starts on ${v} and brings it down to exactly zero. The last dart has to be a double or the bull.` },
    // First to this many legs wins the set; first to this many sets wins the match.
    { key: 'legs', label: 'Legs to win', min: 1, max: 99, default: 1, brief: v => `${v} leg${v === 1 ? '' : 's'}`,
      help: (v, o) => `The first to win ${v === 1 ? 'a leg' : `${v} legs`} wins the ${o?.sets > 1 ? 'set' : 'match'}.${v > 1 ? ' Throwing first takes turns from one leg to the next.' : ''}` },
    { key: 'sets', label: 'Sets to win', min: 1, max: 99, default: 1, brief: v => v > 1 ? `${v} sets` : '',
      help: (v, o) => v > 1 ? `The first to win ${v} sets wins the match. A set goes to the first to win ${o?.legs > 1 ? `${o.legs} legs` : 'a leg'}.`
        : 'No sets: the match is decided on legs alone.' },
  ],

  init(n, opts) {
    return {
      score: Array(n).fill(opts.start),
      turnStartScore: opts.start,
      points: Array(n).fill(0),  // for averages, over the whole match
      thrown: Array(n).fill(0),
      legs: Array(n).fill(0),    // legs won in the set being played
      sets: Array(n).fill(0),    // sets won
    };
  },

  turnStart(s) { s.turnStartScore = s.score[s.current]; },

  dart(s, d) {
    const p = s.current, dbl = s.opts.out !== 'straight';
    const left = s.score[p] - value(d);
    s.thrown[p]++;
    if (left < 0 || (dbl && left === 1) || (left === 0 && dbl && d.mult !== 2)) {
      s.points[p] -= s.turnStartScore - s.score[p];
      s.thrown[p] += 3 - s.turn.length;  // a bust uses up the whole visit
      s.score[p] = s.turnStartScore;
      s.note = 'BUST';
      s.turnOver = true;
      return;
    }
    s.score[p] = left;
    s.points[p] += value(d);
    if (left === 0) wonLeg(s, p);
  },

  // A whole visit typed in as one number.
  visit(s, total, n) {
    const p = s.current, left = s.score[p] - total;
    if (left < 0 || (s.opts.out !== 'straight' && left === 1)) {
      s.thrown[p] += 3;
      s.note = 'BUST';
      return;
    }
    s.score[p] = left;
    s.points[p] += total;
    s.thrown[p] += n;
    if (left === 0) wonLeg(s, p);
  },

  // If `total` would finish the leg: how many darts that could have taken.
  visitDarts(s, total) {
    const n = s.score[s.current];
    if (total !== n) return null;
    return [1, 2, 3].filter(d => checkout(n, d, s.opts.out !== 'straight'));
  },

  summary(s, i) {
    const avg = s.thrown[i] ? (s.points[i] / s.thrown[i] * 3).toFixed(1) : '–';
    // A bust counts as a full visit of three darts, the same as in the average.
    const n = s.thrown[i];
    const tally = [setsTo(s) > 1 ? `sets ${s.sets[i]}` : '', legsTo(s) > 1 || setsTo(s) > 1 ? `legs ${s.legs[i]}` : '']
      .filter(Boolean).map(t => t + ' · ').join('');
    return { big: s.score[i], small: `${tally}${n} dart${n === 1 ? '' : 's'} · avg ${avg}` };
  },

  // The TV scoreboard (one line per player along the bottom, as on a broadcast):
  // its heading, and player i's figures for the match so far. A visit counts
  // once, as in the stats: 100 to 139 is a 100+, 140 to 179 a 140+. Busts score
  // nothing, and the visit being thrown isn't counted until it is over.
  tvTitle(s) {
    const solo = s.players.length === 1, of = n => solo ? `First to ${n}` : `Best of ${2 * n - 1}`;
    const length = setsTo(s) > 1 ? `${of(setsTo(s))} sets` : legsTo(s) > 1 ? of(legsTo(s)) : 'One leg';
    return `${s.opts.start} · ${length}`;
  },
  tv(s, i) {
    const done = s.winner != null ? s.throws : s.throws.slice(0, s.throws.length - s.turn.length);
    const visits = new Map();
    for (const t of done) {
      if (t.player === i && !t.bust) visits.set(t.round, (visits.get(t.round) ?? 0) + value(t));
    }
    const count = (min, max) => [...visits.values()].filter(v => v >= min && v <= max).length;
    return {
      score: s.score[i], legs: s.legs[i], sets: setsTo(s) > 1 ? s.sets[i] : null,
      t100: count(100, 139), t140: count(140, 179), t180: count(180, 180),
      average: s.thrown[i] ? (s.points[i] / s.thrown[i] * 3).toFixed(1) : '–',
    };
  },

  // What the current player has left, once they are on a possible finish
  // (170 or below). The app calls this out; null means say nothing.
  left(s) {
    const n = s.score[s.current];
    return n <= 170 ? n : null;
  },

  // The dart a computer player throws now (see bot.js). It follows the checkout
  // chart: on a finish it throws the route's first dart, with too few darts in
  // hand it sets up as the three-dart route would, and otherwise it scores on
  // treble 20. A dart that would win the leg is thrown with the skill's
  // `finish` spread, any other with its `spread`.
  bot(s, skill, random) {
    const n = s.score[s.current], dbl = s.opts.out !== 'straight';
    const route = n > 180 ? null : checkout(n, 3 - s.turn.length, dbl) ?? checkout(n, 3, dbl);
    const aim = route?.[0] ?? { seg: 20, mult: 3 };
    return throwAt(aim, route?.length === 1 ? skill.finish : skill.spread, random);
  },

  hint(s, { checkouts = true } = {}) {
    if (s.turnOver || !checkouts) return '';
    const route = checkout(s.score[s.current], 3 - s.turn.length, s.opts.out !== 'straight');
    return route ? 'Checkout: ' + route.map(label).join('  ') : '';
  },
};
