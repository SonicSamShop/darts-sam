// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// 99 Darts. Pick a number and how many darts to throw at it (99 is the
// classic). Every dart in that number is a hit, whatever its ring, and the
// singles, doubles and trebles are counted apart. Most hits wins; with the
// same number of hits, more trebles, then more doubles.

const bed = n => (n === 25 ? 'the bull' : `the ${n}`);
const darts = s => s.opts.darts ?? 99;  // the app always sends the options; a bare {} gets the default
const target = s => s.opts.seg ?? 20;
const pct = (n, of) => (of ? Math.round(n / of * 100) : 0);
const esc = t => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function finish(s) {
  const key = i => s.hits[i] * 1e6 + s.by[i][3] * 1e3 + s.by[i][2];
  let w = 0;
  for (let i = 1; i < s.players.length; i++) if (key(i) > key(w)) w = i;
  s.winner = w;
}

export default {
  id: 'd99',
  kind: 'training',
  name: '99 Darts',
  blurb: 'Pick a number and throw a set number of darts at it. Every dart in it is a hit; singles, doubles and trebles are counted apart.',
  showTotal: false,  // the three-dart sum means nothing here
  options: [
    { key: 'seg', label: 'Number', choices: [...Array(20)].map((_, i) => [i + 1, String(i + 1)]).concat([[25, 'Bull']]), default: 20,
      brief: v => `On ${v === 25 ? 'the bull' : v}`,
      help: v => `Every dart is thrown at ${bed(v)}. A dart anywhere in it is a hit${v === 25 ? ' (the outer bull is the single, the bull the double)' : ''}.` },
    { key: 'darts', label: 'Darts each', choices: [[33, '33'], [66, '66'], [99, '99']], default: 99, brief: v => `${v} darts`,
      help: v => `Everyone throws ${v} darts, which is ${v / 3} visits.` },
  ],

  // by[i]: player i's darts by ring, [misses, singles, doubles, trebles]
  init(n) { return { hits: Array(n).fill(0), thrown: Array(n).fill(0), by: [...Array(n)].map(() => [0, 0, 0, 0]) }; },

  dart(s, d) {
    const p = s.current;
    s.thrown[p]++;
    if (d.mult > 0 && d.seg === target(s)) { s.hits[p]++; s.by[p][d.mult]++; } else s.by[p][0]++;
    if (p === s.players.length - 1 && s.thrown[p] >= darts(s)) finish(s);
  },

  summary(s, i) {
    const [, one, two, three] = s.by[i], n = s.thrown[i];
    const rings = target(s) === 25 ? `25 ${one} · Bull ${two}` : `S ${one} · D ${two} · T ${three}`;
    return { big: s.hits[i], small: `${rings} · ${n} of ${darts(s)} thrown${n ? ` · ${pct(s.hits[i], n)}%` : ''}` };
  },

  // The rings, as a small table: how many of each, and of all darts thrown.
  panel(s) {
    const rows = s.players.map((p, i) => {
      const n = s.thrown[i], [, one, two, three] = s.by[i];
      const cell = k => `<td>${k} <span class="dim">${pct(k, n)}%</span></td>`;
      return `<tr><th>${s.players.length > 1 ? esc(p) : 'Hits'}</th>${cell(one)}${cell(two)}${target(s) === 25 ? '' : cell(three)}${cell(s.hits[i])}</tr>`;
    }).join('');
    return `<table class="d99"><thead><tr><th></th><th>${target(s) === 25 ? '25' : 'Singles'}</th><th>${target(s) === 25 ? 'Bull' : 'Doubles'}</th>${
      target(s) === 25 ? '' : '<th>Trebles</th>'}<th>All</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  result(s) {
    const w = s.winner, n = s.thrown[w];
    const line = `${s.hits[w]} of ${n} in ${bed(target(s))} (${pct(s.hits[w], n)}%)`;
    return s.players.length > 1 ? `${s.players[w]} wins with ${line}.` : `You hit ${line}.`;
  },

  target(s) { return s.winner != null ? null : { seg: target(s), mult: 1 }; },

  aim(s) { return s.winner == null ? (target(s) === 25 ? 'bull' : String(target(s))) : ''; },

  hint(s) {
    if (s.turnOver || s.winner != null) return '';
    const left = darts(s) - s.thrown[s.current];
    return `${left} dart${left === 1 ? '' : 's'} left at ${bed(target(s))}`;
  },
};
