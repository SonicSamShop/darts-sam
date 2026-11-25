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
      clientWidth: 1000, clientHeight: 600, scrollWidth: 1000, scrollLeft: 0, scrollTop: 0 });
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
// body: what the screen scrolls in (.tour-body), new with each drawing and at its top, as in a
// browser. shown: what the screen's row of buttons was last asked to scroll into view with, since
// the screen was last drawn (null: it was not asked). listShown: the same for the heading of the list of past tournaments.
export const page = { on: false, box: null, svg: null, status: null, body: null, row: null, shown: null, list: null, listShown: null, reduced: true };
// The matches of the bracket that are buttons, by what they are called.
export const buttons = () => page.svg.all().filter(e => e.attrs.role === 'button').map(e => e.attrs['aria-label']);
// The main button under the bracket: [its data-act, what it says].
export const mainButton = () => $app.innerHTML.match(/<button class="primary" data-act="([\w-]+)"[^>]*>([^<]+)</)?.slice(1) ?? null;
// What the screen says, without its markup: every run of blank space one space.
export const text = (h = $app.innerHTML) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// Every button of the screen that does something: [its data-act, what it says].
export const acts = () => [...$app.innerHTML.matchAll(/<button[^>]*data-act="([\w-]+)"[^>]*>(.*?)<\/button>/gs)].map(m => [m[1], text(m[2])]);
// The lines under "Past tournaments": [the tournament's id, what the line says].
export const pastLines = () => [...$app.innerHTML.matchAll(/<button[^>]*data-act="tour-open" data-id="([\w-]+)"[^>]*>(.*?)<\/button>/gs)].map(m => [m[1], text(m[2])]);

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
    page.body = new El('div');
    page.row = new El('div');
    page.shown = null;
    page.row.scrollIntoView = how => { page.shown = how ?? {}; };
    page.list = new El('h3');
    page.listShown = null;
    page.list.scrollIntoView = how => { page.listShown = how ?? {}; };
  },
});
const found = { '.tour-status': () => page.status, '.tour-body': () => page.body, '.tour-buttons': () => (html.includes('tour-buttons') ? page.row : null),
  '.tour-pasthead': () => (html.includes('tour-pasthead') ? page.list : null) };
$app.querySelector = sel => (!page.on ? null : sel === '.bracket' ? (html.includes('class="bracket"') ? page.box : null) : found[sel]?.() ?? null);

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
