// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The Settings screen: its sections as tabs on a computer, as a list on a phone
// (each section opening by itself), and both side by side on a tablet on its side.
// Theme and In game are drawn here; the other sections have modules of their own.

import { share, sharePanel } from './sharing.js';
import { accountPanel, feedbackBox } from './accountpanel.js';
import { renderLanding } from './landing.js';
import { playersPanel } from './playerspanel.js';
import {
  $app, THEMES, account, applyTheme, depth, esc, fit, icon, mark, pageFoot, pageHead, players, refreshStatus,
  saveSettings, screen, setScreen, settings, store, voice
} from '../app.js';
import { BOT_HOLD_MAX, BOT_HOLD_USUAL, botHoldSecs, flashOn } from './game.js';
import { achievementsOn, photosOn } from './earned.js';
import { aboutPanel, appRelease } from './release.js';
import { BOARD_MAX, cleanBoard } from '../sync.js';

// A phone or a tablet (anything held upright, narrow or worked by touch), as style.css has it:
// tabs along the bottom, and the settings as a list that opens a section at a time instead of tabs.
const STACKED = matchMedia('(orientation: portrait), (max-width: 800px), (pointer: coarse)');
// A tablet on its side has the room for both: the list down the left, the section beside it.
const SPLIT = matchMedia('(pointer: coarse) and (orientation: landscape) and (min-width: 900px)');
export const listShown = () => STACKED.matches && (SPLIT.matches || !settingsView.open);  // is the settings' list on screen?
export const sectShown = id => settingsView.tab === id && (!STACKED.matches || SPLIT.matches || settingsView.open);  // and this section of them?

// How long the computer waits after a person's visit before it throws: a drop-down of seconds.
function botHoldPicker() {
  const now = botHoldSecs();
  return `<div class="picks"><label class="pick"><span>Bot waits before it throws</span><select data-bothold>
      ${Array.from({ length: BOT_HOLD_MAX + 1 }, (_, n) =>
    `<option value="${n}" ${n === now ? 'selected' : ''}>${n ? `${n} second${n > 1 ? 's' : ''}` : 'No wait'}${n === BOT_HOLD_USUAL ? ' Default' : ''}</option>`).join('')}</select></label></div>
    <p class="muted small">Against the computer, the time you have after your visit to undo a wrongly scored dart before it throws.</p>`;
}
// Voices can be listed a moment after the page loads: show them once they are.
globalThis.speechSynthesis?.addEventListener?.('voiceschanged', () => { if (screen === 'settings') renderSettings(); });

// Which voice calls the scores: the device's voices to choose from, or a word
// on why it is quiet where the device has none.
function voicePicker() {
  if (voice.none()) return `<p class="muted small">This device has no voices of its own, so scores are not called aloud. Voices can be added in your device's speech settings.</p>`;
  const names = voice.voices();
  if (!names.length) return '';
  const chosen = store.get('voiceName', '');
  return `<div class="picks"><label class="pick"><span>Voice</span><select data-voicename>
      <option value="" ${chosen ? '' : 'selected'}>Best available (${esc(names[0])})</option>
      ${names.map(n => `<option value="${esc(n)}" ${n === chosen ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
    <p class="muted small">Missing a voice? Natural-sounding ones can be added in your device's speech settings.</p>`;
}

// ---------- settings ----------
// The settings are a handful of sections (SECTIONS below), all drawn every time;
// style.css shows what belongs (as with the app's four places, see nav()):
//  - on a computer, a row of tabs with one section on screen at a time;
//  - on a phone, a list of the sections, each line saying how it is set. A tap
//    opens that section by itself, with a way back to the list above it;
//  - on a tablet on its side, the list down the left and the section beside it.
// Every section is made of the same few parts: a line that opens something
// (setRow), a switch for on or off (switchRow) and one of several to choose
// (pickRow), each a whole line to tap.
export const settingsView = {
  tab: '',  // the section on screen; '' until opened, then the first
  open: false,  // on a phone: a section is open, not the list
  fromList: false,  // and it was opened from the list, which is the history entry under this one
};
const chevron = icon('<path d="M9 5l7 7-7 7"/>'), tickMark = icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
const setRow = (id, name, value) => `<button class="srow ${settingsView.tab === id ? 'cur' : ''}" data-sopen="${id}">
    <span><b>${name}</b>${value ? `<small>${value}</small>` : ''}</span><u>${chevron}</u></button>`;
// attr: what a tap does (the data- attribute read by the click handler), written for the way it is not now.
export const switchRow = (name, on, attr, hint = '') => `<button class="srow switchrow" role="switch" aria-checked="${on}" ${attr}>
    <span><b>${name}</b>${hint ? `<small>${hint}</small>` : ''}</span><i class="switch"></i></button>`;
const pickRow = (name, on, attr, hint = '') => `<button class="srow pickrow ${on ? 'on' : ''}" role="radio" aria-checked="${on}" ${attr}>
    <span><b>${name}</b>${hint ? `<small>${hint}</small>` : ''}</span><u>${on ? tickMark : ''}</u></button>`;
const canFeedBack = () => account.hosted ? !!account.account : !!share?.on;
// jump: open the section asked for, for someone sent to it from elsewhere.
export function renderSettings(jump) {
  if (account.locked) return renderLanding();
  if (jump) { settingsView.open = true; settingsView.fromList = false; }
  const was = screen === 'settings' ? document.querySelector('.setbody') : null;
  setScreen('settings');
  const theme = applyTheme();
  const look = `<div class="settings"><div class="rows" role="radiogroup" aria-label="Theme">${THEMES.map(t =>
    pickRow(t.name, t.id === theme.id, `data-theme="${t.id}"`, t.blurb)).join('')}</div></div>`;
  const hints = settings.checkouts !== false;
  const game = `<div class="settings"><div class="rows">
    ${switchRow('Sound', settings.voice, `data-voice="${settings.voice ? 'off' : 'on'}"`, 'Calls each visit\'s total, busts, what you require and game shot.')}
    ${settings.voice ? `${switchRow('Call each dart', !!settings.eachDart, `data-eachdart="${settings.eachDart ? 'off' : 'on'}"`, 'Say every dart as it lands too, not just the total. Cricket, Killer and the practice games call each dart anyway.')}
    ${voicePicker()}` : ''}
    ${switchRow('Show each visit\'s score large', flashOn(), `data-visitflash="${flashOn() ? 'off' : 'on'}"`, 'For a couple of seconds after a visit, what it scored takes over the scores, for when the voice can\'t be heard.')}
    ${switchRow('Checkout hints', hints, `data-checkouts="${hints ? 'off' : 'on'}"`, 'Switch off to practise working out your finishes yourself.')}
    ${switchRow('Show achievements as they are earned', achievementsOn(), `data-achievements="${achievementsOn() ? 'off' : 'on'}"`, 'A first 180, a big finish and the like are shown, and called, as they happen. Off, they are still kept on the Stats page.')}
    ${switchRow('Keep a picture of the board with an achievement', photosOn() === true, `data-photos="${photosOn() === true ? 'off' : 'on'}"`, 'When a camera scores the dart that earns one. Kept with your games and nowhere else, and deleted with the game.')}
    ${switchRow('Show the bot\'s darts landing', settings.flight !== false, `data-flight="${settings.flight !== false ? 'off' : 'on'}"`, 'Against the computer, each of its darts flies in to where it lands on the board.')}
    ${botHoldPicker()}
    </div></div>`;
  // [id, its name, its name on a tab, how it is set (the list says), the section]: in the list's groups
  const groups = [
    account.hosted && account.account ? [['acct', 'Account', 'Account', esc(account.account.nickname ?? ''), accountPanel()]] : [],
    [['players', 'Players and darts', 'Players', esc(players.map(p => p.name).join(', ')) || 'Nobody yet', playersPanel()],
      ['board', 'Your board', 'Board', esc(boardName(settings.board)) || 'Not added', boardPanel()]],
    [['look', 'Theme', 'Theme', theme.name, look],
      ['game', 'In game', 'In game', `${settings.voice && !voice.none() ? `Sound on${settings.eachDart ? ', each dart' : ''}` : 'Sound off'} · ${hints ? 'checkout hints on' : 'checkout hints off'}`, game]],
    [...(!account.hosted && share ? [['share', 'Sharing', 'Sharing', share.on ? 'On' : 'Off', sharePanel()]] : []),
      ...(canFeedBack() ? [['feedback', 'Send feedback', 'Feedback', '', `<div class="settings">${feedbackBox()}</div>`]] : []),
      ['about', 'About', 'About', appRelease() && `Version ${esc(appRelease())}`, aboutPanel()]],
  ].filter(g => g.length);
  const tabs = groups.flat();
  if (settingsView.tab === 'darts') settingsView.tab = 'players';  // once a tab of their own
  if (settingsView.tab === 'sound' || settingsView.tab === 'play') settingsView.tab = 'game';  // and these two, one each
  if (!tabs.some(t => t[0] === settingsView.tab)) { settingsView.tab = tabs[0][0]; settingsView.open = false; }
  const view = settingsView.open ? settingsView.tab : '';
  $app.innerHTML = `<div class="page setpage ${settingsView.open ? 'insect' : 'atlist'}">
    ${pageHead('settings')}
    <div class="row tabs stabs">${tabs.map(([id, , name]) =>
      `<button class="${settingsView.tab === id ? 'on' : ''}" data-stab="${id}">${name}</button>`).join('')}</div>
    <div class="sethead"><button class="ghost sback" data-act="sback">${icon('<path d="M15 5l-7 7 7 7"/>')}Settings</button></div>
    <div class="fill setbody" data-view="${view}">
      <nav class="setlist" aria-label="Settings">${groups.map(g =>
        `<div class="rows">${g.map(([id, name, , value]) => setRow(id, name, value)).join('')}</div>`).join('')}</nav>
      <div class="setsects">${tabs.map(([id, name, , , html]) =>
        `<section class="sect ${settingsView.tab === id ? 'on' : ''}"><h2>${name}</h2>${html}</section>`).join('')}</div>
    </div>
    ${pageFoot('settings')}
  </div>`;
  if (was?.dataset.view === view) document.querySelector('.setbody').scrollTop = was.scrollTop;  // a tap redraws: stay where it was
  refreshStatus();
  fit();
}
// ---------- your board ----------
// What the board the household plays on is: kept with the settings, for looking back on (when it
// was bought, when it was turned). It changes nothing in the games or the stats.
const boardForm = { note: '', warn: false };  // said beside Save: saved, or why not
const boardName = b => [b?.brand, b?.model].filter(Boolean).join(' ');
function boardPanel() {
  const b = settings.board ?? {}, now = new Date().getFullYear();
  const years = Array.from({ length: 16 }, (_, i) => now - i);
  if (b.bought && !years.includes(b.bought)) years.push(b.bought);
  return `<div class="settings boardform">
    <p class="muted small">The board you play on, for you to look back on. It changes nothing in the games or the stats.</p>
    <div class="player-row"><input type="text" id="bbrand" value="${esc(b.brand ?? '')}" placeholder="Brand" maxlength="${BOARD_MAX.brand}" aria-label="Brand">
      <input type="text" id="bmodel" value="${esc(b.model ?? '')}" placeholder="Model" maxlength="${BOARD_MAX.model}" aria-label="Model"></div>
    <div class="picks"><label class="pick"><select class="plain" id="bbought" aria-label="Year bought">${[['Year bought', ''], ...years.map(y => [`Bought in ${y}`, y])].map(([t, v]) =>
      `<option value="${v}" ${v === (b.bought ?? '') ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <input type="text" id="bnotes" value="${esc(b.notes ?? '')}" placeholder="Notes, e.g. turned in March" maxlength="${BOARD_MAX.notes}" aria-label="Notes">
    <div class="row"><button class="primary" data-act="saveboard">Save</button>${boardForm.note ? `<span class="${boardForm.warn ? 'warn' : 'muted'}">${esc(boardForm.note)}</span>` : ''}</div></div>`;
}
export function saveBoard() {
  const typed = id => document.getElementById(id)?.value ?? '';
  try {
    const b = cleanBoard({ brand: typed('bbrand'), model: typed('bmodel'), notes: typed('bnotes'), bought: typed('bbought') ? +typed('bbought') : null });
    if (b) settings.board = b; else delete settings.board;
    saveSettings();
    Object.assign(boardForm, { note: 'Saved.', warn: false });
  } catch (e) {
    Object.assign(boardForm, { note: e.message, warn: true });
  }
  renderSettings();
}

// A section opened from the list (on a phone, a step that Back undoes), and the way back to the list.
export function openSection(id) {
  const step = STACKED.matches && !SPLIT.matches && !settingsView.open;
  settingsView.tab = id;
  settingsView.open = true;
  if (step) settingsView.fromList = true;
  renderSettings();
  mark(step);
  if (step) document.querySelector('.sback')?.focus();
}
export function closeSection() {
  if (settingsView.fromList && depth) return history.back();
  settingsView.open = false;
  renderSettings();
  mark();
}

export const onAccountTab = () => screen === 'settings' && (sectShown('acct') || sectShown('share') || sectShown('feedback') || listShown());
