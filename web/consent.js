// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Google Analytics on the hosted site, only for people who say yes to it.
// The site adds this script to each page it sends when "google_analytics_id" is
// set in its settings (server/host.py), but not to pages for the addresses in
// "analytics_skip_ips". The desktop app never has it.
//
// Until someone answers, a bar at the foot of the page asks. Google's script is
// only fetched after "Allow": before that, and after "No thanks", nothing is sent
// to Google. The answer is kept in a cookie on dartssam.co.uk and its app
// address alike, so it is asked once for both, and lasts six months.
//
// The site's pages are counted by their own address. The app is one page
// (index.html) with many screens: it says which screen is showing through
// window.dartsCount (see counted() in app.js), and each new one is counted.
// The privacy page's "Change your answer" button asks again.
(() => {
  const id = document.currentScript?.dataset.ga;
  if (!id || window.dartsCount) return;
  const NAME = 'dartssam_analytics', DAYS = 182;
  const app = /^\/(index\.html)?$/.test(location.pathname);
  let shown = app ? null : location.pathname;  // what is on screen now
  let sent = null;  // the last thing counted
  let on = false;
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }

  // The answer, on the widest part of the address a cookie can be kept on
  // (dartssam.co.uk, so app.dartssam.co.uk sees it too; on a laptop, localhost).
  const answer = () => document.cookie.match(new RegExp(`(?:^|; )${NAME}=(yes|no)`))?.[1] ?? null;
  function keep(value) {
    const parts = location.hostname.split('.');
    for (let i = Math.max(parts.length - 2, 0); i >= 0; i--) {
      const domain = parts.length > 1 ? `; domain=${parts.slice(i).join('.')}` : '';
      document.cookie = `${NAME}=${value}; max-age=${DAYS * 86400}; path=/; samesite=lax${domain}`;
      if (answer() === value) return;
    }
  }
  // Google's own cookies (_ga, _ga_...), removed when someone changes to "No thanks".
  function forget() {
    const parts = location.hostname.split('.');
    for (const name of document.cookie.split('; ').map(c => c.split('=')[0]).filter(n => /^_ga/.test(n))) {
      document.cookie = `${name}=; max-age=0; path=/`;
      for (let i = 0; i < parts.length; i++)
        document.cookie = `${name}=; max-age=0; path=/; domain=${parts.slice(i).join('.')}`;
    }
  }

  function count() {
    if (!on || !shown || shown === sent) return;
    sent = shown;
    gtag('event', 'page_view', { page_location: location.origin + shown, page_title: document.title });
  }
  function start() {
    window[`ga-disable-${id}`] = false;
    if (!on) {
      on = true;
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
      document.head.append(s);
      gtag('js', new Date());
      gtag('config', id, { send_page_view: false });  // each page and screen is counted by count()
    }
    count();
  }
  function stop() {
    window[`ga-disable-${id}`] = true;
    on = false;
    sent = null;
    forget();
  }

  window.dartsCount = path => { shown = path; count(); };

  function ask() {
    document.querySelector('.consent')?.remove();
    const bar = document.createElement('div');
    bar.className = 'consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Google Analytics');
    bar.innerHTML = `<p>May Darts S.A.M use Google Analytics to see which pages and screens are used most?
      It sets cookies, and only if you allow it. <a href="privacy.html">What it records</a></p>
      <p class="consent-do"><button type="button" class="primary" data-consent="yes">Allow</button>
      <button type="button" data-consent="no">No thanks</button></p>`;
    bar.addEventListener('click', e => {
      const said = e.target.closest('[data-consent]')?.dataset.consent;
      if (!said) return;
      keep(said);
      bar.remove();
      dispatchEvent(new Event('resize'));  // the bar can take room from the app (style.css): fit it again
      if (said === 'yes') start(); else stop();
    });
    document.body.append(bar);
    dispatchEvent(new Event('resize'));
  }

  function ready() {
    // the privacy page's button, there only when this script is
    for (const el of document.querySelectorAll('[data-analytics]')) el.hidden = false;
    document.addEventListener('click', e => { if (e.target.closest('[data-analytics-ask]')) ask(); });
    const said = answer();
    if (said === 'yes') start();
    else if (said !== 'no') ask();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
