// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// TV broadcast camera framing for X01 in TV view:
// - Scoring / 20s: frames the top of the board (12 / 5 / 20 / 1 / 18) down to the bull.
// - Other trebles / setup beds: frames the target segment with 1 number either side.
// - Doubles: zooms in tightly on the double bed with 1 number either side.
// - Bullseye: zooms in tightly on the bull.

import { SEGMENTS } from './board.js';

export const FULL_VIEW = [-226, -226, 452, 452];
export const TOP_20_VIEW = [-127, -226, 254, 254];

// Adjacent segment numbers [left, center, right] around `seg`.
export function neighborsOf(seg) {
  const i = SEGMENTS.indexOf(seg);
  if (i < 0) return [];
  return [SEGMENTS[(i + 19) % 20], seg, SEGMENTS[(i + 1) % 20]];
}

function polarToSvg(r, deg) {
  const rad = deg * Math.PI / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)];
}

function squareBox(cx, cy, w, clamp = true) {
  let x = cx - w / 2, y = cy - w / 2;
  if (clamp) {
    x = Math.min(230 - w, Math.max(-230, x));
    y = Math.min(230 - w, Math.max(-230, y));
  }
  return [x, y, w, w];
}

// Compute the TV camera viewBox and label for a target bed { seg, mult }.
export function cameraForBed(bed, { tightness = 'broadcast' } = {}) {
  const tight = tightness === 'tight';
  if (!bed) {
    return {
      viewBox: TOP_20_VIEW,
      mode: 'scoring',
      camTag: 'Top 20s',
      subtitle: '12 · 5 · 20 · 1 · 18',
      target: { seg: 20, mult: 3 },
      neighbors: [12, 5, 20, 1, 18],
    };
  }

  if (bed.seg === 25) {
    const w = tight ? 92 : 108;
    return {
      viewBox: squareBox(0, 0, w, false),
      mode: 'bull',
      camTag: bed.mult === 2 ? 'Bullseye' : 'Outer Bull',
      subtitle: '',
      target: bed,
      neighbors: [],
    };
  }

  const idx = SEGMENTS.indexOf(bed.seg);
  if (idx < 0) {
    return { viewBox: FULL_VIEW, mode: 'full', camTag: 'Full board', subtitle: '', target: null, neighbors: [] };
  }

  const deg = idx * 18;
  const nbrs = neighborsOf(bed.seg);

  if (bed.mult === 2) {
    const w = tight ? 148 : 172;
    const [cx, cy] = polarToSvg(154, deg);
    return {
      viewBox: squareBox(cx, cy, w),
      mode: 'double',
      camTag: `Double ${bed.seg}`,
      subtitle: nbrs.join(' · '),
      target: bed,
      neighbors: nbrs,
    };
  }

  if (bed.seg === 20) {
    const w = tight ? 232 : 254;
    return {
      viewBox: [-w / 2, -226, w, w],
      mode: 'scoring',
      camTag: 'Top 20s',
      subtitle: '12 · 5 · 20 · 1 · 18',
      target: bed,
      neighbors: [12, 5, 20, 1, 18],
    };
  }

  const w = tight ? 190 : 214;
  const [cx, cy] = polarToSvg(bed.mult === 3 ? 118 : 136, deg);
  return {
    viewBox: squareBox(cx, cy, w),
    mode: bed.mult === 3 ? 'treble' : 'setup',
    camTag: `${bed.mult === 3 ? 'Treble' : 'Single'} ${bed.seg}`,
    subtitle: nbrs.join(' · '),
    target: bed,
    neighbors: nbrs,
  };
}

// Decide the TV camera shot for a remaining score and optional checkout route.
export function tvCameraFor(score, route = null, { opened = true, tightness = 'broadcast' } = {}) {
  if (!opened) return cameraForBed({ seg: 20, mult: 2 }, { tightness });
  if (score <= 0) return { viewBox: FULL_VIEW, mode: 'full', camTag: 'Full board', subtitle: '', target: null, neighbors: [] };
  const nextBed = route?.[0] ?? { seg: 20, mult: 3 };
  return cameraForBed(nextBed, { tightness });
}

// Whether a landed dart at board coordinates (x, y, +y up) sits inside viewBox
// (only returning false if out of shot or very close to the edge).
export function pointInView(x, y, viewBox, margin = 6) {
  if (x == null || y == null || !viewBox) return true;
  const [vx, vy, vw, vh = vw] = viewBox;
  const sx = x, sy = -y;
  return sx >= vx + margin && sx <= vx + vw - margin && sy >= vy + margin && sy <= vy + vh - margin;
}

// Whether a dart (with x/y, or just {seg, mult} from voice input) is inside viewBox.
export function dartInView(d, viewBox, margin = 6) {
  if (!d || !viewBox) return true;
  if (d.x != null && d.y != null) return pointInView(d.x, d.y, viewBox, margin);
  if (!d.mult) return true;
  if (d.seg === 25) return pointInView(0, 0, viewBox, margin);
  const idx = SEGMENTS.indexOf(d.seg);
  if (idx < 0) return true;
  const r = d.mult === 3 ? 103 : d.mult === 2 ? 166 : 134.5;
  const [sx, sy] = polarToSvg(r, idx * 18);
  return pointInView(sx, -sy, viewBox, margin);
}

// Camera shot focused on where a dart just landed (e.g. a switch to T19 or a stray lower bed).
export function cameraForDart(d, { tightness = 'broadcast' } = {}) {
  if (!d) return cameraForBed(null, { tightness });
  if (d.mult > 0) return cameraForBed({ seg: d.seg, mult: d.mult }, { tightness });
  const w = tightness === 'tight' ? 148 : 172;
  return {
    viewBox: squareBox(d.x ?? 0, -(d.y ?? 0), w),
    mode: 'dart',
    camTag: 'Miss',
    subtitle: '',
    target: null,
    neighbors: [],
  };
}
