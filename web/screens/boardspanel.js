// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Settings → Players, darts and boards: the boards, under the players. A board belongs to
// the household, not to a player. One is on the wall, and every game started is played on
// it, so the stats can be seen board by board. Swapping boards is putting the new one up:
// from a date, the games since then move to it.

import { boards, data, esc, loadBoards } from '../app.js';
import { BOARD_MAX } from '../sync.js';
import { boardName, boardState, dayStart } from '../boards.js';
import { renderSettings } from './settings.js';

export const bench = {
  open: null,  // the id of the board whose card is open, or 'new' for the form of a new one
  ask: null,  // in that card: 'putup' or 'before', while it asks for a date
  error: null,  // why the last change was refused
  note: null,  // what the last change did
};

const day = ts => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const wallName = () => { const b = boards.find(o => o.down == null); return b ? boardName(b, boards) : ''; };

function form(b) {
  const now = new Date().getFullYear(), years = Array.from({ length: 16 }, (_, i) => now - i);
  if (b?.bought && !years.includes(b.bought)) years.push(b.bought);
  return `<div class="pform boardform">
    <div class="player-row"><input type="text" id="bbrand" value="${esc(b?.brand ?? '')}" placeholder="Brand" maxlength="${BOARD_MAX.brand}" aria-label="Brand">
      <input type="text" id="bmodel" value="${esc(b?.model ?? '')}" placeholder="Model" maxlength="${BOARD_MAX.model}" aria-label="Model"></div>
    <div class="picks"><label class="pick"><select class="plain" id="bbought" aria-label="Year bought">${[['Year bought', ''], ...years.map(y => [`Bought in ${y}`, y])].map(([t, v]) =>
      `<option value="${v}" ${v === (b?.bought ?? '') ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <input type="text" id="bnotes" value="${esc(b?.notes ?? '')}" placeholder="Notes, e.g. turned in March" maxlength="${BOARD_MAX.notes}" aria-label="Notes">
    ${bench.error ? `<p class="warn">${esc(bench.error)}</p>` : ''}
    <div class="row"><button class="primary" data-act="saveboard">${b ? 'Save' : 'Add'}</button>
      ${b ? '' : '<button class="ghost" data-act="closeboard">Cancel</button>'}</div></div>`;
}
// Asking for the day a board went up, or the day it was last played on.
function askDate(b) {
  const putup = bench.ask === 'putup', was = wallName();
  return `<div class="pform">
    <label class="dateask"><span>${putup ? 'It went up on' : 'Played on it until'}</span>
      <input type="date" id="bdate" value="${today()}" max="${today()}"></label>
    <p class="muted small">${putup
      ? `Games from that day on${was ? ` that were on ${esc(was)}` : ''} move to ${esc(boardName(b, boards))}.`
      : `Every game from before that day moves to ${esc(boardName(b, boards))}, whichever board it was on.`}</p>
    <div class="row"><button class="primary" data-act="${putup ? 'putup' : 'playedbefore'}" data-id="${esc(b.id)}">${putup ? 'Put it up' : 'Move those games'}</button>
      <button class="ghost" data-act="closeask">Cancel</button></div></div>`;
}
function body(b) {
  const wall = b.down == null, fresh = b.up == null && b.down === 0;
  return `<div class="who-body">
    ${form(b)}
    ${bench.note ? `<p class="muted small">${esc(bench.note)}</p>` : ''}
    ${bench.ask ? askDate(b) : wall ? '<p class="muted small">This is the board on the wall: every game started is played on it.</p>' : `<div class="row">
      <button data-act="askputup">Put on the wall</button>
      <button class="ghost" data-act="askbefore">Played on it before a date</button></div>`}
    ${fresh ? `<div class="who-end"><button class="ghost danger" data-act="removeboard" data-id="${esc(b.id)}">Remove this board</button></div>` : ''}
  </div>`;
}
export function boardsPanel() {
  if (bench.open !== 'new' && !boards.some(b => b.id === bench.open)) Object.assign(bench, { open: null, ask: null });
  const order = [...boards].sort((a, b) => (a.down == null ? -1 : b.down == null ? 1 : (b.up ?? b.down ?? 0) - (a.up ?? a.down ?? 0)));
  return `<div class="editplayers boards">
    <h3 class="sethead3">Boards</h3>
    <p class="muted small">The board on the wall is the one each new game is played on, so your stats can be seen board by board.</p>
    ${order.map(b => {
      const open = b.id === bench.open;
      return `<section class="who ${open ? 'open' : ''}">
        <button class="who-head" data-act="openboard" data-id="${esc(b.id)}" aria-expanded="${open}"><span><b>${esc(boardName(b, boards))}</b>
          <small>${esc(boardState(b, day))}</small></span><u>${open ? 'Done' : 'Edit'}</u></button>
        ${open ? body(b) : ''}</section>`;
    }).join('')}
    ${bench.open === 'new' ? form(null) : '<button class="chip ghost" data-act="newboard">+ Add a board</button>'}
  </div>`;
}

const typed = id => document.getElementById(id)?.value ?? '';
const fields = () => ({ brand: typed('bbrand'), model: typed('bmodel'), notes: typed('bnotes'), bought: typed('bbought') ? +typed('bbought') : null });
function done(fn) {
  try {
    const note = fn();
    loadBoards();
    Object.assign(bench, { error: null, note: note ?? null });
    data.sync();
  } catch (e) {
    bench.error = e.message;
  }
  renderSettings();
}
export function boardAct(act, id) {
  switch (act) {
    case 'openboard': Object.assign(bench, { open: bench.open === id ? null : id, ask: null, error: null, note: null }); return renderSettings();
    case 'newboard': Object.assign(bench, { open: 'new', ask: null, error: null, note: null }); renderSettings(); return document.getElementById('bbrand')?.focus();
    case 'closeboard': Object.assign(bench, { open: null, ask: null, error: null }); return renderSettings();
    case 'askputup': Object.assign(bench, { ask: 'putup', note: null }); return renderSettings();
    case 'askbefore': Object.assign(bench, { ask: 'before', note: null }); return renderSettings();
    case 'closeask': bench.ask = null; return renderSettings();
    case 'saveboard': return done(() => {
      if (bench.open === 'new') {
        // Added, its card opens asking when it went up: a new board is usually a swap.
        const b = data.addBoard(fields());
        Object.assign(bench, { open: b.id, ask: 'putup' });
        return null;
      }
      data.changeBoard(bench.open, fields());
      return 'Saved.';
    });
    case 'putup': return done(() => {
      const since = dayStart(typed('bdate'));
      data.putUp(id, since);
      bench.ask = null;
      return `Up on the wall from ${day(since ?? Date.now())}. Games since then are moved to it.`;
    });
    case 'playedbefore': return done(() => {
      const until = dayStart(typed('bdate'));
      if (until == null) throw new Error('pick the day it was last played on');
      data.playedBefore(id, until);
      bench.ask = null;
      return `Games from before ${day(until)} are moved to it.`;
    });
    case 'removeboard': return done(() => { data.removeBoard(id); bench.open = null; return null; });
  }
}
