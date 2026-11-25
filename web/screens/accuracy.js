// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Accuracy test, for the admin: darts are pushed into the board by hand, one at a
// time, and the cameras score each one exactly as in a game (the same events,
// from the desktop's USB cameras over /ws or from this phone's camera). Each is
// marked right or wrong, and the tally says how often the cameras get it right,
// by what was being tried (a tight group, a dart on the wire...). A wrong one
// saves a problem report with what the cameras saw, as report.js does in a game.
//
// It is reached at #/accuracy. On the hosted site only an admin account can open
// it (and finds it under Settings → Account); the desktop app has no accounts,
// so there the address is the only way in.

import { label } from '../board.js';
import { needsAsk } from '../ask.js';
import { $app, account, api, cameraCount, connected, esc, pageFoot, pageHead, phone, setScreen, store } from '../app.js';

// What is being tried: each dart is filed under the one picked when it went in.
const TAGS = [['normal', 'Normal'], ['tight', 'Tight group'], ['wire', 'On a wire'], ['hidden', 'Hidden by a dart'], ['bull', 'Bull']];
const tagName = id => TAGS.find(t => t[0] === id)?.[1] ?? id;

export const lab = {
  results: null,    // [{at, said, right, truth, tag, source, cameras, confidence, asked}], read when first needed
  visit: [],        // indexes into results: the darts in the board now
  tag: 'normal',
  wrong: null,      // index being corrected ('miss' for a dart not counted at all)
  note: '',
};
const keep = () => store.set('accuracy', lab.results);
const load = () => { lab.results ??= store.get('accuracy', []); };

export const allowed = () => !account.hosted || !!account.account?.admin;

const source = () => (connected && cameraCount > 0 ? 'USB cameras' : phone.scoring() ? 'Phone camera' : null);

// From app.js, while this screen is up: what the cameras saw.
export function labEvent(ev) {
  load();
  if (ev.type === 'dart') {
    lab.results.push({ at: Date.now(), said: label(ev), right: null, truth: null, tag: lab.tag, source: source(),
      cameras: ev.cameras ?? null, confidence: ev.confidence ?? null, asked: needsAsk(ev) });
    lab.visit.push(lab.results.length - 1);
    lab.note = '';
    keep();
  } else if (ev.type === 'takeout') {
    lab.visit = [];
    lab.wrong = null;
    lab.note = 'Darts out: the board is taken as empty.';
  } else if (ev.type === 'removed') {
    lab.note = 'One dart came out.';
  } else return;
  renderAccuracy();
}

function tally(rows) {
  const marked = rows.filter(r => r.right !== null);
  const right = marked.filter(r => r.right).length;
  return { right, of: marked.length, pct: marked.length ? Math.round(100 * right / marked.length) : null };
}
const pctText = t => (t.of ? `${t.right} of ${t.of} · ${t.pct}%` : '–');

export function renderAccuracy() {
  setScreen('accuracy');
  load();
  if (!allowed()) {
    $app.innerHTML = `<div class="page">${pageHead('')}<h2>Accuracy test</h2>
      <p class="muted">Only an admin can open this.</p>${pageFoot('')}</div>`;
    return;
  }
  const src = source();
  const all = tally(lab.results);
  const byTag = TAGS.map(([id, name]) => [name, tally(lab.results.filter(r => r.tag === id))]).filter(([, t]) => t.of);
  const row = i => {
    const r = lab.results[i];
    const verdict = r.right === true ? '<span>Right</span>'
      : r.right === false ? `<span class="warn">Wrong: was ${esc(r.truth || '?')}</span>`
      : `<button class="primary" data-lab="right" data-i="${i}">Right</button> <button data-lab="wrong" data-i="${i}">Wrong</button>`;
    const how = [r.cameras ? `${r.cameras} camera${r.cameras === 1 ? '' : 's'}` : '',
      r.confidence !== null ? `${Math.round(100 * r.confidence)}% sure` : '', r.asked ? 'a game would ask' : ''].filter(Boolean).join(' · ');
    return `<tr><th scope="row">${esc(r.said)}</th><td class="muted small">${esc(how)}</td><td>${verdict}</td></tr>`;
  };
  $app.innerHTML = `<div class="page accuracy">
    ${pageHead('')}
    <h2>Accuracy test</h2>
    <p class="muted">Push a dart into the board by hand and let go: it is counted as in a game. Mark each one right or
      wrong. Pull the darts out (or press Board is empty) before the next lot.</p>
    <p>${src ? `Scoring with: <b>${src}</b>${src === 'Phone camera' ? ' <span class="beta">Beta</span>' : ''}`
      : '<span class="warn">No cameras are scoring.</span>'}${!src && account.hosted && phone.offeredNow()
      ? ' <button data-lab="phone">Use this phone\'s camera</button>' : ''}</p>

    <p class="muted small">What you are trying:</p>
    <div class="row">${TAGS.map(([id, name]) =>
      `<button class="${lab.tag === id ? 'primary' : ''}" data-lab="tag" data-tag="${id}">${name}</button>`).join('')}</div>

    <h3>In the board now</h3>
    ${lab.visit.length ? `<table class="ways"><tbody>${lab.visit.map(row).join('')}</tbody></table>`
      : '<p class="muted">Waiting for a dart…</p>'}
    ${lab.wrong !== null ? `<div class="row">
      <label>${lab.wrong === 'miss' ? 'A dart it didn\'t count: what was it?' : 'What was it really?'}
        <input type="text" id="lab-truth" placeholder="T20, D16, 5, Bull, 25…" autocomplete="off"></label>
      <button class="primary" data-lab="truth">Save</button><button data-lab="cancel">Cancel</button></div>` : ''}
    <div class="row">
      <button data-lab="missed">It didn't count one</button>
      ${src === 'USB cameras' ? '<button data-lab="empty">Board is empty</button>' : ''}
    </div>
    ${lab.note ? `<p class="muted">${esc(lab.note)}</p>` : ''}

    <h3>So far: ${pctText(all)}</h3>
    ${byTag.length ? `<table class="ways"><tbody>${byTag.map(([name, t]) =>
      `<tr><th scope="row">${esc(name)}</th><td>${pctText(t)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${lab.results.some(r => r.right === false) ? `<h3>Wrong ones</h3><table class="ways"><tbody>${lab.results
      .filter(r => r.right === false).slice(-20).reverse().map(r =>
        `<tr><th scope="row">${esc(r.said ?? 'Not counted')}</th><td>was ${esc(r.truth || '?')}</td>
          <td class="muted small">${esc(tagName(r.tag))}${r.source ? ` · ${esc(r.source)}` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="row"><button class="ghost danger" data-lab="clear">Clear the results</button></div>
    ${pageFoot('')}
  </div>`;
  document.getElementById('lab-truth')?.focus();
}

// A wrong one: keep what the cameras saw, as a problem report (report.js does the same in a game).
async function report(r) {
  const app = { test: 'accuracy', said: r.said, truth: r.truth, tag: r.tag };
  if (r.source === 'Phone camera') return phone.report(app);  // it asks and sends for itself
  try {
    const made = await api('/reports', 'POST', { app }, 30000);
    await api(`/reports/${made.id}`, 'PATCH', { expected: r.truth || '', note: `accuracy test: ${tagName(r.tag)}, scored ${r.said ?? 'nothing'}` });
    lab.note = `Pictures saved: report ${made.id}.`;
  } catch (err) {
    lab.note = `The pictures could not be saved${err.status ? `: ${String(err.message).replace(/\.$/, '')}` : ''}.`;
  }
  renderAccuracy();
}

function act(what, b) {
  const i = +b.dataset.i;
  if (what === 'tag') lab.tag = b.dataset.tag;
  if (what === 'right') { lab.results[i].right = true; keep(); }
  if (what === 'wrong') lab.wrong = i;
  if (what === 'missed') lab.wrong = 'miss';
  if (what === 'cancel') lab.wrong = null;
  if (what === 'truth') {
    const truth = document.getElementById('lab-truth')?.value.trim().toUpperCase() || '?';
    let r;
    if (lab.wrong === 'miss') {
      r = { at: Date.now(), said: null, right: false, truth, tag: lab.tag, source: source(), cameras: null, confidence: null, asked: false };
      lab.results.push(r);
    } else {
      r = Object.assign(lab.results[lab.wrong], { right: false, truth });
    }
    lab.wrong = null;
    keep();
    lab.note = 'Saving the pictures…';
    report(r);
  }
  if (what === 'empty') {
    lab.visit = []; lab.wrong = null;
    lab.note = 'Telling the cameras the board is empty…';
    api('/reset', 'POST', undefined, 5000).then(() => { lab.note = 'Done: the board is taken as empty.'; },
      () => { lab.note = 'That didn\'t reach the cameras. Try again.'; }).then(renderAccuracy);
  }
  if (what === 'phone') return phone.open();
  if (what === 'clear') {
    if (b.dataset.sure !== 'yes') { b.dataset.sure = 'yes'; b.textContent = 'Press again to clear them all'; return; }
    lab.results = []; lab.visit = []; lab.wrong = null; lab.note = ''; keep();
  }
  renderAccuracy();
}
document.addEventListener('click', e => {
  const b = e.target.closest('.accuracy [data-lab]');
  if (b) act(b.dataset.lab, b);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'lab-truth') act('truth', e.target);
});
