// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Stand-in for the page, enough for the Tournament screen to draw its bracket on and
// show its results moving: elements that keep what they are given, a new bracket each
// time the screen is drawn (the old one then off the page, as in a browser), and the
// browser's own pieces the screen asks for. Nothing moves by itself: frames() runs the
// animation frames asked for so far.
import { $app } from './app.mjs';

export class El {
  constructor(tag) {
    Object.assign(this, { tag, attrs: {}, children: [], textContent: '', style: {}, dataset: {}, isConnected: true,
      clientWidth: 1000, clientHeight: 600, scrollLeft: 0, scrollTop: 0 });
    this.classList = { add: c => { this.attrs.class = [...new Set([...(this.attrs.class ?? '').split(' ').filter(Boolean), c])].join(' '); } };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren() { this.children = []; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelector(sel) {
    const box = sel.match(/^\[data-box="([^"]+)"\]$/);
    return this.all().find(e => (box ? e.attrs['data-box'] === box[1] : e.tag === sel)) ?? null;
  }
  getTotalLength() { return 100; }
  getComputedTextLength() { return this.textContent.length * 8; }
}

// What is on the page now: the bracket's box and drawing, and the line under it. on: whether
// the screen finds them (a test that only wants the screen's answers leaves the page off, and
// nothing is drawn or played out). reduced: prefers-reduced-motion.
export const page = { on: false, box: null, svg: null, status: null, reduced: true };
// The matches of the bracket that are buttons, by what they are called.
export const buttons = () => page.svg.all().filter(e => e.attrs.role === 'button').map(e => e.attrs['aria-label']);
// The main button under the bracket: [its data-act, what it says].
export const mainButton = () => $app.innerHTML.match(/<button class="primary" data-act="([\w-]+)"[^>]*>([^<]+)</)?.slice(1) ?? null;

let html = '';
Object.defineProperty($app, 'innerHTML', {
  get: () => html,
  set(v) {
    html = v;
    if (page.svg) page.svg.isConnected = false;
    page.box = new El('div');
    page.box.closest = sel => (sel === '.going' && v.includes(' going"') ? page.box : null);
    page.svg = page.box.appendChild(new El('svg'));
    page.status = new El('p');
  },
});
$app.querySelector = sel => (!page.on ? null : sel === '.bracket' ? (html.includes('class="bracket"') ? page.box : null) : sel === '.tour-status' ? page.status : null);

let asked = [];
// Runs the frames asked for, as if `ms` had gone by since (enough, by default, for a result to get where it is going).
export function frames(ms = 5000) {
  const now = performance.now() + ms, run = asked;
  asked = [];
  for (const f of run) f(now);
  return run.length;
}
Object.assign(globalThis, {
  requestAnimationFrame: f => { asked.push(f); },
  ResizeObserver: class { observe() {} disconnect() {} },
  getComputedStyle: () => ({ getPropertyValue: () => '13px' }),
  matchMedia: () => ({ matches: page.reduced }),
});
Object.assign(globalThis.document, { createElementNS: (_, tag) => new El(tag), fonts: { status: 'loaded', ready: Promise.resolve() } });
