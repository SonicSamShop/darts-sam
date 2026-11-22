// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Problem reports: a dart scored wrongly, or not seen, saved with what the
// cameras saw, over the game, which carries on underneath.

import { compute, previousVisit } from '../engine.js';
import { label } from '../board.js';
import { share } from './sharing.js';
import { account, api, cameraCount, connected, esc, match, phone, pi, tracker } from '../app.js';

// ---------- problem reports ----------
// A dart scored wrongly, or not seen at all: the Pi saves what its cameras saw
// over the last few darts and says what it made of them (server/report.py).
// It is asked for straight away, while the darts are still in the board; what
// really happened is typed in afterwards and added to the saved report.
// The report lies over the game, which carries on underneath.
let reportBox = null;
function closeReport() { reportBox?.remove(); reportBox = null; }
export async function reportProblem() {
  closeReport();
  if (phone.scoring() && !(connected && cameraCount > 0)) {  // this phone's own camera: it makes and sends the report itself
    const s = compute(match);
    return phone.report({ match: match.id, game: match.gameId, opts: match.opts, players: s.players, throwing: s.current, log: match.log.slice(-9) });
  }
  const box = reportBox = document.body.appendChild(document.createElement('div'));
  box.className = 'report';
  const show = html => { box.innerHTML = `<div class="report-in">${html}</div>`; };
  show('<p class="muted">Saving what the cameras saw…</p>');
  const s = compute(match), prev = previousVisit(s);
  const named = d => ({ ...d, label: label(d) });
  let r;
  try {
    r = await api('/reports', 'POST', { app: {
      match: match.id, game: match.gameId, opts: match.opts, players: s.players, throwing: s.current,
      visit: s.turn.map(named),
      lastVisit: prev && !prev.typed ? { player: prev.player, bust: !!prev.bust, darts: prev.darts.map(named) } : null,
      log: match.log.slice(-9),
    } }, 30000);
  } catch (err) {
    if (reportBox !== box) return;
    return show(`<p class="warn">The report could not be saved: ${esc(err.status ? err.message : `${pi()} did not answer`)}.</p>
      <div class="row"><button data-rep="close">Close</button></div>`);
  }
  if (reportBox !== box) return;
  const part = p => `<h3>${esc(p.summary)}</h3><div class="pics">${Object.values(p.cameras).map((c, i) =>
    `<figure><img src="/api/reports/${r.id}/${c.seen}" alt=""><figcaption>${esc(p.lines[i])}</figcaption></figure>`).join('')}</div>`;
  show(`<div class="row"><h1>Report saved</h1><span class="spacer"></span><span class="muted">data/reports/${esc(r.id)}</span></div>
    <label>What should it have been? <input type="text" id="rep-expected" placeholder="T20, or: second dart not seen" autocomplete="off"></label>
    <label>Anything else? <input type="text" id="rep-note" placeholder="lights changed, dart hanging, hit another dart…" autocomplete="off"></label>
    <div class="row"><button class="primary" data-rep="save">Save and close</button><button data-rep="close">Close</button>
      <span class="warn" id="rep-error"></span></div>
    ${account.hosted || !share || share.paired ? '' : `<p class="muted">${share.on
      ? 'This report, with its pictures, is sent to Darts S.A.M once you save it here (or after two minutes).'
      : 'This report stays on this computer. To send reports to Darts S.A.M, switch on Settings → Sharing.'}</p>`}
    <p class="muted">Red is what changed in the picture, green is the board as the calibration has it, yellow the
      line of the dart, the cyan ring that camera's tip, and the magenta cross what was scored. Newest first.</p>
    ${r.looks.length ? '' : '<h3>The cameras have not seen anything change since they were started.</h3>'}
    ${[...r.looks].reverse().map(part).join('')}
    ${Object.keys(r.now.cameras).length ? part(r.now) : ''}`);
  box.dataset.id = r.id;
  tracker.track('report', { id: r.id, game: match.gameId });
  tracker.flush();
}
async function saveReport() {
  const val = id => reportBox.querySelector(id).value;
  try {
    await api(`/reports/${reportBox.dataset.id}`, 'PATCH', { expected: val('#rep-expected'), note: val('#rep-note') });
    closeReport();
  } catch {
    reportBox.querySelector('#rep-error').textContent = `Not saved: ${pi()} did not answer.`;
  }
}
document.addEventListener('click', e => {
  const rep = e.target.closest('.report [data-rep]')?.dataset.rep;
  if (rep === 'close') closeReport();
  if (rep === 'save') saveReport();
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.report input')) saveReport(); });
