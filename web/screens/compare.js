// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// How Darts S.A.M compares with Autodarts and DartCounter, in short: on the
// welcome page (landing.js) and in Settings → About (release.js). It is the
// short form of web/compare.html, and says only what that page says, from the
// two products' own websites: check theirs again, and change compare.html and
// its date, before changing a line here. web/home.html has the same table written
// out: change one, change both. Say where they are ahead as plainly as where we are.

// [what, Darts S.A.M, Autodarts, DartCounter]
const ROWS = [
  ['What it costs', 'Free. No paid plan, no adverts', 'Free, or Plus at £5.99 a month', 'Free, or Ultimate, a subscription'],
  ['Camera scoring', 'As much as you like, with two or three webcams', 'Five phone-camera matches a month free, as many as you like on Plus', 'Only with a Target Omni'],
  ['Killer and 121 Checkout', 'Free', 'On Plus', ''],
  ['Playing strangers online', 'Not yet: Darts S.A.M is for the people round your board', 'Yes, with matchmaking and tournaments', 'Yes, the biggest of the three: three matches a week free'],
  ['Open source', 'Yes, all of it', 'No', 'No'],
];

// Each cell says whose it is, for a phone, where the table becomes a list (style.css .vs)
const WHO = ['Darts S.A.M', 'Autodarts', 'DartCounter'];
export const compareTable = () => `<table class="ways vs">
    <thead><tr><td></td><th scope="col">Darts S.A.M</th><th scope="col">Autodarts</th><th scope="col">DartCounter</th></tr></thead>
    <tbody>${ROWS.map(([what, ...them]) => `<tr><th scope="row">${what}</th>${them.map((t, i) =>
      `<td data-who="${WHO[i]}">${t || '<span class="muted">Not on their site</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;

export const COMPARE_CHECKED = '23 November 2026';
