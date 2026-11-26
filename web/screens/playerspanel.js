// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Settings → Players and darts: a card for each player (their name, their sets
// of darts, removing them), and the box for a new player, which the menu has too.

import {
  COUNTRIES, MAX_PLAYERS, cleanSetup, data, esc, flagCode, flagHtml, grams, loadPlayers, nameOf, players, saveSetup, screen, setDarts,
  setPlayerFlag, setsOf, setup, store
} from '../app.js';
import { DARTS_DETAILS } from '../sync.js';
import { stillIn } from '../tournament.js';
import { renderHome } from './home.js';
import { renderSettings } from './settings.js';

export const roster = {
  formError: '',  // shown under the "new player" box
  adding: false,  // home: the "new player" box is out of sight until asked for
  draftName: '',  // kept if adding is refused (e.g. country not picked yet)
  draftFlag: '',
  removeArmed: false,  // the id of the player whose Remove has been tapped once
  renameFailed: null,  // the id of the player whose new name was refused (formError says why)
  refused: null,  // the id of the player whose Remove was refused (formError says why)
  open: null,  // the id of the player whose card is open
  dartsForm: null,  // in that card: the id of the set being changed, 'new' for one being added, or null
  dartsError: null,  // {at: a set's id or a player's id (adding), text}
};

// The choices of each detail of a set, as the form and the card say them.
const CHOICES = {
  tungsten: [['Tungsten', ''], ...DARTS_DETAILS.tungsten.map(t => [`${t}%`, t])],
  shape: [['Barrel shape', ''], ['Straight', 'straight'], ['Torpedo', 'torpedo'], ['Bomb', 'bomb'], ['Scalloped', 'scalloped'], ['Other', 'other']],
  grip: [['Grip', ''], ['Smooth', 'smooth'], ['Light grip', 'light'], ['Medium grip', 'medium'], ['Heavy grip', 'heavy']],
  shaft: [['Shaft', ''], ['Short shaft', 'short'], ['In-between shaft', 'inbetween'], ['Medium shaft', 'medium'], ['Long shaft', 'long']],
  flight: [['Flight', ''], ['Standard flight', 'standard'], ['Slim flight', 'slim'], ['Kite flight', 'kite'], ['Pear flight', 'pear'],
    ['Small flight', 'small'], ['Other flight', 'other']],
};
const PICKED = ['tungsten', 'shape', 'grip', 'shaft', 'flight'];
const choiceText = (key, v) => CHOICES[key].find(([, value]) => value === v)?.[0] ?? '';
// What a set's details say, in one short line: "Target · 95% · Straight · Medium grip".
export const detailsLine = d => d?.details
  ? [d.details.brand, ...PICKED.map(k => d.details[k] != null && choiceText(k, d.details[k]))].filter(Boolean).join(' · ') : '';

export function newPlayerRow() {
  return `<div class="player-row newplayer-row"><input type="text" id="newplayer" placeholder="New player name" maxlength="16" value="${esc(roster.draftName)}">
    <select class="plain" id="newplayer-flag" aria-label="Country">
      <option value="">Country…</option>
      ${COUNTRIES.map(([code, flag, name]) => `<option value="${code}" ${code === roster.draftFlag ? 'selected' : ''}>${flag} ${name}</option>`).join('')}
    </select>
    <button data-act="addplayer">Add</button></div>
    ${roster.formError && roster.renameFailed == null && roster.refused == null ? `<p class="warn">${esc(roster.formError)}</p>` : ''}`;
}
export function addPlayer() {
  const input = document.getElementById('newplayer');
  const flagEl = document.getElementById('newplayer-flag');
  roster.renameFailed = roster.refused = null;
  const name = input.value.trim();
  const flag = flagEl?.value ?? '';
  roster.draftName = name;
  roster.draftFlag = flag;
  if (!name) return input.focus();
  if (!flag) {
    roster.formError = 'Pick a country.';
    if (screen === 'settings') renderSettings(); else renderHome();
    document.getElementById('newplayer-flag')?.focus();
    return;
  }
  try {
    const p = data.addPlayer(name);
    loadPlayers();
    setPlayerFlag(p.id, flag);
    roster.formError = '';
    roster.draftName = '';
    roster.draftFlag = '';
    roster.adding = false;
    // Added on the menu, they are playing; added in the settings, they are only on the list
    // and their card opens, ready for their darts.
    if (screen === 'home' && setup.players.length < MAX_PLAYERS) { setup.players.push(p.id); saveSetup(); }
    if (screen === 'settings') { roster.open = p.id; roster.dartsForm = null; }
    data.sync();
  } catch (e) {
    roster.formError = e.message;
  }
  if (screen === 'settings') return renderSettings();
  renderHome();
}

// The settings' Players tab: a card for each player, saying who they are and what they throw.
// One card opens at a time, and everything about that player is in it: their name, their
// sets of darts (to name, weigh, put away and bring back) and removing them. A new player
// goes underneath.
export function playersPanel() {
  if (!players.some(p => p.id === roster.open)) roster.open = roster.dartsForm = null;
  const said = d => `${esc(d.name)}${d.grams != null ? ` ${grams(d.grams)}` : ''}`;
  // A set's name and weight, to fill in: a new set (d not given) or one being changed. The rest
  // of what can be said about it is folded away under "More details", open if any is given.
  const pick = (key, det) => `<label class="pick"><select class="plain" id="d${key}" aria-label="${CHOICES[key][0][0]}">${CHOICES[key].map(([text, v]) =>
    `<option value="${v}" ${v === (det[key] ?? '') ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
  const form = (p, d, det = d?.details ?? {}) => `<div class="pform">
      <div class="player-row"><input type="text" id="dname" value="${esc(d?.name ?? '')}" placeholder="Name, e.g. Red tungsten" maxlength="24" aria-label="Name of the darts">
        <input type="number" inputmode="decimal" id="dgrams" value="${d?.grams ?? ''}" min="1" max="100" step="0.5" placeholder="Grams" aria-label="Weight in grams"></div>
      <details class="dmore" ${d?.details ? 'open' : ''}><summary>More details</summary>
        <input type="text" id="dbrand" value="${esc(det.brand ?? '')}" placeholder="Brand" maxlength="${DARTS_DETAILS.brand}" aria-label="Brand">
        <div class="picks">${PICKED.map(k => pick(k, det)).join('')}</div>
        <input type="text" id="dnotes" value="${esc(det.notes ?? '')}" placeholder="Notes, e.g. new points in March" maxlength="${DARTS_DETAILS.notes}" aria-label="Notes">
      </details>
      ${roster.dartsError?.at === (d?.id ?? p.id) ? `<p class="warn">${esc(roster.dartsError.text)}</p>` : ''}
      <div class="row"><button class="primary" data-act="${d ? 'savedarts' : 'adddarts'}" data-id="${d ? esc(d.id) : p.id}">${d ? 'Save' : 'Add'}</button>
        ${d ? `<button data-act="retiredarts" data-id="${esc(d.id)}" data-retired="${d.retired ? 'no' : 'yes'}">${d.retired ? 'Bring back' : 'Put away'}</button>` : ''}
        <button class="ghost" data-act="closedarts">Cancel</button></div>
      ${d && !d.retired ? '<p class="muted small">Put away darts you no longer throw: they leave the Play screen, and their stats are kept.</p>' : ''}</div>`;
  const body = p => {
    const sets = setsOf(p.id, true).sort((a, b) => a.retired - b.retired);
    return `<div class="who-body">
      <h3>Name</h3>
      <div class="player-row"><input type="text" id="pname" data-rename="${p.id}" value="${esc(p.name)}" maxlength="16" aria-label="Name of ${esc(p.name)}">
        <button data-act="rename" data-id="${p.id}">Save</button></div>
      ${roster.formError && roster.renameFailed === p.id ? `<p class="warn">${esc(roster.formError)}</p>` : ''}
      <h3>Country flag</h3>
      <select class="plain" data-flag="${p.id}" aria-label="Country flag for ${esc(p.name)}">
        <option value="">None</option>
        ${COUNTRIES.map(([code, flag, name]) => `<option value="${code}" ${code === flagCode(p.id) ? 'selected' : ''}>${flag} ${name}</option>`).join('')}
      </select>
      <h3>Darts</h3>
      ${sets.length || roster.dartsForm === 'new' ? '' : '<p class="muted small">Add the darts they throw to see stats for each set.</p>'}
      ${sets.map(d => roster.dartsForm === d.id ? form(p, d) : `<button class="pline ${d.retired ? 'away' : ''}" data-act="editdarts" data-id="${esc(d.id)}">
        <span>${said(d)}${d.retired ? ' <small>· put away</small>' : ''}${detailsLine(d) ? `<small class="dline">${esc(detailsLine(d))}</small>` : ''}</span><u>Change</u></button>`).join('')}
      ${roster.dartsForm === 'new' ? form(p) : '<button class="chip ghost" data-act="newdarts">+ Add darts</button>'}
      <div class="who-end"><button class="ghost danger" data-act="remove" data-id="${p.id}">${roster.removeArmed === p.id ? 'Tap again to remove' : `Remove ${esc(p.name)}`}</button>
        ${roster.removeArmed === p.id ? '<p class="muted small">They leave the lists. Their throws are kept, and adding the same name again brings them back.</p>' : ''}
        ${roster.formError && roster.refused === p.id ? `<p class="warn">${esc(roster.formError)}</p>` : ''}</div>
    </div>`;
  };
  return `<div class="editplayers">
      ${players.map(p => {
        const open = p.id === roster.open;
        return `<section class="who ${open ? 'open' : ''}">
          <button class="who-head" data-act="openplayer" data-id="${p.id}" aria-expanded="${open}"><span><b>${flagHtml(p.id)}${esc(p.name)}</b>
            <small>${setsOf(p.id).map(said).join(' · ') || 'No darts added'}</small></span><u>${open ? 'Done' : 'Edit'}</u></button>
          ${open ? body(p) : ''}</section>`;
      }).join('')}
      ${roster.adding || !players.length ? newPlayerRow() : '<button class="chip ghost" data-act="newplayer">+ Add a player</button>'}
    </div>`;
}
export function renamePlayer(id) {
  const name = document.querySelector(`[data-rename="${id}"]`).value.trim();
  if (!name || name === nameOf(id)) return;
  roster.refused = null;
  try {
    data.renamePlayer(id, name);
    loadPlayers();
    roster.formError = '';
    roster.renameFailed = null;
    data.sync();
  } catch (e) {
    roster.formError = e.message;
    roster.renameFailed = id;
  }
  renderSettings();
}
// Remove, tapped: once to ask, again to do it. Not for someone still in a tournament that is
// going, though (knocked out or not): the app drops a removed player from its lists, and the
// tournament could no longer be played or saved. Said under their Remove, before anything is asked.
export function removePlayer(id) {
  const cup = stillIn(data.tournaments(), id);
  if (cup) {
    roster.removeArmed = false;
    roster.renameFailed = null;
    roster.refused = id;
    roster.formError = `${nameOf(id)} is still in ${cup.name}. Finish or abandon it first.`;
    return renderSettings();
  }
  if (roster.refused != null) { roster.refused = null; roster.formError = ''; }  // (refused a moment ago, and over since)
  if (roster.removeArmed !== id) { roster.removeArmed = id; return renderSettings(); }
  roster.removeArmed = false;
  data.removePlayer(id);
  loadPlayers();
  cleanSetup();
  saveSetup();
  roster.formError = '';
  renderSettings();
}
// A set of darts in the open card: added, changed, put away or brought back. Done, its form closes;
// refused (a name already taken, a weight no dart has), the form stays and says why.
const gramsIn = el => el?.value.trim() ? +el.value : null;
function dartsDone(fn, at) {
  try { fn(); setDarts(store.get('darts', [])); roster.dartsError = null; roster.dartsForm = null; data.sync(); } catch (e) { roster.dartsError = { at, text: e.message }; }
  renderSettings();
}
const typed = id => document.getElementById(id)?.value ?? '';
const dartsTyped = () => ({
  name: typed('dname').trim(), grams: gramsIn(document.getElementById('dgrams')),
  details: {
    brand: typed('dbrand'), notes: typed('dnotes'),
    ...Object.fromEntries(PICKED.map(k => [k, k === 'tungsten' && typed('dtungsten') ? +typed('dtungsten') : typed(`d${k}`)])),
  },
});
export function addDarts(player) {
  const { name, grams, details } = dartsTyped();
  if (!name) return document.getElementById('dname').focus();
  dartsDone(() => {
    const first = setsOf(player).length === 0, d = data.addDarts(player, name, grams, details);
    // Their first set: what they are throwing from now on.
    if (first) { setup.darts = { ...setup.darts, [player]: d.id }; saveSetup(); }
  }, player);
}
export const saveDarts = id => dartsDone(() => data.changeDarts(id, dartsTyped()), id);
export const changeDarts = (id, changes) => dartsDone(() => data.changeDarts(id, changes), id);
