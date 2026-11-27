// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Dartboard geometry (mm, origin at bull, +y up) and the tappable SVG board.
export const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const R = { bull: 6.35, outer: 15.9, tIn: 99, tOut: 107, dIn: 162, dOut: 170 };

export function scoreAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= R.bull) return { seg: 25, mult: 2 };
  if (r <= R.outer) return { seg: 25, mult: 1 };
  if (r > R.dOut) return { seg: 0, mult: 0 };
  const deg = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  const seg = SEGMENTS[Math.floor(((deg + 9) % 360) / 18)];
  const mult = r >= R.tIn && r <= R.tOut ? 3 : r >= R.dIn ? 2 : 1;
  return { seg, mult };
}

export const value = d => d.seg * d.mult;

// A seeded random number generator (mulberry32): rng(seed)() gives the next
// number in [0, 1). Games that pick things at random (`seeded` in engine.js)
// pick them from the match's seed, so replaying the log gives the same ones.
// server/db.py has a copy (_rc_rng) that must give the same numbers.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Which half of a single a dart landed in: 'in' (between the bull and the
// treble ring) or 'out' (between the treble and the double). null for any
// other bed, and for a dart with no position (one entered as a miss, say).
export function half(d) {
  if (d.mult !== 1 || d.seg === 25 || d.x == null || d.y == null) return null;
  return Math.hypot(d.x, d.y) < (R.tIn + R.tOut) / 2 ? 'in' : 'out';
}

export function label(d) {
  if (!d.mult) return 'Miss';
  if (d.seg === 25) return d.mult === 2 ? 'Bull' : '25';
  return ['', 'D', 'T'][d.mult - 1] + d.seg;
}

// The same, as the caller says it: "Treble 20", "Bullseye", "Miss".
export function spoken(d) {
  if (!d.mult) return 'Miss';
  if (d.seg === 25) return d.mult === 2 ? 'Bullseye' : '25';
  return ['', 'Double ', 'Treble '][d.mult - 1] + d.seg;
}

// Throwing for the bull, to settle who throws first: everyone throws one dart
// and the nearest goes first, the rest following nearest first. The bullseye
// beats the 25 ring, which beats anything outside it; two darts in the same one
// of those, or the same distance out (to the millimetre), are level. Players
// level for first throw again, in the same order, until one of them is nearest.
// ids: the players in throwing order. darts: every dart so far, in the order thrown
// ({seg, mult, x, y}; one with no position is further away than any that has one).
// Gives back:
//   round   who throws in the round being thrown
//   thrown  how many of them have
//   next    who throws next (null once it is settled)
//   again   the round is a throw-off between players who were level
//   last    {player id: their latest dart}
//   tail    those whose place is settled already, in order, behind the ones still throwing
//   order   the whole throwing order, once it is settled (else null)
export const bullMm = d => d.x == null || d.y == null ? Infinity : Math.round(Math.hypot(d.x, d.y));
const bullBed = d => d.seg === 25 ? 2 - d.mult : 2;  // 0 the bullseye, 1 the 25 ring, 2 anywhere else
function nearer(a, b) {
  if (bullBed(a) !== bullBed(b)) return bullBed(a) - bullBed(b);
  if (bullBed(a) < 2 || bullMm(a) === bullMm(b)) return 0;
  return bullMm(a) - bullMm(b);
}
export function bullUp(ids, darts) {
  const last = {};
  let round = ids, tail = [], n = 0, again = false;
  for (;;) {
    const thrown = darts.slice(n, n + round.length).map((d, i) => ({ d, id: round[i] }));
    for (const t of thrown) last[t.id] = t.d;
    if (thrown.length < round.length) return { round, thrown: thrown.length, next: round[thrown.length], again, last, tail, order: null };
    n += round.length;
    const sorted = [...thrown].sort((a, b) => nearer(a.d, b.d));
    const level = sorted.filter(t => nearer(t.d, sorted[0].d) === 0).map(t => t.id);
    tail = [...sorted.slice(level.length).map(t => t.id), ...tail];
    if (level.length === 1) return { round, thrown: thrown.length, next: null, again, last, tail, order: [level[0], ...tail] };
    round = round.filter(id => level.includes(id));
    again = true;
  }
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
const pt = (r, deg) => {
  const a = deg * Math.PI / 180;
  return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
};
const wedge = (r0, r1, a0, a1) =>
  `M${pt(r1, a0)}A${r1} ${r1} 0 0 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 0 0 ${pt(r0, a0)}Z`;

// Heat map colours, fewest darts first: dark purple through red to pale yellow.
export const HEAT = [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]];

// How thickly darts landed across the board: a grid of GRID x GRID cells
// covering the board's whole viewBox (452 mm square), each 0 (none) to 1 (the
// busiest spot). points are [x, y] in mm. Every dart is spread over its
// neighbouring cells so that a group of darts reads as one warm patch: widely
// when there are only a few darts (or they would just be dots), tightly once
// there are thousands and the detail is worth seeing.
const GRID = 226, CELL = 2;
export function heatGrid(points) {
  const sigma = Math.min(14, Math.max(5, 38 * points.length ** -0.25)) / CELL;  // in cells
  const SPREAD = Math.ceil(sigma * 3);  // cells either side that a dart reaches
  let grid = new Float32Array(GRID * GRID);
  for (const [x, y] of points) {
    const i = Math.floor((x + 226) / CELL), j = Math.floor((226 - y) / CELL);
    if (i >= 0 && i < GRID && j >= 0 && j < GRID) grid[j * GRID + i]++;
  }
  const weight = Array.from({ length: 2 * SPREAD + 1 }, (_, k) => Math.exp(-((k - SPREAD) ** 2) / (2 * sigma * sigma)));
  for (const across of [true, false]) {  // spread along the rows, then down the columns
    const out = new Float32Array(GRID * GRID);
    for (let a = 0; a < GRID; a++) for (let b = 0; b < GRID; b++) {
      let sum = 0;
      for (let k = -SPREAD; k <= SPREAD; k++) {
        const c = b + k;
        if (c >= 0 && c < GRID) sum += weight[k + SPREAD] * grid[across ? a * GRID + c : c * GRID + a];
      }
      out[across ? a * GRID + b : b * GRID + a] = sum;
    }
    grid = out;
  }
  const max = grid.reduce((m, v) => Math.max(m, v), 0);
  // Square root: without it one hot treble 20 would leave everything else too faint to see.
  return max ? grid.map(v => Math.sqrt(v / max)) : grid;
}

// The grid as a picture (a PNG address for an <image>), see-through where no darts landed.
function heatPicture(points) {
  const grid = heatGrid(points);
  const canvas = Object.assign(document.createElement('canvas'), { width: GRID, height: GRID });
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(GRID, GRID);
  grid.forEach((t, n) => {
    const at = t * (HEAT.length - 1), lo = Math.min(Math.floor(at), HEAT.length - 2), f = at - lo;
    for (let c = 0; c < 3; c++) img.data[n * 4 + c] = HEAT[lo][c] + (HEAT[lo + 1][c] - HEAT[lo][c]) * f;
    img.data[n * 4 + 3] = 255 * Math.min(1, t * 4);
  });
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

// Builds the board into an <svg>. onHit({seg, mult, x, y}) fires on tap.
export function buildBoard(svg, onHit) {  // leave onHit out for a display-only board
  svg.setAttribute('viewBox', '-226 -226 452 452');
  svg.append(el('circle', { r: 224, class: 'b-surround' }));  // 224 + half its 2 mm ring = 225
  SEGMENTS.forEach((n, i) => {
    const a0 = i * 18 - 9, a1 = a0 + 18, dark = i % 2 === 0;
    const single = dark ? 'b-dark' : 'b-light', ring = dark ? 'b-red' : 'b-green';
    svg.append(
      el('path', { d: wedge(R.outer, R.tIn, a0, a1), class: single }),
      el('path', { d: wedge(R.tIn, R.tOut, a0, a1), class: ring }),
      el('path', { d: wedge(R.tOut, R.dIn, a0, a1), class: single }),
      el('path', { d: wedge(R.dIn, R.dOut, a0, a1), class: ring }));
    const t = el('text', { class: 'b-num', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    const [tx, ty] = pt(197, i * 18).split(' ');
    t.setAttribute('x', tx); t.setAttribute('y', ty);
    t.textContent = n;
    svg.append(t);
  });
  svg.append(el('circle', { r: R.outer, class: 'b-green' }), el('circle', { r: R.bull, class: 'b-red' }));
  const aimAt = el('g', {}), hits = el('g', {}), marks = el('g', {});  // the bed to aim at (showTarget), under the darts
  svg.append(aimAt, hits, marks);
  // A bed {seg, mult, part?} as the outline(s) of it: a ring for each half of a single.
  const disc = r => `M0 ${-r}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${-r}Z`;
  const rings = t => t.mult === 3 ? [[R.tIn, R.tOut]] : t.mult === 2 ? [[R.dIn, R.dOut]]
    : [[R.outer, R.tIn], [R.tOut, R.dIn]].filter((_, n) => !t.part || n === (t.part === 'in' ? 0 : 1));
  const bed = t => {
    if (t.seg === 25) return [t.mult === 2 ? disc(R.bull) : disc(R.outer) + disc(R.bull)];
    const i = SEGMENTS.indexOf(t.seg), a0 = i * 18 - 9, a1 = a0 + 18;
    return i < 0 ? [] : rings(t).map(([r0, r1]) => wedge(r0, r1, a0, a1));
  };
  // A dart just landed: the bed it scored lights up and fades, and a puff of chalk where it went in.
  const land = d => {
    if (!svg.animate) return;
    const t = scoreAt(d.x, d.y);
    const lit = t.mult ? bed(t).map(p => el('path', { d: p, class: 'b-hit', 'fill-rule': 'evenodd' })) : [];
    const puff = el('g', { class: 'b-puff', transform: `translate(${d.x} ${-d.y})` });
    for (let k = 0; k < 9; k++) {
      const a = (k * 40 + (k * 17) % 13) * Math.PI / 180, r0 = 5, r1 = 11 + (k % 3) * 4;
      puff.append(el('path', { d: `M${(r0 * Math.cos(a)).toFixed(1)} ${(r0 * Math.sin(a)).toFixed(1)}L${(r1 * Math.cos(a)).toFixed(1)} ${(r1 * Math.sin(a)).toFixed(1)}` }));
    }
    puff.append(el('circle', { r: 6 }));
    hits.append(...lit, puff);
    lit.forEach(p => p.animate([{ opacity: .85 }, { opacity: .85, offset: .3 }, { opacity: 0 }], { duration: 1300, easing: 'ease-in', fill: 'forwards' })
      .onfinish = () => p.remove());
    puff.animate([{ transform: `translate(${d.x}px, ${-d.y}px) scale(.4)`, opacity: 1 },
      { transform: `translate(${d.x}px, ${-d.y}px) scale(1.5)`, opacity: 0 }], { duration: 520, easing: 'ease-out', fill: 'forwards' })
      .onfinish = () => puff.remove();
  };
  // What the board shows when nothing is being held: all of it, or the part
  // round a target. [left, top, width] of the target viewBox, animated via a
  // GPU-composited percentage CSS transform on `<svg>` (which is a 100cqmin square
  // inside `.boardwrap`, so percentages match board mm at every size with zero JS resize).
  const FULL = [-226, -226, 452];
  let home = FULL, shown = FULL, aimed = '';
  const look = (v, ms = 0) => {
    shown = v;
    const s = 452 / v[2];
    const tx = -(v[0] + v[2] / 2) / 452 * 100;
    const ty = -(v[1] + v[2] / 2) / 452 * 100;
    const still = !ms || matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    svg.style.transition = still ? 'none' : `transform ${ms}ms cubic-bezier(.22, 1, .36, 1)`;
    svg.style.transform = Math.abs(s - 1) < 0.001 && Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01
      ? ''
      : `scale(${s.toFixed(4)}) translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%)`;
  };
  const glide = (to, ms = 320) => {
    home = to;
    if (shown.every((v, i) => Math.abs(v - to[i]) < 0.5)) return;
    look(to, ms);
  };

  if (onHit) {
    // A quick tap scores where it lands. Holding for HOLD ms zooms in around the
    // finger; the dart is then scored where the finger is lifted.
    const HOLD = 500, ZOOM = 3;
    const ring = el('circle', { r: 3 }), tag = el('text', { 'text-anchor': 'middle' });
    const aim = el('g', { class: 'b-aim', hidden: '' });
    aim.append(el('path', { d: 'M-9 0H-3M3 0H9M0 -9V-3M0 3V9' }), ring, tag);
    svg.append(aim);
    const at = e => {
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      return { x: p.x, y: -p.y };
    };
    let press = null, top = home[1];  // top: upper edge of what is in view
    const moveAim = e => {
      const p = at(e);
      aim.setAttribute('transform', `translate(${p.x.toFixed(1)} ${(-p.y).toFixed(1)})`);
      // the finger covers the spot, so say what is under it; below it when there is no room above
      tag.setAttribute('y', -p.y - 36 < top ? 34 : -24);
      tag.textContent = label(scoreAt(p.x, p.y));
    };
    const zoomIn = e => {
      look(home, 0);
      const p = at(e), w = home[2] / ZOOM;
      // the spot under the finger stays under the finger
      const x0 = p.x - (p.x - home[0]) / ZOOM, y0 = -p.y - (-p.y - home[1]) / ZOOM;
      look([x0, y0, w], 0);
      svg.classList.add('zoomed');
      press.zoomed = true; top = y0;
      aim.removeAttribute('hidden');
      moveAim(e);
    };
    const release = () => {
      if (!press) return;
      const wasZoomed = press.zoomed;
      clearTimeout(press.timer);
      press = null; top = home[1];
      if (wasZoomed) look(home, 0);
      svg.classList.remove('zoomed');
      aim.setAttribute('hidden', '');
    };
    svg.addEventListener('pointerdown', e => {
      if (press || e.button) return;
      press = { id: e.pointerId, last: e, zoomed: false, timer: setTimeout(() => zoomIn(press.last), HOLD) };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (e.pointerId !== press?.id) return;
      press.last = e;
      if (press.zoomed) moveAim(e);
    });
    svg.addEventListener('pointerup', e => {
      if (e.pointerId !== press?.id) return;
      const { x, y } = at(e);  // read before the zoom is undone
      release();
      onHit({ ...scoreAt(x, y), x: +x.toFixed(1), y: +y.toFixed(1) });
    });
    svg.addEventListener('pointercancel', e => { if (e.pointerId === press?.id) release(); });
    svg.addEventListener('contextmenu', e => e.preventDefault());  // a long press is ours
  }

  return {
    // fly: show the last dart landing (a computer player's, see screens/game.js): a dart
    // comes in from in front of the board and its mark appears where it sticks.
    // Not for anyone who has asked their device for less movement.
    showDarts(darts, r = 5, fly = false, fresh = false) {
      marks.replaceChildren(...darts.filter(d => d.x != null).map((d, i) =>
        el('circle', { cx: d.x, cy: -d.y, r, class: 'b-mark' + (i === darts.length - 1 ? ' last' : '') })));
      const last = darts.at(-1), mark = marks.lastChild, still = matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (fresh && !fly && last?.x != null && !still) land(last);
      if (!fly || !mark || last?.x == null || !mark.animate || still) return;
      // Pro tungsten steel-tip dart drawn along +X from tip (0,0), angled down-right into the board.
      const at = el('g', { transform: `translate(${last.x} ${-last.y})` });
      const dart = el('g', { class: 'b-dart' });
      const body = el('g', { transform: 'rotate(50)' });
      body.append(
        // Tapered steel needle point
        el('path', { d: 'M0 0 L12 -1.1 L12 1.1 Z', class: 'point' }),
        // Tungsten barrel with machined grip rings and gold collar
        el('path', { d: 'M12 -2.2 L16 -3.3 L30 -3.0 L34 -1.9 L34 1.9 L30 3.0 L16 3.3 L12 2.2 Z', class: 'barrel' }),
        el('path', { d: 'M18 -3.1 V3.1 M21.5 -3.1 V3.1 M25 -3.0 V3.0', class: 'grip' }),
        el('path', { d: 'M14 -2.8 V2.8 M31 -2.3 V2.3', class: 'ring' }),
        // Slim black shaft
        el('path', { d: 'M34 -1.4 L47 -1.0 L47 1.0 L34 1.4 Z', class: 'shaft' }),
        // Angled 3D-style pro flights (top wing, bottom wing, center spine, accent stripe)
        el('path', { d: 'M43 -1.0 L48 -9.5 L61 -8.5 L63 -1.2 Z', class: 'flight' }),
        el('path', { d: 'M43 1.0 L48 9.5 L61 8.5 L63 1.2 Z', class: 'flight flight-lo' }),
        el('path', { d: 'M48 -5.5 L61 -5.0 M48 5.5 L61 5.0', class: 'stripe' }),
        el('path', { d: 'M43 0 L64 0', class: 'spine' }),
      );
      dart.append(body);
      at.append(dart);
      marks.append(at);
      mark.style.opacity = 0;
      const flown = dart.animate([
        { transform: 'translate(76px, 98px) scale(2.8)', opacity: 0 },
        { opacity: 1, offset: 0.28 },
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ], { duration: 400, easing: 'cubic-bezier(.42, 0, .82, .52)' });
      flown.onfinish = flown.oncancel = () => {
        mark.style.opacity = '';
        mark.animate?.([{ r: r * 2.2 }, { r }], { duration: 220, easing: 'ease-out' });  // the thud
        if (fresh) land(last);
        // Brief sisal-impact settle wobble, then fade cleanly to the dot mark.
        dart.animate([
          { transform: 'rotate(0deg)', opacity: 1 },
          { transform: 'rotate(-4deg)', opacity: 1, offset: 0.14 },
          { transform: 'rotate(2.5deg)', opacity: 1, offset: 0.28 },
          { transform: 'rotate(0deg)', opacity: 1, offset: 0.45 },
          { transform: 'rotate(0deg)', opacity: 0 },
        ], { duration: 680, fill: 'forwards' }).onfinish = () => at.remove();
      };
    },
    // Light up one bed {seg, mult} to aim at. With zoom (default, for Random Targets),
    // zooms in and dims the rest of the board; with zoom: false (X01 checkout hint),
    // pulses the recommended bed in place. When viewBox ([x, y, w]) is given (TV view
    // broadcast camera), glides to that framing instead of FULL.
    showTarget(t, { zoom = true, viewBox = null, glideMs = 360 } = {}) {
      const vb = viewBox ? viewBox.slice(0, 3) : null;
      const vbKey = vb ? vb.map(n => Math.round(n)).join(',') : '';
      const key = `${t ? `${t.seg}x${t.mult}${t.part ?? ''}` : ''}:${zoom ? 1 : 0}:${vbKey}`;
      if (key === aimed) return;
      aimed = key;
      svg.classList.toggle('aiming', !!t && zoom);
      if (!t) { aimAt.replaceChildren(); return glide(vb ?? FULL, glideMs); }
      const lit = d => el('path', { d, class: zoom ? 'b-target' : 'b-target b-hint', 'fill-rule': 'evenodd' });
      aimAt.replaceChildren(...bed(t).map(lit));
      if (!zoom) return glide(vb ?? FULL, glideMs);
      let at = [0, 0];  // the middle of the bed
      if (t.seg !== 25) {
        const i = SEGMENTS.indexOf(t.seg), [r0, r1] = rings(t).at(-1);
        at = pt((r0 + r1) / 2, i * 18).split(' ').map(Number);
      }
      // A window on the board round the bed, kept inside the board's own square.
      const W = 250, edge = v => Math.min(226 - W, Math.max(-226, v - W / 2));
      glide([edge(at[0]), edge(at[1]), W]);
    },
    // Turn the board into a heat map of where `points` ([x, y] in mm) landed:
    // the board takes the standard colours in every theme (see svg.heat in
    // style.css) and the heat lies over it, see-through where no darts landed.
    showHeat(points) {
      svg.classList.add('heat');
      marks.before(
        el('image', { href: heatPicture(points), x: -226, y: -226, width: 452, height: 452, class: 'b-heat' }));
    },
  };
}
