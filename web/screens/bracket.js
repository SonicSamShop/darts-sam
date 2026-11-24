// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The bracket, drawn like the printed draw sheet pinned up at a darts night: the
// rounds as columns left to right, a box per player, square lines joining each pair
// to the box they play for in the next round, and the Winner's box at the end. One
// SVG, in the theme's own colours (style.css, .bracket). And a result moving on: the
// winner's name travels out of their box, along the line, round the corner and into
// the next round's box, while the loser's box dims.
// The screen that shows it, and decides which results still have to move, is
// tournament.js beside this file.
//
// A box is found by its column r (0 the first round, the last the Winner's) and its
// place k in that column, top to bottom. Box k of column r is played for in the
// slot (t.data.slots) of round r numbered k >> 1 within the round, on side k % 2.

import { roundCount, roundName } from '../tournament.js';

const NS = 'http://www.w3.org/2000/svg';
// A box, the step between boxes in the first round, the gap between columns, and
// the room above the first box for the column's heading.
const BW = 156, BH = 34, ROW = 46, GAP = 40, TOP = 44;
const NAME = 15;  // the size names are written at

// The first slot of round r, in a bracket of N.
const first = (N, r) => N - N / 2 ** r;

// Where everything goes: the column's left edge x(r), each box's top ys[r][k], and
// the whole drawing's width and height. Every box is midway between the two that feed it.
export function layout(t) {
  const R = roundCount(t), N = 2 ** R;
  const ys = [Array.from({ length: N }, (_, k) => TOP + k * ROW)];
  for (let r = 1; r <= R; r++) ys[r] = Array.from({ length: N / 2 ** r }, (_, k) => (ys[r - 1][2 * k] + ys[r - 1][2 * k + 1]) / 2);
  return { R, N, x: r => r * (BW + GAP), ys, w: (R + 1) * BW + R * GAP, h: TOP + N * ROW - (ROW - BH) + 4 };
}

// The line from box k of column r to the box it plays for: out, up or down, and in.
export function wirePath(L, r, k) {
  const x = L.x(r) + BW, y = L.ys[r][k] + BH / 2, to = L.ys[r + 1][k >> 1] + BH / 2;
  return `M${x} ${y} H${x + GAP / 2} V${to} H${x + GAP}`;
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}
// A name in a box, cut short with "…" if it would run into the legs or out of the box.
function name(g, text, room) {
  const e = el('text', { x: 10, y: BH / 2 + 5, 'font-size': NAME }, g);
  e.textContent = text;
  for (let n = text.length; n > 1 && e.getComputedTextLength?.() > room; n--) e.textContent = `${text.slice(0, n - 1).trimEnd()}…`;
  return e;
}
const legsText = (g, legs) => {
  el('text', { x: BW - 10, y: BH / 2 + 5, 'font-size': NAME, 'text-anchor': 'end', class: 'legs' }, g).textContent = legs;
};
const tag = (svg, x, y, text) => { el('text', { x, y: y - 4, class: 'tag' }, svg).textContent = text; };

// Who is in box k of column r, and what happened to them there.
function boxAt(t, L, r, k) {
  if (r === L.R) return { id: t.winner, slot: null };
  const i = first(L.N, r) + (k >> 1), s = t.data.slots[i], id = k % 2 ? s.b : s.a;
  const decided = s.winner != null && id != null && id !== 'bye';
  return { id, i, s, won: decided && s.winner === id, lost: decided && s.winner !== id };
}

// Draws tournament t into svg. hide: slots whose result is still to be shown moving
// on (drawn as they were before it). next: the slot to mark as the next match, or null.
// nameOf(id): a player's name.
export function drawBracket(svg, t, { hide = new Set(), next = null, nameOf }) {
  const L = layout(t);
  svg.replaceChildren();
  svg.setAttribute('viewBox', `-2 0 ${L.w + 4} ${L.h}`);
  const lit = [];
  for (let r = 0; r <= L.R; r++) {
    el('text', { x: L.x(r), y: 16, class: 'head' }, svg).textContent = roundName(t, r);
    const legs = t.data.rounds[r]?.legs;  // (clear of a "next" or "simulated" above the first box)
    if (r < L.R) el('text', { x: L.x(r), y: 29, class: 'sub' }, svg).textContent = `first to ${legs} leg${legs === 1 ? '' : 's'}`;
    if (r < L.R) L.ys[r].forEach((_, k) => {
      const b = boxAt(t, L, r, k);
      if (b.won && !hide.has(b.i)) lit.push([r, k]);
      else el('path', { d: wirePath(L, r, k), class: 'wire' }, svg);
    });
  }
  // a winner's line over the loser's, where the two join
  for (const [r, k] of lit) el('path', { d: wirePath(L, r, k), class: 'wire won' }, svg);
  for (let r = 0; r <= L.R; r++) {
    L.ys[r].forEach((y, k) => {
      const b = boxAt(t, L, r, k);
      // a result still to be shown: its own boxes as they were, and the box it fills still empty
      const own = r < L.R && hide.has(b.i), pending = r > 0 && hide.has(first(L.N, r - 1) + k);
      const id = pending ? null : b.id, bye = id === 'bye';
      const cls = ['box', id == null || bye ? 'empty' : '', !own && b.lost ? 'lost' : '', !own && b.won ? 'won' : '',
        r < L.R && b.i === next ? 'next' : '', r === L.R && id != null ? 'champ' : ''].filter(Boolean).join(' ');
      const g = el('g', { class: cls, transform: `translate(${L.x(r)} ${y})`, 'data-box': `${r}:${k}` }, svg);
      el('rect', { width: BW, height: BH, rx: 4 }, g);
      // (room is left for the legs even while they are hidden, for when they go up)
      const legs = r < L.R && b.s.legs && b.s.how !== 'bye' ? b.s.legs[k % 2] : null;
      if (bye) name(g, 'bye', BW - 20).setAttribute('class', 'muted');
      else if (id != null) name(g, nameOf(id), BW - (legs == null ? 20 : 40));
      if (legs != null && !own) legsText(g, legs);
    });
  }
  // above a match: whether it was simulated, or is the next to play
  t.data.slots.forEach((s, i) => {
    const y = L.ys[s.round][2 * (i - first(L.N, s.round))];
    if (s.how === 'simulated' && !hide.has(i)) tag(svg, L.x(s.round), y, 'simulated');
    if (i === next) tag(svg, L.x(s.round), y, 'next');
  });
}

// Shows slot i's result moving on, on a drawing made with i in `hide`: the legs go up,
// the loser's box dims, and a copy of the winner's box travels out along the line,
// round the corner and into the next box, which lights the line behind it. Resolves
// when it is there (the caller then draws the result as it now is). At once if
// `reduced` (prefers-reduced-motion); skip() true (a tap) takes it straight to the end.
export function animate(svg, t, i, { nameOf, reduced, skip }) {
  if (reduced || skip()) return Promise.resolve();
  const L = layout(t), s = t.data.slots[i], r = s.round, j = i - first(L.N, r);
  const k = s.winner === s.a ? 2 * j : 2 * j + 1;
  const x0 = L.x(r), y0 = L.ys[r][k], x1 = L.x(r + 1), y1 = L.ys[r + 1][j];
  const loser = svg.querySelector(`[data-box="${r}:${k ^ 1}"]`);
  // the line lights up as the name travels along it
  const wire = el('path', { d: wirePath(L, r, k), class: 'wire won' }, svg);
  const len = wire.getTotalLength();
  wire.style.strokeDasharray = len;
  wire.style.strokeDashoffset = len;
  // the score goes up first
  if (s.legs) [2 * j, 2 * j + 1].forEach((b, n) => legsText(svg.querySelector(`[data-box="${r}:${b}"]`), s.legs[n]));
  if (s.how === 'simulated') tag(svg, x0, L.ys[r][2 * j], 'simulated');
  const ghost = el('g', { class: 'ghost box', transform: `translate(${x0} ${y0})` }, svg);
  el('rect', { width: BW, height: BH, rx: 4 }, ghost);
  name(ghost, nameOf(s.winner), BW - 20);
  // an L: out along the line, down (or up) to the next box, and in
  const legA = (BW + GAP) / 2, legB = Math.abs(y1 - y0), legC = x1 - x0 - legA, total = legA + legB + legC;
  const PAUSE = 350, MOVE = 900, HOLD = 250;
  const ease = p => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
  return new Promise(done => {
    const t0 = performance.now();
    function frame(now) {
      const p = skip() ? 1 : Math.min(1, Math.max(0, (now - t0 - PAUSE) / MOVE));
      if (now - t0 > PAUSE / 2 || p === 1) loser?.classList.add('lost');
      const d = ease(p) * total;
      let x = x0, y = y0;
      if (d <= legA) x = x0 + d;
      else if (d <= legA + legB) { x = x0 + legA; y = y0 + Math.sign(y1 - y0) * (d - legA); }
      else { x = x0 + legA + (d - legA - legB); y = y1; }
      ghost.setAttribute('transform', `translate(${x} ${y})`);
      wire.style.strokeDashoffset = len * (1 - ease(p));
      if (p < 1) return requestAnimationFrame(frame);
      setTimeout(done, skip() ? 0 : HOLD);
    }
    requestAnimationFrame(frame);
  });
}

// Scales the drawing to its box (box: the element it scrolls in): as big as the width
// allows, and the height too when `fill` (the bracket's own screen), but never so small
// that a name is under the theme's small size (--sz-fine): then the box scrolls.
export function sizeBracket(box, svg, { fill }) {
  // (the box takes its size from the screen, not from the drawing, which only scrolls in it)
  const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);
  const fine = parseFloat(getComputedStyle(box).getPropertyValue('--sz-fine')) || 13;
  let k = box.clientWidth / w;
  if (fill) k = Math.min(k, box.clientHeight / h);
  k = Math.max(k, fine / NAME);
  svg.style.width = `${Math.floor(w * k)}px`;
  svg.style.height = `${Math.floor(h * k)}px`;
}

// Scrolls the box, if it scrolls and slot i's match is out of sight, to bring it into
// view: its round at the left, the match in the middle.
export function showSlot(box, svg, t, i) {
  if (i == null) return;
  const L = layout(t), s = t.data.slots[i], k = svg.clientWidth / (L.w + 4), j = i - first(L.N, s.round);
  const left = (L.x(s.round) + 2) * k, top = L.ys[s.round][2 * j] * k, bottom = (L.ys[s.round][2 * j + 1] + BH) * k;
  if (left < box.scrollLeft || left + BW * k > box.scrollLeft + box.clientWidth) box.scrollLeft = left - 8;
  if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) box.scrollTop = (top + bottom - box.clientHeight) / 2;
}
