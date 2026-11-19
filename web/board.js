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
  const aimAt = el('g', {}), marks = el('g', {});  // the bed to aim at (showTarget), under the darts
  svg.append(aimAt, marks);
  // What the board shows when nothing is being held: all of it, or the part
  // round a target. [left, top, width] of the viewBox.
  const FULL = [-226, -226, 452];
  let home = FULL, shown = FULL, moving = 0, aimed = '';
  const look = v => { shown = v; svg.setAttribute('viewBox', `${v[0].toFixed(1)} ${v[1].toFixed(1)} ${v[2].toFixed(1)} ${v[2].toFixed(1)}`); };
  const glide = to => {
    cancelAnimationFrame(moving);
    home = to;
    const from = shown, t0 = performance.now(), MS = 450;
    if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return look(to);
    const step = now => {
      const k = Math.min(1, (now - t0) / MS), e = 1 - (1 - k) ** 3;  // ease out
      look(from.map((v, i) => v + (to[i] - v) * e));
      if (k < 1) moving = requestAnimationFrame(step);
    };
    moving = requestAnimationFrame(step);
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
      cancelAnimationFrame(moving);
      look(home);
      const p = at(e), w = home[2] / ZOOM;
      // the spot under the finger stays under the finger
      const x0 = p.x - (p.x - home[0]) / ZOOM, y0 = -p.y - (-p.y - home[1]) / ZOOM;
      svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${w}`);
      svg.classList.add('zoomed');
      press.zoomed = true; top = y0;
      aim.removeAttribute('hidden');
      moveAim(e);
    };
    const release = () => {
      if (!press) return;
      clearTimeout(press.timer);
      press = null; top = home[1];
      look(home);
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
    showDarts(darts, r = 5) {
      marks.replaceChildren(...darts.filter(d => d.x != null).map((d, i) =>
        el('circle', { cx: d.x, cy: -d.y, r, class: 'b-mark' + (i === darts.length - 1 ? ' last' : '') })));
    },
    // Light up one bed {seg, mult} to aim at and zoom in on it, the rest of the
    // board dimmed; null puts the board back. Taps still score as usual.
    showTarget(t) {
      const key = t ? `${t.seg}x${t.mult}` : '';
      if (key === aimed) return;
      aimed = key;
      svg.classList.toggle('aiming', !!t);
      if (!t) { aimAt.replaceChildren(); return glide(FULL); }
      const lit = d => el('path', { d, class: 'b-target', 'fill-rule': 'evenodd' });
      const disc = r => `M0 ${-r}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${-r}Z`;
      let at = [0, 0];  // the middle of the bed
      if (t.seg === 25) {
        aimAt.replaceChildren(lit(t.mult === 2 ? disc(R.bull) : disc(R.outer) + disc(R.bull)));
      } else {
        const i = SEGMENTS.indexOf(t.seg), a0 = i * 18 - 9, a1 = a0 + 18;
        const rings = t.mult === 3 ? [[R.tIn, R.tOut]] : t.mult === 2 ? [[R.dIn, R.dOut]] : [[R.outer, R.tIn], [R.tOut, R.dIn]];
        aimAt.replaceChildren(...rings.map(([r0, r1]) => lit(wedge(r0, r1, a0, a1))));
        const [r0, r1] = rings.at(-1);
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
