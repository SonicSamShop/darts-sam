// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The Stats screen: one player's stats, a tab at a time, any figure opened up to
// what it was counted from, and one game's scoresheet.

import { GAMES } from '../games/index.js';
import { clock, gameById, timeSpent } from '../engine.js';
import { buildBoard, label } from '../board.js';
import { ENOUGH, X01_TILES, boardsSideBySide, dartTable, headToHead, matchSummary, setsSideBySide, statsCsv, visitsOf, visitsWith, x01Brackets, x01Legs, x01Stats, x01Tile, x01Trend } from '../stats.js';
import { boardName } from '../boards.js';
import { renderLanding } from './landing.js';
import { achTab, achievementView, achievementsPane } from './achievements.js';
import {
  $app, Machine, account, boards, connected, dartsName, data, esc, grams, loadStats, mark, nameOf, pageFoot, pageHead, machine,
  players, refreshStatus, screen, setScreen, setsOf, shelf, statsPath
} from '../app.js';

// ---------- stats ----------
// One player at a time, one tab at a time. Each game type has its own page of
// stats, next to one for all games together. Any figure with a › can be tapped
// to see what it was counted from (see "opening up the stats" below).
// A big screen has room for the stats and the board side by side (see .panes in style.css).
const BIG = matchMedia('(min-width: 1100px) and (min-height: 750px)');
const STAT_TABS = [['stats', 'Stats'], ['games', 'Games'], ['board', 'Board'], ['achievements', 'Achievements']];
export const statsView = {
  player: null,
  game: null,  // a game id, or null for all games together
  darts: null,  // one of the player's sets of darts, or null for all of them
  board: null,  // one of the boards, or null for all of them
  tab: 'stats',
  drill: [],
};
export let statsData = null;
let statsFailed = false;
// (The list of players, to add to, rename and remove from, and their darts, is a tab of the settings: see playersPanel().)
// Each game's own figures, in the order shown: [label, field in the server's reply, unit].
// (X01's are worked out here instead, from the history the server sends: see stats.js.)
const GAME_TILES = {
  cricket: [['Marks per round', 'mpr'], ['Best round (marks)', 'best_round'], ['Rounds of 5+ marks', 'big_rounds'],
    ['Marks scored', 'marks']],
  clock: [['Hit rate', 'hit_rate', '%'], ['Average darts to finish', 'avg_finish'], ['Fewest darts to finish', 'best_finish'],
    ['Best run of hits', 'best_run']],
  countup: [['3-dart average', 'average'], ['Highest visit', 'highest'], ['Visits of 100+', 't100'],
    ['Average game total', 'avg_total'], ['Best game total', 'best_total']],
  bobs27: [['Average score', 'avg_score'], ['Best score', 'best_score'], ['Doubles hit', 'double_rate', '%'],
    ['Games above zero', 'above_zero']],
  shanghai: [['Average total', 'avg_total'], ['Best total', 'best_total'], ['Shanghais', 'shanghais'],
    ['Hit rate on the number', 'hit_rate', '%']],
  bermuda: [['Average total', 'avg_total'], ['Best total', 'best_total'], ['Rounds halved per game', 'avg_halved'],
    ['Hit rate', 'hit_rate', '%']],
  segment: [['Hit rate', 'hit_rate', '%'], ['Points per dart', 'points_per_dart'], ['Best session', 'best_points']],
  gotcha: [['Games won', 'won'], ['3-dart average', 'average']],
  rcheckout: [['Checkout rate', 'rate', '%'], ['Checkouts hit', 'made'], ['Average darts per checkout', 'avg_darts']],
  c121: [['Checkout rate', 'rate', '%'], ['Checkouts hit', 'made'], ['Highest checkout', 'highest'],
    ['Average darts per checkout', 'avg_darts']],
};
export function exportStatsCsv() {
  if (!statsData) return;
  const matches = deep(statsData).matches;
  if (!matches.length) return;
  const csv = statsCsv(matches);
  const slug = s => String(s || 'all').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stats';
  const name = `darts-sam-${slug(statsData.player?.name)}-${slug(statsView.game ?? 'all')}.csv`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function renderPlayers(id = statsView.player) {
  if (account.locked) return renderLanding();
  setScreen('players');
  statsView.player = players.some(p => p.id === id) ? id : players[0]?.id ?? null;
  achTab.all = null;  // (asked for again if the Achievements tab needs it)
  // The stats the side-by-side tables need besides these (see alsoStats): asked for again, but
  // starting from the stats that were showing.
  also.clear();
  if (statsData) also.set(statsPath(statsData.player.id, statsData.game, statsData.set, statsData.board), statsData);
  if (!setsOf(statsView.player, true).some(d => d.id === statsView.darts)) statsView.darts = null;
  if (!boards.some(b => b.id === statsView.board)) statsView.board = null;
  if (statsData?.player.id !== statsView.player || statsData.game !== statsView.game || (statsData.set ?? null) !== statsView.darts
    || (statsData.board ?? null) !== statsView.board) statsData = null;
  statsFailed = false;
  drawPlayers();
  if (statsView.player == null) return;
  const wanted = statsView.player, game = statsView.game, set = statsView.darts, board = statsView.board;
  let data = null;
  // A player made offline has no stats on the server yet. With no link to the server, don't wait long for it.
  if (wanted > 0) try {
    data = await loadStats(statsPath(wanted, game, set, board), connected ? 10000 : 2500);
  } catch { /* shown as unavailable */ }
  if (screen !== 'players' || statsView.player !== wanted || statsView.game !== game || statsView.darts !== set || statsView.board !== board) return;
  statsData = data;
  statsFailed = !data;
  drawPlayers();
  if (data) mark();  // a scoresheet's address can be told now (and never before the caller's own mark)
}
export const pct = (n, of) => of ? (n / of * 100).toFixed(1) + '%' : '–';
// A tile with somewhere to go (`to`, a level of `drill`) can be tapped.
export const opens = to => to ? ` data-drill="${esc(JSON.stringify(to))}"` : '';
const tile = (label, value, to) =>
  `<div class="tile ${to ? 'tap' : ''}"${opens(to)}><b>${value ?? '–'}</b><span>${label}</span></div>`;
const gameTiles = (id, d, to) => (GAME_TILES[id] ?? []).map(([name, key, unit = '']) =>
  tile(name, d[key] == null ? null : d[key] + unit, to)).join('');
// The X01 tiles: all of them under their headings, or just the ones named.
const X01_HEADLINES = ['average', 'first9', 'checkout', 'bestCheckout', 't180', 't140', 'won', 'bestLeg'];
// Visual X01 dashboard cards: 3-dart average trend line + score bracket bars.
function x01ChartsHtml(x) {
  if (!x) return '';
  const trend = x01Trend(x, 20);
  const brackets = x01Brackets(x);
  let trendCard = '';
  if (trend) {
    const W = 320, H = 104, padX = 10, padY = 12;
    const lo = Math.max(0, Math.floor((trend.min - 5) / 5) * 5);
    const hi = Math.max(lo + 10, Math.ceil((trend.max + 5) / 5) * 5);
    const px = i => padX + (i / (trend.legs.length - 1)) * (W - padX * 2);
    const py = v => H - padY - ((v - lo) / (hi - lo)) * (H - padY * 2);
    const pts = trend.legs.map((l, i) => [px(i), py(l.avg), l]);
    const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${pts[0][0].toFixed(1)},${H - padY} ${line} ${pts.at(-1)[0].toFixed(1)},${H - padY}`;
    const refY = py(trend.overall).toFixed(1);
    const sign = trend.delta >= 0.05 ? '+' : '';
    const dCls = trend.delta >= 0.5 ? 'up' : trend.delta <= -0.5 ? 'down' : '';
    trendCard = `<div class="chart-card">
      <div class="chart-head"><span>3-dart average · last ${trend.legs.length} legs</span>
        <b class="chart-delta ${dCls}">${sign}${trend.delta.toFixed(1)}</b></div>
      <svg class="trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="3-dart average trend">
        <line class="trend-ref" x1="${padX}" y1="${refY}" x2="${W - padX}" y2="${refY}"/>
        <polygon class="trend-area" points="${area}"/>
        <polyline class="trend-line" points="${line}"/>
        ${pts.map(([cx, cy, l]) => `<circle class="trend-dot ${l.won ? 'won' : ''}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2"><title>Leg ${l.n}: ${l.avg.toFixed(1)} (${l.darts} darts)</title></circle>`).join('')}
      </svg>
      <div class="chart-foot"><span>Low ${trend.min.toFixed(1)}</span><span>Avg ${trend.overall.toFixed(1)}</span><span>High ${trend.max.toFixed(1)}</span></div>
    </div>`;
  }
  const barsCard = brackets.length ? `<div class="chart-card">
    <div class="chart-head"><span>Visit scoring breakdown</span><span class="muted small">${x.visits.filter(v => !v.bust).length} visits</span></div>
    <div class="bars">${brackets.map(b => {
      const to = b.key && b.count ? { v: 'tile', key: b.key } : null;
      return `<div class="barrow ${to ? 'tap' : ''}"${opens(to)}>
        <span class="barlbl">${b.label}</span>
        <span class="bartrack"><i class="barfill ${b.tone}" style="width:${b.count ? Math.max(4, b.width).toFixed(1) : 0}%"></i></span>
        <span class="barval"><b>${b.count}</b> <small>${b.pct.toFixed(0)}%</small></span>
      </div>`;
    }).join('')}</div>
  </div>` : '';
  return trendCard || barsCard ? `<div class="charts">${trendCard}${barsCard}</div>` : '';
}

function h2hHtml(matches) {
  const rows = headToHead(matches);
  if (!rows.length) return '';
  return `<h2>Head-to-head</h2><div class="h2h">${rows.slice(0, 6).map(r => {
    const avg = r.myAvg != null ? `<span>Avg <b>${r.myAvg.toFixed(1)}</b> vs ${r.oppAvg != null ? r.oppAvg.toFixed(1) : '–'}</span>` : '';
    const co = r.bestCheckout ? `<span>Best out <b>${r.bestCheckout}</b></span>` : '';
    return `<div class="h2h-row">
      <div class="h2h-top"><b>vs ${esc(r.opponent)}</b><span class="h2h-rec"><b class="w">${r.won}</b>–<b class="l">${r.lost}</b></span></div>
      <div class="h2h-bar"><i style="width:${r.winPct.toFixed(1)}%"></i></div>
      <div class="h2h-meta"><span>${r.played} ${r.played === 1 ? 'match' : 'matches'} · ${r.winPct.toFixed(0)}% won</span>${avg}${co}</div>
    </div>`;
  }).join('')}</div>`;
}

function x01Tiles(s, only) {
  const draw = t => {
    const rows = t.rows(s);
    const note = t.note?.(s).trim();  // "(20 of 41 darts)": kept in one piece, so a narrow line breaks before it
    return tile(t.label + (note ? ` <span class="nb">${note}</span>` : ''), t.value ? t.value(s, rows) : rows.length,
      rows.length ? { v: 'tile', key: t.key, ...t.sort } : null);
  };
  if (only) return only.map(key => draw(x01Tile(key))).join('');
  return X01_TILES.map(g => `<h2>X01 ${g.group}</h2><div class="tiles">${g.tiles.map(draw).join('')}</div>`).join('');
}

// ---------- opening up the stats ----------
// Tapping a figure shows what it was counted from, and tapping a line of that
// goes further: 140+ -> every visit of 140 or more and when it was thrown ->
// the scoresheet of the leg it was thrown in. `statsView.drill` is how far
// down the screen is: one entry per level, the last one being what is shown.
//   {v: 'tile', key}       an X01 tile's visits, legs or doubles
//   {v: 'double', aim}     the visits with a dart at one double
//   {v: 'numbers'}         how often each number was hit
//   {v: 'number', seg}     the visits with a dart in one number
//   {v: 'matches', name}   the finished games of one game type
//   {v: 'match', id, at}   one game's scoresheet (at: the visit to point out)
// A list's entry also holds how it is sorted: {by: a column, desc}.
const DEEP = new WeakMap();  // what is worked out from a reply of the server's, kept while that reply is
export function deep(st) {
  if (!DEEP.has(st)) {
    const matches = st.matches ?? [];  // stats saved by an older version have no history
    DEEP.set(st, { matches, x01: x01Stats(matches), mine: matches.flatMap(m => visitsOf(m).filter(v => v.p === m.me)) });
  }
  return DEEP.get(st);
}
// When something happened: "19 Nov 26, 00:44". Where there is no room for it on one line (a list on a
// phone) it breaks after the day, never in the middle of it.
const when = ts => {
  const d = new Date(ts), nb = t => `<span class="nb">${t}</span>`;
  return `${nb(d.toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' }))}, ${
    nb(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}`;
};
const num = n => n == null ? '–' : n.toFixed(1);
const dartsText = v => v.darts ? v.darts.map(label).join(' ') : '<span class="muted">typed</span>';
const others = m => m.players.filter((_, i) => i !== m.me).map(esc).join(', ');
const against = m => m.players.length > 1 ? `v ${others(m)}` : 'solo';
const scoredText = (v, n) => v.bust ? '<span class="warn">Bust</span>' : `<b>${n}</b>`;
const toMatch = v => ({ v: 'match', id: v.m.id, at: v.i });
const myDarts = m => visitsOf(m).reduce((n, v) => n + (v.p === m.me ? v.n : 0), 0);
// What each kind of list shows: [column, heading, cell, value to sort by (if it can be), class].
// Columns marked 'wide' are left out on a narrow screen.
const LISTS = {
  visits: { open: toMatch, cols: [
    ['when', 'When', v => when(v.ts), v => v.ts],
    ['score', 'Scored', v => scoredText(v, v.score), v => v.score],
    ['darts', 'Darts', dartsText],
    ['left', 'Left', v => `${v.before} → ${v.after}`, v => v.before],
    ['leg', 'Leg', v => `${v.m.opts.start ?? 501} ${against(v.m)}`, null, 'wide'],
  ] },
  legs: { open: l => ({ v: 'match', id: l.m.id, leg: l.n }), cols: [
    ['when', 'When', l => when(l.when), l => l.when],
    ['game', 'Game', l => `${l.start} ${l.dbl ? 'double' : 'straight'} out${l.of > 1 ? ` · leg ${l.n} of ${l.of}` : ''}`, null, 'wide'],
    ['vs', 'Against', l => l.solo ? 'Solo' : others(l.m)],
    ['result', 'Result', l => !l.finished ? '<span class="muted">Not finished</span>' : l.won ? '<b>Won</b>' : 'Lost'],
    ['darts', 'Darts', l => l.darts, l => l.darts],
    ['avg', 'Average', l => num(l.avg), l => l.avg ?? -1],
    ['first9', 'First 9', l => num(l.first9), l => l.first9 ?? -1, 'wide'],
    ['checkout', 'Checkout', l => l.checkout ?? '–', l => l.checkout ?? -1],
  ] },
  doubles: { sort: 'darts', open: d => ({ v: 'double', aim: d.aim }), cols: [
    ['aim', 'Double', d => label({ seg: d.aim, mult: 2 }), d => d.aim],
    ['hit', 'Hit', d => d.hit, d => d.hit],
    ['darts', 'Darts at it', d => d.darts, d => d.darts],
    ['rate', 'Rate', d => pct(d.hit, d.darts), d => d.hit / d.darts],
  ] },
  numbers: { sort: 'n', open: r => ({ v: 'number', seg: r.seg }), cols: [
    ['seg', 'Number', r => r.seg === 25 ? 'Bull and 25' : r.seg || 'Miss', r => r.seg],
    ['s', 'Singles', r => r.seg ? r.by[1] : '–', r => r.by[1]],
    ['d', 'Doubles', r => r.seg ? r.by[2] : '–', r => r.by[2]],
    ['t', 'Trebles', r => r.seg && r.seg !== 25 ? r.by[3] : '–', r => r.by[3]],
    ['n', 'All darts', r => r.n, r => r.n],
    ['share', 'Share', r => (r.share * 100).toFixed(1) + '%', r => r.n],
  ] },
  throws: { open: toMatch, cols: [
    ['when', 'When', v => when(v.ts), v => v.ts],
    ['darts', 'Darts', dartsText],
    ['total', 'Scored', v => scoredText(v, v.total), v => v.total],
    ['game', 'Game', v => `${esc(v.m.name)} ${against(v.m)}`],
  ] },
  matches: { open: m => ({ v: 'match', id: m.id }), cols: [
    ['when', 'When', m => when(m.finished ?? m.started), m => m.finished ?? m.started],
    ['players', 'Players', m => m.players.map(esc).join(', ')],
    ['winner', 'Winner', m => m.players.length > 1 ? `<b>${esc(m.players[m.winner])}</b>` : '–'],
    ['darts', 'Your darts', myDarts, myDarts],
    ['time', 'Time', m => m.duration != null ? clock(m.duration) : '–', m => m.duration ?? -1],
  ] },
};
const MOST = 500;  // lines shown of a list
function listHtml(kind, rows, top) {
  const { cols, open, sort = 'when' } = LISTS[kind];
  const by = cols.find(c => c[0] === top.by && c[3]) ? top.by : sort, desc = top.desc ?? true;
  const order = id => { const f = cols.find(c => c[0] === id)[3]; return (a, b) => f(b) - f(a); };
  Object.assign(top, { by, desc });  // so that tapping a heading knows what it is changing
  rows = [...rows].sort(order(sort));  // lines that tie stay newest (or biggest) first
  if (by !== sort || !desc) rows.sort((a, b) => order(by)(a, b) * (desc ? 1 : -1));
  return `<table class="plain"><thead><tr>${cols.map(([id, name, , sorts, cls = '']) =>
    `<th class="${cls} ${id === by ? 'sorted' : ''}"${sorts ? ` data-sort="${id}"` : ''}>${name}${id === by ? (desc ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
    ${rows.slice(0, MOST).map(r => `<tr${opens(open(r))}>${cols.map(([, , cell, , cls = '']) =>
      `<td class="${cls}">${cell(r)}</td>`).join('')}</tr>`).join('')}</table>
    ${rows.length > MOST ? `<p class="muted small">The first ${MOST} of ${rows.length} are shown.</p>` : ''}`;
}
// One game, visit by visit: a line per round, everyone side by side. An X01
// match is shown leg by leg, with what each visit left. top: its level of
// `drill`, which may name a visit (at) or a leg to point out.
function matchHtml(m, top) {
  const legs = m.game === 'x01' ? x01Legs(m) : null, game = gameById(m.game), wide = legs ? 2 : 1;
  const facts = [when(m.started), ...(legs ? [`${m.opts.out === 'straight' ? 'straight' : 'double'} out`] : []),
    m.winner == null ? 'not finished' : m.players.length > 1 ? `${esc(m.players[m.winner])} won` : 'finished',
    ...(m.duration != null ? [clock(m.duration)] : []),
    ...(boards.length > 1 && boards.some(b => b.id === m.board) ? [`on ${esc(boardName(boards.find(b => b.id === m.board), boards))}`] : [])];
  const cell = v => {
    if (!v) return `<td colspan="${wide}"></td>`;
    const cls = v.i === top.at ? 'at' : '';
    if (legs) return `<td class="${cls}">${scoredText(v, v.score)} <span class="muted small">${dartsText(v)}</span></td>
      <td class="${cls} ${v.checkout ? 'out' : ''}">${v.after}</td>`;
    const total = game?.showTotal === false ? '' : ` <span class="muted small">${v.bust ? 'bust' : `= ${v.total}`}</span>`;
    return `<td class="${cls}">${v.darts ? dartsText(v) + total : `<b>${v.total}</b> <span class="muted small">typed</span>`}</td>`;
  };
  const rounds = visits => [...new Set(visits.map(v => v.round))].map((round, n) =>
    `<tr><td class="muted">${n + 1}</td>${m.players.map((_, p) => cell(visits.find(v => v.round === round && v.p === p))).join('')}</tr>`).join('');
  return `<p class="muted facts">${facts.join(' · ')}</p>
    ${summaryHtml(m)}
    <table class="plain sheet"><thead><tr><th>Round</th>${m.players.map(p => `<th colspan="${wide}">${esc(p)}</th>`).join('')}</tr></thead>
    ${!legs ? rounds(visitsOf(m)) : legs.map(l => `${legs.length > 1 ? `<tr class="legrow"><td colspan="${1 + 2 * m.players.length}" class="${
      l.n === top.leg && top.at == null ? 'at' : ''}">Leg ${l.n} · ${l.winner == null ? 'not finished'
      : `${esc(m.players[l.winner])} in ${l.sides[l.winner].darts} darts`}</td></tr>` : ''}${rounds(l.visits)}`).join('')}</table>`;
}
// The match player by player (matchSummary in stats.js): a column each, the best
// figure on a line in bold, and for X01 a line per leg with each player's average.
// Shown when a game is over (Match stats) and at the top of its scoresheet.
export function summaryHtml(m) {
  const { rows, legs } = matchSummary(m), many = m.players.length > 1;
  const head = first => `<thead><tr><th>${first}</th>${m.players.map(p => `<th class="num">${many ? esc(p) : ''}</th>`).join('')}</tr></thead>`;
  const sets = (m.opts?.sets ?? 1) > 1;
  return `<table class="plain summary">${head('')}
    ${rows.map(r => `<tr><td>${r.label}</td>${r.cells.map((c, p) => `<td class="num">${p === r.best ? `<b>${c}</b>` : c}</td>`).join('')}</tr>`).join('')}</table>
    ${legs?.length > 1 ? `<h3 class="sumhead">Average by leg</h3><table class="plain summary">${head('Leg')}
    ${legs.map(l => `<tr><td>${sets ? `Set ${l.set}, leg ${l.n}` : l.n}${l.winner == null ? ' <span class="muted small">not finished</span>' : ''}</td>${l.cells.map((c, p) =>
      `<td class="num">${c.avg == null ? '–' : p === l.winner ? `<b>${c.avg}</b>` : c.avg} <span class="muted small">${c.darts} darts${
        p === l.winner && many ? ', won' : ''}</span></td>`).join('')}</tr>`).join('')}</table>` : ''}`;
}
// One level of `drill` as {title, html()}, or null if the stats no longer have it.
function drillView(st, top) {
  const d = deep(st), list = (title, kind, rows) => ({ title, html: () => listHtml(kind, rows, top) });
  const some = (title, kind, rows) => rows.length ? list(`${title} (${rows.length})`, kind, rows) : null;
  if (top.v === 'tile') {
    const t = x01Tile(top.key);
    if (!t || !d.x01) return null;
    const rows = t.rows(d.x01);
    return rows.length ? list(`X01 ${t.label.toLowerCase()} ${t.kind === 'doubles' ? 'by double' : `(${rows.length} ${
      rows.length === 1 ? t.kind.slice(0, -1) : t.kind})`}`, t.kind, rows) : null;
  }
  if (top.v === 'double') return d.x01 && some(`Visits with a dart at ${label({ seg: top.aim, mult: 2 })}`, 'visits',
    d.x01.visits.filter(v => v.atDouble.some(a => a.aim === top.aim)));
  if (top.v === 'numbers') return d.mine.some(v => v.darts) ? list('Darts by number', 'numbers', dartTable(d.mine)) : null;
  if (top.v === 'number') return some(top.seg === 25 ? 'Visits with a bull or 25' : top.seg ? `Visits with a ${top.seg}` : 'Visits with a miss',
    'throws', visitsWith(d.mine, top.seg));
  if (top.v === 'matches') return some(`${esc(top.name)} games`, 'matches', d.matches.filter(m => m.name === top.name && m.winner != null));
  if (top.v === 'achievement') return achievementView(top.id, d);
  const m = top.v === 'match' && d.matches.find(m => m.id === top.id);
  return m ? { title: matchTitle(m), html: () => matchHtml(m, top) } : null;
}

const matchTitle = m => `${esc(m.name)}${m.game === 'x01' ? ` ${m.opts.start ?? 501}` : ''}`;
function drawDrill(st, old) {
  let views;
  // Whatever can no longer be found (the stats changed underneath) is left behind.
  while (statsView.drill.length && (views = statsView.drill.map(level => drillView(st, level))).some(v => !v)) statsView.drill.pop();
  if (!statsView.drill.length) return false;
  const game = statsView.game && gameById(statsView.game);
  $app.innerHTML = `<div class="page">
    ${pageHead('players')}
    <div class="row under"><button class="ghost" data-act="up">‹ Back</button><h1 class="sub">${views.at(-1).title}</h1></div>
    <p class="muted small crumbs">${[esc(nameOf(statsView.player)), game ? game.name : 'All games',
      ...(statsView.darts ? [esc(dartsName(statsView.darts))] : []), ...(statsView.board ? [esc(boardName(boards.find(b => b.id === statsView.board), boards))] : []), ...views.slice(0, -1).map(v => v.title)].join(' › ')}
      ${['match', 'achievement'].includes(statsView.drill.at(-1).v) ? '' : ' · tap a line for more, a heading to sort'}</p>
    ${old}<div class="fill drill">${views.at(-1).html()}</div>
    ${pageFoot('players')}
  </div>`;
  document.querySelector('.drill .at')?.scrollIntoView({ block: 'center' });
  refreshStatus();
  return true;
}

export function drawPlayers() {
  const st = statsData, x = st && deep(st).x01;
  const game = statsView.game && gameById(statsView.game);  // the one game this page is about, if any
  if (statsView.player == null) return drawNoPlayers();
  const tab = statsView.tab;
  const wait = statsFailed ? `<p class="muted">No stats saved on this device${statsView.player < 0 ? ' for this player' : ''} yet.
      Stats are worked out on ${machine()} and kept here once it has been reached.</p>`
    : !st ? '<p class="muted">Loading…</p>' : '';
  const none = wait || (st.darts || st.detail || x ? '' : `<p class="muted">No throws recorded yet${game ? ` in ${game.name}` : ''}.</p>`);
  const message = tab === 'games' || tab === 'achievements' ? wait : none;
  const owed = data.waitingGames();
  const old = st?.saved ? `<p class="muted small stale">${Machine()} can't be reached: these are the stats
    from ${new Date(st.saved).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${
    owed ? `, without the ${owed === 1 ? 'game' : `${owed} games`} waiting to sync` : ''}.</p>` : '';
  // Where a tile leads: the darts tiles to the numbers hit, a game's own tiles to its games.
  const numbers = st?.darts && deep(st).mine.some(v => v.darts) ? { v: 'numbers' } : null;
  const gamesOf = name => deep(st).matches.some(m => m.name === name && m.winner != null) ? { v: 'matches', name } : null;
  const panes = () => `<div class="p-stats">
    ${game?.id === 'x01' ? (x ? `${x01ChartsHtml(x)}${x01Tiles(x)}` : '')
      : game && st.detail ? `<h2>${game.name} averages</h2><div class="tiles">${gameTiles(game.id, st.detail, gamesOf(game.name))}</div>` : ''}
    <h2>${game ? `${game.name} darts` : 'All games'}${st.since ? ` · since ${new Date(st.since).toLocaleDateString()}` : ''}</h2>
    <div class="tiles">${tile('Darts thrown', st.darts, numbers)}${tile('Time played', st.played_ms ? timeSpent(st.played_ms) : null)}${tile('Trebles', pct(st.trebles, st.darts), numbers)}
      ${tile('Doubles', pct(st.doubles, st.darts), numbers)}${tile('Bulls and 25s', st.bulls, numbers)}${tile('Misses', pct(st.misses, st.darts), numbers)}
      ${tile('Most hit', st.segments.slice(0, 3).map(g => g.seg === 25 ? 'Bull' : g.seg).join(', ') || null, numbers)}</div>
    ${x && !game ? `<h2>X01</h2>${x01ChartsHtml(x)}<div class="tiles">${x01Tiles(x, X01_HEADLINES)}</div>` : ''}
    ${h2hHtml(deep(st).matches)}</div>
    <div class="p-games">${st.games.length ? `<h2>Finished games</h2>
    <table class="plain"><tr><th>Game</th><th>Played</th><th>Won (2+ players)</th><th>Average time</th><th>Quickest</th><th class="wide">Total time</th></tr>${st.games.map(g =>
      `<tr${opens(gamesOf(g.game))}><td>${esc(g.game)}</td><td>${g.played}</td><td>${g.won}</td>
       <td>${g.avg_ms != null ? clock(g.avg_ms) : '–'}</td><td>${g.best_ms != null ? clock(g.best_ms) : '–'}</td>
       <td class="wide">${g.total_ms ? timeSpent(g.total_ms) : '–'}</td></tr>`).join('')}</table>`
      : '<p class="muted">No finished games yet.</p>'}${gearHtml(st, game)}${boardsHtml(st, game, !!gearHtml(st, game))}</div>
    <div class="p-board">${st.recent.length ? `<h2>Heat map · ${game ? `${game.name}, ` : ''}${
      st.recent.length === 1 ? '1 dart' : `${st.recent.length < 5000 ? '' : 'last '}${st.recent.length} darts`}</h2>
    <div class="statboard"><svg id="statboard"></svg></div>
    <div class="heatkey"><span>Fewer darts</span><i></i><span>More</span></div>`
      : `<p class="muted">No dart positions recorded yet${game ? ` in ${game.name}` : ''}.</p>`}</div>
    ${tab === 'achievements' ? achievementsPane(game) : ''}`;
  const lit = id => id === tab || (id === 'stats' && tab === 'board' && BIG.matches);
  if (statsFailed) statsView.drill = [];
  if (statsView.drill.length && st && drawDrill(st, old)) return;  // (still loading: the opened-up figure is drawn once the stats are here)
  $app.innerHTML = `<div class="page">
    ${pageHead('players')}
    <div class="picks">
      <label class="pick"><span>Player</span><select data-choose="player">${players.map(p =>
        `<option value="${p.id}" ${p.id === statsView.player ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="pick"><span>Game</span><select data-choose="game">${[{ id: '', name: 'All games' }, ...GAMES].map(g =>
        `<option value="${g.id}" ${g.id === (statsView.game ?? '') ? 'selected' : ''}>${g.name}</option>`).join('')}</select></label>
      ${setsOf(statsView.player, true).length ? `<label class="pick"><span>Darts</span><select data-choose="darts">${[{ id: '', name: 'All darts' },
        ...setsOf(statsView.player, true)].map(d => `<option value="${esc(d.id)}" ${d.id === (statsView.darts ?? '') ? 'selected' : ''}>${
        esc(d.name)}${d.retired ? ' (put away)' : ''}</option>`).join('')}</select></label>` : ''}
      ${boards.length > 1 ? `<label class="pick"><span>Board</span><select data-choose="board">${[['', 'All boards'],
        ...boards.map(b => [b.id, boardName(b, boards)])].map(([id, name]) => `<option value="${esc(id)}" ${id === (statsView.board ?? '') ? 'selected' : ''}>${
        esc(name)}</option>`).join('')}</select></label>` : ''}</div>
    <div class="row tabs">${STAT_TABS.map(([id, name]) =>
      `<button class="${lit(id) ? 'on' : ''}" data-tab="${id}">${name}</button>`).join('')}${
      st && deep(st).matches.length ? '<button class="ghost export-csv" data-act="export-csv" title="Download filtered visit history as CSV">Export CSV</button>' : ''}</div>
    ${old}<div class="fill panes tab-${tab}">${message || panes()}</div>
    ${pageFoot('players')}
  </div>`;
  const svg = document.getElementById('statboard');
  if (svg) buildBoard(svg).showHeat(st.recent);
  refreshStatus();
}
// Putting the sets side by side needs the games of every set, on the board picked; putting the
// boards side by side needs the games on every board, with the darts picked. When the page is
// limited to one set (or one board), those other stats are asked for as well, and kept while the
// page shows the same player and game.
const also = new Map();  // stats path -> the stats (null: they can't be had)
const alsoLoading = new Set();
function alsoStats(st, set, board) {
  if ((st.set ?? null) === set && (st.board ?? null) === board) return st;
  const path = statsPath(statsView.player, statsView.game, set, board);
  if (also.has(path)) return also.get(path);
  if (!alsoLoading.has(path)) loadAlso(path);
  return undefined;  // still coming
}
async function loadAlso(path) {
  alsoLoading.add(path);
  let st = null;
  try { st = await loadStats(path, connected ? 10000 : 2500); } catch { /* shown as unavailable */ }
  alsoLoading.delete(path);
  also.set(path, st);
  if (screen === 'players') drawPlayers();
}
const day = ts => ts ? new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' }) : '–';
// A table of things side by side (sets of darts, or boards): how much each was used, and how the
// player throws with each. A figure waits until there are ENOUGH darts behind it, and nothing says
// which is best: a small gap can be a good or bad week. A line can be tapped to see its stats alone.
//   rows    [{id, label: html, darts, games, won, first, last}]
//   side    the stats the figures are worked out from (undefined: still coming, null: can't be had)
//   group   boardsSideBySide or setsSideBySide
//   what    'set' or 'board', for the notes
//   brief   the rule for "not yet" was said by a table above: just say what a tap does
function sideTable({ title, head, rows, side, group, at, attr, what, game, brief }) {
  const cmp = side ? group(deep(side).matches) : null;
  const x01 = !game || game.id === 'x01';  // the average and checkout rate come from X01 only
  // [heading, figure, darts it is counted from, how it is written]
  const figs = [
    ...(x01 ? [['Average', 'average', 'x01Darts', n => n.toFixed(1)], ['Checkout', 'checkout', 'coDarts', n => `${n.toFixed(1)}%`]] : []),
    ['Trebles', 'trebles', 'singles', n => `${n.toFixed(1)}%`],
  ];
  const cell = (r, [, key, from, write]) => {
    if (!cmp) return side === undefined ? '<span class="muted">…</span>' : '–';
    const c = cmp.get(r.id ?? null);
    if (!c?.[from]) return '–';
    return c[key] == null ? '<span class="muted small" title="Not enough darts yet">not yet</span>' : write(c[key]);
  };
  // How far each is from the figures it can't show yet.
  const more = { average: n => `${n} more X01 darts for its average`, checkout: n => `${n} more darts at a double for its checkout rate`,
    trebles: n => `${n} more darts for its trebles` };
  const short = !cmp ? [] : rows.filter(r => r.id && r.short !== false).map(r => {
    const c = cmp.get(r.id);
    const parts = figs.filter(([, key, from]) => c?.[from] && c[key] == null).map(([, key]) => more[key](c.need[key]));
    return parts.length ? `${r.plain}: ${parts.join(', ')}.` : '';
  }).filter(Boolean);
  return `<h2>${title}${game ? ` · ${game.name}` : ''}</h2>
    <table class="plain"><tr><th>${head}</th><th>Darts thrown</th><th>Games</th>${figs.map(([h]) => `<th>${h}</th>`).join('')}<th class="wide">Won (2+ players)</th>
      <th class="wide">First used</th><th class="wide">Last used</th></tr>${rows.map(r =>
      `<tr${r.id ? ` ${attr}="${esc(r.id)}"` : ''} class="${r.id && r.id === at ? 'at' : ''}"><td>${r.label}</td><td>${r.darts.toLocaleString()}</td><td>${r.games}</td>${figs.map(f => `<td>${cell(r, f)}</td>`).join('')}
       <td class="wide">${r.won}</td><td class="wide">${day(r.first)}</td><td class="wide">${day(r.last)}</td></tr>`).join('')}</table>
    ${short.length ? `<p class="muted small">${short.join(' ')}</p>` : ''}
    ${brief ? `<p class="muted small">"Not yet" as for the darts above. Tap a ${what} to see its stats on their own.</p>` : `<p class="muted small">Every dart counts towards the darts thrown, typed scores too. A figure shows (in place of "not yet") once a ${what} has enough darts
      behind it (${ENOUGH.average} for the average, ${ENOUGH.checkout} at a double for checkouts). Form changes from week to week,
      so a small gap between two ${what}s may be nothing. Tap a ${what} to see its stats on their own.</p>`}`;
}
// How much each set of darts has been thrown, like the miles on a runner's shoes (on the board picked).
function gearHtml(st, game) {
  const gear = (st.gear ?? []).filter(g => g.games || g.id);
  if (!gear.some(g => g.id)) return '';
  return sideTable({
    title: `Darts${statsView.board ? ` on ${esc(boardName(boards.find(b => b.id === statsView.board), boards))}` : ''}`, head: 'Darts', what: 'set', game,
    side: alsoStats(st, null, statsView.board), group: setsSideBySide, at: statsView.darts, attr: 'data-gear',
    rows: gear.map(g => ({ ...g, plain: esc(g.name ?? ''), short: !g.retired, label: g.id ? `<b>${esc(g.name)}</b>${
      g.grams != null ? ` <span class="muted small">${grams(g.grams)}</span>` : ''}${g.retired ? ' <span class="muted small">put away</span>' : ''}`
      : '<span class="muted">Not named</span>' })),
  });
}
// How the player throws on each board (with the darts picked): shown once there are two boards.
function boardsHtml(st, game, brief) {
  const list = st.boards ?? [];
  if (list.length < 2) return '';
  return sideTable({
    title: `Boards${statsView.darts ? ` with ${esc(dartsName(statsView.darts))}` : ''}`, head: 'Board', what: 'board', game,
    brief, side: alsoStats(st, statsView.darts, null), group: boardsSideBySide, at: statsView.board, attr: 'data-onboard',
    rows: list.map(b => ({ ...b, plain: esc(boardName(b, list)), short: b.games > 0, label: `<b>${esc(boardName(b, list))}</b>${
      b.down == null ? ' <span class="muted small">on the wall</span>' : ''}` })),
  });
}
// Nobody to show stats for yet: say where players are made.
function drawNoPlayers() {
  statsView.drill = [];
  $app.innerHTML = `<div class="page">
    ${pageHead('players')}
    <div class="fill noplayers"><p class="muted">No players yet. Add one and their stats will show here.</p>
      <button data-act="manageplayers">Add a player</button></div>
    ${pageFoot('players')}
  </div>`;
  refreshStatus();
}
// ---------- one game's scoresheet ----------
// A game that is over, opened by its own address: by a link to it, or
// by back, forward or a reload landing on a game that has since finished. It
// is looked for among the games waiting here to be sent, then on the server, then
// in the stats kept on this device.
export let sheet = null;  // {id, name: the first part of its address, m: the match once found, gone: why it wasn't}
export async function renderSheet(id, name = 'game') {
  if (account.locked) return renderLanding();
  setScreen('sheet');
  if (sheet?.id !== id) sheet = { id, name, m: data.sheet(id) };
  const want = sheet;
  want.gone = null;
  drawSheet();
  if (want.m) return;
  try {
    want.m = await loadStats(`/matches/${encodeURIComponent(id)}`, connected ? 10000 : 2500);
  } catch (e) {
    want.m = e.status ? null : await shelved(id).catch(() => null);
    want.gone = e.status ? 'This game is no longer saved.'
      : `${Machine()} can't be reached, and this game isn't among the stats kept on this device.`;
  }
  if (screen !== 'sheet' || sheet !== want) return;
  drawSheet();
  mark();  // the address now says what kind of game it is
}
// A player's saved all-games stats list every game they played in.
async function shelved(id) {
  const kept = await shelf();
  for (const req of await kept.keys()) {
    if (!req.url.endsWith('/stats')) continue;
    const st = await (await kept.match(req)).json();
    const m = st.matches?.find(m => m.id === id);
    if (m) return { ...m, saved: st.saved };
  }
  return null;
}
function drawSheet() {
  const m = sheet.m;
  $app.innerHTML = `<div class="page">
    ${pageHead('players')}
    <div class="row under"><button class="ghost" data-act="up">‹ Back</button><h1 class="sub">${m ? matchTitle(m) : 'Game'}</h1></div>
    ${m?.saved ? `<p class="muted small stale">${Machine()} can't be reached: this is the copy
      from ${new Date(m.saved).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.</p>` : ''}
    <div class="fill drill">${m ? matchHtml(m, {}) : `<p class="muted">${sheet.gone ?? 'Loading…'}</p>`}</div>
    ${pageFoot('players')}
  </div>`;
  refreshStatus();
}
