// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The welcome page: the hosted version with nobody signed in, and signing in
// (Google, Apple, or a code sent by email).

import { GAMES } from '../games/index.js';
import { camScreen, pairing } from './cameras.js';
import { $app, SOURCE, THEMES, account, data, esc, liveLine, screen, setScreen, store, tracker } from '../app.js';
import { renderWelcome } from './welcome.js';
import { COMPARE_CHECKED, compareTable } from './compare.js';

// ---------- the welcome page ----------
// The hosted version with nobody signed in (account.locked): what the app is,
// and the buttons to sign in with. There is no sign-up form: the first sign-in
// makes the account, called by the person's first name, with a player of that name.
// It is a page of plain writing, in the README's words, with pictures of the app in it
// (web/shots: taken from the app itself, and one camera's picture of a real board).

// The two ways to play, where they differ: [what, tapping the board, with cameras].
// What it claims is what web/faq.html says: change one, change the other.
// A small number as it is written in a sentence: 8 -> "eight".
const inWords = n => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'][n] ?? String(n);
const WAYS = [
  ['What you need', 'A phone, tablet, TV or computer', 'Also a Mac, Windows or Linux PC and two or three webcams'],
  ['Scoring', 'Tap the board or type the visit', 'The cameras score each dart. Tap to put one right'],
  ['Without the internet', 'Once on your home screen', 'Needs the internet'],
];
const APPLE_LOGO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>';
const MAIL_LOGO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';

// Getting about before signing in: the name leads back here, then the questions, the downloads,
// what is new and the source. The foot of the page has those and the rules of the games as well.
// The same lines are written out at the top and bottom of web/faq.html, web/rules.html, web/download.html,
// web/releases.html, web/opensource.html and web/privacy.html: change one, change them all.
const SITE_PLACES = [['faq.html', 'FAQ'], ['download.html', 'Download'], ['releases.html', "What's new"], ['opensource.html', 'Open source']];
const FOOT_PLACES = [SITE_PLACES[0], ['rules.html', 'How to play'], ['autoscoring.html', 'How autoscoring works'],
  ['compare.html', 'Compared with Autodarts and DartCounter'], ...SITE_PLACES.slice(1)];
const BRAND = '<b class="wordmark">Darts S.A.M</b><span class="strap"><b>S</b>coring <b>A</b>ssisted <b>M</b>arker</span>';
const siteHead = () => `<header class="site-head"><a class="brand" href="./" data-act="land-home">${BRAND}</a>
      <nav class="site-nav" aria-label="Darts S.A.M">${SITE_PLACES.map(([href, name]) => `<a href="${href}">${name}</a>`).join('')}
        <a href="./" class="go" data-act="land-top">Sign in</a></nav></header>`;
const siteFoot = () => `<footer class="site-foot">
      <p>Darts S.A.M is free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0</a>.
        Copyright © 2026 Sam Cramphorn. <a href="${SOURCE}" target="_blank" rel="noopener">The source code is on GitHub</a>.</p>
      <p>${FOOT_PLACES.map(([href, name]) => `<a href="${href}">${name}</a>`).join(' · ')} · <a href="privacy.html">What is stored about you</a></p>
    </footer>`;
// Everyone's darts between them, as the site counts them (GET /api/tally). Asked for once,
// and written into the page already drawn: drawing it again would lose an address half typed.
let tally = null;
function showTally() {
  const el = document.getElementById('tally');
  if (!el || !tally?.darts) return;
  el.innerHTML = `<b>${tally.darts.toLocaleString()}</b> darts thrown on Darts S.A.M so far, in <b>${tally.games.toLocaleString()}</b> ${tally.games === 1 ? 'game' : 'games'}${tally.users ? `, by <b>${tally.users.toLocaleString()}</b> ${tally.users === 1 ? 'user' : 'users'} registered` : ''}`;
  el.hidden = false;
}
const askTally = () => tally ? showTally() : fetch('api/tally').then(r => r.ok ? r.json() : null)
  .then(t => { tally = t; showTally(); }, () => {});  // no answer: the page does without
export const landing = {
  note: '',  // why the last try at signing in came to nothing
  mailStep: '',  // signing in by email: '' not begun, 'ask' for the address, 'sent' the code is on its way
  newcomer: false,  // they signed up just now (see synced())
};
export let mailTo = '';       // the address it went to
export function renderLanding() {
  setScreen('landing');
  const pic = (file, alt, w, h, lazy = true) =>
    `<img src="shots/${file}" alt="${alt}" width="${w}" height="${h}"${lazy ? ' loading="lazy"' : ''}>`;
  // The home page at an address of its own (account.front) has no signing in: it sends people to the app's.
  document.documentElement.toggleAttribute('data-front', account.front);  // no "Install" bar there either (style.css)
  if (account.front && location.hash === '#signin') return location.replace(account.app + '/#signin');
  const card = account.front ? `<div class="signin-box" id="signin">
      <h2>Play in your browser. It's free.</h2>
      <button class="primary start" data-act="land-top">Open the app</button>
      <p class="muted small">Signing in takes one tap: no forms to fill in.
        <a href="privacy.html" target="_blank" rel="noopener">What is stored about you</a></p>
    </div>`
    : `<div class="signin-box" id="signin">
      <h2>Sign in to play. It's free.</h2>
      <div class="signin">
        <div id="gbtn"></div>
        ${account.appleId ? `<button class="apple" data-act="apple">${APPLE_LOGO}<span>Continue with Apple</span></button>` : ''}
        ${!account.email ? '' : landing.mailStep === 'ask' ? `<div class="mailbox">
            <input type="email" id="mail-addr" placeholder="Your email address" autocomplete="email" maxlength="254" value="${esc(mailTo)}">
            <button class="primary" data-act="mail-send">Email me a code</button></div>`
          : landing.mailStep === 'sent' ? `<div class="mailbox">
            <p>We've emailed a code to <b>${esc(mailTo)}</b>. Type it here, or open the link in the email.</p>
            <input type="text" id="mail-code" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code" maxlength="7">
            <button class="primary" data-act="mail-code">Sign in</button>
            <button class="ghost" data-act="mail-back">Use a different address</button></div>`
          : `<button class="mail" data-act="mail">${MAIL_LOGO}<span>Continue with email</span></button>`}
      </div>
      ${landing.note ? `<p class="warn">${esc(landing.note)}</p>` : ''}
      <p class="muted small">No forms to fill in. Your games and stats, and any problem reports you choose to send,
        are stored for this trial. <a href="privacy.html" target="_blank" rel="noopener">What is stored about you</a></p>
    </div>`;
  // The app's own address, when the home page is elsewhere: signing in and nothing else.
  if (account.home && !account.front) {
    $app.innerHTML = `<div class="site door">
      <header class="site-head"><span class="brand">${BRAND}</span>
        <nav class="site-nav"><a href="${esc(account.home)}/">About Darts S.A.M</a></nav></header>
      <main><h1>Game on</h1>${card}</main>
    </div>`;
    googleButton();
    appleReady();
    return;
  }
  $app.innerHTML = `<div class="site">
    ${siteHead()}
    <main>
    <div class="intro">
      <div>
        <h1>A darts scoreboard that scores by itself</h1>
        <p class="lead">Point two or three webcams at the board and Darts S.A.M sees where each dart lands. No cameras? Tap the board instead.
          Either way it calls every dart, does the adding up and keeps your stats.</p>
        ${card}
      </div>
      <figure class="shot">${pic('game.webp', 'A game of 501 in Darts S.A.M: the scores beside the board', 1800, 1125, false)}
        <figcaption>A game of 501: the scores chalked up beside the board, and each dart marked where it landed.</figcaption></figure>
    </div>
    <a class="tally" id="tally" href="faq.html#numbers" hidden></a>
    <section class="intro">
      <div>
        <h2>Scoring by camera</h2>
        <p>USB webcams round the board watch for each dart, work out where it landed and move on to the next player when the darts are pulled out.
          There is nothing to stick on the board: each camera finds the wires by itself, once, when you set it up.</p>
        <p>The cameras plug into a Mac, Windows or Linux computer near the board, and every phone, tablet and TV you sign in on follows along.</p>
        <p class="acts"><button class="primary" data-act="download">Download for Mac, Windows or Linux</button>
          <a href="faq.html#connect">How to set it up</a></p>
      </div>
      <figure class="shot">${pic('camera.webp', 'A webcam\'s picture of a dartboard, with every wire and number drawn over it in green', 1280, 720)}
        <figcaption>What one camera sees: a real board, with its wires and numbers drawn where Darts S.A.M found them.</figcaption></figure>
    </section>
    <section>
      <h2>${inWords(GAMES.length).replace(/^./, c => c.toUpperCase())} games</h2>
      <p>Including X01, Cricket, Killer, Around the Clock and Bob's 27, for a match with friends or practice on your own.
        <a href="rules.html">See them all and how to play each one</a>.</p>
    </section>
    <section>
      <h2>Stats, the telly and your phone</h2>
      <div class="row3">
        <figure class="shot">${pic('stats.webp', 'Stats: averages, checkout rate and a heat map', 1800, 1125)}
          <figcaption><b>Stats for every player.</b> Three-dart and first-nine averages, checkout rate, highest checkout and 180s,
            and a heat map of where your darts land. Tap any number to see the legs behind it.</figcaption></figure>
        <figure class="shot">${pic('tv.webp', 'TV view: the board with the scores along the bottom', 1800, 1125)}
          <figcaption><b>TV view.</b> The board gets the screen and the scores run along the bottom, the way a match is shown on television.</figcaption></figure>
        <figure class="shot tall">${pic('game-phone.webp', 'The same game on a phone', 780, 1560)}
          <figcaption><b>On a phone.</b> At the oche, or added to your home screen.</figcaption></figure>
      </div>
      <p>Every dart is called aloud, with the visit's total and what you require for a finish. And there are ${inWords(THEMES.length)} themes to choose from,
        from the pub chalkboard to big-stage TV graphics.</p>
    </section>
    <section>
      <h2>How it compares</h2>
      <p>What you would pay for elsewhere is free here. Where the others are ahead, we say so.</p>
      ${compareTable()}
      <p class="muted small">From Autodarts' and DartCounter's own websites on ${COMPARE_CHECKED}.
        <a href="compare.html">The full comparison, with links to where they say it</a>.</p>
    </section>
    <section>
      <h2>With cameras or without</h2>
      <table class="ways">
        <thead><tr><td></td><th scope="col">Tapping the board</th><th scope="col">With cameras</th></tr></thead>
        <tbody>${WAYS.map(([what, ...ways]) => `<tr><th scope="row">${what}</th>${ways.map(w => `<td>${w}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p>Everything else is the same either way: the caller, all ${inWords(GAMES.length)} games, the stats, TV view and the themes.
        Both are free, with no adverts.</p>
      <p class="acts"><button class="primary" data-act="land-top">Sign in to play</button>
        <a href="faq.html">Questions first? How it connects, how it works and what is stored</a></p>
    </section>
    </main>
    ${siteFoot()}
  </div>`;
  if (!account.front) { googleButton(); appleReady(); }
  askTally();
  // "Sign in" on the questions and the downloads leads here (./#signin): straight to the buttons
  if (location.hash === '#signin') document.getElementById('signin').scrollIntoView({ block: 'center' });
}
// Google's and Apple's own sign-in code, fetched from them only when the welcome page is shown.
const scripts = {};
const script = src => scripts[src] ??= new Promise((done, fail) => {
  const tag = document.createElement('script');
  tag.src = src;
  tag.onload = done;
  tag.onerror = () => { delete scripts[src]; tag.remove(); fail(); };
  document.head.append(tag);
});
// Google draws its own button.
function googleButton() {
  const box = document.getElementById('gbtn');
  const offline = () => { if (box.isConnected) box.innerHTML = '<p class="muted">Signing in needs the internet.</p>'; };
  if (!account.clientId) return navigator.onLine ? null : offline();  // the server has not said yet: drawn again when it has
  script('https://accounts.google.com/gsi/client').then(() => {
    if (!box.isConnected) return;
    window.google.accounts.id.initialize({ client_id: account.clientId, callback: r => signIn('google', { credential: r.credential }) });
    window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'continue_with', width: 280 });
  }, offline);
}
// Apple's opens a window of its own when the button is pressed, so it has to be ready before then.
function appleReady() {
  if (!account.appleId) return;
  script('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js').then(() =>
    window.AppleID.auth.init({ clientId: account.appleId, scope: 'name', redirectURI: location.origin, usePopup: true }), () => {});
}
export async function appleSignIn() {
  let r;
  try {
    r = await window.AppleID.auth.signIn();
  } catch (e) {
    if (e?.error === 'popup_closed_by_user') return;  // they changed their mind
    landing.note = window.AppleID ? 'Apple sign-in did not finish. Try again.' : 'Signing in needs the internet.';
    return renderLanding();
  }
  // Apple says the person's name only the first time they sign in to a site, and only to the page.
  signIn('apple', { credential: r.authorization.id_token, name: r.user?.name?.firstName ?? null });
}
// By email: they give their address, are sent a code and a link, and type the
// code here (the link does the same on whatever device it is opened on: see the end of this file).
export async function sendCode() {
  mailTo = document.getElementById('mail-addr').value.trim();
  if (!mailTo) return;
  landing.note = '';
  document.querySelector('[data-act="mail-send"]').disabled = true;  // one press, one email
  try {
    await account.sendCode(mailTo);
    landing.mailStep = 'sent';
  } catch (e) {
    landing.note = e.status ? e.message : 'Could not reach the site. Try again.';
  }
  if (screen !== 'landing') return;
  renderLanding();
  document.getElementById(landing.mailStep === 'sent' ? 'mail-code' : 'mail-addr')?.focus();
}
export async function signIn(provider, details) {
  landing.note = '';
  try {
    const had = store.get('owner', null);
    const how = await account.signIn(provider, details);
    landing.newcomer = how !== 'in';
    landing.mailStep = mailTo = '';  // the app opens: see createAccount above
    // New here: ask about a camera before the menu (see renderWelcome). Not when they came by
    // the link their cameras' computer showed: that has answered it, and opens the cameras.
    // Signed up without a name (by email): their name is asked first, whichever way they came.
    if (how === 'unnamed') store.set('unnamed', account.account.id);
    if (landing.newcomer && !pairing.code) store.set('newcomer', account.account.id);
    if (how === 'unnamed' || (landing.newcomer && !pairing.code)) renderWelcome();
    // someone else's games were cleared from this device: start again from what is saved
    if (had && had !== account.account.id) return location.reload();
    camScreen.startCal = '';  // signed in: their cameras find the board again (calibrateOnStart)
    liveLine?.close();  // it reconnects, now as this person: their cameras' darts come down it
    data.sync(true);
    tracker.flush();
  } catch (e) {
    landing.note = e.status || e.signedOut ? e.message : 'Could not reach the site. Try again.';  // refused, or not reached
    if (screen === 'landing') renderLanding();
  }
}
addEventListener('online', () => { if (screen === 'landing') account.load(); });  // the buttons can be drawn now
